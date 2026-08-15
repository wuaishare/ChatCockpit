import { ServiceError } from "../../application/service-error.js";
import {
  buildRuntimeResourceId,
  hashRuntimeResource
} from "../../application/runtime-resource-hash.js";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor,
  RuntimeResourceInventoryAdapter,
  RuntimeResourceInventoryDiagnostic,
  RuntimeResourceInventoryProjection,
  RuntimeResourceInventoryRequest,
  RuntimeResourceTargetReadRequest
} from "../../application/runtime-resource-types.js";
import type {
  RuntimeMcpServerProjection,
  RuntimePluginListInput,
  RuntimePluginProjection,
  RuntimeResourceConfigSummary,
  RuntimeSkillListInput,
  RuntimeSkillProjection
} from "../codex/runtime-adapter.js";
import { buildCodexPluginResourceDescriptor } from "./codex-plugin-resource-projector.js";

interface CodexResourceInventoryRuntime {
  listCodexSkills(input: RuntimeSkillListInput): Promise<RuntimeSkillProjection[]>;
  listCodexMcpServers(): Promise<RuntimeMcpServerProjection[]>;
  listCodexPlugins(input?: RuntimePluginListInput): Promise<RuntimePluginProjection[]>;
  readCodexResourceConfigSummary(): Promise<RuntimeResourceConfigSummary>;
}

type ResourceWithoutFingerprint = Omit<RuntimeResourceDescriptor, "fingerprint">;

const MAX_CODEX_RESOURCE_ITEMS = 1000;
const CODEX_RESOURCE_KIND_PRIORITY: RuntimeResourceDescriptor["kind"][] = [
  "skill",
  "mcp-server",
  "plugin",
  "runtime-adapter",
  "acp-agent"
];

function bounded(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length <= max ? value : value.slice(0, max);
}

function skillScope(scope: string | null): RuntimeResourceDescriptor["scope"] {
  if (scope === "user") return "user";
  if (["workspace", "project", "repo", "repository"].includes(scope ?? "")) {
    return "workspace";
  }
  if (["system", "runtime", "bundled"].includes(scope ?? "")) return "runtime";
  return "unknown";
}

function mcpAuthStatus(
  status: string | null
): RuntimeResourceDescriptor["authStatus"] {
  if (!status) return "unknown";
  if (status === "unsupported") return "unsupported";
  if (/bearer|oauth|authenticated|ready/i.test(status)) return "ready";
  if (/required|unauth|login|not.?logged|needs/i.test(status)) return "required";
  if (status === "unknown") return "unknown";
  return "unknown";
}

function finalizeResource(
  resource: ResourceWithoutFingerprint
): RuntimeResourceDescriptor {
  const normalized = {
    ...resource,
    capabilities: [...resource.capabilities].sort()
  };
  return {
    ...normalized,
    fingerprint: hashRuntimeResource(normalized)
  };
}

function projectSkill(
  profile: RuntimeProfileDescriptor,
  skill: RuntimeSkillProjection
): RuntimeResourceDescriptor {
  const scope = skillScope(skill.scope);
  const externalId = `skill:${scope}:${skill.name}`;
  const identityExternalId = skill.sourceIdentityHash
    ? `${externalId}:source:${skill.sourceIdentityHash}`
    : externalId;
  return finalizeResource({
    id: buildRuntimeResourceId({
      runtimeProfileId: profile.id,
      kind: "skill",
      externalId: identityExternalId
    }),
    runtimeProfileId: profile.id,
    kind: "skill",
    externalId: bounded(externalId, 300) ?? externalId,
    displayName:
      bounded(skill.displayName ?? skill.name, 200) ?? "Unnamed Skill",
    description: bounded(skill.shortDescription ?? skill.description, 1000),
    scope,
    installed: true,
    enabled: skill.enabled,
    version: null,
    availableVersion: null,
    updateStatus: "not-applicable",
    authStatus: "not-applicable",
    compatibilityStatus: "ready",
    sourceKind: "runtime-native",
    sourceLabel: "Codex",
    capabilities: ["instruction"],
    publicReason: null
  });
}

function projectPlugins(
  profile: RuntimeProfileDescriptor,
  plugins: RuntimePluginProjection[]
): RuntimeResourceDescriptor[] {
  const sourceIdentitiesByPluginId = new Map<string, Set<string>>();
  for (const plugin of plugins) {
    const identities = sourceIdentitiesByPluginId.get(plugin.id) ?? new Set<string>();
    identities.add(plugin.sourceIdentityHash ?? "unknown-source");
    sourceIdentitiesByPluginId.set(plugin.id, identities);
  }
  const ambiguousPluginId = [...sourceIdentitiesByPluginId.entries()].find(
    ([, identities]) => identities.size > 1
  );
  if (ambiguousPluginId) {
    throw new ServiceError(
      "RUNTIME_RESOURCE_DUPLICATE",
      `Codex Plugin provider identity ${ambiguousPluginId[0]} resolves to multiple source identities`
    );
  }
  return plugins.map((plugin) =>
    buildCodexPluginResourceDescriptor(profile, plugin)
  );
}

function dedupeResourceProjection(
  resources: RuntimeResourceDescriptor[],
  diagnostics: RuntimeResourceInventoryDiagnostic[]
): RuntimeResourceDescriptor[] {
  const byId = new Map<string, RuntimeResourceDescriptor>();
  let coalesced = 0;
  for (const resource of resources) {
    const existing = byId.get(resource.id);
    if (!existing) {
      byId.set(resource.id, resource);
      continue;
    }
    if (existing.fingerprint !== resource.fingerprint) {
      const differingFields = Object.keys(resource)
        .filter((field) => field !== "fingerprint")
        .filter(
          (field) =>
            JSON.stringify(existing[field as keyof RuntimeResourceDescriptor]) !==
            JSON.stringify(resource[field as keyof RuntimeResourceDescriptor])
        )
        .sort();
      throw new ServiceError(
        "RUNTIME_RESOURCE_DUPLICATE",
        `Codex Resource Inventory returned conflicting public observations for ${resource.kind}:${resource.externalId} (${differingFields.join(", ") || "fingerprint"})`,
        {
          details: {
            kind: resource.kind,
            externalId: resource.externalId,
            differingFields
          }
        }
      );
    }
    coalesced += 1;
  }
  if (coalesced > 0) {
    diagnostics.push({
      source: "codex-resource-deduplication",
      status: "degraded",
      code: "RUNTIME_RESOURCE_DUPLICATE_COALESCED",
      message: `Codex Resource Inventory coalesced ${coalesced} identical duplicate observations`
    });
  }
  return [...byId.values()];
}

function boundResourceProjection(
  resources: RuntimeResourceDescriptor[],
  diagnostics: RuntimeResourceInventoryDiagnostic[]
): RuntimeResourceDescriptor[] {
  const deduped = dedupeResourceProjection(resources, diagnostics);
  const sorted = [...deduped].sort((left, right) =>
    left.kind.localeCompare(right.kind) ||
    left.displayName.localeCompare(right.displayName) ||
    left.id.localeCompare(right.id)
  );
  if (sorted.length <= MAX_CODEX_RESOURCE_ITEMS) return sorted;

  const installedPlugins = sorted.filter(
    (resource) => resource.kind === "plugin" && resource.installed === true
  );
  if (installedPlugins.length > MAX_CODEX_RESOURCE_ITEMS) {
    throw new ServiceError(
      "RUNTIME_RESOURCE_BUDGET_EXCEEDED",
      `Codex installed Plugin inventory alone exceeds the ${MAX_CODEX_RESOURCE_ITEMS}-item public snapshot budget`
    );
  }

  const installedPluginIds = new Set(installedPlugins.map((resource) => resource.id));
  const budgetCandidates = sorted.filter(
    (resource) =>
      !(resource.kind === "plugin" && installedPluginIds.has(resource.id))
  );
  const groups = CODEX_RESOURCE_KIND_PRIORITY
    .map((kind) => ({
      kind,
      resources: budgetCandidates.filter((resource) => resource.kind === kind)
    }))
    .filter((group) => group.resources.length > 0);
  const selected: RuntimeResourceDescriptor[] = [...installedPlugins];
  const dropped: string[] = [];
  let remaining = MAX_CODEX_RESOURCE_ITEMS - selected.length;

  for (let index = 0; index < groups.length; index += 1) {
    if (remaining <= 0) {
      for (const group of groups.slice(index)) {
        if (group.resources.length > 0) {
          dropped.push(`${group.kind}:${group.resources.length}`);
        }
      }
      break;
    }
    const group = groups[index]!;
    const groupsRemaining = groups.length - index;
    const quota = Math.ceil(remaining / groupsRemaining);
    const take = Math.min(group.resources.length, quota);
    selected.push(...group.resources.slice(0, take));
    remaining -= take;
    const omitted = group.resources.length - take;
    if (omitted > 0) dropped.push(`${group.kind}:${omitted}`);
  }

  diagnostics.push({
    source: "codex-resource-budget",
    status: "degraded",
    code: "RUNTIME_RESOURCE_TRUNCATED",
    message: `Codex Resource Inventory exceeded the ${MAX_CODEX_RESOURCE_ITEMS}-item public snapshot budget; omitted ${sorted.length - selected.length} items (${dropped.join(", ")})`
  });
  return selected.sort((left, right) =>
    left.kind.localeCompare(right.kind) ||
    left.displayName.localeCompare(right.displayName) ||
    left.id.localeCompare(right.id)
  );
}

function failureDiagnostic(
  source: string,
  error: unknown
): RuntimeResourceInventoryDiagnostic {
  return {
    source,
    status: "failed",
    code:
      error instanceof Error && "code" in error
        ? String((error as { code?: unknown }).code ?? "RUNTIME_RESOURCE_SOURCE_FAILED")
        : "RUNTIME_RESOURCE_SOURCE_FAILED",
    message:
      error instanceof Error
        ? bounded(error.message, 500)
        : "Runtime resource source failed"
  };
}

export class CodexResourceInventoryAdapter
  implements RuntimeResourceInventoryAdapter
{
  readonly providerKind = "codex";
  readonly protocolKind = "native-app-server";

  constructor(private readonly runtime: CodexResourceInventoryRuntime) {}

  async inventory(
    input: RuntimeResourceInventoryRequest
  ): Promise<RuntimeResourceInventoryProjection> {
    if (
      input.profile.providerKind !== "codex" ||
      input.profile.protocolKind !== "native-app-server"
    ) {
      throw new ServiceError(
        "RUNTIME_PROFILE_MISMATCH",
        "Native Codex Resource Inventory requires a Codex App Server profile"
      );
    }

    if (!input.workspaceId) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_WORKSPACE_REQUIRED",
        "Codex Resource Inventory requires a ChatCockpit Workspace"
      );
    }

    const resources: RuntimeResourceDescriptor[] = [];
    const diagnostics: RuntimeResourceInventoryDiagnostic[] = [];
    const [skillsResult, mcpResult, pluginsResult, configResult] = await Promise.allSettled([
      this.runtime.listCodexSkills({
        workspaceId: input.workspaceId,
        forceReload: true
      }),
      this.runtime.listCodexMcpServers(),
      this.runtime.listCodexPlugins({ workspaceId: input.workspaceId }),
      this.runtime.readCodexResourceConfigSummary()
    ]);

    if (skillsResult.status === "fulfilled") {
      resources.push(
        ...skillsResult.value.map((skill) => projectSkill(input.profile, skill))
      );
      diagnostics.push({
        source: "codex-skills",
        status: "ready",
        code: null,
        message: null
      });
    } else {
      diagnostics.push(failureDiagnostic("codex-skills", skillsResult.reason));
    }

    if (mcpResult.status === "fulfilled") {
      for (const server of mcpResult.value) {
        const externalId = `mcp:${server.name}`;
        const capabilities = ["mcp"];
        if (server.readOnlyToolCount > 0) capabilities.push("read-only-tools");
        if (server.mutatingToolCount > 0) capabilities.push("mutating-tools");
        const base: ResourceWithoutFingerprint = {
          id: buildRuntimeResourceId({
            runtimeProfileId: input.profile.id,
            kind: "mcp-server",
            externalId
          }),
          runtimeProfileId: input.profile.id,
          kind: "mcp-server",
          externalId: bounded(externalId, 300) ?? externalId,
          displayName: bounded(server.title ?? server.name, 200) ?? "Unnamed MCP",
          description: bounded(
            `${server.toolCount} tools (${server.readOnlyToolCount} read-only, ${server.mutatingToolCount} mutating or unspecified)`,
            1000
          ),
          scope: "runtime",
          installed: true,
          enabled: true,
          version: bounded(server.version, 200),
          availableVersion: null,
          updateStatus: "unknown",
          authStatus: mcpAuthStatus(server.authStatus),
          compatibilityStatus: "ready",
          sourceKind: "runtime-native",
          sourceLabel: "Codex",
          capabilities,
          publicReason: null
        };
        resources.push(finalizeResource(base));
      }
      diagnostics.push({
        source: "codex-mcp",
        status: "ready",
        code: null,
        message: null
      });
    } else {
      diagnostics.push(failureDiagnostic("codex-mcp", mcpResult.reason));
    }

    if (pluginsResult.status === "fulfilled") {
      resources.push(...projectPlugins(input.profile, pluginsResult.value));
      diagnostics.push({
        source: "codex-plugins",
        status: "ready",
        code: null,
        message: null
      });
    } else {
      diagnostics.push(failureDiagnostic("codex-plugins", pluginsResult.reason));
    }

    if (configResult.status === "fulfilled") {
      diagnostics.push({
        source: "codex-config",
        status: "ready",
        code: null,
        message: configResult.value.loaded
          ? "Codex effective config loaded through public-safe summary"
          : null
      });
    } else {
      diagnostics.push(failureDiagnostic("codex-config", configResult.reason));
    }

    return {
      profile: input.profile,
      resources: boundResourceProjection(resources, diagnostics),
      diagnostics
    };
  }

  async readTarget(
    input: RuntimeResourceTargetReadRequest
  ): Promise<RuntimeResourceInventoryProjection> {
    if (
      input.profile.providerKind !== "codex" ||
      input.profile.protocolKind !== "native-app-server"
    ) {
      throw new ServiceError(
        "RUNTIME_PROFILE_MISMATCH",
        "Native Codex Resource target reads require a Codex App Server profile"
      );
    }
    if (!input.workspaceId) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_WORKSPACE_REQUIRED",
        "Codex Resource target reads require a ChatCockpit Workspace"
      );
    }

    if (input.resourceKind === "skill") {
      const skills = await this.runtime.listCodexSkills({
        workspaceId: input.workspaceId,
        forceReload: true
      });
      return {
        profile: input.profile,
        resources: skills
          .map((skill) => projectSkill(input.profile, skill))
          .filter((resource) => resource.id === input.resourceId),
        diagnostics: [
          {
            source: "codex-skills-target",
            status: "ready",
            code: null,
            message: null
          }
        ]
      };
    }

    const plugins = await this.runtime.listCodexPlugins({
      workspaceId: input.workspaceId,
      forceRefetch: true
    });
    return {
      profile: input.profile,
      resources: projectPlugins(input.profile, plugins).filter(
        (resource) => resource.id === input.resourceId
      ),
      diagnostics: [
        {
          source: "codex-plugins-target",
          status: "ready",
          code: null,
          message: null
        }
      ]
    };
  }
}

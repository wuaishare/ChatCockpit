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
  RuntimeResourceInventoryRequest
} from "../../application/runtime-resource-types.js";
import type {
  RuntimeMcpServerProjection,
  RuntimePluginListInput,
  RuntimePluginProjection,
  RuntimeResourceConfigSummary,
  RuntimeSkillListInput,
  RuntimeSkillProjection
} from "../codex/runtime-adapter.js";

interface CodexResourceInventoryRuntime {
  listCodexSkills(input: RuntimeSkillListInput): Promise<RuntimeSkillProjection[]>;
  listCodexMcpServers(): Promise<RuntimeMcpServerProjection[]>;
  listCodexPlugins(input?: RuntimePluginListInput): Promise<RuntimePluginProjection[]>;
  readCodexResourceConfigSummary(): Promise<RuntimeResourceConfigSummary>;
}

type ResourceWithoutFingerprint = Omit<RuntimeResourceDescriptor, "fingerprint">;

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

function pluginUpdateStatus(
  plugin: RuntimePluginProjection
): RuntimeResourceDescriptor["updateStatus"] {
  if (!plugin.installed) return "not-applicable";
  if (plugin.version && plugin.availableVersion) {
    return plugin.version === plugin.availableVersion ? "current" : "update-available";
  }
  return "unknown";
}

function finalizeResource(
  resource: ResourceWithoutFingerprint
): RuntimeResourceDescriptor {
  return {
    ...resource,
    capabilities: [...resource.capabilities].sort(),
    fingerprint: hashRuntimeResource({
      ...resource,
      capabilities: [...resource.capabilities].sort()
    })
  };
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
        "Codex Resource Inventory requires a TokenPilot Workspace"
      );
    }

    const resources: RuntimeResourceDescriptor[] = [];
    const diagnostics: RuntimeResourceInventoryDiagnostic[] = [];
    const [skillsResult, mcpResult, pluginsResult, configResult] = await Promise.allSettled([
      this.runtime.listCodexSkills({
        workspaceId: input.workspaceId,
        forceReload: false
      }),
      this.runtime.listCodexMcpServers(),
      this.runtime.listCodexPlugins({ workspaceId: input.workspaceId }),
      this.runtime.readCodexResourceConfigSummary()
    ]);

    if (skillsResult.status === "fulfilled") {
      for (const skill of skillsResult.value) {
        const externalId = `skill:${skill.name}`;
        const base: ResourceWithoutFingerprint = {
          id: buildRuntimeResourceId({
            runtimeProfileId: input.profile.id,
            kind: "skill",
            externalId
          }),
          runtimeProfileId: input.profile.id,
          kind: "skill",
          externalId: bounded(externalId, 300) ?? externalId,
          displayName:
            bounded(skill.displayName ?? skill.name, 200) ?? "Unnamed Skill",
          description: bounded(
            skill.shortDescription ?? skill.description,
            1000
          ),
          scope: skillScope(skill.scope),
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
        };
        resources.push(finalizeResource(base));
      }
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
      for (const plugin of pluginsResult.value) {
        const externalId = `plugin:${plugin.id}`;
        const available = plugin.availability === null || plugin.availability === "AVAILABLE";
        const base: ResourceWithoutFingerprint = {
          id: buildRuntimeResourceId({
            runtimeProfileId: input.profile.id,
            kind: "plugin",
            externalId
          }),
          runtimeProfileId: input.profile.id,
          kind: "plugin",
          externalId: bounded(externalId, 300) ?? externalId,
          displayName: bounded(plugin.displayName, 200) ?? "Unnamed Plugin",
          description: bounded(plugin.description, 1000),
          scope: "runtime",
          installed: plugin.installed,
          enabled: plugin.enabled,
          version: bounded(plugin.version, 200),
          availableVersion: bounded(plugin.availableVersion, 200),
          updateStatus: pluginUpdateStatus(plugin),
          authStatus: plugin.authPolicy ? "unknown" : "not-applicable",
          compatibilityStatus: available ? "ready" : "blocked",
          sourceKind: "runtime-native",
          sourceLabel: `Codex:${bounded(plugin.marketplaceName, 120) ?? "marketplace"}`,
          capabilities: plugin.capabilities.map((capability) =>
            `plugin:${capability.toLowerCase()}`
          ),
          publicReason: available
            ? null
            : bounded(
                `Codex plugin availability is ${plugin.availability ?? "unknown"}`,
                500
              )
        };
        resources.push(finalizeResource(base));
      }
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
      resources: resources.sort((left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.displayName.localeCompare(right.displayName) ||
        left.id.localeCompare(right.id)
      ),
      diagnostics
    };
  }
}

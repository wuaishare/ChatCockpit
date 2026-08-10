import { createHash } from "node:crypto";

import { ServiceError } from "../../application/service-error.js";
import {
  buildRuntimeResourceId,
  hashRuntimeResource
} from "../../application/runtime-resource-hash.js";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "../../application/runtime-resource-types.js";
import type { WorkspaceRepository } from "../../continuity/repositories/workspace-repository.js";
import {
  resolveCodexBinary,
  type CodexBinaryResolution
} from "../codex/binary.js";
import { CodexAppServerClient } from "../codex/app-server-client.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function publicScope(scope: string | null): RuntimeResourceDescriptor["scope"] {
  if (scope === "user") return "user";
  if (["workspace", "project", "repo", "repository"].includes(scope ?? "")) {
    return "workspace";
  }
  if (["system", "runtime", "bundled"].includes(scope ?? "")) return "runtime";
  return "unknown";
}

interface PrivateSkillTarget {
  resourceId: string;
  sourceIdentityHash: string;
  path: string;
  name: string;
  scope: RuntimeResourceDescriptor["scope"];
  enabled: boolean;
}

export interface CodexSkillMutationInput {
  profile: RuntimeProfileDescriptor;
  workspaceId: string;
  resourceId: string;
  expectedFingerprint: string;
  desiredEnabled: boolean;
}

export interface CodexSkillMutationResult {
  effectiveEnabled: boolean;
}

export interface CodexSkillMutationAdapterOptions {
  workspaces: WorkspaceRepository;
  resolveBinary?: () => CodexBinaryResolution;
  createClient?: (resolution: CodexBinaryResolution) => CodexAppServerClient;
}

export class CodexSkillMutationAdapter {
  private readonly workspaces: WorkspaceRepository;
  private readonly binaryResolver: () => CodexBinaryResolution;
  private readonly clientFactory: (
    resolution: CodexBinaryResolution
  ) => CodexAppServerClient;

  constructor(options: CodexSkillMutationAdapterOptions) {
    this.workspaces = options.workspaces;
    this.binaryResolver = options.resolveBinary ?? (() => resolveCodexBinary());
    this.clientFactory =
      options.createClient ??
      ((resolution) => new CodexAppServerClient({ command: resolution.command }));
  }

  async setEnabled(input: CodexSkillMutationInput): Promise<CodexSkillMutationResult> {
    if (
      input.profile.providerKind !== "codex" ||
      input.profile.protocolKind !== "native-app-server"
    ) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED",
        "Codex Skill mutation requires a native Codex App Server profile"
      );
    }

    const workspace = this.workspaces.getPrivate(input.workspaceId);
    const resolution = this.binaryResolver();
    const client = this.clientFactory(resolution);
    try {
      const targets = await this.readPrivateSkillTargets(
        client,
        input.profile,
        workspace.privatePath
      );
      const matching = targets.filter((target) => target.resourceId === input.resourceId);
      if (matching.length === 0) {
        throw new ServiceError(
          "RUNTIME_RESOURCE_MUTATION_NOT_FOUND",
          "The approved Codex Skill is no longer present in the live Runtime inventory"
        );
      }
      if (matching.length !== 1) {
        throw new ServiceError(
          "RUNTIME_RESOURCE_MUTATION_TARGET_AMBIGUOUS",
          "The approved Codex Skill no longer resolves to exactly one private Runtime target"
        );
      }

      const target = matching[0]!;
      const liveFingerprint = this.skillFingerprint(input.profile, target);
      if (liveFingerprint !== input.expectedFingerprint) {
        throw new ServiceError(
          "RUNTIME_RESOURCE_MUTATION_STALE",
          "The Codex Skill changed after approval and must be reviewed again"
        );
      }

      if (target.enabled === input.desiredEnabled) {
        return { effectiveEnabled: target.enabled };
      }

      const response = asRecord(
        await client.request<unknown>("skills/config/write", {
          path: target.path,
          enabled: input.desiredEnabled
        })
      );
      if (typeof response.effectiveEnabled !== "boolean") {
        throw new ServiceError(
          "RUNTIME_RESOURCE_MUTATION_EXTERNAL_FAILED",
          "Codex App Server returned no effective Skill state after mutation"
        );
      }
      return { effectiveEnabled: response.effectiveEnabled };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_EXTERNAL_FAILED",
        "Codex Skill mutation failed"
      );
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private async readPrivateSkillTargets(
    client: CodexAppServerClient,
    profile: RuntimeProfileDescriptor,
    privateWorkspacePath: string
  ): Promise<PrivateSkillTarget[]> {
    const response = asRecord(
      await client.request<unknown>("skills/list", {
        cwds: [privateWorkspacePath],
        forceReload: true
      })
    );
    const groups = Array.isArray(response.data) ? response.data : [];
    const targets: PrivateSkillTarget[] = [];
    for (const groupValue of groups) {
      const group = asRecord(groupValue);
      const rawSkills = Array.isArray(group.skills) ? group.skills : [];
      for (const rawSkill of rawSkills) {
        const skill = asRecord(rawSkill);
        if (
          typeof skill.name !== "string" ||
          !skill.name ||
          typeof skill.path !== "string" ||
          !skill.path
        ) {
          continue;
        }
        const scope = publicScope(
          typeof skill.scope === "string" ? skill.scope : null
        );
        const sourceIdentityHash = createHash("sha256")
          .update(skill.path, "utf8")
          .digest("hex");
        const externalId = `skill:${scope}:${skill.name}`;
        targets.push({
          resourceId: buildRuntimeResourceId({
            runtimeProfileId: profile.id,
            kind: "skill",
            externalId: `${externalId}:source:${sourceIdentityHash}`
          }),
          sourceIdentityHash,
          path: skill.path,
          name: skill.name,
          scope,
          enabled: skill.enabled !== false
        });
      }
    }
    return targets;
  }

  private skillFingerprint(
    profile: RuntimeProfileDescriptor,
    target: PrivateSkillTarget
  ): string {
    const externalId = `skill:${target.scope}:${target.name}`;
    const base = {
      id: target.resourceId,
      runtimeProfileId: profile.id,
      kind: "skill" as const,
      externalId,
      displayName: target.name,
      description: null,
      scope: target.scope,
      installed: true,
      enabled: target.enabled,
      version: null,
      availableVersion: null,
      updateStatus: "not-applicable" as const,
      authStatus: "not-applicable" as const,
      compatibilityStatus: "ready" as const,
      sourceKind: "runtime-native" as const,
      sourceLabel: "Codex",
      capabilities: ["instruction"],
      publicReason: null
    };
    return hashRuntimeResource(base);
  }
}

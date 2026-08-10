import { hashRuntimeResource } from "./runtime-resource-hash.js";
import type { RuntimeResourceDescriptor } from "./runtime-resource-types.js";
import { ServiceError } from "./service-error.js";
import type {
  RuntimeResourceMutationOperation,
  RuntimeResourceMutationProviderMethod
} from "../continuity/repositories/runtime-resource-mutation-repository.js";

export interface RuntimeResourceMutationSemantics {
  operation: RuntimeResourceMutationOperation;
  resourceKind: "skill" | "plugin";
  providerMethod: RuntimeResourceMutationProviderMethod;
  requestedState: Readonly<Record<string, boolean>>;
  beforeState(resource: RuntimeResourceDescriptor): Record<string, boolean>;
  isNoop(resource: RuntimeResourceDescriptor): boolean;
  isVerified(resource: RuntimeResourceDescriptor | undefined): boolean;
  observedState(
    resource: RuntimeResourceDescriptor | undefined
  ): Record<string, unknown>;
  publicState(
    resource: RuntimeResourceDescriptor
  ): Record<string, boolean>;
}

export interface RuntimeResourceMutationHashInput {
  operation: RuntimeResourceMutationOperation;
  runtimeProfileId: string;
  workspaceId: string;
  resource: RuntimeResourceDescriptor;
  beforeSnapshotId: string;
  providerKind: string;
  protocolKind: string;
}

function requireBooleanState(
  value: boolean | null,
  label: "enabled" | "installed"
): boolean {
  if (typeof value !== "boolean") {
    throw new ServiceError(
      "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED",
      `Runtime Resource does not expose an authoritative ${label} state`
    );
  }
  return value;
}

function skillSemantics(
  operation: "skill.enable" | "skill.disable"
): RuntimeResourceMutationSemantics {
  const desired = operation === "skill.enable";
  return {
    operation,
    resourceKind: "skill",
    providerMethod: "skills/config/write",
    requestedState: { enabled: desired },
    beforeState(resource) {
      return { enabled: requireBooleanState(resource.enabled, "enabled") };
    },
    isNoop(resource) {
      return requireBooleanState(resource.enabled, "enabled") === desired;
    },
    isVerified(resource) {
      return resource?.enabled === desired;
    },
    observedState(resource) {
      return resource ? { enabled: resource.enabled } : { missing: true };
    },
    publicState(resource) {
      return {
        beforeEnabled: requireBooleanState(resource.enabled, "enabled"),
        requestedEnabled: desired
      };
    }
  };
}

function pluginSemantics(
  operation: "plugin.install" | "plugin.uninstall"
): RuntimeResourceMutationSemantics {
  const desired = operation === "plugin.install";
  return {
    operation,
    resourceKind: "plugin",
    providerMethod: desired ? "plugin/install" : "plugin/uninstall",
    requestedState: { installed: desired },
    beforeState(resource) {
      return {
        installed: requireBooleanState(resource.installed, "installed")
      };
    },
    isNoop(resource) {
      return requireBooleanState(resource.installed, "installed") === desired;
    },
    isVerified(resource) {
      if (!resource || resource.installed !== desired) return false;
      const capabilities = new Set(resource.capabilities);
      return desired
        ? capabilities.has("plugin:observed:installed")
        : capabilities.has("plugin:observed:catalog");
    },
    observedState(resource) {
      return resource ? { installed: resource.installed } : { missing: true };
    },
    publicState(resource) {
      return {
        beforeInstalled: requireBooleanState(resource.installed, "installed"),
        requestedInstalled: desired
      };
    }
  };
}

export function mutationSemantics(
  operation: RuntimeResourceMutationOperation
): RuntimeResourceMutationSemantics {
  switch (operation) {
    case "skill.enable":
    case "skill.disable":
      return skillSemantics(operation);
    case "plugin.install":
    case "plugin.uninstall":
      return pluginSemantics(operation);
  }
}

export function buildRuntimeResourceMutationHashV2(
  input: RuntimeResourceMutationHashInput
): string {
  const semantics = mutationSemantics(input.operation);
  return hashRuntimeResource({
    schemaVersion: 2,
    operation: input.operation,
    runtimeProfileId: input.runtimeProfileId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    workspaceId: input.workspaceId,
    resourceId: input.resource.id,
    resourceKind: input.resource.kind,
    resourceScope: input.resource.scope,
    beforeSnapshotId: input.beforeSnapshotId,
    beforeFingerprint: input.resource.fingerprint,
    beforeState: semantics.beforeState(input.resource),
    requestedState: semantics.requestedState
  });
}

export function buildLegacySkillMutationHashV1(
  input: RuntimeResourceMutationHashInput
): string {
  if (
    input.operation !== "skill.enable" &&
    input.operation !== "skill.disable"
  ) {
    throw new ServiceError(
      "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED",
      "Legacy Runtime Resource mutation hash v1 only supports Codex Skills"
    );
  }
  const semantics = mutationSemantics(input.operation);
  const beforeState = semantics.beforeState(input.resource);
  return hashRuntimeResource({
    schemaVersion: 1,
    operation: input.operation,
    runtimeProfileId: input.runtimeProfileId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    workspaceId: input.workspaceId,
    resourceId: input.resource.id,
    resourceKind: input.resource.kind,
    resourceScope: input.resource.scope,
    beforeSnapshotId: input.beforeSnapshotId,
    beforeFingerprint: input.resource.fingerprint,
    beforeEnabled: beforeState.enabled,
    requestedEnabled: semantics.requestedState.enabled
  });
}

export function runtimeResourceMutationHashMatches(
  storedHash: string,
  input: RuntimeResourceMutationHashInput
): boolean {
  if (storedHash === buildRuntimeResourceMutationHashV2(input)) {
    return true;
  }
  if (
    input.operation === "skill.enable" ||
    input.operation === "skill.disable"
  ) {
    return storedHash === buildLegacySkillMutationHashV1(input);
  }
  return false;
}

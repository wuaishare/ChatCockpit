import type {
  RuntimeResourceAuthStatus,
  RuntimeResourceCompatibilityStatus,
  RuntimeResourceKind,
  RuntimeResourceScope,
  RuntimeResourceSourceKind,
  RuntimeResourceUpdateStatus
} from "../continuity/types.js";
import type {
  CapabilityProviderAuthStatus,
  CapabilityProviderCompatibilityStatus,
  CapabilityProviderDescriptor
} from "../capabilities/provider.js";

export type RuntimeProfileExecutableSource =
  | "bundled"
  | "path"
  | "custom"
  | "registry"
  | null;

export type RuntimeProfileCompatibilityStatus =
  CapabilityProviderCompatibilityStatus;

export type RuntimeProfileAuthStatus = CapabilityProviderAuthStatus;

export interface RuntimeProfileDescriptor extends CapabilityProviderDescriptor {
  executableSource: RuntimeProfileExecutableSource;
  executableVersion: string | null;
  protocolVersion: string | null;
  homeIdentityHash: string | null;
}

export interface RuntimeResourceDescriptor {
  id: string;
  runtimeProfileId: string;
  kind: RuntimeResourceKind;
  externalId: string;
  displayName: string;
  description: string | null;
  scope: RuntimeResourceScope;
  installed: boolean | null;
  enabled: boolean | null;
  version: string | null;
  availableVersion: string | null;
  updateStatus: RuntimeResourceUpdateStatus;
  authStatus: RuntimeResourceAuthStatus;
  compatibilityStatus: RuntimeResourceCompatibilityStatus;
  sourceKind: RuntimeResourceSourceKind;
  sourceLabel: string;
  capabilities: string[];
  publicReason: string | null;
  fingerprint: string;
}

export interface RuntimeResourceInventoryDiagnostic {
  source: string;
  status: "ready" | "degraded" | "failed";
  code: string | null;
  message: string | null;
}

export interface RuntimeResourceInventoryProjection {
  profile: RuntimeProfileDescriptor;
  resources: RuntimeResourceDescriptor[];
  diagnostics: RuntimeResourceInventoryDiagnostic[];
}

export interface RuntimeResourceInventoryRequest {
  profile: RuntimeProfileDescriptor;
  workspaceId?: string;
}

export interface RuntimeResourceTargetReadRequest {
  profile: RuntimeProfileDescriptor;
  workspaceId?: string;
  resourceId: string;
  resourceKind: "skill" | "plugin";
}

export interface RuntimeResourceInventoryAdapter {
  readonly providerKind: string;
  readonly protocolKind: string;
  inventory(
    input: RuntimeResourceInventoryRequest
  ): Promise<RuntimeResourceInventoryProjection>;
  readTarget?(
    input: RuntimeResourceTargetReadRequest
  ): Promise<RuntimeResourceInventoryProjection>;
}

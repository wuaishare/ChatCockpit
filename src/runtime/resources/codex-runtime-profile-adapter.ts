import { buildRuntimeProfileId } from "../../application/runtime-resource-hash.js";
import type { RuntimeProfileDescriptor } from "../../application/runtime-resource-types.js";
import type { RuntimeCapabilitySnapshot } from "../codex/runtime-adapter.js";
import type { RuntimeProfileSourceAdapter } from "./runtime-profile-registry.js";

interface CodexRuntimeProfileSource {
  capabilities(): Promise<RuntimeCapabilitySnapshot>;
}

function executableSource(
  value: string | null
): RuntimeProfileDescriptor["executableSource"] {
  if (value === "chatgpt-app" || value === "codex-app") return "bundled";
  if (value === "path" || value === "local-bin") return "path";
  if (value === "configured") return "custom";
  return null;
}

function authStatus(
  capability: RuntimeCapabilitySnapshot
): RuntimeProfileDescriptor["authStatus"] {
  if (capability.available) return "ready";
  return /AUTH|LOGIN|ACCOUNT/i.test(capability.unavailableReason ?? "")
    ? "required"
    : "unknown";
}

function compatibilityStatus(
  capability: RuntimeCapabilitySnapshot
): RuntimeProfileDescriptor["compatibilityStatus"] {
  if (!capability.available) return "unavailable";
  if (capability.experimentalApiEnabled) return "degraded";
  return "ready";
}

export class CodexRuntimeProfileAdapter implements RuntimeProfileSourceAdapter {
  readonly sourceKind = "codex";

  constructor(private readonly runtime: CodexRuntimeProfileSource) {}

  async listProfiles(): Promise<RuntimeProfileDescriptor[]> {
    const capability = await this.runtime.capabilities();
    return [
      {
        id: buildRuntimeProfileId({
          providerKind: "codex",
          protocolKind: "native-app-server",
          instanceIdentity: "default"
        }),
        providerKind: "codex",
        protocolKind: "native-app-server",
        displayName: "Codex",
        executableSource: executableSource(capability.binarySource),
        executableVersion: capability.binaryVersion,
        protocolVersion: capability.serverProtocolVersion,
        compatibilityStatus: compatibilityStatus(capability),
        homeIdentityHash: null,
        authStatus: authStatus(capability),
        capabilities: [...capability.stableMethods].sort(),
        publicReason: capability.available
          ? capability.experimentalApiEnabled
            ? "Codex experimental API is enabled; ChatCockpit Resource Center uses reviewed read-only methods only"
            : null
          : "Codex App Server is unavailable"
      }
    ];
  }
}

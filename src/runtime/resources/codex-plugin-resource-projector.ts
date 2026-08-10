import {
  buildRuntimeResourceId,
  hashRuntimeResource
} from "../../application/runtime-resource-hash.js";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "../../application/runtime-resource-types.js";
import type { RuntimePluginProjection } from "../codex/runtime-adapter.js";

function bounded(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length <= max ? value : value.slice(0, max);
}

function normalizedToken(value: string): string {
  return value.toLowerCase().replaceAll("_", "-");
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

export function buildCodexPluginResourceDescriptor(
  profile: RuntimeProfileDescriptor,
  plugin: RuntimePluginProjection
): RuntimeResourceDescriptor {
  const externalId = `plugin:${plugin.id}`;
  const identityExternalId = plugin.sourceIdentityHash
    ? `${externalId}:source:${plugin.sourceIdentityHash}`
    : externalId;
  const available =
    plugin.availability === null || plugin.availability === "AVAILABLE";
  const capabilities = [
    ...plugin.capabilities.map(
      (capability) => `plugin:${capability.toLowerCase()}`
    ),
    `plugin:source:${plugin.sourceType ?? "unknown"}`,
    ...(plugin.installPolicy
      ? [`plugin:install-policy:${normalizedToken(plugin.installPolicy)}`]
      : []),
    ...(plugin.installPolicySource
      ? [
          `plugin:install-policy-source:${normalizedToken(
            plugin.installPolicySource
          )}`
        ]
      : []),
    `plugin:installation-interstitial:${
      plugin.mustShowInstallationInterstitial === null
        ? "unknown"
        : String(plugin.mustShowInstallationInterstitial)
    }`,
    ...(plugin.authPolicy
      ? [`plugin:auth-policy:${normalizedToken(plugin.authPolicy)}`]
      : []),
    ...(plugin.observedBy ?? []).map(
      (source) => `plugin:observed:${source}`
    )
  ].sort();
  const base = {
    id: buildRuntimeResourceId({
      runtimeProfileId: profile.id,
      kind: "plugin",
      externalId: identityExternalId
    }),
    runtimeProfileId: profile.id,
    kind: "plugin" as const,
    externalId: bounded(externalId, 300) ?? externalId,
    displayName: bounded(plugin.displayName, 200) ?? "Unnamed Plugin",
    description: bounded(plugin.description, 1000),
    scope: "runtime" as const,
    installed: plugin.installed,
    enabled: plugin.enabled,
    version: bounded(plugin.version, 200),
    availableVersion: bounded(plugin.availableVersion, 200),
    updateStatus: pluginUpdateStatus(plugin),
    authStatus: plugin.authPolicy ? ("unknown" as const) : ("not-applicable" as const),
    compatibilityStatus: available ? ("ready" as const) : ("blocked" as const),
    sourceKind: "runtime-native" as const,
    sourceLabel: `Codex:${bounded(plugin.marketplaceName, 120) ?? "marketplace"}`,
    capabilities,
    publicReason: available
      ? null
      : bounded(
          `Codex plugin availability is ${plugin.availability ?? "unknown"}`,
          500
        )
  };
  return {
    ...base,
    fingerprint: hashRuntimeResource(base)
  };
}

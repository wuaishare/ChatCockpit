import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "./runtime-resource-types.js";
import type { RuntimeResourceMutationOperation } from "../continuity/repositories/runtime-resource-mutation-repository.js";

export type RuntimeResourceMutationEligibilityCode =
  | "eligible"
  | "runtime-profile-unsupported"
  | "resource-kind-mismatch"
  | "resource-compatibility-not-ready"
  | "skill-not-installed"
  | "plugin-mutation-unavailable"
  | "resource-state-unknown"
  | "already-requested-state"
  | "plugin-install-source-unsupported"
  | "plugin-install-policy-unsupported"
  | "plugin-install-auth-policy-unsupported"
  | "plugin-install-interstitial-unsupported"
  | "plugin-catalog-observation-required"
  | "plugin-uninstall-installed-by-default";

export type RuntimeResourceMutationEligibilityStage =
  | "eligible"
  | "platform"
  | "state"
  | "policy";

export interface RuntimeResourceMutationEligibility {
  eligible: boolean;
  code: RuntimeResourceMutationEligibilityCode;
  stage: RuntimeResourceMutationEligibilityStage;
  publicReason: string;
}

function outcome(
  eligible: boolean,
  code: RuntimeResourceMutationEligibilityCode,
  stage: RuntimeResourceMutationEligibilityStage,
  publicReason: string
): RuntimeResourceMutationEligibility {
  return { eligible, code, stage, publicReason };
}

function expectedKind(
  operation: RuntimeResourceMutationOperation
): "skill" | "plugin" {
  return operation === "skill.enable" || operation === "skill.disable"
    ? "skill"
    : "plugin";
}

function desiredState(operation: RuntimeResourceMutationOperation): boolean {
  return operation === "skill.enable" || operation === "plugin.install";
}

export function assessRuntimeResourceMutationEligibility(input: {
  profile: RuntimeProfileDescriptor;
  resource: RuntimeResourceDescriptor;
  operation: RuntimeResourceMutationOperation;
  pluginMutationAvailable: boolean;
}): RuntimeResourceMutationEligibility {
  if (
    input.profile.providerKind !== "codex" ||
    input.profile.protocolKind !== "native-app-server"
  ) {
    return outcome(
      false,
      "runtime-profile-unsupported",
      "platform",
      "This Runtime Profile does not support governed Resource mutation."
    );
  }

  const kind = expectedKind(input.operation);
  if (input.resource.kind !== kind) {
    return outcome(
      false,
      "resource-kind-mismatch",
      "platform",
      "The requested operation does not match this Resource kind."
    );
  }

  if (input.resource.compatibilityStatus !== "ready") {
    return outcome(
      false,
      "resource-compatibility-not-ready",
      "platform",
      "This Resource is not in a compatible ready state for governed mutation."
    );
  }

  if (kind === "skill" && input.resource.installed !== true) {
    return outcome(
      false,
      "skill-not-installed",
      "platform",
      "Governed Skill mutation requires an installed Skill."
    );
  }

  if (kind === "plugin" && !input.pluginMutationAvailable) {
    return outcome(
      false,
      "plugin-mutation-unavailable",
      "platform",
      "Governed Plugin mutation is unavailable for this Runtime Profile."
    );
  }

  const observedState =
    kind === "skill" ? input.resource.enabled : input.resource.installed;
  if (typeof observedState !== "boolean") {
    return outcome(
      false,
      "resource-state-unknown",
      "state",
      `This ${kind === "skill" ? "Skill" : "Plugin"} does not expose an authoritative mutation state.`
    );
  }

  if (observedState === desiredState(input.operation)) {
    return outcome(
      false,
      "already-requested-state",
      "state",
      "This Resource already has the requested state."
    );
  }

  if (kind === "skill") {
    return outcome(
      true,
      "eligible",
      "eligible",
      "This Skill is eligible for governed state mutation."
    );
  }

  const capabilities = new Set(input.resource.capabilities);
  if (input.operation === "plugin.install") {
    if (!capabilities.has("plugin:source:remote")) {
      return outcome(
        false,
        "plugin-install-source-unsupported",
        "policy",
        "Plugin install is limited to authoritative remote Plugin sources."
      );
    }
    if (!capabilities.has("plugin:install-policy:available")) {
      return outcome(
        false,
        "plugin-install-policy-unsupported",
        "policy",
        "This Plugin install policy is not eligible for governed installation."
      );
    }
    if (!capabilities.has("plugin:auth-policy:on-use")) {
      return outcome(
        false,
        "plugin-install-auth-policy-unsupported",
        "policy",
        "Plugin install is limited to Plugins that authenticate on use."
      );
    }
    if (!capabilities.has("plugin:installation-interstitial:false")) {
      return outcome(
        false,
        "plugin-install-interstitial-unsupported",
        "policy",
        "Plugin install requires an explicit no-interstitial installation policy."
      );
    }
    if (!capabilities.has("plugin:observed:catalog")) {
      return outcome(
        false,
        "plugin-catalog-observation-required",
        "policy",
        "Governed Plugin mutation requires authoritative catalog observation."
      );
    }
    return outcome(
      true,
      "eligible",
      "eligible",
      "This Plugin is eligible for governed installation."
    );
  }

  if (capabilities.has("plugin:install-policy:installed-by-default")) {
    return outcome(
      false,
      "plugin-uninstall-installed-by-default",
      "policy",
      "Plugins installed by default cannot be removed by this governed mutation flow."
    );
  }
  if (!capabilities.has("plugin:observed:catalog")) {
    return outcome(
      false,
      "plugin-catalog-observation-required",
      "policy",
      "Governed Plugin mutation requires authoritative catalog observation."
    );
  }
  return outcome(
    true,
    "eligible",
    "eligible",
    "This Plugin is eligible for governed removal."
  );
}

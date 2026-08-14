import { readIdentityEnv, type EnvLike } from "../core/identity-env.js";

function enabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() || "");
}

export function isResourceMutationExposureEnabled(
  env: EnvLike = process.env
): boolean {
  if (!enabled(readIdentityEnv("EXPOSED", env))) return true;
  return enabled(readIdentityEnv("RESOURCE_MUTATIONS_EXPOSED", env));
}

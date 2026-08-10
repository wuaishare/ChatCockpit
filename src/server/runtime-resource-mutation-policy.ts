type EnvLike = Record<string, string | undefined>;

function enabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() || "");
}

export function isResourceMutationExposureEnabled(
  env: EnvLike = process.env
): boolean {
  if (!enabled(env.TOKENPILOT_EXPOSED)) return true;
  return enabled(env.TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED);
}

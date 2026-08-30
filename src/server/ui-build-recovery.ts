import {
  verifyRuntimeBuildIntegrity,
  verifyWebBuildGeneration,
  verifyWebBuildIntegrity,
  type RuntimeBuildIntegrityResult,
  type RuntimeBuildProvenance
} from "../core/build-provenance.js";

export type UiRecoveryLocale = "zh-CN" | "en-US";
export type UiBuildRecoveryStatus = "ok" | "restart-required" | "rebuild-required";

export interface UiBuildRecoveryResult {
  status: UiBuildRecoveryStatus;
  runningWebIntegrity: RuntimeBuildIntegrityResult | null;
  diskRuntimeIntegrity: RuntimeBuildIntegrityResult | null;
}

function isSimplifiedChineseLanguage(value: string): boolean {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  return normalized === "zh" ||
    normalized === "zh-cn" ||
    normalized === "zh-sg" ||
    normalized === "zh-hans" ||
    normalized.startsWith("zh-hans-");
}

export function uiRecoveryLocaleFromAcceptLanguage(
  value: string | string[] | undefined
): UiRecoveryLocale {
  const source = Array.isArray(value) ? value.join(",") : value ?? "";
  const languages = source
    .split(",")
    .map((entry) => entry.split(";", 1)[0]?.trim() ?? "")
    .filter(Boolean);
  return languages.some(isSimplifiedChineseLanguage) ? "zh-CN" : "en-US";
}

export function resolveUiBuildRecovery(
  installRoot: string,
  runtimeBuildProvenance: RuntimeBuildProvenance | null,
  check: "generation" | "integrity" = "integrity"
): UiBuildRecoveryResult {
  if (!runtimeBuildProvenance) {
    return {
      status: "ok",
      runningWebIntegrity: null,
      diskRuntimeIntegrity: null
    };
  }

  const runningWebIntegrity = check === "generation"
    ? verifyWebBuildGeneration(installRoot, runtimeBuildProvenance)
    : verifyWebBuildIntegrity(installRoot, runtimeBuildProvenance);
  if (runningWebIntegrity.ok) {
    return {
      status: "ok",
      runningWebIntegrity,
      diskRuntimeIntegrity: null
    };
  }

  const diskRuntimeIntegrity = verifyRuntimeBuildIntegrity(installRoot);
  return {
    status: diskRuntimeIntegrity.ok ? "restart-required" : "rebuild-required",
    runningWebIntegrity,
    diskRuntimeIntegrity
  };
}

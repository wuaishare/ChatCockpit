import type { JobArtifactSummary, JobCounts, JobSummary } from "./types";
import type { LocaleCode } from "./i18n";
import { getUiCopy } from "./i18n";

const SUSPICIOUS_PATH_PATTERNS = [
  /^\/(Users|home|var|private|Volumes)\//i,
  /^[A-Za-z]:\\/,
  /(^|\/)\.\.(\/|$)/,
  /(^|\/)\.tokenpilot\/(runtime|jobs)(\/|$)/i,
  /(^|\/)\.codex(\/|$)/i,
  /(^|\/)\.servbay(\/|$)/i
];

export function maskToken(token: string | null, locale: LocaleCode): string {
  if (!token) return getUiCopy(locale).common.tokenMissing;
  if (token.length <= 8) return "••••••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

export function isSuspiciousPath(value: string): boolean {
  return SUSPICIOUS_PATH_PATTERNS.some((pattern) => pattern.test(value));
}

export function safeText(value: unknown, locale: LocaleCode): string {
  if (typeof value !== "string") return "";
  return isSuspiciousPath(value) ? getUiCopy(locale).common.hiddenSuspiciousPath : value;
}

export function safePathList(values: unknown, locale: LocaleCode): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => safeText(value, locale))
    .filter(Boolean);
}

export function safeArtifactList(values: unknown, locale: LocaleCode): JobArtifactSummary[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter(
      (value): value is JobArtifactSummary =>
        Boolean(value) &&
        typeof value === "object" &&
        typeof (value as JobArtifactSummary).key === "string" &&
        typeof (value as JobArtifactSummary).label === "string" &&
        typeof (value as JobArtifactSummary).path === "string" &&
        typeof (value as JobArtifactSummary).contentType === "string"
    )
    .map((value) => ({
      ...value,
      label: safeText(value.label, locale) || value.label,
      path: safeText(value.path, locale) || value.path,
      contentType: safeText(value.contentType, locale) || value.contentType
    }));
}

export function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(timestamp);
}

export function summarizeJob(job: {
  id: string;
  type: string;
  headline: string;
  hasResult: boolean;
  hasError: boolean;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  artifacts?: JobArtifactSummary[];
  error?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}, locale: LocaleCode): JobSummary {
  return {
    ...job,
    headline:
      safeText(job.headline, locale) ||
      safeText(job.payload.title, locale) ||
      safeText(job.payload.repoId, locale) ||
      `${job.type.toUpperCase()} job`,
    hasResult: Boolean(job.hasResult ?? job.result),
    hasError: Boolean(job.hasError ?? job.error),
    artifacts: safeArtifactList(job.artifacts, locale),
    error: safeText(job.error, locale)
  } as JobSummary;
}

export function countJobs(jobs: JobSummary[]): JobCounts {
  return jobs.reduce<JobCounts>(
    (counts, job) => {
      counts.total += 1;
      counts[job.status] += 1;
      return counts;
    },
    {
      total: 0,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0
    }
  );
}

export function buildGptHelperText(health: {
  authRequired: boolean;
  mode: string;
  publicBaseUrl: string | null;
  openapiUrl: string;
}, locale: LocaleCode): string {
  const copy = getUiCopy(locale);
  return [
    locale === "zh-CN"
      ? "你当前连接的是 TokenPilot 的本地优先工作流控制面。"
      : "You are connected to the TokenPilot local-first workflow control plane.",
    `${copy.gpt.modeLabel}: ${health.mode}`,
    `${copy.gpt.authRequiredLabel}: ${health.authRequired ? copy.status.yes : copy.status.no}`,
    `${copy.gpt.openapiLabel}: ${health.openapiUrl}`,
    `${copy.gpt.publicBaseUrlLabel}: ${health.publicBaseUrl ?? copy.common.notAvailable}`
  ].join("\n");
}

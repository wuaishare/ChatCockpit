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
  if (locale === "zh-CN") {
    return [
      "你当前连接的是 TokenPilot，一个面向 ChatGPT + Codex 协作流程的本地优先控制台。",
      "请使用 TokenPilot API 查看任务状态，并创建边界清晰的 taskpack / pack 任务。",
      "除非操作员明确确认，否则不要把当前状态视为已经具备完整 HTTPS / Custom GPT Actions 生产闭环。",
      "不要请求或暴露本地绝对路径、密钥、环境文件或运行时私有配置。",
      "",
      `${copy.gpt.modeLabel}: ${health.mode}`,
      `${copy.gpt.authRequiredLabel}: ${health.authRequired ? copy.status.yes : copy.status.no}`,
      `${copy.gpt.openapiLabel}: ${health.openapiUrl}`,
      `API base URL: ${health.publicBaseUrl ?? "仅本地 / 未暴露"}`,
      health.authRequired
        ? "当前需要访问令牌。请只在本地操作员控制的浏览器会话中提供 TOKENPILOT_API_TOKEN。"
        : "当前模式在本地可不带访问令牌使用，但暴露模式仍然需要鉴权。",
      "当前阶段: local-first 只读 Web UI MVP。",
      "完整 HTTPS / Custom GPT Actions 自动化闭环仍在验证中。"
    ].join("\n");
  }

  return [
    "You are connected to TokenPilot, a local-first ChatGPT + Codex workflow control plane.",
    "Use TokenPilot APIs to inspect job status and create narrowly scoped taskpack / pack jobs.",
    "Do not assume the full HTTPS / Custom GPT Actions automation loop is production-ready unless the operator confirms it.",
    "Never request or expose local absolute paths, secrets, env files, or runtime-private configuration.",
    "",
    `${copy.gpt.modeLabel}: ${health.mode}`,
    `${copy.gpt.authRequiredLabel}: ${health.authRequired ? "yes" : "no"}`,
    `${copy.gpt.openapiLabel}: ${health.openapiUrl}`,
    `API base URL: ${health.publicBaseUrl ?? "local-only / not exposed"}`,
    health.authRequired
      ? "An access token is required. Provide TOKENPILOT_API_TOKEN only in the local operator-controlled browser session."
      : "Current mode can be used locally without an access token, but exposed mode still requires authentication.",
    "Current phase: local-first read-only Web UI MVP.",
    "Full HTTPS / Custom GPT Actions automation loop is still under validation."
  ].join("\n");
}

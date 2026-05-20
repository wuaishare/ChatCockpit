import type { TokenPilotHealthStatus } from "../types.js";

export interface TokenPilotGptConfig {
  version: string;
  updatedAt: string;
  actionHost: string;
  openapiUrl: string;
  publicBaseUrl: string | null;
  schemaImportUrl: string;
  instructions: string;
  notes: string[];
}

const GPT_CONFIG_VERSION = "gpt-config-v1";

function resolveLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function resolvePublicBaseUrl(): string | null {
  return process.env.TOKENPILOT_PUBLIC_BASE_URL?.trim() || null;
}

function resolveActionHost(publicBaseUrl: string | null): string {
  if (!publicBaseUrl) {
    return "local-only";
  }

  try {
    return new URL(publicBaseUrl).host;
  } catch {
    return "tokenpilot.example.com";
  }
}

export function buildHealthStatusSnapshot(): TokenPilotHealthStatus {
  const publicBaseUrl = resolvePublicBaseUrl();
  return {
    ok: true,
    mode: "phase1-local",
    authRequired: /^(1|true|yes|on)$/i.test(process.env.TOKENPILOT_EXPOSED?.trim() || "") ||
      Boolean(process.env.TOKENPILOT_API_TOKEN?.trim()),
    exposed: /^(1|true|yes|on)$/i.test(process.env.TOKENPILOT_EXPOSED?.trim() || ""),
    publicBaseUrl,
    openapiUrl: publicBaseUrl
      ? `${publicBaseUrl.replace(/\/+$/, "")}/openapi.yaml`
      : "/openapi.yaml"
  };
}

export function buildGptInstructions(
  health: Pick<TokenPilotHealthStatus, "mode" | "authRequired" | "publicBaseUrl" | "openapiUrl">,
  locale: "zh-CN" | "en-US" = "zh-CN"
): string {
  const localTimeZone = resolveLocalTimeZone();
  const actionHost = resolveActionHost(health.publicBaseUrl);

  if (locale === "en-US") {
    return [
      "You are TokenPilot's workflow cockpit for local-first ChatGPT + Codex collaboration.",
      "Use TokenPilot Actions and APIs to inspect health, queue pack/taskpack jobs, and read public-safe results.",
      "Do not claim a completed HTTPS / Custom GPT Actions production loop unless the operator explicitly confirms it.",
      "Never request or expose local absolute paths, secrets, env files, or runtime-private configuration.",
      "",
      `Configuration context version: ${GPT_CONFIG_VERSION}`,
      `Local timezone: ${localTimeZone}`,
      `Mode: ${health.mode}`,
      `Auth required: ${health.authRequired ? "yes" : "no"}`,
      `OpenAPI URL: ${health.openapiUrl}`,
      `API base URL: ${health.publicBaseUrl ?? "local-only / not exposed"}`,
      `Action host: ${actionHost}`,
      "",
      "State rules:",
      "- Run health first, then listJobs/getJob for current execution state.",
      "- Treat queued/running as intermediate states unless direct evidence shows failure.",
      "- Use repoId as the public repository identifier.",
      "- Keep UTC timestamps explicit unless the operator asks for conversion.",
      "",
      "Current phase: local-first read-only Web UI MVP.",
      "Full HTTPS / Custom GPT Actions automation loop is still under validation."
    ].join("\n");
  }

  return [
    "你是 TokenPilot 的工作流驾驶舱，服务于本地优先的 ChatGPT + Codex 协作流程。",
    "请通过 TokenPilot 的 Actions / API 查看健康状态、创建 pack / taskpack 任务，并读取公开安全结果。",
    "除非操作员明确确认，否则不要把当前状态说成已经具备完整 HTTPS / Custom GPT Actions 生产闭环。",
    "不要请求或暴露本地绝对路径、密钥、环境文件或运行时私有配置。",
    "",
    `配置上下文版本：${GPT_CONFIG_VERSION}`,
    `本机时区：${localTimeZone}`,
    `模式：${health.mode}`,
    `需要鉴权：${health.authRequired ? "是" : "否"}`,
    `OpenAPI 地址：${health.openapiUrl}`,
    `API 基址：${health.publicBaseUrl ?? "仅本地 / 未暴露"}`,
    `动作主机：${actionHost}`,
    "",
    "状态规则：",
    "- 先做 health，再看 listJobs / getJob。",
    "- queued / running 只能视为中间态，除非有直接失败证据。",
    "- 对外统一使用 repoId。",
    "- 时间默认按 UTC 理解，除非操作员要求换算。",
    "",
    "当前阶段：local-first 只读 Web UI MVP。",
    "完整 HTTPS / Custom GPT Actions 自动化闭环仍在验证中。"
  ].join("\n");
}

export function buildGptConfig(locale: "zh-CN" | "en-US" = "zh-CN"): TokenPilotGptConfig {
  const updatedAt = new Date().toISOString();
  const health = buildHealthStatusSnapshot();
  const actionHost = resolveActionHost(health.publicBaseUrl);
  return {
    version: GPT_CONFIG_VERSION,
    updatedAt,
    actionHost,
    openapiUrl: health.openapiUrl,
    publicBaseUrl: health.publicBaseUrl,
    schemaImportUrl: health.openapiUrl,
    instructions: buildGptInstructions(health, locale),
    notes: [
      "如果版本号、OpenAPI URL、Public Base URL 或动作主机变化，建议去 GPT Builder 侧同步更新。",
      "当前控制面只能提供推荐配置真相，不能自动判断 GPT Builder 后台是否已经完成更新。",
      "当前阶段仍是 local-first 验证版，不应夸大为完整生产闭环。"
    ]
  };
}

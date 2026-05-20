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
    "你是 TokenPilot 的工作流驾驶舱。你的职责是：",
    "1. 帮用户澄清目标并生成清晰的 Task Pack。",
    "2. 通过已配置的 Actions 调用 TokenPilot 控制面来创建 pack/taskpack job、查询 job 状态、读取公开安全结果。",
    "3. 基于 job 结果给出下一步建议，但不得把未验证的中间状态说成最终结论。",
    "",
    "当前配置上下文：",
    `- 配置版本：${GPT_CONFIG_VERSION}`,
    `- 本机时区：${localTimeZone}`,
    `- 当前模式：${health.mode}`,
    `- 需要鉴权：${health.authRequired ? "是" : "否"}`,
    `- OpenAPI 地址：${health.openapiUrl}`,
    `- API 基址：${health.publicBaseUrl ?? "仅本地 / 未暴露"}`,
    `- 动作主机：${actionHost}`,
    "",
    "你必须遵守以下规则：",
    "",
    "一、状态获取规则",
    "- 获取“最新项目状态”时，先做 health，再看 listJobs 或 getJob。",
    "- health 只用于判断：控制面是否可达、当前 mode、auth 是否开启。",
    "- 不要把 health 当成完整项目状态接口。",
    "- 如果 job 当前是 queued 或 running，只能表述为“当前仍在等待 runner 消费或执行中”。",
    "- 不要把 queued/running 直接解读为异常、队列丢失、持久化损坏，除非有直接证据。",
    "- 如果需要最新快照，应明确说明：createPack 只代表任务已入队，必须继续查询该 job，直到 completed 或 failed。",
    "",
    "二、输出边界规则",
    "- 不要在最终回答中输出任何本地绝对路径，例如 /path/to/user/...",
    "- 如果接口返回了本地路径，也不要复述，改写成“当前仓库已识别”或“当前运行目标已识别”。",
    "- 不要暴露 token、真实私有配置、内部运行态细节。",
    "- 不要把旧语义 repoRoot 当成对外稳定接口字段；对外统一使用 repoId。",
    "",
    "三、文件读取规则",
    "- 当前控制面已经提供受控只读文件能力，可通过 repoId + 相对路径读取单个或多个文本文件。",
    "- 当用户明确要求读取某个仓库文件内容时，应优先使用受控文件读取接口，而不是声称“当前没有读取指定文件的能力”。",
    "- 文件读取必须遵守控制面白名单与相对路径限制。",
    "- 不要把受控只读能力说成任意远程文件系统访问，更不要暗示已经具备任意写入能力。",
    "- 如果接口返回 truncated=true，只能表述为“已读取到预览片段/前段内容”，不能声称已完整读取大文件正文。",
    "- 对于 pack artifact，优先使用 job artifact read 接口；如果需要完整大文件，应明确说明当前只拿到了受控预览。",
    "- 如果需要完整读取大型 repomixXml，应使用 offset/limit 继续分块读取，直到 nextOffset=null 或 eof=true。",
    "",
    "四、队列判断规则",
    "- listJobs 为空，只能说明“当前没有可见 job”，不能自动推断为异常。",
    "- listJobs 只显示当前 job、或历史 job 数量变化，也不能自动推断为队列被清空或状态不稳定。",
    "- 只有当 getJob / listJobs / createPack / createTaskPack / runner 结果彼此直接矛盾时，才可以报告“可能存在队列或运行上下文不一致”。",
    "- 如果某个 job 从 queued 进入 failed，必须优先报告失败状态和 error，而不是继续按 queued 解释。",
    "",
    "五、当前项目状态表述规则",
    "- 必须先基于当前接口返回和当前可见 job 状态得出结论，不要背诵固定模板。",
    "- 回答时必须明确区分：",
    "  - 已确认",
    "  - 推断",
    "  - 仍待验证",
    "- 可以说明当前已完成的能力边界，但不得把未验证链路说成已完成。",
    "- 当前阶段通常可以使用这些术语描述边界：",
    "  - local-first 自动化骨架",
    "  - Phase 2 安全基础",
    "  - 本地 E2E 验证",
    "  - 完整 HTTPS / Custom GPT Actions 自动化闭环仍在验证中",
    "- 不要把当前状态说成“安全自动化闭环已完成”。",
    "- 不要把 HTTPS / Custom GPT Actions / artifact consumption 生产闭环说成已完成。",
    "",
    "六、推荐下一步的规则",
    "- 如果 pack/taskpack 已 completed，优先基于 result 和公开相对路径分析下一步。",
    "- 如果 pack/taskpack failed，优先分析 failed 的 error，而不是假设 runner 没启动。",
    "- 如果 pack/taskpack queued 且没有更多证据，只能建议“继续查询该 job 或确认 runner 是否正在消费”，不能直接下结论说队列异常。",
    "- 如果任务目标是做 Codex 执行准备，优先建议生成结构化 Task Pack，而不是泛泛地再做一次状态诊断。",
    "",
    "七、回答风格",
    "- 先给事实，再给判断，再给下一步建议。",
    "- 明确区分：已确认、推断、仍待验证。",
    "- 不要因为一次空队列或一次 queued 就制造不必要的异常叙事。"
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

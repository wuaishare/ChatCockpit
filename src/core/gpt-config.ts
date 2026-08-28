import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  TokenPilotDistributionContext,
  TokenPilotHealthStatus,
  TokenPilotRepoGovernanceRecord
} from "../types.js";
import { readRuntimeBuildProvenance } from "./build-provenance.js";
import { buildRepoGovernance } from "./config.js";
import { buildSourceDistributionContext } from "./distribution-context.js";
import { readIdentityEnv } from "./identity-env.js";
import {
  DEFAULT_PRODUCT_IDENTITY,
  productIdentityForKey,
  type ProductIdentity
} from "./product-identity.js";
import type { ProductIdentityKey } from "../types.js";

export interface TokenPilotGptConfig {
  version: string;
  productVersion: string;
  schemaVersion: string;
  buildVersion: string;
  updatedAt: string;
  actionHost: string;
  openapiUrl: string;
  publicBaseUrl: string | null;
  schemaImportUrl: string;
  repoGovernance: TokenPilotRepoGovernanceRecord;
  instructions: string;
  notes: string[];
}

interface GptVersionParts {
  version: string;
  productVersion: string;
  schemaVersion: string;
  buildVersion: string;
}

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function resolveProductVersion(): string {
  try {
    const packageJson = require("../../package.json") as { version?: string };
    const rawVersion = packageJson.version?.trim() || "0.0.0";
    return rawVersion.startsWith("v") ? rawVersion : `v${rawVersion}`;
  } catch {
    return "v0.0.0";
  }
}

function readGitValue(args: string[], fallback: string): string {
  const result = spawnSync("git", args, {
    cwd: packageRoot,
    encoding: "utf8"
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : fallback;
}

function buildGptVersionParts(): GptVersionParts {
  const productVersion = resolveProductVersion();
  const buildVersion = readGitValue(
    ["log", "-1", "--format=%cd", "--date=format:%y.%m%d.%H%M%S"],
    "00.0000.000000"
  );
  const schemaVersion = readGitValue(["rev-list", "--count", "HEAD"], "0");

  return {
    version: `${productVersion} (${schemaVersion})`,
    productVersion,
    schemaVersion,
    buildVersion
  };
}

function resolveLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function resolvePublicBaseUrl(): string | null {
  return readIdentityEnv("PUBLIC_BASE_URL") ?? null;
}

function resolveActionHost(
  publicBaseUrl: string | null,
  productIdentity: ProductIdentityKey = DEFAULT_PRODUCT_IDENTITY.key
): string {
  if (!publicBaseUrl) {
    return "local-only";
  }

  try {
    return new URL(publicBaseUrl).host;
  } catch {
    return `${productIdentityForKey(productIdentity).packageName}.example.com`;
  }
}

function projectGptIdentityText(
  value: string,
  identity: ProductIdentity
): string {
  if (identity.key === DEFAULT_PRODUCT_IDENTITY.key) return value;
  return value.replaceAll("ChatCockpit", identity.displayName);
}

export function buildHealthStatusSnapshot(
  productIdentity: ProductIdentityKey = DEFAULT_PRODUCT_IDENTITY.key
): TokenPilotHealthStatus {
  const publicBaseUrl = resolvePublicBaseUrl();
  const exposed = /^(1|true|yes|on)$/i.test(readIdentityEnv("EXPOSED") ?? "");
  const provenance = readRuntimeBuildProvenance();
  return {
    ok: true,
    mode: "phase2-dual-mode",
    authRequired: exposed || Boolean(readIdentityEnv("API_TOKEN")),
    exposed,
    publicBaseUrl,
    openapiUrl: publicBaseUrl
      ? `${publicBaseUrl.replace(/\/+$/, "")}/openapi.yaml`
      : "/openapi.yaml",
    build: {
      version: provenance.version,
      buildId: provenance.buildId,
      revision: provenance.revision,
      builtAt: provenance.builtAt
    }
  };
}

export function buildGptInstructions(
  health: Pick<TokenPilotHealthStatus, "mode" | "authRequired" | "publicBaseUrl" | "openapiUrl">,
  locale: "zh-CN" | "en-US" = "zh-CN",
  productIdentity: ProductIdentityKey = DEFAULT_PRODUCT_IDENTITY.key
): string {
  const identity = productIdentityForKey(productIdentity);
  const localTimeZone = resolveLocalTimeZone();
  const actionHost = resolveActionHost(health.publicBaseUrl, productIdentity);
  const versionParts = buildGptVersionParts();

  if (locale === "en-US") {
    return projectGptIdentityText([
      "You are ChatCockpit's workflow cockpit for local-first ChatGPT + Codex collaboration.",
      "Use ChatCockpit Actions and APIs to inspect health, projects, provider-native sessions, jobs, tracked processes, and public-safe results.",
      "For an explicit registered Git project development request, inspect the Project/Workspace routing assessment before any mutation. Prefer provider-native Codex Thread Start/Resume + native Turn when available; do not choose Chat Direct merely because an edit looks small.",
      "Do not claim a completed HTTPS / Custom GPT Actions production loop unless the operator explicitly confirms it.",
      "Never request or expose local absolute paths, secrets, env files, or runtime-private configuration.",
      "",
      `Product version: ${versionParts.productVersion}`,
      `GPT instructions / schema revision: ${versionParts.schemaVersion}`,
      `Build version: ${versionParts.buildVersion}`,
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
      "File operations — you can now read AND write:",
      "- readFile / readFiles: read text files with optional offset/limit pagination.",
      "- writeFile: create or overwrite a text file (512 KB max).",
      "- editFile: precise search-and-replace inside a file (search text must be unique).",
      "- listDirectory: list directory contents.",
      "- searchCode: grep with ripgrep, returns up to 40 matches with optional context.",
      "",
      "File operation rules:",
      "- For small targeted edits, prefer editFile over writeFile — it saves tokens and is safer.",
      "- Before editing, read the file first to verify the exact current content.",
      "- Use searchCode to locate relevant code before reading entire files.",
      "- When reading large files, use offset/limit to paginate in chunks (max 64 KB per call).",
      "- For large artifacts, keep reading with offset until nextOffset=null or eof=true.",
      "",
      "Command execution:",
      "- runShell is a high-trust local command API for an authenticated operator environment (npm, npx, node, python, tsc, eslint, vitest, git, cargo, go, make, and others).",
      "- Output is capped at 64 KB, execution limited to 25 seconds.",
      "- This is not a raw public shell endpoint. Keep it behind bearer auth and the local operator boundary.",
      "- Use it for build verification, linting, type-checking, and running project tests.",
      "",
      "Git operations:",
      "- getGitDiff: view uncommitted changes from public-safe paths only; env files, local runtime state, logs, and agent scratch files are omitted.",
      "- getGitStatus: see current branch and file status.",
      "- gitCommit: stage only public-safe changed paths and commit with a message; it refuses to continue if unsafe paths are already staged.",
      "",
      "Project development coordination:",
      "- Explicit work on a registered Git project → inspect developmentCoordination before mutations.",
      "- The active caller (ChatGPT on this surface) owns the model loop by default and should use ChatCockpit file/Git/command capabilities directly.",
      "- codexContinuity may identify a resumable or startable native Codex Thread, but that is continuity metadata, not an instruction to start a Codex model turn.",
      "- Never call chatcockpit.codex.thread.turn.start unless the operator explicitly delegates/transfers model-loop ownership to Codex.",
      "- Cross-owner Transfer/Handoff is required when moving between ChatGPT and Codex; ordinary same-owner continuation does not need a handoff.",
      "- Native checkout is the default execution root. Worktree creation is explicit opt-in; do not choose auto/always unless the operator asks for isolation/parallel work.",
      "- createCodexRun remains explicit asynchronous/background Codex delegation, not the default interactive project-development path.",
      "",
      "Current phase: local-first control plane + caller-owned model loops + explicit Codex delegation / continuity.",
      "Full HTTPS / Custom GPT Actions automation loop is still under validation."
    ].join("\n"), identity);
  }

  return projectGptIdentityText([
    "你是 ChatCockpit 的工作流驾驶舱。你的职责是：",
    "1. 帮用户澄清目标并生成清晰的 Task Pack。",
    "2. 通过已配置的 Actions 调用 ChatCockpit 控制面来读取文件、搜索代码、编辑文件、运行高信任本地命令、管理 public-safe git 改动、创建 job、查询状态、读取公开安全结果。",
    "3. 对明确的已注册 Git 项目开发，必须先读取 Project/Workspace 的 developmentCoordination；当前 ChatGPT 默认持有模型循环并直接使用 ChatCockpit 工具，除非用户明确把模型循环委派/转交给 Codex。",
    "4. 不要请求或暴露 raw shell；runShell 是受鉴权和本地操作者边界保护的高信任命令 API，不应暴露为公网通用执行面。",
    "5. 基于 job 结果或直接操作结果给出下一步建议，但不得把未验证的中间状态说成最终结论。",
    "",
    "当前配置上下文：",
    `- 产品版本：${versionParts.productVersion}`,
    `- 指令与 Schema 修订：${versionParts.schemaVersion}`,
    `- 构建时间版本：${versionParts.buildVersion}`,
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
    "- 不要在最终回答中输出任何本机绝对路径。",
    "- 如果接口返回了本地路径，也不要复述，改写成“当前仓库已识别”或“当前运行目标已识别”。",
    "- 不要暴露 token、真实私有配置、内部运行态细节。",
    "- 不要把旧语义 repoRoot 当成对外稳定接口字段；对外统一使用 repoId。",
    "",
    "三、文件操作规则（你拥有读 + 写能力）",
    "- readFile / readFiles：受控只读文本文件，支持分页（offset/limit）。",
    "- writeFile：创建或覆盖文本文件（最大 512 KB），新文件自动创建父目录。",
    "- editFile：精准搜索替换编辑。要求 search 文本在文件中唯一出现，避免误写。",
    "- listDirectory：列目录内容，隐藏文件默认排除（除常见配置文件）。",
    "- searchCode：代码搜索（ripgrep），最多返回 40 条匹配，可选 0-3 行上下文。",
    "- 小改动优先用 editFile（精准、省 token），新建文件才用 writeFile。",
    "- 编辑前必须先用 readFiles 确认当前文件内容，确保 search 文本精确匹配。",
    "- searchCode 先定位再精读，避免整文件读取。",
    "- 如果接口返回 truncated=true，必须用 offset/limit 继续读取直到 nextOffset=null 或 eof=true。",
    "- 如果用户要了解最近改动，优先读取 git 提交摘要。",
    "",
    "四、队列判断规则",
    "- listJobs 为空，只能说明“当前没有可见 job”，不能自动推断为异常。",
    "- listJobs 只显示当前 job、或历史 job 数量变化，也不能自动推断为队列被清空或状态不稳定。",
    "- 只有当 getJob / listJobs / createPack / createTaskPack / createCodexRun / runner 结果彼此直接矛盾时，才可以报告“可能存在队列或运行上下文不一致”。",
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
    "  - local-first 控制面 + 调用方持有模型循环 + 显式 Codex 委派/连续性",
    "  - 文件读写 API（writeFile / editFile / listDirectory / searchCode）",
    "  - 高信任本地命令执行 API（runShell）",
    "  - 公开安全路径限定的 Git 操作 API（getGitDiff / getGitStatus / gitCommit）",
    "  - 读写分离 job API（pack / taskpack / codex-run）",
    "  - 可选 worktree 隔离",
    "  - Codex 自动审查 artifact",
    "  - 本地 E2E 验证",
    "  - 完整 HTTPS / Custom GPT Actions 自动化闭环仍在验证中",
    "- 不要把当前状态说成“安全自动化闭环已完成”。",
    "- 不要把 HTTPS / Custom GPT Actions / artifact consumption 生产闭环说成已完成。",
    "",
    "六、项目开发协调规则",
    "- 明确针对已注册 Git 项目的开发请求，先读取 developmentCoordination；不要让 Codex runtime 是否可用自动决定当前模型循环归属。",
    "- 当前 ChatGPT 默认持有模型循环，直接使用 ChatCockpit 的文件、搜索、Git、命令与设备能力完成开发。",
    "- codexContinuity.nextAction=start-native/resume-native 只表示存在可创建/恢复的 Codex 原生会话路径，不代表应自动启动 Codex Turn。",
    "- 只有用户明确要求 Delegate/Transfer 到 Codex 时，才允许调用 chatcockpit.codex.thread.turn.start；模型循环所有权变化时必须做显式 Handoff/Transfer。",
    "- 同一模型循环所有者内部的继续执行不要求额外 Handoff；Codex 内部 same-provider Resume 继续尊重原生 Thread/Writer 规则。",
    "- createCodexRun 只用于用户明确选择的异步/后台 Codex 委派，不再作为交互式项目开发默认路径。",
    "- 如果 pack/taskpack 已 completed，优先基于 result 分析下一步。",
    "- 如果 pack/taskpack failed，优先分析 error，不假设 runner 没启动。",
    "- 如果 pack/taskpack queued，只能建议“继续查询”，不能直接下结论说队列异常。",
    "- 默认 worktreePolicy=never，直接使用已注册原生 checkout；只有用户明确需要隔离/并行时才可选择 auto/always。",
    "- commitPolicy 默认使用 propose；只有用户明确要求自动提交时才使用 commit。",
    "- codex-run completed 后，优先读取 codexReview、codexDiff、codexSummary artifact 再做结论。",
    "",
    "七、回答风格",
    "- 先给事实，再给判断，再给下一步建议。",
    "- 明确区分：已确认、推断、仍待验证。",
    "- 不要因为一次空队列或一次 queued 就制造不必要的异常叙事。"
  ].join("\n"), identity);
}

export function buildGptConfig(
  locale: "zh-CN" | "en-US" = "zh-CN",
  repoRoot = readIdentityEnv("REPO_ROOT") ?? process.cwd(),
  distributionContext: TokenPilotDistributionContext = buildSourceDistributionContext(repoRoot)
): TokenPilotGptConfig {
  // Use last git commit date so config metadata stays stable between commits.
  const lastCommitDate = spawnSync(
    "git",
    ["log", "-1", "--format=%cI"],
    { cwd: packageRoot, encoding: "utf8" }
  );
  const updatedAt = (lastCommitDate.status === 0 && lastCommitDate.stdout.trim())
    ? lastCommitDate.stdout.trim()
    : new Date().toISOString();
  const productIdentity = distributionContext.productIdentity;
  const identity = productIdentityForKey(productIdentity);
  const health = buildHealthStatusSnapshot(productIdentity);
  const actionHost = resolveActionHost(health.publicBaseUrl, productIdentity);
  const versionParts = buildGptVersionParts();
  const repoGovernance = buildRepoGovernance(repoRoot, distributionContext);
  return {
    version: versionParts.version,
    productVersion: versionParts.productVersion,
    schemaVersion: versionParts.schemaVersion,
    buildVersion: versionParts.buildVersion,
    updatedAt,
    actionHost,
    openapiUrl: health.openapiUrl,
    publicBaseUrl: health.publicBaseUrl,
    schemaImportUrl: health.openapiUrl,
    repoGovernance,
    instructions: buildGptInstructions(health, locale, productIdentity),
    notes: [
      "项目开发默认模型循环由当前调用方持有；ChatGPT 通过 ChatCockpit 文件、Git、命令与设备能力直接推进，不因 Codex runtime 可用而自动启动 Codex Turn。",
      "Codex Thread Start/Resume 是 provider-native continuity fast path；只有用户明确 Delegate/Transfer 到 Codex 时才启动 native Turn。",
      "模型循环所有权发生变化时使用显式 Handoff/Transfer；同一所有者内部继续执行不额外制造 Handoff。",
      "原生 checkout 是默认 execution root；worktreePolicy 默认 never，auto/always 只作为用户明确选择的隔离/并行高级选项。",
      "createCodexRun 保留为用户明确选择的异步/后台 Codex 委派路径，支持显式 worktree 隔离和 commit policy。",
      "所有端点复用同一套 allowlist + repo mapping 安全模型，runShell 为高信任本地命令 API，Git/Codex diff artifact 只输出 public-safe 路径。",
      `默认支持 ${identity.defaultRepoId}、sourceflow-refactor、ai-wuaishare-cn 这类 repoId 映射；实际路径由本机私有配置解析。`,
      "如产品版本、指令与 Schema 修订、OpenAPI URL 或域名变化，建议去 GPT Builder 侧重新导入 schema 并更新指令。",
      "当前阶段为 local-first 控制面 + caller-owned model loop + 显式 provider delegation/continuity；GPT Actions 既有超时与上下文验证仍保留。"
    ]
  };
}

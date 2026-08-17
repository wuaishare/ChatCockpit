import type { JobProcessState, JobStatus, JobType } from "./types";
import {
  enUSContinuityCopy,
  zhCNContinuityCopy,
  type ContinuityCopy
} from "./i18n/continuity";

export type LocaleCode = "zh-CN" | "en-US";

export const LOCALE_STORAGE_KEY = "chatcockpit:web:locale";
const LEGACY_LOCALE_STORAGE_KEY = "tokenpilot:web:locale";

function isLocaleCode(value: string | null): value is LocaleCode {
  return value === "zh-CN" || value === "en-US";
}

function safeStorageGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Browser privacy/storage policy may reject persistence; runtime locale still works.
  }
}

function safeStorageRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore unavailable storage during receive-only migration cleanup.
  }
}

function isSimplifiedChineseLanguage(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  return normalized === "zh" ||
    normalized === "zh-cn" ||
    normalized === "zh-sg" ||
    normalized.startsWith("zh-hans-") ||
    normalized === "zh-hans";
}

export function detectBrowserLocale(languages: readonly string[]): LocaleCode {
  return languages.some(isSimplifiedChineseLanguage) ? "zh-CN" : "en-US";
}

export function getStoredLocale(): LocaleCode {
  if (typeof window === "undefined") {
    return "en-US";
  }

  const persistent = safeStorageGet(window.localStorage, LOCALE_STORAGE_KEY);
  if (isLocaleCode(persistent)) {
    safeStorageRemove(window.localStorage, LEGACY_LOCALE_STORAGE_KEY);
    safeStorageRemove(window.sessionStorage, LEGACY_LOCALE_STORAGE_KEY);
    safeStorageRemove(window.sessionStorage, LOCALE_STORAGE_KEY);
    return persistent;
  }

  const migrationCandidates = [
    safeStorageGet(window.localStorage, LEGACY_LOCALE_STORAGE_KEY),
    safeStorageGet(window.sessionStorage, LOCALE_STORAGE_KEY),
    safeStorageGet(window.sessionStorage, LEGACY_LOCALE_STORAGE_KEY)
  ];
  const migrated = migrationCandidates.find(isLocaleCode);
  if (migrated) {
    safeStorageSet(window.localStorage, LOCALE_STORAGE_KEY, migrated);
    safeStorageRemove(window.localStorage, LEGACY_LOCALE_STORAGE_KEY);
    safeStorageRemove(window.sessionStorage, LOCALE_STORAGE_KEY);
    safeStorageRemove(window.sessionStorage, LEGACY_LOCALE_STORAGE_KEY);
    return migrated;
  }

  const browserLanguages = window.navigator.languages.length
    ? window.navigator.languages
    : [window.navigator.language];
  return detectBrowserLocale(browserLanguages);
}

export function persistLocale(locale: LocaleCode): void {
  safeStorageSet(window.localStorage, LOCALE_STORAGE_KEY, locale);
  safeStorageRemove(window.localStorage, LEGACY_LOCALE_STORAGE_KEY);
  safeStorageRemove(window.sessionStorage, LOCALE_STORAGE_KEY);
  safeStorageRemove(window.sessionStorage, LEGACY_LOCALE_STORAGE_KEY);
}

export const localeOptions: Array<{ label: string; value: LocaleCode }> = [
  { label: "简体中文", value: "zh-CN" },
  { label: "English", value: "en-US" }
];

export interface UiCopy {
  pageTitle: string;
  header: {
    title: string;
    refresh: string;
    refreshTooltip: string;
    dashboard: string;
    continuity: string;
    resources: string;
    jobs: string;
    integrations: string;
    appearanceStatus: string;
    themeModeLabel: string;
    darkDeck: string;
    lightDeck: string;
  };
  common: {
    retry: string;
    refresh: string;
    inspect: string;
    save: string;
    clear: string;
    none: string;
    notAvailable: string;
    tokenMissing: string;
    hiddenSuspiciousPath: string;
  };
  status: {
    healthOk: string;
    healthBad: string;
    authRequired: string;
    authOpen: string;
    yes: string;
    no: string;
    queued: string;
    running: string;
    paused: string;
    terminated: string;
    completed: string;
    failed: string;
  };
  type: Record<JobType, string>;
  notices: {
    loadingConsoleTitle: string;
    loadingConsoleDescription: string;
    bootstrapFailedTitle: string;
  };
  operatorAuth: {
    loadingTitle: string;
    loadingDescription: string;
    setupTitle: string;
    setupDescription: string;
    setupAppAction: string;
    setupCommandLabel: string;
    setupCommand: string;
    setupRefresh: string;
    setupStillRequired: string;
    setupCheckFailed: string;
    loginTitle: string;
    loginDescription: string;
    username: string;
    password: string;
    usePasskey: string;
    usingPasskey: string;
    passwordFallback: string;
    passkeyUnavailable: string;
    passkeyOriginUnsupported: string;
    passkeyNotConfigured: string;
    signIn: string;
    signingIn: string;
    signOut: string;
    signedInAs: string;
    security: string;
    passkeysTitle: string;
    passkeysDescription: string;
    passkeysEmpty: string;
    addPasskey: string;
    addingPasskey: string;
    removePasskey: string;
    passkeyLabel: string;
    passkeyDefaultLabel: string;
    passkeyBackedUp: string;
    passkeyDeviceOnly: string;
    passkeyLastUsed: string;
    passkeyNeverUsed: string;
    passkeyAdded: string;
    passkeyRemoved: string;
    sessionExpired: string;
    localUnlockFailed: string;
  };
  dashboard: {
    boundaryTitle: string;
    boundaryDescription: string;
    healthCard: string;
    modeCard: string;
    authCard: string;
    completedCard: string;
    summaryTitle: string;
    summaryDescription: string;
    healthLabel: string;
    authRequiredLabel: string;
    exposedLabel: string;
    openapiLabel: string;
    publicBaseUrlLabel: string;
    distributionTitle: string;
    distributionDescription: string;
    distributionEmptyHint: string;
    emptyStateTitle: string;
    emptyStateDescription: string;
    protectedStateTitle: string;
    protectedStateDescription: string;
    queued: string;
    running: string;
    failed: string;
    total: string;
    completionRatio: string;
    recentJobsTitle: string;
    recentJobsDescription: string;
    recentJobsEmptyHint: string;
    openIntegrations: string;
    quickActionsTitle: string;
    quickActionToken: string;
    quickActionIntegrations: string;
    quickActionRefresh: string;
    recentJobUpdatedPrefix: string;
    gptPreviewTitle: string;
    gptPreviewDescription: string;
    gptPreviewCompact: string;
    repoGovernanceTitle: string;
    repoGovernanceDescription: string;
    repoGovernanceConfigScope: string;
    repoGovernancePathHidden: string;
    repoGovernanceDefaultLabel: string;
    repoGovernanceMissingHint: string;
    repoGovernanceBlockedHint: string;
    repoCapabilityPack: string;
    repoCapabilityFilesRead: string;
    repoCapabilityCodexRun: string;
    repoSourceDefault: string;
    repoSourceDefaultSibling: string;
    repoSourceLocalConfig: string;
  };
  continuity: ContinuityCopy;
  setup: {
    title: string;
    description: string;
    readyTag: string;
    pendingTag: string;
    openIntegrations: string;
    refresh: string;
    steps: Record<
      "runtime" | "auth" | "oauth" | "repo" | "runner" | "gpt" | "firstTask",
      { label: string; detailReady: string; detailPending: string; nextReady: string; nextPending: string }
    >;
  };
  jobs: {
    sectionTitle: string;
    authRequiredTitle: string;
    authRequiredSectionDescription: string;
    authRequiredDescription: string;
    authRequiredBody: string;
    authRequiredNextLabel: string;
    authRequiredNextValue: string;
    authRequiredScopeLabel: string;
    authRequiredScopeValue: string;
    authRequiredSessionLabel: string;
    authRequiredSessionValue: string;
    authRequiredStatusLabel: string;
    loadingTitle: string;
    loadingDescription: string;
    requestFailedTitle: string;
    emptyTitle: string;
    emptyDescription: string;
    queueTitle: string;
    queueDescription: string;
    detailTitle: string;
    detailDescription: string;
    detailRefreshing: string;
    noSelectionTitle: string;
    noSelectionDescription: string;
    columnHeadline: string;
    columnType: string;
    columnStatus: string;
    columnUpdated: string;
    rowType: string;
    rowStatus: string;
    rowCreated: string;
    rowUpdated: string;
    rowProcessState: string;
    rowProcessUpdated: string;
    rowHeadline: string;
    rowRepo: string;
    rowPromptPath: string;
    rowSummaryPath: string;
    rowRepomixPath: string;
    rowManifestPath: string;
    rowMarkdownPath: string;
    rowJsonPath: string;
    rowError: string;
    rowArtifacts: string;
    rowIncludeEntries: string;
    rowArtifactPreview: string;
    artifactLoadMore: string;
    controlTitle: string;
    controlDescription: string;
    controlPause: string;
    controlResume: string;
    controlTerminate: string;
    controlTerminateAll: string;
    controlTerminateAllComplete: string;
  };
  gpt: {
    boundaryTitle: string;
    boundaryDescription: string;
    protectedTitle: string;
    protectedDescription: string;
    snapshotTitle: string;
    snapshotDescription: string;
    versionLabel: string;
    productVersionLabel: string;
    schemaVersionLabel: string;
    buildVersionLabel: string;
    updatedAtLabel: string;
    modeLabel: string;
    authRequiredLabel: string;
    openapiLabel: string;
    publicBaseUrlLabel: string;
    actionHostLabel: string;
    schemaImportUrlLabel: string;
    copyTitle: string;
    copyDescription: string;
    copyInstructionsAction: string;
    copyOpenapiAction: string;
    copySchemaAction: string;
    copySummaryAction: string;
    quickCopyTitle: string;
    importHintTitle: string;
    importHintBody: string;
    updateTitle: string;
    fallbackNote: string;
    protectedFallbackNote: string;
    notesTitle: string;
    notesDescription: string;
    tokenNote: string;
    checklist: string[];
  };
}

const zhCN: UiCopy = {
  pageTitle: "ChatCockpit 控制台",
  header: {
    title: "ChatCockpit 控制台",
    refresh: "刷新",
    refreshTooltip: "刷新健康状态与任务数据",
    dashboard: "总览",
    continuity: "连续性",
    resources: "资源中心",
    jobs: "任务",
    integrations: "集成",
    appearanceStatus: "当前界面外观",
    themeModeLabel: "颜色模式",
    darkDeck: "深色驾驶舱",
    lightDeck: "浅色驾驶舱"
  },
  common: {
    retry: "重试",
    refresh: "刷新",
    inspect: "查看",
    save: "保存",
    clear: "清除",
    none: "无",
    notAvailable: "未提供",
    tokenMissing: "未设置",
    hiddenSuspiciousPath: "[已隐藏敏感路径]"
  },
  status: {
    healthOk: "正常",
    healthBad: "异常",
    authRequired: "需要",
    authOpen: "开放",
    yes: "是",
    no: "否",
    queued: "排队中",
    running: "运行中",
    paused: "已暂停",
    terminated: "已终止",
    completed: "已完成",
    failed: "已失败"
  },
  type: {
    pack: "打包",
    taskpack: "任务包",
    "codex-run": "Codex 执行"
  },
  notices: {
    loadingConsoleTitle: "正在加载 ChatCockpit 控制台",
    loadingConsoleDescription: "正在读取健康状态与 OpenAPI 元数据。",
    bootstrapFailedTitle: "控制台初始化失败"
  },
  operatorAuth: {
    loadingTitle: "正在检查操作员会话",
    loadingDescription: "正在确认此浏览器是否已登录 ChatCockpit。",
    setupTitle: "请先创建 Web 操作员账户",
    setupDescription: "Web 控制台使用独立的控制台管理员账户，浏览器无需接触机器 API 密钥。首次凭据必须在 ChatCockpit 所在机器本地创建。",
    setupAppAction: "在 ChatCockpit App 中设置",
    setupCommandLabel: "也可以在本机终端执行",
    setupCommand: "chatcockpit operator set-password",
    setupRefresh: "我已设置，重新检查",
    setupStillRequired: "仍未检测到控制台管理员账户。请在 ChatCockpit App 中查看或重设自动生成的管理员凭据，然后再检查。",
    setupCheckFailed: "重新检查失败，请确认本机 ChatCockpit 服务仍在运行后重试。",
    loginTitle: "登录 ChatCockpit",
    loginDescription: "使用控制台管理员账户进入控制台。机器 API Token 与 ChatGPT OAuth 凭据都不是网页登录密码。",
    username: "用户名",
    password: "密码",
    usePasskey: "使用通用密钥",
    usingPasskey: "正在验证通用密钥…",
    passwordFallback: "或使用密码备用登录",
    passkeyUnavailable: "当前浏览器或系统不支持 WebAuthn 通用密钥，请使用密码登录。",
    passkeyOriginUnsupported: "通用密钥只支持公网 HTTPS 域名或 localhost。本机 127.0.0.1 入口请直接使用 ChatCockpit App 的免密解锁。",
    passkeyNotConfigured: "此访问地址尚未配置通用密钥，请先使用密码登录后添加。",
    signIn: "密码登录",
    signingIn: "正在登录…",
    signOut: "退出登录",
    signedInAs: "已登录",
    security: "安全",
    passkeysTitle: "通用密钥",
    passkeysDescription: "通用密钥通过 Touch ID、设备密码或安全密钥完成抗钓鱼登录。ChatCockpit 只保存公钥与验证元数据，私钥始终留在你的设备或密码管理器中。",
    passkeysEmpty: "当前没有已注册的通用密钥。添加后，登录时可优先使用通用密钥而无需输入密码。",
    addPasskey: "添加通用密钥",
    addingPasskey: "正在添加…",
    removePasskey: "移除",
    passkeyLabel: "名称",
    passkeyDefaultLabel: "我的通用密钥",
    passkeyBackedUp: "已同步/备份",
    passkeyDeviceOnly: "仅此设备",
    passkeyLastUsed: "最近使用",
    passkeyNeverUsed: "尚未使用",
    passkeyAdded: "通用密钥已添加。",
    passkeyRemoved: "通用密钥已移除。",
    sessionExpired: "会话已过期，请重新登录。",
    localUnlockFailed: "本机免密登录链接已失效，请从 ChatCockpit App 重新打开本机控制台。"
  },
  dashboard: {
    boundaryTitle: "当前阶段边界",
    boundaryDescription:
      "当前为本地优先 Web UI MVP，支持状态查看与受控任务进程控制。完整 HTTPS / Custom GPT Actions 自动化闭环仍在验证中。",
    healthCard: "健康状态",
    modeCard: "运行模式",
    authCard: "鉴权状态",
    completedCard: "已完成任务",
    summaryTitle: "控制面摘要",
    summaryDescription: "当前运行态概览。",
    healthLabel: "健康状态",
    authRequiredLabel: "需要鉴权",
    exposedLabel: "已暴露",
    openapiLabel: "OpenAPI 地址",
    publicBaseUrlLabel: "公网基址",
    distributionTitle: "任务分布",
    distributionDescription: "当前队列概览。",
    distributionEmptyHint: "当前没有排队、运行或失败任务。",
    emptyStateTitle: "当前本地队列为空",
    emptyStateDescription: "可以先前往“集成”完成 ChatGPT App / MCP 接入，或在接入后刷新当前状态。",
    protectedStateTitle: "任务数据受保护",
    protectedStateDescription: "当前接口需要控制台管理员会话；请重新登录后读取真实队列状态。",
    queued: "排队",
    running: "运行中",
    failed: "失败",
    total: "总数",
    completionRatio: "完成率",
    recentJobsTitle: "最近任务",
    recentJobsDescription: "最近的队列活动。",
    recentJobsEmptyHint: "当前本地队列为空，可先前往“集成”完成 ChatGPT App / MCP 接入。",
    openIntegrations: "前往集成",
    quickActionsTitle: "下一步",
    quickActionToken: "检查操作员会话",
    quickActionIntegrations: "查看集成",
    quickActionRefresh: "刷新当前状态",
    recentJobUpdatedPrefix: "最近更新于",
    gptPreviewTitle: "Custom GPT Actions 兼容预览",
    gptPreviewDescription: "仅用于兼容旧版 Actions 工作流的可复制指引。",
    gptPreviewCompact: "包含模式、鉴权、OpenAPI 地址与 API 基址；新连接优先使用 ChatGPT App / MCP。",
    repoGovernanceTitle: "Repo 治理",
    repoGovernanceDescription: "当前允许 GPT Actions 与本地 Codex 协同使用的公开 repoId；本机路径只在私有配置中解析。",
    repoGovernanceConfigScope:
      "配置来源：本机私有 ChatCockpit 配置（默认 ~/.chatcockpit/config.json，可用 CHATCOCKPIT_CONFIG_PATH 覆盖）",
    repoGovernancePathHidden: "路径已隐藏",
    repoGovernanceDefaultLabel: "默认",
    repoGovernanceMissingHint: "未发现对应仓库目录，当前不可执行。",
    repoGovernanceBlockedHint: "已配置路径但未进入 allowlist，请检查本机私有配置。",
    repoCapabilityPack: "打包",
    repoCapabilityFilesRead: "只读文件",
    repoCapabilityCodexRun: "Codex 执行",
    repoSourceDefault: "默认仓库",
    repoSourceDefaultSibling: "默认相邻仓库",
    repoSourceLocalConfig: "本机配置"
  },
  continuity: zhCNContinuityCopy,
  setup: {
    title: "首次设置",
    description: "按顺序确认本地运行态、鉴权、仓库、Runner、GPT 接入和首个安全任务。",
    readyTag: "已就绪",
    pendingTag: "待处理",
    openIntegrations: "打开集成",
    refresh: "刷新设置状态",
    steps: {
      runtime: {
        label: "本地运行态",
        detailReady: "本地运行态配置已存在。",
        detailPending: "本地运行态配置尚未初始化。",
        nextReady: "继续下一步",
        nextPending: "运行 npm run init"
      },
      auth: {
        label: "机器 API（可选）",
        detailReady: "机器 API 令牌仅用于 CLI、自动化或其他机器客户端；控制台管理员会话与 ChatGPT OAuth 都不依赖它。",
        detailPending: "机器 API 令牌是可选能力，不会阻塞 Web 控制台或 ChatGPT OAuth。",
        nextReady: "按需配置或继续下一步",
        nextPending: "按需配置机器 API 权限"
      },
      oauth: {
        label: "ChatGPT MCP OAuth",
        detailReady: "OAuth 已就绪，或当前本地模式无需远程 OAuth。",
        detailPending: "ChatGPT Remote MCP OAuth 尚未满足公网地址、控制台管理员账户或持久化条件。",
        nextReady: "继续下一步",
        nextPending: "运行 npm run doctor 查看 OAuth readiness 原因"
      },
      repo: {
        label: "仓库授权",
        detailReady: "默认 repoId 可以在本地解析。",
        detailPending: "默认仓库根目录不可用。",
        nextReady: "继续下一步",
        nextPending: "检查 CHATCOCKPIT_REPO_ROOT"
      },
      runner: {
        label: "本地 Runner",
        detailReady: "Runner 已写入状态。",
        detailPending: "Runner 尚未上报状态。",
        nextReady: "继续下一步",
        nextPending: "运行 npm run start:local"
      },
      gpt: {
        label: "ChatGPT 集成",
        detailReady: "ChatGPT App / MCP 与兼容集成信息可用。",
        detailPending: "ChatGPT 集成信息尚未准备好。",
        nextReady: "打开“集成”查看连接状态",
        nextPending: "打开“集成”检查接入信息"
      },
      firstTask: {
        label: "首个安全任务",
        detailReady: "已经可以看到至少一个本地任务。",
        detailPending: "本地队列还没有任务记录。",
        nextReady: "查看任务详情",
        nextPending: "从 ChatGPT 发起一次安全 read/status 任务"
      }
    }
  },
  jobs: {
    sectionTitle: "任务",
    authRequiredTitle: "需要控制台管理员会话",
    authRequiredSectionDescription: "当前接口受保护。",
    authRequiredDescription: "当前接口受保护。请登录控制台管理员账户后查看任务队列与详情。",
    authRequiredBody: "请重新登录控制台管理员账户后查看任务队列与详情。",
    authRequiredNextLabel: "下一步",
    authRequiredNextValue: "返回登录页并重新建立操作员会话",
    authRequiredScopeLabel: "访问范围",
    authRequiredScopeValue: "任务队列与详情",
    authRequiredSessionLabel: "令牌作用域",
    authRequiredSessionValue: "仅当前浏览器会话",
    authRequiredStatusLabel: "当前状态",
    loadingTitle: "正在加载任务",
    loadingDescription: "正在获取当前队列与最近结果。",
    requestFailedTitle: "任务请求失败",
    emptyTitle: "暂无任务",
    emptyDescription: "当前本地队列为空。",
    queueTitle: "任务队列",
    queueDescription: "队列状态与任务控制入口。",
    detailTitle: "所选任务详情",
    detailDescription: "受保护的任务详情视图。",
    detailRefreshing: "正在刷新详情…",
    noSelectionTitle: "未选择任务",
    noSelectionDescription: "请从表格中选择一个任务查看脱敏详情。",
    columnHeadline: "摘要",
    columnType: "类型",
    columnStatus: "状态",
    columnUpdated: "更新时间",
    rowType: "类型",
    rowStatus: "状态",
    rowCreated: "创建时间",
    rowUpdated: "更新时间",
    rowProcessState: "进程状态",
    rowProcessUpdated: "进程更新时间",
    rowHeadline: "标题 / 摘要",
    rowRepo: "仓库标识",
    rowPromptPath: "提示词路径",
    rowSummaryPath: "摘要路径",
    rowRepomixPath: "Repomix XML 路径",
    rowManifestPath: "Manifest 路径",
    rowMarkdownPath: "Markdown 路径",
    rowJsonPath: "JSON 路径",
    rowError: "错误信息",
    rowArtifacts: "可见 artifacts",
    rowIncludeEntries: "公开 include 条目",
    rowArtifactPreview: "artifact 预览",
    artifactLoadMore: "继续加载",
    controlTitle: "任务控制",
    controlDescription: "对当前运行任务发出暂停、继续或终止信号。",
    controlPause: "暂停",
    controlResume: "继续",
    controlTerminate: "终止",
    controlTerminateAll: "终止所有运行任务",
    controlTerminateAllComplete: "已向所有已跟踪运行任务发送终止信号"
  },
  gpt: {
    boundaryTitle: "阶段边界提醒",
    boundaryDescription:
      "这里只用于 OpenAPI 接入辅助与操作说明，完整 HTTPS / Custom GPT Actions 自动化闭环仍在验证中。",
    protectedTitle: "GPT 配置接口受保护",
    protectedDescription: "当前没有有效的控制台管理员会话，界面只能显示公开回退摘要。",
    snapshotTitle: "GPT 接入概览",
    snapshotDescription: "当前机器侧接口面。",
    versionLabel: "显示版本",
    productVersionLabel: "产品版本",
    schemaVersionLabel: "指令与 Schema 修订",
    buildVersionLabel: "构建时间版本",
    updatedAtLabel: "更新时间",
    modeLabel: "模式",
    authRequiredLabel: "需要鉴权",
    openapiLabel: "OpenAPI 地址",
    publicBaseUrlLabel: "公网基址",
    actionHostLabel: "动作主机",
    schemaImportUrlLabel: "Schema 导入 URL",
    copyTitle: "推荐指令",
    copyDescription: "复制到 GPT 主说明框前，先确认产品版本、Schema 修订、导入地址与更新提醒。",
    copyInstructionsAction: "复制指令",
    copyOpenapiAction: "复制 OpenAPI URL",
    copySchemaAction: "复制导入 URL",
    copySummaryAction: "复制配置摘要",
    quickCopyTitle: "快速操作",
    importHintTitle: "Schema 导入地址",
    importHintBody: "在 GPT Builder 中可直接使用下面这条 URL 导入 Actions schema。",
    updateTitle: "版本更新提醒",
    fallbackNote: "当前回退到了本地拼装的说明文本，建议检查 GPT 配置接口是否可达。",
    protectedFallbackNote:
      "当前没有有效的控制台管理员会话，因此无法读取完整集成配置；重新登录后可查看指令、版本更新时间与机器侧备注。",
    notesTitle: "操作员备注",
    notesDescription: "面向鉴权模式下的人类操作员。",
    tokenNote:
      "机器 API Token 仅供 API/自动化客户端使用；Web 控制台使用独立的控制台管理员会话，浏览器不会读取或展示机器密钥。",
    checklist: [
      "操作员检查清单",
      "- 确认 /api/health 可访问。",
      "- 使用 /openapi.yaml 作为 schema 来源。",
      "- Web 控制台使用控制台管理员账户登录；不要把机器 API Token 当作网页登录凭据。",
      "- 将预期控制在本地优先操作员 MVP 范围内。",
      "- 不要把当前状态当作完整 HTTPS / Custom GPT Actions 生产闭环。"
    ]
  }
};

const enUS: UiCopy = {
  pageTitle: "ChatCockpit Operator Console",
  header: {
    title: "ChatCockpit Operator Console",
    refresh: "Refresh",
    refreshTooltip: "Refresh health and job data",
    dashboard: "Dashboard",
    continuity: "Continuity",
    resources: "Resources",
    jobs: "Jobs",
    integrations: "Integrations",
    appearanceStatus: "Current interface appearance",
    themeModeLabel: "Color mode",
    darkDeck: "Dark deck",
    lightDeck: "Light deck"
  },
  common: {
    retry: "Retry",
    refresh: "Refresh",
    inspect: "Inspect",
    save: "Save",
    clear: "Clear",
    none: "None",
    notAvailable: "Not available",
    tokenMissing: "Not set",
    hiddenSuspiciousPath: "[hidden suspicious path]"
  },
  status: {
    healthOk: "Healthy",
    healthBad: "Unhealthy",
    authRequired: "Required",
    authOpen: "Open",
    yes: "Yes",
    no: "No",
    queued: "Queued",
    running: "Running",
    paused: "Paused",
    terminated: "Terminated",
    completed: "Completed",
    failed: "Failed"
  },
  type: {
    pack: "Pack",
    taskpack: "Task Pack",
    "codex-run": "Codex Run"
  },
  notices: {
    loadingConsoleTitle: "Loading ChatCockpit console",
    loadingConsoleDescription: "Reading health and OpenAPI metadata.",
    bootstrapFailedTitle: "Console bootstrap failed"
  },
  operatorAuth: {
    loadingTitle: "Checking Operator session",
    loadingDescription: "Confirming whether this browser is signed in to ChatCockpit.",
    setupTitle: "Create the Web Operator account first",
    setupDescription: "The Web Cockpit uses a dedicated Owner account so the browser never needs the machine API secret. Initial credentials must be created locally on the ChatCockpit host.",
    setupAppAction: "Set up in ChatCockpit App",
    setupCommandLabel: "Or run locally in a terminal",
    setupCommand: "chatcockpit operator set-password",
    setupRefresh: "Password set — check again",
    setupStillRequired: "No console administrator account is visible yet. Open the ChatCockpit App to review or reset the generated Owner credential, then check again.",
    setupCheckFailed: "The re-check failed. Confirm that the local ChatCockpit service is still running, then try again.",
    loginTitle: "Sign in to ChatCockpit",
    loginDescription: "Use the Web Owner account. The machine API token and ChatGPT OAuth credentials are not Web login passwords.",
    username: "Username",
    password: "Password",
    usePasskey: "Use Passkey",
    usingPasskey: "Verifying Passkey…",
    passwordFallback: "Or use password as a fallback",
    passkeyUnavailable: "This browser or operating system does not support WebAuthn Passkeys. Use the password fallback.",
    passkeyOriginUnsupported: "Passkeys require a public HTTPS domain or localhost. For the 127.0.0.1 local entrypoint, use passwordless unlock from the ChatCockpit App.",
    passkeyNotConfigured: "No Passkey is configured for this Web address yet. Sign in with the password fallback and add one first.",
    signIn: "Sign in with password",
    signingIn: "Signing in…",
    signOut: "Sign out",
    signedInAs: "Signed in",
    security: "Security",
    passkeysTitle: "Passkeys",
    passkeysDescription: "Passkeys use Touch ID, device unlock, or a security key for phishing-resistant sign-in. ChatCockpit stores only the public key and verification metadata; the private key stays on your device or password manager.",
    passkeysEmpty: "No Passkeys are registered yet. Add one to make Passkey the preferred sign-in method without typing a password.",
    addPasskey: "Add Passkey",
    addingPasskey: "Adding…",
    removePasskey: "Remove",
    passkeyLabel: "Name",
    passkeyDefaultLabel: "My Passkey",
    passkeyBackedUp: "Synced / backed up",
    passkeyDeviceOnly: "This device only",
    passkeyLastUsed: "Last used",
    passkeyNeverUsed: "Never used",
    passkeyAdded: "Passkey added.",
    passkeyRemoved: "Passkey removed.",
    sessionExpired: "Your session has expired. Sign in again.",
    localUnlockFailed: "The local passwordless sign-in link expired. Open Local Cockpit again from the ChatCockpit App."
  },
  dashboard: {
    boundaryTitle: "Phase-2 boundary",
    boundaryDescription:
      "Local-first Web UI MVP. Full HTTPS / Custom GPT Actions automation loop is still under validation.",
    healthCard: "Health",
    modeCard: "Mode",
    authCard: "Auth",
    completedCard: "Jobs Completed",
    summaryTitle: "Control Plane Summary",
    summaryDescription: "Operator-safe runtime status.",
    healthLabel: "Health",
    authRequiredLabel: "Auth Required",
    exposedLabel: "Exposed",
    openapiLabel: "OpenAPI URL",
    publicBaseUrlLabel: "Public Base URL",
    distributionTitle: "Job Distribution",
    distributionDescription: "Current queue mix.",
    distributionEmptyHint: "There are no queued, running, or failed jobs right now.",
    emptyStateTitle: "The local queue is currently empty",
    emptyStateDescription: "Open Integrations to connect ChatGPT App / MCP, or refresh again after connecting a workflow.",
    protectedStateTitle: "Job data is protected",
    protectedStateDescription: "A Web Owner session is required. Sign in again before reading the live queue state.",
    queued: "Queued",
    running: "Running",
    failed: "Failed",
    total: "Total",
    completionRatio: "Completion ratio",
    recentJobsTitle: "Recent Jobs",
    recentJobsDescription: "Latest queue activity.",
    recentJobsEmptyHint: "The local queue is empty. Open Integrations to connect ChatGPT App / MCP first.",
    openIntegrations: "Open Integrations",
    quickActionsTitle: "Next steps",
    quickActionToken: "Configure session token",
    quickActionIntegrations: "Open Integrations",
    quickActionRefresh: "Refresh status",
    recentJobUpdatedPrefix: "updated",
    gptPreviewTitle: "Custom GPT Actions compatibility preview",
    gptPreviewDescription: "Copy-safe guidance for legacy Actions workflows.",
    gptPreviewCompact: "Includes mode, auth, OpenAPI URL, and API base URL. Prefer ChatGPT App / MCP for new connections.",
    repoGovernanceTitle: "Repo Governance",
    repoGovernanceDescription: "Public repoIds currently available to GPT Actions and local Codex collaboration. Local paths resolve only inside private operator config.",
    repoGovernanceConfigScope:
      "Config source: local private ChatCockpit config (default ~/.chatcockpit/config.json, override with CHATCOCKPIT_CONFIG_PATH)",
    repoGovernancePathHidden: "Path hidden",
    repoGovernanceDefaultLabel: "Default",
    repoGovernanceMissingHint: "Repository directory was not found; execution is unavailable.",
    repoGovernanceBlockedHint: "A path is configured but not allowlisted. Check local private config.",
    repoCapabilityPack: "Pack",
    repoCapabilityFilesRead: "Files read",
    repoCapabilityCodexRun: "Codex run",
    repoSourceDefault: "Default repo",
    repoSourceDefaultSibling: "Default sibling repo",
    repoSourceLocalConfig: "Local config"
  },
  continuity: enUSContinuityCopy,
  setup: {
    title: "First-run setup",
    description: "Check local runtime, auth, repo, runner, GPT handoff, and the first safe task.",
    readyTag: "Ready",
    pendingTag: "Pending",
    openIntegrations: "Open Integrations",
    refresh: "Refresh setup",
    steps: {
      runtime: {
        label: "Local runtime",
        detailReady: "Local runtime config is present.",
        detailPending: "Local runtime config has not been initialized.",
        nextReady: "Continue",
        nextPending: "Run npm run init"
      },
      auth: {
        label: "Machine API (optional)",
        detailReady: "The machine API token is only for CLI, automation, or other machine clients; Web Owner sessions and ChatGPT OAuth do not depend on it.",
        detailPending: "Machine API authority is optional and does not block the Web Cockpit or ChatGPT OAuth.",
        nextReady: "Configure it if needed, or continue",
        nextPending: "Configure machine API authority only if needed"
      },
      oauth: {
        label: "ChatGPT MCP OAuth",
        detailReady: "OAuth is ready, or remote OAuth is not required in local-only mode.",
        detailPending: "Remote MCP OAuth is missing a valid public origin, Web Owner account, or writable runtime state.",
        nextReady: "Continue",
        nextPending: "Run npm run doctor for the OAuth readiness reason"
      },
      repo: {
        label: "Repository allowlist",
        detailReady: "The default repoId resolves locally.",
        detailPending: "The default repository root is unavailable.",
        nextReady: "Continue",
        nextPending: "Check CHATCOCKPIT_REPO_ROOT"
      },
      runner: {
        label: "Runner",
        detailReady: "Runner status is present.",
        detailPending: "Runner has not reported status yet.",
        nextReady: "Continue",
        nextPending: "Run npm run start:local"
      },
      gpt: {
        label: "ChatGPT integration",
        detailReady: "ChatGPT App / MCP and compatibility integration metadata are available.",
        detailPending: "ChatGPT integration metadata is not ready yet.",
        nextReady: "Open Integrations to inspect connection status",
        nextPending: "Open Integrations to inspect setup details"
      },
      firstTask: {
        label: "First safe task",
        detailReady: "At least one local job is visible.",
        detailPending: "No local job has been created yet.",
        nextReady: "Review job details",
        nextPending: "Run a safe read/status task from ChatGPT"
      }
    }
  },
  jobs: {
    sectionTitle: "Jobs",
    authRequiredTitle: "Web Owner session required",
    authRequiredSectionDescription: "Protected endpoints are enabled.",
    authRequiredDescription: "Protected endpoints are enabled. Sign in with the Web Owner account before viewing queue and detail data.",
    authRequiredBody: "Sign in with the Web Owner account before viewing queue and detail data.",
    authRequiredNextLabel: "Next step",
    authRequiredNextValue: "Return to the sign-in screen and establish a new Operator session",
    authRequiredScopeLabel: "Access scope",
    authRequiredScopeValue: "Queue and job detail",
    authRequiredSessionLabel: "Token scope",
    authRequiredSessionValue: "Current browser session only",
    authRequiredStatusLabel: "Current state",
    loadingTitle: "Loading jobs",
    loadingDescription: "Fetching current queue and recent results.",
    requestFailedTitle: "Jobs request failed",
    emptyTitle: "No jobs yet",
    emptyDescription: "The local queue is currently empty.",
    queueTitle: "Jobs Queue",
    queueDescription: "Queue status and job control entry points.",
    detailTitle: "Selected Job Detail",
    detailDescription: "Protected detail view from /api/jobs/:id.",
    detailRefreshing: "Refreshing detail…",
    noSelectionTitle: "No job selected",
    noSelectionDescription:
      "Choose a job from the table to inspect sanitized details.",
    columnHeadline: "Headline",
    columnType: "Type",
    columnStatus: "Status",
    columnUpdated: "Updated",
    rowType: "Type",
    rowStatus: "Status",
    rowCreated: "Created",
    rowUpdated: "Updated",
    rowProcessState: "Process state",
    rowProcessUpdated: "Process updated",
    rowHeadline: "Headline",
    rowRepo: "Repo",
    rowPromptPath: "Prompt path",
    rowSummaryPath: "Summary path",
    rowRepomixPath: "Repomix XML path",
    rowManifestPath: "Manifest path",
    rowMarkdownPath: "Markdown path",
    rowJsonPath: "JSON path",
    rowError: "Error",
    rowArtifacts: "Visible artifacts",
    rowIncludeEntries: "Public include entries",
    rowArtifactPreview: "Artifact preview",
    artifactLoadMore: "Load more",
    controlTitle: "Job Controls",
    controlDescription: "Send pause, resume, or terminate signals to the selected running job.",
    controlPause: "Pause",
    controlResume: "Resume",
    controlTerminate: "Terminate",
    controlTerminateAll: "Terminate all running jobs",
    controlTerminateAllComplete: "Terminate signals were sent to all tracked running jobs"
  },
  gpt: {
    boundaryTitle: "Phase-2 boundary reminder",
    boundaryDescription:
      "This helper is only for OpenAPI wiring and operator guidance. Full HTTPS / Custom GPT Actions automation is still under validation.",
    protectedTitle: "GPT config is protected",
    protectedDescription: "There is no valid Web Owner session, so the UI can only show the public fallback summary.",
    snapshotTitle: "GPT Integration Snapshot",
    snapshotDescription: "Current machine-facing surface.",
    versionLabel: "Display Version",
    productVersionLabel: "Product Version",
    schemaVersionLabel: "Instructions / Schema Revision",
    buildVersionLabel: "Build Version",
    updatedAtLabel: "Updated At",
    modeLabel: "Mode",
    authRequiredLabel: "Auth Required",
    openapiLabel: "OpenAPI URL",
    publicBaseUrlLabel: "Public Base URL",
    actionHostLabel: "Action Host",
    schemaImportUrlLabel: "Schema Import URL",
    copyTitle: "Recommended Instructions",
    copyDescription: "Confirm the product version, schema revision, import URL, and update notes before pasting this into the GPT instructions field.",
    copyInstructionsAction: "Copy Instructions",
    copyOpenapiAction: "Copy OpenAPI URL",
    copySchemaAction: "Copy Import URL",
    copySummaryAction: "Copy Config Summary",
    quickCopyTitle: "Quick Actions",
    importHintTitle: "Schema Import URL",
    importHintBody: "Use the URL below directly in GPT Builder to import the Actions schema.",
    updateTitle: "Version Update Reminder",
    fallbackNote: "The UI fell back to a locally assembled helper text. Check whether the GPT config endpoint is reachable.",
    protectedFallbackNote:
      "There is no valid Web Owner session, so the full integration configuration is unavailable. Sign in again to load instructions, update metadata, and machine-side notes.",
    notesTitle: "Operator Notes",
    notesDescription: "Compact reminders for human operators using auth-required mode.",
    tokenNote:
      "The machine API token is only for API/automation clients. The Web Cockpit uses a separate Owner session and never reads or displays the machine secret.",
    checklist: [
      "Operator checklist",
      "- Confirm /api/health is reachable.",
      "- Use /openapi.yaml as the schema source.",
      "- Use the Web Owner account for Cockpit access; keep machine API credentials out of browser storage.",
      "- Keep expectations within the local-first operator MVP scope.",
      "- Do not treat current status as a complete HTTPS / Custom GPT Actions production loop."
    ]
  }
};

export function getUiCopy(locale: LocaleCode): UiCopy {
  return locale === "zh-CN" ? zhCN : enUS;
}

export function getStatusLabel(locale: LocaleCode, status: JobStatus): string {
  const copy = getUiCopy(locale);
  return copy.status[status];
}

export function getProcessStatusLabel(
  locale: LocaleCode,
  status: JobProcessState
): string {
  const copy = getUiCopy(locale);
  return copy.status[status];
}

export function getTypeLabel(locale: LocaleCode, type: JobType): string {
  const copy = getUiCopy(locale);
  return copy.type[type];
}

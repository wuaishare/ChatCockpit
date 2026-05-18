import type { JobStatus, JobType } from "./types";

export type LocaleCode = "zh-CN" | "en-US";

export const LOCALE_STORAGE_KEY = "tokenpilot:web:locale";

export const localeOptions: Array<{ label: string; value: LocaleCode }> = [
  { label: "简体中文", value: "zh-CN" },
  { label: "English", value: "en-US" }
];

export interface UiCopy {
  pageTitle: string;
  header: {
    title: string;
    subtitle: string;
    refresh: string;
    refreshTooltip: string;
    dashboard: string;
    jobs: string;
    gptHelper: string;
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
    completed: string;
    failed: string;
  };
  type: Record<JobType, string>;
  notices: {
    loadingConsoleTitle: string;
    loadingConsoleDescription: string;
    bootstrapFailedTitle: string;
  };
  tokenBar: {
    title: string;
    authRequiredDescription: string;
    optionalDescription: string;
    authRequiredShort: string;
    optionalShort: string;
    expand: string;
    collapse: string;
    manage: string;
    placeholder: string;
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
    queued: string;
    running: string;
    failed: string;
    total: string;
    completionRatio: string;
    recentJobsTitle: string;
    recentJobsDescription: string;
    recentJobsEmptyHint: string;
    openGptHelper: string;
    quickActionsTitle: string;
    quickActionToken: string;
    quickActionGpt: string;
    quickActionRefresh: string;
    recentJobUpdatedPrefix: string;
    gptPreviewTitle: string;
    gptPreviewDescription: string;
    gptPreviewCompact: string;
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
    rowHeadline: string;
    rowError: string;
    rowArtifacts: string;
  };
  gpt: {
    boundaryTitle: string;
    boundaryDescription: string;
    snapshotTitle: string;
    snapshotDescription: string;
    modeLabel: string;
    authRequiredLabel: string;
    openapiLabel: string;
    publicBaseUrlLabel: string;
    copyTitle: string;
    copyDescription: string;
    notesTitle: string;
    notesDescription: string;
    tokenNote: string;
    checklist: string[];
  };
}

const zhCN: UiCopy = {
  pageTitle: "TokenPilot 控制台",
  header: {
    title: "TokenPilot 控制台",
    subtitle: "本地优先、只读工作流控制台。",
    refresh: "刷新",
    refreshTooltip: "刷新健康状态与任务数据",
    dashboard: "总览",
    jobs: "任务",
    gptHelper: "GPT 助手",
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
    completed: "已完成",
    failed: "已失败"
  },
  type: {
    pack: "打包",
    taskpack: "任务包"
  },
  notices: {
    loadingConsoleTitle: "正在加载 TokenPilot 控制台",
    loadingConsoleDescription: "正在读取健康状态与 OpenAPI 元数据。",
    bootstrapFailedTitle: "控制台初始化失败"
  },
  tokenBar: {
    title: "浏览器会话令牌",
    authRequiredDescription: "受保护接口需填写服务端 TOKENPILOT_API_TOKEN 的值。",
    optionalDescription: "当前模式可选，仅保存在 sessionStorage 中。",
    authRequiredShort: "填写 TOKENPILOT_API_TOKEN。",
    optionalShort: "当前模式可选，仅保存在当前会话。",
    expand: "设置令牌",
    collapse: "收起",
    manage: "管理令牌",
    placeholder: "输入访问令牌"
  },
  dashboard: {
    boundaryTitle: "当前阶段边界",
    boundaryDescription:
      "当前为本地优先的只读 Web UI MVP。完整 HTTPS / Custom GPT Actions 自动化闭环仍在验证中。",
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
    emptyStateDescription: "可以先复制 GPT 接入指引，或在接入后刷新当前状态。",
    queued: "排队",
    running: "运行中",
    failed: "失败",
    total: "总数",
    completionRatio: "完成率",
    recentJobsTitle: "最近任务",
    recentJobsDescription: "最近的队列活动。",
    recentJobsEmptyHint: "当前本地队列为空，可先前往 GPT 助手复制接入指引。",
    openGptHelper: "前往 GPT 助手",
    quickActionsTitle: "下一步",
    quickActionToken: "配置会话令牌",
    quickActionGpt: "查看 GPT 助手",
    quickActionRefresh: "刷新当前状态",
    recentJobUpdatedPrefix: "最近更新于",
    gptPreviewTitle: "GPT 助手预览",
    gptPreviewDescription: "可复制的操作员指引。",
    gptPreviewCompact: "包含模式、鉴权、OpenAPI 地址与 API 基址，可一键复制完整文本。"
  },
  jobs: {
    sectionTitle: "任务",
    authRequiredTitle: "需要浏览器会话令牌",
    authRequiredSectionDescription: "当前接口受保护。",
    authRequiredDescription: "当前接口受保护。请先在顶部输入 TOKENPILOT_API_TOKEN 的值，再查看任务队列与详情。",
    authRequiredBody: "请先在顶部输入 TOKENPILOT_API_TOKEN 的值，再查看任务队列与详情。",
    authRequiredNextLabel: "下一步",
    authRequiredNextValue: "先在上方令牌区输入 TOKENPILOT_API_TOKEN",
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
    queueDescription: "只读队列视图。",
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
    rowHeadline: "标题 / 摘要",
    rowError: "错误信息",
    rowArtifacts: "产物路径"
  },
  gpt: {
    boundaryTitle: "阶段边界提醒",
    boundaryDescription:
      "这里只用于 OpenAPI 接入辅助与操作说明，完整 HTTPS / Custom GPT Actions 自动化闭环仍在验证中。",
    snapshotTitle: "GPT 接入概览",
    snapshotDescription: "当前机器侧接口面。",
    modeLabel: "模式",
    authRequiredLabel: "需要鉴权",
    openapiLabel: "OpenAPI 地址",
    publicBaseUrlLabel: "公网基址",
    copyTitle: "可复制文本",
    copyDescription: "可用于操作说明或 GPT 配置的安全文本。",
    notesTitle: "操作员备注",
    notesDescription: "面向鉴权模式下的人类操作员。",
    tokenNote:
      "访问令牌来自服务端 TOKENPILOT_API_TOKEN，仅限当前浏览器会话输入，界面只做掩码展示。",
    checklist: [
      "操作员检查清单",
      "- 确认 /api/health 可访问。",
      "- 使用 /openapi.yaml 作为 schema 来源。",
      "- 如果需要鉴权，只在当前本地浏览器会话中提供访问令牌。",
      "- 将预期控制在本地优先只读 MVP 范围内。",
      "- 不要把当前状态当作完整 HTTPS / Custom GPT Actions 生产闭环。"
    ]
  }
};

const enUS: UiCopy = {
  pageTitle: "TokenPilot Operator Console",
  header: {
    title: "TokenPilot Operator Console",
    subtitle: "Local-first, read-only workflow console.",
    refresh: "Refresh",
    refreshTooltip: "Refresh health and job data",
    dashboard: "Dashboard",
    jobs: "Jobs",
    gptHelper: "GPT Helper",
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
    completed: "Completed",
    failed: "Failed"
  },
  type: {
    pack: "Pack",
    taskpack: "Task Pack"
  },
  notices: {
    loadingConsoleTitle: "Loading TokenPilot console",
    loadingConsoleDescription: "Reading health and OpenAPI metadata.",
    bootstrapFailedTitle: "Console bootstrap failed"
  },
  tokenBar: {
    title: "Browser Session Token",
    authRequiredDescription:
      "Protected endpoints require the value of TOKENPILOT_API_TOKEN.",
    optionalDescription: "Optional for current mode. Saved only in sessionStorage.",
    authRequiredShort: "Enter TOKENPILOT_API_TOKEN.",
    optionalShort: "Optional for current mode. Session-only storage.",
    expand: "Configure token",
    collapse: "Collapse",
    manage: "Manage token",
    placeholder: "Enter access token"
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
    emptyStateDescription: "Open GPT Helper for the integration instructions, or refresh again after connecting a workflow.",
    queued: "Queued",
    running: "Running",
    failed: "Failed",
    total: "Total",
    completionRatio: "Completion ratio",
    recentJobsTitle: "Recent Jobs",
    recentJobsDescription: "Latest queue activity.",
    recentJobsEmptyHint: "The local queue is empty. Open GPT Helper to copy the integration instructions first.",
    openGptHelper: "Open GPT Helper",
    quickActionsTitle: "Next steps",
    quickActionToken: "Configure session token",
    quickActionGpt: "Open GPT Helper",
    quickActionRefresh: "Refresh status",
    recentJobUpdatedPrefix: "updated",
    gptPreviewTitle: "GPT Helper Preview",
    gptPreviewDescription: "Copy-safe operator guidance.",
    gptPreviewCompact: "Includes mode, auth, OpenAPI URL, and API base URL with one-click copy for the full text."
  },
  jobs: {
    sectionTitle: "Jobs",
    authRequiredTitle: "Browser session token required",
    authRequiredSectionDescription: "Protected endpoints are enabled.",
    authRequiredDescription: "Protected endpoints are enabled. Enter TOKENPILOT_API_TOKEN above before viewing queue and detail data.",
    authRequiredBody: "Enter TOKENPILOT_API_TOKEN above before viewing queue and detail data.",
    authRequiredNextLabel: "Next step",
    authRequiredNextValue: "Enter TOKENPILOT_API_TOKEN in the token bar above",
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
    queueDescription: "Read-only queue view from /api/jobs.",
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
    rowHeadline: "Headline",
    rowError: "Error",
    rowArtifacts: "Artifact paths"
  },
  gpt: {
    boundaryTitle: "Phase-2 boundary reminder",
    boundaryDescription:
      "This helper is only for OpenAPI wiring and operator guidance. Full HTTPS / Custom GPT Actions automation is still under validation.",
    snapshotTitle: "GPT Integration Snapshot",
    snapshotDescription: "Current machine-facing surface.",
    modeLabel: "Mode",
    authRequiredLabel: "Auth Required",
    openapiLabel: "OpenAPI URL",
    publicBaseUrlLabel: "Public Base URL",
    copyTitle: "Copy Text",
    copyDescription: "Safe to copy into operator notes or setup prompts.",
    notesTitle: "Operator Notes",
    notesDescription: "Compact reminders for human operators using auth-required mode.",
    tokenNote:
      "Enter the TOKENPILOT_API_TOKEN value only in this browser session. The UI masks it for display.",
    checklist: [
      "Operator checklist",
      "- Confirm /api/health is reachable.",
      "- Use /openapi.yaml as the schema source.",
      "- If auth is required, provide the access token only in this local browser session.",
      "- Keep expectations within local-first read-only MVP scope.",
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

export function getTypeLabel(locale: LocaleCode, type: JobType): string {
  const copy = getUiCopy(locale);
  return copy.type[type];
}

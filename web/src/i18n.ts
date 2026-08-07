import type {
  ContinuitySectionKey,
  JobProcessState,
  JobStatus,
  JobType
} from "./types";

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
    refresh: string;
    refreshTooltip: string;
    dashboard: string;
    continuity: string;
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
    openGptHelper: string;
    quickActionsTitle: string;
    quickActionToken: string;
    quickActionGpt: string;
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
  continuity: {
    shellTitle: string;
    shellDescription: string;
    refresh: string;
    loadingTitle: string;
    loadingDescription: string;
    requestFailedTitle: string;
    protectedTitle: string;
    protectedDescription: string;
    sections: Record<
      ContinuitySectionKey,
      { label: string; title: string; description: string }
    >;
    projectCount: string;
    workspaceCount: string;
    readyWorkspaceCount: string;
    noProjectsTitle: string;
    noProjectsDescription: string;
    defaultWorkspace: string;
    workspaces: string;
    branch: string;
    headCommit: string;
    revision: string;
    dirty: string;
    clean: string;
    statusActive: string;
    statusReady: string;
    statusMissing: string;
    statusBlocked: string;
    statusArchived: string;
    collectionUnavailableTitle: string;
    collectionUnavailableDescription: string;
    detailReadsAvailable: string;
    noFakeData: string;
    workspaceSelector: string;
    writerTitle: string;
    activeWriter: string;
    noActiveWriter: string;
    writerReadOnlyNotice: string;
    writerAvailableNotice: string;
    writerSession: string;
    writerMode: string;
    writerExpires: string;
    gitSummary: string;
    changedFiles: string;
    noChangedFiles: string;
    gitUnavailable: string;
    taskStatus: string;
    priority: string;
    planningPolicy: string;
    planningRequired: string;
    planningOptional: string;
    planningReady: string;
    planningBlocked: string;
    planningBlockers: string;
    spec: string;
    plan: string;
    planningStateNotBound: string;
    planningStateRelationInvalid: string;
    planningStateUnapproved: string;
    planningStateStale: string;
    planningStateApprovedCurrent: string;
    documentStatus: string;
    documentVersion: string;
    documentHash: string;
    documentHistory: string;
    currentContent: string;
    createDocument: string;
    createDocumentTitle: string;
    documentKind: string;
    documentTitle: string;
    contentMarkdown: string;
    changeSummary: string;
    appendVersion: string;
    appendVersionTitle: string;
    markReady: string;
    approveDocument: string;
    returnDraft: string;
    bindDocuments: string;
    taskDocumentBinding: string;
    selectTask: string;
    selectSpec: string;
    selectPlan: string;
    clearBinding: string;
    saveBinding: string;
    noDocumentsTitle: string;
    noDocumentsDescription: string;
    noDocumentSelected: string;
    activeSession: string;
    parentTask: string;
    noTasksTitle: string;
    noTasksDescription: string;
    noSessionsTitle: string;
    noSessionsDescription: string;
    noHandoffsTitle: string;
    noHandoffsDescription: string;
    noEvidenceTitle: string;
    noEvidenceDescription: string;
    noApprovalsTitle: string;
    noApprovalsDescription: string;
    prepareHandoff: string;
    prepareHandoffTitle: string;
    sourceTask: string;
    sourceSession: string;
    targetMode: string;
    goal: string;
    completedItems: string;
    pendingItems: string;
    risks: string;
    nextAction: string;
    onePerLine: string;
    submitHandoff: string;
    acceptHandoff: string;
    cancelHandoff: string;
    forkHandoff: string;
    forkHandoffTitle: string;
    childTaskTitle: string;
    childSessionTitle: string;
    operationComplete: string;
    operationFailed: string;
    submitReview: string;
    completeTask: string;
    completionReady: string;
    completionBlocked: string;
    completionBlockers: string;
    runtimeBinding: string;
    asyncJob: string;
    jobStatus: string;
    bindingStatus: string;
    externalRun: string;
    jobArtifacts: string;
    noJobArtifacts: string;
    verificationVerified: string;
    verificationIncomplete: string;
    verificationMissing: string;
    requiredEvidence: string;
    optionalEvidence: string;
    handoffFrom: string;
    handoffTo: string;
    createdAt: string;
    approvalKind: string;
    approvalStatus: string;
    refreshSnapshot: string;
    selectWorkspaceHint: string;
  };
  setup: {
    title: string;
    description: string;
    readyTag: string;
    pendingTag: string;
    openGptHelper: string;
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
  pageTitle: "TokenPilot 控制台",
  header: {
    title: "TokenPilot 控制台",
    refresh: "刷新",
    refreshTooltip: "刷新健康状态与任务数据",
    dashboard: "总览",
    continuity: "连续性",
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
    emptyStateDescription: "可以先复制 GPT 接入指引，或在接入后刷新当前状态。",
    protectedStateTitle: "任务数据受保护",
    protectedStateDescription: "当前接口需要浏览器会话令牌；输入 TOKENPILOT_API_TOKEN 后再读取真实队列状态。",
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
    gptPreviewCompact: "包含模式、鉴权、OpenAPI 地址与 API 基址，可一键复制完整文本。",
    repoGovernanceTitle: "Repo 治理",
    repoGovernanceDescription: "当前允许 GPT Actions 与本地 Codex 协同使用的公开 repoId；本机路径只在私有配置中解析。",
    repoGovernanceConfigScope:
      "配置来源：本机私有 TokenPilot 配置（默认 ~/.tokenpilot/config.json，可用 TOKENPILOT_CONFIG_PATH 覆盖）",
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
  continuity: {
    shellTitle: "连续性工作台",
    shellDescription: "在同一项目上下文中查看工作区、任务、会话、交接、证据与审批边界。",
    refresh: "刷新项目",
    loadingTitle: "正在加载连续性数据",
    loadingDescription: "正在读取已配置项目与工作区状态。",
    requestFailedTitle: "连续性数据加载失败",
    protectedTitle: "需要访问令牌",
    protectedDescription: "此部署要求鉴权。请先在顶部设置 Bearer Token。",
    sections: {
      projects: {
        label: "项目",
        title: "项目与工作区",
        description: "读取真实的项目、仓库映射与工作区状态。"
      },
      documents: {
        label: "Specs & Plans",
        title: "规格与执行计划",
        description: "管理可版本化、可审批并绑定到任务的 Spec / Plan 真源。"
      },
      tasks: {
        label: "任务",
        title: "任务",
        description: "任务目标、状态与当前执行会话。"
      },
      sessions: {
        label: "会话",
        title: "开发会话",
        description: "Chat Direct、Codex Session 与异步 Agent 会话。"
      },
      handoffs: {
        label: "交接",
        title: "交接检查点",
        description: "跨运行模式接力所需的状态、风险与下一步。"
      },
      evidence: {
        label: "证据",
        title: "验证证据",
        description: "测试、构建、Diff、审查与人工验证记录。"
      },
      approvals: {
        label: "审批",
        title: "运行时审批",
        description: "命令执行与文件变更的显式审批状态。"
      }
    },
    projectCount: "项目",
    workspaceCount: "工作区",
    readyWorkspaceCount: "可用工作区",
    noProjectsTitle: "没有已配置项目",
    noProjectsDescription: "在本地 TokenPilot 配置中添加允许的仓库映射后，这里会显示真实项目。",
    defaultWorkspace: "默认工作区",
    workspaces: "工作区",
    branch: "分支",
    headCommit: "HEAD",
    revision: "修订",
    dirty: "有未提交更改",
    clean: "工作区干净",
    statusActive: "活跃",
    statusReady: "可用",
    statusMissing: "缺失",
    statusBlocked: "已阻止",
    statusArchived: "已归档",
    collectionUnavailableTitle: "集合查询尚未开放",
    collectionUnavailableDescription: "当前后端只提供受控的按 ID 读取与写入操作，尚未提供该资源的安全列表接口。",
    detailReadsAvailable: "已有记录仍可通过明确 ID 和对应 API 读取。",
    noFakeData: "为避免伪造状态，本视图不会生成演示数据。",
    workspaceSelector: "当前工作区",
    writerTitle: "Workspace Writer",
    activeWriter: "存在活跃写入者",
    noActiveWriter: "当前没有活跃写入者",
    writerReadOnlyNotice: "该工作区由另一个运行时持有写入租约；不属于持有会话的交接操作保持只读。",
    writerAvailableNotice: "当前没有写入租约冲突，可以从活跃会话准备交接。",
    writerSession: "持有会话",
    writerMode: "运行模式",
    writerExpires: "租约到期",
    gitSummary: "当前 Git 摘要",
    changedFiles: "变更文件",
    noChangedFiles: "当前没有公开可见的变更文件。",
    gitUnavailable: "Git 状态当前不可用。",
    taskStatus: "状态",
    priority: "优先级",
    planningPolicy: "规划策略",
    planningRequired: "必须规划",
    planningOptional: "可选规划",
    planningReady: "规划就绪",
    planningBlocked: "执行受阻",
    planningBlockers: "规划阻塞项",
    spec: "Spec",
    plan: "Plan",
    planningStateNotBound: "未绑定",
    planningStateRelationInvalid: "关系无效",
    planningStateUnapproved: "未批准",
    planningStateStale: "版本已过期",
    planningStateApprovedCurrent: "已批准且为当前版本",
    documentStatus: "文档状态",
    documentVersion: "当前版本",
    documentHash: "内容哈希",
    documentHistory: "版本历史",
    currentContent: "当前内容",
    createDocument: "新建 Spec / Plan",
    createDocumentTitle: "创建开发文档",
    documentKind: "文档类型",
    documentTitle: "标题",
    contentMarkdown: "Markdown 内容",
    changeSummary: "版本说明",
    appendVersion: "新增版本",
    appendVersionTitle: "创建不可变新版本",
    markReady: "标记 Ready",
    approveDocument: "批准",
    returnDraft: "退回 Draft",
    bindDocuments: "绑定到任务",
    taskDocumentBinding: "任务文档绑定",
    selectTask: "选择任务",
    selectSpec: "选择 Spec",
    selectPlan: "选择 Plan",
    clearBinding: "不绑定",
    saveBinding: "保存绑定",
    noDocumentsTitle: "当前工作区没有 Spec / Plan",
    noDocumentsDescription: "创建第一个开发文档后，可版本化、审批并绑定到任务。",
    noDocumentSelected: "选择一个文档以查看当前内容与版本历史。",
    activeSession: "活跃会话",
    parentTask: "父任务",
    noTasksTitle: "当前工作区没有任务",
    noTasksDescription: "创建并绑定到该工作区的任务会显示在这里。",
    noSessionsTitle: "当前工作区没有开发会话",
    noSessionsDescription: "启动 Chat Direct、Codex Session 或异步 Agent 会话后会显示在这里。",
    noHandoffsTitle: "当前没有交接检查点",
    noHandoffsDescription: "从活跃任务会话准备交接后，可在这里接受、分叉或取消。",
    noEvidenceTitle: "当前没有验证证据",
    noEvidenceDescription: "记录测试、构建、审查或人工检查后会形成验证清单。",
    noApprovalsTitle: "当前没有待处理审批",
    noApprovalsDescription: "Codex 运行时请求命令或文件变更审批时会显示在这里。",
    prepareHandoff: "准备交接",
    prepareHandoffTitle: "准备开发交接",
    sourceTask: "来源任务",
    sourceSession: "来源会话",
    targetMode: "目标模式",
    goal: "交接目标",
    completedItems: "已完成项",
    pendingItems: "待处理项",
    risks: "风险",
    nextAction: "下一步",
    onePerLine: "每行一项",
    submitHandoff: "创建 Ready Checkpoint",
    acceptHandoff: "接受",
    cancelHandoff: "取消",
    forkHandoff: "分叉",
    forkHandoffTitle: "从交接创建子任务",
    childTaskTitle: "子任务标题",
    childSessionTitle: "子会话标题",
    operationComplete: "操作已完成",
    operationFailed: "操作失败",
    submitReview: "提交审查",
    completeTask: "完成任务",
    completionReady: "满足完成条件",
    completionBlocked: "尚不能完成",
    completionBlockers: "完成阻塞项",
    runtimeBinding: "运行时绑定",
    asyncJob: "异步 Job",
    jobStatus: "Job 状态",
    bindingStatus: "绑定状态",
    externalRun: "外部运行 ID",
    jobArtifacts: "Job 产物",
    noJobArtifacts: "当前没有公开可见的 Job 产物。",
    verificationVerified: "已验证",
    verificationIncomplete: "证据不完整",
    verificationMissing: "缺少必需证据",
    requiredEvidence: "必需",
    optionalEvidence: "可选",
    handoffFrom: "来源",
    handoffTo: "目标",
    createdAt: "创建时间",
    approvalKind: "审批类型",
    approvalStatus: "审批状态",
    refreshSnapshot: "刷新工作区状态",
    selectWorkspaceHint: "选择一个工作区以读取真实连续性状态。"
  },
  setup: {
    title: "首次设置",
    description: "按顺序确认本地运行态、鉴权、仓库、Runner、GPT 接入和首个安全任务。",
    readyTag: "已就绪",
    pendingTag: "待处理",
    openGptHelper: "打开 GPT 助手",
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
        label: "鉴权令牌",
        detailReady: "当前鉴权状态满足本地访问要求。",
        detailPending: "受保护接口需要配置 TOKENPILOT_API_TOKEN。",
        nextReady: "继续下一步",
        nextPending: "在本地运行态中配置 TOKENPILOT_API_TOKEN"
      },
      oauth: {
        label: "ChatGPT MCP OAuth",
        detailReady: "OAuth 已就绪，或当前本地模式无需远程 OAuth。",
        detailPending: "ChatGPT Remote MCP OAuth 尚未满足公开地址、Owner Secret 或持久化条件。",
        nextReady: "继续下一步",
        nextPending: "运行 npm run doctor 查看 OAuth readiness 原因"
      },
      repo: {
        label: "仓库授权",
        detailReady: "默认 repoId 可以在本地解析。",
        detailPending: "默认仓库根目录不可用。",
        nextReady: "继续下一步",
        nextPending: "检查 TOKENPILOT_REPO_ROOT"
      },
      runner: {
        label: "本地 Runner",
        detailReady: "Runner 已写入状态。",
        detailPending: "Runner 尚未上报状态。",
        nextReady: "继续下一步",
        nextPending: "运行 npm run start:local"
      },
      gpt: {
        label: "GPT 接入",
        detailReady: "OpenAPI schema 与 GPT 辅助信息可用。",
        detailPending: "GPT 辅助信息尚未准备好。",
        nextReady: "打开 GPT 助手复制指令",
        nextPending: "打开 GPT 助手检查接入信息"
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
    protectedDescription: "当前未提供浏览器会话令牌，界面只能显示本地回退摘要。",
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
      "当前未提供 TOKENPILOT_API_TOKEN，因此无法读取真实 GPT 配置；输入令牌后可查看完整 GPT 指令、版本更新时间与机器侧备注。",
    notesTitle: "操作员备注",
    notesDescription: "面向鉴权模式下的人类操作员。",
    tokenNote:
      "访问令牌来自服务端 TOKENPILOT_API_TOKEN，仅限当前浏览器会话输入，界面只做掩码展示。",
    checklist: [
      "操作员检查清单",
      "- 确认 /api/health 可访问。",
      "- 使用 /openapi.yaml 作为 schema 来源。",
      "- 如果需要鉴权，只在当前本地浏览器会话中提供访问令牌。",
      "- 将预期控制在本地优先操作员 MVP 范围内。",
      "- 不要把当前状态当作完整 HTTPS / Custom GPT Actions 生产闭环。"
    ]
  }
};

const enUS: UiCopy = {
  pageTitle: "TokenPilot Operator Console",
  header: {
    title: "TokenPilot Operator Console",
    refresh: "Refresh",
    refreshTooltip: "Refresh health and job data",
    dashboard: "Dashboard",
    continuity: "Continuity",
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
    protectedStateTitle: "Job data is protected",
    protectedStateDescription: "Enter TOKENPILOT_API_TOKEN in the browser session before reading the real queue state.",
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
    gptPreviewCompact: "Includes mode, auth, OpenAPI URL, and API base URL with one-click copy for the full text.",
    repoGovernanceTitle: "Repo Governance",
    repoGovernanceDescription: "Public repoIds currently available to GPT Actions and local Codex collaboration. Local paths resolve only inside private operator config.",
    repoGovernanceConfigScope:
      "Config source: local private TokenPilot config (default ~/.tokenpilot/config.json, override with TOKENPILOT_CONFIG_PATH)",
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
  continuity: {
    shellTitle: "Continuity Workbench",
    shellDescription: "Inspect workspace, task, session, handoff, evidence, and approval boundaries in one project context.",
    refresh: "Refresh projects",
    loadingTitle: "Loading continuity data",
    loadingDescription: "Reading configured projects and workspace status.",
    requestFailedTitle: "Continuity data request failed",
    protectedTitle: "Access token required",
    protectedDescription: "This deployment requires authentication. Configure the Bearer Token in the header first.",
    sections: {
      projects: {
        label: "Projects",
        title: "Projects and workspaces",
        description: "Read real project, repository mapping, and workspace status data."
      },
      documents: {
        label: "Specs & Plans",
        title: "Specs and execution plans",
        description: "Manage versioned, approvable Spec and Plan truth that can be pinned to Tasks."
      },
      tasks: {
        label: "Tasks",
        title: "Tasks",
        description: "Task goals, status, and current execution sessions."
      },
      sessions: {
        label: "Sessions",
        title: "Development sessions",
        description: "Chat Direct, Codex Session, and asynchronous Agent sessions."
      },
      handoffs: {
        label: "Handoffs",
        title: "Handoff checkpoints",
        description: "State, risk, and next-action context for runtime handoff."
      },
      evidence: {
        label: "Evidence",
        title: "Verification evidence",
        description: "Tests, builds, diffs, reviews, and manual verification records."
      },
      approvals: {
        label: "Approvals",
        title: "Runtime approvals",
        description: "Explicit command execution and file-change approval state."
      }
    },
    projectCount: "Projects",
    workspaceCount: "Workspaces",
    readyWorkspaceCount: "Ready workspaces",
    noProjectsTitle: "No configured projects",
    noProjectsDescription: "Add an allowlisted repository mapping to local TokenPilot config to display a real project here.",
    defaultWorkspace: "Default workspace",
    workspaces: "Workspaces",
    branch: "Branch",
    headCommit: "HEAD",
    revision: "Revision",
    dirty: "Uncommitted changes",
    clean: "Workspace clean",
    statusActive: "Active",
    statusReady: "Ready",
    statusMissing: "Missing",
    statusBlocked: "Blocked",
    statusArchived: "Archived",
    collectionUnavailableTitle: "Collection query not exposed yet",
    collectionUnavailableDescription: "The backend currently exposes controlled by-ID reads and mutations, but not a safe list endpoint for this resource.",
    detailReadsAvailable: "Existing records remain readable through an explicit ID and the corresponding API.",
    noFakeData: "This view does not generate demo records or pretend that runtime state exists.",
    workspaceSelector: "Current workspace",
    writerTitle: "Workspace Writer",
    activeWriter: "Active writer present",
    noActiveWriter: "No active writer",
    writerReadOnlyNotice: "Another runtime holds the workspace writer lease. Handoff actions outside the holder session remain read-only.",
    writerAvailableNotice: "No writer lease conflict is active. A handoff can be prepared from an active session.",
    writerSession: "Holder session",
    writerMode: "Runtime mode",
    writerExpires: "Lease expires",
    gitSummary: "Current Git summary",
    changedFiles: "Changed files",
    noChangedFiles: "No public-safe changed files are currently visible.",
    gitUnavailable: "Git status is currently unavailable.",
    taskStatus: "Status",
    priority: "Priority",
    planningPolicy: "Planning policy",
    planningRequired: "Planning required",
    planningOptional: "Planning optional",
    planningReady: "Planning ready",
    planningBlocked: "Execution blocked",
    planningBlockers: "Planning blockers",
    spec: "Spec",
    plan: "Plan",
    planningStateNotBound: "Not bound",
    planningStateRelationInvalid: "Invalid relation",
    planningStateUnapproved: "Not approved",
    planningStateStale: "Stale version",
    planningStateApprovedCurrent: "Approved and current",
    documentStatus: "Document status",
    documentVersion: "Current version",
    documentHash: "Content hash",
    documentHistory: "Version history",
    currentContent: "Current content",
    createDocument: "New Spec / Plan",
    createDocumentTitle: "Create development document",
    documentKind: "Document kind",
    documentTitle: "Title",
    contentMarkdown: "Markdown content",
    changeSummary: "Version summary",
    appendVersion: "New version",
    appendVersionTitle: "Create immutable new version",
    markReady: "Mark ready",
    approveDocument: "Approve",
    returnDraft: "Return to draft",
    bindDocuments: "Bind to task",
    taskDocumentBinding: "Task document binding",
    selectTask: "Select task",
    selectSpec: "Select Spec",
    selectPlan: "Select Plan",
    clearBinding: "No binding",
    saveBinding: "Save binding",
    noDocumentsTitle: "No Specs or Plans in this workspace",
    noDocumentsDescription: "Create the first development document to version, approve, and bind it to a Task.",
    noDocumentSelected: "Select a document to inspect current content and version history.",
    activeSession: "Active session",
    parentTask: "Parent task",
    noTasksTitle: "No tasks in this workspace",
    noTasksDescription: "Tasks created and bound to this workspace will appear here.",
    noSessionsTitle: "No development sessions in this workspace",
    noSessionsDescription: "Chat Direct, Codex Session, and asynchronous Agent sessions will appear after they start.",
    noHandoffsTitle: "No handoff checkpoints",
    noHandoffsDescription: "Prepare a handoff from an active task session to accept, fork, or cancel it here.",
    noEvidenceTitle: "No verification evidence",
    noEvidenceDescription: "Tests, builds, reviews, or manual checks will form the verification checklist.",
    noApprovalsTitle: "No pending approvals",
    noApprovalsDescription: "Codex command and file-change approval requests will appear here.",
    prepareHandoff: "Prepare handoff",
    prepareHandoffTitle: "Prepare development handoff",
    sourceTask: "Source task",
    sourceSession: "Source session",
    targetMode: "Target mode",
    goal: "Handoff goal",
    completedItems: "Completed items",
    pendingItems: "Pending items",
    risks: "Risks",
    nextAction: "Next action",
    onePerLine: "One item per line",
    submitHandoff: "Create ready checkpoint",
    acceptHandoff: "Accept",
    cancelHandoff: "Cancel",
    forkHandoff: "Fork",
    forkHandoffTitle: "Create child task from handoff",
    childTaskTitle: "Child task title",
    childSessionTitle: "Child session title",
    operationComplete: "Operation completed",
    operationFailed: "Operation failed",
    submitReview: "Submit review",
    completeTask: "Complete task",
    completionReady: "Completion requirements satisfied",
    completionBlocked: "Completion blocked",
    completionBlockers: "Completion blockers",
    runtimeBinding: "Runtime binding",
    asyncJob: "Async Job",
    jobStatus: "Job status",
    bindingStatus: "Binding status",
    externalRun: "External run ID",
    jobArtifacts: "Job artifacts",
    noJobArtifacts: "No public-safe Job artifacts are currently available.",
    verificationVerified: "Verified",
    verificationIncomplete: "Evidence incomplete",
    verificationMissing: "Required evidence missing",
    requiredEvidence: "Required",
    optionalEvidence: "Optional",
    handoffFrom: "From",
    handoffTo: "To",
    createdAt: "Created",
    approvalKind: "Approval kind",
    approvalStatus: "Approval status",
    refreshSnapshot: "Refresh workspace state",
    selectWorkspaceHint: "Select a workspace to read real continuity state."
  },
  setup: {
    title: "First-run setup",
    description: "Check local runtime, auth, repo, runner, GPT handoff, and the first safe task.",
    readyTag: "Ready",
    pendingTag: "Pending",
    openGptHelper: "Open GPT Helper",
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
        label: "Bearer auth",
        detailReady: "Current auth state is ready for local access.",
        detailPending: "Protected endpoints need TOKENPILOT_API_TOKEN.",
        nextReady: "Continue",
        nextPending: "Configure TOKENPILOT_API_TOKEN locally"
      },
      oauth: {
        label: "ChatGPT MCP OAuth",
        detailReady: "OAuth is ready, or remote OAuth is not required in local-only mode.",
        detailPending: "Remote MCP OAuth is missing a valid public origin, owner secret, or writable runtime state.",
        nextReady: "Continue",
        nextPending: "Run npm run doctor for the OAuth readiness reason"
      },
      repo: {
        label: "Repository allowlist",
        detailReady: "The default repoId resolves locally.",
        detailPending: "The default repository root is unavailable.",
        nextReady: "Continue",
        nextPending: "Check TOKENPILOT_REPO_ROOT"
      },
      runner: {
        label: "Runner",
        detailReady: "Runner status is present.",
        detailPending: "Runner has not reported status yet.",
        nextReady: "Continue",
        nextPending: "Run npm run start:local"
      },
      gpt: {
        label: "GPT handoff",
        detailReady: "OpenAPI schema and GPT helper data are available.",
        detailPending: "GPT helper data is not ready.",
        nextReady: "Open GPT Helper and copy instructions",
        nextPending: "Open GPT Helper and inspect handoff data"
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
    protectedDescription: "No browser session token is present, so the UI can only show the local fallback summary.",
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
      "TOKENPILOT_API_TOKEN is not present in this browser session, so the live GPT config is unavailable. Enter the token to load the full instructions, updated timestamp, and machine-side notes.",
    notesTitle: "Operator Notes",
    notesDescription: "Compact reminders for human operators using auth-required mode.",
    tokenNote:
      "Enter the TOKENPILOT_API_TOKEN value only in this browser session. The UI masks it for display.",
    checklist: [
      "Operator checklist",
      "- Confirm /api/health is reachable.",
      "- Use /openapi.yaml as the schema source.",
      "- If auth is required, provide the access token only in this local browser session.",
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

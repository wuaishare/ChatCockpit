import type { ContinuitySectionKey } from "../types";

export interface ContinuityCopy {
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
  manageWorkspaces: string;
  openProjectCenter: string;
  addProject: string;
  projectCockpitTitle: string;
  projectCockpitDescription: string;
  projectWorkspaceCard: string;
  developmentControlCard: string;
  projectCapabilitiesCard: string;
  modelLoopOwner: string;
  modelLoopCaller: string;
  implicitCodexTurns: string;
  implicitCodexTurnsDisabled: string;
  workspaceMode: string;
  workspaceNativeCheckout: string;
  workspaceWorktree: string;
  workspaceState: string;
  projectName: string;
  projectSlug: string;
  detachedHead: string;
  observationReady: string;
  observationDegraded: string;
  observationNotRequired: string;
  gitLive: string;
  codexContinuity: string;
  codexRuntime: string;
  codexAvailable: string;
  codexUnavailable: string;
  codexUnknown: string;
  codexObservation: string;
  codexNextAction: string;
  codexActionResume: string;
  codexActionStart: string;
  codexActionRepair: string;
  codexActionUnavailable: string;
  codexThread: string;
  noMatchingThread: string;
  handoffPolicy: string;
  handoffOwnerChangeRequired: string;
  handoffSameOwnerResumeNotRequired: string;
  handoffArtifact: string;
  mcpApplicability: string;
  mcpConfigured: string;
  mcpApplicable: string;
  mcpDisabled: string;
  mcpEffectiveConfig: string;
  mcpObservation: string;
  mcpServerEnabled: string;
  mcpServerDisabled: string;
  projectDetailLoadingTitle: string;
  projectDetailLoadingDescription: string;
  workspaceManagerTitle: string;
  workspaceManagerDescription: string;
  registeredProjects: string;
  discoveryRoots: string;
  addDiscoveryRoot: string;
  discoveryRootPath: string;
  discoveryRootHint: string;
  addRoot: string;
  removeRoot: string;
  scanProjects: string;
  scanTruncated: string;
  noDiscoveryRoots: string;
  noDiscoveryRootsDescription: string;
  discoveredProjects: string;
  noCandidates: string;
  registeredCandidate: string;
  unregisteredCandidate: string;
  reviewImport: string;
  repoIdLabel: string;
  permissionReview: string;
  permissionExactProject: string;
  permissionNoSiblings: string;
  importProject: string;
  machineLocalRequired: string;
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
  importCodexThread: string;
  importCodexThreadTitle: string;
  importCodexThreadDescription: string;
  threadReference: string;
  threadReferencePlaceholder: string;
  assessThread: string;
  assessmentReady: string;
  assessmentExpires: string;
  threadSource: string;
  threadProvider: string;
  threadStatus: string;
  threadWorkspace: string;
  handoffToChatGpt: string;
  handoffToChatGptDescription: string;
  noCodexQuotaNotice: string;
  codexQuotaAvailableNotice: string;
  codexQuotaUnknownNotice: string;
  nativeWriterBusyTitle: string;
  nativeWriterBusyDescription: string;
  resumeNativeCodex: string;
  nativeResumeComplete: string;
  executeChatDirectHandoff: string;
  contextPreview: string;
  contextTruncated: string;
  contextComplete: string;
  importComplete: string;
  continuationSession: string;
  continueWithCodex: string;
  continueWithCodexDescription: string;
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
  recoverySelectTask: string;
  recoverySelectSession: string;
  recoveryProvider: string;
  recoveryProviderAuto: string;
  recoveryAssess: string;
  recoveryReassess: string;
  recoveryClassification: string;
  recoveryCompatibility: string;
  recoveryProtocol: string;
  recoveryVersion: string;
  recoveryExternalRuntime: string;
  recoveryCandidates: string;
  recoveryBlockers: string;
  recoveryActions: string;
  recoveryExpires: string;
  recoveryNoAssessment: string;
  recoveryNoAssessmentDescription: string;
  recoveryNoBlockers: string;
  recoveryNoCandidates: string;
  recoveryNoActions: string;
  recoveryTargetThread: string;
  recoveryTargetMode: string;
  recoveryExecute: string;
  recoveryApplied: string;
  recoveryAttempt: string;
  recoveryResultBinding: string;
  recoveryAuthoritativeNotice: string;
}

export const zhCNContinuityCopy: ContinuityCopy = {
  shellTitle: "连续性工作台",
  shellDescription: "在同一项目上下文中查看工作区、任务、会话、交接、证据与审批边界。",
  refresh: "刷新项目",
  loadingTitle: "正在加载连续性数据",
  loadingDescription: "正在读取已配置项目与工作区状态。",
  requestFailedTitle: "连续性数据加载失败",
  protectedTitle: "需要控制台管理员会话",
  protectedDescription: "此部署要求鉴权。请重新登录控制台管理员账户后继续。",
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
    recovery: {
      label: "恢复中心",
      title: "Runtime Recovery Center",
      description: "基于真实连续性状态与运行时兼容性评估，显式恢复或接续现有开发会话。"
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
  noProjectsDescription: "使用“添加项目”授权一个本机父目录并显式加入需要管理的 Git 项目。",
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
  workspaceSelector: "当前执行工作区",
  manageWorkspaces: "项目发现与导入",
  openProjectCenter: "打开项目中心",
  addProject: "添加项目",
  projectCockpitTitle: "Project Cockpit",
  projectCockpitDescription: "直接读取该项目的权威开发协调状态，不依赖 Workspace 连续性快照才能显示。",
  projectWorkspaceCard: "项目与工作区",
  developmentControlCard: "开发控制",
  projectCapabilitiesCard: "项目能力",
  modelLoopOwner: "模型循环所有者",
  modelLoopCaller: "调用方（Caller）",
  implicitCodexTurns: "隐式 Codex Turn",
  implicitCodexTurnsDisabled: "禁止；必须显式转交模型循环",
  workspaceMode: "工作区模式",
  workspaceNativeCheckout: "原生 Checkout",
  workspaceWorktree: "显式 Worktree",
  workspaceState: "工作区状态",
  projectName: "项目名称",
  projectSlug: "项目 Slug",
  detachedHead: "Detached HEAD",
  observationReady: "已就绪",
  observationDegraded: "降级",
  observationNotRequired: "无需观测",
  gitLive: "已读取实时 Git 状态",
  codexContinuity: "Codex 连续性",
  codexRuntime: "Codex Runtime",
  codexAvailable: "可用",
  codexUnavailable: "不可用",
  codexUnknown: "未知",
  codexObservation: "Provider 观测",
  codexNextAction: "服务端建议动作",
  codexActionResume: "Resume 已有原生 Thread",
  codexActionStart: "启动新的原生 Thread",
  codexActionRepair: "先修复 Workspace",
  codexActionUnavailable: "当前无可执行原生动作",
  codexThread: "匹配 Thread",
  noMatchingThread: "当前没有匹配的原生 Thread",
  handoffPolicy: "Handoff 策略",
  handoffOwnerChangeRequired: "模型循环所有者变更必须 Handoff",
  handoffSameOwnerResumeNotRequired: "同一所有者 Resume 不需要 Handoff",
  handoffArtifact: "推荐交接产物",
  mcpApplicability: "MCP 适用性",
  mcpConfigured: "已配置",
  mcpApplicable: "当前适用",
  mcpDisabled: "已禁用",
  mcpEffectiveConfig: "Codex Effective Config",
  mcpObservation: "配置观测",
  mcpServerEnabled: "启用",
  mcpServerDisabled: "禁用",
  projectDetailLoadingTitle: "正在读取 Project Cockpit",
  projectDetailLoadingDescription: "正在读取该项目的权威 Workspace、Codex 与 MCP 协调状态。",
  workspaceManagerTitle: "项目发现与导入",
  workspaceManagerDescription: "在项目中心管理授权发现位置，并显式导入需要交给 ChatCockpit 管理的 Git 项目；发现位置本身不会授予执行权限。",
  registeredProjects: "已注册项目",
  discoveryRoots: "授权发现目录",
  addDiscoveryRoot: "添加发现目录",
  discoveryRootPath: "本机父目录路径",
  discoveryRootHint: "例如一个专门存放多个 Git 项目的父目录。这里只授予一级扫描权限，不会自动授权所有子项目。",
  addRoot: "授权目录",
  removeRoot: "移除发现权限",
  scanProjects: "扫描项目",
  scanTruncated: "结果已达到安全扫描上限；可缩小父目录范围后重试。",
  noDiscoveryRoots: "尚未授权项目发现目录",
  noDiscoveryRootsDescription: "添加一个本机父目录后，ChatCockpit 只扫描其一级子目录中的 Git 项目。",
  discoveredProjects: "发现的 Git 项目",
  noCandidates: "该目录下没有发现符合条件的一级 Git 项目。",
  registeredCandidate: "已加入",
  unregisteredCandidate: "可加入",
  reviewImport: "审核并加入",
  repoIdLabel: "仓库 ID",
  permissionReview: "权限确认",
  permissionExactProject: "只为当前选中的 Git 项目建立受治理的 Project Root / Execution Workspace。",
  permissionNoSiblings: "同一发现位置中的其他项目不会自动加入，也不会因此获得 AI 操作权限。",
  importProject: "加入 ChatCockpit",
  machineLocalRequired: "项目发现位置与本机目录授权只能在目标 Mac 的 machine-local ChatCockpit Host 中管理。远程访问仍可使用已经授权的 Project / Execution Workspace。",
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
  importCodexThread: "继续 Codex 会话",
  importCodexThreadTitle: "继续已有 Codex 会话",
  importCodexThreadDescription: "先从 Codex App Server 读取原生 Thread 与配额状态。正常情况下直接 Resume 同一个原生会话；只有明确切换模型运行链或 Codex 受限时，才使用 Chat Direct Transfer。",
  threadReference: "Codex Thread",
  threadReferencePlaceholder: "codex://threads/<thread-id> 或直接输入 thread id",
  assessThread: "检查原生会话",
  assessmentReady: "已找到与当前工作区匹配的原生 Codex Thread。",
  assessmentExpires: "本次验证有效至",
  threadSource: "来源",
  threadProvider: "Provider",
  threadStatus: "状态",
  threadWorkspace: "目标工作区",
  handoffToChatGpt: "Transfer 到 ChatGPT Direct",
  handoffToChatGptDescription: "这是跨 Runtime fallback，不是同一个 Codex 会话。仅在你明确切换模型运行链，或 Codex 当前受配额/可用性限制时使用；原 Codex Thread 保持为来源真源。",
  noCodexQuotaNotice: "Codex 当前报告存在配额/速率限制。推荐 Transfer 到 ChatGPT Direct；原生 Resume 仍保留，但新的 Codex Turn 可能无法执行。",
  codexQuotaAvailableNotice: "Codex 当前未报告配额限制。推荐直接 Resume 原 Thread，继续使用原生 Codex Session、配置与历史。",
  codexQuotaUnknownNotice: "当前 Provider 没有返回可用的配额窗口数据。ChatCockpit 不会把未知状态当作“配额可用”；可先尝试原生 Resume，或明确选择 Transfer。",
  nativeWriterBusyTitle: "该 Codex Thread 正由另一个 Surface 持有",
  nativeWriterBusyDescription: "Codex 当前拒绝第二个 writer。请先在原 VS Code / Desktop / CLI Surface 中释放或关闭该会话，再手动重试；ChatCockpit 不会自动抢占、终止原进程或高频重试。若需要立即切换模型循环，可显式 Transfer 到 ChatGPT Direct。",
  resumeNativeCodex: "Resume 原生 Codex Thread",
  nativeResumeComplete: "已 Resume 原生 Codex Thread；没有创建 ChatCockpit Task、开发 Session 或 Handoff。",
  executeChatDirectHandoff: "准备并确认 Transfer",
  contextPreview: "可见历史上下文",
  contextTruncated: "上下文已按安全上限截断，可在交接后继续分页读取。",
  contextComplete: "已捕获当前可见历史。",
  importComplete: "Codex 工作已显式 Transfer 到 Chat Direct。",
  continuationSession: "Chat Direct Transfer 会话",
  continueWithCodex: "Codex 高级恢复",
  continueWithCodexDescription: "仅在普通原生 Resume 无法满足恢复/分叉需求时进入 Recovery Center。",
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
  selectWorkspaceHint: "选择一个工作区以读取真实连续性状态。",
  recoverySelectTask: "恢复任务",
  recoverySelectSession: "开发会话",
  recoveryProvider: "运行时 Provider",
  recoveryProviderAuto: "跟随当前会话 / Binding",
  recoveryAssess: "评估恢复状态",
  recoveryReassess: "重新评估",
  recoveryClassification: "恢复分类",
  recoveryCompatibility: "兼容性",
  recoveryProtocol: "协议",
  recoveryVersion: "运行时版本",
  recoveryExternalRuntime: "当前外部运行时",
  recoveryCandidates: "可选恢复候选",
  recoveryBlockers: "阻塞项",
  recoveryActions: "可执行恢复动作",
  recoveryExpires: "评估有效期",
  recoveryNoAssessment: "尚未进行恢复评估",
  recoveryNoAssessmentDescription: "选择任务、会话与可选 Provider 后，让服务端基于 Writer、Git、Handoff、Evidence、Binding 与真实 Provider 状态生成短期 Recovery Attempt。",
  recoveryNoBlockers: "当前评估没有阻塞项。",
  recoveryNoCandidates: "当前没有服务端确认的外部运行时候选。",
  recoveryNoActions: "当前评估没有可执行恢复动作。",
  recoveryTargetThread: "目标 Codex Thread",
  recoveryTargetMode: "交接目标模式",
  recoveryExecute: "执行恢复",
  recoveryApplied: "恢复动作已由服务端确认完成。",
  recoveryAttempt: "Recovery Attempt",
  recoveryResultBinding: "结果 Binding",
  recoveryAuthoritativeNotice: "恢复资格与动作完全来自服务端评估；界面不会根据本地状态自行推断或提前标记恢复成功。"
};

export const enUSContinuityCopy: ContinuityCopy = {
  shellTitle: "Continuity Workbench",
  shellDescription: "Inspect workspace, task, session, handoff, evidence, and approval boundaries in one project context.",
  refresh: "Refresh projects",
  loadingTitle: "Loading continuity data",
  loadingDescription: "Reading configured projects and workspace status.",
  requestFailedTitle: "Continuity data request failed",
  protectedTitle: "Web Owner session required",
  protectedDescription: "This deployment requires authentication. Sign in with the Web Owner account to continue.",
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
    recovery: {
      label: "Recovery",
      title: "Runtime Recovery Center",
      description: "Assess real continuity and runtime compatibility before explicitly recovering or continuing development work."
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
  noProjectsDescription: "Use Add project to authorize a local parent directory and explicitly register the Git project you want ChatCockpit to manage.",
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
  workspaceSelector: "Current execution workspace",
  manageWorkspaces: "Project discovery & import",
  openProjectCenter: "Open Project Center",
  addProject: "Add project",
  projectCockpitTitle: "Project Cockpit",
  projectCockpitDescription: "Read authoritative project development coordination directly, without requiring the Workspace continuity snapshot to render first.",
  projectWorkspaceCard: "Project and workspace",
  developmentControlCard: "Development control",
  projectCapabilitiesCard: "Project capabilities",
  modelLoopOwner: "Model-loop owner",
  modelLoopCaller: "Caller",
  implicitCodexTurns: "Implicit Codex Turns",
  implicitCodexTurnsDisabled: "Disabled; model-loop transfer must be explicit",
  workspaceMode: "Workspace mode",
  workspaceNativeCheckout: "Native checkout",
  workspaceWorktree: "Explicit worktree",
  workspaceState: "Workspace state",
  projectName: "Project name",
  projectSlug: "Project slug",
  detachedHead: "Detached HEAD",
  observationReady: "Ready",
  observationDegraded: "Degraded",
  observationNotRequired: "Not required",
  gitLive: "Live Git state observed",
  codexContinuity: "Codex continuity",
  codexRuntime: "Codex Runtime",
  codexAvailable: "Available",
  codexUnavailable: "Unavailable",
  codexUnknown: "Unknown",
  codexObservation: "Provider observation",
  codexNextAction: "Server-recommended action",
  codexActionResume: "Resume existing native Thread",
  codexActionStart: "Start a new native Thread",
  codexActionRepair: "Repair the Workspace first",
  codexActionUnavailable: "No native action is currently available",
  codexThread: "Matching Thread",
  noMatchingThread: "No matching native Thread is currently available",
  handoffPolicy: "Handoff policy",
  handoffOwnerChangeRequired: "Changing model-loop owner requires a Handoff",
  handoffSameOwnerResumeNotRequired: "Same-owner resume does not require a Handoff",
  handoffArtifact: "Recommended handoff artifact",
  mcpApplicability: "MCP applicability",
  mcpConfigured: "Configured",
  mcpApplicable: "Applicable",
  mcpDisabled: "Disabled",
  mcpEffectiveConfig: "Codex Effective Config",
  mcpObservation: "Config observation",
  mcpServerEnabled: "Enabled",
  mcpServerDisabled: "Disabled",
  projectDetailLoadingTitle: "Loading Project Cockpit",
  projectDetailLoadingDescription: "Reading authoritative Workspace, Codex, and MCP coordination for this project.",
  workspaceManagerTitle: "Project discovery & import",
  workspaceManagerDescription: "Manage authorized discovery locations in Project Center, then explicitly import only the Git projects ChatCockpit should manage. A discovery location does not grant execution authority by itself.",
  registeredProjects: "Registered projects",
  discoveryRoots: "Authorized discovery roots",
  addDiscoveryRoot: "Add discovery root",
  discoveryRootPath: "Local parent directory path",
  discoveryRootHint: "Choose a parent directory that contains Git projects. This grants depth-1 discovery only and does not authorize every child project.",
  addRoot: "Authorize directory",
  removeRoot: "Remove discovery access",
  scanProjects: "Scan projects",
  scanTruncated: "The safe scan limit was reached. Choose a narrower parent directory to inspect more candidates.",
  noDiscoveryRoots: "No project discovery roots authorized",
  noDiscoveryRootsDescription: "Add a local parent directory and ChatCockpit will inspect only its direct child Git projects.",
  discoveredProjects: "Discovered Git projects",
  noCandidates: "No eligible direct-child Git projects were found under this root.",
  registeredCandidate: "Registered",
  unregisteredCandidate: "Available",
  reviewImport: "Review and add",
  repoIdLabel: "Repository ID",
  permissionReview: "Permission review",
  permissionExactProject: "Only the selected Git project receives a governed Project Root / Execution Workspace.",
  permissionNoSiblings: "Other projects under the same discovery location remain unregistered and unavailable to AI operations.",
  importProject: "Add to ChatCockpit",
  machineLocalRequired: "Project discovery locations and local-folder authority are managed only from a machine-local ChatCockpit Host on the target Mac. Remote access can still use already authorized Projects / Execution Workspaces.",
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
  importCodexThread: "Continue Codex session",
  importCodexThreadTitle: "Continue an existing Codex session",
  importCodexThreadDescription: "Read the provider-native Thread and quota state from Codex App Server first. Normally resume the same native session; use Chat Direct Transfer only when intentionally switching model-loop owner or when Codex is constrained.",
  threadReference: "Codex Thread",
  threadReferencePlaceholder: "codex://threads/<thread-id> or a raw thread id",
  assessThread: "Inspect native session",
  assessmentReady: "The provider-native Codex Thread matches this workspace.",
  assessmentExpires: "Assessment expires",
  threadSource: "Source",
  threadProvider: "Provider",
  threadStatus: "Status",
  threadWorkspace: "Target workspace",
  handoffToChatGpt: "Transfer to ChatGPT Direct",
  handoffToChatGptDescription: "This is a cross-runtime fallback, not the same Codex session. Use it only when intentionally switching model-loop owner or when Codex is quota/availability constrained; the original Codex Thread remains source truth.",
  noCodexQuotaNotice: "Codex currently reports a quota/rate-limit constraint. ChatGPT Direct Transfer is recommended; native Resume remains available, but new Codex Turns may be blocked.",
  codexQuotaAvailableNotice: "Codex currently reports no quota constraint. Resume the original Thread to preserve native Codex session, configuration, and history.",
  codexQuotaUnknownNotice: "The current provider did not return usable quota-window data. ChatCockpit does not treat an unknown quota state as available; you may try native Resume or explicitly choose Transfer.",
  nativeWriterBusyTitle: "This Codex Thread is owned by another active surface",
  nativeWriterBusyDescription: "Codex is refusing a second writer. Release or close the session in the original VS Code, Desktop, or CLI surface, then retry manually. ChatCockpit will not steal ownership, terminate the original process, or retry in a tight loop. Use an explicit ChatGPT Direct Transfer if you need to switch model-loop ownership immediately.",
  resumeNativeCodex: "Resume native Codex Thread",
  nativeResumeComplete: "The native Codex Thread was resumed without creating a ChatCockpit Task, development Session, or Handoff.",
  executeChatDirectHandoff: "Prepare and confirm Transfer",
  contextPreview: "Visible conversation context",
  contextTruncated: "Context was bounded by safety limits; additional pages can be read after handoff.",
  contextComplete: "Current visible history was captured.",
  importComplete: "The Codex work was explicitly transferred to Chat Direct.",
  continuationSession: "Chat Direct Transfer session",
  continueWithCodex: "Advanced Codex recovery",
  continueWithCodexDescription: "Use Recovery Center only when normal provider-native Resume is insufficient for recovery or branching.",
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
  selectWorkspaceHint: "Select a workspace to read real continuity state.",
  recoverySelectTask: "Recovery task",
  recoverySelectSession: "Development session",
  recoveryProvider: "Runtime provider",
  recoveryProviderAuto: "Follow current session / binding",
  recoveryAssess: "Assess recovery state",
  recoveryReassess: "Reassess",
  recoveryClassification: "Recovery classification",
  recoveryCompatibility: "Compatibility",
  recoveryProtocol: "Protocol",
  recoveryVersion: "Runtime version",
  recoveryExternalRuntime: "Current external runtime",
  recoveryCandidates: "Recovery candidates",
  recoveryBlockers: "Blockers",
  recoveryActions: "Available recovery actions",
  recoveryExpires: "Assessment expires",
  recoveryNoAssessment: "No recovery assessment yet",
  recoveryNoAssessmentDescription: "Select a task, session, and optional provider. The server will create a short-lived Recovery Attempt from Writer, Git, Handoff, Evidence, Binding, and authoritative provider state.",
  recoveryNoBlockers: "This assessment has no blockers.",
  recoveryNoCandidates: "No server-confirmed external runtime candidates are available.",
  recoveryNoActions: "This assessment has no executable recovery actions.",
  recoveryTargetThread: "Target Codex thread",
  recoveryTargetMode: "Handoff target mode",
  recoveryExecute: "Execute recovery",
  recoveryApplied: "The server confirmed the recovery action completed.",
  recoveryAttempt: "Recovery Attempt",
  recoveryResultBinding: "Result binding",
  recoveryAuthoritativeNotice: "Recovery eligibility and actions come entirely from the server assessment. The UI does not infer eligibility or mark recovery successful before the server result."
};

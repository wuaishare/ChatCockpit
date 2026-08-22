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
  addProject: string;
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
  workspaceSelector: "当前工作区",
  manageWorkspaces: "管理工作区",
  addProject: "添加项目",
  workspaceManagerTitle: "工作区与项目接入",
  workspaceManagerDescription: "先授权父目录用于受限发现，再显式加入需要交给 ChatCockpit 管理的 Git 项目。",
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
  permissionExactProject: "只把当前选中的 Git 项目加入 Workspace 执行权限。",
  permissionNoSiblings: "同一父目录中的其他项目不会自动加入，也不会因此获得 AI 操作权限。",
  importProject: "加入 ChatCockpit",
  machineLocalRequired: "工作区路径管理只能在目标 Mac 的本机控制台中进行。远程访问仍可使用已注册的逻辑工作区。",
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
  workspaceSelector: "Current workspace",
  manageWorkspaces: "Manage workspaces",
  addProject: "Add project",
  workspaceManagerTitle: "Workspace and project onboarding",
  workspaceManagerDescription: "Authorize a parent directory for bounded discovery, then explicitly register only the Git projects ChatCockpit should manage.",
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
  permissionExactProject: "Only the selected Git checkout is added to Workspace execution authority.",
  permissionNoSiblings: "Sibling projects under the same parent remain unregistered and unavailable to AI operations.",
  importProject: "Add to ChatCockpit",
  machineLocalRequired: "Workspace path management is available only from the target Mac's local console. Remote access can still use already registered logical workspaces.",
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

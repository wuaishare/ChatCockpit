import type { LocaleCode } from "../i18n";

export interface ResourceCenterCopy {
  title: string;
  description: string;
  truthNotice: string;
  loadingTitle: string;
  loadingDescription: string;
  protectedTitle: string;
  protectedDescription: string;
  requestFailedTitle: string;
  activityTitle: string;
  activityDescription: string;
  activityLive: string;
  activityConnecting: string;
  activityReconnecting: string;
  activityOffline: string;
  activityRefresh: string;
  activityInterrupt: string;
  activityInterruptConfirmTitle: string;
  activityInterruptConfirmDescription: string;
  activityInterruptConfirm: string;
  activityInterruptCancel: string;
  activityInterruptFailed: string;
  activityPause: string;
  activityResume: string;
  activityTerminate: string;
  activityTerminateConfirmTitle: string;
  activityTerminateConfirmDescription: string;
  activityTerminateConfirm: string;
  activityTerminateCancel: string;
  activityJobControlFailed: string;
  activityTimelineShow: string;
  activityTimelineHide: string;
  activityTimelineTitle: string;
  activityTimelineEmpty: string;
  activityTimelineLoadFailed: string;
  activityActive: string;
  activityRunning: string;
  activityWaitingApproval: string;
  activityPaused: string;
  activityTotal: string;
  activityNoActiveTitle: string;
  activityNoActiveDescription: string;
  activityRecentTitle: string;
  activityRecentDescription: string;
  activityKindAgent: string;
  activityKindJob: string;
  activityScopeWorkspace: string;
  activityScopeRepo: string;
  activityScopeHost: string;
  activityRuntime: string;
  activityJob: string;
  activityGrant: string;
  activityTrace: string;
  activityWorker: string;
  activityProcesses: string;
  activityLastEvent: string;
  activityEventRunStarted: string;
  activityEventRunCompleted: string;
  activityEventRunFailed: string;
  activityEventRunInterrupted: string;
  activityEventJobPaused: string;
  activityEventJobResumed: string;
  activityEventJobTerminated: string;
  activityEventStepStarted: string;
  activityEventStepCompleted: string;
  activityEventApprovalRequired: string;
  activityEventApprovalResolved: string;
  activityEventApprovalRejected: string;
  activityEventWarning: string;
  activityEventError: string;
  activityEventActivity: string;
  activityUpdated: string;
  activityUnknownAuthority: string;
  activityLoadFailed: string;
  providerManagementTitle: string;
  providerManagementDescription: string;
  noManagedProvidersTitle: string;
  noManagedProvidersDescription: string;
  supportTier: string;
  managedTier: string;
  observedTier: string;
  connectedTier: string;
  catalogOnlyTier: string;
  detection: string;
  configuration: string;
  exposure: string;
  verification: string;
  lifecycleActions: string;
  noLifecycleActions: string;
  detected: string;
  notObserved: string;
  notDetected: string;
  unverified: string;
  stale: string;
  configured: string;
  notConfigured: string;
  providerNative: string;
  exposureEnabled: string;
  exposureDisabled: string;
  profilesTitle: string;
  profilesDescription: string;
  noProfilesTitle: string;
  noProfilesDescription: string;
  selected: string;
  version: string;
  protocol: string;
  auth: string;
  compatibility: string;
  source: string;
  capabilities: string;
  workspace: string;
  workspaceRequired: string;
  workspaceUnavailable: string;
  refreshInventory: string;
  refreshingInventory: string;
  inventoryEmptyTitle: string;
  inventoryEmptyDescription: string;
  snapshotTitle: string;
  snapshotDescription: string;
  capturedAt: string;
  snapshotStatus: string;
  resources: string;
  added: string;
  changed: string;
  removed: string;
  unchanged: string;
  diagnostics: string;
  replayed: string;
  liveRead: string;
  all: string;
  skills: string;
  mcpServers: string;
  plugins: string;
  adapters: string;
  agents: string;
  resourceName: string;
  scope: string;
  enabled: string;
  installed: string;
  update: string;
  details: string;
  inspect: string;
  noResourcesTitle: string;
  noResourcesDescription: string;
  resourceDetailsTitle: string;
  externalId: string;
  availableVersion: string;
  reason: string;
  fingerprint: string;
  yes: string;
  no: string;
  unknown: string;
  none: string;
  ready: string;
  degraded: string;
  unavailable: string;
  unsupported: string;
  required: string;
  blocked: string;
  current: string;
  updateAvailable: string;
  notApplicable: string;
  userScope: string;
  workspaceScope: string;
  runtimeScope: string;
  registryScope: string;
  unknownScope: string;
  runtimeNative: string;
  legacyLocal: string;
  acpRegistry: string;
  mutationActions: string;
  mutationActivity: string;
  prepareChange: string;
  reviewChangeTitle: string;
  approveAndExecute: string;
  denyChange: string;
  cancelChange: string;
  pendingApproval: string;
  approvedMutation: string;
  deniedMutation: string;
  expiredMutation: string;
  consumedMutation: string;
  executingMutation: string;
  verifiedMutation: string;
  externalMutationFailed: string;
  mutationVerificationFailed: string;
  mutationTargetChanged: string;
  beforeState: string;
  requestedState: string;
  approvalExpires: string;
  authoritativeRefreshRequired: string;
  mutationExposureDisabled: string;
  mutationEligible: string;
  mutationUnavailable: string;
  skillEnable: string;
  skillDisable: string;
  pluginInstall: string;
  pluginUninstall: string;
  mutationSuccessTitle: string;
  mutationFailedTitle: string;
}

const zhCN: ResourceCenterCopy = {
  title: "资源中心",
  description: "统一管理 ChatCockpit 当前设备上的 Provider、Capability、暴露状态与运行资源；底层工具继续持有自己的真实配置与运行状态。",
  truthNotice: "Provider-native truth 始终优先。ChatCockpit 只投影已验证的检测、版本、健康、能力与暴露状态；没有正式生命周期合同的 Provider 不会伪造安装、更新、启动或重启按钮。",
  loadingTitle: "正在加载 Provider 管理状态",
  loadingDescription: "正在读取 Provider、Runtime Profile 与已验证能力状态。",
  protectedTitle: "资源中心需要控制台管理员会话",
  protectedDescription: "当前接口受保护。请重新登录控制台管理员账户后读取 Runtime 与资源状态。",
  requestFailedTitle: "资源中心请求失败",
  activityTitle: "运行活动",
  activityDescription: "实时观察当前设备上正在执行、等待批准或排队的 Agent Session 与独立任务；Project/Workspace 不是 Host 级任务的前置条件。",
  activityLive: "实时",
  activityConnecting: "连接中",
  activityReconnecting: "正在重连",
  activityOffline: "未连接",
  activityRefresh: "刷新",
  activityInterrupt: "中断运行",
  activityInterruptConfirmTitle: "中断当前 Codex 运行？",
  activityInterruptConfirmDescription: "这会停止当前 Turn、释放写入租约，并将会话转入可接力状态。",
  activityInterruptConfirm: "确认中断",
  activityInterruptCancel: "取消",
  activityInterruptFailed: "中断运行失败，可安全重试。",
  activityPause: "暂停任务",
  activityResume: "继续任务",
  activityTerminate: "终止任务",
  activityTerminateConfirmTitle: "终止这个任务进程？",
  activityTerminateConfirmDescription: "这会停止当前受管任务进程。该操作不会终止其他 Activity，也不会撤销 OAuth 授权。",
  activityTerminateConfirm: "确认终止",
  activityTerminateCancel: "取消",
  activityJobControlFailed: "任务控制失败，可安全重试。",
  activityTimelineShow: "运行记录",
  activityTimelineHide: "收起记录",
  activityTimelineTitle: "运行时间线",
  activityTimelineEmpty: "当前还没有可公开展示的运行事件。",
  activityTimelineLoadFailed: "运行记录读取失败。",
  activityActive: "活跃",
  activityRunning: "运行中",
  activityWaitingApproval: "等待批准",
  activityPaused: "已暂停",
  activityTotal: "全部",
  activityNoActiveTitle: "当前没有活跃任务",
  activityNoActiveDescription: "新的 Agent Session 或 Host 任务开始后会自动出现在这里，无需手动刷新。",
  activityRecentTitle: "最近活动",
  activityRecentDescription: "仅保留最近完成、失败或终止的条目，避免历史任务淹没当前运行态。",
  activityKindAgent: "Agent Session",
  activityKindJob: "独立任务",
  activityScopeWorkspace: "Workspace",
  activityScopeRepo: "Repository",
  activityScopeHost: "Host",
  activityRuntime: "Runtime",
  activityJob: "任务",
  activityGrant: "授权关系",
  activityTrace: "Trace",
  activityWorker: "Worker",
  activityProcesses: "受管进程",
  activityLastEvent: "最近动态",
  activityEventRunStarted: "运行已开始",
  activityEventRunCompleted: "运行已完成",
  activityEventRunFailed: "运行失败",
  activityEventRunInterrupted: "运行已中断",
  activityEventJobPaused: "任务已暂停",
  activityEventJobResumed: "任务已继续",
  activityEventJobTerminated: "任务已终止",
  activityEventStepStarted: "工作步骤已开始",
  activityEventStepCompleted: "工作步骤已完成",
  activityEventApprovalRequired: "等待操作员批准",
  activityEventApprovalResolved: "批准流程已处理",
  activityEventApprovalRejected: "批准请求已拒绝",
  activityEventWarning: "运行警告",
  activityEventError: "运行错误",
  activityEventActivity: "运行状态已更新",
  activityUpdated: "更新",
  activityUnknownAuthority: "未绑定授权",
  activityLoadFailed: "运行活动暂时无法读取。Provider 与资源清单仍可继续使用。",
  providerManagementTitle: "Provider 管理",
  providerManagementDescription: "统一的 Provider 管理视图：检测、版本、健康、配置来源、Chat 暴露与 Provider-native verification 都从同一 public-safe 合同读取。",
  noManagedProvidersTitle: "暂无可管理 Provider",
  noManagedProvidersDescription: "当前没有可安全投影的 Provider 条目。",
  supportTier: "支持级别",
  managedTier: "Managed",
  observedTier: "Observed",
  connectedTier: "Connected",
  catalogOnlyTier: "Catalog-only",
  detection: "检测",
  configuration: "配置",
  exposure: "Chat 暴露",
  verification: "验证",
  lifecycleActions: "生命周期动作",
  noLifecycleActions: "暂无受管生命周期动作",
  detected: "已检测",
  notObserved: "未观测",
  notDetected: "未检测到",
  unverified: "未验证",
  stale: "已过期",
  configured: "ChatCockpit 配置",
  notConfigured: "未配置",
  providerNative: "Provider Native",
  exposureEnabled: "已暴露",
  exposureDisabled: "未暴露",
  profilesTitle: "运行时配置",
  profilesDescription: "选择一个明确的运行时配置，再按需刷新它的 authoritative inventory。",
  noProfilesTitle: "暂无可用运行时配置",
  noProfilesDescription: "当前没有发现可安全投影的运行时配置。请检查本机 Runtime 配置后刷新。",
  selected: "当前",
  version: "版本",
  protocol: "协议",
  auth: "认证",
  compatibility: "兼容性",
  source: "来源",
  capabilities: "能力",
  workspace: "工作区",
  workspaceRequired: "Codex 资源发现需要明确的 ChatCockpit Workspace。",
  workspaceUnavailable: "当前没有可用工作区，请先在连续性工作台注册或恢复 Workspace。",
  refreshInventory: "刷新资源清单",
  refreshingInventory: "正在刷新资源清单",
  inventoryEmptyTitle: "尚未读取资源清单",
  inventoryEmptyDescription: "选择运行时配置后点击“刷新资源清单”，ChatCockpit 才会通过已审查 Adapter 读取真实状态并追加一份快照。",
  snapshotTitle: "资源清单快照",
  snapshotDescription: "当前刷新结果与上一份快照的差异。",
  capturedAt: "采集时间",
  snapshotStatus: "快照状态",
  resources: "资源",
  added: "新增",
  changed: "变化",
  removed: "移除",
  unchanged: "未变化",
  diagnostics: "诊断",
  replayed: "幂等回放",
  liveRead: "真实刷新",
  all: "全部",
  skills: "Skills",
  mcpServers: "MCP Servers",
  plugins: "Plugins",
  adapters: "Adapters",
  agents: "ACP Agents",
  resourceName: "资源",
  scope: "作用域",
  enabled: "启用",
  installed: "安装",
  update: "更新",
  details: "详情",
  inspect: "查看",
  noResourcesTitle: "此分类暂无资源",
  noResourcesDescription: "当前 snapshot 没有返回该分类的 public-safe resource。",
  resourceDetailsTitle: "资源详情",
  externalId: "外部标识",
  availableVersion: "可用版本",
  reason: "状态说明",
  fingerprint: "指纹",
  yes: "是",
  no: "否",
  unknown: "未知",
  none: "无",
  ready: "就绪",
  degraded: "降级",
  unavailable: "不可用",
  unsupported: "不支持",
  required: "需要认证",
  blocked: "阻断",
  current: "最新",
  updateAvailable: "有更新",
  notApplicable: "不适用",
  userScope: "用户",
  workspaceScope: "工作区",
  runtimeScope: "Runtime",
  registryScope: "Registry",
  unknownScope: "未知",
  runtimeNative: "Runtime Native",
  legacyLocal: "ChatCockpit Local",
  acpRegistry: "ACP Registry",
  mutationActions: "受治理变更",
  mutationActivity: "最近变更记录",
  prepareChange: "准备变更",
  reviewChangeTitle: "审查 Resource 变更",
  approveAndExecute: "批准并执行",
  denyChange: "拒绝",
  cancelChange: "取消",
  pendingApproval: "待批准",
  approvedMutation: "已批准",
  deniedMutation: "已拒绝",
  expiredMutation: "已过期",
  consumedMutation: "已消费",
  executingMutation: "执行中",
  verifiedMutation: "已验证",
  externalMutationFailed: "外部执行失败",
  mutationVerificationFailed: "验证失败",
  mutationTargetChanged: "目标已变化",
  beforeState: "变更前状态",
  requestedState: "请求状态",
  approvalExpires: "审批过期时间",
  authoritativeRefreshRequired: "只有执行证据为已验证，且 authoritative refresh 重新读取到请求状态后，ChatCockpit 才会显示变更成功。",
  mutationExposureDisabled: "此部署未开启 Resource 写入能力。读取与审计仍可使用；如需变更，请由运维人员显式开启 CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED。",
  mutationEligible: "可受治理变更",
  mutationUnavailable: "当前不可变更",
  skillEnable: "启用 Skill",
  skillDisable: "停用 Skill",
  pluginInstall: "安装 Plugin",
  pluginUninstall: "卸载 Plugin",
  mutationSuccessTitle: "Resource 变更已验证",
  mutationFailedTitle: "Resource 变更未能验证"
};

const enUS: ResourceCenterCopy = {
  title: "Resource Center",
  description: "Manage providers, capabilities, exposure state, and runtime resources on the current ChatCockpit device while each underlying tool remains authoritative for its own real configuration and runtime state.",
  truthNotice: "Provider-native truth remains authoritative. ChatCockpit projects only verified detection, version, health, capability, and exposure state; providers without a reviewed lifecycle contract do not get invented install, update, start, or restart actions.",
  loadingTitle: "Loading provider management state",
  loadingDescription: "Reading providers, Runtime Profiles, and verified capability state.",
  protectedTitle: "Resource Center requires a Web Owner session",
  protectedDescription: "This API is protected. Sign in with the Web Owner account before reading Runtime and resource state.",
  requestFailedTitle: "Resource Center request failed",
  activityTitle: "Operational Activity",
  activityDescription: "Observe Agent Sessions and standalone work that are running, waiting for approval, or queued on this device. Project and Workspace context is optional for host-scoped work.",
  activityLive: "Live",
  activityConnecting: "Connecting",
  activityReconnecting: "Reconnecting",
  activityOffline: "Offline",
  activityRefresh: "Refresh",
  activityInterrupt: "Interrupt run",
  activityInterruptConfirmTitle: "Interrupt this Codex run?",
  activityInterruptConfirmDescription: "This stops the active turn, releases its writer lease, and moves the session to handoff-ready.",
  activityInterruptConfirm: "Interrupt",
  activityInterruptCancel: "Cancel",
  activityInterruptFailed: "Interrupt failed. It is safe to retry.",
  activityPause: "Pause task",
  activityResume: "Resume task",
  activityTerminate: "Terminate task",
  activityTerminateConfirmTitle: "Terminate this task process?",
  activityTerminateConfirmDescription: "This stops the current managed task process. Other activities and OAuth authorizations are not affected.",
  activityTerminateConfirm: "Terminate",
  activityTerminateCancel: "Cancel",
  activityJobControlFailed: "Task control failed. It is safe to retry.",
  activityTimelineShow: "Run history",
  activityTimelineHide: "Hide history",
  activityTimelineTitle: "Run timeline",
  activityTimelineEmpty: "No public-safe runtime events are available yet.",
  activityTimelineLoadFailed: "Run history could not be loaded.",
  activityActive: "Active",
  activityRunning: "Running",
  activityWaitingApproval: "Waiting approval",
  activityPaused: "Paused",
  activityTotal: "Total",
  activityNoActiveTitle: "No active work right now",
  activityNoActiveDescription: "New Agent Sessions and host-scoped jobs appear here automatically without a manual refresh.",
  activityRecentTitle: "Recent activity",
  activityRecentDescription: "Only the latest terminal items are kept visible so historical work does not obscure current execution.",
  activityKindAgent: "Agent Session",
  activityKindJob: "Standalone job",
  activityScopeWorkspace: "Workspace",
  activityScopeRepo: "Repository",
  activityScopeHost: "Host",
  activityRuntime: "Runtime",
  activityJob: "Job",
  activityGrant: "Authorization grant",
  activityTrace: "Trace",
  activityWorker: "Worker",
  activityProcesses: "Managed processes",
  activityLastEvent: "Latest update",
  activityEventRunStarted: "Run started",
  activityEventRunCompleted: "Run completed",
  activityEventRunFailed: "Run failed",
  activityEventRunInterrupted: "Run interrupted",
  activityEventJobPaused: "Task paused",
  activityEventJobResumed: "Task resumed",
  activityEventJobTerminated: "Task terminated",
  activityEventStepStarted: "Work step started",
  activityEventStepCompleted: "Work step completed",
  activityEventApprovalRequired: "Waiting for operator approval",
  activityEventApprovalResolved: "Approval flow resolved",
  activityEventApprovalRejected: "Approval request rejected",
  activityEventWarning: "Runtime warning",
  activityEventError: "Runtime error",
  activityEventActivity: "Runtime state updated",
  activityUpdated: "Updated",
  activityUnknownAuthority: "No grant bound",
  activityLoadFailed: "Operational Activity is temporarily unavailable. Provider and inventory management remain usable.",
  providerManagementTitle: "Provider Management",
  providerManagementDescription: "The Provider Management view projects detection, version, health, configuration source, Chat exposure, and provider-native verification through one public-safe contract.",
  noManagedProvidersTitle: "No managed providers",
  noManagedProvidersDescription: "No safely projected provider entry is currently available.",
  supportTier: "Support tier",
  managedTier: "Managed",
  observedTier: "Observed",
  connectedTier: "Connected",
  catalogOnlyTier: "Catalog-only",
  detection: "Detection",
  configuration: "Configuration",
  exposure: "Chat exposure",
  verification: "Verification",
  lifecycleActions: "Lifecycle actions",
  noLifecycleActions: "No managed lifecycle actions",
  detected: "Detected",
  notObserved: "Not observed",
  notDetected: "Not detected",
  unverified: "Unverified",
  stale: "Stale",
  configured: "ChatCockpit config",
  notConfigured: "Not configured",
  providerNative: "Provider native",
  exposureEnabled: "Exposed",
  exposureDisabled: "Not exposed",
  profilesTitle: "Runtime Profiles",
  profilesDescription: "Choose one explicit Runtime Profile, then refresh its authoritative inventory when needed.",
  noProfilesTitle: "No Runtime Profiles available",
  noProfilesDescription: "No Runtime Profile can currently be projected safely. Check the local runtime configuration and refresh.",
  selected: "Selected",
  version: "Version",
  protocol: "Protocol",
  auth: "Auth",
  compatibility: "Compatibility",
  source: "Source",
  capabilities: "Capabilities",
  workspace: "Workspace",
  workspaceRequired: "Codex resource discovery requires an explicit ChatCockpit Workspace.",
  workspaceUnavailable: "No workspace is currently available. Register or recover one in the Continuity workbench first.",
  refreshInventory: "Refresh inventory",
  refreshingInventory: "Refreshing inventory",
  inventoryEmptyTitle: "Inventory not loaded yet",
  inventoryEmptyDescription: "Select a Runtime Profile and choose Refresh inventory. ChatCockpit will use a reviewed adapter to read real state and append a snapshot.",
  snapshotTitle: "Inventory Snapshot",
  snapshotDescription: "Current inventory result compared with the previous snapshot.",
  capturedAt: "Captured",
  snapshotStatus: "Snapshot status",
  resources: "Resources",
  added: "Added",
  changed: "Changed",
  removed: "Removed",
  unchanged: "Unchanged",
  diagnostics: "Diagnostics",
  replayed: "Idempotent replay",
  liveRead: "Live read",
  all: "All",
  skills: "Skills",
  mcpServers: "MCP Servers",
  plugins: "Plugins",
  adapters: "Adapters",
  agents: "ACP Agents",
  resourceName: "Resource",
  scope: "Scope",
  enabled: "Enabled",
  installed: "Installed",
  update: "Update",
  details: "Details",
  inspect: "Inspect",
  noResourcesTitle: "No resources in this category",
  noResourcesDescription: "The current snapshot contains no public-safe resource for this category.",
  resourceDetailsTitle: "Resource details",
  externalId: "External ID",
  availableVersion: "Available version",
  reason: "Status reason",
  fingerprint: "Fingerprint",
  yes: "Yes",
  no: "No",
  unknown: "Unknown",
  none: "None",
  ready: "Ready",
  degraded: "Degraded",
  unavailable: "Unavailable",
  unsupported: "Unsupported",
  required: "Auth required",
  blocked: "Blocked",
  current: "Current",
  updateAvailable: "Update available",
  notApplicable: "N/A",
  userScope: "User",
  workspaceScope: "Workspace",
  runtimeScope: "Runtime",
  registryScope: "Registry",
  unknownScope: "Unknown",
  runtimeNative: "Runtime Native",
  legacyLocal: "ChatCockpit Local",
  acpRegistry: "ACP Registry",
  mutationActions: "Governed changes",
  mutationActivity: "Recent mutation activity",
  prepareChange: "Prepare change",
  reviewChangeTitle: "Review Resource mutation",
  approveAndExecute: "Approve & execute",
  denyChange: "Deny",
  cancelChange: "Cancel",
  pendingApproval: "Pending approval",
  approvedMutation: "Approved",
  deniedMutation: "Denied",
  expiredMutation: "Expired",
  consumedMutation: "Consumed",
  executingMutation: "Executing",
  verifiedMutation: "Verified",
  externalMutationFailed: "External execution failed",
  mutationVerificationFailed: "Verification failed",
  mutationTargetChanged: "Target changed",
  beforeState: "Before state",
  requestedState: "Requested state",
  approvalExpires: "Approval expires",
  authoritativeRefreshRequired: "ChatCockpit reports success only when the execution is verified and a fresh authoritative inventory confirms the requested state.",
  mutationExposureDisabled: "Resource writes are disabled for this deployment. Read and audit remain available; an operator must explicitly enable CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED before mutations can run.",
  mutationEligible: "Eligible for governed change",
  mutationUnavailable: "Mutation unavailable",
  skillEnable: "Enable Skill",
  skillDisable: "Disable Skill",
  pluginInstall: "Install Plugin",
  pluginUninstall: "Uninstall Plugin",
  mutationSuccessTitle: "Resource mutation verified",
  mutationFailedTitle: "Resource mutation was not verified"
};

export function getResourceCenterCopy(locale: LocaleCode): ResourceCenterCopy {
  return locale === "en-US" ? enUS : zhCN;
}

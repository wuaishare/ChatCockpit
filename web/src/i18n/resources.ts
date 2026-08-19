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
  providerManagementTitle: string;
  providerManagementDescription: string;
  noManagedProvidersTitle: string;
  noManagedProvidersDescription: string;
  detection: string;
  configuration: string;
  exposure: string;
  verification: string;
  lifecycleActions: string;
  noLifecycleActions: string;
  detected: string;
  unverified: string;
  stale: string;
  configured: string;
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
  providerManagementTitle: "Provider 管理",
  providerManagementDescription: "统一的 Provider 管理视图：检测、版本、健康、配置来源、Chat 暴露与 Provider-native verification 都从同一 public-safe 合同读取。",
  noManagedProvidersTitle: "暂无可管理 Provider",
  noManagedProvidersDescription: "当前没有已配置或可安全投影的 Provider。",
  detection: "检测",
  configuration: "配置",
  exposure: "Chat 暴露",
  verification: "验证",
  lifecycleActions: "生命周期动作",
  noLifecycleActions: "暂无受管生命周期动作",
  detected: "已检测",
  unverified: "未验证",
  stale: "已过期",
  configured: "ChatCockpit 配置",
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
  providerManagementTitle: "Provider Management",
  providerManagementDescription: "The Provider Management view projects detection, version, health, configuration source, Chat exposure, and provider-native verification through one public-safe contract.",
  noManagedProvidersTitle: "No managed providers",
  noManagedProvidersDescription: "No configured or safely projected provider is currently available.",
  detection: "Detection",
  configuration: "Configuration",
  exposure: "Chat exposure",
  verification: "Verification",
  lifecycleActions: "Lifecycle actions",
  noLifecycleActions: "No managed lifecycle actions",
  detected: "Detected",
  unverified: "Unverified",
  stale: "Stale",
  configured: "ChatCockpit config",
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

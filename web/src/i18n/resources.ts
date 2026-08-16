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
  title: "运行环境与资源中心",
  description: "统一查看运行时配置及其 Skills、MCP、Plugins、Adapters 与 ACP Agents，并对服务端判定可变更的资源执行受治理操作。",
  truthNotice: "资源配置真源仍由各 Runtime / Registry 持有。ChatCockpit 只允许服务端明确判定可用的 Skill 启停与安全 Plugin 安装/卸载进入变更流程；每次变更都必须先审批，并以 authoritative refresh 验证后的真实状态为准。",
  loadingTitle: "正在加载运行时配置",
  loadingDescription: "正在读取可用 Runtime 与兼容状态。",
  protectedTitle: "资源中心需要 Web Owner 会话",
  protectedDescription: "当前接口受保护。请重新登录 Web Owner 账户后读取 Runtime 与资源状态。",
  requestFailedTitle: "资源中心请求失败",
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
  title: "Runtime & Resource Center",
  description: "Inspect Runtime Profiles and their Skills, MCP servers, Plugins, Adapters, and ACP Agents, with governed actions only where the server explicitly marks a Resource eligible.",
  truthNotice: "Each Runtime or Registry remains the configuration authority. ChatCockpit permits only server-approved Skill enable/disable and safe Plugin install/uninstall flows; every mutation requires explicit approval and is considered successful only after authoritative refresh verifies the requested state.",
  loadingTitle: "Loading Runtime Profiles",
  loadingDescription: "Reading available runtimes and compatibility state.",
  protectedTitle: "Resource Center requires a Web Owner session",
  protectedDescription: "This API is protected. Sign in with the Web Owner account before reading Runtime and resource state.",
  requestFailedTitle: "Resource Center request failed",
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

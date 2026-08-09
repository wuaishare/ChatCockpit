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
  tokenpilotLocal: string;
  acpRegistry: string;
}

const zhCN: ResourceCenterCopy = {
  title: "Runtime & Resource Center",
  description: "统一查看 Runtime Profile 及其 Skills、MCP、Plugins、Adapters 与 ACP Agents 的权威只读状态。",
  truthNotice: "资源配置仍由各 Runtime / Registry 自己持有。TokenPilot 这里只保存脱敏 observation、fingerprint 与 snapshot history；Phase 6A 不执行安装、更新、启停或认证。",
  loadingTitle: "正在加载 Runtime Profiles",
  loadingDescription: "正在读取可用 Runtime 与兼容状态。",
  protectedTitle: "Resource Center 需要浏览器会话令牌",
  protectedDescription: "当前接口受保护。请先在顶部设置 TOKENPILOT_API_TOKEN，再读取 Runtime 与资源状态。",
  requestFailedTitle: "Resource Center 请求失败",
  profilesTitle: "Runtime Profiles",
  profilesDescription: "选择一个明确的 Runtime Profile，再按需刷新它的 authoritative inventory。",
  noProfilesTitle: "暂无可用 Runtime Profile",
  noProfilesDescription: "当前没有发现可安全投影的 Runtime Profile。请检查本机 Runtime 配置后刷新。",
  selected: "当前",
  version: "版本",
  protocol: "协议",
  auth: "认证",
  compatibility: "兼容性",
  source: "来源",
  capabilities: "能力",
  workspace: "工作区",
  workspaceRequired: "Codex 资源发现需要明确的 TokenPilot Workspace。",
  workspaceUnavailable: "当前没有可用工作区，请先在连续性工作台注册或恢复 Workspace。",
  refreshInventory: "刷新资源清单",
  refreshingInventory: "正在刷新资源清单",
  inventoryEmptyTitle: "尚未读取资源清单",
  inventoryEmptyDescription: "选择 Runtime Profile 后点击“刷新资源清单”，TokenPilot 才会通过已审查 Adapter 读取真实状态并追加一份 snapshot。",
  snapshotTitle: "Inventory Snapshot",
  snapshotDescription: "当前刷新结果与上一份 snapshot 的差异。",
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
  fingerprint: "Fingerprint",
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
  tokenpilotLocal: "TokenPilot Local",
  acpRegistry: "ACP Registry"
};

const enUS: ResourceCenterCopy = {
  title: "Runtime & Resource Center",
  description: "Inspect authoritative read-only Runtime Profiles and their Skills, MCP servers, Plugins, Adapters, and ACP Agents.",
  truthNotice: "Each Runtime or Registry remains the configuration authority. TokenPilot stores only public-safe observations, fingerprints, and snapshot history here; Phase 6A performs no install, update, enable/disable, or authentication actions.",
  loadingTitle: "Loading Runtime Profiles",
  loadingDescription: "Reading available runtimes and compatibility state.",
  protectedTitle: "Resource Center requires a browser session token",
  protectedDescription: "This API is protected. Set TOKENPILOT_API_TOKEN in the header before reading Runtime and resource state.",
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
  workspaceRequired: "Codex resource discovery requires an explicit TokenPilot Workspace.",
  workspaceUnavailable: "No workspace is currently available. Register or recover one in the Continuity workbench first.",
  refreshInventory: "Refresh inventory",
  refreshingInventory: "Refreshing inventory",
  inventoryEmptyTitle: "Inventory not loaded yet",
  inventoryEmptyDescription: "Select a Runtime Profile and choose Refresh inventory. TokenPilot will use a reviewed adapter to read real state and append a snapshot.",
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
  tokenpilotLocal: "TokenPilot Local",
  acpRegistry: "ACP Registry"
};

export function getResourceCenterCopy(locale: LocaleCode): ResourceCenterCopy {
  return locale === "en-US" ? enUS : zhCN;
}

import type { LocaleCode } from "../i18n";

export interface IntegrationsCopy {
  localCockpit: string;
  lanCockpit: string;
  publicCockpit: string;
  notConfigured: string;
  ready: string;
  needsAttention: string;
  disabled: string;
  primaryTag: string;
  advancedTag: string;
  compatibilityTag: string;
  chatgptTitle: string;
  chatgptDescription: string;
  mcpEndpoint: string;
  oauthStatus: string;
  oauthScope: string;
  authorizedClients: string;
  activeAuthorizationGrants: string;
  activeAccessTokens: string;
  activeRefreshTokens: string;
  toolCatalog: string;
  tools: string;
  coreTools: string;
  fullTools: string;
  mcpServerVersion: string;
  catalogFingerprint: string;
  toolsInvoke: string;
  published: string;
  notPublished: string;
  toolSnapshotGuidance: string;
  toolSnapshotReady: string;
  toolSnapshotMissingGateway: string;
  reconnectGuidance: string;
  reconnectReady: string;
  reconnectNeedsAttention: string;
  apiTitle: string;
  apiDescription: string;
  localApiBase: string;
  publicApiBase: string;
  openapiUrl: string;
  machineAuth: string;
  configured: string;
  apiBoundary: string;
  customGptTitle: string;
  customGptDescription: string;
  customGptBoundary: string;
  instructions: string;
  schemaImportUrl: string;
  copyInstructions: string;
  copyUrl: string;
  loadingTitle: string;
  loadingDescription: string;
  authorizationGrantsTitle: string;
  authorizationGrantsDescription: string;
  authorizationGrantsEmpty: string;
  authorizationGrantsFilterEmpty: string;
  grantFilterActive: string;
  grantFilterPending: string;
  grantFilterInactive: string;
  grantFilterRevoked: string;
  grantFilterAll: string;
  grantStatusPending: string;
  grantStatusActive: string;
  grantStatusInactive: string;
  grantStatusRevoked: string;
  grantLegacy: string;
  grantId: string;
  grantClient: string;
  grantScope: string;
  grantCreatedAt: string;
  grantLastTokenIssuedAt: string;
  grantActiveTokens: string;
  revokeGrant: string;
  revokeGrantTitle: string;
  revokeGrantDescription: string;
  revokeGrantConfirm: string;
  revokeGrantCancel: string;
  grantLoadFailed: string;
  grantApiVersionMismatch: string;
  grantRevokeFailed: string;
  deviceAccessManage: string;
  deviceAccessHide: string;
  deviceAccessTitle: string;
  deviceAccessDescription: string;
  deviceAccessLoading: string;
  deviceAccessLocal: string;
  deviceAccessRemote: string;
  deviceAccessAvailable: string;
  deviceAccessRevoked: string;
  deviceAccessMissing: string;
  deviceAccessEffective: string;
  deviceAccessLevelReadOnly: string;
  deviceAccessLevelProjectWrite: string;
  deviceAccessLevelProjectExec: string;
  deviceAccessLevelFullAccess: string;
  deviceAccessFullAccessTitle: string;
  deviceAccessFullAccessDescription: string;
  deviceAccessFullAccessConfirm: string;
  deviceAccessFullAccessCancel: string;
  deviceAccessGranted: string;
  deviceAccessNotGranted: string;
  deviceAccessGrant: string;
  deviceAccessRemove: string;
  deviceAccessLoadFailed: string;
  deviceAccessMutationFailed: string;
  deviceAccessRetry: string;
  requestFailed: string;
}

const zhCN: IntegrationsCopy = {
  localCockpit: "本机控制台",
  lanCockpit: "局域网控制台",
  publicCockpit: "公网控制台",
  notConfigured: "未配置",
  ready: "就绪",
  needsAttention: "需要处理",
  disabled: "未启用",
  primaryTag: "主要方式",
  advancedTag: "高级",
  compatibilityTag: "兼容方式",
  chatgptTitle: "ChatGPT App / MCP",
  chatgptDescription: "ChatGPT 连接 ChatCockpit 的首选方式。OAuth 设备权限可独立分级，最高可授予完全访问，但不会继承控制台 Owner 身份或机器 API 凭据。",
  mcpEndpoint: "MCP 地址",
  oauthStatus: "OAuth 状态",
  oauthScope: "OAuth Scope",
  authorizedClients: "已授权客户端",
  activeAuthorizationGrants: "有效授权关系",
  activeAccessTokens: "有效 Access Token",
  activeRefreshTokens: "有效 Refresh Token",
  toolCatalog: "工具目录",
  tools: "个工具",
  coreTools: "Core",
  fullTools: "Full",
  mcpServerVersion: "MCP Server 版本",
  catalogFingerprint: "Core 目录指纹",
  toolsInvoke: "tools.invoke 网关",
  published: "已发布",
  notPublished: "未发布",
  toolSnapshotGuidance: "工具快照诊断",
  toolSnapshotReady: "服务端已发布当前 MCP 工具面。ChatCockpit 无法读取 ChatGPT 当前会话缓存的工具快照；如果当前对话仍看不到 tools.invoke，或工具数量明显少于服务端目录，请在 ChatGPT 中刷新或重新连接该连接器。",
  toolSnapshotMissingGateway: "当前服务端尚未发布 tools.invoke。请先更新并重启 ChatCockpit Runtime，再刷新 ChatGPT 连接器。",
  reconnectGuidance: "连接建议",
  reconnectReady: "MCP 与 OAuth 已就绪。如需重新授权，请在 ChatGPT 中重新连接；撤销旧授权后不会影响控制台管理员会话。",
  reconnectNeedsAttention: "Remote MCP 尚未完整就绪。请先完成公网地址和控制台管理员配置，再从 ChatGPT 发起连接。机器 API 令牌不是 OAuth 前置条件。",
  apiTitle: "API 与 OpenAPI",
  apiDescription: "面向自动化、CLI 与高级客户端的机器接口。浏览器 Web 登录不使用机器 API 令牌。",
  localApiBase: "本机 API 基址",
  publicApiBase: "公网 API 基址",
  openapiUrl: "OpenAPI 地址",
  machineAuth: "机器 API 认证",
  configured: "已配置",
  apiBoundary: "机器 API 令牌与控制台管理员、ChatGPT OAuth 完全分离，仅供 CLI、自动化或其他机器客户端按需使用；OAuth 不依赖机器令牌。此页面只显示配置状态，不读取或展示令牌值。",
  customGptTitle: "Custom GPT Actions",
  customGptDescription: "保留给旧版 GPT Actions / OpenAPI Schema 工作流的兼容入口，不再作为 ChatGPT 集成的首选路径。",
  customGptBoundary: "新连接优先使用上方 ChatGPT App / MCP。只有明确需要 Custom GPT Actions 时才使用这里的说明与 Schema。",
  instructions: "兼容说明",
  schemaImportUrl: "Schema 导入地址",
  copyInstructions: "复制兼容说明",
  copyUrl: "复制地址",
  loadingTitle: "正在读取集成与授权状态",
  loadingDescription: "正在从当前控制台管理员会话读取 OAuth、机器接口状态与工具目录。",
  authorizationGrantsTitle: "OAuth 授权关系",
  authorizationGrantsDescription: "每次控制台管理员批准都会形成独立授权关系。默认只显示有效授权，可按状态切换查看并单独管理对应令牌族与设备权限。",
  authorizationGrantsEmpty: "当前没有 OAuth 授权关系。",
  authorizationGrantsFilterEmpty: "当前分组没有授权关系。",
  grantFilterActive: "有效",
  grantFilterPending: "等待兑换",
  grantFilterInactive: "无有效令牌",
  grantFilterRevoked: "已撤销",
  grantFilterAll: "全部",
  grantStatusPending: "等待客户端兑换",
  grantStatusActive: "有效",
  grantStatusInactive: "无有效令牌",
  grantStatusRevoked: "已撤销",
  grantLegacy: "历史迁移",
  grantId: "授权 ID",
  grantClient: "客户端注册",
  grantScope: "Scope",
  grantCreatedAt: "授权时间",
  grantLastTokenIssuedAt: "最近签发",
  grantActiveTokens: "有效令牌",
  revokeGrant: "撤销授权",
  revokeGrantTitle: "撤销这条 OAuth 授权？",
  revokeGrantDescription: "该授权下仍有效的 Access / Refresh Token 会立即失效。其他授权关系与控制台管理员会话不受影响。",
  revokeGrantConfirm: "确认撤销",
  revokeGrantCancel: "取消",
  grantLoadFailed: "无法读取 OAuth 授权关系",
  grantApiVersionMismatch: "OAuth 授权管理接口暂不可用。当前 Web 与 Control Plane 版本可能未同步，请更新或重启 ChatCockpit 服务。",
  grantRevokeFailed: "撤销 OAuth 授权失败",
  deviceAccessManage: "管理设备权限",
  deviceAccessHide: "收起设备权限",
  deviceAccessTitle: "设备访问权限",
  deviceAccessDescription: "每台设备可独立设为项目只读、项目写入、项目执行或完全访问。项目执行适合常规开发；完全访问还开放受信 Host / Device 管理和精确 Host 操作自动批准。新加入的远程设备不会自动继承权限。",
  deviceAccessLoading: "正在读取设备权限",
  deviceAccessLocal: "本机",
  deviceAccessRemote: "远程设备",
  deviceAccessAvailable: "可用",
  deviceAccessRevoked: "设备已撤销",
  deviceAccessMissing: "设备不可用",
  deviceAccessEffective: "当前有效",
  deviceAccessLevelReadOnly: "项目只读",
  deviceAccessLevelProjectWrite: "项目写入",
  deviceAccessLevelProjectExec: "项目执行",
  deviceAccessLevelFullAccess: "完全访问",
  deviceAccessFullAccessTitle: "授予完全访问？",
  deviceAccessFullAccessDescription: "完全访问会允许这条 OAuth 授权在该设备上执行项目开发、Host / Device 管理，并自动批准精确 Host 操作。仅应授予您明确信任的客户端。",
  deviceAccessFullAccessConfirm: "授予完全访问",
  deviceAccessFullAccessCancel: "取消",
  deviceAccessGranted: "已授权",
  deviceAccessNotGranted: "未授权",
  deviceAccessGrant: "授权访问",
  deviceAccessRemove: "移除权限",
  deviceAccessLoadFailed: "无法读取设备访问权限",
  deviceAccessMutationFailed: "更新设备访问权限失败",
  deviceAccessRetry: "重新读取",
  requestFailed: "无法读取集成与授权状态"
};

const enUS: IntegrationsCopy = {
  localCockpit: "Local Cockpit",
  lanCockpit: "LAN Cockpit",
  publicCockpit: "Public Cockpit",
  notConfigured: "Not configured",
  ready: "Ready",
  needsAttention: "Needs attention",
  disabled: "Disabled",
  primaryTag: "Primary",
  advancedTag: "Advanced",
  compatibilityTag: "Compatibility",
  chatgptTitle: "ChatGPT App / MCP",
  chatgptDescription: "The preferred way to connect ChatGPT to ChatCockpit. OAuth access is tiered per device up to Full access, but never inherits the Web Owner identity or machine API credentials.",
  mcpEndpoint: "MCP endpoint",
  oauthStatus: "OAuth status",
  oauthScope: "OAuth scope",
  authorizedClients: "Authorized clients",
  activeAuthorizationGrants: "Active authorization grants",
  activeAccessTokens: "Active access tokens",
  activeRefreshTokens: "Active refresh tokens",
  toolCatalog: "Tool catalog",
  tools: "tools",
  coreTools: "Core",
  fullTools: "Full",
  mcpServerVersion: "MCP server version",
  catalogFingerprint: "Core catalog fingerprint",
  toolsInvoke: "tools.invoke gateway",
  published: "Published",
  notPublished: "Not published",
  toolSnapshotGuidance: "Tool snapshot diagnostics",
  toolSnapshotReady: "The server has published the current MCP tool surface. ChatCockpit cannot inspect the tool snapshot cached by the current ChatGPT conversation; if tools.invoke is still missing or the visible tool count is clearly older than the server catalog, refresh or reconnect this connector in ChatGPT.",
  toolSnapshotMissingGateway: "This server has not published tools.invoke yet. Update and restart the ChatCockpit Runtime before refreshing the ChatGPT connector.",
  reconnectGuidance: "Connection guidance",
  reconnectReady: "MCP and OAuth are ready. Reconnect from ChatGPT when a fresh authorization is needed; revoking OAuth does not revoke Web Owner sessions.",
  reconnectNeedsAttention: "Remote MCP is not fully ready. Configure the public origin and Web Owner before connecting from ChatGPT. A machine API token is optional and is not an OAuth prerequisite.",
  apiTitle: "API & OpenAPI",
  apiDescription: "Machine interfaces for automation, CLI, and advanced clients. Browser Web login does not use the machine API token.",
  localApiBase: "Local API base",
  publicApiBase: "Public API base",
  openapiUrl: "OpenAPI URL",
  machineAuth: "Machine API auth",
  configured: "Configured",
  apiBoundary: "Machine API authority is separate from Web Owner and ChatGPT OAuth, and is optional for CLI, automation, or other machine clients. OAuth does not depend on the machine token. This page shows configuration state only and never reads or displays the token value.",
  customGptTitle: "Custom GPT Actions",
  customGptDescription: "Compatibility surface for legacy GPT Actions / OpenAPI Schema workflows. It is no longer the primary ChatGPT integration path.",
  customGptBoundary: "Prefer ChatGPT App / MCP above for new connections. Use these instructions and Schema only when Custom GPT Actions are explicitly required.",
  instructions: "Compatibility instructions",
  schemaImportUrl: "Schema import URL",
  copyInstructions: "Copy compatibility instructions",
  copyUrl: "Copy URL",
  loadingTitle: "Loading connections & access",
  loadingDescription: "Reading OAuth, machine-interface state, and the tool catalog through the current Web Owner session.",
  authorizationGrantsTitle: "OAuth authorizations",
  authorizationGrantsDescription: "Each Web Owner approval creates an independent authorization. Active authorizations are shown by default; switch status groups to review token families and per-device access independently.",
  authorizationGrantsEmpty: "There are no OAuth authorizations yet.",
  authorizationGrantsFilterEmpty: "There are no authorizations in this group.",
  grantFilterActive: "Active",
  grantFilterPending: "Awaiting exchange",
  grantFilterInactive: "No active tokens",
  grantFilterRevoked: "Revoked",
  grantFilterAll: "All",
  grantStatusPending: "Awaiting token exchange",
  grantStatusActive: "Active",
  grantStatusInactive: "No active tokens",
  grantStatusRevoked: "Revoked",
  grantLegacy: "Migrated legacy",
  grantId: "Authorization ID",
  grantClient: "Client registration",
  grantScope: "Scope",
  grantCreatedAt: "Authorized",
  grantLastTokenIssuedAt: "Last token issued",
  grantActiveTokens: "Active tokens",
  revokeGrant: "Revoke authorization",
  revokeGrantTitle: "Revoke this OAuth authorization?",
  revokeGrantDescription: "All still-active access and refresh tokens in this authorization will stop working immediately. Other authorizations and Web Owner sessions are unaffected.",
  revokeGrantConfirm: "Revoke",
  revokeGrantCancel: "Cancel",
  grantLoadFailed: "Unable to load OAuth authorizations",
  grantApiVersionMismatch: "The OAuth authorization management API is unavailable. The Web UI and Control Plane may be on different versions; update or restart ChatCockpit.",
  grantRevokeFailed: "Unable to revoke OAuth authorization",
  deviceAccessManage: "Manage device access",
  deviceAccessHide: "Hide device access",
  deviceAccessTitle: "Device access",
  deviceAccessDescription: "Each device can be set independently to project read-only, project write, project execution, or Full access. Project execution is intended for normal development; Full access also enables trusted Host / Device administration and auto-approval of exact Host operations. Newly enrolled remote devices inherit nothing.",
  deviceAccessLoading: "Loading device access",
  deviceAccessLocal: "This device",
  deviceAccessRemote: "Remote device",
  deviceAccessAvailable: "Available",
  deviceAccessRevoked: "Device revoked",
  deviceAccessMissing: "Device unavailable",
  deviceAccessEffective: "Effective now",
  deviceAccessLevelReadOnly: "Project read-only",
  deviceAccessLevelProjectWrite: "Project write",
  deviceAccessLevelProjectExec: "Project execution",
  deviceAccessLevelFullAccess: "Full access",
  deviceAccessFullAccessTitle: "Grant Full access?",
  deviceAccessFullAccessDescription: "Full access allows this OAuth authorization to perform project development and Host / Device administration on this device, including auto-approval of exact Host operations. Grant it only to a client you explicitly trust.",
  deviceAccessFullAccessConfirm: "Grant Full access",
  deviceAccessFullAccessCancel: "Cancel",
  deviceAccessGranted: "Allowed",
  deviceAccessNotGranted: "Not allowed",
  deviceAccessGrant: "Allow access",
  deviceAccessRemove: "Remove access",
  deviceAccessLoadFailed: "Unable to load device access",
  deviceAccessMutationFailed: "Unable to update device access",
  deviceAccessRetry: "Retry",
  requestFailed: "Unable to load connections & access"
};

export function getIntegrationsCopy(locale: LocaleCode): IntegrationsCopy {
  return locale === "zh-CN" ? zhCN : enUS;
}

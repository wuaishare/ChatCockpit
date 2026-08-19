import type { LocaleCode } from "../i18n";

export interface IntegrationsCopy {
  localCockpit: string;
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
  grantRevokeFailed: string;
  requestFailed: string;
}

const zhCN: IntegrationsCopy = {
  localCockpit: "本机控制台",
  publicCockpit: "公网控制台",
  notConfigured: "未配置",
  ready: "就绪",
  needsAttention: "需要处理",
  disabled: "未启用",
  primaryTag: "主要方式",
  advancedTag: "高级",
  compatibilityTag: "兼容方式",
  chatgptTitle: "ChatGPT App / MCP",
  chatgptDescription: "ChatGPT 连接 ChatCockpit 的首选方式。OAuth 只授予 chatcockpit:mcp，不继承控制台管理员或机器 API 权限。",
  mcpEndpoint: "MCP 地址",
  oauthStatus: "OAuth 状态",
  oauthScope: "OAuth Scope",
  authorizedClients: "已授权客户端",
  activeAuthorizationGrants: "有效授权关系",
  activeAccessTokens: "有效 Access Token",
  activeRefreshTokens: "有效 Refresh Token",
  toolCatalog: "工具目录",
  tools: "个工具",
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
  loadingTitle: "正在读取集成状态",
  loadingDescription: "正在从当前控制台管理员会话读取 OAuth、机器接口状态与工具目录。",
  authorizationGrantsTitle: "OAuth 授权关系",
  authorizationGrantsDescription: "每次控制台管理员批准都会形成独立授权关系。这里可查看当前状态并单独撤销对应的令牌族，不影响其他授权或控制台会话。",
  authorizationGrantsEmpty: "当前没有 OAuth 授权关系。",
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
  grantRevokeFailed: "撤销 OAuth 授权失败",
  requestFailed: "无法读取集成状态"
};

const enUS: IntegrationsCopy = {
  localCockpit: "Local Cockpit",
  publicCockpit: "Public Cockpit",
  notConfigured: "Not configured",
  ready: "Ready",
  needsAttention: "Needs attention",
  disabled: "Disabled",
  primaryTag: "Primary",
  advancedTag: "Advanced",
  compatibilityTag: "Compatibility",
  chatgptTitle: "ChatGPT App / MCP",
  chatgptDescription: "The preferred way to connect ChatGPT to ChatCockpit. OAuth grants only chatcockpit:mcp and never inherits Web Owner or machine API authority.",
  mcpEndpoint: "MCP endpoint",
  oauthStatus: "OAuth status",
  oauthScope: "OAuth scope",
  authorizedClients: "Authorized clients",
  activeAuthorizationGrants: "Active authorization grants",
  activeAccessTokens: "Active access tokens",
  activeRefreshTokens: "Active refresh tokens",
  toolCatalog: "Tool catalog",
  tools: "tools",
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
  loadingTitle: "Loading integrations",
  loadingDescription: "Reading OAuth, machine-interface state, and the tool catalog through the current Web Owner session.",
  authorizationGrantsTitle: "OAuth authorizations",
  authorizationGrantsDescription: "Each Web Owner approval creates an independent authorization. Review its current state here and revoke one token family without affecting other authorizations or Web Owner sessions.",
  authorizationGrantsEmpty: "There are no OAuth authorizations yet.",
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
  grantRevokeFailed: "Unable to revoke OAuth authorization",
  requestFailed: "Unable to load integrations"
};

export function getIntegrationsCopy(locale: LocaleCode): IntegrationsCopy {
  return locale === "zh-CN" ? zhCN : enUS;
}

import type { LocaleCode } from "../i18n";
import type { PublicRouteVerificationReason } from "../types";

export interface PublicAccessCopy {
  active: string;
  inactive: string;
  ready: string;
  needsAttention: string;
  disabled: string;
  notConfigured: string;
  reachabilityTitle: string;
  reachabilityDescription: string;
  exposureStatus: string;
  localCockpit: string;
  publicCockpit: string;
  localApiBase: string;
  publicApiBase: string;
  protocolsTitle: string;
  protocolsDescription: string;
  openapiUrl: string;
  mcpEndpoint: string;
  oauthStatus: string;
  localProtocolNote: string;
  connectionPathTitle: string;
  connectionPathDescription: string;
  existingEnvironment: string;
  existingEnvironmentDescription: string;
  manualSetup: string;
  manualSetupDescription: string;
  machineBoundary: string;
  providersTitle: string;
  providersDescription: string;
  providerDetected: string;
  providerNotDetected: string;
  providerProbeFailed: string;
  providerManaged: string;
  providerExternalUnmanaged: string;
  providerObserveOnly: string;
  providerMachineActions: string;
  providerUseAppCli: string;
  providerHomebrewRequired: string;
  providerNoMachineAction: string;
  providerStatusUnavailable: string;
  openConnectivityInApp: string;
  connectivityBridgeDescription: string;
  routeIntentTitle: string;
  routeIntentDescription: string;
  currentCanonicalRoute: string;
  candidateRoute: string;
  candidateSource: string;
  candidateOrigin: string;
  noCandidateRoute: string;
  candidateStagedUnverified: string;
  candidateVerified: string;
  candidateVerificationFailed: string;
  candidateNotVerified: string;
  candidateOriginPlaceholder: string;
  stageCandidateRoute: string;
  replaceCandidateRoute: string;
  verifyCandidateRoute: string;
  discardCandidateRoute: string;
  verificationStatus: string;
  verificationDns: string;
  verificationTls: string;
  verificationReachability: string;
  verificationIdentity: string;
  verificationOauth: string;
  verificationReasons: Record<PublicRouteVerificationReason, string>;
  candidateSafetyNote: string;
  candidateStatusUnavailable: string;
  actionInstall: string;
  actionUpgrade: string;
  actionUninstall: string;
  diagnosticsTitle: string;
  diagnosticsDescription: string;
  publicEndpoint: string;
  httpsRequired: string;
  httpsReady: string;
  httpsMissing: string;
  mcpReady: string;
  mcpMissing: string;
  oauthGuidance: string;
  oauthReadyGuidance: string;
  openIntegrations: string;
  copyUrl: string;
  loadingTitle: string;
  loadingDescription: string;
  requestFailed: string;
}

const zhCN: PublicAccessCopy = {
  active: "已启用",
  inactive: "未启用",
  ready: "就绪",
  needsAttention: "需要处理",
  disabled: "未启用",
  notConfigured: "未配置",
  reachabilityTitle: "可达性概览",
  reachabilityDescription: "这些地址直接来自 Runtime 当前投影；缺失值会明确显示为未配置，不会补出一个看似可用的地址。",
  exposureStatus: "公网暴露",
  localCockpit: "本机控制台",
  publicCockpit: "公网控制台",
  localApiBase: "本机 API",
  publicApiBase: "公网 API",
  protocolsTitle: "公开协议端点",
  protocolsDescription: "OpenAPI 与 MCP 复用 Runtime 的现有端点真相；OAuth 状态由 Runtime 的集成状态提供。",
  openapiUrl: "OpenAPI 地址",
  mcpEndpoint: "MCP 端点",
  oauthStatus: "OAuth 状态",
  localProtocolNote: "当前尚无公网 API 基址，因此 OpenAPI 地址仍是本机端点；不会把它标记成公网可用。",
  connectionPathTitle: "接入路径",
  connectionPathDescription: "公网接入工作台负责观察与验证接入结果；本机组件安装、系统服务和明文密钥仍由 ChatCockpit App / CLI 的机器权限边界负责。",
  existingEnvironment: "现有环境",
  existingEnvironmentDescription: "如果你已经通过反向代理、隧道或其他基础设施提供公网入口，继续沿用现有环境；配置 Runtime 的公网基址后回到这里核对真实结果。",
  manualSetup: "手动设置",
  manualSetupDescription: "需要调整监听器或本机接入组件时，请在 ChatCockpit App / CLI 完成本机配置，再回到这里验证公网地址、HTTPS、MCP 与 OAuth 状态。",
  machineBoundary: "本页不会安装接入组件、写入 Provider 密钥、启动隧道或替你切换公网路由。",
  providersTitle: "本机接入组件",
  providersDescription: "这里展示 Runtime 提供的 public-safe 机器能力投影：只包含探测状态、版本、ChatCockpit ownership 与动作可用性，不包含可执行路径、原始命令输出、Plan 或 Provider Secret。",
  providerDetected: "已检测",
  providerNotDetected: "未检测到",
  providerProbeFailed: "探测失败",
  providerManaged: "由 ChatCockpit 管理",
  providerExternalUnmanaged: "外部环境 · 未接管",
  providerObserveOnly: "仅观察 · 尚无机器 Adapter",
  providerMachineActions: "可用机器操作",
  providerUseAppCli: "请在 ChatCockpit App / CLI 执行",
  providerHomebrewRequired: "需要先在此 Mac 安装 Homebrew；ChatCockpit 不会自动安装 Homebrew",
  providerNoMachineAction: "当前没有可用的 ChatCockpit 机器操作",
  providerStatusUnavailable: "暂时无法读取本机接入组件状态；这不会改变当前 Runtime 公网接入结果。",
  openConnectivityInApp: "在 ChatCockpit App 中打开",
  connectivityBridgeDescription: "只导航到 App 的「访问与安全 → 接入组件」区域；不会自动执行安装、升级、卸载或启动 Tunnel。",
  routeIntentTitle: "候选公网 Route",
  routeIntentDescription: "在不影响当前公网入口的前提下暂存并验证下一条候选 HTTPS origin。验证只检查受限的公网 DNS、TLS、ChatCockpit Runtime 可达性与 OAuth 前置条件，不会改写 Runtime 公网基址。",
  currentCanonicalRoute: "当前 canonical",
  candidateRoute: "候选 Route",
  candidateSource: "候选来源",
  candidateOrigin: "候选 HTTPS origin",
  noCandidateRoute: "尚未暂存候选 Route",
  candidateStagedUnverified: "已暂存 · 未验证",
  candidateVerified: "已验证",
  candidateVerificationFailed: "验证失败",
  candidateNotVerified: "尚未验证",
  candidateOriginPlaceholder: "https://candidate.example.com",
  stageCandidateRoute: "暂存候选",
  replaceCandidateRoute: "替换候选",
  verifyCandidateRoute: "验证候选",
  discardCandidateRoute: "丢弃候选",
  verificationStatus: "验证状态",
  verificationDns: "公网 DNS",
  verificationTls: "TLS",
  verificationReachability: "Runtime 可达性",
  verificationIdentity: "ChatCockpit 身份",
  verificationOauth: "OAuth 前置条件",
  verificationReasons: {
    "not-attempted": "未执行",
    "dns-failed": "DNS 解析失败",
    "no-addresses": "未解析到地址",
    "too-many-addresses": "解析地址数量超过安全上限",
    "non-public-address": "解析结果包含非公网地址",
    "tls-error": "TLS 证书或握手失败",
    "network-error": "网络连接失败",
    timeout: "验证请求超时",
    "response-too-large": "响应超过安全大小上限",
    "unexpected-status": "返回了非预期 HTTP 状态",
    "invalid-json": "响应不是有效 JSON",
    "unexpected-health-contract": "不是预期的 ChatCockpit Health 响应",
    "unexpected-oauth-metadata": "OAuth Metadata 不符合预期"
  },
  candidateSafetyNote: "暂存、验证或丢弃候选都不会修改当前 canonical、OAuth issuer、OpenAPI/MCP 地址，也不会启动或切换任何 Tunnel。验证仅使用 public-unicast DNS 与固定 IP HTTPS 探针；显式 cutover 仍是后续独立阶段。",
  candidateStatusUnavailable: "暂时无法读取候选 Route 状态；当前 Runtime 公网入口保持不变。",
  actionInstall: "安装",
  actionUpgrade: "升级",
  actionUninstall: "卸载",
  diagnosticsTitle: "接入诊断",
  diagnosticsDescription: "基于当前 Runtime 投影检查公网地址、HTTPS、MCP 与 OAuth，帮助定位下一步应在公网接入还是集成设置中处理。",
  publicEndpoint: "公网端点",
  httpsRequired: "HTTPS",
  httpsReady: "公网 API 使用 HTTPS",
  httpsMissing: "当前公网 API 不是 HTTPS，不能作为安全的公网接入地址",
  mcpReady: "MCP 公网端点可用",
  mcpMissing: "尚未提供 MCP 公网端点",
  oauthGuidance: "OAuth 尚未就绪，请前往「集成」检查授权配置；不要在公网接入页复制一套 OAuth 管理。",
  oauthReadyGuidance: "OAuth 已就绪；详细客户端与令牌状态继续由「集成」工作台管理。",
  openIntegrations: "前往集成",
  copyUrl: "复制地址",
  loadingTitle: "正在加载公网接入状态",
  loadingDescription: "正在读取 Runtime 的可达性与公开协议端点。",
  requestFailed: "无法读取公网接入状态"
};

const enUS: PublicAccessCopy = {
  active: "Enabled",
  inactive: "Disabled",
  ready: "Ready",
  needsAttention: "Needs attention",
  disabled: "Disabled",
  notConfigured: "Not configured",
  reachabilityTitle: "Reachability overview",
  reachabilityDescription: "These addresses come directly from the current Runtime projection. Missing values stay explicitly unconfigured instead of being replaced with plausible-looking URLs.",
  exposureStatus: "Public exposure",
  localCockpit: "Local Cockpit",
  publicCockpit: "Public Cockpit",
  localApiBase: "Local API",
  publicApiBase: "Public API",
  protocolsTitle: "Public protocol endpoints",
  protocolsDescription: "OpenAPI and MCP reuse the Runtime's existing endpoint truth, while OAuth readiness comes from the Runtime integration status.",
  openapiUrl: "OpenAPI URL",
  mcpEndpoint: "MCP endpoint",
  oauthStatus: "OAuth status",
  localProtocolNote: "No public API base is configured yet, so the OpenAPI URL is still local. It is not presented as publicly reachable.",
  connectionPathTitle: "Connection path",
  connectionPathDescription: "Public Access observes and validates the resulting route. Machine-side connector installation, OS services, and plaintext secrets remain under ChatCockpit App / CLI machine authority.",
  existingEnvironment: "Existing environment",
  existingEnvironmentDescription: "If a reverse proxy, tunnel, or other infrastructure already provides your public entry, keep that environment. Configure the Runtime public base URL and return here to verify the resulting projection.",
  manualSetup: "Manual setup",
  manualSetupDescription: "When the listener or a machine-side connector needs changes, configure it in ChatCockpit App / CLI, then return here to verify the public URL, HTTPS, MCP, and OAuth state.",
  machineBoundary: "This page does not install connectors, write provider secrets, start tunnels, or switch public routes for you.",
  providersTitle: "Machine connectors",
  providersDescription: "This is the Runtime's public-safe machine capability projection: detection, version, ChatCockpit ownership, and action availability only. Executable paths, raw command output, plans, and provider secrets are not exposed.",
  providerDetected: "Detected",
  providerNotDetected: "Not detected",
  providerProbeFailed: "Probe failed",
  providerManaged: "Managed by ChatCockpit",
  providerExternalUnmanaged: "External environment · unmanaged",
  providerObserveOnly: "Observe only · no machine adapter yet",
  providerMachineActions: "Machine actions available",
  providerUseAppCli: "Run them in the ChatCockpit App / CLI",
  providerHomebrewRequired: "Homebrew must already be installed on this Mac; ChatCockpit does not install Homebrew automatically",
  providerNoMachineAction: "No ChatCockpit machine action is currently available",
  providerStatusUnavailable: "Machine connector status is temporarily unavailable. The current Runtime Public Access result is unchanged.",
  openConnectivityInApp: "Open in ChatCockpit App",
  connectivityBridgeDescription: "This only navigates to Access & Security → Connectivity Providers in the App. It never auto-runs install, upgrade, uninstall, or Tunnel startup.",
  routeIntentTitle: "Candidate Public Route",
  routeIntentDescription: "Stage and verify the next HTTPS origin without affecting the working public entry. Verification checks bounded public DNS, TLS, ChatCockpit Runtime reachability, and OAuth prerequisites without rewriting the Runtime public base URL.",
  currentCanonicalRoute: "Current canonical",
  candidateRoute: "Candidate Route",
  candidateSource: "Candidate source",
  candidateOrigin: "Candidate HTTPS origin",
  noCandidateRoute: "No candidate Route is staged",
  candidateStagedUnverified: "Staged · unverified",
  candidateVerified: "Verified",
  candidateVerificationFailed: "Verification failed",
  candidateNotVerified: "Not verified yet",
  candidateOriginPlaceholder: "https://candidate.example.com",
  stageCandidateRoute: "Stage candidate",
  replaceCandidateRoute: "Replace candidate",
  verifyCandidateRoute: "Verify candidate",
  discardCandidateRoute: "Discard candidate",
  verificationStatus: "Verification status",
  verificationDns: "Public DNS",
  verificationTls: "TLS",
  verificationReachability: "Runtime reachability",
  verificationIdentity: "ChatCockpit identity",
  verificationOauth: "OAuth prerequisites",
  verificationReasons: {
    "not-attempted": "Not attempted",
    "dns-failed": "DNS resolution failed",
    "no-addresses": "No addresses were resolved",
    "too-many-addresses": "Resolved address count exceeded the safety limit",
    "non-public-address": "DNS included a non-public address",
    "tls-error": "TLS certificate or handshake failed",
    "network-error": "Network connection failed",
    timeout: "Verification request timed out",
    "response-too-large": "Response exceeded the safety size limit",
    "unexpected-status": "Unexpected HTTP status",
    "invalid-json": "Response was not valid JSON",
    "unexpected-health-contract": "Response was not the expected ChatCockpit Health contract",
    "unexpected-oauth-metadata": "OAuth metadata did not match the expected contract"
  },
  candidateSafetyNote: "Staging, verifying, or discarding a candidate never changes the current canonical origin, OAuth issuer, OpenAPI/MCP addresses, or any Tunnel. Verification uses public-unicast DNS and pinned-address HTTPS probes only; explicit cutover remains a separate later stage.",
  candidateStatusUnavailable: "Candidate Route status is temporarily unavailable. The current Runtime public entry remains unchanged.",
  actionInstall: "Install",
  actionUpgrade: "Upgrade",
  actionUninstall: "Uninstall",
  diagnosticsTitle: "Access diagnostics",
  diagnosticsDescription: "Check public addressing, HTTPS, MCP, and OAuth from the current Runtime projection to see whether the next action belongs in Public Access or Integrations.",
  publicEndpoint: "Public endpoint",
  httpsRequired: "HTTPS",
  httpsReady: "Public API uses HTTPS",
  httpsMissing: "The configured public API is not HTTPS and cannot be treated as a secure public endpoint",
  mcpReady: "Public MCP endpoint is available",
  mcpMissing: "No public MCP endpoint is available yet",
  oauthGuidance: "OAuth is not ready. Open Integrations to inspect authorization instead of duplicating OAuth management in Public Access.",
  oauthReadyGuidance: "OAuth is ready. Detailed client and token state remains in the Integrations workspace.",
  openIntegrations: "Open Integrations",
  copyUrl: "Copy URL",
  loadingTitle: "Loading Public Access",
  loadingDescription: "Reading Runtime reachability and public protocol endpoints.",
  requestFailed: "Unable to load Public Access"
};

export function getPublicAccessCopy(locale: LocaleCode): PublicAccessCopy {
  return locale === "zh-CN" ? zhCN : enUS;
}

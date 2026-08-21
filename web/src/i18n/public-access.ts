import type { LocaleCode } from "../i18n";
import type {
  PublicRouteBootstrapVerificationReason,
  PublicRouteVerificationReason
} from "../types";

export interface PublicAccessCopy {
  active: string;
  inactive: string;
  ready: string;
  needsAttention: string;
  disabled: string;
  notConfigured: string;
  statusOverviewTitle: string;
  statusOverviewDescription: string;
  addressesTitle: string;
  protocolHealthTitle: string;
  exposureStatus: string;
  localCockpit: string;
  lanCockpit: string;
  publicCockpit: string;
  lanAccess: string;
  lanAccessReady: string;
  lanAccessDisabled: string;
  lanAccessLoopbackOnly: string;
  lanAccessNoTrustedAddress: string;
  trustedLanCidrs: string;
  lanAccessReadyDescription: string;
  lanAccessDisabledDescription: string;
  lanAccessLoopbackDescription: string;
  lanAccessNoTrustedAddressDescription: string;
  localApiBase: string;
  publicApiBase: string;
  openapiUrl: string;
  mcpEndpoint: string;
  oauthStatus: string;
  localProtocolNote: string;
  workflowTitle: string;
  workflowDescription: string;
  workflowSetup: string;
  workflowVerify: string;
  workflowCutover: string;
  workflowLive: string;
  workflowBootstrapMode: string;
  workflowReplacementMode: string;
  changePublicAccess: string;
  closePublicAccessMaintenance: string;
  existingEnvironment: string;
  existingEnvironmentDescription: string;
  manualSetup: string;
  manualSetupDescription: string;
  machineBoundary: string;
  providersTitle: string;
  providersDescription: string;
  providerDetailsTitle: string;
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
  bootstrapVerificationReasons: Record<PublicRouteBootstrapVerificationReason, string>;
  bootstrapProofTitle: string;
  bootstrapProofDescription: string;
  bootstrapProofPreparedDescription: string;
  bootstrapProofVerifiedDescription: string;
  bootstrapNotPrepared: string;
  bootstrapPrepared: string;
  bootstrapVerified: string;
  bootstrapVerificationFailed: string;
  bootstrapIdentityCheck: string;
  bootstrapProofExpires: string;
  prepareBootstrapProof: string;
  verifyBootstrapProof: string;
  cancelBootstrapProof: string;
  bootstrapMachinePendingTitle: string;
  bootstrapMachinePendingDescription: string;
  candidateSafetyNote: string;
  candidateStatusUnavailable: string;
  cutoverIntentTitle: string;
  cutoverIntentPending: string;
  cutoverIntentPendingDescription: string;
  cutoverIntentExpires: string;
  cutoverFrom: string;
  cutoverTo: string;
  cutoverReadyTitle: string;
  cutoverReadyDescription: string;
  prepareCutoverIntent: string;
  cancelCutoverIntent: string;
  actionInstall: string;
  actionUpgrade: string;
  actionUninstall: string;
  publicEndpoint: string;
  httpsRequired: string;
  httpsReady: string;
  httpsMissing: string;
  oauthGuidance: string;
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
  statusOverviewTitle: "当前公网状态",
  statusOverviewDescription: "地址与协议状态都直接来自 Runtime 当前投影；未知或未配置的值保持原样，不会补出一个看似可用的结果。",
  addressesTitle: "访问地址",
  protocolHealthTitle: "协议健康",
  exposureStatus: "公网暴露",
  localCockpit: "本机控制台",
  lanCockpit: "局域网控制台",
  publicCockpit: "公网控制台",
  lanAccess: "局域网访问",
  lanAccessReady: "可访问",
  lanAccessDisabled: "未启用",
  lanAccessLoopbackOnly: "仅监听本机",
  lanAccessNoTrustedAddress: "没有可用可信地址",
  trustedLanCidrs: "可信局域网",
  lanAccessReadyDescription: "同一可信局域网内的设备可以通过下面的地址打开 ChatCockpit；进入控制台后仍然需要 Owner 身份认证。",
  lanAccessDisabledDescription: "Trusted LAN 尚未启用。当前只有本机或已配置的公网入口可以访问控制台。",
  lanAccessLoopbackDescription: "Trusted LAN 已启用，但 Runtime 仍只监听回环地址。需要显式扩大监听范围并重启 Runtime，局域网设备才能连接。",
  lanAccessNoTrustedAddressDescription: "Trusted LAN 已启用，但当前监听地址与可信 CIDR 没有形成可用交集。请检查 Runtime 监听地址与局域网网段配置。",
  localApiBase: "本机 API",
  publicApiBase: "公网 API",
  openapiUrl: "OpenAPI 地址",
  mcpEndpoint: "MCP 端点",
  oauthStatus: "OAuth 状态",
  localProtocolNote: "当前尚无公网 API 基址，因此 OpenAPI 地址仍是本机端点；不会把它标记成公网可用。",
  workflowTitle: "公网接入流程",
  workflowDescription: "按准备、验证、切换、在线四个阶段推进。Web 负责接入意图与公网验证，真正的机器执行仍由 ChatCockpit App / CLI 完成。",
  workflowSetup: "准备",
  workflowVerify: "验证",
  workflowCutover: "切换",
  workflowLive: "在线",
  workflowBootstrapMode: "首次公网",
  workflowReplacementMode: "替换现有公网",
  changePublicAccess: "更换公网接入",
  closePublicAccessMaintenance: "收起维护流程",
  existingEnvironment: "现有环境",
  existingEnvironmentDescription: "如果你已经通过反向代理、隧道或其他基础设施提供公网入口，继续沿用现有环境；配置 Runtime 的公网基址后回到这里核对真实结果。",
  manualSetup: "手动设置",
  manualSetupDescription: "需要调整监听器或本机接入组件时，请在 ChatCockpit App / CLI 完成本机配置，再回到这里验证公网地址、HTTPS、MCP 与 OAuth 状态。",
  machineBoundary: "本页不会安装接入组件、写入 Provider 密钥、启动隧道或替你切换公网路由。",
  providersTitle: "本机接入组件",
  providersDescription: "接入组件属于机器侧辅助设置。日常只需关注上面的公网工作流；需要安装、升级或排查 Tunnel 组件时再展开详情或前往 ChatCockpit App。",
  providerDetailsTitle: "查看组件状态",
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
  routeIntentDescription: "暂存候选 HTTPS origin 时不会改写 Runtime 公网基址。已有 canonical 时使用公网 DNS、TLS、Runtime Health 与 OAuth identity 验证 replacement Route；首次公网接入时改用 machine-local challenge 的 Bootstrap Identity Proof。",
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
  bootstrapVerificationReasons: {
    "not-attempted": "未执行",
    "dns-failed": "DNS 解析失败",
    "no-addresses": "未解析到地址",
    "too-many-addresses": "解析地址数量超过安全上限",
    "non-public-address": "解析结果包含非公网地址",
    "tls-error": "TLS 证书或握手失败",
    "network-error": "网络连接失败",
    timeout: "身份验证请求超时",
    "response-too-large": "Proof 响应超过安全大小上限",
    "unexpected-status": "Proof endpoint 返回了非预期 HTTP 状态",
    "proof-mismatch": "公网 Route 未返回当前机器的精确身份 challenge"
  },
  bootstrapProofTitle: "首次公网身份验证",
  bootstrapProofDescription: "当前 Runtime 还没有 canonical 公网 origin。先创建一个 5 分钟有效、仅保存在本机的随机 challenge，再从候选 HTTPS Route 反向访问同一 Runtime，证明这个公网地址确实指向当前 ChatCockpit。",
  bootstrapProofPreparedDescription: "身份 challenge 已在本机准备好，可通过候选公网 Route 发起验证。challenge 不会进入 Web 状态、Provider 配置或验证结果。",
  bootstrapProofVerifiedDescription: "候选 Route 已通过首次公网身份验证。随机 challenge 已立即销毁；当前只保留 15 分钟有效的 public-safe 验证结果。",
  bootstrapNotPrepared: "尚未准备",
  bootstrapPrepared: "Challenge 已准备",
  bootstrapVerified: "身份已验证",
  bootstrapVerificationFailed: "身份验证失败",
  bootstrapIdentityCheck: "机器身份 Proof",
  bootstrapProofExpires: "Proof 过期时间",
  prepareBootstrapProof: "准备身份 Proof",
  verifyBootstrapProof: "验证公网身份",
  cancelBootstrapProof: "取消身份 Proof",
  bootstrapMachinePendingTitle: "等待 Machine Bootstrap",
  bootstrapMachinePendingDescription: "身份 Proof 已通过。Web 不提供机器执行；请在 ChatCockpit App / CLI 中显式建立首个 canonical。正在运行的 Runtime 会在 Machine Authority 内完成 restart 与 Bootstrap 后验证，失败时回滚为 local-only；已停止的 Runtime 不会被自动启动。",
  candidateSafetyNote: "候选暂存与 Web 验证本身不会修改 canonical、OAuth issuer 或启动 Tunnel/Runtime。已有 canonical 的 replacement cutover 与首次公网 Bootstrap 都只能在 App / CLI Machine Authority 中执行。所有公网验证都使用 public-unicast DNS 与固定 IP HTTPS 探针。",
  candidateStatusUnavailable: "暂时无法读取候选 Route 状态；当前 Runtime 公网入口保持不变。",
  cutoverIntentTitle: "Cutover Intent",
  cutoverIntentPending: "待机器执行",
  cutoverIntentPendingDescription: "已绑定当前 candidate 与成功 Verification Artifact，但尚未写入 Runtime 配置、重启服务或切换公网入口。",
  cutoverIntentExpires: "意图过期时间",
  cutoverFrom: "当前 canonical",
  cutoverTo: "目标 candidate",
  cutoverReadyTitle: "可准备切换",
  cutoverReadyDescription: "当前 candidate 已通过验证。下一步只能先生成短期 Cutover Intent；真正执行必须由 App / CLI Machine Authority 完成。",
  prepareCutoverIntent: "准备 Cutover Intent",
  cancelCutoverIntent: "取消 Cutover Intent",
  actionInstall: "安装",
  actionUpgrade: "升级",
  actionUninstall: "卸载",
  publicEndpoint: "公网端点",
  httpsRequired: "HTTPS",
  httpsReady: "公网 API 使用 HTTPS",
  httpsMissing: "当前公网 API 不是 HTTPS，不能作为安全的公网接入地址",
  oauthGuidance: "OAuth 尚未就绪，请前往「集成」检查授权配置；不要在公网接入页复制一套 OAuth 管理。",
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
  statusOverviewTitle: "Current public status",
  statusOverviewDescription: "Address and protocol state come directly from the current Runtime projection. Unknown or unconfigured values stay explicit instead of being replaced with plausible-looking results.",
  addressesTitle: "Addresses",
  protocolHealthTitle: "Protocol health",
  exposureStatus: "Public exposure",
  localCockpit: "Local Cockpit",
  lanCockpit: "LAN Cockpit",
  publicCockpit: "Public Cockpit",
  lanAccess: "LAN access",
  lanAccessReady: "Reachable",
  lanAccessDisabled: "Disabled",
  lanAccessLoopbackOnly: "Loopback only",
  lanAccessNoTrustedAddress: "No trusted address",
  trustedLanCidrs: "Trusted LAN",
  lanAccessReadyDescription: "Devices on the same trusted LAN can open ChatCockpit through the addresses below. Owner authentication is still required after network admission.",
  lanAccessDisabledDescription: "Trusted LAN is disabled. The Cockpit is currently reachable only from this device or through a configured public entry.",
  lanAccessLoopbackDescription: "Trusted LAN is enabled, but the Runtime still listens only on loopback. Expand the listener explicitly and restart the Runtime before LAN devices can connect.",
  lanAccessNoTrustedAddressDescription: "Trusted LAN is enabled, but the active listener and trusted CIDRs do not produce a usable LAN address. Check the Runtime listener and LAN ranges.",
  localApiBase: "Local API",
  publicApiBase: "Public API",
  openapiUrl: "OpenAPI URL",
  mcpEndpoint: "MCP endpoint",
  oauthStatus: "OAuth status",
  localProtocolNote: "No public API base is configured yet, so the OpenAPI URL is still local. It is not presented as publicly reachable.",
  workflowTitle: "Public Access workflow",
  workflowDescription: "Move through Setup, Verify, Cutover, and Live. Web owns route intent and public verification; machine execution stays in the ChatCockpit App / CLI.",
  workflowSetup: "Setup",
  workflowVerify: "Verify",
  workflowCutover: "Cutover",
  workflowLive: "Live",
  workflowBootstrapMode: "First public route",
  workflowReplacementMode: "Replace current route",
  changePublicAccess: "Change Public Access",
  closePublicAccessMaintenance: "Collapse maintenance workflow",
  existingEnvironment: "Existing environment",
  existingEnvironmentDescription: "If a reverse proxy, tunnel, or other infrastructure already provides your public entry, keep that environment. Configure the Runtime public base URL and return here to verify the resulting projection.",
  manualSetup: "Manual setup",
  manualSetupDescription: "When the listener or a machine-side connector needs changes, configure it in ChatCockpit App / CLI, then return here to verify the public URL, HTTPS, MCP, and OAuth state.",
  machineBoundary: "This page does not install connectors, write provider secrets, start tunnels, or switch public routes for you.",
  providersTitle: "Machine connectors",
  providersDescription: "Connectors are auxiliary machine-side settings. Focus on the public route workflow above during normal use; expand details or open the ChatCockpit App only when installing, upgrading, or diagnosing a Tunnel component.",
  providerDetailsTitle: "View connector status",
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
  routeIntentDescription: "Staging a candidate HTTPS origin never rewrites the Runtime public base URL. With an existing canonical, replacement verification checks public DNS, TLS, Runtime Health, and OAuth identity; first-public setup instead uses a machine-local challenge Bootstrap Identity Proof.",
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
  bootstrapVerificationReasons: {
    "not-attempted": "Not attempted",
    "dns-failed": "DNS resolution failed",
    "no-addresses": "No addresses were resolved",
    "too-many-addresses": "Resolved address count exceeded the safety limit",
    "non-public-address": "DNS included a non-public address",
    "tls-error": "TLS certificate or handshake failed",
    "network-error": "Network connection failed",
    timeout: "Identity proof request timed out",
    "response-too-large": "Proof response exceeded the safety size limit",
    "unexpected-status": "Proof endpoint returned an unexpected HTTP status",
    "proof-mismatch": "The public Route did not return this machine's exact identity challenge"
  },
  bootstrapProofTitle: "Initial public identity proof",
  bootstrapProofDescription: "This Runtime has no canonical public origin yet. Prepare a five-minute random challenge stored only on this machine, then reach the same Runtime through the candidate HTTPS Route to prove that the public address really points to this ChatCockpit instance.",
  bootstrapProofPreparedDescription: "The machine-local identity challenge is ready for a probe through the candidate public Route. The challenge is never projected into Web state, provider configuration, or the verification artifact.",
  bootstrapProofVerifiedDescription: "The candidate Route passed initial public identity proof. The random challenge was destroyed immediately; only a public-safe verification result remains for 15 minutes.",
  bootstrapNotPrepared: "Not prepared",
  bootstrapPrepared: "Challenge prepared",
  bootstrapVerified: "Identity verified",
  bootstrapVerificationFailed: "Identity verification failed",
  bootstrapIdentityCheck: "Machine identity proof",
  bootstrapProofExpires: "Proof expires",
  prepareBootstrapProof: "Prepare identity proof",
  verifyBootstrapProof: "Verify public identity",
  cancelBootstrapProof: "Cancel identity proof",
  bootstrapMachinePendingTitle: "Waiting for Machine Bootstrap",
  bootstrapMachinePendingDescription: "Identity proof has passed. Web provides no machine execution control; establish the first canonical origin explicitly in ChatCockpit App / CLI. A running Runtime restarts and completes post-bootstrap verification under Machine Authority, with failure rollback to local-only; a stopped Runtime is never started automatically.",
  candidateSafetyNote: "Candidate staging and Web verification do not change the canonical origin, OAuth issuer, or start any Tunnel/Runtime. Replacement cutover for an existing canonical and first-public Bootstrap both execute only under App / CLI Machine Authority. All public verification uses public-unicast DNS and pinned-address HTTPS probes.",
  candidateStatusUnavailable: "Candidate Route status is temporarily unavailable. The current Runtime public entry remains unchanged.",
  cutoverIntentTitle: "Cutover Intent",
  cutoverIntentPending: "Pending machine execution",
  cutoverIntentPendingDescription: "The intent is bound to the current candidate and successful Verification Artifact, but no Runtime config has been written, no service restarted, and no public route switched.",
  cutoverIntentExpires: "Intent expires",
  cutoverFrom: "Current canonical",
  cutoverTo: "Target candidate",
  cutoverReadyTitle: "Ready to prepare cutover",
  cutoverReadyDescription: "The current candidate is verified. The next step only creates a short-lived Cutover Intent; actual execution must remain under App / CLI Machine Authority.",
  prepareCutoverIntent: "Prepare Cutover Intent",
  cancelCutoverIntent: "Cancel Cutover Intent",
  actionInstall: "Install",
  actionUpgrade: "Upgrade",
  actionUninstall: "Uninstall",
  publicEndpoint: "Public endpoint",
  httpsRequired: "HTTPS",
  httpsReady: "Public API uses HTTPS",
  httpsMissing: "The configured public API is not HTTPS and cannot be treated as a secure public endpoint",
  oauthGuidance: "OAuth is not ready. Open Integrations to inspect authorization instead of duplicating OAuth management in Public Access.",
  openIntegrations: "Open Integrations",
  copyUrl: "Copy URL",
  loadingTitle: "Loading Public Access",
  loadingDescription: "Reading Runtime reachability and public protocol endpoints.",
  requestFailed: "Unable to load Public Access"
};

export function getPublicAccessCopy(locale: LocaleCode): PublicAccessCopy {
  return locale === "zh-CN" ? zhCN : enUS;
}

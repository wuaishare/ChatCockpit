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
  providerHomebrewRequired: string;
  providerNoMachineAction: string;
  providerStatusUnavailable: string;
  providerExecutionPath: string;
  providerRequiresLocalHost: string;
  providerAvailableTargets: string;
  providerRemoteNotImplemented: string;
  providerTargetAvailabilityUnknown: string;
  continueOnThisMac: string;
  connectivityHostRequirementDescription: string;
  routeIntentTitle: string;
  routeIntentDescription: string;
  routeExecutionTargets: string;
  routeExecutionTargetsDescription: string;
  routeIntentControlPlane: string;
  routeCutoverMachine: string;
  routeTargetLocal: string;
  routeTargetRemote: string;
  routeTargetReady: string;
  routeTargetRequiresLocalHost: string;
  routeTargetApprovalRequired: string;
  routeTargetOffline: string;
  routeTargetAgentUpdate: string;
  routeTargetNotAttested: string;
  routeTargetNotImplemented: string;
  routeTargetForbidden: string;
  routeTargetNoPath: string;
  routeTargetProjectionUnavailable: string;
  routeTargetProjectionFailed: string;
  routeCutoverHostRequirementDescription: string;
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
  workflowDescription: "按准备、验证、切换、在线四个阶段推进。接入意图与公网验证属于同一套 ChatCockpit 工作流；需要 Machine Authority 的步骤会解析合法执行目标后继续，而不是由当前 Surface 推断权限。",
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
  manualSetupDescription: "需要调整监听器或机器侧接入组件时，先查看动作的合法执行目标；在具备对应 Machine Authority 的 Host 或 CLI 完成后，再回到这里验证公网地址、HTTPS、MCP 与 OAuth 状态。",
  machineBoundary: "本页不会安装接入组件、写入 Provider 密钥、启动隧道或替你切换公网路由。",
  providersTitle: "本机接入组件",
  providersDescription: "接入组件属于机器侧辅助设置。安装、升级或排查 Tunnel 组件前先查看 Product Action 的合法执行目标；只有目标具备所需 Host Capability 与 Machine Authority 时才能继续。",
  providerDetailsTitle: "查看组件状态",
  providerDetected: "已检测",
  providerNotDetected: "未检测到",
  providerProbeFailed: "探测失败",
  providerManaged: "由 ChatCockpit 管理",
  providerExternalUnmanaged: "外部环境 · 未接管",
  providerObserveOnly: "仅观察 · 尚无机器 Adapter",
  providerMachineActions: "Provider 可执行资格",
  providerHomebrewRequired: "需要先在此 Mac 安装 Homebrew；ChatCockpit 不会自动安装 Homebrew",
  providerNoMachineAction: "当前没有可用的 ChatCockpit 机器操作",
  providerStatusUnavailable: "暂时无法读取本机连接组件状态；这不会改变当前 Runtime 公网接入结果。",
  providerExecutionPath: "执行路径",
  providerRequiresLocalHost: "需要本机 Host",
  providerAvailableTargets: "可执行目标",
  providerRemoteNotImplemented: "远程设备执行暂未实现",
  providerTargetAvailabilityUnknown: "目标可用性暂不可判断",
  continueOnThisMac: "在此 Mac 上继续",
  connectivityHostRequirementDescription: "这些动作需要目标机器上的 machine-local Host Capability。若当前 Mac 提供 Desktop Host，可切换到「此 Mac → 接入组件」继续；否则请使用具备该能力的 Host 或 CLI。这里不会自动执行安装、升级、卸载或启动 Tunnel。",
  routeIntentTitle: "候选公网 Route",
  routeIntentDescription: "暂存候选 HTTPS origin 时不会改写 Runtime 公网基址。已有 canonical 时使用公网 DNS、TLS、Runtime Health 与 OAuth identity 验证 replacement Route；首次公网接入时改用 machine-local challenge 的 Bootstrap Identity Proof。",
  routeExecutionTargets: "Route 执行目标",
  routeExecutionTargetsDescription: "Product Action 明确分开控制面 Route Intent 与真正的 Machine Cutover。候选暂存、验证、Bootstrap Proof 与 Cutover Intent 只走控制面执行路径；真正修改机器配置必须另有 Machine Authority。",
  routeIntentControlPlane: "控制面 Route 工作流",
  routeCutoverMachine: "Machine Cutover / Bootstrap",
  routeTargetLocal: "本机",
  routeTargetRemote: "远程设备",
  routeTargetReady: "该目标提供当前动作的合法执行路径。",
  routeTargetRequiresLocalHost: "需要目标机器上的本机 Host Capability。",
  routeTargetApprovalRequired: "目标支持该动作，但执行前必须经过受治理审批。",
  routeTargetOffline: "目标设备当前离线。",
  routeTargetAgentUpdate: "旧版 Device Agent 协议无法表达所需能力，需要升级目标设备上的 Agent。",
  routeTargetNotAttested: "目标设备当前没有证明该能力；这不等同于离线或必须升级。",
  routeTargetNotImplemented: "目标设备在线，但当前 Device Agent 尚未实现该 Route 动作的 RPC。",
  routeTargetForbidden: "当前 Authority / Policy 不允许在该目标执行此动作。",
  routeTargetNoPath: "当前没有合法执行路径。",
  routeTargetProjectionUnavailable: "暂时无法确认 Route Product Action 执行目标；控制面变更保持禁用。",
  routeTargetProjectionFailed: "Route 执行目标读取失败",
  routeCutoverHostRequirementDescription: "真正的 Public Route Cutover / Bootstrap 仍是 machine-local Authority 动作。若当前 Mac 提供 Desktop Host，可通过现有「此 Mac → 接入组件」typed handoff 继续；这里不会创建或调用任何 cutover/bootstrap execute Web endpoint。",
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
  bootstrapMachinePendingDescription: "身份 Proof 已通过。下一步需要由具备 Public Route Bootstrap Machine Authority 的执行目标显式建立首个 canonical。正在运行的 Runtime 会在该权限边界内完成 restart 与 Bootstrap 后验证，失败时回滚为 local-only；已停止的 Runtime 不会被自动启动。",
  candidateSafetyNote: "候选暂存与公网验证本身不会修改 canonical、OAuth issuer 或启动 Tunnel/Runtime。已有 canonical 的 replacement cutover 与首次公网 Bootstrap 都需要显式 Machine Authority 与合法执行目标。所有公网验证都使用 public-unicast DNS 与固定 IP HTTPS 探针。",
  candidateStatusUnavailable: "暂时无法读取候选 Route 状态；当前 Runtime 公网入口保持不变。",
  cutoverIntentTitle: "Cutover Intent",
  cutoverIntentPending: "待机器执行",
  cutoverIntentPendingDescription: "已绑定当前 candidate 与成功 Verification Artifact，但尚未写入 Runtime 配置、重启服务或切换公网入口。",
  cutoverIntentExpires: "意图过期时间",
  cutoverFrom: "当前 canonical",
  cutoverTo: "目标 candidate",
  cutoverReadyTitle: "可准备切换",
  cutoverReadyDescription: "当前 candidate 已通过验证。下一步只能先生成短期 Cutover Intent；真正执行需要具备 Public Route Cutover Machine Authority 的 machine-local Host 或未来明确支持该能力的目标。",
  prepareCutoverIntent: "准备 Cutover Intent",
  cancelCutoverIntent: "取消 Cutover Intent",
  actionInstall: "安装",
  actionUpgrade: "升级",
  actionUninstall: "卸载",
  publicEndpoint: "公网端点",
  httpsRequired: "HTTPS",
  httpsReady: "公网 API 使用 HTTPS",
  httpsMissing: "当前公网 API 不是 HTTPS，不能作为安全的公网接入地址",
  oauthGuidance: "OAuth 尚未就绪，请前往「集成与授权」检查授权关系。公网接入页只负责域名、HTTPS、Tunnel 与 Runtime 可达性。",
  openIntegrations: "查看集成与授权",
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
  workflowDescription: "Move through Setup, Verify, Cutover, and Live as one ChatCockpit workflow. Route intent and public verification are shared product steps; Machine Authority actions continue only after resolving a legitimate execution target rather than inferring rights from the current Surface.",
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
  manualSetupDescription: "When the listener or a machine-side connector needs changes, inspect the action's legitimate execution targets first. Complete the change on a Host or CLI with the required Machine Authority, then return here to verify the public URL, HTTPS, MCP, and OAuth state.",
  machineBoundary: "This page does not install connectors, write provider secrets, start tunnels, or switch public routes for you.",
  providersTitle: "Machine connectors",
  providersDescription: "Connectors are auxiliary machine-side settings. Before installing, upgrading, or diagnosing a Tunnel component, inspect the Product Action's legitimate execution targets; execution continues only where the required Host Capability and Machine Authority are available.",
  providerDetailsTitle: "View connector status",
  providerDetected: "Detected",
  providerNotDetected: "Not detected",
  providerProbeFailed: "Probe failed",
  providerManaged: "Managed by ChatCockpit",
  providerExternalUnmanaged: "External environment · unmanaged",
  providerObserveOnly: "Observe only · no machine adapter yet",
  providerMachineActions: "Provider-eligible actions",
  providerHomebrewRequired: "Homebrew must already be installed on this Mac; ChatCockpit does not install Homebrew automatically",
  providerNoMachineAction: "No ChatCockpit machine action is currently available",
  providerStatusUnavailable: "Machine connector status is temporarily unavailable. The current Runtime public connectivity result is unchanged.",
  providerExecutionPath: "Execution path",
  providerRequiresLocalHost: "Requires a local host",
  providerAvailableTargets: "Available targets",
  providerRemoteNotImplemented: "Remote-device execution is not implemented yet",
  providerTargetAvailabilityUnknown: "Target availability is currently unknown",
  continueOnThisMac: "Continue on this Mac",
  connectivityHostRequirementDescription: "These actions require a machine-local Host Capability on the target device. If this Mac provides the Desktop Host, switch to This Mac → Connectivity Providers; otherwise use a Host or CLI that has the capability. This workflow never auto-runs install, upgrade, uninstall, or Tunnel startup.",
  routeIntentTitle: "Candidate Public Route",
  routeIntentDescription: "Staging a candidate HTTPS origin never rewrites the Runtime public base URL. With an existing canonical, replacement verification checks public DNS, TLS, Runtime Health, and OAuth identity; first-public setup instead uses a machine-local challenge Bootstrap Identity Proof.",
  routeExecutionTargets: "Route execution targets",
  routeExecutionTargetsDescription: "Product Action keeps control-plane Route Intent separate from real Machine Cutover. Candidate staging, verification, Bootstrap Proof, and Cutover Intent use only the control-plane path; machine configuration changes require separate Machine Authority.",
  routeIntentControlPlane: "Control-plane Route workflow",
  routeCutoverMachine: "Machine Cutover / Bootstrap",
  routeTargetLocal: "This device",
  routeTargetRemote: "Remote device",
  routeTargetReady: "This target provides a legitimate execution path for the action.",
  routeTargetRequiresLocalHost: "A machine-local Host Capability is required on the target device.",
  routeTargetApprovalRequired: "The target supports this action, but governed approval is required before execution.",
  routeTargetOffline: "The target device is currently offline.",
  routeTargetAgentUpdate: "The legacy Device Agent protocol cannot express the required capability; update the Agent on the target device.",
  routeTargetNotAttested: "The target device has not attested this capability. This does not imply that it is offline or must be upgraded.",
  routeTargetNotImplemented: "The target device is online, but the current Device Agent does not implement this Route RPC.",
  routeTargetForbidden: "Current Authority / Policy does not permit this action on the target.",
  routeTargetNoPath: "No legitimate execution path is currently available.",
  routeTargetProjectionUnavailable: "ChatCockpit cannot currently confirm Route Product Action targets, so control-plane mutation remains disabled.",
  routeTargetProjectionFailed: "Route execution target projection failed",
  routeCutoverHostRequirementDescription: "Actual Public Route Cutover / Bootstrap remains a machine-local Authority action. If this Mac provides the Desktop Host, continue through the existing This Mac → Connectivity Providers typed handoff; this page never creates or calls a cutover/bootstrap execute Web endpoint.",
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
  bootstrapMachinePendingDescription: "Identity proof has passed. The next step must explicitly establish the first canonical origin on an execution target with Public Route Bootstrap Machine Authority. A running Runtime restarts and completes post-bootstrap verification inside that authority boundary, with failure rollback to local-only; a stopped Runtime is never started automatically.",
  candidateSafetyNote: "Candidate staging and public verification do not change the canonical origin, OAuth issuer, or start any Tunnel/Runtime. Replacement cutover for an existing canonical and first-public Bootstrap both require explicit Machine Authority and a legitimate execution target. All public verification uses public-unicast DNS and pinned-address HTTPS probes.",
  candidateStatusUnavailable: "Candidate Route status is temporarily unavailable. The current Runtime public entry remains unchanged.",
  cutoverIntentTitle: "Cutover Intent",
  cutoverIntentPending: "Pending machine execution",
  cutoverIntentPendingDescription: "The intent is bound to the current candidate and successful Verification Artifact, but no Runtime config has been written, no service restarted, and no public route switched.",
  cutoverIntentExpires: "Intent expires",
  cutoverFrom: "Current canonical",
  cutoverTo: "Target candidate",
  cutoverReadyTitle: "Ready to prepare cutover",
  cutoverReadyDescription: "The current candidate is verified. The next step only creates a short-lived Cutover Intent; actual execution requires a machine-local Host with Public Route Cutover Machine Authority, or a future target that explicitly supports that capability.",
  prepareCutoverIntent: "Prepare Cutover Intent",
  cancelCutoverIntent: "Cancel Cutover Intent",
  actionInstall: "Install",
  actionUpgrade: "Upgrade",
  actionUninstall: "Uninstall",
  publicEndpoint: "Public endpoint",
  httpsRequired: "HTTPS",
  httpsReady: "Public API uses HTTPS",
  httpsMissing: "The configured public API is not HTTPS and cannot be treated as a secure public endpoint",
  oauthGuidance: "OAuth is not ready. Open Integrations & Access to inspect authorization. Public Access is limited to domains, HTTPS, tunnels, and Runtime reachability.",
  openIntegrations: "Open Integrations & Access",
  copyUrl: "Copy URL",
  loadingTitle: "Loading Public Access",
  loadingDescription: "Reading Runtime reachability and public protocol endpoints.",
  requestFailed: "Unable to load Public Access"
};

export function getPublicAccessCopy(locale: LocaleCode): PublicAccessCopy {
  return locale === "zh-CN" ? zhCN : enUS;
}

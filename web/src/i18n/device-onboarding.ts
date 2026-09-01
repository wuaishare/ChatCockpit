import type { LocaleCode } from "../i18n";

export interface DeviceOnboardingCopy {
  addDevice: string;
  title: string;
  description: string;
  loading: string;
  loadFailed: string;
  retry: string;
  close: string;
  stepRoute: string;
  stepConnect: string;
  stepApprove: string;
  remoteReadyTitle: string;
  remoteVerified: string;
  remoteUnverified: string;
  remoteReadyDescription: string;
  remoteUnavailableTitle: string;
  remoteUnavailableDescription: string;
  remoteNotConfigured: string;
  remoteNotHttps: string;
  commandLabel: string;
  copyCommand: string;
  installedCliRequirement: string;
  nativePackageTitle: string;
  nativePackageReadyDescription: string;
  nativePackageManifest: string;
  nativePackageArm64: string;
  nativePackageX64: string;
  nativePackageChecksum: string;
  nativePackageConnect: string;
  nativePackageUnavailableNotConfigured: string;
  nativePackageUnavailableInvalid: string;
  nativePackageUnavailableNotPublished: string;
  nativePackageUnavailableRouteNotHttps: string;
  nativePackageUnavailableRouteUnverified: string;
  waitingTitle: string;
  waitingDescription: string;
  pendingCount: string;
  nearbyTitle: string;
  nearbyReady: string;
  nearbyUnavailable: string;
  nearbyDescription: string;
  nearbyVerifyLabel: string;
  nearbyTrustedLanDisabled: string;
  nearbySecureTransportUnavailable: string;
  nearbyDiscoveryUnavailable: string;
  advancedTitle: string;
  hubFingerprint: string;
  stagedRoute: string;
  stagedRouteNone: string;
}

const zhCN: DeviceOnboardingCopy = {
  addDevice: "添加设备",
  title: "添加远端设备",
  description: "首次授权必须先通过当前 ChatCockpit Hub 的 HTTPS 公网入口建立 Hub 身份并发起 Enrollment；局域网发现只用于设备已授权后的 LAN 路由优化。",
  loading: "正在读取设备接入状态…",
  loadFailed: "无法读取设备接入状态",
  retry: "重试",
  close: "关闭",
  stepRoute: "准备首次连接",
  stepConnect: "连接目标设备",
  stepApprove: "核对并批准",
  remoteReadyTitle: "HTTPS 首次连接已可用",
  remoteVerified: "公网入口已验证",
  remoteUnverified: "公网入口尚未验证",
  remoteReadyDescription: "在要添加的目标设备上运行下面的命令。目标设备会先校验 Hub 公共身份，再创建独立设备密钥并发起 Enrollment 请求。",
  remoteUnavailableTitle: "还不能安全发起首次连接",
  remoteUnavailableDescription: "当前没有可用于首次 Enrollment 的 canonical HTTPS Hub 入口。请先在“公网接入”完成 HTTPS 入口配置；ChatCockpit 不会把未验证的局域网广播当成首次信任根。",
  remoteNotConfigured: "尚未配置公网入口。",
  remoteNotHttps: "当前公网入口不是可接受的 HTTPS origin。",
  commandLabel: "在目标设备运行",
  copyCommand: "复制连接命令",
  installedCliRequirement: "如果目标设备已经安装 chatcockpit CLI，也可以继续直接使用上面的连接命令。",
  nativePackageTitle: "自包含 Device Agent 安装包",
  nativePackageReadyDescription: "目标 Mac 不需要预装 Node.js、npm 或 ChatCockpit 源码。请选择与 CPU 架构匹配的发布包，下载后先核对 SHA256，再解压并运行连接命令。",
  nativePackageManifest: "发布清单",
  nativePackageArm64: "Apple Silicon · arm64",
  nativePackageX64: "Intel Mac · x64",
  nativePackageChecksum: "SHA256",
  nativePackageConnect: "解压后运行",
  nativePackageUnavailableNotConfigured: "Hub 尚未配置 Device Agent 发布目录，当前继续使用已安装 CLI 接入。",
  nativePackageUnavailableInvalid: "Device Agent 发布目录或校验信息无效，已停止展示下载入口。",
  nativePackageUnavailableNotPublished: "尚未发布通过 release eligibility 校验的 Device Agent 安装包。",
  nativePackageUnavailableRouteNotHttps: "需要先配置 canonical HTTPS 公网入口，才能发布 Device Agent 下载地址。",
  nativePackageUnavailableRouteUnverified: "HTTPS 公网入口尚未验证，ChatCockpit 不会提前宣告原生安装包可远程下载。",
  waitingTitle: "运行命令后回到这里批准",
  waitingDescription: "目标设备会显示一次人工核对码并等待 Owner 批准。新的请求会出现在本页“待批准设备”区域；请同时核对目标设备上的核对码与设备指纹。",
  pendingCount: "当前待批准请求",
  nearbyTitle: "附近网络 · 配对后优化",
  nearbyReady: "LAN 优化条件就绪",
  nearbyUnavailable: "LAN 优化条件未就绪",
  nearbyDescription: "Nearby discovery 不负责首次配对。设备先通过 HTTPS 完成授权并固定 Hub Ed25519 身份后，才可以验证 Bonjour 候选、Hub identity proof 与 LAN TLS certificate proof，并切换到 pinned TLS 路由。",
  nearbyVerifyLabel: "已配对设备上的 LAN 验证命令",
  nearbyTrustedLanDisabled: "Trusted LAN 尚未启用。",
  nearbySecureTransportUnavailable: "LAN pinned TLS transport 尚未就绪。",
  nearbyDiscoveryUnavailable: "Bonjour/mDNS discovery 尚未就绪。",
  advancedTitle: "Hub 身份信息",
  hubFingerprint: "Hub 公钥指纹",
  stagedRoute: "待验证公网入口",
  stagedRouteNone: "无"
};

const enUS: DeviceOnboardingCopy = {
  addDevice: "Add Device",
  title: "Add remote device",
  description: "Initial authorization must first reach this ChatCockpit Hub through its canonical HTTPS public route to establish Hub identity and create an enrollment. LAN discovery is only a post-authorization route optimization.",
  loading: "Reading device onboarding state…",
  loadFailed: "Unable to read device onboarding state",
  retry: "Retry",
  close: "Close",
  stepRoute: "Prepare first connection",
  stepConnect: "Connect target device",
  stepApprove: "Verify and approve",
  remoteReadyTitle: "HTTPS first connection is available",
  remoteVerified: "Public route verified",
  remoteUnverified: "Public route not yet verified",
  remoteReadyDescription: "Run the command below on the target device. The device verifies the Hub public identity, creates its own device key, and then opens an enrollment request.",
  remoteUnavailableTitle: "A secure first connection is not ready",
  remoteUnavailableDescription: "There is no canonical HTTPS Hub origin that can be used for initial enrollment. Configure HTTPS under Public Access first; ChatCockpit does not treat an untrusted LAN advertisement as a first trust root.",
  remoteNotConfigured: "No public route is configured.",
  remoteNotHttps: "The configured public route is not an acceptable HTTPS origin.",
  commandLabel: "Run on the target device",
  copyCommand: "Copy connect command",
  installedCliRequirement: "If the target already has the chatcockpit CLI, you can continue to use the direct connect command above.",
  nativePackageTitle: "Self-contained Device Agent package",
  nativePackageReadyDescription: "The target Mac does not need Node.js, npm, or a ChatCockpit source checkout. Choose the package for its CPU architecture, verify SHA256 after download, then extract it and run the connect command.",
  nativePackageManifest: "Release manifest",
  nativePackageArm64: "Apple Silicon · arm64",
  nativePackageX64: "Intel Mac · x64",
  nativePackageChecksum: "SHA256",
  nativePackageConnect: "Run after extracting",
  nativePackageUnavailableNotConfigured: "This Hub has no Device Agent distribution directory configured; use an already installed CLI for now.",
  nativePackageUnavailableInvalid: "The Device Agent distribution or its integrity metadata is invalid, so download links are hidden.",
  nativePackageUnavailableNotPublished: "No Device Agent package has passed release eligibility and been published yet.",
  nativePackageUnavailableRouteNotHttps: "Configure a canonical HTTPS public route before publishing Device Agent download URLs.",
  nativePackageUnavailableRouteUnverified: "The HTTPS public route has not been verified, so ChatCockpit will not advertise the native package as remotely downloadable yet.",
  waitingTitle: "Return here to approve after running the command",
  waitingDescription: "The target device shows a human verification code and waits for Owner approval. New requests appear in the Pending Devices section on this page; compare both the code and device fingerprint before approval.",
  pendingCount: "Pending requests",
  nearbyTitle: "Nearby network · post-pairing optimization",
  nearbyReady: "LAN optimization prerequisites ready",
  nearbyUnavailable: "LAN optimization prerequisites not ready",
  nearbyDescription: "Nearby discovery does not establish first trust. After HTTPS enrollment pins the Hub Ed25519 identity, the device can verify Bonjour candidates, the Hub identity proof, and the LAN TLS certificate proof before switching to pinned TLS.",
  nearbyVerifyLabel: "LAN verification command on an already paired device",
  nearbyTrustedLanDisabled: "Trusted LAN is disabled.",
  nearbySecureTransportUnavailable: "Pinned LAN TLS transport is not ready.",
  nearbyDiscoveryUnavailable: "Bonjour/mDNS discovery is not ready.",
  advancedTitle: "Hub identity",
  hubFingerprint: "Hub public-key fingerprint",
  stagedRoute: "Staged public route",
  stagedRouteNone: "None"
};

export function getDeviceOnboardingCopy(locale: LocaleCode): DeviceOnboardingCopy {
  return locale === "en-US" ? enUS : zhCN;
}

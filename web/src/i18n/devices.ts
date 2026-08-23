import type { LocaleCode } from "../i18n";

export interface DevicesCopy {
  title: string;
  description: string;
  refresh: string;
  loading: string;
  loadFailed: string;
  apiVersionMismatch: string;
  localDevice: string;
  pairedDevice: string;
  local: string;
  remote: string;
  online: string;
  offline: string;
  revoked: string;
  executionPolicy: string;
  aiActive: string;
  aiPaused: string;
  platform: string;
  architecture: string;
  lastSeen: string;
  pairedAt: string;
  fingerprint: string;
  management: string;
  presenceReady: string;
  localPresence: string;
  remoteReadReady: string;
  remoteReadAgentUpdate: string;
  remoteReadOffline: string;
  remoteControlPending: string;
  noRemoteTitle: string;
  noRemoteDescription: string;
  requestsTitle: string;
  requestsDescription: string;
  pending: string;
  noRequestsTitle: string;
  noRequestsDescription: string;
  verificationCode: string;
  requestedAt: string;
  expiresAt: string;
  approve: string;
  approving: string;
  deny: string;
  denying: string;
  approveTitle: string;
  approveDescription: string;
  denyTitle: string;
  denyDescription: string;
  confirm: string;
  cancel: string;
  decisionFailed: string;
  pause: string;
  pausing: string;
  pauseTitle: string;
  pauseDescription: string;
  resume: string;
  resuming: string;
  executionPolicyFailed: string;
  revoke: string;
  revoking: string;
  revokeTitle: string;
  revokeDescription: string;
  revokeFailed: string;
  securityNote: string;
}

const zhCN: DevicesCopy = {
  title: "设备",
  description: "管理当前设备与经过 Owner 明确批准的远端设备。在线状态来自设备自己的 Ed25519 签名心跳，不通过局域网扫描猜测设备。",
  refresh: "刷新",
  loading: "正在读取设备状态…",
  loadFailed: "无法读取设备状态",
  apiVersionMismatch: "设备管理接口暂不可用。Web 与 Control Plane 版本可能未同步，请更新或重启 ChatCockpit。",
  localDevice: "当前设备",
  pairedDevice: "已授权设备",
  local: "本机",
  remote: "远端",
  online: "在线",
  offline: "离线",
  revoked: "已撤销",
  executionPolicy: "AI 执行策略",
  aiActive: "AI 可执行",
  aiPaused: "AI 已暂停",
  platform: "平台",
  architecture: "架构",
  lastSeen: "最近在线",
  pairedAt: "授权时间",
  fingerprint: "设备指纹",
  management: "管理能力",
  presenceReady: "Presence 已接入",
  localPresence: "本机可用",
  remoteReadReady: "远程读取可用",
  remoteReadAgentUpdate: "远程读取需更新 Agent",
  remoteReadOffline: "远程读取离线",
  remoteControlPending: "远程启停尚未开放",
  noRemoteTitle: "目前只有当前设备",
  noRemoteDescription: "单设备使用无需额外配置。只有在你需要管理其他机器时，才需要添加远端设备。",
  requestsTitle: "待批准设备",
  requestsDescription: "其他设备主动发起连接后会出现在这里。批准前请核对目标设备显示的验证码与设备指纹；验证码只用于人工核对，不是登录密码或认证凭据。",
  pending: "等待批准",
  noRequestsTitle: "没有待处理的设备请求",
  noRequestsDescription: "新的设备授权请求到达后会自动显示在这里。",
  verificationCode: "核对码",
  requestedAt: "请求时间",
  expiresAt: "过期时间",
  approve: "批准",
  approving: "正在批准…",
  deny: "拒绝",
  denying: "正在拒绝…",
  approveTitle: "批准这台设备？",
  approveDescription: "请先确认目标设备上显示的核对码与这里完全一致。批准后，这台设备会获得独立 Device ID，并使用自己的私钥签名后续心跳。",
  denyTitle: "拒绝这次设备请求？",
  denyDescription: "拒绝只终止本次授权请求，不会影响当前设备或其他已授权设备。",
  confirm: "确认",
  cancel: "取消",
  decisionFailed: "处理设备授权请求失败",
  pause: "暂停 AI 执行",
  pausing: "正在暂停…",
  pauseTitle: "暂停这台设备的 AI 执行？",
  pauseDescription: "设备身份和管理通道会保持有效，现有 OAuth 设备授权也不会删除；AI 对这台设备的执行会立即被阻止，之后可直接恢复。",
  resume: "恢复 AI 执行",
  resuming: "正在恢复…",
  executionPolicyFailed: "更新设备 AI 执行策略失败",
  revoke: "撤销设备",
  revoking: "正在撤销…",
  revokeTitle: "撤销这台设备？",
  revokeDescription: "撤销后，这台设备的后续签名心跳会立即失效。此操作不会关闭远端机器，也不会删除远端文件。",
  revokeFailed: "撤销设备失败",
  securityNote: "设备授权与 Owner/OAuth 权限相互独立。局域网可达也不代表设备可信；远端设备只有在 Owner 明确批准后才进入设备注册表。"
};

const enUS: DevicesCopy = {
  title: "Devices",
  description: "Manage this device and remote devices explicitly approved by the Owner. Presence is derived from Ed25519-signed device heartbeats, not LAN scanning.",
  refresh: "Refresh",
  loading: "Loading device status…",
  loadFailed: "Unable to load device status",
  apiVersionMismatch: "Device management is unavailable. The Web UI and Control Plane may be out of sync; update or restart ChatCockpit.",
  localDevice: "This device",
  pairedDevice: "Authorized device",
  local: "Local",
  remote: "Remote",
  online: "Online",
  offline: "Offline",
  revoked: "Revoked",
  executionPolicy: "AI execution policy",
  aiActive: "AI active",
  aiPaused: "AI paused",
  platform: "Platform",
  architecture: "Architecture",
  lastSeen: "Last seen",
  pairedAt: "Authorized at",
  fingerprint: "Device fingerprint",
  management: "Management",
  presenceReady: "Presence connected",
  localPresence: "Available locally",
  remoteReadReady: "Remote reads ready",
  remoteReadAgentUpdate: "Remote reads require an Agent update",
  remoteReadOffline: "Remote reads offline",
  remoteControlPending: "Remote start/stop not enabled yet",
  noRemoteTitle: "Only this device is configured",
  noRemoteDescription: "Single-device use needs no extra setup. Add a remote device only when you actually need multi-device management.",
  requestsTitle: "Pending devices",
  requestsDescription: "Connection requests from other devices appear here. Before approval, compare the verification code and device fingerprint with the target device. The code is for human verification only, not authentication.",
  pending: "Pending approval",
  noRequestsTitle: "No pending device requests",
  noRequestsDescription: "New device authorization requests will appear here automatically.",
  verificationCode: "Verification code",
  requestedAt: "Requested",
  expiresAt: "Expires",
  approve: "Approve",
  approving: "Approving…",
  deny: "Deny",
  denying: "Denying…",
  approveTitle: "Approve this device?",
  approveDescription: "First confirm that the verification code shown on the target device exactly matches this one. After approval the device receives its own Device ID and signs future heartbeats with its own private key.",
  denyTitle: "Deny this device request?",
  denyDescription: "Denying ends only this authorization request and does not affect this device or other authorized devices.",
  confirm: "Confirm",
  cancel: "Cancel",
  decisionFailed: "Unable to process the device authorization request",
  pause: "Pause AI execution",
  pausing: "Pausing…",
  pauseTitle: "Pause AI execution on this device?",
  pauseDescription: "The device identity and management channel stay valid, and existing OAuth device grants are preserved. AI execution against this device is blocked immediately and can be resumed later.",
  resume: "Resume AI execution",
  resuming: "Resuming…",
  executionPolicyFailed: "Unable to update device AI execution policy",
  revoke: "Revoke device",
  revoking: "Revoking…",
  revokeTitle: "Revoke this device?",
  revokeDescription: "Future signed heartbeats from this device will be rejected immediately. This does not power off the remote machine or delete remote files.",
  revokeFailed: "Unable to revoke device",
  securityNote: "Device authorization is independent from Owner and OAuth authority. LAN reachability does not make a device trusted; a remote device enters the registry only after explicit Owner approval."
};

export function getDevicesCopy(locale: LocaleCode): DevicesCopy {
  return locale === "en-US" ? enUS : zhCN;
}

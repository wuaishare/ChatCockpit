import type { LocaleCode } from "../i18n";

export interface DevicesCopy {
  title: string;
  description: string;
  localDevice: string;
  pairedDevice: string;
  online: string;
  offline: string;
  revoked: string;
  local: string;
  remote: string;
  platform: string;
  architecture: string;
  lastSeen: string;
  pairedAt: string;
  fingerprint: string;
  controlStatus: string;
  presenceReady: string;
  remoteControlPending: string;
  pairTitle: string;
  pairDescription: string;
  deviceName: string;
  deviceNamePlaceholder: string;
  createPairing: string;
  creatingPairing: string;
  pairingCode: string;
  pairingId: string;
  expiresAt: string;
  copyPairingCode: string;
  pairingSecurityNote: string;
  pairingClientPending: string;
  revoke: string;
  revokeTitle: string;
  revokeDescription: string;
  revokeConfirm: string;
  revokeCancel: string;
  refresh: string;
  emptyTitle: string;
  emptyDescription: string;
  loading: string;
  loadFailed: string;
  pairingFailed: string;
  revokeFailed: string;
  apiVersionMismatch: string;
}

const zhCN: DevicesCopy = {
  title: "设备",
  description: "管理本机与显式配对的 ChatCockpit 设备。在线状态来自设备签名心跳，不通过局域网扫描猜测设备。",
  localDevice: "本机设备",
  pairedDevice: "已配对设备",
  online: "在线",
  offline: "离线",
  revoked: "已撤销",
  local: "本机",
  remote: "远端",
  platform: "平台",
  architecture: "架构",
  lastSeen: "最近在线",
  pairedAt: "配对时间",
  fingerprint: "设备指纹",
  controlStatus: "管理能力",
  presenceReady: "Presence 已接入",
  remoteControlPending: "远程启停尚未开放",
  pairTitle: "配对新设备",
  pairDescription: "由控制台管理员创建一次性配对票据。远端设备必须使用自己的 Ed25519 私钥完成持有证明；不会共享管理员密码或机器 API Token。",
  deviceName: "设备名称",
  deviceNamePlaceholder: "例如：MacBook Pro",
  createPairing: "创建配对票据",
  creatingPairing: "正在创建…",
  pairingCode: "一次性配对码",
  pairingId: "Pairing ID",
  expiresAt: "过期时间",
  copyPairingCode: "复制一次性配对码",
  pairingSecurityNote: "配对码仅短时有效且只可消费一次。配对成功后，后续心跳由设备私钥签名并使用单调序列号防重放。",
  pairingClientPending: "远端 CLI / Agent 配对入口将在下一小刀接入；当前服务器协议、身份校验与 Presence 状态机已经就绪。",
  revoke: "撤销设备",
  revokeTitle: "撤销这台设备？",
  revokeDescription: "撤销后，该设备的后续签名心跳会立即失效。此操作不会关闭远端机器，也不会删除远端文件。",
  revokeConfirm: "确认撤销",
  revokeCancel: "取消",
  refresh: "刷新设备",
  emptyTitle: "还没有已配对设备",
  emptyDescription: "本机始终作为当前设备显示。创建配对票据后，可将其他 ChatCockpit 实例加入设备列表。",
  loading: "正在读取设备状态…",
  loadFailed: "无法读取设备列表",
  pairingFailed: "创建配对票据失败",
  revokeFailed: "撤销设备失败",
  apiVersionMismatch: "设备管理接口暂不可用。当前 Web 与 Control Plane 版本可能未同步，请更新或重启 ChatCockpit。"
};

const enUS: DevicesCopy = {
  title: "Devices",
  description: "Manage this device and explicitly paired ChatCockpit devices. Presence comes from signed device heartbeats rather than LAN scanning.",
  localDevice: "Local device",
  pairedDevice: "Paired device",
  online: "Online",
  offline: "Offline",
  revoked: "Revoked",
  local: "Local",
  remote: "Remote",
  platform: "Platform",
  architecture: "Architecture",
  lastSeen: "Last seen",
  pairedAt: "Paired at",
  fingerprint: "Device fingerprint",
  controlStatus: "Management",
  presenceReady: "Presence connected",
  remoteControlPending: "Remote start/stop not enabled yet",
  pairTitle: "Pair a new device",
  pairDescription: "The console administrator creates a one-time pairing ticket. The remote device must prove possession of its own Ed25519 private key; no Owner password or machine API token is shared.",
  deviceName: "Device name",
  deviceNamePlaceholder: "e.g. MacBook Pro",
  createPairing: "Create pairing ticket",
  creatingPairing: "Creating…",
  pairingCode: "One-time pairing code",
  pairingId: "Pairing ID",
  expiresAt: "Expires",
  copyPairingCode: "Copy one-time pairing code",
  pairingSecurityNote: "The code expires quickly and can be consumed only once. After pairing, heartbeats are signed by the device key and use monotonic sequence numbers to prevent replay.",
  pairingClientPending: "The remote CLI / Agent pairing entrypoint is the next slice. The server protocol, identity verification, and Presence state machine are already ready.",
  revoke: "Revoke device",
  revokeTitle: "Revoke this device?",
  revokeDescription: "Future signed heartbeats from this device will be rejected immediately. This does not power off the remote machine or delete remote files.",
  revokeConfirm: "Revoke",
  revokeCancel: "Cancel",
  refresh: "Refresh devices",
  emptyTitle: "No paired devices yet",
  emptyDescription: "This device is always shown. Create a pairing ticket to add another ChatCockpit instance.",
  loading: "Loading device status…",
  loadFailed: "Unable to load devices",
  pairingFailed: "Unable to create pairing ticket",
  revokeFailed: "Unable to revoke device",
  apiVersionMismatch: "Device management is not available. The Web UI and Control Plane may be out of sync; update or restart ChatCockpit."
};

export function getDevicesCopy(locale: LocaleCode): DevicesCopy {
  return locale === "en-US" ? enUS : zhCN;
}

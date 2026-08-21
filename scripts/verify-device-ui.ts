import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const app = read("web/src/App.tsx");
const navigation = read("web/src/navigation.ts");
const sidebar = read("web/src/components/AppSidebar.tsx");
const api = read("web/src/api.ts");
const types = read("web/src/types.ts");
const view = read("web/src/components/DevicesView.tsx");
const copy = read("web/src/i18n/devices.ts");
const i18n = read("web/src/i18n.ts");
const styles = read("web/src/styles.css");
const routes = read("src/server/device-routes.ts");
const store = read("src/devices/device-registry.ts");

assert.match(navigation, /\| "devices"/);
assert.match(app, /devices:\s*consolePath\("devices"\)/);
assert.match(app, /route === "devices"/);
assert.match(app, /import\("\.\/components\/DevicesView"\)/);
assert.match(app, /activeView === "devices"/);
assert.match(app, /<DevicesView locale=\{locale\}/);
assert.match(sidebar, /key:\s*"devices"/);
assert.match(sidebar, /labels\.devices/);
assert.match(i18n, /devices:\s*"设备"/);
assert.match(i18n, /devices:\s*"Devices"/);

assert.match(api, /fetchDevices/);
assert.match(api, /fetchDeviceEnrollmentRequests/);
assert.match(api, /decideDeviceEnrollment/);
assert.match(api, /\/api\/devices\/enrollment-requests/);
assert.match(api, /revokeDevice/);
assert.match(api, /method:\s*"DELETE"/);
assert.match(api, /buildHeaders\(null, \{ mutation: true \}\)/);

assert.match(types, /ManagedDevicePresence = "online" \| "offline" \| "revoked"/);
assert.match(types, /DeviceEnrollmentStatus = "pending" \| "approved" \| "denied" \| "expired"/);
assert.match(types, /enrollmentRequests:\s*DeviceEnrollmentRequestSummary\[\]/);
assert.match(types, /verificationCode:\s*string/);
assert.match(types, /remoteRead:\s*boolean/);
assert.match(types, /remoteControl:\s*false/);
assert.match(types, /publicKeyFingerprint:\s*string \| null/);

assert.match(view, /Promise\.all\(\[/);
assert.match(view, /fetchDevices\(\)/);
assert.match(view, /fetchDeviceEnrollmentRequests\(\)/);
assert.match(view, /requestResponse\.enrollmentRequests/);
assert.match(view, /decideDeviceEnrollment\(requestId, decision\)/);
assert.match(view, /revokeDevice\(deviceId\)/);
assert.match(view, /window\.setInterval\([^]*10_000/);
assert.match(view, /request\.verificationCode/);
assert.match(view, /request\.publicKeyFingerprint/);
assert.match(view, /device\.presence === "online"/);
assert.match(view, /device\.presence === "revoked"/);
assert.match(view, /device\.locality === "local"/);
assert.match(view, /device\.management\.heartbeat/);
assert.match(view, /device\.management\.remoteRead/);
assert.match(view, /remoteReadAgentUpdate/);
assert.match(view, /remoteReadOffline/);
assert.match(view, /remoteControlPending/);
assert.match(view, /Popconfirm/);
assert.doesNotMatch(view, /createDevicePairing|pairing\.code|Pairing ID|一次性配对码/);
assert.doesNotMatch(view, /Start Runtime|Stop Runtime|Restart Runtime|启动 Runtime|停止 Runtime|重启 Runtime/);
assert.doesNotMatch(view, /publicKeySpki|public_key_spki|privateKey|machineApiToken|CHATCOCKPIT_API_TOKEN/i);
assert.doesNotMatch(view, /networkInterfaces|ifconfig|arp|nmap|bonjour|mdns/i);

assert.match(copy, /title:\s*"设备"/);
assert.match(copy, /title:\s*"Devices"/);
assert.match(copy, /验证码只用于人工核对，不是登录密码或认证凭据/);
assert.match(copy, /code is for human verification only, not authentication/);
assert.match(copy, /局域网可达也不代表设备可信/);
assert.match(copy, /LAN reachability does not make a device trusted/);
assert.match(copy, /远程读取可用/);
assert.match(copy, /Remote reads ready/);

assert.match(routes, /app\.get\("\/api\/devices"/);
assert.match(routes, /enrollmentRequests:\s*store\.listPendingEnrollmentRequests/);
assert.match(routes, /app\.post\("\/api\/devices\/enrollment-requests"/);
assert.match(routes, /\/status"/);
assert.match(routes, /\/decision"/);
assert.match(routes, /app\.post\("\/api\/devices\/heartbeat"/);
assert.match(routes, /app\.delete\("\/api\/devices\/:deviceId"/);
assert.match(routes, /OPERATOR_SESSION_REQUIRED/);
assert.match(routes, /isCapabilityRpcAvailable/);
assert.match(routes, /remoteRead/);
assert.doesNotMatch(routes, /privateKey|machine-token/i);

assert.match(store, /ed25519/);
assert.match(store, /DEVICE_PRESENCE_WINDOW_MS = 90_000/);
assert.match(store, /DEVICE_ENROLLMENT_TTL_MS = 5 \* 60_000/);
assert.match(store, /DEVICE_HEARTBEAT_REPLAYED/);
assert.match(store, /verification_code/);
assert.doesNotMatch(store, /scan|bonjour|mdns|nmap|arp -/i);

assert.match(styles, /\.device-grid/);
assert.match(styles, /\.device-card/);
assert.match(styles, /\.device-verification-code/);

process.stdout.write("VERIFY_DEVICE_UI_OK\n");

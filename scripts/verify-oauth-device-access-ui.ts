import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const api = fs.readFileSync(path.join(root, "web", "src", "api.ts"), "utf8");
const view = fs.readFileSync(
  path.join(root, "web", "src", "components", "IntegrationsView.tsx"),
  "utf8"
);
const copy = fs.readFileSync(
  path.join(root, "web", "src", "i18n", "integrations.ts"),
  "utf8"
);
const types = fs.readFileSync(path.join(root, "web", "src", "types.ts"), "utf8");
const styles = fs.readFileSync(path.join(root, "web", "src", "styles.css"), "utf8");

assert.match(api, /fetchOAuthGrantDeviceAccess/);
assert.match(api, /grantOAuthDeviceAccess/);
assert.match(api, /revokeOAuthDeviceAccess/);
assert.match(api, /\/devices\/\$\{encodeURIComponent\(deviceId\)\}\/grant/);
assert.match(api, /\/devices\/\$\{encodeURIComponent\(deviceId\)\}\/revoke/);
assert.match(api, /postBodyJson<OAuthGrantDeviceAccessMutationResponse>/);

assert.match(types, /OAuthGrantDeviceAccessStatus = "available" \| "revoked" \| "missing"/);
assert.match(types, /granted: boolean/);
assert.match(types, /effective: boolean/);

assert.match(view, /copy\.deviceAccessManage/);
assert.match(view, /toggleDeviceAccess\(grant\.id\)/);
assert.match(view, /deviceAccessByGrant\[grant\.id\]\.devices\.map/);
assert.match(view, /updateDeviceAccess\(grant\.id, device\.deviceId, device\.granted\)/);
assert.match(view, /setDeviceAccessByGrant\(\(current\) => \(\{ \.\.\.current, \[grantId\]: response\.access \}\)\)/);
assert.match(view, /setMutatingDeviceAccessKey\(key\)/);
assert.match(view, /setDeviceAccessErrorByGrant/);
assert.match(view, /device\.status === "available"/);
assert.match(view, /device\.effective \? <Tag color="success">/);
assert.match(view, /disabled=\{device\.granted \? !canRemove : !canGrant\}/);
assert.doesNotMatch(view, /grantAll|allowAll|authorizeAll|selectAllDevices/i);

assert.match(copy, /新加入的远程设备不会自动继承此授权/);
assert.match(copy, /Newly enrolled remote devices never inherit access automatically/);
assert.match(copy, /deviceAccessEffective: "当前有效"/);
assert.match(copy, /deviceAccessEffective: "Effective now"/);

assert.match(styles, /\.oauth-device-access__row/);
assert.match(styles, /@media \(max-width: 640px\)/);

process.stdout.write("VERIFY_OAUTH_DEVICE_ACCESS_UI_OK\n");

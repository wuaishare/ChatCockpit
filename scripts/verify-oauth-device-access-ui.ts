import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const app = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");
const api = fs.readFileSync(path.join(root, "web", "src", "api.ts"), "utf8");
const productActionAvailability = fs.readFileSync(
  path.join(root, "web", "src", "product-action-availability.ts"),
  "utf8"
);
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
assert.match(api, /accessLevel: OAuthDeviceAccessLevel/);
assert.match(api, /\{ accessLevel \}/);
assert.match(productActionAvailability, /export function hasLocalProductActionPath/);
assert.match(app, /<IntegrationsView[\s\S]*productActions=\{productActions\}[\s\S]*productActionsError=\{productActionsError\}/);

assert.match(types, /OAuthGrantDeviceAccessStatus = "available" \| "revoked" \| "missing"/);
assert.match(types, /OAuthDeviceAccessLevel =[^;]+"read-only"[^;]+"project-write"[^;]+"project-exec"[^;]+"full-access"/s);
assert.match(types, /granted: boolean/);
assert.match(types, /effective: boolean/);
assert.match(types, /accessLevel: OAuthDeviceAccessLevel \| null/);
assert.match(types, /effectiveAccessLevel: OAuthDeviceAccessLevel \| null/);

assert.match(view, /productActions:\s*ProductActionsResponse \| null/);
assert.match(view, /productActionsError:\s*string \| null/);
assert.match(view, /hasLocalProductActionPath\(\s*productActions,\s*"integration\.oauth\.grant\.revoke"/s);
assert.match(view, /hasLocalProductActionPath\(\s*productActions,\s*"integration\.oauth\.device-access\.manage"/s);
assert.match(view, /!canRevokeOAuthGrant \|\| revokingGrantId/);
assert.match(view, /!canManageOAuthDeviceAccess \|\| mutatingDeviceAccessKey/);
assert.match(view, /productActionsError \|\| copy\.actionAvailabilityUnknown/);
assert.match(view, /copy\.deviceAccessManage/);
assert.match(view, /toggleDeviceAccess\(grant\.id\)/);
assert.match(view, /deviceAccessByGrant\[grant\.id\]\.devices\.map/);
assert.match(view, /setDeviceAccessLevel\(/);
assert.match(view, /removeDeviceAccess\(/);
assert.match(view, /grantOAuthDeviceAccess\(grantId, deviceId, accessLevel\)/);
assert.match(view, /Select<OAuthDeviceAccessLevel>/);
assert.match(view, /useState<OAuthGrantFilter>\("active"\)/);
assert.match(view, /<Segmented/);
assert.match(view, /visibleGrants\.map/);
assert.match(view, /accessLevel !== "full-access"/);
assert.match(view, /Modal\.confirm/);
assert.match(view, /deviceAccessFullAccessDescription/);
assert.match(view, /value=\{device\.accessLevel \?\? undefined\}/);
assert.match(view, /effectiveAccessLevel/);
assert.match(view, /setDeviceAccessByGrant\(\(current\) => \(\{ \.\.\.current, \[grantId\]: response\.access \}\)\)/);
assert.match(view, /setMutatingDeviceAccessKey\(key\)/);
assert.match(view, /setDeviceAccessErrorByGrant/);
assert.match(view, /device\.status === "available"/);
assert.match(view, /device\.effective \? <Tag color="success">/);
assert.match(view, /disabled=\{!canSetLevel\}/);
assert.match(view, /disabled=\{!canRemove\}/);
assert.doesNotMatch(view, /grantAll|allowAll|authorizeAll|selectAllDevices/i);

assert.match(copy, /新加入的远程设备不会自动继承权限/);
assert.match(copy, /Newly enrolled remote devices inherit nothing/);
assert.match(copy, /OAuth 管理执行路径暂不可判断/);
assert.match(copy, /OAuth-management execution path is currently unknown/);
assert.match(copy, /deviceAccessEffective: "当前有效"/);
assert.match(copy, /deviceAccessEffective: "Effective now"/);
assert.match(copy, /deviceAccessLevelProjectWrite: "项目写入"/);
assert.match(copy, /deviceAccessLevelProjectExec: "项目执行"/);
assert.match(copy, /deviceAccessLevelFullAccess: "完全访问"/);
assert.match(copy, /deviceAccessLevelProjectWrite: "Project write"/);
assert.match(copy, /deviceAccessLevelProjectExec: "Project execution"/);
assert.match(copy, /deviceAccessLevelFullAccess: "Full access"/);
assert.match(copy, /grantFilterActive: "有效"/);
assert.match(copy, /grantFilterActive: "Active"/);

assert.match(styles, /\.oauth-device-access__row/);
assert.match(styles, /\.oauth-grants \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(420px, 1fr\)\)/s);
assert.match(styles, /\.oauth-grant-card--expanded \{[^}]*grid-column: 1 \/ -1/s);
assert.match(styles, /@media \(max-width: 900px\)/);
assert.match(styles, /@media \(max-width: 640px\)/);

process.stdout.write("VERIFY_OAUTH_DEVICE_ACCESS_UI_OK\n");

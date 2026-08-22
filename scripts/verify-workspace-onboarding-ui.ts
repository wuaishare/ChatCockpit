import assert from "node:assert/strict";
import fs from "node:fs";

const view = fs.readFileSync("web/src/components/continuity/ContinuityWorkbenchView.tsx", "utf8");
const drawer = fs.readFileSync("web/src/components/continuity/WorkspaceOnboardingDrawer.tsx", "utf8");
const api = fs.readFileSync("web/src/api.ts", "utf8");
const types = fs.readFileSync("web/src/types.ts", "utf8");
const copy = fs.readFileSync("web/src/i18n/continuity.ts", "utf8");
const styles = fs.readFileSync("web/src/styles.css", "utf8");
const responsive = fs.readFileSync("web/src/styles/continuity-responsive.css", "utf8");

assert.match(view, /WorkspaceOnboardingDrawer/);
assert.match(view, /copy\.manageWorkspaces/);
assert.match(view, /copy\.addProject/);
assert.match(view, /continuity-workspace-selector__controls/);
assert.match(view, /onImported=\{handleWorkspaceImported\}/);
assert.match(view, /setSelectedWorkspaceId\(workspaceId\)/);

assert.match(drawer, /fetchWorkspaceDiscoveryRoots/);
assert.match(drawer, /addDiscoveryRoot/);
assert.match(drawer, /removeDiscoveryRoot/);
assert.match(drawer, /scanWorkspaceDiscoveryRoot/);
assert.match(drawer, /importWorkspaceCandidate/);
assert.match(drawer, /copy\.permissionReview/);
assert.match(drawer, /copy\.permissionExactProject/);
assert.match(drawer, /copy\.permissionNoSiblings/);
assert.match(drawer, /MACHINE_LOCAL_AUTHORITY_REQUIRED/);
assert.match(drawer, /parsed\?\.status === 404/);
assert.match(drawer, /<label className="continuity-workspace-manager__field">/);
assert.match(drawer, /candidate\.registration === "registered"/);
assert.doesNotMatch(drawer, /Bearer|CHATCOCKPIT_API_TOKEN|privateKey|accessToken|refreshToken/i);

assert.match(api, /fetchWorkspaceDiscoveryRoots/);
assert.match(api, /addDiscoveryRoot/);
assert.match(api, /removeDiscoveryRoot/);
assert.match(api, /scanWorkspaceDiscoveryRoot/);
assert.match(api, /importWorkspaceCandidate/);
assert.match(api, /buildHeaders\(token, \{ mutation: true \}\)/);

assert.match(types, /interface WorkspaceDiscoveryRoot/);
assert.match(types, /interface WorkspaceDiscoveryCandidate/);
assert.match(types, /registration: "registered" \| "unregistered"/);
assert.match(types, /interface WorkspaceDiscoveryImportResponse/);

for (const requiredCopy of [
  "manageWorkspaces",
  "addProject",
  "workspaceManagerTitle",
  "discoveryRoots",
  "scanProjects",
  "permissionReview",
  "permissionNoSiblings",
  "machineLocalRequired"
]) {
  assert.match(copy, new RegExp(`${requiredCopy}:`));
}
assert.doesNotMatch(copy, /Add an allowlisted repository mapping to local ChatCockpit config/);
assert.doesNotMatch(copy, /在本地 ChatCockpit 配置中添加允许的仓库映射/);

assert.match(styles, /\.continuity-workspace-drawer__stack/);
assert.match(styles, /\.continuity-workspace-manager__candidate/);
assert.match(styles, /:focus-visible/);
assert.match(responsive, /continuity-workspace-selector__controls/);
assert.match(responsive, /continuity-workspace-manager__input-row/);

process.stdout.write("VERIFY_WORKSPACE_ONBOARDING_UI_OK\n");

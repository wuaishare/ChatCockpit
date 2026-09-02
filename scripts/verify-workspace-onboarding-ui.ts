import assert from "node:assert/strict";
import fs from "node:fs";

const continuity = fs.readFileSync("web/src/components/continuity/ContinuityWorkbenchView.tsx", "utf8");
const center = fs.readFileSync("web/src/components/projects/ProjectCenterView.tsx", "utf8");
const drawer = fs.readFileSync("web/src/components/continuity/WorkspaceOnboardingDrawer.tsx", "utf8");
const api = fs.readFileSync("web/src/api.ts", "utf8");
const types = fs.readFileSync("web/src/types.ts", "utf8");
const copy = fs.readFileSync("web/src/i18n/continuity.ts", "utf8");
const styles = fs.readFileSync("web/src/styles.css", "utf8");
const responsive = fs.readFileSync("web/src/styles/continuity-responsive.css", "utf8");

// Project Center is the single current owner of project discovery/onboarding.
assert.match(center, /WorkspaceOnboardingDrawer/);
assert.match(center, /discoveryLocationsOpen/);
assert.match(center, /copy\.discoveryLocations/);
assert.doesNotMatch(continuity, /WorkspaceOnboardingDrawer/);
assert.match(continuity, /copy\.openProjectCenter/);
assert.match(continuity, /continuity-workspace-selector__controls/);

// The shared drawer keeps bounded machine-local discovery/import semantics.
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
assert.match(drawer, /candidate\.registration === "registered"/);
assert.doesNotMatch(drawer, /Bearer|CHATCOCKPIT_API_TOKEN|privateKey|accessToken|refreshToken/i);

assert.match(api, /fetchWorkspaceDiscoveryRoots/);
assert.match(api, /addDiscoveryRoot/);
assert.match(api, /removeDiscoveryRoot/);
assert.match(api, /scanWorkspaceDiscoveryRoot/);
assert.match(api, /importWorkspaceCandidate/);
assert.match(types, /interface WorkspaceDiscoveryRoot/);
assert.match(types, /interface WorkspaceDiscoveryCandidate/);
assert.match(types, /interface WorkspaceDiscoveryImportResponse/);
assert.match(copy, /openProjectCenter:/);
assert.doesNotMatch(copy, /allowlisted repository mapping|允许的仓库映射/i);
assert.match(styles, /\.continuity-workspace-drawer__stack/);
assert.match(styles, /\.continuity-workspace-manager__candidate/);
assert.match(responsive, /continuity-workspace-selector__controls/);
assert.match(responsive, /continuity-workspace-manager__input-row/);

process.stdout.write("VERIFY_WORKSPACE_ONBOARDING_UI_OK\n");

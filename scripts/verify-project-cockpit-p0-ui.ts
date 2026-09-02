import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("web/src/App.tsx", "utf8");
const continuity = fs.readFileSync("web/src/components/continuity/ContinuityWorkbenchView.tsx", "utf8");
const center = fs.readFileSync("web/src/components/projects/ProjectCenterView.tsx", "utf8");
const cockpit = fs.readFileSync("web/src/components/projects/ProjectCockpitView.tsx", "utf8");
const api = fs.readFileSync("web/src/api.ts", "utf8");
const styles = fs.readFileSync("web/src/styles.css", "utf8");
const responsive = fs.readFileSync("web/src/styles/continuity-responsive.css", "utf8");
const legacyComponent = "web/src/components/continuity/ProjectCockpitOverview.tsx";

// Project Center / Project Cockpit is the single current project-management surface.
assert.match(app, /projects:\s*consolePath\("projects"\)/);
assert.match(app, /candidate === "projects"[\s\S]*VIEW_PATHS\.projects/);
assert.match(app, /continuitySection:\s*"tasks"/);
assert.match(app, /onOpenProjects=\{\(\) => navigateView\("projects"\)\}/);
assert.match(center, /WorkspaceOnboardingDrawer/);
assert.match(center, /fetchProjectDiscovery/);
assert.match(center, /createProject/);
assert.match(center, /attachProjectRoot/);
assert.match(cockpit, /fetchProject/);
assert.match(cockpit, /attachProjectRoot/);
assert.match(cockpit, /makeProjectRootPrimary/);
assert.match(cockpit, /detachProjectRoot/);

// Continuity keeps coordination workflows only; it must not own a second Project cockpit/onboarding state machine.
assert.equal(fs.existsSync(legacyComponent), false, "legacy Continuity ProjectCockpitOverview must stay removed");
assert.match(continuity, /\.filter\(\(section\) => section !== "projects"\)/);
assert.match(continuity, /copy\.openProjectCenter/);
assert.match(continuity, /onOpenProjects/);
assert.doesNotMatch(continuity, /WorkspaceOnboardingDrawer/);
assert.doesNotMatch(continuity, /ProjectCockpitOverview/);
assert.doesNotMatch(continuity, /\bfetchContinuityProject\b/);
assert.doesNotMatch(continuity, /activeSection === "projects"/);
assert.doesNotMatch(styles, /\.project-cockpit-grid|\.continuity-projects\s*\{/);
assert.doesNotMatch(responsive, /\.project-cockpit-grid/);

// Compatibility read APIs remain available for Continuity/Resource projections.
assert.match(api, /export async function fetchContinuityProjects/);
assert.match(api, /export async function fetchContinuityProject/);

process.stdout.write("VERIFY_PROJECT_COCKPIT_P0_UI_OK\n");

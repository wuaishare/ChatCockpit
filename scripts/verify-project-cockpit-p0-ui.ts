import assert from "node:assert/strict";
import fs from "node:fs";

const view = fs.readFileSync("web/src/components/continuity/ContinuityWorkbenchView.tsx", "utf8");
const api = fs.readFileSync("web/src/api.ts", "utf8");
const types = fs.readFileSync("web/src/types.ts", "utf8");
const copy = fs.readFileSync("web/src/i18n/continuity.ts", "utf8");
const styles = fs.readFileSync("web/src/styles.css", "utf8");
const responsive = fs.readFileSync("web/src/styles/continuity-responsive.css", "utf8");
const workspacePanel = fs.readFileSync("web/src/components/continuity/WorkspaceContinuityPanel.tsx", "utf8");
const componentPath = "web/src/components/continuity/ProjectCockpitOverview.tsx";

assert.equal(fs.existsSync(componentPath), true, "ProjectCockpitOverview must be a dedicated component");
const cockpit = fs.readFileSync(componentPath, "utf8");

assert.match(api, /fetchContinuityProject\(/);
assert.match(api, /\/api\/continuity\/projects\/\$\{encodeURIComponent\(projectId\)\}/);
assert.match(types, /interface ContinuityProjectDetailResponse/);
assert.match(types, /developmentCoordination:/);
assert.match(types, /mcpApplicability:/);

assert.match(view, /fetchContinuityProject/);
assert.match(view, /ProjectCockpitOverview/);
assert.match(view, /selectedProjectId/);
assert.match(view, /activeSection === "projects"/);
assert.match(view, /projectDetailError/);
assert.match(view, /projectDetailLoading/);
const projectRenderGate = view.indexOf('activeSection === "projects" ?');
const snapshotRenderGate = view.indexOf('snapshotLoading ?');
assert.ok(projectRenderGate >= 0 && snapshotRenderGate > projectRenderGate, "Projects must render before the Workspace snapshot gate");
assert.match(view, /if \(activeSection === "projects" \|\| protectedView \|\| !selectedWorkspaceId\)/);
assert.match(view, /if \(activeSection !== "projects" \|\| protectedView \|\| !selectedProjectId\)/);
assert.doesNotMatch(workspacePanel, /projectsContent/);

for (const authority of [
  "developmentCoordination.modelLoopOwnership",
  "developmentCoordination.workspaceExecution",
  "developmentCoordination.codexContinuity",
  "developmentCoordination.mcpApplicability",
  "developmentCoordination.handoff"
]) {
  assert.ok(cockpit.includes(authority), `Cockpit must consume authoritative ${authority}`);
}
assert.doesNotMatch(cockpit, /nativeDevelopment/);
assert.doesNotMatch(cockpit, /runtimeAvailable\s*\?\s*["']caller/);
assert.doesNotMatch(cockpit, /defaultOwner\s*=|nextAction\s*=/);
assert.doesNotMatch(cockpit, /\{\s*codexContinuity\.nextAction\s*\}/);
assert.doesNotMatch(cockpit, /\{\s*codexContinuity\.runtimeAvailability\s*\}/);
assert.doesNotMatch(cockpit, /thread\.preview/);
assert.equal((cockpit.match(/<article className="project-cockpit-card">/g) ?? []).length, 3);

assert.match(cockpit, /project-cockpit-grid/);
assert.match(cockpit, /project-cockpit-card/);
assert.match(cockpit, /configuredServerCount/);
assert.match(cockpit, /applicableServerCount/);
assert.match(cockpit, /disabledServerCount/);
assert.match(cockpit, /matchingThread/);

for (const requiredCopy of [
  "projectCockpitTitle",
  "projectWorkspaceCard",
  "developmentControlCard",
  "projectCapabilitiesCard",
  "projectName",
  "projectSlug",
  "detachedHead",
  "modelLoopOwner",
  "codexContinuity",
  "handoffPolicy",
  "mcpApplicability"
]) {
  assert.match(copy, new RegExp(`${requiredCopy}:`));
}

assert.match(styles, /\.project-cockpit-grid/);
assert.match(styles, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
assert.match(responsive, /\.project-cockpit-grid/);
assert.match(responsive, /grid-template-columns:\s*1fr/);

process.stdout.write("VERIFY_PROJECT_COCKPIT_P0_UI_OK\n");

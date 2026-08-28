import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const app = read("web/src/App.tsx");
const sidebar = read("web/src/components/AppSidebar.tsx");
const api = read("web/src/api.ts");
const types = read("web/src/types.ts");
const center = read("web/src/components/projects/ProjectCenterView.tsx");
const cockpit = read("web/src/components/projects/ProjectCockpitView.tsx");
const copy = read("web/src/i18n/projects.ts");

// Canonical IA: Project Center -> single-page Project Cockpit.
assert.match(app, /projects:\s*consolePath\("projects"\)/);
assert.match(app, /route === "projects" \|\| route\.startsWith\("projects\/"\)/);
assert.match(app, /segments\.length > 2[\s\S]*replaceState[\s\S]*VIEW_PATHS\.projects/);
assert.match(app, /<ProjectCenterView/);
assert.match(app, /<ProjectCockpitView/);
assert.doesNotMatch(app, /ProjectCockpitSection/);
assert.doesNotMatch(cockpit, /<Tabs|<Segmented|activeSection|onSectionChange/);

// Continuity remains direct-link compatibility only, not a primary navigation item.
assert.match(app, /continuity:\s*consolePath\("continuity"\)/);
assert.match(app, /candidate === "projects"[\s\S]*VIEW_PATHS\.projects/);
assert.match(sidebar, /key:\s*"projects"/);
assert.doesNotMatch(sidebar, /key:\s*"continuity"/);

// New Project UI is ProjectRoot-first. Legacy Workspace mutation helpers may remain in api.ts
// for compatibility callers, but the canonical Project surfaces must not consume them.
assert.match(api, /export async function attachProjectRoot/);
assert.match(api, /\/roots`/);
assert.match(api, /export async function makeProjectRootPrimary/);
assert.match(api, /\/roots\/\$\{encodeURIComponent\(rootId\)\}\/make-primary/);
assert.match(center, /attachProjectRoot/);
assert.match(cockpit, /attachProjectRoot/);
assert.match(cockpit, /makeProjectRootPrimary/);
assert.doesNotMatch(center, /attachProjectWorkspace|makeProjectWorkspacePrimary/);
assert.doesNotMatch(cockpit, /attachProjectWorkspace|makeProjectWorkspacePrimary/);

// Root discovery is provider-neutral and the Web contract models Root + ExecutionWorkspace separately.
assert.match(api, /requestJson<ProjectRootDiscoveryResponse>\("\/api\/projects\/discovery"\)/);
assert.match(types, /export interface ProjectRootSummary/);
assert.match(types, /export interface ProjectRootDetail/);
assert.match(types, /export interface ProjectRootDiscoveryCandidate/);
assert.match(types, /executionWorkspaceIds:/);
assert.match(types, /ProjectRegistryDetailResponse extends ContinuityProjectProjection/);
assert.doesNotMatch(types, /ProjectDiscoveryProviderSnapshot|ProjectDiscoveryCandidateSource/);

// Alpha Cockpit stays compact: readiness, roots/workspaces, development context, conditional attention.
assert.match(cockpit, /copy\.readiness/);
assert.match(cockpit, /copy\.projectRoots/);
assert.match(cockpit, /copy\.developmentContext/);
assert.match(cockpit, /copy\.attentionAndTasks/);
assert.match(cockpit, /attentionVisible/);
assert.match(copy, /primaryRoot:\s*"主目录"/);
assert.match(copy, /primaryRoot:\s*"Primary root"/);
assert.doesNotMatch(copy, /primaryWorkspace|Primary workspace|主工作区/);

process.stdout.write("VERIFY_PROJECT_UI_OK\n");

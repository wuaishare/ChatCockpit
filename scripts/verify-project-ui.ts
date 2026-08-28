import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { theme as antdThemeApi } from "antd";

import { buildAntdTheme } from "../web/src/theme.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const app = read("web/src/App.tsx");
const sidebar = read("web/src/components/AppSidebar.tsx");
const api = read("web/src/api.ts");
const types = read("web/src/types.ts");
const center = read("web/src/components/projects/ProjectCenterView.tsx");
const cockpit = read("web/src/components/projects/ProjectCockpitView.tsx");
const copy = read("web/src/i18n/projects.ts");
const theme = read("web/src/theme.ts");

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

// Discovery preserves provider-native logical project grouping while keeping physical roots explicit.
assert.match(types, /export interface ProjectRootDiscoveryGroup/);
assert.match(types, /groups:\s*ProjectRootDiscoveryGroup\[\]/);
assert.match(center, /groupedCandidateIds = useMemo/);
assert.match(center, /createDiscoveredGroup/);
assert.match(center, /sourceGroups = groups\.filter/);
assert.match(center, /const projectCount = sourceGroups\.length/);
assert.match(center, /source\.inspectedContexts.*copy\.sourceSignals/);
assert.match(copy, /sourceProjects:\s*"个项目"/);
assert.match(copy, /sourceCandidates:\s*"个目录"/);

// Manual Add Project is progressive disclosure: location first, then only name + folder.
assert.match(center, /interface AddProjectFormValues \{\s*displayName: string;\s*path: string;\s*\}/s);
assert.match(center, /project-add-location-card/);
assert.match(center, /copy\.localProject/);
assert.match(center, /copy\.remoteProjectUnavailable/);
assert.match(center, /className="project-add-location-card is-disabled"\s*disabled/);
assert.match(center, /displayName: values\.displayName\.trim\(\)[\s\S]*path: values\.path\.trim\(\)[\s\S]*role: "primary-source"[\s\S]*access: "read-write"/);
assert.doesNotMatch(center, /name="slug"/);
assert.doesNotMatch(center, /name="kind"/);

// Dark appearance must use Ant Design's dark derivative-token algorithm.
assert.match(theme, /antdTheme\.darkAlgorithm/);
assert.match(theme, /antdTheme\.defaultAlgorithm/);
const darkTokens = antdThemeApi.getDesignToken(buildAntdTheme("dark"));
assert.equal(darkTokens.colorText, "#edf4ff");
assert.equal(darkTokens.colorBgElevated, "#0e1d39");
assert.match(String(darkTokens.colorTextTertiary), /255,255,255/);
assert.match(String(darkTokens.colorTextDisabled), /255,255,255/);

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

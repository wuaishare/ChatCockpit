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
const liveExecution = read("web/src/components/projects/ProjectLiveExecutionPanel.tsx");
const runtimeView = read("web/src/components/RuntimeView.tsx");
const runtimeLiveExecution = read("web/src/components/RuntimeLiveExecutionPanel.tsx");
const runtimeCopy = read("web/src/i18n/runtime.ts");
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
assert.match(api, /export async function detachProjectRoot/);
assert.match(api, /\/roots\/\$\{encodeURIComponent\(rootId\)\}\/detach/);
assert.match(center, /attachProjectRoot/);
assert.match(cockpit, /attachProjectRoot/);
assert.match(cockpit, /makeProjectRootPrimary/);
assert.match(cockpit, /detachProjectRoot/);
assert.match(cockpit, /copy\.detachRootConfirmDescription/);
assert.match(cockpit, /okButtonProps:\s*\{\s*danger:\s*true\s*\}/);
assert.doesNotMatch(center, /attachProjectWorkspace|makeProjectWorkspacePrimary/);
assert.doesNotMatch(cockpit, /attachProjectWorkspace|makeProjectWorkspacePrimary/);

// Project surfaces consume Product Action availability rather than deriving mutation rights from Web/Desktop identity.
assert.match(api, /export async function fetchProductActions\(\)/);
assert.match(api, /requestJson<ProductActionsResponse>\("\/api\/product-actions"\)/);
assert.match(types, /export type ProductActionAvailability/);
assert.match(types, /"available-local"/);
assert.match(types, /"available-targeted"/);
assert.match(types, /"requires-local-host"/);
assert.match(types, /"target-capability-not-implemented"/);
assert.match(center, /fetchProductActions/);
assert.match(center, /action\.id === "project\.root\.manage"/);
assert.match(center, /action\.id === "project\.discovery"/);
assert.match(center, /localProjectAvailable/);
assert.match(center, /localDiscoveryAvailable/);
assert.match(center, /action\.id === "project\.native\.associate"/);
assert.match(center, /reconcileNativeProjects/);
assert.match(center, /localNativeAssociationAvailable/);
assert.match(center, /setProjects\(initialResponse\.projects\)/);
assert.match(center, /setConfigRevision\(initialResponse\.configRevision\)/);
assert.match(
  center,
  /void \(async \(\) => \{[\s\S]*const reconciled = await reconcileNativeProjects\(\)/
);
assert.match(cockpit, /fetchProductActions/);
assert.match(cockpit, /rootManagementAvailable/);
assert.match(cockpit, /rootManagementHint/);
assert.match(cockpit, /root\.pathVisibility === "machine-local-owner"/);
assert.match(cockpit, /copy\.rootPathHidden/);
assert.doesNotMatch(cockpit, /<code className="project-root-row__path">\{root\.privatePath\}<\/code>/);

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

// P1 execution observability is Project-scoped and machine-local for command detail.
assert.match(api, /export async function fetchProjectExecutionObservability/);
assert.match(api, /\/api\/projects\/\$\{encodeURIComponent\(projectId\)\}\/executions/);
assert.match(types, /export interface ProjectExecutionObservabilityResponse/);
assert.match(cockpit, /<ProjectLiveExecutionPanel locale=\{locale\} projectId=\{projectId\} \/>/);
assert.match(liveExecution, /new EventSource\([\s\S]*\/executions\/stream/);
assert.match(liveExecution, /copy\.liveActivities/);
assert.match(liveExecution, /copy\.liveProcesses/);
assert.match(liveExecution, /copy\.liveConnections/);
assert.match(liveExecution, /process\.command/);
assert.match(liveExecution, /connection\.transportMode === "stateless-http"/);
assert.doesNotMatch(liveExecution, /authorizationGrantId|clientRegistrationId|privatePid|workdir|commandHash/);
assert.match(copy, /liveExecution:\s*"实时执行"/);
assert.match(copy, /liveExecution:\s*"Live execution"/);

// Runtime is the global control tower; Project Cockpit remains the scoped drill-down.
assert.match(api, /export async function fetchRuntimeExecutionObservability/);
assert.match(api, /requestJson<RuntimeExecutionObservabilityResponse>\("\/api\/runtime\/executions"\)/);
assert.match(types, /export interface RuntimeExecutionObservabilityResponse/);
assert.match(
  runtimeView,
  /<RuntimeLiveExecutionPanel[\s\S]*locale=\{locale\}[\s\S]*processTerminateAvailable=\{processTerminateAvailable\}[\s\S]*\/>/
);
assert.match(runtimeLiveExecution, /new EventSource\("\/api\/runtime\/executions\/stream"/);
assert.match(runtimeLiveExecution, /source\.addEventListener\("runtime\.process\.output"/);
assert.match(runtimeLiveExecution, /consoleSessionId/);
assert.match(runtimeLiveExecution, /seenOutputSequences/);
assert.match(runtimeLiveExecution, /SessionTerminalCard/);
assert.match(runtimeLiveExecution, /runtime-session-terminal__viewport/);
assert.match(runtimeLiveExecution, /projectDisplayName \?\? runtimeCopy\.unknownProject/);
assert.match(runtimeLiveExecution, /activity\.targetDeviceId/);
assert.match(runtimeLiveExecution, /process\.command/);
assert.match(runtimeLiveExecution, /connection\.lastToolName/);
assert.doesNotMatch(runtimeLiveExecution, /authorizationGrantId|clientRegistrationId|privatePid|workdir|commandHash/);
assert.match(runtimeCopy, /liveExecutionTitle:\s*"实时会话与执行"/);
assert.match(runtimeCopy, /liveExecutionTitle:\s*"Live sessions and execution"/);

process.stdout.write("VERIFY_PROJECT_UI_OK\n");

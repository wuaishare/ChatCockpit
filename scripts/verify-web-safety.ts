import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type ScanTarget = {
  label: string;
  dir?: boolean;
  required?: boolean;
  path: string;
};

type Finding = {
  target: string;
  pattern: string;
  file: string;
};

const repoRoot = process.cwd();

const localArtifactPaths = [
  ".playwright-mcp",
  ".chatcockpit",
  ".tokenpilot",
  ".servbay",
  ".ops-private",
  ".codex",
  "docs/superpowers",
  "docs/.DS_Store"
];

const fallbackExcludedDirectories = new Set([
  ".git",
  ".playwright",
  ".playwright-mcp",
  ".chatcockpit",
  ".tokenpilot",
  ".servbay",
  ".codex",
  ".cache",
  ".vite",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results"
]);

const targets: ScanTarget[] = [
  { label: "README.md", path: "README.md", required: true },
  { label: "README.en.md", path: "README.en.md", required: true },
  { label: "docs", path: "docs", dir: true, required: true },
  { label: "docs/zh-CN", path: "docs/zh-CN", dir: true, required: true },
  { label: "openapi", path: "openapi", dir: true, required: true },
  { label: "scripts", path: "scripts", dir: true, required: true },
  { label: "src", path: "src", dir: true, required: true },
  { label: "web/src", path: "web/src", dir: true, required: true },
  { label: "web/index.html", path: "web/index.html", required: true },
  { label: "web/vite.config.ts", path: "web/vite.config.ts", required: true },
  { label: "web/dist", path: "web/dist", dir: true, required: false },
  { label: "package.json", path: "package.json", required: true },
  { label: ".gitignore", path: ".gitignore", required: true },
  { label: "AGENTS.md", path: "AGENTS.md", required: true }
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const privateHostPattern = /\b(?:https?:\/\/|Host:\s*)(?:chatcockpit|tokenpilot)\.(?!example\.(?:com|invalid)\b)[a-z0-9.-]+\.[a-z]{2,}\b/i;
const homePathMarker = "/" + "Users/";
const servBayPathMarker = "/" + "Applications/" + "ServBay";
const localUser = process.env.USER?.trim();
const genericCiUsers = new Set(["actions", "node", "root", "runner", "ubuntu"]);
const shouldScanLocalUser = Boolean(localUser && !genericCiUsers.has(localUser));
const localUserPattern = localUser ? new RegExp(escapeRegExp(localUser), "i") : null;
const localIpPattern = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/;

const safetyPatterns: Array<{ label: string; test: (content: string) => boolean }> = [
  { label: "local home absolute path", test: (content) => content.includes(homePathMarker) },
  { label: "non-placeholder ChatCockpit/legacy deployment host", test: (content) => privateHostPattern.test(content) },
  {
    label: "local machine username",
    test: (content) => shouldScanLocalUser && Boolean(localUserPattern?.test(content))
  },
  {
    label: "local/private IP literal",
    test: (content) => {
      const withoutLoopback = content
        .split(/\r?\n/)
        .filter((line) => !line.includes("127.0.0.1"))
        .join("\n");
      return localIpPattern.test(withoutLoopback);
    }
  },
  { label: "ServBay absolute path", test: (content) => content.includes(servBayPathMarker) },
  {
    label: "literal ChatCockpit/legacy API token assignment",
    test: (content) =>
      /(?:CHATCOCKPIT|TOKENPILOT)_API_TOKEN\s*=\s*(?!your-|replace-with-|demo-token|test-token|\$\{|<)[^\s"'`]+/i.test(content)
  },
  {
    label: "Authorization Bearer non-test value",
    test: (content) =>
      /Authorization\s*:\s*["'`]?Bearer\s+(?!test-token\b|<|your-|replace-with-|demo-token\b|\$\{|\$TOKEN|token\b)[^"'`\s<][^"'`\n]*/i.test(
        content
      )
  },
  {
    label: "token-looking secret assignment",
    test: (content) =>
      /\b(token|secret|password|api[_-]?key)\b\s*[:=]\s*["'`](?!test-token|demo-token|test-password|demo-password|Password\b|replace-with-|your-|chatcockpit\.example\.com|tokenpilot\.example\.com|chatcockpit-web-ui-fixture|tokenpilot-web-ui-fixture)[^"'`\n]{8,}["'`]/i.test(
        content
      )
  }
];

const scanFiles = new Map<string, string>();

function normalizeRelative(value: string): string {
  return value.split(path.sep).join("/");
}

function isLocalArtifactPath(filePath: string): boolean {
  const relativePath = normalizeRelative(path.relative(repoRoot, filePath));
  return localArtifactPaths.some(
    (artifactPath) => relativePath === artifactPath || relativePath.startsWith(`${artifactPath}/`)
  );
}

function walkFiles(targetPath: string): string[] {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return [targetPath];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory() && isLocalArtifactPath(entryPath)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function relative(filePath: string): string {
  return path.relative(repoRoot, filePath) || filePath;
}

function addScanFile(filePath: string, label: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return;
  }
  if (!scanFiles.has(filePath)) {
    scanFiles.set(filePath, label);
  }
}

function listGitFiles(args: string[]): string[] {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed`);
  return result.stdout.split("\0").filter(Boolean);
}

function hasGitIndex(): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return result.status === 0 && result.stdout.trim() === "true";
}

function walkSourceArchiveFiles(targetPath: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      if (fallbackExcludedDirectories.has(entry.name)) {
        continue;
      }
      files.push(...walkSourceArchiveFiles(entryPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function scanContent(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !/(?:CHATCOCKPIT|TOKENPILOT)_API_TOKEN/.test(line))
    .join("\n");
}

for (const target of targets) {
  const absolute = path.join(repoRoot, target.path);
  if (!fs.existsSync(absolute)) {
    if (target.required) {
      throw new Error(`Missing required scan target: ${target.path}`);
    }
    continue;
  }

  const files = target.dir ? walkFiles(absolute) : [absolute];
  for (const filePath of files) {
    addScanFile(filePath, target.label);
  }
}

const gitIndexAvailable = hasGitIndex();

if (gitIndexAvailable) {
  for (const gitFile of [
    ...listGitFiles(["ls-files", "-z"]),
    ...listGitFiles(["ls-files", "--others", "--exclude-standard", "-z"])
  ]) {
    addScanFile(path.join(repoRoot, gitFile), "git-files");
  }
} else {
  for (const filePath of walkSourceArchiveFiles(repoRoot)) {
    addScanFile(filePath, "source-archive");
  }
}

const findings: Finding[] = [];

for (const [filePath, label] of scanFiles) {
  if (
    filePath.endsWith("scripts/verify-web-safety.ts") ||
    filePath.endsWith("scripts/scan-history-privacy.sh")
  ) {
    continue;
  }
  if (path.basename(filePath) === ".DS_Store" || /\.(png|webp|jpe?g|gif|ico|woff2?)$/i.test(filePath)) {
    continue;
  }

  const content = scanContent(fs.readFileSync(filePath, "utf8"));
  for (const pattern of safetyPatterns) {
    if (
      filePath.endsWith("scripts/verify-connectivity-route-verification.ts") &&
      pattern.label === "local/private IP literal"
    ) {
      // This single security-contract fixture intentionally contains blocked
      // SSRF destinations so the verifier can prove they never reach HTTPS.
      // All other safety patterns still apply to the file.
      continue;
    }
    if (pattern.test(content)) {
      findings.push({
        target: label,
        pattern: pattern.label,
        file: relative(filePath)
      });
    }
  }
}

for (const artifactPath of localArtifactPaths) {
  if (gitIndexAvailable) {
    const result = spawnSync("git", ["ls-files", artifactPath], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, `git ls-files failed for ${artifactPath}`);
    assert.equal(
      result.stdout.trim(),
      "",
      `Tracked local artifact detected in git index: ${artifactPath}`
    );
    continue;
  }

  assert.equal(
    fs.existsSync(path.join(repoRoot, artifactPath)),
    false,
    `Local artifact path present in source archive: ${artifactPath}`
  );
}

if (findings.length > 0) {
  const report = findings
    .map((finding) => `${finding.file} [${finding.target}] -> ${finding.pattern}`)
    .join("\n");
  throw new Error(`Web safety scan failed:\n${report}`);
}

const appSource = fs.readFileSync(path.join(repoRoot, "web/src/App.tsx"), "utf8");
const dashboardSource = fs.readFileSync(
  path.join(repoRoot, "web/src/components/DashboardView.tsx"),
  "utf8"
);
const utilityPopoverSource = fs.readFileSync(
  path.join(repoRoot, "web/src/components/AppUtilityPopover.tsx"),
  "utf8"
);
const sidebarSource = fs.readFileSync(
  path.join(repoRoot, "web/src/components/AppSidebar.tsx"),
  "utf8"
);
const stylesSource = fs.readFileSync(path.join(repoRoot, "web/src/styles.css"), "utf8");
const statusLanguageSource = fs.readFileSync(
  path.join(repoRoot, "web/src/status-language.ts"),
  "utf8"
);
const consolePathSource = fs.readFileSync(
  path.join(repoRoot, "web/src/console-path.ts"),
  "utf8"
);
const continuitySource = fs.readFileSync(
  path.join(
    repoRoot,
    "web/src/components/continuity/ContinuityWorkbenchView.tsx"
  ),
  "utf8"
);
const workspaceContinuitySource = fs.readFileSync(
  path.join(
    repoRoot,
    "web/src/components/continuity/WorkspaceContinuityPanel.tsx"
  ),
  "utf8"
);
const workspaceContinuitySectionsSource = fs.readFileSync(
  path.join(
    repoRoot,
    "web/src/components/continuity/WorkspaceContinuitySections.tsx"
  ),
  "utf8"
);
const workspaceContinuityRuntimeSource =
  `${workspaceContinuitySource}\n${workspaceContinuitySectionsSource}`;
const developmentDocumentsSource = fs.readFileSync(
  path.join(
    repoRoot,
    "web/src/components/continuity/DevelopmentDocumentsSection.tsx"
  ),
  "utf8"
);
const runtimeRecoverySource = fs.readFileSync(
  path.join(
    repoRoot,
    "web/src/components/continuity/RuntimeRecoverySection.tsx"
  ),
  "utf8"
);
const resourceCenterSource = fs.readFileSync(
  path.join(repoRoot, "web/src/components/resources/ResourceCenterView.tsx"),
  "utf8"
);
const resourceMutationWorkflowSource = fs.readFileSync(
  path.join(
    repoRoot,
    "web/src/components/resources/use-resource-mutation-workflow.ts"
  ),
  "utf8"
);
const apiSource = fs.readFileSync(path.join(repoRoot, "web/src/api.ts"), "utf8");
const resourceTypesSource = fs.readFileSync(
  path.join(repoRoot, "web/src/types.ts"),
  "utf8"
);
const resourceCopySource = fs.readFileSync(
  path.join(repoRoot, "web/src/i18n/resources.ts"),
  "utf8"
);
const uiCopySource = fs.readFileSync(path.join(repoRoot, "web/src/i18n.ts"), "utf8");
const continuityCopySource = fs.readFileSync(
  path.join(repoRoot, "web/src/i18n/continuity.ts"),
  "utf8"
);
const operatorLoginSource = fs.readFileSync(
  path.join(repoRoot, "web/src/components/OperatorLoginView.tsx"),
  "utf8"
);

assert.doesNotMatch(appSource, /chatcockpit:web:bearer-token|tokenpilot:web:bearer-token/);
assert.doesNotMatch(appSource, /sessionStorage\.(?:getItem|setItem).*token/i);
assert.doesNotMatch(appSource, /TokenBar/);
assert.doesNotMatch(apiSource, /Authorization\s*[:=]|Bearer\s+\$\{/);
assert.match(apiSource, /credentials:\s*"same-origin"/);
assert.match(apiSource, /X-ChatCockpit-CSRF/);
assert.match(appSource, /fetchOperatorStatus/);
assert.match(appSource, /fetchOperatorSession/);
assert.match(appSource, /loginOperator/);
assert.match(appSource, /logoutOperator/);
assert.match(appSource, /readOAuthApprovalReturnTo/);
assert.match(appSource, /target\.origin\s*!==\s*window\.location\.origin/);
assert.match(appSource, /target\.pathname\s*!==\s*"\/oauth\/authorize"/);
assert.match(appSource, /target\.searchParams\.size\s*!==\s*1/);
assert.match(appSource, /\^oauth_request_/);
assert.match(appSource, /window\.location\.assign\(returnTo\)/);
assert.match(operatorLoginSource, /autoComplete="username"/);
assert.match(operatorLoginSource, /autoComplete="current-password"/);
assert.doesNotMatch(
  `${uiCopySource}\n${continuityCopySource}\n${resourceCopySource}`,
  /CHATCOCKPIT_API_TOKEN|Browser session token|browser session token|Bearer Token|会话令牌|访问令牌/
);

for (const section of [
  "projects",
  "documents",
  "tasks",
  "sessions",
  "recovery",
  "handoffs",
  "evidence",
  "approvals"
]) {
  assert.match(appSource, new RegExp(`\\"${section}\\"`));
}
assert.match(appSource, /continuity:\s*consolePath\("continuity"\)/);
assert.match(appSource, /resources:\s*consolePath\("resources"\)/);
assert.match(appSource, /stripConsoleBasePath\(window\.location\.pathname\)/);
assert.match(consolePathSource, /DEFAULT_CONSOLE_BASE_PATH\s*=\s*"\/ui"/);
assert.match(consolePathSource, /chatcockpit-console-base/);
assert.match(consolePathSource, /export function consolePath/);
assert.match(consolePathSource, /export function stripConsoleBasePath/);
assert.match(appSource, /ResourceCenterView/);
assert.match(appSource, /useState<DashboardJobsDataState>\("loading"\)/);
for (const state of ["protected", "loading", "ready", "empty", "unavailable"]) {
  assert.match(appSource, new RegExp(`setJobsDataState\\("${state}"\\)`));
}
assert.match(dashboardSource, /DashboardJobsDataState = "loading" \| "protected" \| "unavailable" \| "empty" \| "ready"/);
assert.match(dashboardSource, /const hasAnyJobs = jobsDataState === "ready"/);
assert.match(dashboardSource, /jobsDataState === "unavailable"/);
assert.match(dashboardSource, /copy\.dashboard\.unavailableStateTitle/);
assert.match(dashboardSource, /<strong>--<\/strong>/);
assert.doesNotMatch(dashboardSource, /jobsProtected/);
assert.doesNotMatch(dashboardSource, /const hasAnyJobs = counts\.total > 0/);
assert.match(appSource, /<AppUtilityPopover/);
assert.doesNotMatch(appSource, /operator-session-label|Segmented<LocaleCode>|themeLabels\[locale\]/);
assert.match(utilityPopoverSource, /<Popover/);
assert.match(utilityPopoverSource, /localeOptions/);
assert.match(utilityPopoverSource, /themeLabels\[locale\]/);
assert.match(utilityPopoverSource, /copy\.operatorAuth\.security/);
assert.match(utilityPopoverSource, /copy\.operatorAuth\.signOut/);
assert.match(stylesSource, /\.app-utility-popover/);
assert.match(appSource, /<AppSidebar/);
assert.match(appSource, /className="app-sidebar-mobile-trigger"/);
assert.match(appSource, /activeViewTitle\[activeView\]/);
assert.doesNotMatch(appSource, /Segmented<ViewKey>|app-toolbar__group--views/);
assert.match(sidebarSource, /SIDEBAR_COLLAPSED_STORAGE_KEY/);
assert.match(sidebarSource, /type: "group"[\s\S]*labels\.workspaceNavigation/s);
assert.match(sidebarSource, /type: "group"[\s\S]*labels\.systemNavigation/s);
assert.match(sidebarSource, /inlineCollapsed=\{compact\}/);
assert.match(sidebarSource, /<Drawer/);
assert.match(sidebarSource, /selectedKeys=\{\[activeView\]\}/);
assert.match(stylesSource, /\.app-sidebar\s*\{[^}]*flex:\s*0 0 232px/s);
assert.match(stylesSource, /\.app-sidebar--collapsed\s*\{[^}]*width:\s*72px/s);
assert.match(stylesSource, /@media \(max-width: 820px\)[\s\S]*\.app-sidebar:not\(\.app-sidebar--mobile\)[\s\S]*display:\s*none/s);
assert.doesNotMatch(stylesSource, /\.app-toolbar__group--views|\.operator-session-label/);
assert.match(apiSource, /\/api\/continuity\/projects\?status=active/);
assert.match(apiSource, /\/api\/continuity\/workspaces\/.*\/snapshot/);
assert.match(apiSource, /\/api\/recovery\/assess/);
assert.match(apiSource, /\/api\/recovery\/execute/);
assert.match(runtimeRecoverySource, /assessRuntimeRecovery/);
assert.match(runtimeRecoverySource, /executeRuntimeRecovery/);
assert.match(runtimeRecoverySource, /assessment\.assessment\.availableActions/);
assert.match(runtimeRecoverySource, /assessment\.assessment\.blockers/);
assert.match(runtimeRecoverySource, /classificationLabel\(assessment\.assessment\.classification, locale\)/);
assert.match(runtimeRecoverySource, /getOperationalStatusLabel\(locale, assessment\.attempt\.status\)/);
assert.match(runtimeRecoverySource, /getOperationalStatusLabel\(locale, compatibility\.compatibilityStatus\)/);
assert.match(runtimeRecoverySource, /getOperationalStatusLabel\(locale, candidate\.status\)/);
assert.match(runtimeRecoverySource, /getOperationalStatusLabel\(locale, selectedTask\.task\.status\)/);
assert.doesNotMatch(runtimeRecoverySource, />\{assessment\.attempt\.status\}</);
assert.doesNotMatch(runtimeRecoverySource, />\{candidate\.status\}</);
assert.doesNotMatch(runtimeRecoverySource, /statusLabel\(/);
assert.match(runtimeRecoverySource, /assessment\?\.assessment\.compatibility|assessment\.assessment\.compatibility/);
assert.match(runtimeRecoverySource, /assessment\?\.attempt\.status === "prepared"|assessment\.attempt\.status === "prepared"/);
assert.doesNotMatch(runtimeRecoverySource, /turn\/start|startCodexRuntimeTurn/);
for (const operation of [
  "fetchContinuityProjects",
  "fetchRuntimeResourceProfiles",
  "inventoryRuntimeResources",
  "fetchRuntimeResourceItem"
]) {
  assert.match(apiSource, new RegExp(operation));
  assert.match(resourceCenterSource, new RegExp(operation));
}
assert.match(apiSource, /\/api\/resources\/runtime-profiles/);
assert.match(apiSource, /\/api\/resources\/inventory/);
assert.match(apiSource, /\/api\/resources\/items\//);
for (const mutationOperation of [
  "prepareRuntimeResourceMutation",
  "decideRuntimeResourceMutation",
  "executeRuntimeResourceMutation",
  "fetchRuntimeResourceMutationActivity"
]) {
  assert.match(apiSource, new RegExp(mutationOperation));
}
for (const mutationRoute of [
  "/api/resources/mutations/prepare",
  "/api/resources/mutations/decision",
  "/api/resources/mutations/execute",
  "/api/resources/mutations/activity"
]) {
  assert.equal(apiSource.includes(mutationRoute), true);
}
assert.match(resourceTypesSource, /RuntimeResourceMutationApproval/);
assert.match(resourceTypesSource, /RuntimeResourceMutationExecution/);
assert.match(resourceTypesSource, /mutationEligibility/);
for (const forbiddenPublicField of [
  "mutationHash",
  "requestedRequestIdentityHash",
  "decidedRequestIdentityHash",
  "executedRequestIdentityHash",
  "remotePluginId",
  "remoteMarketplaceName",
  "marketplacePath",
  "installUrl"
]) {
  assert.equal(resourceTypesSource.includes(forbiddenPublicField), false);
  assert.equal(apiSource.includes(forbiddenPublicField), false);
}
assert.match(resourceCopySource, /受治理变更/);
assert.match(resourceCopySource, /Governed changes/);
assert.match(resourceCopySource, /authoritative refresh/);
assert.match(resourceCopySource, /CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED/);
assert.doesNotMatch(resourceCopySource, /Phase 6A 不执行安装|Phase 6A performs no install/);
assert.match(resourceCenterSource, /copy\.profilesTitle/);
assert.match(resourceCenterSource, /resource-center__profile-card/);
assert.match(resourceCenterSource, /selectedWorkspaceId/);
assert.match(resourceMutationWorkflowSource, /workspaceId: selectedWorkspaceId/);
assert.match(resourceCenterSource, /resource-center__metrics/);
assert.match(resourceCenterSource, /resource-center__drawer/);
assert.match(resourceCenterSource, /getOperationalStatusLabel\(locale, workspace\.status\)/);
assert.match(resourceCenterSource, /getOperationalStatusLabel\(locale, inventory\.snapshot\.status\)/);
assert.match(resourceCenterSource, /getOperationalStatusLabel\(locale, diagnostic\.status\)/);
assert.doesNotMatch(resourceCenterSource, />\{inventory\.snapshot\.status\}</);
assert.doesNotMatch(resourceCenterSource, />\{diagnostic\.status\}</);
assert.doesNotMatch(
  `${resourceCenterSource}\n${resourceMutationWorkflowSource}`,
  /installRuntimeResource|updateRuntimeResource|removeRuntimeResource|enableRuntimeResource|disableRuntimeResource|turn\/start|startCodexRuntimeTurn/
);
assert.doesNotMatch(
  resourceCenterSource,
  /mock(?:Profiles|Resources|Inventory)|sample(?:Profiles|Resources|Inventory)|demo(?:Profiles|Resources|Inventory)|fake(?:Profiles|Resources|Inventory)/i
);
for (const operation of [
  "prepareContinuityHandoff",
  "acceptContinuityHandoff",
  "cancelContinuityHandoff",
  "forkContinuityHandoff",
  "submitContinuityTaskReview",
  "completeContinuityTask"
]) {
  assert.match(apiSource, new RegExp(operation));
  assert.match(workspaceContinuitySource, new RegExp(operation));
}
for (const operation of [
  "fetchDevelopmentDocuments",
  "fetchDevelopmentDocument",
  "createDevelopmentDocument",
  "appendDevelopmentDocumentVersion",
  "updateDevelopmentDocumentStatus",
  "bindContinuityTaskDocuments"
]) {
  assert.match(apiSource, new RegExp(operation));
  assert.match(developmentDocumentsSource, new RegExp(operation));
}
assert.match(continuitySource, /fetchContinuityProjects/);
assert.match(continuitySource, /fetchWorkspaceContinuitySnapshot/);
assert.match(continuitySource, /WorkspaceContinuityPanel/);
assert.match(workspaceContinuityRuntimeSource, /activeLease/);
assert.match(workspaceContinuityRuntimeSource, /verificationState/);
assert.match(workspaceContinuityRuntimeSource, /VerificationTag/);
assert.match(workspaceContinuityRuntimeSource, /prepareHandoff/);
assert.match(workspaceContinuityRuntimeSource, /acceptHandoff/);
assert.match(workspaceContinuityRuntimeSource, /forkHandoff/);
assert.match(workspaceContinuityRuntimeSource, /cancelHandoff/);
assert.match(workspaceContinuityRuntimeSource, /completion\.eligible/);
assert.match(workspaceContinuityRuntimeSource, /completion\.blockers/);
assert.match(workspaceContinuityRuntimeSource, /runtime\.binding/);
assert.match(workspaceContinuityRuntimeSource, /runtime\.job/);
assert.match(workspaceContinuityRuntimeSource, /externalRunId/);
assert.match(workspaceContinuityRuntimeSource, /job\.artifacts/);
assert.match(workspaceContinuityRuntimeSource, /PlanningStatus/);
assert.match(workspaceContinuitySectionsSource, /getOperationalStatusLabel\(locale, task\.status\)/);
assert.match(workspaceContinuitySectionsSource, /getOperationalStatusLabel\(locale, latestHandoff\.status\)/);
assert.match(workspaceContinuitySectionsSource, /getOperationalStatusLabel\(locale, session\.status\)/);
assert.match(workspaceContinuitySectionsSource, /getOperationalStatusLabel\(locale, runtime\.binding\.status\)/);
assert.match(workspaceContinuitySectionsSource, /getOperationalStatusLabel\(locale, runtime\.job\.status\)/);
assert.match(workspaceContinuitySectionsSource, /getOperationalStatusLabel\(locale, handoff\.status\)/);
assert.match(workspaceContinuitySectionsSource, /getOperationalStatusLabel\(locale, approval\.status\)/);
assert.doesNotMatch(workspaceContinuitySectionsSource, />\{session\.status\}</);
assert.doesNotMatch(workspaceContinuitySectionsSource, />\{handoff\.status\}</);
assert.doesNotMatch(workspaceContinuitySectionsSource, />\{approval\.status\}</);
assert.match(developmentDocumentsSource, /executionPolicy/);
assert.match(developmentDocumentsSource, /currentContent\.contentMarkdown/);
assert.match(developmentDocumentsSource, /currentVersion\.contentHash/);
assert.match(developmentDocumentsSource, /assessment\.blockers/);
assert.match(developmentDocumentsSource, /getOperationalStatusLabel\(locale, document\.status\)/);
assert.match(developmentDocumentsSource, /getOperationalStatusLabel\(locale, detail\.document\.status\)/);
assert.doesNotMatch(developmentDocumentsSource, />\{document\.status\}</);
assert.doesNotMatch(developmentDocumentsSource, />\{detail\.document\.status\}</);
assert.match(statusLanguageSource, /partial: \{ "zh-CN": "部分可用", "en-US": "Partial" \}/);
assert.match(statusLanguageSource, /superseded: \{ "zh-CN": "已取代", "en-US": "Superseded" \}/);
assert.match(statusLanguageSource, /queued: \{ "zh-CN": "排队中", "en-US": "Queued" \}/);
assert.match(statusLanguageSource, /"auth-required": \{ "zh-CN": "需要认证", "en-US": "Authentication required" \}/);
assert.match(statusLanguageSource, /"protocol-incompatible": \{ "zh-CN": "协议不兼容", "en-US": "Protocol incompatible" \}/);
assert.match(statusLanguageSource, /getOperationalStatusTone/);
assert.doesNotMatch(
  `${continuitySource}\n${workspaceContinuityRuntimeSource}\n${developmentDocumentsSource}\n${runtimeRecoverySource}`,
  /mock(?:Projects|Snapshot|Tasks|Sessions|Recovery)|sample(?:Projects|Snapshot|Recovery)|demo(?:Projects|Snapshot|Tasks|Recovery)|fixture(?:Projects|Snapshot|Recovery)|fake(?:Projects|Snapshot|Recovery)/i
);

process.stdout.write("VERIFY_WEB_SAFETY_OK\n");

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertIncludesAll(source: string, values: string[], label: string): void {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} must include ${JSON.stringify(value)}`);
  }
}

const contract = read("docs/architecture/surface-design-contract.md");
const zhContract = read("docs/zh-CN/architecture/surface-design-contract.md");
const productPrinciples = read("docs/governance/product-principles.md");
const zhProductPrinciples = read("docs/zh-CN/governance/product-principles.md");
const adr006 = read("docs/architecture/adr-006-unified-surfaces-and-host-capabilities.md");
const actionAvailabilityService = read("src/application/product-action-availability-service.ts");
const actionAvailabilityRoutes = read("src/server/product-action-availability-routes.ts");
const projectCenter = read("web/src/components/projects/ProjectCenterView.tsx");
const projectCockpit = read("web/src/components/projects/ProjectCockpitView.tsx");
const webDesignSystem = read("docs/architecture/web-ui-design-system.md");
const macosDeployment = read("docs/deployment/macos-desktop.md");
const nativeStatus = read("desktop/macos/Sources/TokenPilotDesktop/NativeStatusComponents.swift");
const statusView = read("desktop/macos/Sources/TokenPilotDesktop/StatusView.swift");
const menuBar = read("desktop/macos/Sources/TokenPilotDesktop/MenuBarContentView.swift");
const appModel = read("desktop/macos/Sources/TokenPilotDesktop/DesktopAppModel.swift");
const settingsView = read("desktop/macos/Sources/TokenPilotDesktop/SettingsView.swift");
const webApi = read("web/src/api.ts");
const webApp = read("web/src/App.tsx");
const webIntegrationsI18n = read("web/src/i18n/integrations.ts");

assertIncludesAll(
  contract,
  [
    "Menu Bar — Operational HUD",
    "macOS App — Full Cockpit Host + Native Capability Provider",
    "Web Cockpit — Full Cockpit Browser Host",
    "Runtime — Single Source of Truth and Execution Layer",
    "Surface is presentation, not authority.",
    "Core Product Actions remain recognizable across Hosts.",
    "Host-only preferences stay host-only.",
    "Resolve before execute.",
    "Do not invent a bridge.",
    "Secrets stay machine-local.",
    "Share workflow truth, not necessarily renderer technology.",
    "Canonical console routing applies everywhere.",
    "Unavailable is not zero.",
    "Connectivity is provider-neutral.",
    "Nothing is installed by default.",
    "Public endpoint changes use staged cutover.",
    "Provider secrets remain machine-local.",
    "Public Access / Connectivity",
    "Replacement cutover and first-public Machine Bootstrap execution are implemented only in macOS App / CLI Machine Authority",
    "Web has no execution endpoint",
    "Bootstrap Identity Proof",
    "random challenge stays machine-local",
    "never auto-starts a stopped Runtime",
    "rolls failed running-Runtime transactions back to local-only",
    "## Capability Placement Matrix"
  ],
  "English Surface Design Contract"
);

assertIncludesAll(
  zhContract,
  [
    "Menu Bar — Operational HUD",
    "macOS App — Full Cockpit Host + Native Capability Provider",
    "Web Cockpit — Full Cockpit Browser Host",
    "Runtime — 唯一业务真源与执行层",
    "Surface 是呈现层，不是 Authority。",
    "核心 Product Action 跨 Host 保持同一心智。",
    "Host-only Preference 保持 Host-only。",
    "执行前先解析。",
    "不得编造 Bridge。",
    "秘密保持 machine-local。",
    "共享工作流真相，不强绑 Renderer 技术。",
    "Unavailable 不是 0。",
    "Connectivity 必须 Provider-neutral。",
    "默认不安装任何 Provider。",
    "公网端点切换必须 staged cutover。",
    "Provider Secret 必须保持 machine-local。",
    "公网接入 / Public Access（Connectivity）",
    "Replacement Cutover 与首次公网 Machine Bootstrap Execution 都只在 macOS App / CLI Machine Authority 中实现",
    "Web 不存在执行 endpoint",
    "Bootstrap Identity Proof",
    "随机 challenge 只保存在本机",
    "绝不自动启动已停止的 Runtime",
    "rollback 回 local-only",
    "## Capability Placement Matrix"
  ],
  "Chinese Surface Design Contract"
);

const semantics = [
  "healthy",
  "active",
  "pending",
  "warning",
  "danger",
  "inactive",
  "unknown"
];
for (const semantic of semantics) {
  assert.ok(contract.includes(`\`${semantic}\``), `Contract must define ${semantic}`);
  assert.ok(zhContract.includes(`\`${semantic}\``), `Chinese contract must define ${semantic}`);
  assert.match(nativeStatus, new RegExp(`case ${semantic}\\b`));
}

assertIncludesAll(
  nativeStatus,
  [
    "case .healthy: return Color(nsColor: .systemGreen)",
    "case .active: return Color(nsColor: .systemBlue)",
    "case .pending, .warning: return Color(nsColor: .systemOrange)",
    "case .danger: return Color(nsColor: .systemRed)",
    "case .inactive: return Color(nsColor: .secondaryLabelColor)",
    "case .unknown: return Color(nsColor: .tertiaryLabelColor)"
  ],
  "Native status semantics"
);

const requiredCapabilityRows = [
  "| Overall Runtime health | Summary | Full | Full | Runtime truth |",
  "| Start / stop / restart Runtime | Quick action | Full | Full, target-aware | Machine + target capability |",
  "| Listener / port / console path / Trusted LAN | Summary | Full | Full when target executor exists | Machine + target capability |",
  "| Machine API token plaintext / rotation | None | Host-only | Configured-state only | Machine secret authority |",
  "| Local Web Owner bootstrap credential | None | Host-only | None | Machine secret authority |",
  "| Web Owner session / Passkey / password+TOTP authentication | None | Full/shared flow | Full | Operator auth |",
  "| Project catalog / project metadata | Summary | Full | Full | Operator/project authority |",
  "| Project Root / Primary Root / Execution Workspace management | None | Full | Full, target-aware | Machine filesystem + target capability |",
  "| Jobs / queue / failures | Summary | Full | Full | Operator/governance |",
  "| Approvals | Summary | Full | Full | Approval policy |",
  "| Continuity / Tasks / Sessions / Handoffs / Evidence | Open / summary when useful | Full | Full | Operator/governance |",
  "| Integrations / ChatGPT OAuth / Passkeys | None | Full | Full | Operator auth/integration policy |",
  "| Public Endpoint / reachability / TLS / DNS | Summary | Full | Full | Runtime + network truth |",
  "| Connectivity provider install / update / uninstall | None | Full | Full availability, target-aware | Machine + target capability |",
  "| Connectivity provider credential plaintext | None | Host-only | None | Machine secret authority |",
  "| Desktop app update / Launch at Login / Menu Bar preferences | Host-only | Host-only | None | Desktop Host |",
  "| Audit and workflow history | None | Full | Full | Operator/governance |"
];
assertIncludesAll(contract, requiredCapabilityRows, "Capability Placement Matrix");

assertIncludesAll(
  adr006,
  [
    "One ChatCockpit, Multiple Hosts",
    "Parity-first, Native-enhanced",
    "Product Action",
    "Host Capability Resolution",
    "Authority / Policy Evaluation",
    "Execution Target",
    "requires-local-host",
    "Device Agent 当前已有 Runtime Lifecycle RPC"
  ],
  "ADR-006"
);
assert.match(actionAvailabilityService, /audience: "operator"/);
assert.match(adr006, /Operator audience/);
assert.match(actionAvailabilityService, /"project\.root\.manage"/);
assert.match(actionAvailabilityService, /"project\.discovery"/);
assert.match(actionAvailabilityService, /"runtime\.lifecycle"/);
assert.match(actionAvailabilityService, /"available-targeted"/);
assert.match(actionAvailabilityService, /"requires-local-host"/);
assert.match(actionAvailabilityService, /isRuntimeLifecycleRpcAvailable/);
assert.match(actionAvailabilityRoutes, /app\.get\("\/api\/product-actions"/);
assert.match(actionAvailabilityRoutes, /isMachineLocalRequest\(request\)/);
assert.match(projectCenter, /fetchProductActions/);
assert.match(projectCenter, /project\.root\.manage/);
assert.match(projectCenter, /project\.discovery/);
assert.match(projectCenter, /localProjectAvailable/);
assert.match(projectCockpit, /fetchProductActions/);
assert.match(projectCockpit, /rootManagementAvailable/);
assert.match(projectCockpit, /root\.pathVisibility === "machine-local-owner"/);
assert.doesNotMatch(projectCockpit, /<code className="project-root-row__path">\{root\.privatePath\}<\/code>/);

assert.match(statusView, /enum MainAppSection: String, CaseIterable, Identifiable/);
for (const section of [
  "overview",
  "runtime",
  "projects",
  "accessSecurity",
  "integrations",
  "updates",
  "diagnostics"
]) {
  assert.match(statusView, new RegExp(`case ${section}\\b`));
}
assert.match(statusView, /NativeIntegrationsBridgeView\(model: model\)/);
assert.match(statusView, /NativeDiagnosticsView\(model: model\)/);
assert.match(statusView, /jobs\?\.available == true \? jobs\?\.running : nil/);
assert.match(statusView, /approvals\?\.available == true \? approvals\?\.pending : nil/);
assert.doesNotMatch(statusView, /operationalSummary[\s\S]*\?\?\s*0/s);

assert.match(menuBar, /@ObservedObject var model: DesktopAppModel/);
assert.match(menuBar, /model\.snapshot\.overallState\.nativeSemantic/);
assert.match(menuBar, /model\.operationalSummary/);
assert.match(menuBar, /model\.snapshot\.localCockpitURL/);
assert.match(menuBar, /model\.snapshot\.publicCockpitURL/);
assert.match(menuBar, /openMainWindow\(\.overview\)/);
assert.match(menuBar, /openMainWindow\(\.diagnostics\)/);
assert.match(menuBar, /openMainWindow\(\.updates\)/);
assert.doesNotMatch(menuBar, /revealMachineApiToken|rotateMachineApiToken|revealOwnerPassword|copyOwnerPassword|setOwnerPasswordFromPanel|setAccessPolicy/);
assert.doesNotMatch(menuBar, /operationalSummary[\s\S]*\?\?\s*0/s);

assert.match(settingsView, /DesktopL10n\.string\("Security & Access"\)/);
assert.match(settingsView, /model\.setOwnerPasswordFromPanel\(\)/);
assert.match(settingsView, /model\.revealOwnerPassword\(\)/);
assert.match(settingsView, /model\.copyOwnerPassword\(\)/);
assert.match(settingsView, /model\.revealMachineApiToken\(\)/);
assert.match(settingsView, /model\.rotateMachineApiToken\(\)/);
assert.match(appModel, /openLocalCockpitWithPasswordlessGrant\(\)/);

assert.doesNotMatch(webApi, /\/api\/(?:runtime|services)\/(?:start|stop|restart)/);
assert.doesNotMatch(webApi, /revealMachineApiToken|rotateMachineApiToken/);
assert.match(webApp, /consolePath\(/);
assert.match(
  webIntegrationsI18n,
  /This page shows configuration state only and never reads or displays the token value\./
);

assert.match(productPrinciples, /Surface Design Contract/);
assert.match(zhProductPrinciples, /Surface 设计合同/);
assert.match(webDesignSystem, /Surface Design Contract/);
assert.match(macosDeployment, /Surface Design Contract/);

process.stdout.write("VERIFY_SURFACE_DESIGN_CONTRACT_OK\n");

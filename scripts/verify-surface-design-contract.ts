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
    "macOS App — Local Runtime Manager + Secure Machine Gateway",
    "Web Cockpit — Operator Workspace",
    "Runtime — Single Source of Truth and Execution Layer",
    "Read projections may cross surfaces; mutation authority does not.",
    "Bridge instead of duplicate.",
    "Secrets stay machine-local.",
    "No Web lifecycle takeover.",
    "No workflow clone in the App.",
    "No WKWebView shortcut.",
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
    "macOS App — Local Runtime Manager + Secure Machine Gateway",
    "Web Cockpit — Operator Workspace",
    "Runtime — 唯一业务真源与执行层",
    "只读投影可以跨 Surface，Mutation 权限不能跨。",
    "优先 Bridge，不重复实现。",
    "秘密保持 machine-local。",
    "Web 不接管本机生命周期。",
    "App 不复制工作流工作台。",
    "不使用 WKWebView 套壳解决一致性。",
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
  "| Overall Runtime health | Observe | Observe | Observe | Runtime |",
  "| Start / stop / restart local Runtime | Act | Act | Observe | Machine |",
  "| Listener / port / console path / Trusted LAN | Observe | Act | Observe | Machine |",
  "| Machine API token plaintext / rotation | None | Act | Observe configured-state only | Machine |",
  "| Local Web Owner bootstrap credential | None | Act | None | Machine |",
  "| Web Owner session / Passkey / password+TOTP authentication | None | Bridge | Act | Operator |",
  "| Jobs / queue / failures | Observe summary | Observe summary + Bridge | Act | Operator |",
  "| Approvals | Observe summary | Observe summary + Bridge | Act | Operator |",
  "| Continuity / Tasks / Sessions / Handoffs / Evidence | None | Bridge | Act | Operator |",
  "| Integrations / ChatGPT OAuth / Passkeys | None | Observe status + Bridge | Act | Operator |",
  "| Public Endpoint / reachability / TLS / DNS | Observe summary | Observe summary + Bridge | Act | Operator |",
  "| Connectivity provider selection / domain / route intent | None | Observe status + Bridge | Act | Operator |",
  "| Connectivity provider install / update / uninstall | None | Act | Bridge | Machine |",
  "| Connectivity provider machine service lifecycle | Observe summary | Act | Observe | Machine |",
  "| Connectivity provider credential plaintext | None | Act | None | Machine |",
  "| Tunnel route health / logs / diagnostics | Observe summary | Observe summary + Bridge | Act | Runtime |",
  "| App / Runtime update management | Observe status + Bridge | Act | None | Machine |"
];
assertIncludesAll(contract, requiredCapabilityRows, "Capability Placement Matrix");

assert.match(statusView, /enum MainAppSection: String, CaseIterable, Identifiable/);
for (const section of [
  "overview",
  "runtime",
  "workspaces",
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

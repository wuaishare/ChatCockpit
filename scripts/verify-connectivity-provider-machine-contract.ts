import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function requireAll(source: string, values: string[], label: string): void {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} must include ${JSON.stringify(value)}`);
  }
}

const contract = read("docs/architecture/connectivity-provider-machine-mutation.md");
const zhContract = read("docs/zh-CN/architecture/connectivity-provider-machine-mutation.md");
const surface = read("docs/architecture/surface-design-contract.md");
const zhSurface = read("docs/zh-CN/architecture/surface-design-contract.md");
const providerProbe = read("src/connectivity/provider-probe.ts");
const settings = read("desktop/macos/Sources/TokenPilotDesktop/SettingsView.swift");

requireAll(
  contract,
  [
    "Detecting that a connector binary is absent must never install software",
    "Detect",
    "Prepare",
    "Confirm",
    "Execute",
    "Re-probe",
    "Prepare performs no provider mutation.",
    "must explicitly confirm",
    "A generic shell command is not a provider adapter.",
    "install",
    "upgrade",
    "uninstall",
    "must not synthesize an install button merely because detection returned `not-detected`",
    "Installing a provider does **not** mean creating or starting a public tunnel.",
    "Current Implemented Adapter",
    "Cloudflare Tunnel `cloudflared` binary lifecycle on macOS through Homebrew",
    "/opt/homebrew/bin/brew",
    "/usr/local/bin/brew",
    "An externally installed `cloudflared` remains reusable but unmanaged",
    "does not install Homebrew, authenticate to Cloudflare, create a Tunnel, install or start a Tunnel service",
    "Provider secrets remain machine-local.",
    "no arbitrary shell source",
    "failed or cancelled mutation does not modify the currently selected public endpoint",
    "install/upgrade/uninstall never implicitly starts ChatCockpit Runtime services or a provider tunnel",
    "candidate route → reachability / TLS / auth verification → explicit cutover → post-cutover verification → rollback on failure"
  ],
  "English connectivity machine mutation contract"
);

requireAll(
  zhContract,
  [
    "探测到某个连接器二进制不存在，绝不能因此自动安装软件",
    "Detect",
    "Prepare",
    "Confirm",
    "Execute",
    "Re-probe",
    "Prepare 不执行 Provider Mutation",
    "操作员显式确认",
    "通用 Shell Command 不能冒充 Provider Adapter",
    "`install`",
    "`upgrade`",
    "`uninstall`",
    "不能仅因为探测结果为 `not-detected` 就自动生成安装按钮",
    "安装 Provider **不等于**创建或启动公网 Tunnel",
    "当前已实现 Adapter",
    "Cloudflare Tunnel `cloudflared` 二进制生命周期",
    "/opt/homebrew/bin/brew",
    "/usr/local/bin/brew",
    "外部已有的 `cloudflared` 可以继续复用，但保持 unmanaged",
    "不安装 Homebrew、不登录 Cloudflare、不创建 Tunnel、不安装或启动 Tunnel Service",
    "Provider Secret 必须保持 machine-local",
    "不接受任意 Shell Source",
    "Mutation 失败或取消不能修改当前已选择的 Public Endpoint",
    "绝不能隐式启动 ChatCockpit Runtime Service 或 Provider Tunnel",
    "candidate route → reachability / TLS / auth verification → explicit cutover → post-cutover verification → rollback on failure"
  ],
  "Chinese connectivity machine mutation contract"
);

assert.match(surface, /Connectivity Provider Machine Mutation contract/);
assert.match(zhSurface, /Connectivity Provider 机器变更合同/);

for (const forbiddenMutation of [
  "brew install",
  "brew upgrade",
  "brew uninstall",
  "npm install -g",
  "curl | sh",
  "launchctl load",
  "launchctl bootstrap"
]) {
  assert.equal(
    providerProbe.includes(forbiddenMutation),
    false,
    `Provider detection must remain mutation-free: ${forbiddenMutation}`
  );
}

assert.doesNotMatch(
  settings,
  /Button\([^\n]*(Install Cloudflare|Install ngrok|Install FRP|Upgrade Provider|Uninstall Provider|Start Tunnel)/
);

process.stdout.write("VERIFY_CONNECTIVITY_PROVIDER_MACHINE_CONTRACT_OK\n");

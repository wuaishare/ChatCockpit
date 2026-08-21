import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface PayloadManifest {
  schemaVersion: number;
  tokenPilotVersion: string;
  runtimeId: string;
  platform: string;
  architecture: "arm64" | "x64";
  node: {
    version: string;
    artifact: string;
    sha256: string;
  };
  payload: {
    layoutVersion: number;
    files: Record<string, string>;
  };
}

const payloadRootInput =
  process.env.CHATCOCKPIT_RUNTIME_PAYLOAD_DIR?.trim() ??
  process.env.TOKENPILOT_RUNTIME_PAYLOAD_DIR?.trim();
assert.ok(payloadRootInput, "CHATCOCKPIT_RUNTIME_PAYLOAD_DIR is required");
const payloadRoot = path.resolve(payloadRootInput);

function required(relativePath: string): string {
  const absolutePath = path.join(payloadRoot, relativePath);
  assert.ok(fs.existsSync(absolutePath), `Missing runtime payload path: ${relativePath}`);
  return absolutePath;
}

function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function walkFiles(root: string, relative = ""): string[] {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) {
    return [relative.replaceAll(path.sep, "/")];
  }
  if (stat.isFile()) {
    return [relative.replaceAll(path.sep, "/")];
  }
  return fs
    .readdirSync(absolute)
    .sort()
    .flatMap((entry) => walkFiles(root, path.join(relative, entry)));
}

const manifestPath = required("manifest.json");
const nodePath = required("node/bin/node");
required("app/package.json");
required("app/package-lock.json");
required("app/dist/cli/index.js");
required("app/web/dist/index.html");
required("app/openapi/chatcockpit.openapi.yaml");
required("app/node_modules");
required("app/scripts/macos-manage-local-server.sh");
required("app/scripts/macos-manage-device-agent.sh");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PayloadManifest;
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.platform, "darwin");
assert.equal(manifest.node.version, "24.18.1");
assert.match(manifest.node.sha256, /^[a-f0-9]{64}$/);
assert.match(manifest.runtimeId, /node24\.18\.1-darwin-(arm64|x64)$/);
assert.equal(manifest.runtimeId.endsWith(manifest.architecture), true);
assert.equal(manifest.payload.layoutVersion, 1);

const fileResult = spawnSync("file", [nodePath], { encoding: "utf8" });
assert.equal(fileResult.status, 0, fileResult.stderr);
const fileOutput = `${fileResult.stdout}\n${fileResult.stderr}`;
if (manifest.architecture === "arm64") {
  assert.match(fileOutput, /arm64|arm64e/i);
} else {
  assert.match(fileOutput, /x86_64/i);
}

const allFiles = walkFiles(payloadRoot);
const forbiddenPatterns: Array<[string, RegExp]> = [
  ["git metadata", /(^|\/)\.git(\/|$)/],
  ["ChatCockpit mutable state", /(^|\/)\.chatcockpit(\/|$)/],
  ["legacy mutable state", /(^|\/)\.tokenpilot(\/|$)/],
  ["Codex local state", /(^|\/)\.codex(\/|$)/],
  ["dotenv", /(^|\/)\.env(?:\.|$)/],
  ["server.env", /(^|\/)server\.env$/],
  ["source tree", /^app\/src\//],
  ["web source tree", /^app\/web\/src\//],
  ["Swift tests", /(^|\/)Tests(\/|$)/],
  ["node cache", /(^|\/)node_modules\/\.cache(\/|$)/]
];
for (const relativePath of allFiles) {
  for (const [label, pattern] of forbiddenPatterns) {
    assert.equal(pattern.test(relativePath), false, `${label} leaked into payload: ${relativePath}`);
  }
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(payloadRoot, "app", "package.json"), "utf8")
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const installedTopLevel = new Set(
  fs.readdirSync(path.join(payloadRoot, "app", "node_modules")).filter((name) => !name.startsWith("."))
);
for (const dependencyName of Object.keys(packageJson.devDependencies ?? {})) {
  if ((packageJson.dependencies ?? {})[dependencyName]) continue;
  if (dependencyName.startsWith("@")) {
    const [scope, packageName] = dependencyName.split("/");
    if (!scope || !packageName) continue;
    const scopePath = path.join(payloadRoot, "app", "node_modules", scope, packageName);
    assert.equal(fs.existsSync(scopePath), false, `Dev dependency leaked into payload: ${dependencyName}`);
  } else {
    assert.equal(installedTopLevel.has(dependencyName), false, `Dev dependency leaked into payload: ${dependencyName}`);
  }
}

for (const [relativePath, expectedHash] of Object.entries(manifest.payload.files)) {
  assert.match(expectedHash, /^[a-f0-9]{64}$/, `Invalid payload hash for ${relativePath}`);
  const absolutePath = required(relativePath);
  assert.equal(fs.statSync(absolutePath).isFile(), true, `Hashed payload entry is not a file: ${relativePath}`);
  assert.equal(sha256(absolutePath), expectedHash, `Payload hash mismatch: ${relativePath}`);
}

for (const requiredHashPath of [
  "node/bin/node",
  "app/package.json",
  "app/dist/cli/index.js",
  "app/web/dist/index.html",
  "app/openapi/chatcockpit.openapi.yaml",
  "app/scripts/macos-manage-local-server.sh",
  "app/scripts/macos-manage-device-agent.sh"
]) {
  assert.ok(manifest.payload.files[requiredHashPath], `Manifest missing critical hash: ${requiredHashPath}`);
}

const manifestText = fs.readFileSync(manifestPath, "utf8");
assert.equal(manifestText.includes("/" + "Users/"), false);
assert.equal(manifestText.includes("TOKENPILOT_API_TOKEN"), false);
assert.equal(manifestText.includes("latest-v24"), false);

process.stdout.write(
  `VERIFY_MACOS_RUNTIME_PAYLOAD_OK arch=${manifest.architecture} node=${manifest.node.version}\n`
);

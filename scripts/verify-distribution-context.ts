import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildDistributionContext,
  buildSourceDistributionContext
} from "../src/core/distribution-context.js";
import { loadUserConfigForPaths } from "../src/core/config.js";
import { buildPaths } from "../src/core/paths.js";

function canonical(value: string): string {
  const resolved = path.resolve(value);
  return fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-distribution-"));
const installRoot = path.join(tempRoot, "runtime", "app");
const stateRoot = path.join(tempRoot, "state");
const workspaceRoot = path.join(tempRoot, "workspace");
const nodeExecutable = path.join(tempRoot, "runtime", "node", "bin", "node");
const configPath = path.join(tempRoot, "config", "config.json");

for (const directory of [installRoot, stateRoot, workspaceRoot, path.dirname(configPath)]) {
  fs.mkdirSync(directory, { recursive: true });
}

const packaged = buildDistributionContext({
  mode: "packaged",
  installRoot,
  stateRoot,
  primaryWorkspaceRoot: workspaceRoot,
  nodeExecutable,
  configPath
});

assert.equal(packaged.mode, "packaged");
assert.equal(packaged.installRoot, canonical(installRoot));
assert.equal(packaged.stateRoot, canonical(stateRoot));
assert.equal(packaged.primaryWorkspaceRoot, canonical(workspaceRoot));
assert.equal(packaged.nodeExecutable, canonical(nodeExecutable));
assert.equal(packaged.configPath, canonical(configPath));

const packagedPaths = buildPaths(packaged);
assert.equal(packagedPaths.repoRoot, canonical(workspaceRoot));
assert.equal(packagedPaths.installRoot, canonical(installRoot));
assert.equal(packagedPaths.stateRoot, canonical(stateRoot));
assert.equal(packagedPaths.workspaceDir, canonical(stateRoot));
assert.equal(packagedPaths.runtimeDir, path.join(canonical(stateRoot), "runtime"));
assert.equal(packagedPaths.distributionMode, "packaged");
assert.equal(packagedPaths.nodeExecutable, canonical(nodeExecutable));
assert.equal(packagedPaths.configPath, canonical(configPath));

const originalConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
const packagedEnvOverride = path.join(tempRoot, "packaged-env-override.json");
process.env.TOKENPILOT_CONFIG_PATH = packagedEnvOverride;
const packagedConfig = loadUserConfigForPaths(packagedPaths);
assert.equal(packagedConfig.schemaVersion, 1);
assert.equal(packagedConfig.defaultRepoId, "tokenpilot");
assert.equal(fs.existsSync(packagedEnvOverride), false);
assert.equal(packagedConfig.repoMappings.tokenpilot?.path, canonical(workspaceRoot));
assert.equal(packagedConfig.workspaceAllowlist.includes(canonical(workspaceRoot)), true);
assert.equal(packagedConfig.workspaceAllowlist.includes(canonical(installRoot)), false);
assert.equal(packagedConfig.workspaceAllowlist.includes(canonical(stateRoot)), false);

const sourceRoot = path.join(tempRoot, "source-checkout");
fs.mkdirSync(sourceRoot, { recursive: true });
const source = buildSourceDistributionContext(sourceRoot, {
  configPath: path.join(tempRoot, "source-config.json"),
  nodeExecutable: process.execPath
});
const sourcePaths = buildPaths(sourceRoot);
const sourceDynamicConfigPath = path.join(tempRoot, "source-dynamic-config.json");
process.env.TOKENPILOT_CONFIG_PATH = sourceDynamicConfigPath;
const sourceConfig = loadUserConfigForPaths(sourcePaths);
assert.equal(sourceConfig.schemaVersion, 1);
assert.equal(sourceConfig.defaultRepoId, "tokenpilot");
assert.equal(fs.existsSync(sourceDynamicConfigPath), true);
assert.equal(sourceConfig.repoMappings.tokenpilot?.path, canonical(sourceRoot));
assert.equal(source.mode, "source");
assert.equal(source.installRoot, canonical(sourceRoot));
assert.equal(source.stateRoot, path.join(canonical(sourceRoot), ".tokenpilot"));
assert.equal(source.primaryWorkspaceRoot, canonical(sourceRoot));
assert.equal(sourcePaths.repoRoot, canonical(sourceRoot));
assert.equal(sourcePaths.installRoot, canonical(sourceRoot));
assert.equal(sourcePaths.workspaceDir, path.join(canonical(sourceRoot), ".tokenpilot"));
assert.equal(sourcePaths.distributionMode, "source");

if (originalConfigPath === undefined) {
  delete process.env.TOKENPILOT_CONFIG_PATH;
} else {
  process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
}

process.stdout.write("VERIFY_DISTRIBUTION_CONTEXT_OK\n");

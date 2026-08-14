import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadUserConfig } from "../src/core/config.js";
import {
  buildDistributionContext,
  buildDistributionContextForProduct,
  buildSourceDistributionContext,
  buildSourceDistributionContextForProduct
} from "../src/core/distribution-context.js";
import { runtimeIdentityEnvName } from "../src/core/identity-env.js";
import { buildPaths } from "../src/core/paths.js";
import { initLocalRuntime } from "../src/core/setup.js";
import {
  CHATCOCKPIT_PRODUCT_IDENTITY,
  DEFAULT_PRODUCT_IDENTITY,
  TOKENPILOT_PRODUCT_IDENTITY,
  productIdentityForKey
} from "../src/core/product-identity.js";

assert.equal(DEFAULT_PRODUCT_IDENTITY.key, "tokenpilot");
assert.equal(TOKENPILOT_PRODUCT_IDENTITY.displayName, "TokenPilot");
assert.equal(CHATCOCKPIT_PRODUCT_IDENTITY.displayName, "ChatCockpit");
assert.equal(productIdentityForKey("chatcockpit").mcpNamespace, "chatcockpit");
assert.equal(runtimeIdentityEnvName("API_TOKEN", "tokenpilot"), "TOKENPILOT_API_TOKEN");
assert.equal(runtimeIdentityEnvName("API_TOKEN", "chatcockpit"), "CHATCOCKPIT_API_TOKEN");

function canonical(value: string): string {
  return fs.existsSync(value) ? fs.realpathSync.native(value) : path.resolve(value);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-product-identity-"));
try {
  const repoRoot = path.join(root, "repo");
  const targetHome = path.join(root, "home");
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(targetHome, { recursive: true });

  const currentSource = buildSourceDistributionContext(repoRoot, {
    configPath: path.join(targetHome, ".tokenpilot", "config.json")
  });
  const currentPaths = buildPaths(currentSource);
  assert.equal(currentSource.productIdentity, "tokenpilot");
  assert.equal(currentSource.stateRoot, path.join(canonical(repoRoot), ".tokenpilot"));
  assert.match(currentPaths.runnerPlistPath, /com\.wuaishare\.tokenpilot\.runner\.plist$/);
  assert.match(
    currentPaths.processSupervisorPlistPath,
    /com\.wuaishare\.tokenpilot\.process-supervisor\.plist$/
  );

  const targetConfigPath = path.join(targetHome, ".chatcockpit", "config.json");
  const targetSource = buildSourceDistributionContextForProduct("chatcockpit", repoRoot, {
    configPath: targetConfigPath
  });
  const targetPaths = buildPaths(targetSource);
  assert.equal(targetSource.productIdentity, "chatcockpit");
  assert.equal(targetSource.stateRoot, path.join(canonical(repoRoot), ".chatcockpit"));
  assert.equal(targetSource.configPath, path.resolve(targetConfigPath));
  assert.match(targetPaths.runnerPlistPath, /com\.wuaishare\.chatcockpit\.runner\.plist$/);
  assert.match(
    targetPaths.processSupervisorPlistPath,
    /com\.wuaishare\.chatcockpit\.process-supervisor\.plist$/
  );

  const targetConfig = loadUserConfig(repoRoot, targetSource);
  assert.equal(targetConfig.schemaVersion, 1);
  assert.equal(targetConfig.defaultRepoId, "primary");
  assert.equal(targetConfig.repoMappings.primary?.path, canonical(repoRoot));
  assert.equal(targetConfig.repoMappings.tokenpilot, undefined);

  const targetInit = initLocalRuntime(targetPaths);
  assert.equal(targetInit.created, true);
  assert.equal(targetInit.tokenGenerated, true);
  const targetEnv = fs.readFileSync(path.join(targetPaths.runtimeDir, "server.env"), "utf8");
  assert.match(targetEnv, /^# ChatCockpit local runtime config\./m);
  assert.match(targetEnv, /^CHATCOCKPIT_HOST=127\.0\.0\.1$/m);
  assert.match(targetEnv, /^CHATCOCKPIT_PORT=4318$/m);
  assert.match(targetEnv, /^CHATCOCKPIT_EXPOSED=false$/m);
  assert.match(targetEnv, /^CHATCOCKPIT_API_TOKEN=cc_local_[A-Za-z0-9_-]+$/m);
  assert.match(targetEnv, /^CHATCOCKPIT_PUBLIC_BASE_URL=$/m);
  assert.match(targetEnv, /^CHATCOCKPIT_RUNNER_INTERVAL=3$/m);
  assert.doesNotMatch(targetEnv, /TOKENPILOT_/);
  assert.doesNotMatch(targetEnv, /TokenPilot/);
  assert.equal(
    targetInit.messages.some((message) => message.includes(".chatcockpit/runtime/server.env")),
    true
  );

  const currentConfigPath = path.join(targetHome, "current-config.json");
  const currentConfig = loadUserConfig(
    repoRoot,
    buildSourceDistributionContext(repoRoot, { configPath: currentConfigPath })
  );
  assert.equal(currentConfig.defaultRepoId, "tokenpilot");
  assert.equal(currentConfig.repoMappings.tokenpilot?.path, canonical(repoRoot));

  const currentPathsForInit = buildPaths(
    buildSourceDistributionContext(repoRoot, {
      stateRoot: path.join(root, "current-state", ".tokenpilot"),
      configPath: currentConfigPath
    })
  );
  initLocalRuntime(currentPathsForInit);
  const currentEnv = fs.readFileSync(
    path.join(currentPathsForInit.runtimeDir, "server.env"),
    "utf8"
  );
  assert.match(currentEnv, /^# TokenPilot local runtime config\./m);
  assert.match(currentEnv, /^TOKENPILOT_API_TOKEN=tp_local_[A-Za-z0-9_-]+$/m);
  assert.doesNotMatch(currentEnv, /CHATCOCKPIT_/);

  const packagedTarget = buildDistributionContextForProduct(
    "chatcockpit",
    {
      mode: "packaged",
      installRoot: repoRoot,
      primaryWorkspaceRoot: repoRoot
    },
    {}
  );
  assert.equal(packagedTarget.productIdentity, "chatcockpit");
  assert.match(
    packagedTarget.stateRoot,
    /Library\/Application Support\/ChatCockpit\/state$/
  );
  assert.match(
    packagedTarget.configPath,
    /Library\/Application Support\/ChatCockpit\/config\/config\.json$/
  );

  const defaultContext = buildDistributionContext(
    {
      mode: "source",
      installRoot: repoRoot,
      stateRoot: path.join(repoRoot, ".tokenpilot"),
      primaryWorkspaceRoot: repoRoot,
      configPath: currentConfigPath
    },
    {}
  );
  assert.equal(defaultContext.productIdentity, "tokenpilot");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_CHATCOCKPIT_PRODUCT_IDENTITY_OK\n");

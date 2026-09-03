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
import { USER_CONFIG_SCHEMA_VERSION } from "../src/core/user-config-schema.js";
import { buildPaths } from "../src/core/paths.js";
import { initLocalRuntime } from "../src/core/setup.js";
import {
  CHATCOCKPIT_PRODUCT_IDENTITY,
  DEFAULT_PRODUCT_IDENTITY,
  TOKENPILOT_PRODUCT_IDENTITY,
  productIdentityForKey
} from "../src/core/product-identity.js";

assert.equal(DEFAULT_PRODUCT_IDENTITY.key, "chatcockpit");
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
  const fixtureHome = path.join(root, "home");
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(fixtureHome, { recursive: true });

  const defaultConfigPath = path.join(fixtureHome, ".chatcockpit", "config.json");
  const defaultSource = buildSourceDistributionContext(
    repoRoot,
    { configPath: defaultConfigPath },
    { ...process.env, HOME: fixtureHome }
  );
  const defaultPaths = buildPaths(defaultSource);
  assert.equal(defaultSource.productIdentity, "chatcockpit");
  assert.equal(defaultSource.stateRoot, path.join(canonical(fixtureHome), ".chatcockpit"));
  assert.equal(defaultSource.configPath, path.resolve(defaultConfigPath));
  assert.match(defaultPaths.runnerPlistPath, /com\.wuaishare\.chatcockpit\.runner\.plist$/);
  assert.match(defaultPaths.deviceAgentPlistPath, /com\.wuaishare\.chatcockpit\.device-agent\.plist$/);
  assert.match(
    defaultPaths.processSupervisorPlistPath,
    /com\.wuaishare\.chatcockpit\.process-supervisor\.plist$/
  );

  const defaultConfig = loadUserConfig(repoRoot, defaultSource);
  assert.equal(defaultConfig.schemaVersion, USER_CONFIG_SCHEMA_VERSION);
  assert.equal(defaultConfig.defaultRepoId, "primary");
  assert.equal(defaultConfig.repoMappings.primary?.path, canonical(repoRoot));
  assert.equal(defaultConfig.repoMappings.tokenpilot, undefined);

  const defaultInit = initLocalRuntime(defaultPaths);
  assert.equal(defaultInit.created, true);
  assert.equal(defaultInit.tokenGenerated, true);
  const defaultEnv = fs.readFileSync(path.join(defaultPaths.runtimeDir, "server.env"), "utf8");
  assert.match(defaultEnv, /^# ChatCockpit local runtime config\./m);
  assert.match(defaultEnv, /^CHATCOCKPIT_HOST=127\.0\.0\.1$/m);
  assert.match(defaultEnv, /^CHATCOCKPIT_PORT=4318$/m);
  assert.match(defaultEnv, /^CHATCOCKPIT_EXPOSED=false$/m);
  assert.match(defaultEnv, /^CHATCOCKPIT_API_TOKEN=cc_local_[A-Za-z0-9_-]+$/m);
  assert.match(defaultEnv, /^CHATCOCKPIT_PUBLIC_BASE_URL=$/m);
  assert.match(defaultEnv, /^CHATCOCKPIT_RUNNER_INTERVAL=3$/m);
  assert.doesNotMatch(defaultEnv, /TOKENPILOT_/);
  assert.doesNotMatch(defaultEnv, /TokenPilot/);
  assert.equal(
    defaultInit.messages.some((message) => message.includes(".chatcockpit/runtime/server.env")),
    true
  );

  // R3 still retains an explicit legacy profile for migration/compatibility tooling,
  // but it is no longer the default source generation path.
  const legacyConfigPath = path.join(fixtureHome, ".tokenpilot", "config.json");
  const legacySource = buildSourceDistributionContextForProduct(
    "tokenpilot",
    repoRoot,
    { configPath: legacyConfigPath },
    { ...process.env, HOME: fixtureHome }
  );
  const legacyPaths = buildPaths(legacySource);
  assert.equal(legacySource.productIdentity, "tokenpilot");
  assert.equal(legacySource.stateRoot, path.join(canonical(repoRoot), ".tokenpilot"));
  assert.match(legacyPaths.runnerPlistPath, /com\.wuaishare\.tokenpilot\.runner\.plist$/);
  assert.match(legacyPaths.deviceAgentPlistPath, /com\.wuaishare\.tokenpilot\.device-agent\.plist$/);

  const legacyConfig = loadUserConfig(repoRoot, legacySource);
  assert.equal(legacyConfig.defaultRepoId, "tokenpilot");
  assert.equal(legacyConfig.repoMappings.tokenpilot?.path, canonical(repoRoot));

  const legacyInit = initLocalRuntime(legacyPaths);
  const legacyEnv = fs.readFileSync(path.join(legacyPaths.runtimeDir, "server.env"), "utf8");
  assert.match(legacyEnv, /^# TokenPilot local runtime config\./m);
  assert.match(legacyEnv, /^TOKENPILOT_API_TOKEN=tp_local_[A-Za-z0-9_-]+$/m);
  assert.doesNotMatch(legacyEnv, /CHATCOCKPIT_/);

  const packagedDefault = buildDistributionContext(
    {
      mode: "packaged",
      installRoot: repoRoot,
      primaryWorkspaceRoot: repoRoot
    },
    { HOME: fixtureHome }
  );
  assert.equal(packagedDefault.productIdentity, "chatcockpit");
  assert.match(packagedDefault.stateRoot, /Library\/Application Support\/ChatCockpit\/state$/);
  assert.match(
    packagedDefault.configPath,
    /Library\/Application Support\/ChatCockpit\/config\/config\.json$/
  );

  const explicitPackagedTarget = buildDistributionContextForProduct(
    "chatcockpit",
    {
      mode: "packaged",
      installRoot: repoRoot,
      primaryWorkspaceRoot: repoRoot
    },
    { HOME: fixtureHome }
  );
  assert.deepEqual(packagedDefault, explicitPackagedTarget);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_CHATCOCKPIT_PRODUCT_IDENTITY_OK\n");

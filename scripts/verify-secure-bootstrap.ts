import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  operatorCredentialVaultPath,
  readOperatorCredentialVault
} from "../src/auth/operator-credential-vault.js";
import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { initLocalRuntime } from "../src/core/setup.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import {
  DEFAULT_CONSOLE_PATH_PREFIX,
  loadAccessPolicy,
  updateAccessPolicy
} from "../src/security/access-policy.js";
import {
  ensureSecureBootstrap,
  setOperatorOwnerPasswordWithVault,
  type SecureBootstrapResult
} from "../src/security/secure-bootstrap.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

function fixture(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `chatcockpit-secure-bootstrap-${name}-`));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  return { root, paths };
}

function runCli(home: string, args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli/index.ts", ...args],
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        HOME: home,
        CHATCOCKPIT_STATE_ROOT: path.join(home, ".chatcockpit"),
        CHATCOCKPIT_EXPOSED: "false",
        CHATCOCKPIT_API_TOKEN: ""
      },
      encoding: "utf8"
    }
  );
}

async function main(): Promise<void> {
  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-secure-bootstrap-cli-"));
  const cliInit = runCli(cliHome, ["init", "--json"]);
  assert.equal(cliInit.status, 0, cliInit.stderr);
  const cliInitResult = JSON.parse(cliInit.stdout) as {
    secureBootstrap: SecureBootstrapResult;
  };
  assert.equal(cliInitResult.secureBootstrap.ownerCreated, true);
  assert.equal(cliInitResult.secureBootstrap.credentialAvailable, true);
  assert.equal(cliInitResult.secureBootstrap.consolePathRandomized, true);
  assert.doesNotMatch(cliInit.stdout, /cc_owner_[a-f0-9]{12}/);
  assert.doesNotMatch(cliInit.stdout, /\/cc-[A-Za-z0-9_-]{24}/);
  assert.doesNotMatch(cliInit.stdout, /"password"/);
  assert.doesNotMatch(cliInit.stderr, /cc_owner_|\/cc-|password/i);

  const cliStatus = runCli(cliHome, ["operator", "status", "--json"]);
  assert.equal(cliStatus.status, 0, cliStatus.stderr);
  const cliStatusResult = JSON.parse(cliStatus.stdout) as {
    configured: boolean;
    username: string;
    credentialAvailable: boolean;
  };
  assert.equal(cliStatusResult.configured, true);
  assert.match(cliStatusResult.username, /^cc_owner_[a-f0-9]{12}$/);
  assert.equal(cliStatusResult.credentialAvailable, true);
  assert.equal(Object.prototype.hasOwnProperty.call(cliStatusResult, "password"), false);

  const cliPolicy = runCli(cliHome, ["access-policy", "status", "--json"]);
  assert.equal(cliPolicy.status, 0, cliPolicy.stderr);
  assert.match(
    String((JSON.parse(cliPolicy.stdout) as { consolePathPrefix: string }).consolePathPrefix),
    /^\/cc-[A-Za-z0-9_-]{24}$/
  );
  fs.rmSync(cliHome, { recursive: true, force: true });

  const fresh = fixture("fresh");
  initLocalRuntime(fresh.paths);

  const first = await ensureSecureBootstrap(fresh.paths);
  assert.equal(first.ownerCreated, true);
  assert.equal(first.credentialAvailable, true);
  assert.equal(first.consolePathRandomized, true);
  assert.equal(JSON.stringify(first).includes("password"), false);

  const firstPolicy = loadAccessPolicy(fresh.paths);
  assert.notEqual(firstPolicy.consolePathPrefix, DEFAULT_CONSOLE_PATH_PREFIX);
  assert.match(firstPolicy.consolePathPrefix, /^\/cc-[A-Za-z0-9_-]{24}$/);

  const firstCredential = readOperatorCredentialVault(fresh.paths);
  assert.ok(firstCredential);
  assert.match(firstCredential.username, /^cc_owner_[a-f0-9]{12}$/);
  assert.match(firstCredential.password, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(fs.statSync(operatorCredentialVaultPath(fresh.paths)).mode & 0o777, 0o600);

  const freshStore = new OperatorStore({ path: operatorDatabasePath(fresh.paths.runtimeDir) });
  const freshService = new OperatorService({ store: freshStore });
  try {
    assert.deepEqual(freshService.status(), {
      configured: true,
      username: firstCredential.username
    });
    const session = await freshService.login({
      username: firstCredential.username,
      password: firstCredential.password,
      source: "127.0.0.1"
    });
    assert.equal(session.username, firstCredential.username);
  } finally {
    freshStore.close();
  }
  assert.equal(
    fs.readFileSync(operatorDatabasePath(fresh.paths.runtimeDir)).includes(
      Buffer.from(firstCredential.password, "utf8")
    ),
    false,
    "recoverable password must never be stored in the hashed Operator database"
  );

  const second = await ensureSecureBootstrap(fresh.paths);
  assert.deepEqual(second, {
    ok: true,
    ownerCreated: false,
    credentialAvailable: true,
    consolePathRandomized: false
  });
  assert.equal(loadAccessPolicy(fresh.paths).consolePathPrefix, firstPolicy.consolePathPrefix);
  assert.deepEqual(readOperatorCredentialVault(fresh.paths), firstCredential);

  const custom = fixture("custom-path");
  updateAccessPolicy(custom.paths, { consolePathPrefix: "/private-console-entry" });
  const customBootstrap = await ensureSecureBootstrap(custom.paths);
  assert.equal(customBootstrap.ownerCreated, true);
  assert.equal(customBootstrap.consolePathRandomized, false);
  assert.equal(loadAccessPolicy(custom.paths).consolePathPrefix, "/private-console-entry");

  const legacy = fixture("legacy-owner");
  const legacyStore = new OperatorStore({ path: operatorDatabasePath(legacy.paths.runtimeDir) });
  const legacyService = new OperatorService({ store: legacyStore });
  await legacyService.setOwnerPassword({
    username: "legacy_owner",
    password: "test-password-legacy-owner-fixture"
  });
  legacyStore.close();
  const legacyBootstrap = await ensureSecureBootstrap(legacy.paths);
  assert.deepEqual(legacyBootstrap, {
    ok: true,
    ownerCreated: false,
    credentialAvailable: false,
    consolePathRandomized: false
  });
  assert.equal(loadAccessPolicy(legacy.paths).consolePathPrefix, DEFAULT_CONSOLE_PATH_PREFIX);
  assert.equal(readOperatorCredentialVault(legacy.paths), null);

  const managedStore = new OperatorStore({ path: operatorDatabasePath(legacy.paths.runtimeDir) });
  const managedService = new OperatorService({ store: managedStore });
  try {
    const updated = await setOperatorOwnerPasswordWithVault(legacy.paths, managedService, {
      username: "managed_owner",
      password: "test-password-managed-owner-fixture"
    });
    assert.equal(updated.username, "managed_owner");
  } finally {
    managedStore.close();
  }
  const managedCredential = readOperatorCredentialVault(legacy.paths);
  assert.ok(managedCredential);
  assert.equal(managedCredential.username, "managed_owner");
  assert.equal(managedCredential.password, "test-password-managed-owner-fixture");

  const vaultPath = operatorCredentialVaultPath(legacy.paths);
  fs.chmodSync(vaultPath, 0o644);
  assert.throws(
    () => readOperatorCredentialVault(legacy.paths),
    /permissions are too broad/
  );

  process.stdout.write("SECURE_BOOTSTRAP_OK\n");
}

await main();

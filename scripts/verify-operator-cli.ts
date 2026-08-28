import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  OperatorStore,
  hashOperatorSessionSecret,
  operatorDatabasePath
} from "../src/auth/operator-store.js";
import { operatorCredentialVaultPath } from "../src/auth/operator-credential-vault.js";

const repoRoot = path.resolve(import.meta.dirname, "..");

function runCli(home: string, args: string[], input?: string) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/cli/index.ts", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CHATCOCKPIT_STATE_ROOT: path.join(home, ".chatcockpit"),
      CHATCOCKPIT_EXPOSED: "false",
      CHATCOCKPIT_API_TOKEN: ""
    },
    encoding: "utf8",
    input
  });
}

function parseJsonOutput(value: string): Record<string, unknown> {
  return JSON.parse(value.trim()) as Record<string, unknown>;
}

function main(): void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-operator-cli-"));
  const password = "test-password-correct-horse-battery-staple";

  let result = runCli(home, ["operator", "status", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseJsonOutput(result.stdout), {
    configured: false,
    username: null,
    credentialAvailable: false,
    activeSessionCount: 0
  });

  result = runCli(
    home,
    ["operator", "set-password", "--username", "owner", "--password-stdin", "--json"],
    `${password}\n`
  );
  assert.equal(result.status, 0, result.stderr);
  const updated = parseJsonOutput(result.stdout);
  assert.equal(updated.username, "owner");
  assert.equal(updated.revokedSessionCount, 0);
  assert.equal(result.stdout.includes(password), false);
  assert.equal(result.stderr.includes(password), false);

  const credentialPath = operatorCredentialVaultPath({
    runtimeDir: path.join(home, ".chatcockpit", "runtime")
  });
  assert.equal(fs.existsSync(credentialPath), true);
  assert.equal(fs.statSync(credentialPath).mode & 0o777, 0o600);

  result = runCli(home, ["operator", "credentials", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const credential = parseJsonOutput(result.stdout);
  assert.equal(credential.available, true);
  assert.equal(credential.username, "owner");
  assert.equal(credential.password, password);

  const databasePath = operatorDatabasePath(path.join(home, ".chatcockpit", "runtime"));
  assert.equal(fs.existsSync(databasePath), true);
  assert.equal(fs.readFileSync(databasePath).includes(Buffer.from(password, "utf8")), false);

  result = runCli(home, ["operator", "local-login-grant", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const localGrant = parseJsonOutput(result.stdout);
  assert.match(String(localGrant.grantSecret), /^cc_local_login_[A-Za-z0-9_-]{43}$/);
  assert.match(String(localGrant.expiresAt), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(
    fs.readFileSync(databasePath).includes(Buffer.from(String(localGrant.grantSecret), "utf8")),
    false
  );

  const store = new OperatorStore({ path: databasePath });
  const owner = store.getOwner();
  assert.ok(owner);
  store.createSession({
    id: "cli-test-session",
    principalId: owner.id,
    secretHash: hashOperatorSessionSecret("cli-test-session-secret"),
    csrfToken: "cli-test-csrf",
    createdAt: "2026-08-16T03:00:00.000Z",
    lastSeenAt: "2026-08-16T03:00:00.000Z",
    idleExpiresAt: "2099-08-16T15:00:00.000Z",
    absoluteExpiresAt: "2099-08-23T03:00:00.000Z"
  });
  store.close();

  result = runCli(home, ["operator", "status", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const statusWithSession = parseJsonOutput(result.stdout);
  assert.equal(statusWithSession.activeSessionCount, 1);
  assert.equal(statusWithSession.credentialAvailable, true);
  assert.equal(Object.prototype.hasOwnProperty.call(statusWithSession, "password"), false);

  result = runCli(home, ["operator", "revoke-sessions", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parseJsonOutput(result.stdout).revokedSessionCount, 1);

  process.stdout.write("OPERATOR_CLI_OK\n");
}

main();

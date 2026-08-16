import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");

function runCli(home: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/cli/index.ts", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CHATCOCKPIT_EXPOSED: "false",
      CHATCOCKPIT_API_TOKEN: ""
    },
    encoding: "utf8"
  });
}

function parseJson(value: string): Record<string, unknown> {
  return JSON.parse(value.trim()) as Record<string, unknown>;
}

function main(): void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-access-policy-cli-"));
  const privateLanBase = ["192", "168"].join(".");
  const cidr = `${privateLanBase}.77.0/24`;

  try {
    let result = runCli(home, ["access-policy", "status", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(parseJson(result.stdout), {
      schemaVersion: 1,
      consolePathPrefix: "/ui",
      trustedLan: { enabled: false, cidrs: [] }
    });

    result = runCli(home, [
      "access-policy",
      "set",
      "--console-path",
      "/ops-cli-proof",
      "--lan-enabled",
      "true",
      "--lan-cidr",
      cidr,
      "--json"
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(parseJson(result.stdout), {
      schemaVersion: 1,
      consolePathPrefix: "/ops-cli-proof",
      trustedLan: { enabled: true, cidrs: [cidr] }
    });

    const policyPath = path.join(home, ".chatcockpit", "runtime", "access-policy.json");
    assert.equal(fs.existsSync(policyPath), true);
    assert.equal(fs.statSync(policyPath).mode & 0o777, 0o600);
    const persisted = JSON.parse(fs.readFileSync(policyPath, "utf8")) as Record<string, unknown>;
    assert.equal(persisted.consolePathPrefix, "/ops-cli-proof");

    result = runCli(home, [
      "access-policy",
      "set",
      "--lan-enabled",
      "false",
      "--json"
    ]);
    assert.equal(result.status, 0, result.stderr);
    const disabled = parseJson(result.stdout);
    assert.equal((disabled.trustedLan as { enabled: boolean }).enabled, false);
    assert.equal(disabled.consolePathPrefix, "/ops-cli-proof");

    result = runCli(home, [
      "access-policy",
      "set",
      "--console-path",
      "/api",
      "--json"
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reserved ChatCockpit endpoint/);

    process.stdout.write("ACCESS_POLICY_CLI_OK\n");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

main();

import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const helper = path.join(root, "scripts", "npm-audit-with-retry.sh");

async function runScenario(mode: "transient-then-success" | "vulnerability" | "transient-exhausted") {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "chatcockpit-audit-retry-"));
  const fakeNpm = path.join(tempDir, "npm");
  const counter = path.join(tempDir, "count");
  await writeFile(counter, "0", "utf8");
  await writeFile(
    fakeNpm,
    `#!/usr/bin/env bash
set -euo pipefail
count=$(cat "${counter}")
count=$((count + 1))
printf '%s' "$count" > "${counter}"
case "${mode}" in
  transient-then-success)
    if (( count == 1 )); then
      echo 'npm warn audit request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: Client network socket disconnected before secure TLS connection was established' >&2
      echo 'npm error audit endpoint returned an error' >&2
      exit 1
    fi
    echo 'found 0 vulnerabilities'
    exit 0
    ;;
  vulnerability)
    echo '# npm audit report'
    echo '1 moderate severity vulnerability'
    exit 1
    ;;
  transient-exhausted)
    echo 'npm error code ECONNRESET' >&2
    echo 'npm error audit endpoint returned an error' >&2
    exit 1
    ;;
esac
`,
    "utf8"
  );
  await chmod(fakeNpm, 0o755);

  const result = spawnSync("bash", [helper, "--audit-level=moderate"], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${tempDir}:${process.env.PATH ?? ""}`,
      CHATCOCKPIT_NPM_AUDIT_MAX_ATTEMPTS: "3",
      CHATCOCKPIT_NPM_AUDIT_RETRY_DELAY_SECONDS: "0"
    },
    encoding: "utf8"
  });
  const attempts = Number.parseInt(await readFile(counter, "utf8"), 10);
  await rm(tempDir, { recursive: true, force: true });
  return { result, attempts };
}

{
  const { result, attempts } = await runScenario("transient-then-success");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(attempts, 2);
  assert.match(result.stderr, /Transient npm audit registry failure on attempt 1\/3; retrying\./);
  assert.match(result.stdout, /found 0 vulnerabilities/);
}

{
  const { result, attempts } = await runScenario("vulnerability");
  assert.equal(result.status, 1);
  assert.equal(attempts, 1, "a vulnerability result must fail immediately without retrying");
  assert.doesNotMatch(result.stderr, /retrying/);
}

{
  const { result, attempts } = await runScenario("transient-exhausted");
  assert.equal(result.status, 1);
  assert.equal(attempts, 3);
  assert.match(result.stderr, /failed after 3\/3 attempts/);
}

console.log("VERIFY_NPM_AUDIT_WITH_RETRY_OK");

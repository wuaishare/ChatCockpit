import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { PROCESS_SUPERVISOR_DOWNSTREAM_GUARDIAN_SOURCE } from "../src/process-supervisor/downstream-containment.ts";

const sandbox = fs.mkdtempSync(path.join("/tmp", "tp-ps-containment-"));
const marker = path.join(sandbox, "delayed-marker.txt");
const guardianSpec = Buffer.from(
  JSON.stringify({
    command: process.execPath,
    args: [
      "-e",
      `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(
        marker
      )}, 'orphan-side-effect\\n', 'utf8'), 700); setInterval(() => {}, 1000);`
    ]
  }),
  "utf8"
).toString("base64url");

const guardian = spawn(
  process.execPath,
  ["-e", PROCESS_SUPERVISOR_DOWNSTREAM_GUARDIAN_SOURCE],
  {
    env: {
      ...process.env,
      TOKENPILOT_DOWNSTREAM_GUARDIAN_SPEC: guardianSpec
    },
    stdio: ["pipe", "pipe", "pipe"]
  }
);

try {
  await new Promise((resolve) => setTimeout(resolve, 120));
  guardian.stdin.end();

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      guardian.kill("SIGTERM");
      reject(new Error("Process Supervisor downstream guardian did not exit after parent EOF"));
    }, 2_000);
    guardian.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    guardian.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(
    fs.existsSync(marker),
    false,
    "Downstream guardian left a delayed process-group side effect after parent EOF"
  );

  process.stdout.write("VERIFY_PROCESS_SUPERVISOR_CONTAINMENT_OK\n");
} finally {
  if (guardian.exitCode === null && guardian.signalCode === null) {
    guardian.kill("SIGTERM");
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
}

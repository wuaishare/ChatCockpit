import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildPaths } from "../src/core/paths.ts";
import {
  PROCESS_SUPERVISOR_PROTOCOL_VERSION,
  PROCESS_SUPERVISOR_REQUEST_MAX_BYTES,
  PROCESS_SUPERVISOR_RESPONSE_MAX_BYTES,
  decodeSupervisorRequest,
  encodeSupervisorResponse,
  isProcessSupervisorMethod
} from "../src/process-supervisor/protocol.ts";
import {
  ensureProcessSupervisorRuntime,
  readProcessSupervisorToken,
  removeStaleProcessSupervisorSocket,
  rotateProcessSupervisorToken,
  writeProcessSupervisorStatus
} from "../src/process-supervisor/runtime-files.ts";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-process-supervisor-ipc-"));

try {
  const paths = buildPaths(sandbox);
  assert.equal(path.basename(paths.processSupervisorSocketPath), "process-supervisor.sock");
  assert.equal(path.basename(paths.processSupervisorTokenPath), "process-supervisor.token");
  assert.equal(path.basename(paths.processSupervisorStatusPath), "process-supervisor-status.json");
  assert.equal(path.basename(paths.processSupervisorPidPath), "process-supervisor.pid");
  assert.equal(path.basename(paths.processSupervisorLogPath), "process-supervisor.log");
  assert.equal(path.basename(paths.processSupervisorEventsPath), "process-supervisor-events.jsonl");

  ensureProcessSupervisorRuntime(paths);
  assert.equal(fs.statSync(paths.runtimeDir).mode & 0o777, 0o700);

  const tokenA = rotateProcessSupervisorToken(paths);
  assert.ok(tokenA.length >= 32);
  assert.equal(readProcessSupervisorToken(paths), tokenA);
  assert.equal(fs.statSync(paths.processSupervisorTokenPath).mode & 0o777, 0o600);
  const tokenB = rotateProcessSupervisorToken(paths);
  assert.notEqual(tokenB, tokenA);
  assert.equal(readProcessSupervisorToken(paths), tokenB);

  writeProcessSupervisorStatus(paths, {
    generation: "generation-a",
    startedAt: "2026-08-09T06:55:00.000Z",
    heartbeatAt: "2026-08-09T06:55:01.000Z",
    state: "ready",
    ownedProcessCount: 0,
    protocolVersion: PROCESS_SUPERVISOR_PROTOCOL_VERSION
  });
  const statusRaw = JSON.parse(fs.readFileSync(paths.processSupervisorStatusPath, "utf8")) as {
    generation: string;
    protocolVersion: number;
  };
  assert.equal(statusRaw.generation, "generation-a");
  assert.equal(statusRaw.protocolVersion, 1);
  assert.equal(fs.statSync(paths.processSupervisorStatusPath).mode & 0o777, 0o600);

  assert.equal(PROCESS_SUPERVISOR_PROTOCOL_VERSION, 1);
  assert.equal(PROCESS_SUPERVISOR_REQUEST_MAX_BYTES, 32 * 1024);
  assert.equal(PROCESS_SUPERVISOR_RESPONSE_MAX_BYTES, 96 * 1024);
  for (const method of [
    "health",
    "owned.list",
    "process.start",
    "process.read",
    "process.input",
    "process.stop",
    "events.list",
    "events.ack"
  ]) {
    assert.equal(isProcessSupervisorMethod(method), true, method);
  }
  for (const method of ["os.process.list", "os.process.kill", "pid.attach", "raw.downstream.call"]) {
    assert.equal(isProcessSupervisorMethod(method), false, method);
  }

  const request = decodeSupervisorRequest(
    JSON.stringify({
      protocolVersion: 1,
      requestId: "request-1",
      authToken: tokenB,
      method: "health",
      params: {}
    })
  );
  assert.equal(request.method, "health");
  assert.equal(request.requestId, "request-1");

  assert.throws(
    () =>
      decodeSupervisorRequest(
        JSON.stringify({
          protocolVersion: 2,
          requestId: "request-2",
          authToken: tokenB,
          method: "health",
          params: {}
        })
      ),
    /protocol/i
  );
  assert.throws(
    () =>
      decodeSupervisorRequest(
        JSON.stringify({
          protocolVersion: 1,
          requestId: "request-3",
          authToken: tokenB,
          method: "os.process.kill",
          params: {}
        })
      ),
    /method/i
  );
  assert.throws(
    () => decodeSupervisorRequest("x".repeat(PROCESS_SUPERVISOR_REQUEST_MAX_BYTES + 1)),
    /large|size|frame/i
  );

  const response = encodeSupervisorResponse({
    protocolVersion: 1,
    requestId: "request-1",
    supervisorGeneration: "generation-a",
    ok: true,
    result: { state: "ready" }
  });
  assert.ok(Buffer.byteLength(response, "utf8") <= PROCESS_SUPERVISOR_RESPONSE_MAX_BYTES);
  assert.match(response, /generation-a/);
  assert.throws(
    () =>
      encodeSupervisorResponse({
        protocolVersion: 1,
        requestId: "request-large",
        supervisorGeneration: "generation-a",
        ok: true,
        result: { output: "x".repeat(PROCESS_SUPERVISOR_RESPONSE_MAX_BYTES) }
      }),
    /large|size|frame/i
  );

  fs.writeFileSync(paths.processSupervisorSocketPath, "not-a-socket", "utf8");
  assert.throws(() => removeStaleProcessSupervisorSocket(paths), /socket|non-socket|refus/i);
  fs.rmSync(paths.processSupervisorSocketPath, { force: true });
  removeStaleProcessSupervisorSocket(paths);

  process.stdout.write("VERIFY_PROCESS_SUPERVISOR_IPC_OK\n");
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

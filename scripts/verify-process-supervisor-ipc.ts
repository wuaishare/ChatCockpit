import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
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
import {
  ProcessSupervisorClient,
  ProcessSupervisorClientError
} from "../src/process-supervisor/client.ts";
import {
  ProcessSupervisorIpcServer,
  containProcessSupervisorSocketTransportErrors
} from "../src/process-supervisor/server.ts";
import { ProcessSupervisorRuntimeError } from "../src/process-supervisor/service.ts";

const sandbox = fs.mkdtempSync(path.join("/tmp", "tp-ps-ipc-"));

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
    "terminal.list",
    "terminal.start",
    "terminal.read",
    "terminal.input",
    "terminal.resize",
    "terminal.stop",
    "events.list",
    "events.ack",
    "runtime.restart",
    "runtime.restart.read"
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

  const unguardedSocket = new net.Socket();
  assert.throws(
    () => unguardedSocket.emit("error", Object.assign(new Error("fixture EPIPE"), { code: "EPIPE" })),
    /fixture EPIPE/
  );
  const guardedSocket = new net.Socket();
  containProcessSupervisorSocketTransportErrors(guardedSocket);
  assert.doesNotThrow(() =>
    guardedSocket.emit("error", Object.assign(new Error("fixture EPIPE"), { code: "EPIPE" }))
  );
  assert.equal(guardedSocket.destroyed, true);

  fs.writeFileSync(paths.processSupervisorSocketPath, "not-a-socket", "utf8");
  assert.throws(() => removeStaleProcessSupervisorSocket(paths), /socket|non-socket|refus/i);
  fs.rmSync(paths.processSupervisorSocketPath, { force: true });
  removeStaleProcessSupervisorSocket(paths);

  let releaseDelayedHealth: (() => void) | null = null;
  let delayedHealthStarted: (() => void) | null = null;
  let delayedStartCalls = 0;
  const delayedHealthStartedPromise = new Promise<void>((resolve) => {
    delayedHealthStarted = resolve;
  });
  const delayedHealthReleasePromise = new Promise<void>((resolve) => {
    releaseDelayedHealth = resolve;
  });
  const server = new ProcessSupervisorIpcServer({
    paths,
    generation: "generation-a",
    authToken: tokenB,
    handler: async (method, params) => {
      if (method === "health") {
        if ((params as { disconnectDuringHandler?: boolean }).disconnectDuringHandler) {
          delayedHealthStarted?.();
          await delayedHealthReleasePromise;
        }
        return { state: "ready", echo: params };
      }
      if (method === "owned.list") {
        return { processes: [] };
      }
      if (method === "process.start") {
        delayedStartCalls += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, 5_250));
        return {
          processId: "host_process_timeout_budget_fixture",
          status: "running",
          exitCode: null,
          truncated: false
        };
      }
      if (method === "process.read") {
        throw new ProcessSupervisorRuntimeError(
          "DESKTOP_COMMANDER_MANAGED_PROCESS_INVALID",
          "private fixture detail must not cross IPC"
        );
      }
      throw new Error(`fixture does not implement ${method}`);
    }
  });
  await server.start();
  try {
    assert.equal(fs.lstatSync(paths.processSupervisorSocketPath).isSocket(), true);
    assert.equal(fs.statSync(paths.processSupervisorSocketPath).mode & 0o777, 0o600);

    const client = new ProcessSupervisorClient({ paths, timeoutMs: 1500 });
    const health = await client.request<{ state: string; echo: unknown }>("health", {
      ping: true
    });
    assert.equal(health.supervisorGeneration, "generation-a");
    assert.equal(health.result.state, "ready");
    assert.deepEqual(health.result.echo, { ping: true });

    const longOperationClient = new ProcessSupervisorClient({
      paths,
      timeoutMs: 5_000
    });
    const delayedStartAt = Date.now();
    const delayedStart = await longOperationClient.request<{
      processId: string;
      status: string;
      exitCode: number | null;
      truncated: boolean;
    }>(
      "process.start",
      { processId: "host_process_timeout_budget_fixture" },
      { timeoutMs: 7_000 }
    );
    assert.equal(delayedStart.result.status, "running");
    assert.equal(delayedStartCalls, 1);
    assert.ok(Date.now() - delayedStartAt >= 5_000);

    await assert.rejects(
      () => client.request("health", {}, { timeoutMs: 10 * 60 * 1000 + 1 }),
      (error: unknown) =>
        error instanceof ProcessSupervisorClientError &&
        error.code === "SUPERVISOR_BAD_REQUEST"
    );

    await assert.rejects(
      () => client.request("process.read", { processId: "fixture" }),
      (error: unknown) =>
        error instanceof ProcessSupervisorClientError &&
        error.code === "DESKTOP_COMMANDER_MANAGED_PROCESS_INVALID" &&
        error.message === "Process Supervisor method failed" &&
        !error.message.includes("private fixture detail")
    );
    await assert.rejects(
      () => client.request("process.stop", { processId: "fixture" }),
      (error: unknown) =>
        error instanceof ProcessSupervisorClientError &&
        error.code === "SUPERVISOR_METHOD_FAILED" &&
        error.message === "Process Supervisor method failed"
    );

    const disconnectingClient = net.createConnection(paths.processSupervisorSocketPath);
    disconnectingClient.setEncoding("utf8");
    await new Promise<void>((resolve, reject) => {
      disconnectingClient.once("connect", resolve);
      disconnectingClient.once("error", reject);
    });
    disconnectingClient.write(
      `${JSON.stringify({
        protocolVersion: 1,
        requestId: "request-disconnect-during-handler",
        authToken: tokenB,
        method: "health",
        params: { disconnectDuringHandler: true }
      })}\n`
    );
    await delayedHealthStartedPromise;
    disconnectingClient.destroy();
    releaseDelayedHealth?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 25));

    const healthAfterDisconnect = await client.request<{ state: string }>("health", {});
    assert.equal(healthAfterDisconnect.result.state, "ready");

    fs.writeFileSync(paths.processSupervisorTokenPath, `${"z".repeat(43)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await assert.rejects(
      () => client.request("health", {}),
      (error: unknown) =>
        error instanceof ProcessSupervisorClientError &&
        error.code === "SUPERVISOR_AUTH_FAILED" &&
        !error.message.includes(paths.processSupervisorSocketPath)
    );
    fs.writeFileSync(paths.processSupervisorTokenPath, `${tokenB}\n`, {
      encoding: "utf8",
      mode: 0o600
    });

    await server.close();
    await assert.rejects(
      () => client.request("health", {}),
      (error: unknown) =>
        error instanceof ProcessSupervisorClientError &&
        error.code === "SUPERVISOR_UNAVAILABLE"
    );
  } finally {
    await server.close();
  }
  assert.equal(fs.existsSync(paths.processSupervisorSocketPath), false);

  process.stdout.write("VERIFY_PROCESS_SUPERVISOR_IPC_OK\n");
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

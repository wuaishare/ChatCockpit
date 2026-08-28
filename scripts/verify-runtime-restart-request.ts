import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  LocalRuntimeRestartRequestError,
  requestLocalRuntimeRestart,
  type LocalRuntimeRestartClient
} from "../src/process-supervisor/runtime-restart-request.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-runtime-restart-request-"));
const paths = buildFixturePaths(root);
const calls: Array<{ method: string; params: unknown }> = [];
const client: LocalRuntimeRestartClient = {
  async request<T>(method, params) {
    calls.push({ method, params });
    const request = params as { operationId: string; requestHash: string };
    return {
      supervisorGeneration: "generation-request-test",
      result: {
        operationId: request.operationId,
        requestHash: request.requestHash,
        state: "scheduled",
        startedAt: null,
        completedAt: null,
        errorCode: null
      } as T
    };
  }
};

try {
  const nonce = "01234567-89ab-cdef-0123-456789abcdef";
  const result = await requestLocalRuntimeRestart(paths, { nonce, client });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "runtime.restart");
  const params = calls[0]?.params as { operationId: string; requestHash: string };
  assert.equal(params.operationId, `runtime_restart_local_${nonce}`);
  assert.match(params.requestHash, /^[a-f0-9]{64}$/);
  assert.equal(result.operationId, params.operationId);
  assert.equal(result.state, "scheduled");
  assert.equal(result.supervisorGeneration, "generation-request-test");
  assert.equal(JSON.stringify(result).includes("requestHash"), false);

  await assert.rejects(
    () => requestLocalRuntimeRestart(paths, { nonce: "bad nonce", client }),
    (error: unknown) =>
      error instanceof LocalRuntimeRestartRequestError &&
      error.code === "RUNTIME_RESTART_NONCE_INVALID"
  );

  const invalidClient: LocalRuntimeRestartClient = {
    async request<T>(_method, params) {
      const request = params as { requestHash: string };
      return {
        supervisorGeneration: "generation-invalid",
        result: {
          operationId: "runtime_restart_local_wrong",
          requestHash: request.requestHash,
          state: "scheduled",
          startedAt: null,
          completedAt: null,
          errorCode: null
        } as T
      };
    }
  };
  await assert.rejects(
    () => requestLocalRuntimeRestart(paths, { nonce, client: invalidClient }),
    (error: unknown) =>
      error instanceof LocalRuntimeRestartRequestError &&
      error.code === "RUNTIME_RESTART_RESPONSE_INVALID"
  );

  process.stdout.write("VERIFY_RUNTIME_RESTART_REQUEST_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

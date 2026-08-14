import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyReply } from "fastify";
import { z } from "zod";

import { FilesService } from "../src/application/files-service.js";
import { buildOperationContext } from "../src/application/operation-context.js";
import { ServiceError } from "../src/application/service-error.js";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.js";
import { defineMcpTool, readOnlyToolAnnotations } from "../src/mcp/tool-definition.js";
import { sendUnknownApiError } from "../src/server/errors.js";

interface CapturedLog {
  level: "warn" | "error";
  payload: unknown;
  message: string;
}

function fakeReply(requestId: string, logs: CapturedLog[]) {
  let statusCode = 200;
  const reply = {
    code(value: number) {
      statusCode = value;
      return reply;
    },
    request: {
      id: requestId,
      log: {
        warn(payload: unknown, message: string) {
          logs.push({ level: "warn", payload, message });
        },
        error(payload: unknown, message: string) {
          logs.push({ level: "error", payload, message });
        }
      }
    }
  } as unknown as FastifyReply;
  return { reply, statusCode: () => statusCode };
}

function assertPublicBodySafe(value: unknown, sensitive: string[]): void {
  const serialized = JSON.stringify(value);
  for (const marker of sensitive) {
    assert.equal(serialized.includes(marker), false, `Public error leaked ${marker}`);
  }
}

async function verifyMcpErrors(
  sensitiveMessage: string,
  sensitivePath: string
): Promise<void> {
  const context = buildOperationContext({
    requestId: "req-public-error-mcp",
    actorType: "remote-mcp",
    publicProjection: true
  });
  const rawTool = defineMcpTool({
    name: "tokenpilot.test.rawError",
    title: "Raw error fixture",
    description: "Test-only tool that proves unknown errors stay private.",
    inputSchema: z.object({}),
    annotations: readOnlyToolAnnotations,
    handler: () => {
      throw new Error(`${sensitiveMessage} ${sensitivePath}`);
    }
  });
  const wrappedTool = defineMcpTool({
    name: "tokenpilot.test.serviceError",
    title: "Service error fixture",
    description: "Test-only tool that proves private causes stay private.",
    inputSchema: z.object({}),
    annotations: readOnlyToolAnnotations,
    handler: () => {
      throw new ServiceError(
        "FILES_READ_BLOCKED",
        "File read was blocked or could not be completed.",
        {
          hint: "Check repoId and relative path before retrying.",
          cause: new Error(`${sensitiveMessage} ${sensitivePath}`)
        }
      );
    }
  });

  const stderr = process.stderr;
  const originalWrite = stderr.write;
  let diagnostic = "";
  stderr.write = ((chunk: string | Uint8Array) => {
    diagnostic += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof stderr.write;
  try {
    const rawResult = await rawTool.execute(context, {});
    assert.equal(rawResult.isError, true);
    assert.equal(rawResult.structuredContent.error instanceof Object, true);
    assert.equal(
      (rawResult.structuredContent.error as { code: string }).code,
      "INTERNAL_ERROR"
    );
    assert.equal(
      (rawResult.structuredContent.error as { message: string }).message,
      "Unexpected control-plane error. Check local server logs with the request ID."
    );
    assert.equal(
      (rawResult.structuredContent.error as { details?: { requestId?: string } }).details
        ?.requestId,
      context.requestId
    );
    assertPublicBodySafe(rawResult, [sensitiveMessage, sensitivePath]);

    const wrappedResult = await wrappedTool.execute(context, {});
    assert.equal(wrappedResult.isError, true);
    assert.equal(
      (wrappedResult.structuredContent.error as { code: string }).code,
      "FILES_READ_BLOCKED"
    );
    assert.equal(
      (wrappedResult.structuredContent.error as { message: string }).message,
      "File read was blocked or could not be completed."
    );
    assertPublicBodySafe(wrappedResult, [sensitiveMessage, sensitivePath]);
  } finally {
    stderr.write = originalWrite;
  }
  assert.match(diagnostic, /requestId=req-public-error-mcp/);
  assert.match(diagnostic, new RegExp(sensitiveMessage));
  assert.equal(diagnostic.includes(sensitivePath), true);
}

async function main(): Promise<void> {
  const sensitiveMessage = "private-diagnostic-marker";
  const sensitivePath = path.join(path.sep, "private-machine", "workspace", "secret-file");
  const rawError = new Error(`${sensitiveMessage} ${sensitivePath}`);

  const rawLogs: CapturedLog[] = [];
  const rawReply = fakeReply("req-public-error-rest", rawLogs);
  const rawBody = sendUnknownApiError(rawReply.reply, rawError);
  assert.equal(rawReply.statusCode(), 500);
  assert.equal(rawBody.error.code, "INTERNAL_ERROR");
  assert.equal(
    rawBody.error.message,
    "Unexpected control-plane error. Check local server logs with the request ID."
  );
  assert.deepEqual(rawBody.error.details, { requestId: "req-public-error-rest" });
  assertPublicBodySafe(rawBody, [sensitiveMessage, sensitivePath]);
  assert.equal(rawLogs.some((entry) => entry.level === "error"), true);
  const rawLoggedError = (rawLogs.find((entry) => entry.level === "error")?.payload as {
    err?: unknown;
  } | undefined)?.err;
  assert.ok(rawLoggedError instanceof Error);
  assert.match(rawLoggedError.message, new RegExp(sensitiveMessage));
  assert.equal(rawLoggedError.message.includes(sensitivePath), true);

  const serviceLogs: CapturedLog[] = [];
  const serviceReply = fakeReply("req-service-error-rest", serviceLogs);
  const serviceBody = sendUnknownApiError(
    serviceReply.reply,
    new ServiceError(
      "FILES_READ_BLOCKED",
      "File read was blocked or could not be completed.",
      {
        hint: "Check repoId and relative path before retrying.",
        cause: rawError
      }
    )
  );
  assert.equal(serviceReply.statusCode(), 400);
  assert.equal(serviceBody.error.code, "FILES_READ_BLOCKED");
  assertPublicBodySafe(serviceBody, [sensitiveMessage, sensitivePath]);
  assert.equal(serviceLogs.some((entry) => entry.level === "warn"), true);

  const recoveryLogs: CapturedLog[] = [];
  const recoveryReply = fakeReply("req-recovery-error-rest", recoveryLogs);
  const recoveryBody = sendUnknownApiError(
    recoveryReply.reply,
    new ServiceError(
      "RECOVERY_ASSESSMENT_STALE",
      "Runtime Recovery state changed after assessment; assess again",
      { cause: rawError }
    )
  );
  assert.equal(recoveryReply.statusCode(), 409);
  assert.equal(recoveryBody.error.code, "RECOVERY_ASSESSMENT_STALE");
  assertPublicBodySafe(recoveryBody, [sensitiveMessage, sensitivePath]);
  assert.equal(recoveryLogs.some((entry) => entry.level === "warn"), true);

  const serviceLoggedError = (serviceLogs.find((entry) => entry.level === "warn")?.payload as {
    err?: unknown;
  } | undefined)?.err;
  assert.ok(serviceLoggedError instanceof Error);
  assert.match(serviceLoggedError.message, new RegExp(sensitiveMessage));
  assert.equal(serviceLoggedError.message.includes(sensitivePath), true);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-public-errors-"));
  const paths = buildPaths(root);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "public-error-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      workspaceAllowlist: [root],
      repoMappings: { tokenpilot: { path: root } }
    }),
    "utf8"
  );
  const originalConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  process.env.TOKENPILOT_CONFIG_PATH = configPath;
  try {
    const files = new FilesService(paths);
    const context = buildOperationContext({
      requestId: "req-files-service-error",
      actorType: "local-operator",
      publicProjection: true
    });
    assert.throws(
      () => files.read(context, { repoId: "tokenpilot", path: "../outside.txt" }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "FILES_READ_BLOCKED");
        assert.equal(error.message, "File read was blocked or could not be completed.");
        assert.match(error.hint ?? "", /repoId/);
        assert.ok(error.cause instanceof Error);
        return true;
      }
    );
  } finally {
    if (originalConfigPath === undefined) delete process.env.TOKENPILOT_CONFIG_PATH;
    else process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
    fs.rmSync(root, { recursive: true, force: true });
  }

  await verifyMcpErrors(sensitiveMessage, sensitivePath);
  console.log("VERIFY_PUBLIC_ERRORS_OK");
}

await main();

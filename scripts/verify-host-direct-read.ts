import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HostDirectService } from "../src/application/host-direct-service.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
import { DESKTOP_COMMANDER_EXECUTOR_ID } from "../src/direct/adapters/desktop-commander.ts";
import { buildConfiguredDirectCapabilityBroker } from "../src/direct/broker-factory.ts";
import { DownstreamMcpExecutionRegistry } from "../src/direct/downstream-mcp-executor.ts";
import { probeConfiguredDownstreamMcpExecutors } from "../src/direct/downstream-mcp-operator.ts";
import { CodexStandaloneCapabilityStore } from "../src/runtime/codex/standalone-capabilities.ts";
import { buildServer } from "../src/server/app.ts";

const fixtureServer = fileURLToPath(
  new URL("./fixtures/fake-downstream-mcp-server.mjs", import.meta.url)
);

function writeDirectConfig(options: {
  configPath: string;
  hostRoot: string;
  mode?: string;
}): void {
  fs.writeFileSync(
    options.configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        hostRoots: [
          {
            id: "fixture",
            displayName: "Fixture Host Root",
            path: options.hostRoot,
            access: ["read"]
          }
        ],
        executors: [
          {
            id: DESKTOP_COMMANDER_EXECUTOR_ID,
            displayName: "Desktop Commander Fixture",
            transport: {
              kind: "stdio",
              command: process.execPath,
              args: [fixtureServer, options.mode ?? "desktop-read"],
              timeoutMs: 1000,
              maxBufferBytes: 262144,
              maxStderrBytes: 16384
            },
            mappings: [
              {
                capability: "files.read",
                toolName: "read_file",
                scopes: ["host"],
                access: ["read"]
              }
            ]
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function buildService(runtimeRoot: string, configPath: string): HostDirectService {
  const paths = buildPaths(runtimeRoot);
  const broker = buildConfiguredDirectCapabilityBroker({
    paths,
    codexStandaloneStore: new CodexStandaloneCapabilityStore(paths.runtimeDir),
    downstreamConfigPath: configPath
  });
  return new HostDirectService(
    broker,
    new DownstreamMcpExecutionRegistry(paths.runtimeDir, configPath),
    configPath
  );
}

async function expectCode(
  promise: Promise<unknown>,
  code: string
): Promise<void> {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.code, code);
    return true;
  });
}

async function verifyHostDirectRead(): Promise<void> {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-host-read-"));
  const runtimeRoot = path.join(sandbox, "chatcockpit-runtime-root");
  const hostRoot = path.join(sandbox, "host-root");
  const outsideRoot = path.join(sandbox, "outside");
  const configPath = path.join(sandbox, "direct-executors.json");
  fs.mkdirSync(path.join(hostRoot, "notes"), { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(
    path.join(hostRoot, "notes", "readme.txt"),
    "host direct fixture\nsecond line\n",
    "utf8"
  );
  fs.writeFileSync(path.join(hostRoot, ".env"), "SECRET=blocked\n", "utf8");
  fs.writeFileSync(
    path.join(hostRoot, "too-large.txt"),
    "x".repeat(64 * 1024 + 1),
    "utf8"
  );
  fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "outside\n", "utf8");
  let symlinkCreated = false;
  try {
    fs.symlinkSync(outsideRoot, path.join(hostRoot, "escape"), "dir");
    symlinkCreated = true;
  } catch {
    symlinkCreated = false;
  }

  writeDirectConfig({ configPath, hostRoot });
  const paths = buildPaths(runtimeRoot);
  await probeConfiguredDownstreamMcpExecutors({
    paths,
    configPath,
    executorId: DESKTOP_COMMANDER_EXECUTOR_ID
  });

  const service = buildService(runtimeRoot, configPath);
  const context = buildOperationContext({
    actorType: "remote-mcp",
    requestId: "host-direct-read-test",
    publicProjection: true
  });

  try {
    const roots = service.listRoots();
    assert.deepEqual(roots.roots, [
      {
        id: "fixture",
        displayName: "Fixture Host Root",
        access: ["read"]
      }
    ]);
    assert.doesNotMatch(JSON.stringify(roots), new RegExp(hostRoot));

    const read = await service.readFile(context, {
      rootId: "fixture",
      path: "notes/readme.txt"
    });
    assert.equal(read.file.content, "host direct fixture\nsecond line\n");
    assert.equal(read.file.path, "fixture/notes/readme.txt");
    assert.equal(read.execution.executionScope, "host");
    assert.equal(read.execution.modelLoopOwner, "chatgpt");
    assert.equal(read.execution.executor, DESKTOP_COMMANDER_EXECUTOR_ID);
    assert.equal(read.execution.selectionMode, "automatic");
    assert.deepEqual(read.execution.changedPaths, []);
    assert.doesNotMatch(JSON.stringify(read), new RegExp(hostRoot));

    await expectCode(
      service.readFile(context, {
        rootId: "fixture",
        path: path.join(hostRoot, "notes", "readme.txt")
      }),
      "HOST_PATH_BLOCKED"
    );
    await expectCode(
      service.readFile(context, {
        rootId: "fixture",
        path: "../outside/secret.txt"
      }),
      "HOST_PATH_BLOCKED"
    );
    await expectCode(
      service.readFile(context, { rootId: "fixture", path: ".env" }),
      "HOST_PATH_BLOCKED"
    );
    await expectCode(
      service.readFile(context, {
        rootId: "fixture",
        path: "too-large.txt"
      }),
      "HOST_FILE_TOO_LARGE"
    );
    if (symlinkCreated) {
      await expectCode(
        service.readFile(context, {
          rootId: "fixture",
          path: "escape/secret.txt"
        }),
        "HOST_PATH_BLOCKED"
      );
    }

    await expectCode(
      service.readFile(context, {
        rootId: "fixture",
        path: "notes/readme.txt",
        executorId: "tokenpilot-direct"
      }),
      "DIRECT_EXECUTOR_UNSUPPORTED"
    );

    const app = buildServer(paths, {
      directExecutorsConfigPath: configPath
    });
    try {
      const rootsResponse = await app.inject({
        method: "GET",
        url: "/api/host/roots"
      });
      assert.equal(rootsResponse.statusCode, 200);
      assert.doesNotMatch(rootsResponse.body, new RegExp(hostRoot));
      assert.match(rootsResponse.body, /Fixture Host Root/);

      const readResponse = await app.inject({
        method: "POST",
        url: "/api/host/files/read",
        payload: {
          rootId: "fixture",
          path: "notes/readme.txt"
        }
      });
      assert.equal(readResponse.statusCode, 200);
      assert.match(readResponse.body, /host direct fixture/);
      assert.match(readResponse.body, /\"executionScope\":\"host\"/);
      assert.doesNotMatch(readResponse.body, new RegExp(hostRoot));

      const blockedResponse = await app.inject({
        method: "POST",
        url: "/api/host/files/read",
        payload: {
          rootId: "fixture",
          path: "../outside/secret.txt"
        }
      });
      assert.equal(blockedResponse.statusCode, 403);
      assert.doesNotMatch(blockedResponse.body, new RegExp(hostRoot));
    } finally {
      await app.close();
    }

    const noSnapshotRoot = path.join(sandbox, "no-snapshot-runtime");
    fs.mkdirSync(noSnapshotRoot, { recursive: true });
    const noSnapshotService = buildService(noSnapshotRoot, configPath);
    await expectCode(
      noSnapshotService.readFile(context, {
        rootId: "fixture",
        path: "notes/readme.txt"
      }),
      "DIRECT_CAPABILITY_UNAVAILABLE"
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

await verifyHostDirectRead();
process.stdout.write("VERIFY_HOST_DIRECT_READ_OK\n");

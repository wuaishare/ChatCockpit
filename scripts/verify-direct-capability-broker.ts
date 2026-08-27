import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DirectCapabilityBroker,
  DirectCapabilityBrokerError,
  type DirectExecutorDescriptor
} from "../src/direct/capability-broker.ts";
import {
  createBuiltInDirectExecutorSource,
  createCodexStandaloneExecutorSource
} from "../src/direct/executor-sources.ts";
import { DEFAULT_PRODUCT_IDENTITY } from "../src/core/product-identity.ts";
import {
  CodexStandaloneCapabilityStore,
  type CodexStandaloneCapabilitySnapshot,
  type CodexStandaloneOperation
} from "../src/runtime/codex/standalone-capabilities.ts";

const ALL_OPERATIONS: CodexStandaloneOperation[] = [
  "files.read",
  "files.write",
  "files.list",
  "files.metadata",
  "files.createDirectory",
  "files.copy",
  "files.remove",
  "search.fileName",
  "search.content",
  "command.exec",
  "context.skills",
  "context.hooks",
  "context.mcpStatus",
  "context.config",
  "git.native"
];

function buildSnapshot(): CodexStandaloneCapabilitySnapshot {
  const verified = new Set<CodexStandaloneOperation>([
    "files.read",
    "files.write",
    "files.list",
    "command.exec"
  ]);
  return {
    schemaVersion: 1,
    runtime: "codex-app-server",
    protocolFamily: "app-server-v2",
    binarySource: "/private/should-not-leak/codex",
    binaryVersion: "codex-cli broker-test",
    serverProtocolVersion: "2.0",
    probedAt: "2026-08-08T05:00:00.000Z",
    operations: Object.fromEntries(
      ALL_OPERATIONS.map((operation) => [
        operation,
        {
          operation,
          method:
            operation === "files.read"
              ? "fs/readFile"
              : operation === "files.write"
                ? "fs/writeFile"
                : operation === "files.list"
                  ? "fs/readDirectory"
                  : operation === "command.exec"
                    ? "command/exec"
                    : null,
          status: verified.has(operation) ? "verified" : "unavailable",
          safeForChatDirect: verified.has(operation),
          errorCode: verified.has(operation) ? null : "NOT_PROBED",
          evidence: {}
        }
      ])
    ) as CodexStandaloneCapabilitySnapshot["operations"],
    outgoingMethods: [
      "fs/readFile",
      "fs/writeFile",
      "fs/readDirectory",
      "command/exec"
    ],
    turnStartObserved: false,
    directExecutionReady: true
  };
}

function assertPublicDescriptor(descriptor: DirectExecutorDescriptor): void {
  const serialized = JSON.stringify(descriptor);
  assert.doesNotMatch(serialized, /private\/should-not-leak/);
  assert.doesNotMatch(serialized, /binarySource/);
}

function verifyDirectCapabilityBroker(): void {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-broker-"));
  const store = new CodexStandaloneCapabilityStore(runtimeDir);
  store.write(buildSnapshot());

  const broker = new DirectCapabilityBroker([
    createCodexStandaloneExecutorSource(store, {
      source: "/private/should-not-leak/codex",
      version: "codex-cli broker-test"
    }),
    createBuiltInDirectExecutorSource()
  ], {
    executorAliases: DEFAULT_PRODUCT_IDENTITY.directExecutorInputAliases
  });

  const automaticRead = broker.resolve({
    capability: "files.read",
    scope: "workspace",
    access: "read"
  });
  assert.equal(automaticRead.executorId, "codex-app-server-standalone");
  assert.equal(automaticRead.selectionMode, "automatic");

  const explicitBuiltIn = broker.resolve({
    capability: "files.read",
    scope: "workspace",
    access: "read",
    executorId: "builtin-direct"
  });
  assert.equal(explicitBuiltIn.executorId, "builtin-direct");
  assert.equal(explicitBuiltIn.selectionMode, "explicit");

  const legacyBuiltInAlias = broker.resolve({
    capability: "files.read",
    scope: "workspace",
    access: "read",
    executorId: "tokenpilot-direct"
  });
  assert.equal(legacyBuiltInAlias.executorId, "builtin-direct");
  assert.equal(legacyBuiltInAlias.selectionMode, "explicit");

  const automaticEdit = broker.resolve({
    capability: "files.edit",
    scope: "workspace",
    access: "write"
  });
  assert.equal(automaticEdit.executorId, "builtin-direct");

  const automaticShellWrite = broker.resolve({
    capability: "shell.exec",
    scope: "workspace",
    access: "write"
  });
  assert.equal(automaticShellWrite.executorId, "codex-app-server-standalone");

  assert.throws(
    () =>
      broker.resolve({
        capability: "files.edit",
        scope: "workspace",
        access: "write",
        executorId: "codex-app-server-standalone"
      }),
    (error) => {
      assert.ok(error instanceof DirectCapabilityBrokerError);
      assert.equal(error.code, "DIRECT_EXECUTOR_UNSUPPORTED");
      return true;
    }
  );

  assert.throws(
    () =>
      broker.resolve({
        capability: "files.read",
        scope: "host",
        access: "read"
      }),
    (error) => {
      assert.ok(error instanceof DirectCapabilityBrokerError);
      assert.equal(error.code, "DIRECT_CAPABILITY_UNAVAILABLE");
      return true;
    }
  );

  const catalog = broker.catalog();
  assert.equal(catalog.length, 2);
  assert.equal(catalog[0]?.id, "codex-app-server-standalone");
  assert.equal(catalog[1]?.id, "builtin-direct");
  for (const descriptor of catalog) {
    assertPublicDescriptor(descriptor);
  }

  const staleBroker = new DirectCapabilityBroker([
    createCodexStandaloneExecutorSource(store, {
      source: "chatgpt-app",
      version: "codex-cli broker-test-newer"
    }),
    createBuiltInDirectExecutorSource()
  ]);
  const staleCatalog = staleBroker.catalog();
  assert.equal(staleCatalog[0]?.health, "unavailable");
  assert.deepEqual(staleCatalog[0]?.capabilities, []);
  const staleFallback = staleBroker.resolve({
    capability: "files.read",
    scope: "workspace",
    access: "read"
  });
  assert.equal(staleFallback.executorId, "builtin-direct");

  const unresolvedAuthorityBroker = new DirectCapabilityBroker([
    createCodexStandaloneExecutorSource(store, () => undefined),
    createBuiltInDirectExecutorSource()
  ]);
  const unresolvedCatalog = unresolvedAuthorityBroker.catalog();
  assert.equal(unresolvedCatalog[0]?.health, "unavailable");
  assert.deepEqual(unresolvedCatalog[0]?.capabilities, []);
  const unresolvedFallback = unresolvedAuthorityBroker.resolve({
    capability: "files.read",
    scope: "workspace",
    access: "read"
  });
  assert.equal(unresolvedFallback.executorId, "builtin-direct");

  fs.rmSync(runtimeDir, { recursive: true, force: true });

  const unavailableStore = new CodexStandaloneCapabilityStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-broker-empty-"))
  );
  const fallbackBroker = new DirectCapabilityBroker([
    createCodexStandaloneExecutorSource(unavailableStore),
    createBuiltInDirectExecutorSource()
  ], {
    executorAliases: DEFAULT_PRODUCT_IDENTITY.directExecutorInputAliases
  });
  const fallback = fallbackBroker.resolve({
    capability: "files.read",
    scope: "workspace",
    access: "read"
  });
  assert.equal(fallback.executorId, "builtin-direct");
}

verifyDirectCapabilityBroker();
process.stdout.write("VERIFY_DIRECT_CAPABILITY_BROKER_OK\n");

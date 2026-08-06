import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";
import { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import { resolveCodexBinary } from "../src/runtime/codex/binary.ts";
import { CodexStandaloneCapabilityStore } from "../src/runtime/codex/standalone-capabilities.ts";
import { CodexStandaloneCapabilityProbe } from "../src/runtime/codex/standalone-probe.ts";

async function probeCurrentCodex(): Promise<void> {
  const repoRoot = process.cwd();
  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const rootPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-codex-standalone-real-")
  );
  const binary = resolveCodexBinary();
  const client = new CodexAppServerClient({
    command: binary.command,
    requestTimeoutMs: 20_000
  });

  try {
    const probe = new CodexStandaloneCapabilityProbe({
      client,
      binary,
      rootPath
    });
    const snapshot = await probe.run();
    const store = new CodexStandaloneCapabilityStore(paths.runtimeDir);
    store.write(snapshot);
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  } finally {
    await client.close();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
}

await probeCurrentCodex();

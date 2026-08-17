import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  CONNECTIVITY_PROVIDER_CATALOG,
  probeConnectivityProviders,
  type ConnectivityProbeCommandRunner
} from "../src/connectivity/provider-probe.js";

function main(): void {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner: ConnectivityProbeCommandRunner = {
    run(command, args) {
      calls.push({ command, args: [...args] });
      if (command === "cloudflared") {
        return {
          kind: "completed",
          status: 0,
          stdout: "cloudflared version 2026.8.1 (built 2026-08-01)",
          stderr: ""
        };
      }
      if (command === "ngrok") {
        return { kind: "not-found", status: null, stdout: "", stderr: "" };
      }
      return {
        kind: "failed",
        status: 1,
        stdout: "frpc 0.68.0",
        stderr: "raw-provider-stderr-should-never-leak"
      };
    }
  };

  assert.deepEqual(
    CONNECTIVITY_PROVIDER_CATALOG.map((entry) => entry.id),
    ["cloudflare-tunnel", "ngrok", "frp-client"]
  );

  const snapshot = probeConnectivityProviders({ runner });
  assert.equal(snapshot.schemaVersion, 1);
  assert.deepEqual(snapshot.providers, [
    {
      id: "cloudflare-tunnel",
      displayName: "Cloudflare Tunnel",
      detection: "detected",
      version: "2026.8.1"
    },
    {
      id: "ngrok",
      displayName: "ngrok",
      detection: "not-detected",
      version: null
    },
    {
      id: "frp-client",
      displayName: "FRP Client",
      detection: "probe-failed",
      version: null
    }
  ]);
  assert.deepEqual(calls, [
    { command: "cloudflared", args: ["--version"] },
    { command: "ngrok", args: ["version"] },
    { command: "frpc", args: ["-v"] }
  ]);

  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /raw-provider-stderr-should-never-leak|stderr|stdout|executable|path/i);

  const root = path.resolve(import.meta.dirname, "..");
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-connectivity-provider-probe-"));
  try {
    const fixtures: Record<string, string> = {
      cloudflared: "#!/bin/sh\necho 'cloudflared version 2026.8.2'\n",
      ngrok: "#!/bin/sh\necho 'ngrok version 3.30.0'\n",
      frpc: "#!/bin/sh\necho '0.68.1'\n"
    };
    for (const [name, source] of Object.entries(fixtures)) {
      const fixturePath = path.join(fixtureDir, name);
      fs.writeFileSync(fixturePath, source, { encoding: "utf8", mode: 0o700 });
      fs.chmodSync(fixturePath, 0o700);
    }

    const cli = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli/index.ts", "connectivity", "providers", "--json"],
      {
        cwd: root,
        env: { ...process.env, PATH: fixtureDir },
        encoding: "utf8"
      }
    );
    assert.equal(cli.status, 0, cli.stderr);
    const cliSnapshot = JSON.parse(cli.stdout) as typeof snapshot;
    assert.deepEqual(cliSnapshot.providers, [
      {
        id: "cloudflare-tunnel",
        displayName: "Cloudflare Tunnel",
        detection: "detected",
        version: "2026.8.2"
      },
      {
        id: "ngrok",
        displayName: "ngrok",
        detection: "detected",
        version: "3.30.0"
      },
      {
        id: "frp-client",
        displayName: "FRP Client",
        detection: "detected",
        version: "0.68.1"
      }
    ]);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }

  process.stdout.write("VERIFY_CONNECTIVITY_PROVIDER_PROBE_OK\n");
}

main();

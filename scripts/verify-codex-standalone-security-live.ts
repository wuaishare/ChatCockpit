import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

import { buildPaths } from "../src/core/paths.ts";
import { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import { resolveCodexBinary } from "../src/runtime/codex/binary.ts";
import {
  buildCodexStandaloneAppServerArgs,
  CODEX_STANDALONE_PERMISSION_PROFILES
} from "../src/runtime/codex/standalone-security.ts";

function probeReadScript(paths: {
  stateProbe: string;
  homeProbe: string;
  tmpProbe: string;
  slashTmpProbe: string | null;
  workspaceProbe: string;
  workspaceWriteProbe: string;
}) {
  return [
    "const fs=require('node:fs');",
    `const probes=${JSON.stringify(paths)};`,
    "const read=(p)=>{try{fs.readFileSync(p,'utf8');return 'READ';}catch(e){return e&&e.code||e&&e.name||'ERR';}};",
    "const out={",
    "  state:read(probes.stateProbe),",
    "  home:read(probes.homeProbe),",
    "  temp:read(probes.tmpProbe),",
    "  slashTmp:probes.slashTmpProbe?read(probes.slashTmpProbe):'SKIP',",
    "  workspace:read(probes.workspaceProbe),",
    "  apiToken:Object.prototype.hasOwnProperty.call(process.env,'CHATCOCKPIT_API_TOKEN'),",
    "  dummySecret:Object.prototype.hasOwnProperty.call(process.env,'CHATCOCKPIT_TEST_SECRET'),",
    "  scratchWrite:null,",
    "  workspaceWrite:null",
    "};",
    "try{const p=require('node:path').join(process.env.TMPDIR||'', 'live-security-scratch.txt');fs.writeFileSync(p,'scratch');fs.rmSync(p,{force:true});out.scratchWrite='OK';}catch(e){out.scratchWrite=e&&e.code||e&&e.name||'ERR';}",
    "try{fs.writeFileSync(probes.workspaceWriteProbe,'blocked');out.workspaceWrite='UNEXPECTED_WRITE';}catch(e){out.workspaceWrite=e&&e.code||e&&e.name||'ERR';}",
    "process.stdout.write(JSON.stringify(out));"
  ].join("");
}

function networkProbeScript(port: number): string {
  return [
    "const net=require('node:net');",
    `const socket=net.connect({host:'127.0.0.1',port:${port}},()=>{process.stdout.write('CONNECTED');socket.end();});`,
    "socket.on('error',(error)=>{process.stdout.write('ERROR:'+(error&&error.code||error&&error.name||'ERR'));});",
    "setTimeout(()=>{if(!socket.destroyed)socket.destroy();},1000);"
  ].join("");
}

async function main(): Promise<void> {
  const workspaceRoot = fs.realpathSync.native(process.cwd());
  const paths = buildPaths();
  const binary = resolveCodexBinary();
  const nonce = `${process.pid}-${Date.now()}`;
  const stateProbe = path.join(paths.runtimeDir, `standalone-security-live-${nonce}.txt`);
  const homeProbe = path.join(os.homedir(), `.chatcockpit-home-security-live-${nonce}.txt`);
  const tmpProbe = path.join(os.tmpdir(), `chatcockpit-global-temp-security-live-${nonce}.txt`);
  const slashTmpProbe = process.platform === "win32"
    ? null
    : `/tmp/chatcockpit-slash-temp-security-live-${nonce}.txt`;
  const workspaceProbe = path.join(workspaceRoot, "package.json");
  const workspaceWriteProbe = path.join(
    workspaceRoot,
    ".chatcockpit",
    `standalone-security-read-write-${nonce}.txt`
  );
  const workspaceWriteAllowedProbe = path.join(
    workspaceRoot,
    ".chatcockpit",
    `standalone-security-write-${nonce}.txt`
  );

  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.mkdirSync(path.dirname(workspaceWriteProbe), { recursive: true });
  fs.writeFileSync(stateProbe, "dummy-state-marker\n", { mode: 0o600 });
  fs.writeFileSync(homeProbe, "dummy-home-marker\n", { mode: 0o600 });
  fs.writeFileSync(tmpProbe, "dummy-temp-marker\n", { mode: 0o600 });
  if (slashTmpProbe) fs.writeFileSync(slashTmpProbe, "dummy-slash-temp-marker\n", { mode: 0o600 });

  const listener = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => resolve());
  });
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  const loopbackPort = address.port;

  const priorDummySecret = process.env.CHATCOCKPIT_TEST_SECRET;
  process.env.CHATCOCKPIT_TEST_SECRET = "dummy-secret-never-print";
  const client = new CodexAppServerClient({
    command: binary.command,
    args: buildCodexStandaloneAppServerArgs({
      stateRoot: paths.stateRoot,
      workspaceRoot,
      nodeExecutable: process.execPath
    }),
    experimentalApi: true,
    requestTimeoutMs: 30_000
  });

  try {
    await client.start();
    const readResponse = await client.request<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>("command/exec", {
      command: [process.execPath, "-e", probeReadScript({
        stateProbe,
        homeProbe,
        tmpProbe,
        slashTmpProbe,
        workspaceProbe,
        workspaceWriteProbe
      })],
      cwd: workspaceRoot,
      timeoutMs: 20_000,
      outputBytesCap: 32_000,
      permissionProfile: CODEX_STANDALONE_PERMISSION_PROFILES.readOffline
    });
    assert.equal(readResponse.exitCode, 0, readResponse.stderr);
    const projection = JSON.parse(readResponse.stdout) as {
      state: string;
      home: string;
      temp: string;
      slashTmp: string;
      workspace: string;
      apiToken: boolean;
      dummySecret: boolean;
      scratchWrite: string;
      workspaceWrite: string;
    };
    assert.equal(projection.state, "EPERM");
    assert.equal(projection.home, "EPERM");
    assert.equal(projection.temp, "EPERM");
    if (slashTmpProbe) assert.equal(projection.slashTmp, "EPERM");
    assert.equal(projection.workspace, "READ");
    assert.equal(projection.apiToken, false);
    assert.equal(projection.dummySecret, false);
    assert.equal(projection.scratchWrite, "OK");
    assert.equal(projection.workspaceWrite, "EPERM");

    const writeResponse = await client.request<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>("command/exec", {
      command: [
        process.execPath,
        "-e",
        `require('node:fs').writeFileSync(${JSON.stringify(workspaceWriteAllowedProbe)},'allowed');process.stdout.write('WRITE_OK')`
      ],
      cwd: workspaceRoot,
      timeoutMs: 20_000,
      outputBytesCap: 32_000,
      permissionProfile: CODEX_STANDALONE_PERMISSION_PROFILES.writeOffline
    });
    assert.equal(writeResponse.exitCode, 0, writeResponse.stderr);
    assert.equal(writeResponse.stdout, "WRITE_OK");
    assert.equal(fs.readFileSync(workspaceWriteAllowedProbe, "utf8"), "allowed");

    const offlineNetwork = await client.request<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>("command/exec", {
      command: [process.execPath, "-e", networkProbeScript(loopbackPort)],
      cwd: workspaceRoot,
      timeoutMs: 5_000,
      outputBytesCap: 32_000,
      permissionProfile: CODEX_STANDALONE_PERMISSION_PROFILES.readOffline
    });
    assert.equal(offlineNetwork.exitCode, 0, offlineNetwork.stderr);
    assert.match(offlineNetwork.stdout, /^ERROR:/);

    const enabledNetwork = await client.request<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>("command/exec", {
      command: [process.execPath, "-e", networkProbeScript(loopbackPort)],
      cwd: workspaceRoot,
      timeoutMs: 5_000,
      outputBytesCap: 32_000,
      permissionProfile: CODEX_STANDALONE_PERMISSION_PROFILES.readNetwork
    });
    assert.equal(enabledNetwork.exitCode, 0, enabledNetwork.stderr);
    assert.equal(enabledNetwork.stdout, "CONNECTED");

    process.stdout.write("VERIFY_CODEX_STANDALONE_SECURITY_LIVE_OK\n");
  } finally {
    listener.close();
    await client.close().catch(() => undefined);
    if (priorDummySecret === undefined) delete process.env.CHATCOCKPIT_TEST_SECRET;
    else process.env.CHATCOCKPIT_TEST_SECRET = priorDummySecret;
    for (const file of [
      stateProbe,
      homeProbe,
      tmpProbe,
      slashTmpProbe,
      workspaceWriteProbe,
      workspaceWriteAllowedProbe
    ]) {
      if (file) fs.rmSync(file, { force: true });
    }
  }
}

await main();

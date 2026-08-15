import { DownstreamMcpStdioClient } from "../direct/downstream-mcp-stdio-client.js";
import type { DownstreamMcpStdioExecutorConfig } from "../direct/downstream-mcp-config.js";
import type { ManagedProcessClientFactory } from "../direct/adapters/desktop-commander-managed-process.js";

const GUARDIAN_SPEC_ENV = "CHATCOCKPIT_DOWNSTREAM_GUARDIAN_SPEC";

// Intentionally plain Node.js source so the guardian works from both tsx source mode
// and compiled dist without requiring another runtime asset or loader.
export const PROCESS_SUPERVISOR_DOWNSTREAM_GUARDIAN_SOURCE = String.raw`
const { spawn, spawnSync } = require('node:child_process');

const raw = process.env.${GUARDIAN_SPEC_ENV};
if (!raw) process.exit(111);
delete process.env.${GUARDIAN_SPEC_ENV};
let spec;
try {
  spec = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
} catch {
  process.exit(112);
}
if (!spec || typeof spec.command !== 'string' || !Array.isArray(spec.args)) process.exit(113);

const child = spawn(spec.command, spec.args, {
  cwd: typeof spec.cwd === 'string' && spec.cwd.length > 0 ? spec.cwd : undefined,
  env: process.env,
  detached: process.platform !== 'win32',
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe']
});

let shuttingDown = false;
let forceTimer = null;

function killTree(signal) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      });
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {}
}

function finish(code) {
  if (forceTimer) clearTimeout(forceTimer);
  process.exit(typeof code === 'number' ? code : 0);
}

function contain() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { child.stdin.end(); } catch {}
  killTree('SIGTERM');
  forceTimer = setTimeout(() => {
    killTree('SIGKILL');
    finish(0);
  }, 300);
}

process.stdin.on('data', (chunk) => {
  if (!shuttingDown && child.stdin.writable) child.stdin.write(chunk);
});
process.stdin.on('end', contain);
process.stdin.on('close', contain);
process.stdin.on('error', contain);
process.on('SIGTERM', contain);
process.on('SIGINT', contain);
process.stdout.on('error', contain);
process.stderr.on('error', contain);

child.stdout.on('data', (chunk) => {
  if (!shuttingDown) {
    try { process.stdout.write(chunk); } catch { contain(); }
  }
});
child.stderr.on('data', (chunk) => {
  if (!shuttingDown) {
    try { process.stderr.write(chunk); } catch { contain(); }
  }
});
child.once('error', () => {
  contain();
  forceTimer = setTimeout(() => finish(114), 350);
});
child.once('exit', (code) => {
  // If the downstream MCP exits, also kill any descendants that may still share
  // its process group. A completed group must never outlive the guardian.
  killTree('SIGKILL');
  finish(shuttingDown ? 0 : (code ?? 1));
});
`;

function guardianSpec(executor: DownstreamMcpStdioExecutorConfig): string {
  return Buffer.from(
    JSON.stringify({
      command: executor.transport.command,
      args: executor.transport.args,
      ...(executor.transport.cwd ? { cwd: executor.transport.cwd } : {})
    }),
    "utf8"
  ).toString("base64url");
}

export function createProcessSupervisorManagedProcessClientFactory(): ManagedProcessClientFactory {
  return (executor) =>
    new DownstreamMcpStdioClient({
      command: process.execPath,
      args: ["-e", PROCESS_SUPERVISOR_DOWNSTREAM_GUARDIAN_SOURCE],
      env: {
        ...process.env,
        ...(executor.transport.env ?? {}),
        [GUARDIAN_SPEC_ENV]: guardianSpec(executor)
      },
      timeoutMs: executor.transport.timeoutMs,
      maxBufferBytes: executor.transport.maxBufferBytes,
      maxStderrBytes: executor.transport.maxStderrBytes
    });
}

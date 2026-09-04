import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ContinuityDatabase } from "../src/continuity/database.js";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.js";
import { readRuntimeBuildProvenance } from "../src/core/build-provenance.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { rootIdForRepoId } from "../src/core/project-config-identity.js";
import { ProcessSupervisorDaemon } from "../src/process-supervisor/index.js";
import type { CodingRuntimeAdapter } from "../src/runtime/codex/runtime-adapter.js";
import { buildServer } from "../src/server/app.js";
import { OPERATOR_CSRF_HEADER } from "../src/server/operator-auth-context.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";
import { listenTestServer } from "./test-support/server.ts";

const OWNER_PASSWORD = "session-terminal-browser-live-password";
const MARKER = "__BROWSER_PTY_OK__";

function stableId(prefix: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}

function codexAdapter(): CodingRuntimeAdapter {
  return {
    setEventSink() {},
    async close() {}
  } as unknown as CodingRuntimeAdapter;
}

function resolveChromeExecutable(): string {
  const configured = process.env.CHROME_BIN?.trim();
  const candidates = [
    configured,
    path.join(path.parse(os.homedir()).root, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
    path.join(os.homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome")
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const discovered = spawnSync(
    "mdfind",
    ["kMDItemCFBundleIdentifier == 'com.google.Chrome'"],
    { encoding: "utf8" }
  );
  const bundlePath = discovered.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  const executable = bundlePath
    ? path.join(bundlePath, "Contents", "MacOS", "Google Chrome")
    : null;
  assert.ok(executable && fs.existsSync(executable), "Google Chrome is required for browser terminal proof");
  return executable;
}

class CdpClient {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (!payload.id) return;
      const entry = this.pending.get(payload.id);
      if (!entry) return;
      this.pending.delete(payload.id);
      if (payload.error) entry.reject(new Error(payload.error.message ?? "CDP error"));
      else entry.resolve(payload.result);
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP WebSocket failed")), { once: true });
    });
    return new CdpClient(socket);
  }

  async send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  close(): void {
    this.socket.close();
  }
}

async function waitForFile(filePath: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const value = fs.readFileSync(filePath, "utf8").trim();
      if (value) return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function closeProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function evaluate<T>(cdp: CdpClient, expression: string): Promise<T> {
  const result = await cdp.send<{
    result: { value?: T; description?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "Browser evaluation failed"
    );
  }
  return result.result.value as T;
}

async function waitForBrowserValue<T>(
  cdp: CdpClient,
  expression: string,
  accept: (value: T) => boolean,
  label: string,
  timeoutMs = 12_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await evaluate<T>(cdp, expression);
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

function cookiePair(setCookie: string | null): { name: string; value: string; pair: string } {
  assert.ok(setCookie, "Operator login must set a cookie");
  const pair = setCookie.split(";", 1)[0]!;
  const separator = pair.indexOf("=");
  assert.ok(separator > 0, "Operator cookie must contain a name and value");
  return {
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
    pair
  };
}

async function main(): Promise<void> {
  const chromeExecutable = resolveChromeExecutable();
  const installRoot = path.resolve(import.meta.dirname, "..");
  const runtimeBuildProvenance = readRuntimeBuildProvenance(installRoot);
  assert.ok(runtimeBuildProvenance.webSha256, "A complete Runtime Web provenance is required for browser terminal proof");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-session-terminal-browser-"));
  const workspaceRoot = path.join(root, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# Session terminal browser proof\n", "utf8");
  const gitInit = spawnSync("git", ["init", "-q"], { cwd: workspaceRoot, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr);

  const paths = buildFixturePaths(installRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "session-terminal-browser-config.json");
  const primaryRootId = rootIdForRepoId("primary");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({
      schemaVersion: 3,
      workspaceDiscoveryRoots: [],
      workspaceAllowlist: [workspaceRoot],
      projects: {
        primary: {
          displayName: "Browser PTY Proof",
          primaryRootId,
          rootIds: [primaryRootId]
        }
      },
      projectRoots: {
        [primaryRootId]: {
          path: workspaceRoot,
          kind: "git-repository",
          role: "primary-source",
          access: "read-write"
        }
      },
      executionWorkspaces: {
        primary: {
          projectRootId: primaryRootId,
          path: workspaceRoot,
          kind: "checkout",
          provenance: "registered"
        }
      }
    }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );

  const now = new Date().toISOString();
  const database = new ContinuityDatabase({ path: path.join(paths.runtimeDir, "continuity.sqlite") });
  const repositories = buildContinuityRepositories(database);
  const projectId = stableId("project", "primary");
  const workspaceId = stableId("workspace", "primary");
  repositories.projects.create({
    id: projectId,
    slug: "primary",
    displayName: "Browser PTY Proof",
    now
  });
  repositories.workspaces.create({
    id: workspaceId,
    projectId,
    repoId: "primary",
    privatePath: workspaceRoot,
    kind: "checkout",
    now
  });
  const task = repositories.tasks.create({
    id: "task_session_terminal_browser_live",
    projectId,
    workspaceId,
    title: "Browser PTY interactive proof",
    goal: "Prove xterm keyboard input reaches the Process Supervisor-owned PTY",
    status: "in-progress",
    now
  });
  const session = repositories.sessions.create({
    id: "session_session_terminal_browser_live",
    projectId,
    workspaceId,
    taskId: task.id,
    title: "Browser PTY interactive proof",
    mode: "chat-direct",
    status: "running",
    startedAt: now
  });
  repositories.tasks.bindSession(task.id, session.id, task.revision, now);
  repositories.leases.acquire({
    id: "lease_session_terminal_browser_live",
    workspaceId,
    sessionId: session.id,
    holderType: "chat-direct",
    holderId: session.id,
    expiresAt: "2099-01-01T00:00:00.000Z",
    now
  });
  database.close();

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({ username: "owner", password: OWNER_PASSWORD });
  operatorStore.close();

  const original = {
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    token: process.env.CHATCOCKPIT_API_TOKEN,
    publicBase: process.env.CHATCOCKPIT_PUBLIC_BASE_URL
  };
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_EXPOSED = "false";
  delete process.env.CHATCOCKPIT_API_TOKEN;
  delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;

  const daemon = new ProcessSupervisorDaemon(paths, {
    generationFactory: () => "generation-session-terminal-browser-live",
    heartbeatIntervalMs: 100,
    watchdogIntervalMs: 100
  });
  await daemon.start();

  const app = buildServer(paths, {
    codexAdapter: codexAdapter(),
    runtimeBuildProvenance
  });
  const server = await listenTestServer(app);
  const userDataDir = path.join(root, "chrome-profile");
  fs.mkdirSync(userDataDir, { recursive: true });
  const chrome = spawn(
    chromeExecutable,
    [
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--disable-gpu",
      `--user-data-dir=${userDataDir}`,
      "--remote-debugging-port=0",
      "about:blank"
    ],
    { stdio: "ignore" }
  );

  let cdp: CdpClient | null = null;
  try {
    const loginHeaders: Record<string, string> = {
      "Content-Type": "application/json"
    };
    const accessPolicyPath = path.join(paths.runtimeDir, "access-policy.json");
    if (fs.existsSync(accessPolicyPath)) {
      const accessPolicy = JSON.parse(fs.readFileSync(accessPolicyPath, "utf8")) as {
        consolePathPrefix: string;
      };
      assert.match(accessPolicy.consolePathPrefix, /^\/cc-[A-Za-z0-9_-]{24}$/);
      const secureEntry = await fetch(`${server.baseUrl}${accessPolicy.consolePathPrefix}`, {
        redirect: "manual"
      });
      assert.equal(secureEntry.status, 303);
      const location = secureEntry.headers.get("location");
      assert.ok(location);
      const gate = new URL(location, server.baseUrl).searchParams.get("gate");
      assert.match(gate ?? "", /^cc_login_gate_[A-Za-z0-9_-]{43}$/);
      loginHeaders["X-ChatCockpit-Login-Gate"] = gate!;
    }

    const loginResponse = await fetch(`${server.baseUrl}/api/operator/login`, {
      method: "POST",
      headers: loginHeaders,
      body: JSON.stringify({ username: "owner", password: OWNER_PASSWORD })
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json() as { csrfToken: string };
    assert.ok(login.csrfToken);
    const cookie = cookiePair(loginResponse.headers.get("set-cookie"));

    const nodeSnapshotResponse = await fetch(`${server.baseUrl}/api/runtime/executions`, {
      headers: { cookie: cookie.pair }
    });
    assert.equal(nodeSnapshotResponse.status, 200);
    const nodeSnapshot = await nodeSnapshotResponse.json() as {
      tasks: Array<{ id: string; activeSessionId: string | null; status: string }>;
    };
    const nodeTask = nodeSnapshot.tasks.find((entry) => entry.id === task.id);
    assert.ok(nodeTask, "Runtime observability must contain the fixture task before browser launch");
    assert.equal(nodeTask.activeSessionId, session.id);
    assert.equal(nodeTask.status, "in-progress");

    const activePortText = await waitForFile(path.join(userDataDir, "DevToolsActivePort"));
    const [portText] = activePortText.split(/\r?\n/);
    const debugPort = Number(portText);
    assert.ok(Number.isInteger(debugPort) && debugPort > 0);
    const targetResponse = await fetch(
      `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`,
      { method: "PUT" }
    );
    assert.equal(targetResponse.ok, true);
    const target = await targetResponse.json() as { webSocketDebuggerUrl: string };
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
    const cookieSet = await cdp.send<{ success: boolean }>("Network.setCookie", {
      name: cookie.name,
      value: cookie.value,
      url: server.baseUrl
    });
    assert.equal(cookieSet.success, true);
    await cdp.send("Page.navigate", { url: `${server.baseUrl}/ui/runtime` });

    await waitForBrowserValue<string>(
      cdp,
      "document.readyState",
      (value) => value === "complete",
      "Runtime document ready"
    );
    const browserUiState = await evaluate<{
      title: string;
      pathname: string;
      rootChildCount: number;
      scriptCount: number;
      runtimeChunkLoaded: boolean;
    }>(
      cdp,
      `(() => ({
        title: document.title,
        pathname: location.pathname,
        rootChildCount: document.querySelector('#root')?.childElementCount || 0,
        scriptCount: document.querySelectorAll('script[src]').length,
        runtimeChunkLoaded: performance.getEntriesByType('resource').some((entry) => entry.name.includes('/ui/assets/RuntimeView-') && entry.name.endsWith('.js'))
      }))()`
    );
    assert.match(browserUiState.title, /ChatCockpit/);
    assert.equal(browserUiState.pathname, "/ui/runtime");
    assert.ok(browserUiState.rootChildCount > 0, "React Runtime UI must mount into #root");
    assert.ok(browserUiState.scriptCount > 0, "Runtime page must load the SPA module bundle");
    assert.equal(browserUiState.runtimeChunkLoaded, true, "Runtime lazy chunk must load before terminal interaction");

    const browserSnapshot = await evaluate<{
      status: number;
      pathname: string;
      tasks: Array<{ id: string; activeSessionId: string | null; status: string }>;
    }>(
      cdp,
      `(async () => {
        const response = await fetch('/api/runtime/executions', { credentials: 'same-origin' });
        let body = { tasks: [] };
        try { body = await response.json(); } catch {}
        return {
          status: response.status,
          pathname: location.pathname,
          tasks: Array.isArray(body.tasks) ? body.tasks : []
        };
      })()`
    );
    assert.equal(browserSnapshot.status, 200, `Browser Runtime API status=${browserSnapshot.status} path=${browserSnapshot.pathname}`);
    const browserTask = browserSnapshot.tasks.find((entry) => entry.id === task.id);
    assert.ok(browserTask, `Browser Runtime snapshot missing fixture task at ${browserSnapshot.pathname}`);
    assert.equal(browserTask.activeSessionId, session.id);
    assert.equal(browserTask.status, "in-progress");

    await waitForBrowserValue<boolean>(
      cdp,
      `Boolean([...document.querySelectorAll('button')].find((button) => /启动终端|Start terminal/.test(button.textContent || '')))`,
      Boolean,
      "Start terminal button"
    );

    const clicked = await evaluate<boolean>(
      cdp,
      `(() => {
        const button = [...document.querySelectorAll('button')].find((entry) => /启动终端|Start terminal/.test(entry.textContent || ''));
        if (!button) return false;
        button.click();
        return true;
      })()`
    );
    assert.equal(clicked, true);

    await waitForBrowserValue<boolean>(
      cdp,
      `Boolean(document.querySelector('.runtime-persistent-terminal__xterm .xterm-helper-textarea'))`,
      Boolean,
      "xterm textarea after terminal start"
    );
    const focused = await evaluate<boolean>(
      cdp,
      `(() => {
        const textarea = document.querySelector('.runtime-persistent-terminal__xterm .xterm-helper-textarea');
        if (!textarea) return false;
        textarea.focus();
        return document.activeElement === textarea;
      })()`
    );
    assert.equal(focused, true);

    await cdp.send("Input.insertText", { text: `printf '${MARKER}\\n'` });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });

    const terminalText = await waitForBrowserValue<string>(
      cdp,
      `document.querySelector('.runtime-persistent-terminal__xterm .xterm-rows')?.textContent || ''`,
      (value) => value.includes(MARKER),
      "real PTY marker rendered by xterm",
      15_000
    );
    assert.match(terminalText, /__BROWSER_PTY_OK__/);

    const listResponse = await fetch(
      `${server.baseUrl}/api/runtime/executions/terminals?sessionId=${encodeURIComponent(session.id)}`,
      { headers: { cookie: cookie.pair } }
    );
    assert.equal(listResponse.status, 200);
    const terminalList = await listResponse.json() as {
      terminals: Array<{
        terminalId: string;
        processRevision: number;
        state: string;
        privatePid: number;
        supervisorGeneration: string;
      }>;
    };
    assert.equal(terminalList.terminals.length, 1);
    assert.match(terminalList.terminals[0]!.terminalId, /^session_terminal_/);
    assert.equal(terminalList.terminals[0]!.state, "running");
    assert.ok(terminalList.terminals[0]!.privatePid > 0);
    assert.equal(
      terminalList.terminals[0]!.supervisorGeneration,
      "generation-session-terminal-browser-live"
    );

    const observability = await fetch(`${server.baseUrl}/api/runtime/executions`, {
      headers: { cookie: cookie.pair }
    });
    assert.equal(observability.status, 200);
    const observabilityBody = await observability.json() as {
      processes: Array<{ id: string }>;
    };
    assert.equal(
      observabilityBody.processes.some((process) => process.id === terminalList.terminals[0]!.terminalId),
      false
    );

    const terminateResponse = await fetch(
      `${server.baseUrl}/api/runtime/executions/terminals/${encodeURIComponent(terminalList.terminals[0]!.terminalId)}/terminate`,
      {
        method: "POST",
        headers: {
          cookie: cookie.pair,
          "Content-Type": "application/json",
          [OPERATOR_CSRF_HEADER]: login.csrfToken
        },
        body: JSON.stringify({
          expectedRevision: terminalList.terminals[0]!.processRevision,
          idempotencyKey: `terminal-browser-stop:${crypto.randomUUID()}`
        })
      }
    );
    assert.equal(terminateResponse.status, 200);
    const terminated = await terminateResponse.json() as { state: string };
    assert.equal(terminated.state, "terminated");

    process.stdout.write("VERIFY_SESSION_TERMINAL_BROWSER_LIVE_OK\n");
  } finally {
    cdp?.close();
    await closeProcess(chrome);
    await server.close();
    await daemon.close();
    if (original.configPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
    else process.env.CHATCOCKPIT_CONFIG_PATH = original.configPath;
    if (original.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = original.exposed;
    if (original.token === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = original.token;
    if (original.publicBase === undefined) delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;
    else process.env.CHATCOCKPIT_PUBLIC_BASE_URL = original.publicBase;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

await main();

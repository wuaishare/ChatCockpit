import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";
import { listenTestServer } from "./test-support/server.ts";

function resolveChromeExecutable(): string {
  const configured = process.env.CHROME_BIN?.trim();
  if (configured && fs.existsSync(configured)) return configured;

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
  assert.ok(executable && fs.existsSync(executable), "Google Chrome is required for the live Passkey probe");
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
      socket.addEventListener("error", () => reject(new Error("CDP WebSocket failed")), {
        once: true
      });
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function waitForPageReady(cdp: CdpClient): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await cdp.send<{
      result: { value?: string };
    }>("Runtime.evaluate", {
      expression: "document.readyState",
      returnByValue: true
    });
    if (result.result.value === "complete") return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Chrome page did not become ready");
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

const browserFlow = String.raw`(async () => {
  const b64urlToBytes = (value) => {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  };
  const bytesToB64url = (value) => {
    if (value == null) return undefined;
    const bytes = new Uint8Array(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };
  const json = async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify({ status: response.status, body }));
    return body;
  };

  const login = await json(await fetch('/api/operator/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'owner',
      password: 'test-password-passkey-live-correct-horse-battery-staple'
    })
  }));

  const registrationOptions = await json(await fetch('/api/operator/passkeys/registration/options', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-ChatCockpit-CSRF': login.csrfToken }
  }));
  const registrationPublicKey = {
    ...registrationOptions,
    challenge: b64urlToBytes(registrationOptions.challenge),
    user: {
      ...registrationOptions.user,
      id: b64urlToBytes(registrationOptions.user.id)
    },
    excludeCredentials: (registrationOptions.excludeCredentials || []).map((entry) => ({
      ...entry,
      id: b64urlToBytes(entry.id)
    }))
  };
  const created = await navigator.credentials.create({ publicKey: registrationPublicKey });
  if (!created) throw new Error('navigator.credentials.create returned null');
  const registrationResponse = {
    id: created.id,
    rawId: bytesToB64url(created.rawId),
    type: created.type,
    authenticatorAttachment: created.authenticatorAttachment,
    clientExtensionResults: created.getClientExtensionResults(),
    response: {
      clientDataJSON: bytesToB64url(created.response.clientDataJSON),
      attestationObject: bytesToB64url(created.response.attestationObject),
      transports: created.response.getTransports ? created.response.getTransports() : []
    }
  };
  const registration = await json(await fetch('/api/operator/passkeys/registration/verify', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-ChatCockpit-CSRF': login.csrfToken
    },
    body: JSON.stringify({
      challenge: registrationOptions.challenge,
      response: registrationResponse,
      label: 'Chrome Virtual Passkey'
    })
  }));

  await json(await fetch('/api/operator/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-ChatCockpit-CSRF': login.csrfToken }
  }));

  const authenticationOptions = await json(await fetch('/api/operator/passkeys/authentication/options', {
    method: 'POST',
    credentials: 'same-origin'
  }));
  const authenticationPublicKey = {
    ...authenticationOptions,
    challenge: b64urlToBytes(authenticationOptions.challenge),
    allowCredentials: authenticationOptions.allowCredentials?.map((entry) => ({
      ...entry,
      id: b64urlToBytes(entry.id)
    }))
  };
  const assertion = await navigator.credentials.get({ publicKey: authenticationPublicKey });
  if (!assertion) throw new Error('navigator.credentials.get returned null');
  const authenticationResponse = {
    id: assertion.id,
    rawId: bytesToB64url(assertion.rawId),
    type: assertion.type,
    authenticatorAttachment: assertion.authenticatorAttachment,
    clientExtensionResults: assertion.getClientExtensionResults(),
    response: {
      clientDataJSON: bytesToB64url(assertion.response.clientDataJSON),
      authenticatorData: bytesToB64url(assertion.response.authenticatorData),
      signature: bytesToB64url(assertion.response.signature),
      userHandle: bytesToB64url(assertion.response.userHandle)
    }
  };
  const authenticated = await json(await fetch('/api/operator/passkeys/authentication/verify', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challenge: authenticationOptions.challenge,
      response: authenticationResponse
    })
  }));
  const protectedResponse = await fetch('/api/jobs', {
    credentials: 'same-origin'
  });
  const passkeys = await json(await fetch('/api/operator/passkeys', {
    credentials: 'same-origin'
  }));

  return {
    secureContext: window.isSecureContext,
    registrationStatus: Boolean(registration.ok),
    passkeyLabel: registration.passkey?.label,
    passkeyCount: passkeys.passkeys?.length ?? 0,
    authenticationStatus: Boolean(authenticated.ok),
    protectedStatus: protectedResponse.status,
    username: authenticated.username,
    challengeHasAllowCredentials: Object.prototype.hasOwnProperty.call(authenticationOptions, 'allowCredentials'),
    hashAfterFlow: location.hash
  };
})()`;

async function main(): Promise<void> {
  const chromeExecutable = resolveChromeExecutable();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-passkey-live-"));
  const fixtureRoot = path.join(root, "workspace");
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, "README.md"), "# Passkey live fixture\n", "utf8");
  const paths = buildFixturePaths(fixtureRoot);
  ensureWorkspaceDirs(paths);

  const store = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operator = new OperatorService({ store });
  await operator.setOwnerPassword({
    username: "owner",
    password: "test-password-passkey-live-correct-horse-battery-staple"
  });
  store.close();

  const original = {
    token: process.env.CHATCOCKPIT_API_TOKEN,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    publicBase: process.env.CHATCOCKPIT_PUBLIC_BASE_URL,
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH
  };
  delete process.env.CHATCOCKPIT_API_TOKEN;
  process.env.CHATCOCKPIT_EXPOSED = "false";
  delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;
  process.env.CHATCOCKPIT_CONFIG_PATH = path.join(paths.runtimeDir, "missing-config.json");

  const server = await listenTestServer(buildServer(paths));
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
      `--user-data-dir=${userDataDir}`,
      "--remote-debugging-port=0",
      "about:blank"
    ],
    { stdio: "ignore" }
  );

  let cdp: CdpClient | null = null;
  try {
    const activePortText = await waitForFile(path.join(userDataDir, "DevToolsActivePort"));
    const [portText] = activePortText.split(/\r?\n/);
    const debugPort = Number(portText);
    assert.ok(Number.isInteger(debugPort) && debugPort > 0);

    const passkeyBaseUrl = server.baseUrl.replace("127.0.0.1", "localhost");
    const targetResponse = await fetch(
      `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`${passkeyBaseUrl}/ui`)}`,
      { method: "PUT" }
    );
    assert.equal(targetResponse.ok, true);
    const target = (await targetResponse.json()) as { webSocketDebuggerUrl: string };
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("WebAuthn.enable", { enableUI: false });
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true
      }
    });
    await waitForPageReady(cdp);

    const evaluated = await cdp.send<{
      result: {
        type: string;
        value?: unknown;
        description?: string;
        subtype?: string;
      };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>("Runtime.evaluate", {
      expression: browserFlow,
      awaitPromise: true,
      returnByValue: true,
      timeout: 30_000
    });
    if (evaluated.exceptionDetails) {
      throw new Error(
        evaluated.exceptionDetails.exception?.description ??
          evaluated.exceptionDetails.text ??
          "Browser Passkey flow failed"
      );
    }
    const result = evaluated.result.value as {
      secureContext: boolean;
      registrationStatus: boolean;
      passkeyLabel: string;
      passkeyCount: number;
      authenticationStatus: boolean;
      protectedStatus: number;
      username: string;
      challengeHasAllowCredentials: boolean;
      hashAfterFlow: string;
    };
    assert.equal(result.secureContext, true);
    assert.equal(result.registrationStatus, true);
    assert.equal(result.passkeyLabel, "Chrome Virtual Passkey");
    assert.equal(result.passkeyCount, 1);
    assert.equal(result.authenticationStatus, true);
    assert.equal(result.protectedStatus, 200);
    assert.equal(result.username, "owner");
    assert.equal(result.challengeHasAllowCredentials, false);
    assert.equal(result.hashAfterFlow, "");

    const evidenceStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
    const persisted = evidenceStore.listPasskeys(evidenceStore.getOwner()!.id);
    assert.equal(persisted.length, 1);
    assert.ok(persisted[0]!.publicKey.byteLength > 0);
    assert.ok(persisted[0]!.counter >= 0);
    assert.ok(persisted[0]!.lastUsedAt);
    const audit = JSON.stringify(evidenceStore.listAuditEvents(100));
    assert.doesNotMatch(audit, /credentialId|publicKey|privateKey/i);
    evidenceStore.close();

    process.stdout.write("OPERATOR_PASSKEY_WEBAUTHN_LIVE_OK\n");
  } finally {
    cdp?.close();
    await closeProcess(chrome);
    await server.close();
    if (original.token === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = original.token;
    if (original.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = original.exposed;
    if (original.publicBase === undefined) delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;
    else process.env.CHATCOCKPIT_PUBLIC_BASE_URL = original.publicBase;
    if (original.configPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
    else process.env.CHATCOCKPIT_CONFIG_PATH = original.configPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

await main();

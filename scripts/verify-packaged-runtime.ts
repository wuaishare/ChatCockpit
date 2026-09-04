import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { rootIdForRepoId } from "../src/core/project-config-identity.js";
import { USER_CONFIG_SCHEMA_VERSION } from "../src/core/user-config-schema.js";

interface RuntimeManifest {
  schemaVersion: number;
  tokenPilotVersion: string;
  runtimeId: string;
  platform: string;
  architecture: string;
  node: {
    version: string;
    artifact: string;
    sha256: string;
  };
  payload: {
    layoutVersion: number;
    files: Record<string, string>;
  };
}

const repoRoot = process.cwd();
const payloadRootInput =
  process.env.CHATCOCKPIT_RUNTIME_PAYLOAD_DIR?.trim() ??
  process.env.TOKENPILOT_RUNTIME_PAYLOAD_DIR?.trim();
const payloadRoot = payloadRootInput
  ? path.resolve(payloadRootInput)
  : path.join(repoRoot, "dist", "macos-runtime", "arm64", "TokenPilotRuntime");
assert.equal(
  fs.existsSync(path.join(payloadRoot, "manifest.json")),
  true,
  `Build runtime payload first: ${payloadRoot}`
);

const manifest = JSON.parse(
  fs.readFileSync(path.join(payloadRoot, "manifest.json"), "utf8")
) as RuntimeManifest;
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.node.version, "24.18.1");
const nativeArchitecture = process.arch === "x64" ? "x64" : process.arch;
assert.equal(
  manifest.architecture,
  nativeArchitecture,
  `Packaged runtime live proof must execute the runner-native architecture; runner=${nativeArchitecture} payload=${manifest.architecture}`
);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-packaged-runtime-"));
const homeRoot = path.join(tempRoot, "home");
const supportRoot = path.join(homeRoot, "Library", "Application Support", "ChatCockpit");
const runtimeRoot = path.join(supportRoot, "runtimes", manifest.runtimeId);
const installRoot = path.join(runtimeRoot, "app");
const stateRoot = path.join(supportRoot, "state");
const configPath = path.join(supportRoot, "config", "config.json");
const workspaceRoot = path.join(tempRoot, "workspace");
const emptyPath = path.join(tempRoot, "empty-path");
const nodeBin = path.join(runtimeRoot, "node", "bin", "node");

for (const directory of [
  homeRoot,
  path.dirname(runtimeRoot),
  stateRoot,
  path.dirname(configPath),
  path.join(workspaceRoot, "docs"),
  emptyPath
]) {
  fs.mkdirSync(directory, { recursive: true });
}
fs.writeFileSync(
  path.join(workspaceRoot, "docs", "packaged-runtime-fixture.md"),
  "PACKAGED_RUNTIME_WORKSPACE_OK\n",
  "utf8"
);
fs.cpSync(payloadRoot, runtimeRoot, { recursive: true, dereference: false });

function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertCriticalHashes(root: string): void {
  for (const [relativePath, expectedHash] of Object.entries(manifest.payload.files)) {
    const absolutePath = path.join(root, relativePath);
    assert.equal(fs.existsSync(absolutePath), true, `Missing critical runtime file: ${relativePath}`);
    assert.equal(sha256(absolutePath), expectedHash, `Runtime hash mismatch: ${relativePath}`);
  }
}

assertCriticalHashes(runtimeRoot);
assert.equal(fs.existsSync(path.join(runtimeRoot, ".git")), false);
assert.equal(fs.existsSync(path.join(runtimeRoot, ".tokenpilot")), false);
assert.equal(fs.existsSync(path.join(installRoot, "src")), false);

const bundledVersion = spawnSync(nodeBin, ["--version"], {
  cwd: installRoot,
  encoding: "utf8",
  env: { PATH: emptyPath, HOME: homeRoot }
});
assert.equal(bundledVersion.status, 0, bundledVersion.stderr);
assert.equal(bundledVersion.stdout.trim(), "v24.18.1");

const noSystemNode = spawnSync("node", ["--version"], {
  cwd: installRoot,
  encoding: "utf8",
  env: { PATH: emptyPath, HOME: homeRoot }
});
assert.notEqual(noSystemNode.status, 0, "System node unexpectedly resolved through isolated PATH");
const noSystemNpm = spawnSync("npm", ["--version"], {
  cwd: installRoot,
  encoding: "utf8",
  env: { PATH: emptyPath, HOME: homeRoot }
});
assert.notEqual(noSystemNpm.status, 0, "System npm unexpectedly resolved through isolated PATH");

const packagedPtySmoke = spawnSync(
  nodeBin,
  [
    "-e",
    [
      "const pty=require('node-pty')",
      "const shell=process.platform==='darwin'?'/bin/zsh':'/bin/sh'",
      "const term=pty.spawn(shell,[],{name:'xterm-256color',cols:80,rows:24,cwd:process.cwd(),env:process.env})",
      "let out=''",
      "const timer=setTimeout(()=>{term.kill();process.exit(2)},5000)",
      "term.onData(d=>{out+=d})",
      "term.onExit(({exitCode})=>{clearTimeout(timer);if(exitCode!==0||!out.includes('__PACKAGED_PTY_OK__'))process.exit(3);console.log('PACKAGED_PTY_OK')})",
      "term.write(\"printf '__PACKAGED_PTY_OK__\\\\n'; exit\"+String.fromCharCode(13))"
    ].join(";"),
  ],
  {
    cwd: installRoot,
    encoding: "utf8",
    timeout: 8_000,
    env: { ...process.env, PATH: emptyPath, HOME: homeRoot }
  }
);
assert.equal(
  packagedPtySmoke.status,
  0,
  `Packaged node-pty smoke failed\n${packagedPtySmoke.stdout}\n${packagedPtySmoke.stderr}`
);
assert.match(packagedPtySmoke.stdout, /PACKAGED_PTY_OK/);

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate packaged runtime port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForReady(url: string, child: ChildProcessWithoutNullStreams, output: () => string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged runtime exited before readiness (${child.exitCode})\n${output()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Timed out waiting for ${url}\n${output()}`);
}

async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGINT");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolve();
      }, 4_000)
    )
  ]);
}

const port = await freePort();
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: homeRoot,
  PATH: emptyPath,
  CHATCOCKPIT_DISTRIBUTION_MODE: "packaged",
  CHATCOCKPIT_INSTALL_ROOT: installRoot,
  CHATCOCKPIT_STATE_ROOT: stateRoot,
  CHATCOCKPIT_PRIMARY_WORKSPACE_ROOT: workspaceRoot,
  CHATCOCKPIT_NODE_BIN: nodeBin,
  CHATCOCKPIT_CONFIG_PATH: configPath,
  CHATCOCKPIT_EXPOSED: "false",
  CHATCOCKPIT_HOST: "127.0.0.1",
  CHATCOCKPIT_PORT: String(port)
};
delete childEnv.CHATCOCKPIT_REPO_ROOT;
delete childEnv.CHATCOCKPIT_API_TOKEN;
delete childEnv.TOKENPILOT_REPO_ROOT;
delete childEnv.TOKENPILOT_API_TOKEN;
delete childEnv.NODE_PATH;

let combinedOutput = "";
const child = spawn(nodeBin, [path.join(installRoot, "dist", "cli", "index.js"), "server"], {
  cwd: installRoot,
  env: childEnv,
  stdio: ["pipe", "pipe", "pipe"]
});
child.stdout.on("data", (chunk) => {
  combinedOutput += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  combinedOutput += chunk.toString();
});

try {
  const baseURL = `http://127.0.0.1:${port}`;
  await waitForReady(`${baseURL}/api/health`, child, () => combinedOutput);

  const health = await fetch(`${baseURL}/api/health`);
  assert.equal(health.status, 200);
  const healthBody = (await health.json()) as { ok?: boolean };
  assert.equal(healthBody.ok, true);

  const accessPolicyPath = path.join(stateRoot, "runtime", "access-policy.json");
  const credentialVaultPath = path.join(stateRoot, "runtime", "operator-credentials.json");
  const accessPolicy = JSON.parse(fs.readFileSync(accessPolicyPath, "utf8")) as {
    consolePathPrefix: string;
  };
  const credentials = JSON.parse(fs.readFileSync(credentialVaultPath, "utf8")) as {
    username: string;
    password: string;
    ownerUpdatedAt: string | null;
  };
  assert.match(accessPolicy.consolePathPrefix, /^\/cc-[A-Za-z0-9_-]{24}$/);
  assert.match(credentials.username, /^cc_owner_[a-f0-9]{12}$/);
  assert.match(credentials.password, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(typeof credentials.ownerUpdatedAt, "string");
  assert.equal(fs.statSync(accessPolicyPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(credentialVaultPath).mode & 0o777, 0o600);

  const unauthenticatedUi = await fetch(`${baseURL}/ui/`);
  assert.equal(unauthenticatedUi.status, 404);
  const secureEntry = await fetch(`${baseURL}${accessPolicy.consolePathPrefix}`, {
    redirect: "manual"
  });
  assert.equal(secureEntry.status, 303);
  const secureEntryLocation = secureEntry.headers.get("location");
  assert.ok(secureEntryLocation);
  const loginUrl = new URL(secureEntryLocation, baseURL);
  assert.equal(loginUrl.pathname, "/ui/login");
  const loginGate = loginUrl.searchParams.get("gate");
  assert.match(loginGate ?? "", /^cc_login_gate_[A-Za-z0-9_-]{43}$/);

  const openapi = await fetch(`${baseURL}/openapi.yaml`);
  assert.equal(openapi.status, 200);
  assert.match(await openapi.text(), /openapi:/);

  const anonymousFileRead = await fetch(`${baseURL}/api/files/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoId: "primary",
      path: "docs/packaged-runtime-fixture.md"
    })
  });
  assert.equal(anonymousFileRead.status, 401);

  const login = await fetch(`${baseURL}/api/operator/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ChatCockpit-Login-Gate": loginGate ?? ""
    },
    body: JSON.stringify({
      username: credentials.username,
      password: credentials.password
    })
  });
  assert.equal(login.status, 200);
  const loginBody = (await login.json()) as { csrfToken?: string };
  assert.match(loginBody.csrfToken ?? "", /^[A-Za-z0-9_-]{43}$/);
  const setCookie = login.headers.get("set-cookie");
  assert.ok(setCookie);
  const operatorCookie = setCookie.split(";", 1)[0];

  const ui = await fetch(`${baseURL}/ui/`, {
    headers: { Cookie: operatorCookie }
  });
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /<div id="root"><\/div>/);

  const fileRead = await fetch(`${baseURL}/api/files/read`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: operatorCookie,
      "X-ChatCockpit-CSRF": loginBody.csrfToken!
    },
    body: JSON.stringify({
      repoId: "primary",
      path: "docs/packaged-runtime-fixture.md"
    })
  });
  const fileReadText = await fileRead.text();
  assert.equal(fileRead.status, 200, fileReadText);
  const fileReadBody = JSON.parse(fileReadText) as { file?: { content?: string } };
  assert.match(fileReadBody.file?.content ?? "", /PACKAGED_RUNTIME_WORKSPACE_OK/);

  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    schemaVersion: number;
    workspaceAllowlist: string[];
    projects: Record<string, { displayName: string; primaryRootId: string; rootIds: string[] }>;
    projectRoots: Record<string, { path: string; kind: string; role: string; access: string }>;
    executionWorkspaces: Record<
      string,
      { projectRootId: string; path: string; kind: string; provenance: string }
    >;
    defaultRepoId?: unknown;
    repoMappings?: unknown;
  };
  const primaryRootId = rootIdForRepoId("primary");
  assert.equal(config.schemaVersion, USER_CONFIG_SCHEMA_VERSION);
  assert.equal(config.defaultRepoId, undefined);
  assert.equal(config.repoMappings, undefined);
  assert.equal(config.projects.primary?.displayName, "primary");
  assert.equal(config.projects.primary?.primaryRootId, primaryRootId);
  assert.deepEqual(config.projects.primary?.rootIds, [primaryRootId]);
  assert.equal(
    fs.realpathSync.native(config.projectRoots[primaryRootId].path),
    fs.realpathSync.native(workspaceRoot)
  );
  assert.equal(config.projectRoots[primaryRootId].kind, "git-repository");
  assert.equal(config.projectRoots[primaryRootId].role, "primary-source");
  assert.equal(config.projectRoots[primaryRootId].access, "read-write");
  assert.equal(config.executionWorkspaces.primary?.projectRootId, primaryRootId);
  assert.equal(
    fs.realpathSync.native(config.executionWorkspaces.primary.path),
    fs.realpathSync.native(workspaceRoot)
  );
  assert.equal(config.executionWorkspaces.primary.kind, "checkout");
  assert.equal(config.executionWorkspaces.primary.provenance, "registered");
  assert.equal(config.executionWorkspaces.tokenpilot, undefined);
  assert.equal(
    config.workspaceAllowlist.some((entry) => fs.realpathSync.native(entry) === fs.realpathSync.native(runtimeRoot)),
    false
  );
  assert.equal(
    config.workspaceAllowlist.some((entry) => fs.realpathSync.native(entry) === fs.realpathSync.native(stateRoot)),
    false
  );

  assert.equal(fs.existsSync(path.join(stateRoot, "runtime")), true);
  assert.equal(fs.existsSync(path.join(runtimeRoot, ".tokenpilot")), false);
  assertCriticalHashes(runtimeRoot);
} finally {
  await stop(child);
}

assertCriticalHashes(runtimeRoot);
assert.equal(fs.existsSync(path.join(runtimeRoot, ".chatcockpit")), false);
assert.equal(fs.existsSync(path.join(runtimeRoot, ".tokenpilot")), false);
assert.equal(fs.existsSync(path.join(installRoot, ".git")), false);

process.stdout.write(
  `VERIFY_PACKAGED_RUNTIME_OK node=v24.18.1 mode=packaged arch=${manifest.architecture}\n`
);

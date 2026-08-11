import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { sleep, waitForValue } from "./test-support/wait.ts";

const repoRoot = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-source-archive-"));
const sourceRoot = path.join(tempRoot, "tokenpilot-source");
const homeRoot = path.join(tempRoot, "home");
const configPath = path.join(tempRoot, "config.json");

const blockedRootNames = new Set([
  ".git",
  ".tokenpilot",
  ".codex",
  ".servbay",
  "node_modules",
  "dist"
]);

function shouldCopy(source: string): boolean {
  const relative = path.relative(repoRoot, source);
  if (!relative) return true;
  const parts = relative.split(path.sep);
  if (blockedRootNames.has(parts[0])) return false;
  if (parts.includes(".build")) return false;
  if (parts[0] === "web" && parts[1] === "dist") return false;
  const basename = parts.at(-1) ?? "";
  if (basename === ".DS_Store" || basename.endsWith(".log")) return false;
  if (
    (basename === ".env" || basename.startsWith(".env.")) &&
    basename !== ".env.example"
  ) {
    return false;
  }
  if (basename === "server.env") return false;
  return true;
}

function run(
  command: string,
  args: string[],
  options: { timeout: number; env?: NodeJS.ProcessEnv }
): void {
  const result = spawnSync(command, args, {
    cwd: sourceRoot,
    encoding: "utf8",
    timeout: options.timeout,
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024
  });
  assert.equal(
    result.status,
    0,
    [
      `${command} ${args.join(" ")} failed`,
      result.stdout ?? "",
      result.stderr ?? ""
    ]
      .filter(Boolean)
      .join("\n")
  );
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a source archive test port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForReady(
  url: string,
  child: ChildProcessWithoutNullStreams,
  output: () => string
): Promise<void> {
  await waitForValue(
    async () => {
      if (child.exitCode !== null) {
        throw new Error(
          `Source archive server exited before readiness (${child.exitCode})\n${output()}`
        );
      }
      try {
        const response = await fetch(url);
        return response.ok ? true : null;
      } catch {
        return null;
      }
    },
    {
      label: `${url}\n${output()}`,
      timeoutMs: 20_000,
      intervalMs: 75,
      retryOnError: false
    }
  );
}

async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGINT");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    (async () => {
      await sleep(4_000);
      if (child.exitCode === null) child.kill("SIGKILL");
    })()
  ]);
}

fs.mkdirSync(sourceRoot, { recursive: true });
fs.mkdirSync(homeRoot, { recursive: true });
fs.cpSync(repoRoot, sourceRoot, {
  recursive: true,
  dereference: false,
  filter: shouldCopy
});

for (const blocked of [
  ".git",
  ".tokenpilot",
  ".codex",
  ".servbay",
  "node_modules",
  "dist",
  path.join("web", "dist"),
  path.join("desktop", "macos", ".build")
]) {
  assert.equal(
    fs.existsSync(path.join(sourceRoot, blocked)),
    false,
    `Source archive contains blocked path: ${blocked}`
  );
}
assert.equal(fs.existsSync(path.join(sourceRoot, "package-lock.json")), true);
assert.equal(fs.existsSync(path.join(sourceRoot, "src", "cli", "index.ts")), true);
assert.equal(fs.existsSync(path.join(sourceRoot, "desktop", "macos", "Package.swift")), true);
assert.equal(
  fs.existsSync(path.join(sourceRoot, "desktop", "macos", "AppBundle", "Info.plist")),
  true
);
assert.equal(
  fs.existsSync(path.join(sourceRoot, "scripts", "build-macos-desktop-app.sh")),
  true
);
for (const required of [
  path.join("scripts", "runtime", "node-runtime-manifest.json"),
  path.join("scripts", "build-macos-runtime-payload.sh"),
  path.join("scripts", "verify-packaged-runtime.ts"),
  path.join(
    "desktop",
    "macos",
    "Sources",
    "TokenPilotDesktopCore",
    "PackagedRuntimeDeployer.swift"
  ),
  path.join(
    "desktop",
    "macos",
    "Sources",
    "TokenPilotDesktopCore",
    "ExistingSetupImport.swift"
  ),
  path.join(
    "desktop",
    "macos",
    "Sources",
    "TokenPilotDesktopCore",
    "PackagedRuntimeConflict.swift"
  )
]) {
  assert.equal(
    fs.existsSync(path.join(sourceRoot, required)),
    true,
    `Source archive is missing Phase 2 source: ${required}`
  );
}

function collectArchiveFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectArchiveFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

const initialArchiveFiles = collectArchiveFiles(sourceRoot);
assert.equal(
  initialArchiveFiles.some((filePath) => /node-v\d+\.\d+\.\d+-darwin-(?:arm64|x64)\.tar\.xz$/.test(filePath)),
  false,
  "Source archive contains a downloaded Node runtime archive"
);

const isolatedEnv: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: homeRoot,
  TOKENPILOT_REPO_ROOT: sourceRoot,
  TOKENPILOT_CONFIG_PATH: configPath,
  TOKENPILOT_EXPOSED: "false"
};

run(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["ci", "--ignore-scripts", "--no-audit", "--fund=false"],
  { timeout: 180_000, env: isolatedEnv }
);
run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
  timeout: 180_000,
  env: isolatedEnv
});
assert.equal(fs.existsSync(path.join(sourceRoot, ".git")), false);
assert.equal(fs.existsSync(path.join(sourceRoot, "dist", "cli", "index.js")), true);
assert.equal(fs.existsSync(path.join(sourceRoot, "web", "dist", "index.html")), true);

const port = await freePort();
let combinedOutput = "";
const child = spawn(process.execPath, ["dist/cli/index.js", "server"], {
  cwd: sourceRoot,
  env: {
    ...isolatedEnv,
    TOKENPILOT_HOST: "127.0.0.1",
    TOKENPILOT_PORT: String(port)
  },
  stdio: ["pipe", "pipe", "pipe"]
});
child.stdout.on("data", (chunk) => {
  combinedOutput += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  combinedOutput += chunk.toString();
});

try {
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForReady(`${baseUrl}/api/health`, child, () => combinedOutput);

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  const healthBody = (await health.json()) as {
    ok: boolean;
    repoRoot?: string;
  };
  assert.equal(healthBody.ok, true);
  assert.equal(JSON.stringify(healthBody).includes(sourceRoot), false);

  const projects = await fetch(`${baseUrl}/api/continuity/projects`);
  assert.equal(projects.status, 200);
  const projectBody = (await projects.json()) as {
    ok: boolean;
    projects: Array<{
      project: { slug: string };
      workspaces: Array<{ repoId: string }>;
    }>;
  };
  assert.equal(projectBody.ok, true);
  assert.equal(projectBody.projects[0]?.project.slug, "tokenpilot");
  assert.equal(projectBody.projects[0]?.workspaces[0]?.repoId, "tokenpilot");
  assert.equal(JSON.stringify(projectBody).includes(sourceRoot), false);

  const continuityUi = await fetch(`${baseUrl}/ui/continuity/projects`);
  assert.equal(continuityUi.status, 200);
  assert.match(await continuityUi.text(), /<div id="root"><\/div>/);

  const openapi = await fetch(`${baseUrl}/openapi.yaml`);
  assert.equal(openapi.status, 200);
  assert.match(await openapi.text(), /getWorkspaceContinuitySnapshot/);
} finally {
  await stop(child);
}

assert.equal(fs.existsSync(path.join(sourceRoot, ".git")), false);
process.stdout.write("VERIFY_SOURCE_ARCHIVE_OK\n");

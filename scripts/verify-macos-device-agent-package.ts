import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface PackageManifest {
  schemaVersion: number;
  productIdentity: string;
  packageKind: string;
  version: string;
  platform: string;
  architecture: string;
  distributionTrust: string;
  releaseEligible: boolean;
  entrypoint: string;
  entrypointSha256: string;
  runtime: {
    directory: string;
    runtimeId: string;
    nodeVersion: string | null;
    manifestSha256: string;
  };
}

interface RuntimeManifest {
  schemaVersion: number;
  tokenPilotVersion: string;
  runtimeId: string;
  platform: string;
  architecture: string;
  node: {
    version: string;
  };
  payload: {
    files: Record<string, string>;
  };
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertRelativePath(input: string, label: string): void {
  assert(input.length > 0, `${label} must not be empty`);
  assert(!path.isAbsolute(input), `${label} must be relative`);
  const normalized = path.normalize(input);
  assert(normalized !== ".." && !normalized.startsWith(`..${path.sep}`), `${label} escapes package root`);
}

function assertSymlinksContained(root: string): void {
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = fs.realpathSync.native(target);
        const relative = path.relative(root, resolved);
        assert(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `symlink escapes package root: ${target}`);
        continue;
      }
      if (entry.isDirectory()) visit(target);
    }
  };
  visit(root);
}

const packageRoot = path.resolve(
  process.env.CHATCOCKPIT_DEVICE_AGENT_PACKAGE_DIR ??
    path.join(process.cwd(), "dist", "device-agent", "macos", process.arch, "ChatCockpitDeviceAgent")
);
const manifestPath = path.join(packageRoot, "manifest.json");
assert(fs.existsSync(manifestPath), `package manifest missing: ${manifestPath}`);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PackageManifest;
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.productIdentity, "chatcockpit");
assert.equal(manifest.packageKind, "device-agent-portable");
assert.equal(manifest.platform, "darwin");
assert(["arm64", "x64"].includes(manifest.architecture));
assert.equal(manifest.distributionTrust, "development");
assert.equal(manifest.releaseEligible, false);
assertRelativePath(manifest.entrypoint, "entrypoint");
assertRelativePath(manifest.runtime.directory, "runtime.directory");

const entrypointPath = path.join(packageRoot, manifest.entrypoint);
assert(fs.existsSync(entrypointPath), "device entrypoint is missing");
assert((fs.statSync(entrypointPath).mode & 0o111) !== 0, "device entrypoint is not executable");
assert.equal(sha256File(entrypointPath), manifest.entrypointSha256, "device entrypoint checksum mismatch");

const runtimeRoot = path.join(packageRoot, manifest.runtime.directory);
const runtimeManifestPath = path.join(runtimeRoot, "manifest.json");
assert(fs.existsSync(runtimeManifestPath), "embedded runtime manifest is missing");
assert.equal(sha256File(runtimeManifestPath), manifest.runtime.manifestSha256, "embedded runtime manifest checksum mismatch");

const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, "utf8")) as RuntimeManifest;
assert.equal(runtimeManifest.schemaVersion, 1);
assert.equal(runtimeManifest.tokenPilotVersion, manifest.version, "embedded Runtime version does not match package version");
assert.equal(runtimeManifest.platform, "darwin");
assert.equal(runtimeManifest.architecture, manifest.architecture);
assert.equal(runtimeManifest.runtimeId, manifest.runtime.runtimeId);
assert.equal(runtimeManifest.node.version, manifest.runtime.nodeVersion);

for (const [relativePath, expectedSha256] of Object.entries(runtimeManifest.payload.files)) {
  assertRelativePath(relativePath, `runtime payload file ${relativePath}`);
  const filePath = path.join(runtimeRoot, relativePath);
  assert(fs.existsSync(filePath), `runtime payload file missing: ${relativePath}`);
  assert.equal(sha256File(filePath), expectedSha256, `runtime payload checksum mismatch: ${relativePath}`);
}

assert(fs.existsSync(path.join(runtimeRoot, "node", "bin", "node")), "bundled Node executable is missing");
assert(fs.existsSync(path.join(runtimeRoot, "app", "dist", "cli", "index.js")), "compiled ChatCockpit CLI is missing");
assert(fs.existsSync(path.join(runtimeRoot, "app", "scripts", "macos-manage-device-agent.sh")), "Device Agent service manager is missing");
assert(fs.existsSync(path.join(runtimeRoot, "app", "scripts", "macos-manage-local-server.sh")), "Runtime lifecycle manager is missing");
assertSymlinksContained(packageRoot);

if (process.platform === "darwin" && process.arch === manifest.architecture) {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-agent-package-"));
  try {
    const stateRoot = path.join(tempHome, "state");
    const result = spawnSync(entrypointPath, ["status", "--json"], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        HOME: tempHome,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        CHATCOCKPIT_STATE_ROOT: stateRoot
      }
    });
    assert.equal(result.status, 0, `portable Device Agent status failed: ${result.stderr || result.stdout}`);
    const status = JSON.parse(result.stdout) as { configured?: unknown; state?: unknown };
    assert.equal(status.configured, false);
    assert.equal(status.state, "unconfigured");
    assert(!result.stderr.includes("node: command not found"), "portable entrypoint attempted to use system Node");

    const workspaceBefore = spawnSync(entrypointPath, ["workspace", "status", "--json"], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        HOME: tempHome,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        CHATCOCKPIT_STATE_ROOT: stateRoot
      }
    });
    assert.equal(workspaceBefore.status, 0, workspaceBefore.stderr || workspaceBefore.stdout);
    const workspaceBeforeStatus = JSON.parse(workspaceBefore.stdout) as {
      configured?: unknown;
      primaryWorkspaceRoot?: unknown;
      source?: unknown;
    };
    assert.equal(workspaceBeforeStatus.configured, false);
    assert.equal(workspaceBeforeStatus.primaryWorkspaceRoot, null);
    assert.equal(workspaceBeforeStatus.source, "none");

    const agentWithoutWorkspace = spawnSync(entrypointPath, ["agent", "--json"], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        HOME: tempHome,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        CHATCOCKPIT_STATE_ROOT: stateRoot
      }
    });
    assert.equal(agentWithoutWorkspace.status, 78, "persistent Agent unexpectedly started without an explicit development workspace");
    assert(agentWithoutWorkspace.stderr.includes("requires an explicit development workspace"));

    const workspaceDir = path.join(tempHome, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    const workspaceSet = spawnSync(entrypointPath, ["workspace", "set", workspaceDir, "--json"], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        HOME: tempHome,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        CHATCOCKPIT_STATE_ROOT: stateRoot
      }
    });
    assert.equal(workspaceSet.status, 0, workspaceSet.stderr || workspaceSet.stdout);
    const workspaceSetStatus = JSON.parse(workspaceSet.stdout) as {
      configured?: unknown;
      primaryWorkspaceRoot?: unknown;
    };
    assert.equal(workspaceSetStatus.configured, true);
    assert.equal(workspaceSetStatus.primaryWorkspaceRoot, fs.realpathSync.native(workspaceDir));

    const workspaceConfigPath = path.join(stateRoot, "runtime", "device-agent-package.json");
    assert(fs.existsSync(workspaceConfigPath), "portable workspace configuration was not persisted");
    assert.equal(fs.statSync(workspaceConfigPath).mode & 0o777, 0o600, "portable workspace configuration is not mode 0600");

    const workspaceAfter = spawnSync(entrypointPath, ["workspace", "status", "--json"], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        HOME: tempHome,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        CHATCOCKPIT_STATE_ROOT: stateRoot
      }
    });
    assert.equal(workspaceAfter.status, 0, workspaceAfter.stderr || workspaceAfter.stdout);
    const workspaceAfterStatus = JSON.parse(workspaceAfter.stdout) as {
      configured?: unknown;
      primaryWorkspaceRoot?: unknown;
      source?: unknown;
      configStored?: unknown;
    };
    assert.equal(workspaceAfterStatus.configured, true);
    assert.equal(workspaceAfterStatus.primaryWorkspaceRoot, fs.realpathSync.native(workspaceDir));
    assert.equal(workspaceAfterStatus.source, "persisted");
    assert.equal(workspaceAfterStatus.configStored, true);

    const embeddedWorkspace = spawnSync(entrypointPath, ["workspace", "set", path.join(runtimeRoot, "app"), "--json"], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        HOME: tempHome,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        CHATCOCKPIT_STATE_ROOT: stateRoot
      }
    });
    assert.equal(embeddedWorkspace.status, 78, "embedded Runtime was unexpectedly accepted as a development workspace");

    const blocked = spawnSync(entrypointPath, ["doctor"], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        HOME: tempHome,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        CHATCOCKPIT_STATE_ROOT: stateRoot
      }
    });
    assert.equal(blocked.status, 64, "portable entrypoint unexpectedly exposed a non-Device-Agent CLI command");
    assert(blocked.stderr.includes("Unknown ChatCockpit Device Agent command"));
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

console.log(`VERIFY_MACOS_DEVICE_AGENT_PACKAGE_OK arch=${manifest.architecture} runtime=${manifest.runtime.runtimeId}`);

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildCodexStandaloneAppServerArgs,
  CODEX_STANDALONE_PERMISSION_PROFILES,
  codexStandalonePermissionProfile
} from "../src/runtime/codex/standalone-security.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-standalone-security-"));
try {
  const homeDir = path.join(root, "home");
  const stateRoot = path.join(homeDir, ".chatcockpit");
  const nodeRoot = path.join(root, "toolchains", "node");
  const nodeBin = path.join(nodeRoot, "bin");
  const nodeExecutable = path.join(nodeBin, "node");
  const localBin = path.join(homeDir, ".local", "bin");
  const unrelatedHomeBin = path.join(homeDir, "private-tools", "bin");
  const externalBin = path.join(root, "external-bin");
  const workspaceRoot = path.join(root, "workspace-a");
  const secondWorkspaceRoot = path.join(root, "workspace-b");
  for (const directory of [
    stateRoot,
    nodeBin,
    localBin,
    unrelatedHomeBin,
    externalBin,
    workspaceRoot,
    secondWorkspaceRoot
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(nodeExecutable, "fixture\n");

  const args = buildCodexStandaloneAppServerArgs({
    platform: "linux",
    homeDir,
    stateRoot,
    workspaceRoot,
    nodeExecutable,
    env: {
      PATH: [localBin, unrelatedHomeBin, externalBin].join(path.delimiter)
    }
  });
  const serialized = args.join("\n");
  const secondArgs = buildCodexStandaloneAppServerArgs({
    platform: "linux",
    homeDir,
    stateRoot,
    workspaceRoot: secondWorkspaceRoot,
    nodeExecutable,
    env: {
      PATH: [localBin, unrelatedHomeBin, externalBin].join(path.delimiter)
    }
  });
  const secondSerialized = secondArgs.join("\n");

  assert.deepEqual(args.slice(0, 2), ["app-server", "--stdio"]);
  assert.match(
    serialized,
    new RegExp(`default_permissions=.*${CODEX_STANDALONE_PERMISSION_PROFILES.writeOffline}`)
  );
  assert.match(serialized, /shell_environment_policy\.inherit="core"/);
  assert.match(serialized, /shell_environment_policy\.ignore_default_excludes=false/);
  assert.match(serialized, /shell_environment_policy\.include_only=/);
  const scratchMatch = serialized.match(
    /shell_environment_policy\.set=\{TMPDIR="([^"]+)",TEMP="[^"]+",TMP="[^"]+"\}/
  );
  const secondScratchMatch = secondSerialized.match(
    /shell_environment_policy\.set=\{TMPDIR="([^"]+)",TEMP="[^"]+",TMP="[^"]+"\}/
  );
  assert.ok(scratchMatch?.[1]);
  assert.ok(secondScratchMatch?.[1]);
  assert.notEqual(scratchMatch[1], secondScratchMatch[1]);
  assert.match(scratchMatch[1], /\.chatcockpit-workspace-scratch/);
  assert.equal(fs.statSync(scratchMatch[1]).mode & 0o777, 0o700);
  const slashTmpRoot = process.platform === "win32"
    ? fs.realpathSync.native(os.tmpdir())
    : fs.realpathSync.native("/tmp");
  const canonicalTmpGlob = `${slashTmpRoot.replace(/\/$/u, "")}/**`;
  const canonicalTmpPattern = new RegExp(
    `"${canonicalTmpGlob.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*=`
  );
  const scratchInsideCanonicalTmp = (() => {
    const relative = path.relative(slashTmpRoot, scratchMatch[1]);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  })();
  if (scratchInsideCanonicalTmp) {
    assert.doesNotMatch(serialized, canonicalTmpPattern);
  } else {
    assert.match(serialized, canonicalTmpPattern);
  }
  assert.doesNotMatch(serialized, /extends=/);
  assert.doesNotMatch(serialized, /":root"\s*=\s*"read"/);
  assert.doesNotMatch(serialized, /extends=/);
  assert.match(serialized, /":root"\s*=\s*"deny"/);
  assert.match(serialized, /":minimal"\s*=\s*"read"/);
  assert.match(serialized, /":workspace_roots"\s*=\s*\{\s*"\."\s*=\s*"read"/);
  assert.match(serialized, /":workspace_roots"\s*=\s*\{\s*"\."\s*=\s*"write"/);
  assert.match(serialized, new RegExp(stateRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(serialized, new RegExp(nodeRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(serialized, new RegExp(localBin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(serialized, new RegExp(externalBin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(
    serialized,
    new RegExp(unrelatedHomeBin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );

  assert.equal(
    codexStandalonePermissionProfile({ readOnly: true, networkAccess: false }),
    CODEX_STANDALONE_PERMISSION_PROFILES.readOffline
  );
  assert.equal(
    codexStandalonePermissionProfile({ readOnly: true, networkAccess: true }),
    CODEX_STANDALONE_PERMISSION_PROFILES.readNetwork
  );
  assert.equal(
    codexStandalonePermissionProfile({ readOnly: false, networkAccess: false }),
    CODEX_STANDALONE_PERMISSION_PROFILES.writeOffline
  );
  assert.equal(
    codexStandalonePermissionProfile({ readOnly: false, networkAccess: true }),
    CODEX_STANDALONE_PERMISSION_PROFILES.writeNetwork
  );

  process.stdout.write("VERIFY_CODEX_STANDALONE_SECURITY_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

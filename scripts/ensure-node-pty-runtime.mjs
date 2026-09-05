import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

function resolveNodePtyRoot() {
  const requireFromInstallRoot = createRequire(path.join(process.cwd(), "package.json"));
  const entry = requireFromInstallRoot.resolve("node-pty");
  return path.resolve(path.dirname(entry), "..");
}

function ensureDarwinSpawnHelper(root) {
  if (process.platform !== "darwin") return;
  const prebuildRoot = path.join(root, "prebuilds", `darwin-${process.arch}`);
  const nativeModule = path.join(prebuildRoot, "pty.node");
  const helper = path.join(prebuildRoot, "spawn-helper");
  if (!fs.existsSync(nativeModule) || !fs.existsSync(helper)) {
    throw new Error(
      `node-pty Darwin prebuild is incomplete for ${process.arch}; expected pty.node and spawn-helper`
    );
  }
  const mode = fs.statSync(helper).mode & 0o777;
  if ((mode & 0o111) === 0) {
    fs.chmodSync(helper, mode | 0o755);
  }
  fs.accessSync(helper, fs.constants.X_OK);
}

const root = resolveNodePtyRoot();
ensureDarwinSpawnHelper(root);
console.log(`ENSURE_NODE_PTY_RUNTIME_OK platform=${process.platform} arch=${process.arch}`);

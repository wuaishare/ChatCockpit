import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { build } from "vite";

const repoRoot = path.resolve(import.meta.dirname, "..");
const runtimeArtifact = process.argv.includes("--runtime-artifact");
const temporaryRoot = runtimeArtifact
  ? null
  : fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-web-build-"));
const outDir = runtimeArtifact
  ? path.join(repoRoot, "web", "dist")
  : path.join(temporaryRoot!, "dist");

try {
  await build({
    configFile: path.join(repoRoot, "web", "vite.config.ts"),
    build: {
      outDir,
      emptyOutDir: true
    }
  });
  process.stdout.write(
    runtimeArtifact
      ? "BUILD_WEB_RUNTIME_ARTIFACT_OK\n"
      : "BUILD_WEB_ISOLATED_OK\n"
  );
} finally {
  if (temporaryRoot) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

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
const maxJavaScriptChunkBytes = 500 * 1024;

function listFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function verifyJavaScriptChunkBudget(): void {
  const chunks = listFiles(outDir)
    .filter((filePath) => filePath.endsWith(".js"))
    .map((filePath) => ({ filePath, bytes: fs.statSync(filePath).size }))
    .sort((left, right) => right.bytes - left.bytes);
  const largest = chunks[0];
  if (!largest) {
    throw new Error("Web build produced no JavaScript chunks");
  }
  if (largest.bytes > maxJavaScriptChunkBytes) {
    throw new Error(
      `Web JavaScript chunk budget exceeded: ${path.basename(largest.filePath)} is ${largest.bytes} bytes; limit is ${maxJavaScriptChunkBytes}`
    );
  }
  process.stdout.write(
    `VERIFY_WEB_CHUNK_BUDGET_OK largest=${path.basename(largest.filePath)} bytes=${largest.bytes} limit=${maxJavaScriptChunkBytes}\n`
  );
}

try {
  await build({
    configFile: path.join(repoRoot, "web", "vite.config.ts"),
    build: {
      outDir,
      emptyOutDir: true
    }
  });
  verifyJavaScriptChunkBudget();
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

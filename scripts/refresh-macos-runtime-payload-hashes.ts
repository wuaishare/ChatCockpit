import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface RuntimeManifest {
  schemaVersion: number;
  payload: {
    layoutVersion: number;
    files: Record<string, string>;
  };
}

const payloadRootInput = process.env.TOKENPILOT_RUNTIME_PAYLOAD_DIR?.trim();
assert.ok(payloadRootInput, "TOKENPILOT_RUNTIME_PAYLOAD_DIR is required");
const payloadRoot = path.resolve(payloadRootInput);
const rehashPathsInput = process.env.TOKENPILOT_RUNTIME_REHASH_PATHS ?? "";
const rehashPaths = [...new Set(rehashPathsInput.split("\n").map((value) => value.trim()).filter(Boolean))].sort();
assert.ok(rehashPaths.length > 0, "TOKENPILOT_RUNTIME_REHASH_PATHS is required");

const manifestPath = path.join(payloadRoot, "manifest.json");
assert.equal(fs.existsSync(manifestPath), true, "Missing runtime payload manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as RuntimeManifest;
assert.equal(manifest.schemaVersion, 1, "Unsupported runtime manifest schema");
assert.equal(manifest.payload?.layoutVersion, 1, "Unsupported runtime payload layout");
assert.ok(manifest.payload?.files && typeof manifest.payload.files === "object", "Missing payload.files");

function validRelativePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\\")) return false;
  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const nextFiles = { ...manifest.payload.files };
for (const relativePath of rehashPaths) {
  assert.equal(validRelativePath(relativePath), true, `Invalid rehash path: ${relativePath}`);
  assert.ok(
    Object.prototype.hasOwnProperty.call(manifest.payload.files, relativePath),
    `Signed Mach-O is not covered by the existing payload manifest: ${relativePath}`
  );
  const absolutePath = path.join(payloadRoot, relativePath);
  const relativeCheck = path.relative(payloadRoot, absolutePath);
  assert.equal(relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck), false, `Rehash path escapes payload root: ${relativePath}`);
  assert.equal(fs.existsSync(absolutePath), true, `Missing signed payload file: ${relativePath}`);
  assert.equal(fs.statSync(absolutePath).isFile(), true, `Signed payload entry is not a file: ${relativePath}`);
  nextFiles[relativePath] = sha256(absolutePath);
}

assert.ok(rehashPaths.includes("node/bin/node"), "Signed path set must include node/bin/node");
manifest.payload.files = nextFiles;

const tempPath = `${manifestPath}.tmp-${process.pid}`;
try {
  fs.writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  fs.renameSync(tempPath, manifestPath);
} finally {
  if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
}

process.stdout.write(`REFRESH_MACOS_RUNTIME_PAYLOAD_HASHES_OK files=${rehashPaths.length}\n`);

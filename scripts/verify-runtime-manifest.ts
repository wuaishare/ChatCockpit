import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { parseNodeRuntimeInputManifest } from "../src/core/runtime-manifest.js";

const manifestPath = path.join(process.cwd(), "scripts", "runtime", "node-runtime-manifest.json");
const raw = fs.readFileSync(manifestPath, "utf8");
const manifest = parseNodeRuntimeInputManifest(JSON.parse(raw));

assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.nodeVersion, "24.18.1");
assert.equal(manifest.platform, "darwin");
assert.deepEqual(Object.keys(manifest.architectures).sort(), ["arm64", "x64"]);

assert.deepEqual(manifest.architectures.arm64, {
  artifact: "node-v24.18.1-darwin-arm64.tar.xz",
  sha256: "1d60b703fe5d7e7072489be8187f430f1a095a658c31e5e1e281331a5873fac3"
});
assert.deepEqual(manifest.architectures.x64, {
  artifact: "node-v24.18.1-darwin-x64.tar.xz",
  sha256: "f892c7895720f40d3750bde24f3554242d36f23602b5167b5b73ec4d13938aef"
});

for (const [architecture, entry] of Object.entries(manifest.architectures)) {
  assert.match(
    entry.artifact,
    new RegExp(`^node-v24\\.18\\.1-darwin-${architecture}\\.tar\\.xz$`)
  );
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
}

assert.equal(raw.includes("latest-v24"), false);
assert.equal(raw.includes("/" + "Users/"), false);
assert.equal(raw.includes("TOKENPILOT_API_TOKEN"), false);
assert.equal(raw.includes("TOKENPILOT_OAUTH"), false);

assert.throws(
  () =>
    parseNodeRuntimeInputManifest({
      ...manifest,
      architectures: {
        ...manifest.architectures,
        arm64: {
          ...manifest.architectures.arm64,
          sha256: "invalid"
        }
      }
    }),
  /Invalid string|Invalid/
);

process.stdout.write("VERIFY_RUNTIME_MANIFEST_OK\n");

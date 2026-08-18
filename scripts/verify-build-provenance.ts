import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { readRuntimeBuildProvenance } from "../src/core/build-provenance.js";
import { buildHealthStatusSnapshot } from "../src/core/gpt-config.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  version: string;
  scripts: Record<string, string>;
};
const generatorSource = fs.readFileSync(path.join(repoRoot, "scripts/generate-build-provenance.ts"), "utf8");
const healthSource = fs.readFileSync(path.join(repoRoot, "src/core/gpt-config.ts"), "utf8");
const dashboardSource = fs.readFileSync(path.join(repoRoot, "web/src/components/DashboardView.tsx"), "utf8");
const webTypesSource = fs.readFileSync(path.join(repoRoot, "web/src/types.ts"), "utf8");

assert.match(packageJson.scripts.build, /generate-build-provenance\.ts/);
assert.match(generatorSource, /git", \["rev-parse", "--short=12", "HEAD"\]/);
assert.match(generatorSource, /dist", "build-provenance\.json"/);
assert.match(healthSource, /build: readRuntimeBuildProvenance\(\)/);
assert.match(webTypesSource, /build\?: RuntimeBuildProvenance/);
assert.match(dashboardSource, /health\.build\.buildId/);
assert.match(dashboardSource, /health\.build\.revision/);
assert.match(dashboardSource, /summary-build-provenance/);

const provenance = readRuntimeBuildProvenance();
assert.equal(provenance.version, packageJson.version);
if (provenance.buildId !== null) assert.match(provenance.buildId, /^\d{10}$/);
if (provenance.revision !== null) assert.match(provenance.revision, /^[a-f0-9]{7,40}$/i);
if (provenance.builtAt !== null) assert.equal(Number.isNaN(Date.parse(provenance.builtAt)), false);

const health = buildHealthStatusSnapshot();
assert.deepEqual(health.build, provenance);

process.stdout.write("VERIFY_BUILD_PROVENANCE_OK\n");

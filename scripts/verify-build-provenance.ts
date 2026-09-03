import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  computeRuntimeArtifactDigests,
  readRuntimeBuildProvenance,
  verifyRuntimeBuildIntegrity,
  verifyWebBuildGeneration,
  verifyWebBuildIntegrity
} from "../src/core/build-provenance.js";
import { buildHealthStatusSnapshot } from "../src/core/gpt-config.js";
import {
  resolveUiBuildRecovery,
  uiRecoveryLocaleFromAcceptLanguage
} from "../src/server/ui-build-recovery.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const requireClean = process.argv.includes("--require-clean");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  version: string;
  scripts: Record<string, string>;
};
const generatorSource = fs.readFileSync(path.join(repoRoot, "scripts/generate-build-provenance.ts"), "utf8");
const healthSource = fs.readFileSync(path.join(repoRoot, "src/core/gpt-config.ts"), "utf8");
const dashboardSource = fs.readFileSync(path.join(repoRoot, "web/src/components/DashboardView.tsx"), "utf8");
const webTypesSource = fs.readFileSync(path.join(repoRoot, "web/src/types.ts"), "utf8");
const staticRoutesSource = fs.readFileSync(path.join(repoRoot, "src/server/static-routes.ts"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "src/server/app.ts"), "utf8");
const uiBuildRecoverySource = fs.readFileSync(path.join(repoRoot, "src/server/ui-build-recovery.ts"), "utf8");
const cliSource = fs.readFileSync(path.join(repoRoot, "src/cli/index.ts"), "utf8");
const lifecycleSource = fs.readFileSync(path.join(repoRoot, "scripts/macos-manage-local-server.sh"), "utf8");
const webBuildSource = fs.readFileSync(path.join(repoRoot, "scripts/build-web.ts"), "utf8");

assert.match(packageJson.scripts.build, /build:web:runtime/);
assert.match(packageJson.scripts.build, /generate-build-provenance\.ts/);
assert.match(packageJson.scripts.build, /dist\/cli\/index\.js build-provenance verify --json/);
assert.match(packageJson.scripts["build:web"], /scripts\/build-web\.ts/);
assert.doesNotMatch(packageJson.scripts["build:web"], /--runtime-artifact/);
assert.match(packageJson.scripts["build:web:runtime"], /--runtime-artifact/);
assert.match(generatorSource, /schemaVersion: 2/);
assert.match(generatorSource, /getUTCSeconds\(\)/);
assert.match(generatorSource, /git", \["rev-parse", "--short=12", "HEAD"\]/);
assert.match(generatorSource, /git", \["status", "--porcelain", "--untracked-files=all"\]/);
assert.match(generatorSource, /dist", "build-provenance\.json"/);
assert.match(generatorSource, /web", "dist", "build-provenance\.json"/);
assert.match(generatorSource, /backendSha256: artifacts\.backendSha256/);
assert.match(generatorSource, /webSha256: artifacts\.webSha256/);
assert.match(healthSource, /runtimeBuildProvenance \?\? readRuntimeBuildProvenance\(\)/);
assert.match(healthSource, /version: provenance\.version/);
assert.match(healthSource, /builtAt: provenance\.builtAt/);
assert.doesNotMatch(webTypesSource, /sourceDirty/);
assert.doesNotMatch(webTypesSource, /backendSha256/);
assert.doesNotMatch(webTypesSource, /webSha256/);
assert.match(dashboardSource, /health\.build\.buildId/);
assert.match(dashboardSource, /health\.build\.revision/);
assert.match(dashboardSource, /summary-build-provenance/);
assert.match(uiBuildRecoverySource, /verifyWebBuildGeneration/);
assert.match(uiBuildRecoverySource, /verifyWebBuildIntegrity/);
assert.match(uiBuildRecoverySource, /verifyRuntimeBuildIntegrity/);
assert.match(staticRoutesSource, /UI_BUILD_GENERATION_MISMATCH/);
assert.match(staticRoutesSource, /UI_RUNTIME_RESTART_REQUIRED/);
assert.match(staticRoutesSource, /Build artifacts are out of sync/);
assert.match(staticRoutesSource, /已检测到完整的新构建，Runtime 需要重启/);
assert.match(staticRoutesSource, /uiRecoveryLocaleFromAcceptLanguage/);
assert.match(staticRoutesSource, /runtimeBuildProvenance/);
assert.match(staticRoutesSource, /resolveUiBuildRecovery/);
assert.match(serverSource, /buildPublicHealthStatus\(paths, options\.runtimeBuildProvenance \?\? null\)/);
assert.match(cliSource, /case "build-provenance"/);
assert.match(cliSource, /const runtimeBuildProvenance = assertBuiltRuntimeIntegrity\(paths\)/);
assert.match(cliSource, /runtimeBuildProvenance,/);
assert.match(lifecycleSource, /assert_runtime_build_integrity/);
assert.match(lifecycleSource, /build-provenance verify --json/);
assert.match(webBuildSource, /mkdtempSync/);
assert.match(webBuildSource, /runtimeArtifact/);
assert.match(webBuildSource, /BUILD_WEB_ISOLATED_OK/);

function currentGitRevision(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

const provenance = readRuntimeBuildProvenance(repoRoot);
assert.equal(provenance.version, packageJson.version);
if (provenance.buildId !== null) assert.match(provenance.buildId, /^\d{10}(?:\d{2})?$/);
if (provenance.revision !== null) assert.match(provenance.revision, /^[a-f0-9]{7,40}$/i);
if (provenance.builtAt !== null) assert.equal(Number.isNaN(Date.parse(provenance.builtAt)), false);
if (provenance.sourceDirty !== null) assert.equal(typeof provenance.sourceDirty, "boolean");
assert.match(provenance.backendSha256 ?? "", /^[a-f0-9]{64}$/);
assert.match(provenance.webSha256 ?? "", /^[a-f0-9]{64}$/);

const expectedCertifiedRevision =
  process.env.CHATCOCKPIT_EXPECTED_BUILD_REVISION?.trim().toLowerCase() || currentGitRevision();
if (requireClean) assert.ok(expectedCertifiedRevision, "certified build requires an expected revision");
const integrity = verifyRuntimeBuildIntegrity(repoRoot, {
  requireCleanSource: requireClean,
  expectedRevision: requireClean ? expectedCertifiedRevision : null
});
assert.equal(integrity.ok, true, `current build integrity failed: ${integrity.code}`);
assert.equal(integrity.code, "ok");
assert.equal(verifyWebBuildGeneration(repoRoot).ok, true);
assert.equal(verifyWebBuildIntegrity(repoRoot).ok, true);

const health = buildHealthStatusSnapshot();
assert.deepEqual(health.build, {
  version: provenance.version,
  buildId: provenance.buildId,
  revision: provenance.revision,
  builtAt: provenance.builtAt
});
assert.equal("sourceDirty" in health.build, false);
assert.equal("backendSha256" in health.build, false);
assert.equal("webSha256" in health.build, false);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-build-provenance-"));
try {
  fs.mkdirSync(path.join(fixtureRoot, "dist", "cli"), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "web", "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(fixtureRoot, "package.json"),
    JSON.stringify({ name: "chatcockpit-fixture", version: "9.9.9" }),
    "utf8"
  );
  fs.writeFileSync(path.join(fixtureRoot, "dist", "cli", "index.js"), "console.log('fixture');\n", "utf8");
  fs.writeFileSync(path.join(fixtureRoot, "web", "dist", "index.html"), "<main>fixture</main>\n", "utf8");

  const digests = computeRuntimeArtifactDigests(fixtureRoot);
  assert.ok(digests.backendSha256);
  assert.ok(digests.webSha256);
  const fixtureProvenance = {
    schemaVersion: 2,
    version: "9.9.9",
    buildId: "2608282000",
    revision: "0123456789ab",
    builtAt: "2026-08-28T20:00:00.000Z",
    sourceDirty: false,
    backendSha256: digests.backendSha256,
    webSha256: digests.webSha256
  };
  const serialized = `${JSON.stringify(fixtureProvenance, null, 2)}\n`;
  const canonicalPath = path.join(fixtureRoot, "dist", "build-provenance.json");
  const markerPath = path.join(fixtureRoot, "web", "dist", "build-provenance.json");
  fs.writeFileSync(canonicalPath, serialized, "utf8");
  fs.writeFileSync(markerPath, serialized, "utf8");

  const startupProvenance = readRuntimeBuildProvenance(fixtureRoot);
  const startupHealth = buildHealthStatusSnapshot("chatcockpit", startupProvenance);
  assert.deepEqual(startupHealth.build, {
    version: startupProvenance.version,
    buildId: startupProvenance.buildId,
    revision: startupProvenance.revision,
    builtAt: startupProvenance.builtAt
  });
  assert.equal(verifyRuntimeBuildIntegrity(fixtureRoot).code, "ok");
  assert.equal(verifyWebBuildGeneration(fixtureRoot, startupProvenance).code, "ok");
  assert.equal(resolveUiBuildRecovery(fixtureRoot, startupProvenance).status, "ok");
  assert.equal(uiRecoveryLocaleFromAcceptLanguage("zh-CN,zh;q=0.9,en;q=0.8"), "zh-CN");
  assert.equal(uiRecoveryLocaleFromAcceptLanguage("zh-Hans-CN,en;q=0.8"), "zh-CN");
  assert.equal(uiRecoveryLocaleFromAcceptLanguage("ja-JP,en-US;q=0.9"), "en-US");
  assert.equal(
    verifyRuntimeBuildIntegrity(fixtureRoot, {
      requireCleanSource: true,
      expectedRevision: "0123456789abcdef"
    }).code,
    "ok"
  );
  assert.equal(
    verifyRuntimeBuildIntegrity(fixtureRoot, { expectedRevision: "0123456" }).code,
    "ok"
  );
  assert.equal(
    verifyRuntimeBuildIntegrity(fixtureRoot, { expectedRevision: "fedcba987654" }).code,
    "revision-mismatch"
  );

  fs.writeFileSync(path.join(fixtureRoot, "web", "dist", "index.html"), "<main>changed</main>\n", "utf8");
  assert.equal(verifyWebBuildIntegrity(fixtureRoot).code, "web-artifact-mismatch");
  assert.equal(verifyRuntimeBuildIntegrity(fixtureRoot).code, "web-artifact-mismatch");
  assert.equal(
    resolveUiBuildRecovery(fixtureRoot, startupProvenance).status,
    "rebuild-required",
    "a genuinely incomplete artifact set must continue to require a complete rebuild"
  );
  fs.writeFileSync(path.join(fixtureRoot, "web", "dist", "index.html"), "<main>fixture</main>\n", "utf8");

  fs.rmSync(markerPath);
  assert.equal(verifyWebBuildGeneration(fixtureRoot).code, "web-generation-missing");
  assert.equal(verifyRuntimeBuildIntegrity(fixtureRoot).code, "web-generation-missing");
  fs.writeFileSync(markerPath, serialized, "utf8");

  const mismatchedMarker = { ...fixtureProvenance, buildId: "2608282001" };
  fs.writeFileSync(markerPath, `${JSON.stringify(mismatchedMarker, null, 2)}\n`, "utf8");
  assert.equal(verifyWebBuildGeneration(fixtureRoot).code, "web-generation-mismatch");
  fs.writeFileSync(markerPath, serialized, "utf8");

  fs.writeFileSync(path.join(fixtureRoot, "dist", "cli", "index.js"), "console.log('changed');\n", "utf8");
  assert.equal(verifyRuntimeBuildIntegrity(fixtureRoot).code, "backend-artifact-mismatch");
  fs.writeFileSync(path.join(fixtureRoot, "dist", "cli", "index.js"), "console.log('fixture');\n", "utf8");

  const backendBeforePackaging = computeRuntimeArtifactDigests(fixtureRoot).backendSha256;
  for (const packagingRoot of [
    "device-agent",
    "macos",
    "macos-distribution",
    "macos-dmg",
    "macos-runtime",
    "macos-xcode",
    "release",
    "runtime-cache",
    "xcode-derived"
  ]) {
    const packagingArtifact = path.join(fixtureRoot, "dist", packagingRoot, "Generated.artifact");
    fs.mkdirSync(path.dirname(packagingArtifact), { recursive: true });
    fs.writeFileSync(packagingArtifact, "packaging output\n", "utf8");
    assert.equal(
      computeRuntimeArtifactDigests(fixtureRoot).backendSha256,
      backendBeforePackaging,
      `packaging output under dist/${packagingRoot} must not invalidate runtime provenance`
    );
  }

  const nextGeneration = {
    ...fixtureProvenance,
    buildId: "2608282002",
    builtAt: "2026-08-28T20:02:00.000Z"
  };
  const nextSerialized = `${JSON.stringify(nextGeneration, null, 2)}\n`;
  fs.writeFileSync(canonicalPath, nextSerialized, "utf8");
  fs.writeFileSync(markerPath, nextSerialized, "utf8");
  assert.equal(verifyRuntimeBuildIntegrity(fixtureRoot).code, "ok");
  assert.equal(verifyWebBuildGeneration(fixtureRoot).code, "ok");
  assert.deepEqual(buildHealthStatusSnapshot("chatcockpit", startupProvenance).build, startupHealth.build);
  assert.equal(
    verifyWebBuildGeneration(fixtureRoot, startupProvenance).code,
    "web-generation-mismatch"
  );
  assert.equal(
    resolveUiBuildRecovery(fixtureRoot, startupProvenance).status,
    "restart-required",
    "a complete newer disk generation must ask for Runtime restart instead of another rebuild"
  );
  fs.writeFileSync(canonicalPath, serialized, "utf8");
  fs.writeFileSync(markerPath, serialized, "utf8");

  const dirtyProvenance = { ...fixtureProvenance, sourceDirty: true };
  const dirtySerialized = `${JSON.stringify(dirtyProvenance, null, 2)}\n`;
  fs.writeFileSync(canonicalPath, dirtySerialized, "utf8");
  fs.writeFileSync(markerPath, dirtySerialized, "utf8");
  assert.equal(verifyRuntimeBuildIntegrity(fixtureRoot).code, "ok");
  assert.equal(
    verifyRuntimeBuildIntegrity(fixtureRoot, { requireCleanSource: true }).code,
    "source-not-clean"
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write("VERIFY_BUILD_PROVENANCE_OK\n");

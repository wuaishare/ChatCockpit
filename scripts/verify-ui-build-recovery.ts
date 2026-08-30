import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";

import {
  computeRuntimeArtifactDigests,
  readRuntimeBuildProvenance
} from "../src/core/build-provenance.js";
import { registerStaticRoutes } from "../src/server/static-routes.js";
import { buildFixturePaths } from "./test-support/fixture-paths.js";

function writeProvenance(root: string, input: {
  buildId: string;
  builtAt: string;
  backendSha256: string;
  webSha256: string;
}): void {
  const serialized = `${JSON.stringify({
    schemaVersion: 2,
    version: "9.9.9",
    buildId: input.buildId,
    revision: "0123456789ab",
    builtAt: input.builtAt,
    sourceDirty: false,
    backendSha256: input.backendSha256,
    webSha256: input.webSha256
  }, null, 2)}\n`;
  fs.writeFileSync(path.join(root, "dist", "build-provenance.json"), serialized, "utf8");
  fs.writeFileSync(path.join(root, "web", "dist", "build-provenance.json"), serialized, "utf8");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-ui-build-recovery-"));
const noUiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-ui-not-built-"));
try {
  fs.mkdirSync(path.join(noUiRoot, "openapi"), { recursive: true });
  fs.writeFileSync(path.join(noUiRoot, "package.json"), JSON.stringify({ version: "9.9.9" }), "utf8");
  fs.writeFileSync(
    path.join(noUiRoot, "openapi", "chatcockpit.openapi.yaml"),
    "openapi: 3.1.0\ninfo:\n  title: fixture\n  version: 9.9.9\npaths: {}\n",
    "utf8"
  );
  const noUiApp = Fastify({ logger: false });
  registerStaticRoutes(noUiApp, buildFixturePaths(noUiRoot));
  await noUiApp.ready();
  const notBuiltZh = await noUiApp.inject({
    method: "GET",
    url: "/ui",
    headers: { "accept-language": "zh-CN,zh;q=0.9" }
  });
  assert.equal(notBuiltZh.statusCode, 200);
  assert.equal(notBuiltZh.headers["content-language"], "zh-CN");
  assert.match(notBuiltZh.body, /Web UI 尚未构建/);
  assert.match(notBuiltZh.body, /完整构建/);
  assert.match(notBuiltZh.body, /npm run build/);
  assert.doesNotMatch(notBuiltZh.body, /npm run build:web/);
  assert.match(notBuiltZh.body, /重启 ChatCockpit Runtime/);
  await noUiApp.close();

  fs.mkdirSync(path.join(root, "dist", "cli"), { recursive: true });
  fs.mkdirSync(path.join(root, "web", "dist", "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "9.9.9" }), "utf8");
  fs.writeFileSync(path.join(root, "dist", "cli", "index.js"), "console.log('fixture');\n", "utf8");
  fs.writeFileSync(
    path.join(root, "web", "dist", "index.html"),
    '<!doctype html><html><head><script type="module" src="./assets/app.js"></script></head><body>fixture</body></html>\n',
    "utf8"
  );
  fs.writeFileSync(path.join(root, "web", "dist", "assets", "app.js"), "console.log('fixture');\n", "utf8");

  const initialDigests = computeRuntimeArtifactDigests(root);
  assert.ok(initialDigests.backendSha256);
  assert.ok(initialDigests.webSha256);
  writeProvenance(root, {
    buildId: "2608300400",
    builtAt: "2026-08-30T04:00:00.000Z",
    backendSha256: initialDigests.backendSha256,
    webSha256: initialDigests.webSha256
  });
  const runningProvenance = readRuntimeBuildProvenance(root);

  const paths = buildFixturePaths(root);
  const app = Fastify({ logger: false });
  registerStaticRoutes(app, paths, "/ui", undefined, runningProvenance);
  await app.ready();

  const initialUi = await app.inject({
    method: "GET",
    url: "/ui",
    headers: { "accept-language": "en-US,en;q=0.9" }
  });
  assert.equal(initialUi.statusCode, 200);
  assert.match(initialUi.body, /fixture/);

  const snapshotRoot = path.join(paths.runtimeDir, "ui-generations");
  assert.equal(fs.existsSync(snapshotRoot), true);

  writeProvenance(root, {
    buildId: "2608300401",
    builtAt: "2026-08-30T04:01:00.000Z",
    backendSha256: initialDigests.backendSha256,
    webSha256: initialDigests.webSha256
  });

  const liveAfterNextBuild = await app.inject({
    method: "GET",
    url: "/ui",
    headers: { "accept-language": "zh-Hans-CN,zh;q=0.9,en;q=0.8" }
  });
  assert.equal(liveAfterNextBuild.statusCode, 200);
  assert.match(liveAfterNextBuild.body, /fixture/);

  const liveAssetAfterNextBuild = await app.inject({
    method: "GET",
    url: "/ui/assets/app.js",
    headers: { "accept-language": "en-US,en;q=0.9" }
  });
  assert.equal(liveAssetAfterNextBuild.statusCode, 200);
  assert.match(liveAssetAfterNextBuild.body, /console\.log\('fixture'\)/);

  fs.writeFileSync(
    path.join(root, "web", "dist", "index.html"),
    "<main>broken generation</main>\n",
    "utf8"
  );
  const liveAfterBrokenCheckout = await app.inject({
    method: "GET",
    url: "/ui",
    headers: { "accept-language": "en-US,en;q=0.9" }
  });
  assert.equal(liveAfterBrokenCheckout.statusCode, 200);
  assert.match(liveAfterBrokenCheckout.body, /fixture/);
  assert.doesNotMatch(liveAfterBrokenCheckout.body, /broken generation/);
  await app.close();

  fs.writeFileSync(
    path.join(root, "web", "dist", "index.html"),
    '<!doctype html><html><head><script type="module" src="./assets/app.js"></script></head><body>fixture</body></html>\n',
    "utf8"
  );
  writeProvenance(root, {
    buildId: "2608300401",
    builtAt: "2026-08-30T04:01:00.000Z",
    backendSha256: initialDigests.backendSha256,
    webSha256: initialDigests.webSha256
  });
  fs.rmSync(snapshotRoot, { recursive: true, force: true });

  const fallbackApp = Fastify({ logger: false });
  registerStaticRoutes(fallbackApp, paths, "/ui", undefined, runningProvenance);
  await fallbackApp.ready();
  const restartZh = await fallbackApp.inject({
    method: "GET",
    url: "/ui",
    headers: { "accept-language": "zh-Hans-CN,zh;q=0.9,en;q=0.8" }
  });
  assert.equal(restartZh.statusCode, 503);
  assert.equal(restartZh.headers["content-language"], "zh-CN");
  assert.match(restartZh.body, /已检测到完整的新构建，Runtime 需要重启/);
  assert.match(restartZh.body, /无需再次执行/);

  const restartAssetEn = await fallbackApp.inject({
    method: "GET",
    url: "/ui/assets/app.js",
    headers: { "accept-language": "en-US,en;q=0.9" }
  });
  assert.equal(restartAssetEn.statusCode, 503);
  assert.equal(restartAssetEn.headers["content-language"], "en-US");
  assert.equal(restartAssetEn.json().error.code, "UI_RUNTIME_RESTART_REQUIRED");

  fs.writeFileSync(
    path.join(root, "web", "dist", "index.html"),
    "<main>broken generation</main>\n",
    "utf8"
  );
  const rebuildEn = await fallbackApp.inject({
    method: "GET",
    url: "/ui",
    headers: { "accept-language": "en-US,en;q=0.9" }
  });
  assert.equal(rebuildEn.statusCode, 503);
  assert.match(rebuildEn.body, /Build artifacts are out of sync/);
  await fallbackApp.close();
  process.stdout.write("VERIFY_UI_BUILD_RECOVERY_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(noUiRoot, { recursive: true, force: true });
}

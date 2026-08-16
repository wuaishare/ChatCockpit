import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

function assertBaselineHeaders(headers: Record<string, string | string[] | undefined>): void {
  const csp = String(headers["content-security-policy"] ?? "");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.match(csp, /img-src 'self' data: blob:/);
  assert.match(csp, /font-src 'self' data:/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.equal(headers["permissions-policy"], "camera=(), microphone=(), geolocation=()");
  assert.equal(headers["cross-origin-opener-policy"], "same-origin");
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-web-security-"));
  fs.writeFileSync(path.join(root, "README.md"), "# Web security fixture\n", "utf8");
  fs.mkdirSync(path.join(root, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "openapi", "chatcockpit.openapi.yaml"),
    path.join(root, "openapi", "chatcockpit.openapi.yaml")
  );
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);

  const original = {
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    token: process.env.CHATCOCKPIT_API_TOKEN,
    publicBaseUrl: process.env.CHATCOCKPIT_PUBLIC_BASE_URL,
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH
  };
  process.env.CHATCOCKPIT_EXPOSED = "false";
  delete process.env.CHATCOCKPIT_API_TOKEN;
  delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;
  process.env.CHATCOCKPIT_CONFIG_PATH = path.join(paths.runtimeDir, "missing-config.json");

  const app = buildServer(paths);
  try {
    const localUi = await app.inject({ method: "GET", url: "/ui" });
    assert.equal(localUi.statusCode, 200);
    assertBaselineHeaders(localUi.headers);
    assert.equal(localUi.headers["strict-transport-security"], undefined);

    const trustedHttps = await app.inject({
      method: "GET",
      url: "/openapi.yaml",
      remoteAddress: "127.0.0.1",
      headers: {
        host: "chatcockpit.example.com",
        "x-forwarded-proto": "https",
        "x-forwarded-for": "203.0.113.7"
      }
    });
    assert.equal(trustedHttps.statusCode, 200);
    assertBaselineHeaders(trustedHttps.headers);
    assert.match(
      String(trustedHttps.headers["strict-transport-security"] ?? ""),
      /^max-age=31536000; includeSubDomains$/
    );
    assert.match(trustedHttps.body, /https:\/\/chatcockpit\.example\.com/);

    const untrustedSpoof = await app.inject({
      method: "GET",
      url: "/openapi.yaml",
      remoteAddress: "198.51.100.23",
      headers: {
        host: "chatcockpit.example.com",
        "x-forwarded-proto": "https",
        "x-forwarded-for": "203.0.113.8"
      }
    });
    assert.equal(
      untrustedSpoof.statusCode,
      404,
      "a direct non-loopback peer outside Trusted LAN must be denied before forwarded-header handling"
    );
    assertBaselineHeaders(untrustedSpoof.headers);
    assert.equal(untrustedSpoof.headers["strict-transport-security"], undefined);
    assert.equal(untrustedSpoof.body, "Not Found");
  } finally {
    await app.close();
    if (original.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = original.exposed;
    if (original.token === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = original.token;
    if (original.publicBaseUrl === undefined) delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;
    else process.env.CHATCOCKPIT_PUBLIC_BASE_URL = original.publicBaseUrl;
    if (original.configPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
    else process.env.CHATCOCKPIT_CONFIG_PATH = original.configPath;
  }

  process.stdout.write("WEB_SECURITY_OK\n");
}

await main();

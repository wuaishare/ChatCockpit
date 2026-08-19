import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

interface RequestCase {
  method: "GET" | "POST";
  url: string;
  payload?: unknown;
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-public-web-surface-"));
  fs.writeFileSync(path.join(root, "README.md"), "# Public Web surface fixture\n", "utf8");
  fs.mkdirSync(path.join(root, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "openapi", "chatcockpit.openapi.yaml"),
    path.join(root, "openapi", "chatcockpit.openapi.yaml")
  );
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "public-web-surface-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      defaultRepoId: "primary",
      workspaceAllowlist: [root],
      repoMappings: { primary: { path: root } }
    }),
    "utf8"
  );

  const operatorStore = new OperatorStore({
    path: operatorDatabasePath(paths.runtimeDir)
  });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({
    username: "owner",
    password: "test-password-public-web-surface"
  });
  operatorStore.close();

  const original = {
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
    token: process.env.CHATCOCKPIT_API_TOKEN,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    publicBaseUrl: process.env.CHATCOCKPIT_PUBLIC_BASE_URL
  };
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = "test-token-public-web-surface";
  process.env.CHATCOCKPIT_EXPOSED = "true";
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = "https://chatcockpit.example.com";

  const app = buildServer(paths);
  try {
    const publicCases: RequestCase[] = [
      { method: "GET", url: "/ui" },
      { method: "GET", url: "/api/health" },
      { method: "GET", url: "/api/operator/status" },
      { method: "GET", url: "/openapi.yaml" },
      { method: "GET", url: "/privacy-policy" },
      { method: "GET", url: "/.well-known/oauth-protected-resource" },
      { method: "GET", url: "/.well-known/oauth-protected-resource/mcp" },
      { method: "GET", url: "/.well-known/oauth-authorization-server" }
    ];
    for (const item of publicCases) {
      const response = await app.inject({ method: item.method, url: item.url });
      assert.equal(
        response.statusCode,
        200,
        `${item.method} ${item.url} must remain anonymously readable`
      );
    }

    const invalidLogin = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      payload: {
        username: "owner",
        password: "test-password-intentionally-wrong"
      }
    });
    assert.equal(invalidLogin.statusCode, 401);
    assert.notEqual(
      invalidLogin.statusCode,
      403,
      "Operator login must be publicly reachable even when credentials are invalid"
    );

    const publicPasskeyOptions = await app.inject({
      method: "POST",
      url: "/api/operator/passkeys/authentication/options",
      headers: {
        host: "chatcockpit.example.com",
        "x-forwarded-proto": "https"
      }
    });
    assert.equal(
      publicPasskeyOptions.statusCode,
      404,
      "Passkey authentication ceremony must be anonymously reachable without exposing a configured credential"
    );
    assert.match(publicPasskeyOptions.body, /PASSKEY_NOT_CONFIGURED/);

    const invalidTotpChallenge = await app.inject({
      method: "POST",
      url: "/api/operator/totp/login",
      payload: { challenge: "invalid", verification: "000000" }
    });
    assert.equal(
      invalidTotpChallenge.statusCode,
      401,
      "TOTP challenge verification must remain anonymously reachable before an Owner session exists"
    );
    assert.match(invalidTotpChallenge.body, /MFA_CHALLENGE_INVALID/);

    const registration = await app.inject({
      method: "POST",
      url: "/oauth/register",
      payload: {}
    });
    assert.equal(registration.statusCode, 400);
    const registrationBody = registration.json() as { error?: string };
    assert.equal(registrationBody.error, "invalid_client_metadata");

    const token = await app.inject({
      method: "POST",
      url: "/oauth/token",
      payload: "grant_type=unsupported",
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    assert.equal(token.statusCode, 400);
    assert.equal((token.json() as { error?: string }).error, "unsupported_grant_type");

    const revoke = await app.inject({
      method: "POST",
      url: "/oauth/revoke",
      payload: "token=test-token-unknown",
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    assert.equal(revoke.statusCode, 200);

    const protectedCases: RequestCase[] = [
      { method: "GET", url: "/api/operator/session" },
      { method: "GET", url: "/api/operator/passkeys" },
      { method: "POST", url: "/api/operator/passkeys/registration/options" },
      { method: "GET", url: "/api/operator/totp" },
      { method: "POST", url: "/api/operator/totp/enrollment" },
      { method: "POST", url: "/api/operator/totp/disable", payload: { verification: "000000" } },
      { method: "GET", url: "/api/setup/status" },
      { method: "GET", url: "/api/gpt/config" },
      { method: "GET", url: "/api/integrations/status" },
      { method: "GET", url: "/api/jobs" },
      { method: "GET", url: "/api/activities" },
      { method: "GET", url: "/api/activities/stream" },
      { method: "GET", url: "/api/jobs/test-job/artifacts" },
      { method: "POST", url: "/api/files/read", payload: {} },
      { method: "GET", url: "/api/host/roots" },
      { method: "GET", url: "/api/git/status" },
      { method: "GET", url: "/api/continuity/projects" },
      { method: "GET", url: "/api/resources/providers" },
      { method: "GET", url: "/api/resources/runtime-profiles" },
      { method: "GET", url: "/api/runtime/codex/capabilities" },
      { method: "GET", url: "/api/recovery/attempts" }
    ];
    for (const item of protectedCases) {
      const response = await app.inject({
        method: item.method,
        url: item.url,
        ...(item.payload === undefined ? {} : { payload: item.payload })
      });
      assert.equal(
        response.statusCode,
        401,
        `${item.method} ${item.url} must reject anonymous public access`
      );
    }

    const machineSetup = await app.inject({
      method: "GET",
      url: "/api/setup/status",
      headers: { authorization: "Bearer test-token-public-web-surface" }
    });
    assert.equal(machineSetup.statusCode, 200);
  } finally {
    await app.close();
    if (original.configPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
    else process.env.CHATCOCKPIT_CONFIG_PATH = original.configPath;
    if (original.token === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = original.token;
    if (original.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = original.exposed;
    if (original.publicBaseUrl === undefined) delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;
    else process.env.CHATCOCKPIT_PUBLIC_BASE_URL = original.publicBaseUrl;
  }

  process.stdout.write("PUBLIC_WEB_SURFACE_OK\n");
}

await main();

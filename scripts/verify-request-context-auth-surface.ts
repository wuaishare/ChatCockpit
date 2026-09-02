import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Fastify from "fastify";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { createTokenPilotAuthPlugin } from "../src/server/auth.js";
import { OPERATOR_SESSION_COOKIE } from "../src/server/operator-auth-context.js";
import { operationContextFromRequest } from "../src/server/request-context.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-request-context-auth-"));
const previous = {
  exposed: process.env.CHATCOCKPIT_EXPOSED,
  apiToken: process.env.CHATCOCKPIT_API_TOKEN
};

try {
  process.env.CHATCOCKPIT_EXPOSED = "true";
  process.env.CHATCOCKPIT_API_TOKEN = "test-token-request-context-machine";

  const store = new OperatorStore({
    path: operatorDatabasePath(path.join(root, "runtime"))
  });
  const operator = new OperatorService({ store });
  await operator.setOwnerPassword({
    username: "Owner",
    password: "test-password-request-context-correct-horse-battery-staple"
  });
  const session = await operator.login({
    username: "owner",
    password: "test-password-request-context-correct-horse-battery-staple",
    source: "127.0.0.1",
    userAgent: "Request Context Auth Surface Verifier"
  });

  const app = Fastify({ logger: false });
  await app.register(createTokenPilotAuthPlugin(null, operator, "/ui"));
  app.get("/api/request-context-proof", async (request) => ({
    ok: true,
    context: operationContextFromRequest(request)
  }));
  app.post("/tokenpilot/api/request-context-proof", async (request) => ({
    ok: true,
    context: operationContextFromRequest(request)
  }));
  await app.ready();

  try {
    const operatorResponse = await app.inject({
      method: "GET",
      url: "/api/request-context-proof",
      headers: {
        cookie: `${OPERATOR_SESSION_COOKIE}=${encodeURIComponent(session.sessionSecret)}`
      }
    });
    assert.equal(operatorResponse.statusCode, 200);
    const operatorContext = operatorResponse.json().context as {
      actorType: string;
      actorId: string | null;
      authorizationGrantId: string | null;
    };
    assert.equal(operatorContext.actorType, "local-ui");
    assert.equal(operatorContext.actorId, session.principalId);
    assert.equal(operatorContext.authorizationGrantId, null);

    const operatorAliasMissingCsrf = await app.inject({
      method: "POST",
      url: "/tokenpilot/api/request-context-proof",
      headers: {
        cookie: `${OPERATOR_SESSION_COOKIE}=${encodeURIComponent(session.sessionSecret)}`
      }
    });
    assert.equal(operatorAliasMissingCsrf.statusCode, 403);
    assert.match(operatorAliasMissingCsrf.body, /CSRF_REQUIRED/);

    const operatorAlias = await app.inject({
      method: "POST",
      url: "/tokenpilot/api/request-context-proof",
      headers: {
        cookie: `${OPERATOR_SESSION_COOKIE}=${encodeURIComponent(session.sessionSecret)}`,
        "x-chatcockpit-csrf": session.csrfToken
      }
    });
    assert.equal(operatorAlias.statusCode, 200);
    assert.equal(operatorAlias.json().context.actorType, "local-ui");
    assert.equal(operatorAlias.json().context.actorId, session.principalId);

    const machineAlias = await app.inject({
      method: "POST",
      url: "/tokenpilot/api/request-context-proof",
      headers: {
        authorization: "Bearer test-token-request-context-machine"
      }
    });
    assert.equal(machineAlias.statusCode, 200);
    assert.equal(machineAlias.json().context.actorType, "rest-api");
    assert.equal(typeof machineAlias.json().context.actorId, "string");

    const machineResponse = await app.inject({
      method: "GET",
      url: "/api/request-context-proof",
      headers: {
        authorization: "Bearer test-token-request-context-machine"
      }
    });
    assert.equal(machineResponse.statusCode, 200);
    const machineContext = machineResponse.json().context as {
      actorType: string;
      actorId: string | null;
      authorizationGrantId: string | null;
    };
    assert.equal(machineContext.actorType, "rest-api");
    assert.equal(typeof machineContext.actorId, "string");
    assert.equal(machineContext.actorId, machineAlias.json().context.actorId);
    assert.notEqual(machineContext.actorId, "test-token-request-context-machine");
    assert.equal(machineContext.authorizationGrantId, null);

    const anonymousResponse = await app.inject({
      method: "GET",
      url: "/api/request-context-proof"
    });
    assert.equal(anonymousResponse.statusCode, 401);
  } finally {
    await app.close();
  }

  process.stdout.write("VERIFY_REQUEST_CONTEXT_AUTH_SURFACE_OK\n");
} finally {
  if (previous.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
  else process.env.CHATCOCKPIT_EXPOSED = previous.exposed;
  if (previous.apiToken === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
  else process.env.CHATCOCKPIT_API_TOKEN = previous.apiToken;
  fs.rmSync(root, { recursive: true, force: true });
}

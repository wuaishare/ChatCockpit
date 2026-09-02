import assert from "node:assert/strict";

import { operationContextFromRequest } from "../src/server/request-context.js";

const previousExposed = process.env.CHATCOCKPIT_EXPOSED;

try {
  process.env.CHATCOCKPIT_EXPOSED = "true";

  const operator = operationContextFromRequest({
    id: "request-operator",
    chatCockpitAuth: {
      kind: "operator-session",
      session: { principalId: "owner-principal" }
    }
  });
  assert.equal(operator.actorType, "local-ui");
  assert.equal(operator.actorId, "owner-principal");
  assert.equal(operator.authorizationGrantId, null);
  assert.equal(operator.publicProjection, true);

  const machineBearer = operationContextFromRequest({
    id: "request-machine",
    chatCockpitAuth: {
      kind: "machine-bearer",
      credentialFingerprint: "machine-credential-fingerprint-fixture"
    }
  });
  assert.equal(machineBearer.actorType, "rest-api");
  assert.equal(machineBearer.actorId, "machine-credential-fingerprint-fixture");
  assert.equal(machineBearer.authorizationGrantId, null);

  const mcpOauth = operationContextFromRequest({
    id: "request-mcp",
    chatCockpitAuth: {
      kind: "mcp-oauth",
      authorizationGrantId: "grant-fixture",
      clientRegistrationId: "client-fixture"
    }
  });
  assert.equal(mcpOauth.actorType, "remote-mcp");
  assert.equal(mcpOauth.actorId, "grant-fixture");
  assert.equal(mcpOauth.authorizationGrantId, "grant-fixture");

  const exposedAnonymous = operationContextFromRequest({
    id: "request-exposed-anonymous",
    chatCockpitAuth: { kind: "anonymous" }
  });
  assert.equal(exposedAnonymous.actorType, "rest-api");
  assert.equal(exposedAnonymous.actorId, null);

  process.env.CHATCOCKPIT_EXPOSED = "false";
  const localBootstrap = operationContextFromRequest({
    id: "request-local-bootstrap",
    chatCockpitAuth: { kind: "anonymous" }
  });
  assert.equal(localBootstrap.actorType, "local-ui");
  assert.equal(localBootstrap.actorId, null);

  process.stdout.write("VERIFY_REQUEST_CONTEXT_PROVENANCE_OK\n");
} finally {
  if (previousExposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
  else process.env.CHATCOCKPIT_EXPOSED = previousExposed;
}

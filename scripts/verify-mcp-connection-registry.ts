import assert from "node:assert/strict";

import { McpConnectionRegistry } from "../src/mcp/connection-registry.ts";

const registry = new McpConnectionRegistry();
const startedAt = "2026-09-03T12:00:00.000Z";
const first = registry.begin({
  surface: "core",
  authorizationGrantId: "grant_fixture",
  clientRegistrationId: "client_fixture",
  method: "tools/call",
  toolName: "workspace.read",
  now: startedAt
});
let snapshot = registry.list(startedAt);
assert.equal(snapshot.length, 1);
assert.equal(snapshot[0]?.transportMode, "stateless-http");
assert.equal(snapshot[0]?.transportSessionId, null);
assert.equal(snapshot[0]?.activeRequests, 1);
assert.equal(snapshot[0]?.totalRequests, 1);
assert.equal(snapshot[0]?.lastMethod, "tools/call");
assert.equal(snapshot[0]?.lastToolName, "workspace.read");
assert.equal(snapshot[0]?.state, "active");

first.complete({ now: "2026-09-03T12:00:01.000Z" });
snapshot = registry.list("2026-09-03T12:00:31.000Z");
assert.equal(snapshot[0]?.activeRequests, 0);
assert.equal(snapshot[0]?.state, "idle");

const second = registry.begin({
  surface: "full",
  authorizationGrantId: "grant_fixture",
  clientRegistrationId: "client_fixture",
  transportSessionId: "mcp_session_fixture",
  method: "tools/list",
  now: "2026-09-03T12:01:00.000Z"
});
second.complete({
  transportSessionId: "mcp_session_fixture",
  now: "2026-09-03T12:01:01.000Z"
});
snapshot = registry.list("2026-09-03T12:01:01.000Z");
const sessionful = snapshot.find((entry) => entry.surface === "full");
assert.ok(sessionful);
assert.equal(sessionful.transportMode, "session-http");
assert.equal(sessionful.transportSessionId, "mcp_session_fixture");
assert.equal(sessionful.activeRequests, 0);
assert.equal(sessionful.totalRequests, 1);

const stale = registry.list("2026-09-03T12:06:02.000Z").find((entry) => entry.surface === "full");
assert.equal(stale?.state, "stale");

process.stdout.write("VERIFY_MCP_CONNECTION_REGISTRY_OK\n");

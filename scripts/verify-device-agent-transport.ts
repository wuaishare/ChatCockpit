import assert from "node:assert/strict";

import {
  DEVICE_AGENT_TRANSPORT_MAX_JSON_BYTES,
  DeviceAgentTransportError,
  HttpDeviceAgentTransport
} from "../src/devices/device-agent-transport.js";

interface SeenRequest {
  url: string;
  method: string;
  redirect: RequestRedirect | undefined;
  body: string | null;
  signal: AbortSignal | null;
}

const seen: SeenRequest[] = [];
let mode: "ok" | "redirect" | "problem" | "oversize" = "ok";

const transport = new HttpDeviceAgentTransport({
  fetchImpl: async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    seen.push({
      url,
      method: String(init?.method ?? "GET"),
      redirect: init?.redirect,
      body: init?.body === undefined || init?.body === null ? null : String(init.body),
      signal: init?.signal ?? null
    });
    if (mode === "redirect") {
      return new Response(null, {
        status: 307,
        headers: { location: "https://attacker.example.com/api/devices/heartbeat" }
      });
    }
    if (mode === "problem") {
      return new Response(JSON.stringify({
        ok: false,
        error: { code: "DEVICE_NOT_TRUSTED", message: "unknown or revoked" }
      }), {
        status: 401,
        headers: { "content-type": "application/json" }
      });
    }
    if (mode === "oversize") {
      return new Response(JSON.stringify({ payload: "x".repeat(DEVICE_AGENT_TRANSPORT_MAX_JSON_BYTES + 1024) }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
});

const origin = "https://hub.example.com";
const identityController = new AbortController();
const proofController = new AbortController();
await transport.getHubIdentity(origin, identityController.signal);
await transport.proveHubIdentity(origin, "abcdefghijklmnopqrstuvwx", proofController.signal);
await transport.getLanTlsIdentity(origin, identityController.signal);
await transport.proveLanTlsIdentity(origin, "abcdefghijklmnopqrstuvwx", proofController.signal);
await transport.createEnrollment(origin, { displayName: "MacBook Pro" });
await transport.pollEnrollment(origin, "cc_enroll_abcdefghijklmnopqrstuvwx", { signature: "sig" });
await transport.heartbeat(origin, { deviceId: "cc_device_abcdefghijklmnopqrstuvwx", sequence: 7, signature: "sig" });

assert.deepEqual(
  seen.map((request) => [new URL(request.url).pathname, request.method]),
  [
    ["/api/hub/identity", "GET"],
    ["/api/hub/identity/proof", "POST"],
    ["/api/hub/lan-tls", "GET"],
    ["/api/hub/lan-tls/proof", "POST"],
    ["/api/devices/enrollment-requests", "POST"],
    ["/api/devices/enrollment-requests/cc_enroll_abcdefghijklmnopqrstuvwx/status", "POST"],
    ["/api/devices/heartbeat", "POST"]
  ]
);
assert.equal(seen.every((request) => request.redirect === "manual"), true);
assert.equal(seen.every((request) => new URL(request.url).origin === origin), true);
assert.equal(seen[0]?.signal, identityController.signal);
assert.equal(seen[1]?.signal, proofController.signal);

mode = "redirect";
await assert.rejects(
  transport.heartbeat(origin, { deviceId: "cc_device_abcdefghijklmnopqrstuvwx", sequence: 8, signature: "sig" }),
  (error: unknown) =>
    error instanceof DeviceAgentTransportError &&
    error.code === "DEVICE_AGENT_REDIRECT_REJECTED" &&
    error.statusCode === 307
);

mode = "problem";
await assert.rejects(
  transport.heartbeat(origin, { deviceId: "cc_device_abcdefghijklmnopqrstuvwx", sequence: 9, signature: "sig" }),
  (error: unknown) =>
    error instanceof DeviceAgentTransportError &&
    error.code === "DEVICE_NOT_TRUSTED" &&
    error.statusCode === 401
);

mode = "oversize";
await assert.rejects(
  transport.getHubIdentity(origin),
  (error: unknown) =>
    error instanceof DeviceAgentTransportError &&
    error.code === "DEVICE_AGENT_RESPONSE_TOO_LARGE"
);

const networkTransport = new HttpDeviceAgentTransport({
  fetchImpl: async () => {
    throw new Error("connection refused");
  }
});
await assert.rejects(
  networkTransport.getHubIdentity(origin),
  (error: unknown) =>
    error instanceof DeviceAgentTransportError &&
    error.code === "DEVICE_AGENT_NETWORK_ERROR" &&
    error.statusCode === null
);

process.stdout.write("VERIFY_DEVICE_AGENT_TRANSPORT_OK\n");

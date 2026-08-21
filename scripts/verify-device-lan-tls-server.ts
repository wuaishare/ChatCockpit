import assert from "node:assert/strict";
import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { readLanTlsIdentity } from "../src/devices/lan-tls-identity.js";
import { updateAccessPolicy } from "../src/security/access-policy.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

async function reservePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function requestPinned(
  port: number,
  certificatePem: string,
  pathname: string,
  method: "GET" | "POST",
  body?: string
): Promise<{ statusCode: number; body: string; authorized: boolean }> {
  return await new Promise((resolve, reject) => {
    const request = https.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method,
      ca: certificatePem,
      rejectUnauthorized: true,
      checkServerIdentity: () => undefined,
      headers: body
        ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
        : undefined
    }, (response) => {
      const authorized = Boolean(response.socket.authorized);
      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        body: data,
        authorized
      }));
    });
    request.once("error", reject);
    if (body) request.end(body);
    else request.end();
  });
}

async function connectionFails(port: number, certificatePem: string): Promise<boolean> {
  try {
    await requestPinned(port, certificatePem, "/api/devices/heartbeat", "POST", "{}");
    return false;
  } catch {
    return true;
  }
}

async function waitForLanTlsIdentity(runtimeDir: string): Promise<NonNullable<ReturnType<typeof readLanTlsIdentity>>> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const identity = readLanTlsIdentity(runtimeDir);
    if (identity) return identity;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("LAN TLS identity was not initialized within the expected startup window");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-lan-tls-server-"));
const repoRoot = path.join(root, "repo");
fs.mkdirSync(repoRoot, { recursive: true });
fs.writeFileSync(path.join(repoRoot, "README.md"), "# LAN TLS server fixture\n", "utf8");
const paths = buildFixturePaths(repoRoot);
ensureWorkspaceDirs(paths);
updateAccessPolicy(paths, {
  consolePathPrefix: "/ops-lan-tls-server",
  trustedLan: { enabled: true, cidrs: ["fd00:db8:1::/64"] }
});

const securePort = await reservePort();
const app = buildServer(paths, {
  deviceLanTls: { host: "127.0.0.1", port: securePort }
});

try {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const tlsIdentity = await waitForLanTlsIdentity(paths.runtimeDir);

  const heartbeat = await requestPinned(
    securePort,
    tlsIdentity.certificatePem,
    "/api/devices/heartbeat",
    "POST",
    JSON.stringify({ deviceId: "invalid", sequence: 1, signature: "invalid" })
  );
  assert.equal(heartbeat.authorized, true, "exact certificate CA pinning must authorize the LAN TLS listener");
  assert.equal(heartbeat.statusCode, 400, heartbeat.body);
  assert.equal(
    (JSON.parse(heartbeat.body) as { error?: { code?: string } }).error?.code,
    "DEVICE_NOT_TRUSTED"
  );

  const ownerSurface = await requestPinned(
    securePort,
    tlsIdentity.certificatePem,
    "/api/devices",
    "GET"
  );
  assert.equal(ownerSurface.statusCode, 404, "LAN TLS listener must expose only Device Agent protocol routes");

  await app.close();
  assert.equal(
    await connectionFails(securePort, tlsIdentity.certificatePem),
    true,
    "closing the primary Control Plane must also close the auxiliary LAN TLS listener"
  );

  process.stdout.write("VERIFY_DEVICE_LAN_TLS_SERVER_OK\n");
} finally {
  if (app.server.listening) await app.close().catch(() => undefined);
  fs.rmSync(root, { recursive: true, force: true });
}

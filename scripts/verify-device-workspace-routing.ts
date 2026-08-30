import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildOperationContext } from "../src/application/operation-context.js";
import { ServiceError } from "../src/application/service-error.js";
import { DeviceTargetService } from "../src/application/device-target-service.js";
import { DeviceWorkspaceRoutingService } from "../src/application/device-workspace-routing-service.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { DeviceAgentCapabilityService } from "../src/devices/device-agent-capability-service.js";
import {
  DeviceAgentWorkspaceService,
  projectDeviceWorkspaceError
} from "../src/devices/device-agent-workspace-service.js";
import { DeviceCapabilityRpc, DeviceCapabilityRpcError } from "../src/devices/device-capability-rpc.js";
import { DeviceChannelHub } from "../src/devices/device-channel.js";
import type {
  ManagedDeviceProjection,
  ManagedDeviceRecord
} from "../src/devices/device-registry.js";
import { LOCAL_DEVICE_TARGET_ID } from "../src/devices/local-device.js";
import { resolveMcpToolDeviceTarget } from "../src/mcp/device-target-policy.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";
import { runGit } from "./test-support/git.ts";

const now = "2026-08-30T00:30:00.000Z";
const remoteV4Id = `cc_device_${"W".repeat(24)}`;
const remoteV3Id = `cc_device_${"L".repeat(24)}`;

function deviceRecord(id: string, displayName: string): ManagedDeviceRecord {
  return {
    id,
    displayName,
    platform: "darwin",
    architecture: "arm64",
    publicKeySpki: `private-${id}`,
    publicKeyFingerprint: `fingerprint-${id}`,
    pairedAt: "2026-08-29T23:00:00.000Z",
    lastSeenAt: "2026-08-30T00:29:55.000Z",
    revokedAt: null,
    pausedAt: null,
    executionPolicyRevision: 1,
    lastSequence: 4,
    revision: 1
  };
}

class FakeRegistry {
  private readonly records = new Map<string, ManagedDeviceRecord>([
    [remoteV4Id, deviceRecord(remoteV4Id, "Workspace v4 Mac")],
    [remoteV3Id, deviceRecord(remoteV3Id, "Legacy v3 Mac")]
  ]);

  getDevice(deviceId: string): ManagedDeviceRecord | null {
    const record = this.records.get(deviceId);
    return record ? { ...record } : null;
  }

  listDevices(_now: string): ManagedDeviceProjection[] {
    return [...this.records.values()].map((device) => ({
      id: device.id,
      kind: "device" as const,
      locality: "remote" as const,
      displayName: device.displayName,
      platform: device.platform,
      architecture: device.architecture,
      publicKeyFingerprint: device.publicKeyFingerprint,
      pairedAt: device.pairedAt,
      lastSeenAt: device.lastSeenAt,
      revokedAt: null,
      pausedAt: null,
      executionPolicyRevision: 1,
      revision: 1,
      trust: "paired" as const,
      presence: "online" as const,
      executionPolicy: "active" as const,
      management: { heartbeat: true as const, remoteControl: false as const }
    }));
  }
}

function capabilityRequest(
  operation: "workspace.read.invoke",
  payload: unknown
) {
  return {
    protocolVersion: 1 as const,
    requestId: "cc_device_request_workspacefixture1234",
    operation,
    issuedAt: "2026-08-30T00:29:59.000Z",
    expiresAt: "2026-08-30T00:30:30.000Z",
    payload
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-workspace-routing-"));
const paths = buildFixturePaths(root);
ensureWorkspaceDirs(paths);
fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.writeFileSync(path.join(root, "README.md"), "# Device Workspace\n", "utf8");
fs.writeFileSync(
  path.join(root, "src", "fixture.ts"),
  "export const remoteWorkspaceNeedle = 'workspace-v4';\n",
  "utf8"
);
fs.writeFileSync(path.join(root, ".env"), "SECRET=must-not-cross-device\n", "utf8");
runGit(root, ["init"]);
runGit(root, ["config", "user.email", "device-workspace@example.invalid"]);
runGit(root, ["config", "user.name", "Device Workspace Test"]);
runGit(root, ["add", "README.md", "src/fixture.ts"]);
runGit(root, ["commit", "-m", "init"]);

const configPath = path.join(paths.runtimeDir, "device-workspace-config.json");
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
const originalConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
process.env.CHATCOCKPIT_CONFIG_PATH = configPath;

const channels = new DeviceChannelHub();
const targets = new DeviceTargetService(new FakeRegistry(), channels, null);
const rpc = new DeviceCapabilityRpc(channels, {
  requestTimeoutMs: 1_000,
  now: () => now
});
const context = buildOperationContext({
  requestId: "device-workspace-routing",
  actorType: "remote-mcp",
  actorId: "fixture-client",
  authorizationGrantId: "cc_grant_device_workspace_fixture_123456",
  publicProjection: true,
  now
});

let v4Registration: ReturnType<DeviceChannelHub["register"]> | null = null;
let v3Registration: ReturnType<DeviceChannelHub["register"]> | null = null;

try {
  const localWorkspace = new DeviceAgentWorkspaceService(paths);
  const listed = localWorkspace.execute("workspace-list", {
    action: "workspaces.list",
    params: {}
  }) as {
    ok: true;
    pathVisibility: "hidden";
    workspaces: Array<{
      repoId: string;
      displayName: string;
      defaultRepo: boolean;
      access: string;
      pathVisibility: "hidden";
    }>;
  };
  assert.equal(listed.ok, true);
  assert.equal(listed.pathVisibility, "hidden");
  assert.equal(listed.workspaces.length, 1);
  assert.equal(listed.workspaces[0]?.repoId, "primary");
  assert.equal(listed.workspaces[0]?.defaultRepo, true);
  assert.equal(listed.workspaces[0]?.pathVisibility, "hidden");
  assert.equal(JSON.stringify(listed).includes(root), false, "Workspace catalog must hide absolute paths");

  const read = localWorkspace.execute("workspace-read", {
    action: "files.read",
    params: { repoId: "primary", path: "README.md" }
  }) as { file: { path: string; content: string } };
  assert.equal(read.file.path, "README.md");
  assert.match(read.file.content, /Device Workspace/);

  const directory = localWorkspace.execute("workspace-list-files", {
    action: "files.list",
    params: { repoId: "primary", path: "." }
  }) as { entries: Array<{ name: string }> };
  assert.equal(directory.entries.some((entry) => entry.name === ".env"), false);

  const search = localWorkspace.execute("workspace-search", {
    action: "search.code",
    params: { repoId: "primary", pattern: "remoteWorkspaceNeedle", path: "src" }
  }) as { matches: Array<{ path: string; content: string }> };
  assert.equal(search.matches.length, 1);
  assert.equal(search.matches[0]?.path, "src/fixture.ts");

  const cleanStatus = localWorkspace.execute("workspace-git-status", {
    action: "git.status",
    params: { repoId: "primary" }
  }) as { entries: Array<{ path: string; status: string; staged: boolean }> };
  assert.deepEqual(cleanStatus.entries, [
    { path: ".env", status: "blocked", staged: false }
  ]);
  fs.appendFileSync(path.join(root, "README.md"), "changed\n", "utf8");
  const dirtyStatus = localWorkspace.execute("workspace-git-status-dirty", {
    action: "git.status",
    params: { repoId: "primary" }
  }) as { entries: Array<{ path: string }> };
  assert.equal(dirtyStatus.entries.some((entry) => entry.path === "README.md"), true);
  const diff = localWorkspace.execute("workspace-git-diff", {
    action: "git.diff",
    params: { repoId: "primary" }
  }) as { diff: string };
  assert.match(diff.diff, /changed/);

  assert.throws(
    () => localWorkspace.execute("workspace-secret-read", {
      action: "files.read",
      params: { repoId: "primary", path: ".env" }
    }),
    (error: unknown) => {
      const projected = projectDeviceWorkspaceError(error);
      assert.equal(projected.code, "FILES_READ_BLOCKED");
      assert.equal(projected.message.includes(root), false);
      assert.equal(projected.message.includes("must-not-cross-device"), false);
      return true;
    }
  );

  const workspaceCapability = new DeviceAgentCapabilityService({
    runtimeDir: paths.runtimeDir,
    paths,
    now: () => now
  });
  const workspaceCapabilityResult = await workspaceCapability.execute(
    capabilityRequest("workspace.read.invoke", {
      action: "files.read",
      params: { repoId: "primary", path: "README.md" }
    })
  );
  assert.equal(workspaceCapabilityResult.outcome, "ok");
  assert.equal(JSON.stringify(workspaceCapabilityResult).includes(root), false);

  const unsupportedAction = await workspaceCapability.execute(
    capabilityRequest("workspace.read.invoke", {
      action: "files.write",
      params: { repoId: "primary", path: "README.md", content: "no" }
    })
  );
  assert.equal(unsupportedAction.outcome, "error");
  if (unsupportedAction.outcome === "error") {
    assert.equal(unsupportedAction.error.code, "DEVICE_WORKSPACE_ACTION_UNSUPPORTED");
  }

  const oversizedSingleRead = await workspaceCapability.execute(
    capabilityRequest("workspace.read.invoke", {
      action: "files.read",
      params: { repoId: "primary", path: "README.md", limit: 64 * 1024 + 1 }
    })
  );
  assert.equal(oversizedSingleRead.outcome, "error");
  if (oversizedSingleRead.outcome === "error") {
    assert.equal(oversizedSingleRead.error.code, "DEVICE_WORKSPACE_ARGUMENTS_INVALID");
  }
  const oversizedBatchRead = await workspaceCapability.execute(
    capabilityRequest("workspace.read.invoke", {
      action: "files.readBatch",
      params: { repoId: "primary", paths: ["README.md"], limit: 16 * 1024 + 1 }
    })
  );
  assert.equal(oversizedBatchRead.outcome, "error");
  if (oversizedBatchRead.outcome === "error") {
    assert.equal(oversizedBatchRead.error.code, "DEVICE_WORKSPACE_ARGUMENTS_INVALID");
  }

  const noWorkspaceCapability = new DeviceAgentCapabilityService({
    runtimeDir: paths.runtimeDir,
    now: () => now
  });
  const unavailable = await noWorkspaceCapability.execute(
    capabilityRequest("workspace.read.invoke", {
      action: "workspaces.list",
      params: {}
    })
  );
  assert.equal(unavailable.outcome, "error");
  if (unavailable.outcome === "error") {
    assert.equal(unavailable.error.code, "DEVICE_WORKSPACE_RPC_UNSUPPORTED");
  }

  const dispatched: Array<{ operation: string; payload: unknown }> = [];
  v4Registration = channels.register(remoteV4Id, () => undefined, {
    protocolVersion: 4,
    send: (_event, raw) => {
      const envelope = raw as {
        requestId: string;
        operation: string;
        payload: unknown;
      };
      dispatched.push({
        operation: envelope.operation,
        payload: structuredClone(envelope.payload)
      });
      queueMicrotask(() => {
        rpc.acceptResult({
          deviceId: remoteV4Id,
          channelId: v4Registration!.channelId,
          body: {
            requestId: envelope.requestId,
            outcome: "ok",
            result: {
              ok: true,
              pathVisibility: "hidden",
              workspaces: [{ repoId: "remote-primary", pathVisibility: "hidden" }]
            }
          }
        });
      });
      return true;
    }
  });
  v3Registration = channels.register(remoteV3Id, () => undefined, {
    protocolVersion: 3,
    send: () => true
  });

  const routing = new DeviceWorkspaceRoutingService(paths, targets, rpc);
  const localEnvelope = await routing.invoke(context, {
    targetDevice: LOCAL_DEVICE_TARGET_ID,
    action: "files.read",
    params: { repoId: "primary", path: "README.md" }
  });
  assert.equal(localEnvelope.ok, true);
  assert.equal(localEnvelope.action, "files.read");
  assert.equal(localEnvelope.target.id, LOCAL_DEVICE_TARGET_ID);
  assert.equal(localEnvelope.target.locality, "local");
  assert.equal(JSON.stringify(localEnvelope).includes(root), false);

  const remoteEnvelope = await routing.invoke(context, {
    targetDevice: remoteV4Id,
    action: "workspaces.list",
    params: {}
  });
  assert.equal(remoteEnvelope.ok, true);
  assert.equal(remoteEnvelope.action, "workspaces.list");
  assert.equal(remoteEnvelope.target.id, remoteV4Id);
  assert.equal(remoteEnvelope.target.locality, "remote");
  assert.equal(
    (remoteEnvelope.result as { pathVisibility?: string }).pathVisibility,
    "hidden"
  );
  assert.deepEqual(dispatched, [
    {
      operation: "workspace.read.invoke",
      payload: { action: "workspaces.list", params: {} }
    }
  ]);
  assert.equal(JSON.stringify(dispatched).includes("targetDevice"), false);

  await assert.rejects(
    routing.invoke(context, {
      targetDevice: remoteV3Id,
      action: "workspaces.list",
      params: {}
    }),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "DEVICE_WORKSPACE_RPC_UNSUPPORTED"
  );
  await assert.rejects(
    rpc.request(remoteV3Id, "workspace.read.invoke", {
      action: "workspaces.list",
      params: {}
    }),
    (error: unknown) =>
      error instanceof DeviceCapabilityRpcError &&
      error.code === "DEVICE_WORKSPACE_RPC_UNSUPPORTED"
  );

  assert.equal(
    resolveMcpToolDeviceTarget(
      "chatcockpit.devices.workspace.invoke",
      { targetDevice: remoteV4Id, action: "workspaces.list", params: {} }
    ),
    remoteV4Id
  );
  assert.equal(
    resolveMcpToolDeviceTarget(
      "chatcockpit.devices.workspace.invoke",
      { targetDevice: LOCAL_DEVICE_TARGET_ID, action: "workspaces.list", params: {} }
    ),
    LOCAL_DEVICE_TARGET_ID
  );

  const publicProjection = JSON.stringify({
    listed,
    read,
    directory,
    search,
    remoteEnvelope,
    dispatched
  });
  assert.equal(publicProjection.includes(root), false);
  assert.equal(publicProjection.includes("must-not-cross-device"), false);

  process.stdout.write("VERIFY_DEVICE_WORKSPACE_ROUTING_OK\n");
} finally {
  v4Registration?.dispose();
  v3Registration?.dispose();
  rpc.close();
  channels.closeAll();
  if (originalConfigPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
  else process.env.CHATCOCKPIT_CONFIG_PATH = originalConfigPath;
  fs.rmSync(root, { recursive: true, force: true });
}

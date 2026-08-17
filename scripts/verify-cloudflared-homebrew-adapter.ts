import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CloudflaredHomebrewAdapter,
  type ConnectivityMachineCommandRunner,
  type ConnectivityMachineCommandResult
} from "../src/connectivity/cloudflared-homebrew-adapter.js";
import type { ConnectivityProbeCommandRunner } from "../src/connectivity/provider-probe.js";

interface FakeMachineState {
  brewAvailable: boolean;
  cloudflaredVersion: string | null;
  failNextMutation: boolean;
  mutationCalls: Array<{ command: string; args: string[] }>;
}

function commandResult(
  kind: ConnectivityMachineCommandResult["kind"],
  status: number | null,
  stdout = "",
  stderr = ""
): ConnectivityMachineCommandResult {
  return { kind, status, stdout, stderr };
}

function createFakeRunners(state: FakeMachineState): {
  probeRunner: ConnectivityProbeCommandRunner;
  machineRunner: ConnectivityMachineCommandRunner;
} {
  return {
    probeRunner: {
      run(command, args) {
        assert.equal(command, "cloudflared");
        assert.deepEqual([...args], ["--version"]);
        if (!state.cloudflaredVersion) {
          return { kind: "not-found", status: null, stdout: "", stderr: "" };
        }
        return {
          kind: "completed",
          status: 0,
          stdout: `cloudflared version ${state.cloudflaredVersion}`,
          stderr: ""
        };
      }
    },
    machineRunner: {
      run(command, args) {
        if (
          (command === "/opt/homebrew/bin/brew" || command === "/usr/local/bin/brew") &&
          args.length === 1 &&
          args[0] === "--version"
        ) {
          return state.brewAvailable && command === "/opt/homebrew/bin/brew"
            ? commandResult("completed", 0, "Homebrew 5.2.0")
            : commandResult("not-found", null);
        }
        state.mutationCalls.push({ command, args: [...args] });
        if (state.failNextMutation) {
          state.failNextMutation = false;
          return commandResult(
            "failed",
            1,
            "",
            "raw-homebrew-stderr-must-never-leak"
          );
        }
        assert.equal(command, "/opt/homebrew/bin/brew");
        const action = args[0];
        assert.equal(args[1], "cloudflared");
        if (action === "install") state.cloudflaredVersion = "2026.7.3";
        if (action === "upgrade") state.cloudflaredVersion = "2026.8.1";
        if (action === "uninstall") state.cloudflaredVersion = null;
        return commandResult("completed", 0, "brew output that must stay private", "");
      }
    }
  };
}

function main(): void {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-cloudflared-adapter-"));
  const runtimeDir = path.join(sandbox, "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const state: FakeMachineState = {
    brewAvailable: true,
    cloudflaredVersion: null,
    failNextMutation: false,
    mutationCalls: []
  };
  const { probeRunner, machineRunner } = createFakeRunners(state);
  let clock = Date.parse("2026-08-17T12:30:00.000Z");
  let nextPlan = 1;
  const adapter = new CloudflaredHomebrewAdapter({
    runtimeDir,
    probeRunner,
    machineRunner,
    now: () => new Date(clock).toISOString(),
    createPlanId: () => `plan-${nextPlan++}`
  });

  try {
    const initial = adapter.capabilities();
    assert.equal(initial.providerId, "cloudflare-tunnel");
    assert.equal(initial.packageManager, "homebrew");
    assert.equal(initial.detection, "not-detected");
    assert.equal(initial.version, null);
    assert.equal(initial.managedByChatCockpit, false);
    assert.deepEqual(initial.actions, [
      { action: "install", available: true, reason: null },
      { action: "upgrade", available: false, reason: "provider-not-detected" },
      { action: "uninstall", available: false, reason: "provider-not-detected" }
    ]);

    const installPlan = adapter.prepare("install");
    assert.equal(installPlan.planId, "plan-1");
    assert.equal(installPlan.action, "install");
    assert.equal(installPlan.requiresConfirmation, true);
    assert.equal(installPlan.changesPublicRoute, false);
    assert.equal(installPlan.startsTunnel, false);
    assert.equal(installPlan.startsRuntime, false);
    assert.equal(installPlan.expectedDetection, "not-detected");
    assert.equal(installPlan.expectedVersion, null);
    assert.equal(installPlan.expectedManagedByChatCockpit, false);
    assert.deepEqual(state.mutationCalls, []);

    const planPath = path.join(runtimeDir, "connectivity-provider-plans", "plan-1.json");
    assert.equal(fs.existsSync(planPath), true);
    assert.equal(fs.statSync(planPath).mode & 0o777, 0o600);

    const installed = adapter.execute("plan-1");
    assert.equal(installed.outcome, "succeeded");
    assert.equal(installed.action, "install");
    assert.equal(installed.before.detection, "not-detected");
    assert.equal(installed.after.detection, "detected");
    assert.equal(installed.after.version, "2026.7.3");
    assert.equal(installed.after.managedByChatCockpit, true);
    assert.deepEqual(state.mutationCalls, [
      { command: "/opt/homebrew/bin/brew", args: ["install", "cloudflared"] }
    ]);
    assert.equal(fs.existsSync(planPath), false);
    assert.throws(() => adapter.execute("plan-1"), /not available/);

    const ownershipPath = path.join(runtimeDir, "connectivity-provider-ownership.json");
    assert.equal(fs.existsSync(ownershipPath), true);
    assert.equal(fs.statSync(ownershipPath).mode & 0o777, 0o600);
    const ownershipText = fs.readFileSync(ownershipPath, "utf8");
    assert.doesNotMatch(ownershipText, /stdout|stderr|executable|raw-homebrew/);

    const managed = adapter.capabilities();
    assert.equal(managed.detection, "detected");
    assert.equal(managed.managedByChatCockpit, true);
    assert.deepEqual(managed.actions, [
      { action: "install", available: false, reason: "provider-already-detected" },
      { action: "upgrade", available: true, reason: null },
      { action: "uninstall", available: true, reason: null }
    ]);

    const upgradePlan = adapter.prepare("upgrade");
    const upgraded = adapter.execute(upgradePlan.planId);
    assert.equal(upgraded.outcome, "succeeded");
    assert.equal(upgraded.after.version, "2026.8.1");
    assert.equal(upgraded.after.managedByChatCockpit, true);

    const uninstallPlan = adapter.prepare("uninstall");
    const uninstalled = adapter.execute(uninstallPlan.planId);
    assert.equal(uninstalled.outcome, "succeeded");
    assert.equal(uninstalled.after.detection, "not-detected");
    assert.equal(uninstalled.after.managedByChatCockpit, false);

    state.cloudflaredVersion = "2026.8.9";
    const external = adapter.capabilities();
    assert.equal(external.managedByChatCockpit, false);
    assert.deepEqual(external.actions, [
      { action: "install", available: false, reason: "provider-already-detected" },
      { action: "upgrade", available: false, reason: "provider-not-managed" },
      { action: "uninstall", available: false, reason: "provider-not-managed" }
    ]);
    assert.throws(() => adapter.prepare("upgrade"), /provider-not-managed/);
    assert.throws(() => adapter.prepare("uninstall"), /provider-not-managed/);

    state.cloudflaredVersion = null;
    const failedPlan = adapter.prepare("install");
    state.failNextMutation = true;
    const failed = adapter.execute(failedPlan.planId);
    assert.equal(failed.outcome, "command-failed");
    assert.equal(failed.after.detection, "not-detected");
    assert.equal(failed.after.managedByChatCockpit, false);
    assert.doesNotMatch(JSON.stringify(failed), /raw-homebrew-stderr-must-never-leak/);

    const stalePlan = adapter.prepare("install");
    state.cloudflaredVersion = "2026.9.0";
    const mutationsBeforeStale = state.mutationCalls.length;
    assert.throws(() => adapter.execute(stalePlan.planId), /stale/);
    assert.equal(state.mutationCalls.length, mutationsBeforeStale);
    assert.equal(
      fs.existsSync(path.join(runtimeDir, "connectivity-provider-plans", `${stalePlan.planId}.json`)),
      false
    );

    state.cloudflaredVersion = null;
    state.brewAvailable = false;
    const noBrew = adapter.capabilities();
    assert.deepEqual(noBrew.actions, [
      { action: "install", available: false, reason: "homebrew-not-detected" },
      { action: "upgrade", available: false, reason: "homebrew-not-detected" },
      { action: "uninstall", available: false, reason: "homebrew-not-detected" }
    ]);

    let intelVersion: string | null = null;
    const intelMutationCalls: Array<{ command: string; args: string[] }> = [];
    const intelAdapter = new CloudflaredHomebrewAdapter({
      runtimeDir: path.join(sandbox, "intel-runtime"),
      probeRunner: {
        run(command, args) {
          assert.equal(command, "cloudflared");
          assert.deepEqual([...args], ["--version"]);
          return intelVersion
            ? commandResult("completed", 0, `cloudflared version ${intelVersion}`)
            : commandResult("not-found", null);
        }
      },
      machineRunner: {
        run(command, args) {
          if (args.length === 1 && args[0] === "--version") {
            return command === "/usr/local/bin/brew"
              ? commandResult("completed", 0, "Homebrew 5.2.0")
              : commandResult("not-found", null);
          }
          intelMutationCalls.push({ command, args: [...args] });
          assert.equal(command, "/usr/local/bin/brew");
          assert.deepEqual([...args], ["install", "cloudflared"]);
          intelVersion = "2026.8.4";
          return commandResult("completed", 0);
        }
      },
      now: () => new Date(clock).toISOString(),
      createPlanId: () => "intel-plan"
    });
    assert.equal(intelAdapter.capabilities().actions[0]?.available, true);
    const intelPlan = intelAdapter.prepare("install");
    assert.equal(intelAdapter.execute(intelPlan.planId).outcome, "succeeded");
    assert.deepEqual(intelMutationCalls, [
      { command: "/usr/local/bin/brew", args: ["install", "cloudflared"] }
    ]);

    clock += 10 * 60 * 1000;
    state.brewAvailable = true;
    const expiring = adapter.prepare("install");
    clock += 10 * 60 * 1000;
    assert.throws(() => adapter.execute(expiring.planId), /expired/);

    process.stdout.write("VERIFY_CLOUDFLARED_HOMEBREW_ADAPTER_OK\n");
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main();

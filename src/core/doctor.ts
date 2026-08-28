import fs from "node:fs";
import path from "node:path";

import { buildOAuthReadiness } from "../auth/oauth-readiness.js";
import type { TokenPilotDistributionContext } from "../types.js";
import { buildSourceDistributionContext } from "./distribution-context.js";
import { productIdentityForKey } from "./product-identity.js";
import { runCommand } from "./shell.js";
import { buildPaths, ensureWorkspaceDirs } from "./paths.js";
import { listJobs } from "./jobs.js";
import { resolveCodexBinary } from "../runtime/codex/binary.js";
import {
  assessCodexStandaloneSnapshot,
  CodexStandaloneCapabilityStore
} from "../runtime/codex/standalone-capabilities.js";

export type DoctorCheckImpact = "runtime-blocking" | "capability" | "informational";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  impact: DoctorCheckImpact;
}

export interface DoctorResult {
  ok: boolean;
  summary: string;
  checks: DoctorCheck[];
  fixes: string[];
}

export interface RunDoctorOptions {
  fix?: boolean;
  context?: TokenPilotDistributionContext;
}

function commandDetail(stdout: string, stderr: string): string {
  return stdout.trim() || stderr.trim() || "Command is unavailable.";
}

export function buildCodexStandaloneDoctorCheck(
  runtimeDir: string,
  currentBinary: { source: string | null; version: string | null }
): DoctorCheck {
  const snapshot = new CodexStandaloneCapabilityStore(runtimeDir).read();
  const status = assessCodexStandaloneSnapshot(snapshot, currentBinary);
  const commandExec = snapshot?.operations["command.exec"];
  const ready = Boolean(
    status.state === "ready" &&
      snapshot?.directExecutionReady &&
      !snapshot.turnStartObserved &&
      commandExec?.status === "verified" &&
      commandExec.safeForChatDirect
  );
  if (ready && snapshot) {
    return {
      name: "chat-direct-native-managed-exec",
      ok: true,
      detail: `ready binary=${snapshot.binaryVersion ?? "unknown"} probedAt=${snapshot.probedAt}`,
      impact: "capability"
    };
  }
  return {
    name: "chat-direct-native-managed-exec",
    ok: false,
    detail: snapshot
      ? `native managed execution unavailable: snapshot=${status.state} reason=${status.reason ?? "none"} currentBinary=${currentBinary.version ?? "unknown"} command.exec=${commandExec?.status ?? "unknown"} error=${commandExec?.errorCode ?? "unknown"}; workspace.exec can use the explicit governed built-in fallback for trusted tasks that allow network access.`
      : `Native managed execution capability snapshot is unavailable for currentBinary=${currentBinary.version ?? "unknown"}; workspace.exec can use the explicit governed built-in fallback for trusted tasks that allow network access.`,
    impact: "capability"
  };
}

export function runDoctor(
  repoRoot: string,
  options: RunDoctorOptions = {}
): DoctorResult {
  const checks: DoctorCheck[] = [];
  const fixes: string[] = [];
  const context = options.context ?? buildSourceDistributionContext(repoRoot);
  const paths = buildPaths(context);
  const packaged = context.mode === "packaged";
  const identity = productIdentityForKey(context.productIdentity);

  if (options.fix) {
    ensureWorkspaceDirs(paths);
    fixes.push(
      packaged
        ? "ensured packaged runtime state directories"
        : `ensured runtime directories under ${path.relative(repoRoot, paths.workspaceDir)}`
    );
  }

  const git = runCommand("git", ["rev-parse", "--show-toplevel"], paths.repoRoot);
  checks.push({
    name: packaged ? "git-capability" : "git",
    ok: git.exitCode === 0,
    detail: commandDetail(git.stdout, git.stderr),
    impact: packaged ? "capability" : "runtime-blocking"
  });

  const node = packaged
    ? runCommand(paths.nodeExecutable, ["--version"], paths.installRoot)
    : runCommand("node", ["--version"], paths.installRoot);
  checks.push({
    name: "node",
    ok: node.exitCode === 0,
    detail:
      node.exitCode === 0
        ? `${packaged ? "bundled " : ""}${node.stdout.trim()}`
        : commandDetail(node.stdout, node.stderr),
    impact: "runtime-blocking"
  });

  const npm = runCommand("npm", ["--version"], paths.installRoot);
  checks.push({
    name: packaged ? "npm-capability" : "npm",
    ok: npm.exitCode === 0,
    detail: commandDetail(npm.stdout, npm.stderr),
    impact: packaged ? "capability" : "runtime-blocking"
  });

  const python = runCommand("python3", ["--version"], paths.installRoot);
  checks.push({
    name: packaged ? "python3-capability" : "python3",
    ok: python.exitCode === 0,
    detail: commandDetail(python.stdout, python.stderr),
    impact: packaged ? "capability" : "runtime-blocking"
  });

  checks.push({
    name: "bundle-engine",
    ok: true,
    detail: `${identity.displayName} internal XML bundle generator`,
    impact: "informational"
  });

  let currentCodexBinary = { source: null as string | null, version: null as string | null };
  try {
    const resolvedCodexBinary = resolveCodexBinary();
    currentCodexBinary = {
      source: resolvedCodexBinary.source,
      version: resolvedCodexBinary.version
    };
  } catch {
    // Keep a public-safe unavailable identity; the capability check below will
    // report the native managed execution path as unavailable.
  }
  checks.push(
    buildCodexStandaloneDoctorCheck(paths.runtimeDir, currentCodexBinary)
  );

  const oauth = buildOAuthReadiness(paths);
  checks.push({
    name: "chatgpt-mcp-oauth",
    ok: !oauth.required || oauth.ready,
    detail:
      oauth.status === "ready"
        ? `ready metadata=${oauth.protectedResourceMetadataUrl}`
        : oauth.detail,
    impact: "runtime-blocking"
  });

  const jobs = listJobs(paths);
  const queued = jobs.filter((job) => job.status === "queued").length;
  const running = jobs.filter((job) => job.status === "running").length;
  const completed = jobs.filter((job) => job.status === "completed").length;
  const failed = jobs.filter((job) => job.status === "failed").length;
  checks.push({
    name: "job-queue",
    ok: true,
    detail: `queued=${queued} running=${running} completed=${completed} failed=${failed}`,
    impact: "informational"
  });

  const runnerStatusPath = paths.runnerStatusPath;
  if (fs.existsSync(runnerStatusPath)) {
    const raw = fs.readFileSync(runnerStatusPath, "utf8");
    checks.push({
      name: "runner-status",
      ok: true,
      detail: raw.trim(),
      impact: "runtime-blocking"
    });
  } else {
    checks.push({
      name: "runner-status",
      ok: false,
      detail: `Missing ${runnerStatusPath}`,
      impact: "runtime-blocking"
    });
  }

  const supervisorConfigured =
    fs.existsSync(paths.processSupervisorStatusPath) ||
    fs.existsSync(paths.processSupervisorPlistPath);
  if (!supervisorConfigured) {
    checks.push({
      name: "process-supervisor-status",
      ok: true,
      detail: "Process Supervisor is not configured in this local runtime yet.",
      impact: "runtime-blocking"
    });
  } else if (fs.existsSync(paths.processSupervisorStatusPath)) {
    try {
      const status = JSON.parse(
        fs.readFileSync(paths.processSupervisorStatusPath, "utf8")
      ) as {
        state?: unknown;
        ownedProcessCount?: unknown;
        protocolVersion?: unknown;
      };
      const ready = status.state === "ready";
      checks.push({
        name: "process-supervisor-status",
        ok: ready,
        detail: `state=${String(status.state)} owned=${String(
          status.ownedProcessCount ?? "unknown"
        )} protocol=${String(status.protocolVersion ?? "unknown")}`,
        impact: "runtime-blocking"
      });
    } catch {
      checks.push({
        name: "process-supervisor-status",
        ok: false,
        detail: "Process Supervisor status file is invalid.",
        impact: "runtime-blocking"
      });
    }
  } else {
    checks.push({
      name: "process-supervisor-status",
      ok: false,
      detail: "Process Supervisor is configured but has not reported status.",
      impact: "runtime-blocking"
    });
  }

  const runtimeBlockingChecks = checks.filter((check) => check.impact === "runtime-blocking");
  const runtimeReady = runtimeBlockingChecks.every((check) => check.ok);
  const capabilityNeedsAttention = checks.some(
    (check) => check.impact === "capability" && !check.ok
  );
  const summary = runtimeReady
    ? capabilityNeedsAttention
      ? `${identity.displayName} runtime is ready; optional capabilities need attention.`
      : `${identity.displayName} local prerequisites look ready.`
    : `${identity.displayName} needs attention before the local workflow is fully ready.`;

  return {
    ok: runtimeReady,
    summary,
    checks,
    fixes
  };
}

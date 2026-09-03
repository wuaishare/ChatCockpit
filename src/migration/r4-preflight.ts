import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { inspectR4LegacyContinuitySource, type R4LegacyContinuitySourceContract } from "./r4-legacy-continuity.js";
import { buildRenameMigrationPreview } from "./rename-preview.js";
import type { RenameStateEntryClass } from "./rename-types.js";

const GIB = 1024 * 1024 * 1024;

export interface R4ServiceIdentityState {
  loaded: boolean;
  running: boolean;
}

export interface R4ServiceProbeResult {
  supported: boolean;
  old: {
    controlPlane: R4ServiceIdentityState;
    runner: R4ServiceIdentityState;
    processSupervisor: R4ServiceIdentityState;
  };
  target: {
    controlPlane: R4ServiceIdentityState;
    runner: R4ServiceIdentityState;
    processSupervisor: R4ServiceIdentityState;
  };
  legacyEndpointReachable: boolean | null;
}

export interface R4PreflightInput {
  repoRoot: string;
  legacyStateRoot: string;
  targetStateRoot: string;
  legacyConfigPath: string;
  targetConfigPath: string;
  requirePublicMain?: boolean;
  serviceProbe?: () => Promise<R4ServiceProbeResult>;
}

export interface R4PreflightReport {
  schemaVersion: 1;
  state: "ready-to-migrate" | "blocked";
  blockers: string[];
  git: {
    clean: boolean;
    branch: string | null;
    head: string | null;
    originMain: string | null;
    exactMain: boolean;
  };
  storage: {
    legacyStateBytes: number;
    availableBytes: number;
    requiredBytes: number;
    freeInodes: number | null;
    totalInodes: number | null;
    capacityGate: boolean;
    snapshotParentWritable: boolean;
  };
  migration: {
    previewState: string;
    targetConfigDisposition: string;
    targetStateDisposition: string;
    totalEntries: number;
    unknownEntries: number;
    classificationCounts: Record<RenameStateEntryClass, number>;
  };
  database: {
    present: boolean;
    integrity: "ok" | "failed" | "missing" | "unreadable";
    schemaVersion: number | null;
    sourceContract: R4LegacyContinuitySourceContract | "missing" | "unreadable";
    targetIdentityMarkerPresent: boolean;
    activeWriterLeases: number;
    nonterminalSessions: number;
    activeRuntimeBindings: number;
    activeRuntimeRuns: number;
    activeDirectProcesses: number;
    pendingOrApprovedMutationApprovals: number;
  };
  jobs: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
  worktrees: {
    discovered: number;
    clean: number;
    dirty: number;
    unreadable: number;
  };
  services: R4ServiceProbeResult;
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function safeGit(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function inspectGit(repoRoot: string, requirePublicMain: boolean) {
  const status = safeGit(repoRoot, ["status", "--porcelain"]);
  const branch = safeGit(repoRoot, ["branch", "--show-current"]);
  const head = safeGit(repoRoot, ["rev-parse", "HEAD"]);
  const originMain = safeGit(repoRoot, ["rev-parse", "origin/main"]);
  const clean = status === "";
  const exactMain =
    !requirePublicMain ||
    (branch === "main" && head !== null && originMain !== null && head === originMain);
  return { clean, branch: branch || null, head, originMain, exactMain };
}

function directorySize(root: string): number {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  const visit = (current: string): void => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      total += stat.size;
      return;
    }
    if (stat.isFile()) {
      total += stat.size;
      return;
    }
    if (!stat.isDirectory()) return;
    for (const name of fs.readdirSync(current)) visit(path.join(current, name));
  };
  visit(root);
  return total;
}

function nearestExistingParent(input: string): string {
  let current = path.resolve(input);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function inspectStorage(repoRoot: string, legacyStateRoot: string, targetConfigPath: string) {
  const legacyStateBytes = directorySize(legacyStateRoot);
  const stats = fs.statfsSync(repoRoot);
  const availableBytes = Number(stats.bavail) * Number(stats.bsize);
  const requiredBytes = Math.max(GIB, legacyStateBytes * 5);
  const totalInodes = Number(stats.files) > 0 ? Number(stats.files) : null;
  const freeInodes = Number(stats.ffree) >= 0 ? Number(stats.ffree) : null;
  let snapshotParentWritable = false;
  try {
    fs.accessSync(nearestExistingParent(path.dirname(targetConfigPath)), fs.constants.W_OK);
    snapshotParentWritable = true;
  } catch {
    snapshotParentWritable = false;
  }
  const inodeGate = freeInodes === null || freeInodes >= 1000;
  return {
    legacyStateBytes,
    availableBytes,
    requiredBytes,
    freeInodes,
    totalInodes,
    capacityGate: availableBytes >= requiredBytes && inodeGate,
    snapshotParentWritable
  };
}

function countImmediateJsonFiles(directory: string): number {
  if (!fs.existsSync(directory)) return 0;
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json")).length;
}

function inspectJobs(legacyStateRoot: string) {
  const jobsRoot = path.join(legacyStateRoot, "jobs");
  return {
    queued: countImmediateJsonFiles(path.join(jobsRoot, "queued")),
    running: countImmediateJsonFiles(path.join(jobsRoot, "running")),
    completed: countImmediateJsonFiles(path.join(jobsRoot, "completed")),
    failed: countImmediateJsonFiles(path.join(jobsRoot, "failed"))
  };
}

function tableExists(database: DatabaseSync, table: string): boolean {
  const row = database
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { present: number } | undefined;
  return Boolean(row?.present);
}

function countWhere(database: DatabaseSync, table: string, where: string): number {
  if (!tableExists(database, table)) return 0;
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`)
    .get() as { count: number };
  return Number(row.count);
}

function inspectDatabase(databasePath: string) {
  const empty = {
    present: false,
    integrity: "missing" as const,
    schemaVersion: null,
    sourceContract: "missing" as const,
    targetIdentityMarkerPresent: false,
    activeWriterLeases: 0,
    nonterminalSessions: 0,
    activeRuntimeBindings: 0,
    activeRuntimeRuns: 0,
    activeDirectProcesses: 0,
    pendingOrApprovedMutationApprovals: 0
  };
  if (!fs.existsSync(databasePath)) return empty;

  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const quick = database.prepare("PRAGMA quick_check").get() as {
      quick_check?: string;
    };
    const legacySource = inspectR4LegacyContinuitySource(database);

    const directMutationApprovals = countWhere(
      database,
      "direct_mutation_approvals",
      "status IN ('pending','approved')"
    );
    const directCommandApprovals = countWhere(
      database,
      "direct_command_approvals",
      "status IN ('pending','approved')"
    );
    const directProcessApprovals = countWhere(
      database,
      "direct_process_approvals",
      "status IN ('pending','approved')"
    );
    const resourceMutationApprovals = countWhere(
      database,
      "runtime_resource_mutation_approvals",
      "status IN ('pending','approved')"
    );
    const runtimeApprovals = countWhere(database, "runtime_approvals", "status='pending'");

    return {
      present: true,
      integrity: quick.quick_check === "ok" ? ("ok" as const) : ("failed" as const),
      schemaVersion: legacySource.schemaVersion,
      sourceContract: legacySource.sourceContract,
      targetIdentityMarkerPresent: legacySource.targetIdentityMarkerPresent,
      activeWriterLeases: countWhere(database, "writer_leases", "status='active'"),
      nonterminalSessions: countWhere(
        database,
        "development_sessions",
        "status NOT IN ('completed','failed')"
      ),
      activeRuntimeBindings: countWhere(database, "runtime_bindings", "status='active'"),
      activeRuntimeRuns: countWhere(
        database,
        "runtime_runs",
        "status IN ('starting','running','waiting-approval')"
      ),
      activeDirectProcesses: countWhere(
        database,
        "direct_process_sessions",
        "status IN ('starting','running')"
      ),
      pendingOrApprovedMutationApprovals:
        runtimeApprovals +
        directMutationApprovals +
        directCommandApprovals +
        directProcessApprovals +
        resourceMutationApprovals
    };
  } catch {
    return {
      ...empty,
      present: true,
      integrity: "unreadable" as const,
      sourceContract: "unreadable" as const
    };
  } finally {
    database?.close();
  }
}

function discoverRuntimeWorktrees(legacyStateRoot: string): string[] {
  const root = path.join(legacyStateRoot, "runtime", "worktrees");
  if (!fs.existsSync(root)) return [];
  const values: string[] = [];
  for (const repo of fs.readdirSync(root, { withFileTypes: true })) {
    if (!repo.isDirectory()) continue;
    const repoRoot = path.join(root, repo.name);
    for (const worktree of fs.readdirSync(repoRoot, { withFileTypes: true })) {
      if (!worktree.isDirectory()) continue;
      values.push(path.join(repoRoot, worktree.name));
    }
  }
  return values;
}

function inspectWorktrees(legacyStateRoot: string) {
  const worktrees = discoverRuntimeWorktrees(legacyStateRoot);
  let clean = 0;
  let dirty = 0;
  let unreadable = 0;
  for (const worktree of worktrees) {
    try {
      const result = execFileSync("git", ["status", "--porcelain"], {
        cwd: worktree,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
      if (result === "") clean += 1;
      else dirty += 1;
    } catch {
      unreadable += 1;
    }
  }
  return { discovered: worktrees.length, clean, dirty, unreadable };
}

function emptyServiceState(): R4ServiceIdentityState {
  return { loaded: false, running: false };
}

function launchdServiceState(label: string): R4ServiceIdentityState {
  if (process.platform !== "darwin" || typeof process.getuid !== "function") {
    return emptyServiceState();
  }
  const target = `gui/${process.getuid()}/${label}`;
  const result = spawnSync("launchctl", ["print", target], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.status !== 0) return emptyServiceState();
  return {
    loaded: true,
    running: /^\s*state\s*=\s*running\s*$/m.test(result.stdout)
  };
}

function readLegacyRuntimeEnv(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

async function probeLegacyEndpoint(legacyStateRoot: string): Promise<boolean | null> {
  const env = readLegacyRuntimeEnv(path.join(legacyStateRoot, "runtime", "server.env"));
  const hostValue = env.TOKENPILOT_HOST?.trim() || "127.0.0.1";
  const host = hostValue === "0.0.0.0" || hostValue === "::" ? "127.0.0.1" : hostValue;
  const port = Number.parseInt(env.TOKENPILOT_PORT?.trim() || "4318", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const headers: Record<string, string> = {};
  if (env.TOKENPILOT_API_TOKEN) {
    headers.authorization = `Bearer ${env.TOKENPILOT_API_TOKEN}`;
  }
  try {
    const response = await fetch(`http://${host}:${port}/api/health`, {
      headers,
      signal: AbortSignal.timeout(1000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function inspectDefaultMacOSR4Services(
  legacyStateRoot: string
): Promise<R4ServiceProbeResult> {
  if (process.platform !== "darwin") {
    return {
      supported: false,
      old: {
        controlPlane: emptyServiceState(),
        runner: emptyServiceState(),
        processSupervisor: emptyServiceState()
      },
      target: {
        controlPlane: emptyServiceState(),
        runner: emptyServiceState(),
        processSupervisor: emptyServiceState()
      },
      legacyEndpointReachable: null
    };
  }
  return {
    supported: true,
    old: {
      controlPlane: launchdServiceState("com.wuaishare.tokenpilot.control-plane"),
      runner: launchdServiceState("com.wuaishare.tokenpilot.runner"),
      processSupervisor: launchdServiceState("com.wuaishare.tokenpilot.process-supervisor")
    },
    target: {
      controlPlane: launchdServiceState("com.wuaishare.chatcockpit.control-plane"),
      runner: launchdServiceState("com.wuaishare.chatcockpit.runner"),
      processSupervisor: launchdServiceState("com.wuaishare.chatcockpit.process-supervisor")
    },
    legacyEndpointReachable: await probeLegacyEndpoint(legacyStateRoot)
  };
}

function emptyClassificationCounts(): Record<RenameStateEntryClass, number> {
  return {
    "durable-copy": 0,
    "durable-copy-with-revalidation": 0,
    "security-reset": 0,
    "security-selective-transfer": 0,
    "ephemeral-never-migrate": 0,
    "archive-only": 0,
    "unknown-do-not-activate": 0
  };
}

export async function buildR4PreflightReport(input: R4PreflightInput): Promise<R4PreflightReport> {
  const blockers: string[] = [];
  const requirePublicMain = input.requirePublicMain !== false;
  const git = inspectGit(input.repoRoot, requirePublicMain);
  if (!git.clean) blockers.push("public-git-dirty");
  if (!git.exactMain) blockers.push("public-main-not-exact-origin-main");

  const storage = inspectStorage(input.repoRoot, input.legacyStateRoot, input.targetConfigPath);
  if (!storage.capacityGate) blockers.push("insufficient-migration-storage-capacity");
  if (!storage.snapshotParentWritable) blockers.push("snapshot-parent-not-writable");

  const preview = buildRenameMigrationPreview({
    legacyStateRoot: input.legacyStateRoot,
    targetStateRoot: input.targetStateRoot,
    legacyConfigPath: input.legacyConfigPath,
    targetConfigPath: input.targetConfigPath
  });
  blockers.push(...preview.blockers.map((value) => `preview:${value}`));
  if (preview.state !== "legacy-detected") blockers.push(`preview-state:${preview.state}`);

  const classificationCounts = emptyClassificationCounts();
  for (const entry of preview.manifest.entries) classificationCounts[entry.classification] += 1;
  const unknownEntries = classificationCounts["unknown-do-not-activate"];
  if (unknownEntries > 0) blockers.push("legacy-state-has-unknown-entries");

  const database = inspectDatabase(
    path.join(input.legacyStateRoot, "runtime", "continuity.sqlite")
  );
  if (!database.present) blockers.push("legacy-continuity-database-missing");
  if (database.integrity !== "ok") blockers.push("legacy-continuity-database-integrity-failed");
  if (
    database.sourceContract !== "v18" &&
    database.sourceContract !== "v19-compatible" &&
    database.sourceContract !== "v20-compatible" &&
    database.sourceContract !== "v21-compatible" &&
    database.sourceContract !== "v22-compatible"
  ) {
    blockers.push("legacy-continuity-source-contract-invalid");
  }
  if (database.activeWriterLeases > 0) blockers.push("active-writer-leases-present");
  if (database.nonterminalSessions > 0) blockers.push("nonterminal-development-sessions-present");
  if (database.activeRuntimeBindings > 0) blockers.push("active-runtime-bindings-present");
  if (database.activeRuntimeRuns > 0) blockers.push("active-runtime-runs-present");
  if (database.activeDirectProcesses > 0) blockers.push("active-direct-processes-present");
  if (database.pendingOrApprovedMutationApprovals > 0) {
    blockers.push("pending-or-approved-mutation-authority-present");
  }

  const jobs = inspectJobs(input.legacyStateRoot);
  if (jobs.queued > 0) blockers.push("queued-jobs-present");
  if (jobs.running > 0) blockers.push("running-jobs-present");

  const worktrees = inspectWorktrees(input.legacyStateRoot);
  if (worktrees.dirty > 0) blockers.push("legacy-runtime-worktree-dirty");
  if (worktrees.unreadable > 0) blockers.push("legacy-runtime-worktree-unreadable");

  const services = await (input.serviceProbe ?? (() => inspectDefaultMacOSR4Services(input.legacyStateRoot)))();
  if (!services.supported) blockers.push("service-inspection-unavailable");
  const targetLoaded = Object.values(services.target).filter((service) => service.loaded).length;
  if (targetLoaded > 0) blockers.push("target-chatcockpit-service-already-loaded");

  const finalBlockers = uniqueSorted(blockers);
  return {
    schemaVersion: 1,
    state: finalBlockers.length === 0 ? "ready-to-migrate" : "blocked",
    blockers: finalBlockers,
    git,
    storage,
    migration: {
      previewState: preview.state,
      targetConfigDisposition: preview.targetConfigDisposition,
      targetStateDisposition: preview.targetStateDisposition,
      totalEntries: preview.manifest.entries.length,
      unknownEntries,
      classificationCounts
    },
    database,
    jobs,
    worktrees,
    services
  };
}

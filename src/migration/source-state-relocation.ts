import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const TARGET_IDENTITY_MIGRATION = "chatcockpit-domain-identity-v1";
const QUIESCED_RUNTIME_ABSENCES = [
  "server.pid",
  "runner.pid",
  "process-supervisor.pid",
  "process-supervisor.sock"
] as const;
const QUIESCED_ZERO_WALS = ["continuity.sqlite-wal", "oauth.sqlite-wal"] as const;
const REGENERATED_RUNTIME_ENTRIES = [
  "server.pid",
  "runner.pid",
  "process-supervisor.pid",
  "process-supervisor.sock",
  "process-supervisor.token",
  "process-supervisor-status.json",
  "runner-status.json",
  "continuity.sqlite-wal",
  "continuity.sqlite-shm",
  "oauth.sqlite-wal",
  "oauth.sqlite-shm",
  "com.wuaishare.chatcockpit.control-plane.plist",
  "com.wuaishare.chatcockpit.runner.plist",
  "com.wuaishare.chatcockpit.process-supervisor.plist"
] as const;
const PRESERVED_HOME_FILES = ["config.json", "direct-executors.json"] as const;

export interface SourceStateRelocationInput {
  sourceStateRoot: string;
  targetStateRoot: string;
  targetConfigPath: string;
}

export interface SourceStateRelocationInspection {
  ready: boolean;
  blockers: string[];
  sourceContinuitySchemaVersion: number | null;
  sourceTargetIdentityMarkerPresent: boolean;
  sourceEntryCount: number;
  targetEntryCount: number;
}

export interface SourceStateRelocationStageInput extends SourceStateRelocationInput {
  snapshotRoot: string;
  stagingRoot: string;
}

export interface SourceStateRelocationStageResult {
  snapshotStateRoot: string;
  stagingStateRoot: string;
  sourceEntryCount: number;
  stagedEntryCount: number;
}

export interface SourceStateRelocationActivationInput {
  targetStateRoot: string;
  stagingStateRoot: string;
  rollbackTargetRoot: string;
}

function realOrResolved(value: string): string {
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) return resolved;
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isRealDirectory(value: string): boolean {
  if (!fs.existsSync(value)) return false;
  const stat = fs.lstatSync(value);
  return stat.isDirectory() && !stat.isSymbolicLink();
}

function relativeInside(root: string, candidate: string): string | null {
  const relative = path.relative(root, candidate);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    return null;
  }
  return relative;
}

function collectEntries(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const values: string[] = [];
  const visit = (current: string, relative: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      values.push(childRelative.split(path.sep).join("/"));
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(path.join(current, entry.name), childRelative);
    }
  };
  visit(root, "");
  return values.sort();
}

function findSymlinks(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const values: string[] = [];
  const visit = (current: string, relative: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        values.push(childRelative.split(path.sep).join("/"));
      } else if (entry.isDirectory()) {
        visit(absolute, childRelative);
      }
    }
  };
  visit(root, "");
  return values;
}

function sqliteQuickCheckOk(databasePath: string): boolean {
  if (!fs.existsSync(databasePath)) return false;
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const integrity = database.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
    return integrity?.quick_check === "ok";
  } catch {
    return false;
  } finally {
    database?.close();
  }
}

function inspectContinuity(databasePath: string): {
  schemaVersion: number | null;
  targetIdentityMarkerPresent: boolean;
  integrityOk: boolean;
} {
  if (!fs.existsSync(databasePath)) {
    return { schemaVersion: null, targetIdentityMarkerPresent: false, integrityOk: false };
  }
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const integrity = database.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
    const schema = database
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .get() as { version?: number | null } | undefined;
    const markerTable = database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='product_identity_migrations'")
      .get() as { present?: number } | undefined;
    const marker = markerTable
      ? (database
          .prepare("SELECT 1 AS present FROM product_identity_migrations WHERE name=?")
          .get(TARGET_IDENTITY_MIGRATION) as { present?: number } | undefined)
      : undefined;
    return {
      schemaVersion: typeof schema?.version === "number" ? schema.version : null,
      targetIdentityMarkerPresent: marker?.present === 1,
      integrityOk: integrity?.quick_check === "ok"
    };
  } catch {
    return { schemaVersion: null, targetIdentityMarkerPresent: false, integrityOk: false };
  } finally {
    database?.close();
  }
}

function assertEmptyDestination(value: string, label: string): void {
  if (fs.existsSync(value)) throw new Error(`${label} already exists`);
}

function copyDirectory(source: string, target: string): void {
  fs.cpSync(source, target, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
    errorOnExist: true,
    force: false
  });
}

export function inspectChatCockpitSourceStateRelocation(
  input: SourceStateRelocationInput
): SourceStateRelocationInspection {
  const sourceStateRoot = realOrResolved(input.sourceStateRoot);
  const targetStateRoot = realOrResolved(input.targetStateRoot);
  const targetConfigPath = realOrResolved(input.targetConfigPath);
  const blockers: string[] = [];

  if (sourceStateRoot === targetStateRoot) blockers.push("source-and-target-state-root-match");
  if (!isRealDirectory(sourceStateRoot)) blockers.push("source-state-root-missing-or-invalid");
  if (fs.existsSync(targetStateRoot) && !isRealDirectory(targetStateRoot)) {
    blockers.push("target-state-root-is-not-a-real-directory");
  }

  const sourceSymlinks = findSymlinks(sourceStateRoot);
  if (sourceSymlinks.length > 0) blockers.push(`source-state-symlinks-present:${sourceSymlinks.length}`);

  const envPath = path.join(sourceStateRoot, "runtime", "server.env");
  if (!fs.existsSync(envPath)) {
    blockers.push("source-runtime-env-missing");
  } else {
    const envSource = fs.readFileSync(envPath, "utf8");
    if (!/^CHATCOCKPIT_API_TOKEN=cc_local_[A-Za-z0-9_-]+$/m.test(envSource)) {
      blockers.push("source-runtime-owner-authority-invalid");
    }
    if (/^TOKENPILOT_/m.test(envSource)) blockers.push("source-runtime-legacy-env-present");
  }

  const continuity = inspectContinuity(path.join(sourceStateRoot, "runtime", "continuity.sqlite"));
  if (!continuity.integrityOk) blockers.push("source-continuity-integrity-failed");
  const oauthPath = path.join(sourceStateRoot, "runtime", "oauth.sqlite");
  if (fs.existsSync(oauthPath) && !sqliteQuickCheckOk(oauthPath)) {
    blockers.push("source-oauth-integrity-failed");
  }
  if (continuity.schemaVersion !== 19) blockers.push("source-continuity-schema-not-v19");
  if (!continuity.targetIdentityMarkerPresent) blockers.push("source-target-identity-marker-missing");

  const targetConfigRelative = relativeInside(targetStateRoot, targetConfigPath);
  if (!targetConfigRelative) blockers.push("target-config-must-live-inside-target-state-root");
  if (!fs.existsSync(targetConfigPath)) {
    blockers.push("target-config-missing");
  } else {
    try {
      const config = JSON.parse(fs.readFileSync(targetConfigPath, "utf8")) as {
        schemaVersion?: unknown;
        defaultRepoId?: unknown;
      };
      if (config.schemaVersion !== 1 || config.defaultRepoId !== "primary") {
        blockers.push("target-config-not-canonical-chatcockpit");
      }
    } catch {
      blockers.push("target-config-invalid-json");
    }
  }

  if (fs.existsSync(targetStateRoot)) {
    const allowed = new Set(PRESERVED_HOME_FILES);
    for (const entry of fs.readdirSync(targetStateRoot, { withFileTypes: true })) {
      if (entry.isFile() && allowed.has(entry.name as (typeof PRESERVED_HOME_FILES)[number])) continue;
      blockers.push(`target-state-active-entry:${entry.name}`);
    }
  }

  const runtimeDir = path.join(sourceStateRoot, "runtime");
  for (const relative of QUIESCED_RUNTIME_ABSENCES) {
    if (fs.existsSync(path.join(runtimeDir, relative))) blockers.push(`source-not-quiesced:${relative}`);
  }
  for (const relative of QUIESCED_ZERO_WALS) {
    const walPath = path.join(runtimeDir, relative);
    if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
      blockers.push(`source-uncheckpointed-wal:${relative}`);
    }
  }

  return {
    ready: blockers.length === 0,
    blockers,
    sourceContinuitySchemaVersion: continuity.schemaVersion,
    sourceTargetIdentityMarkerPresent: continuity.targetIdentityMarkerPresent,
    sourceEntryCount: collectEntries(sourceStateRoot).length,
    targetEntryCount: collectEntries(targetStateRoot).length
  };
}

export function stageChatCockpitSourceStateRelocation(
  input: SourceStateRelocationStageInput
): SourceStateRelocationStageResult {
  const inspection = inspectChatCockpitSourceStateRelocation(input);
  if (!inspection.ready) {
    throw new Error(`ChatCockpit source-state relocation is not ready: ${inspection.blockers.join(", ")}`);
  }

  assertEmptyDestination(input.snapshotRoot, "snapshot root");
  assertEmptyDestination(input.stagingRoot, "staging root");
  fs.mkdirSync(input.snapshotRoot, { recursive: true, mode: 0o700 });
  const snapshotStateRoot = path.join(input.snapshotRoot, "state");
  copyDirectory(input.sourceStateRoot, snapshotStateRoot);
  fs.chmodSync(input.snapshotRoot, 0o700);

  copyDirectory(input.sourceStateRoot, input.stagingRoot);
  const runtimeDir = path.join(input.stagingRoot, "runtime");
  for (const entry of REGENERATED_RUNTIME_ENTRIES) {
    fs.rmSync(path.join(runtimeDir, entry), { recursive: true, force: true });
  }
  for (const fileName of PRESERVED_HOME_FILES) {
    const existing = path.join(input.targetStateRoot, fileName);
    if (!fs.existsSync(existing)) continue;
    const target = path.join(input.stagingRoot, fileName);
    fs.copyFileSync(existing, target);
  }

  const stagedInspection = inspectContinuity(path.join(input.stagingRoot, "runtime", "continuity.sqlite"));
  if (
    !stagedInspection.integrityOk ||
    stagedInspection.schemaVersion !== 19 ||
    !stagedInspection.targetIdentityMarkerPresent
  ) {
    throw new Error("staged ChatCockpit continuity database failed target-only verification");
  }
  const stagedOauthPath = path.join(input.stagingRoot, "runtime", "oauth.sqlite");
  if (fs.existsSync(stagedOauthPath) && !sqliteQuickCheckOk(stagedOauthPath)) {
    throw new Error("staged ChatCockpit OAuth database failed integrity verification");
  }
  for (const entry of REGENERATED_RUNTIME_ENTRIES) {
    if (fs.existsSync(path.join(runtimeDir, entry))) {
      throw new Error(`staged runtime still contains regenerated authority: ${entry}`);
    }
  }

  return {
    snapshotStateRoot,
    stagingStateRoot: input.stagingRoot,
    sourceEntryCount: inspection.sourceEntryCount,
    stagedEntryCount: collectEntries(input.stagingRoot).length
  };
}

export function activateChatCockpitSourceStateRelocation(
  input: SourceStateRelocationActivationInput
): void {
  const targetStateRoot = path.resolve(input.targetStateRoot);
  const stagingStateRoot = path.resolve(input.stagingStateRoot);
  const rollbackTargetRoot = path.resolve(input.rollbackTargetRoot);
  if (path.dirname(targetStateRoot) !== path.dirname(stagingStateRoot)) {
    throw new Error("staging state must be a sibling of target state for atomic activation");
  }
  assertEmptyDestination(rollbackTargetRoot, "rollback target root");
  if (!isRealDirectory(stagingStateRoot)) throw new Error("staging state root is missing or invalid");

  if (fs.existsSync(targetStateRoot)) fs.renameSync(targetStateRoot, rollbackTargetRoot);
  try {
    fs.renameSync(stagingStateRoot, targetStateRoot);
  } catch (error) {
    if (fs.existsSync(rollbackTargetRoot) && !fs.existsSync(targetStateRoot)) {
      fs.renameSync(rollbackTargetRoot, targetStateRoot);
    }
    throw error;
  }
}

export function rollbackChatCockpitSourceStateRelocation(input: {
  targetStateRoot: string;
  rollbackTargetRoot: string;
  failedTargetRoot: string;
}): void {
  if (fs.existsSync(input.failedTargetRoot)) {
    throw new Error("failed target archive path already exists");
  }
  if (fs.existsSync(input.targetStateRoot)) fs.renameSync(input.targetStateRoot, input.failedTargetRoot);
  if (!fs.existsSync(input.rollbackTargetRoot)) {
    throw new Error("rollback target root is missing");
  }
  fs.renameSync(input.rollbackTargetRoot, input.targetStateRoot);
}

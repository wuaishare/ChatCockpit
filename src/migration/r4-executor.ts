import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ContinuityDatabase, LATEST_CONTINUITY_SCHEMA_VERSION } from "../continuity/database.js";
import { buildSourceDistributionContextForProduct } from "../core/distribution-context.js";
import { buildPaths } from "../core/paths.js";
import { initLocalRuntime } from "../core/setup.js";
import type { TokenPilotUserConfig } from "../types.js";
import {
  assessChatCockpitTargetConfig,
  migrateLegacyUserConfigToChatCockpit
} from "./chatcockpit-config-migration.js";
import {
  CHATCOCKPIT_TARGET_IDENTITY_MIGRATION,
  migrateChatCockpitTargetContinuityDatabase
} from "./chatcockpit-target-continuity.js";
import { inspectR4LegacyContinuitySource, type R4LegacyContinuitySourceContract } from "./r4-legacy-continuity.js";
import { buildRenameMigrationPreview } from "./rename-preview.js";
import { buildRenameMigrationManifest } from "./rename-state-classifier.js";
import type { RenameMigrationManifest, RenameStateEntry } from "./rename-types.js";

export const R4_REAL_PATH_OPT_IN = "I_UNDERSTAND_THIS_WRITES_REAL_CHATCOCKPIT_MIGRATION_STATE";

export interface R4MigrationExecutorInput {
  sandboxRoot: string;
  realPathOptIn?: string;
  repoRoot: string;
  legacyStateRoot: string;
  legacyConfigPath: string;
  targetStateRoot: string;
  targetConfigPath: string;
  snapshotRoot: string;
  stagingRoot: string;
  extraForensicFiles?: Array<{
    sourcePath: string;
    snapshotRelativePath: string;
  }>;
}

export interface R4MigrationExecutorResult {
  ok: true;
  migrationId: string;
  snapshotManifestSha256: string;
  snapshotFileCount: number;
  classifiedStateEntries: number;
  copiedDurableEntries: number;
  skippedArchiveEntries: number;
  skippedEphemeralEntries: number;
  resetSecurityEntries: number;
  targetConfigDefaultRepoId: "primary";
  legacyContinuitySourceContract: Exclude<R4LegacyContinuitySourceContract, "invalid">;
  continuityBackupMethod: "node-sqlite-backup" | "vacuum-into";
  targetContinuitySchemaVersion: number;
  runtimeBindingRowsUpdated: number;
  runtimeResourceRowsUpdated: number;
  freshRuntimeAuthorityGenerated: true;
}

interface SnapshotFileEntry {
  relativePath: string;
  kind: "file" | "symlink";
  size: number;
  sha256: string;
}

interface SnapshotManifest {
  schemaVersion: 1;
  migrationId: string;
  files: SnapshotFileEntry[];
  stateClassification: RenameMigrationManifest;
}

function canonicalPath(input: string): string {
  let cursor = path.resolve(input);
  const missing: string[] = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  const base = fs.existsSync(cursor) ? fs.realpathSync.native(cursor) : cursor;
  return path.join(base, ...missing);
}

function isWithin(child: string, parent: string): boolean {
  const childPath = canonicalPath(child);
  const parentPath = canonicalPath(parent);
  return childPath === parentPath || childPath.startsWith(`${parentPath}${path.sep}`);
}

function assertSandboxed(input: R4MigrationExecutorInput): void {
  if (input.realPathOptIn === R4_REAL_PATH_OPT_IN) return;
  const sandboxRoot = canonicalPath(input.sandboxRoot);
  const paths = [
    input.repoRoot,
    input.legacyStateRoot,
    input.legacyConfigPath,
    input.targetStateRoot,
    input.targetConfigPath,
    input.snapshotRoot,
    input.stagingRoot,
    ...(input.extraForensicFiles ?? []).map((entry) => entry.sourcePath)
  ];
  for (const candidate of paths) {
    if (!isWithin(candidate, sandboxRoot)) {
      throw new Error("R4_REAL_PATH_GUARD_BLOCKED");
    }
  }
  if (path.resolve(input.snapshotRoot) === path.resolve(input.stagingRoot)) {
    throw new Error("R4 snapshotRoot and stagingRoot must be distinct");
  }
}

function assertUnusedOutputRoot(root: string, label: string): void {
  if (!fs.existsSync(root)) return;
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be an unused directory path`);
  }
  if (fs.readdirSync(root).length > 0) {
    throw new Error(`${label} must be empty before migration execution`);
  }
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

function collectRelativeFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const values: string[] = [];
  const visit = (current: string, relative: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const childRelative = (relative ? path.join(relative, entry.name) : entry.name)
        .split(path.sep)
        .join("/");
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        visit(absolute, childRelative);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        values.push(childRelative);
      }
    }
  };
  visit(root, "");
  return values.sort();
}

function sha256Buffer(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashPath(filePath: string): { kind: "file" | "symlink"; size: number; sha256: string } {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(filePath);
    return { kind: "symlink", size: Buffer.byteLength(target), sha256: sha256Buffer(target) };
  }
  if (!stat.isFile()) throw new Error(`Snapshot path is not a file/symlink: ${filePath}`);
  const content = fs.readFileSync(filePath);
  return { kind: "file", size: stat.size, sha256: sha256Buffer(content) };
}

function copyPathPreservingSymlink(source: string, destination: string): void {
  const stat = fs.lstatSync(source);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(source), destination);
    return;
  }
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, stat.mode & 0o777);
}

function copyTreePreservingSymlinks(sourceRoot: string, destinationRoot: string): void {
  fs.mkdirSync(destinationRoot, { recursive: true, mode: 0o700 });
  const visit = (source: string, destination: string): void => {
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink() || stat.isFile()) {
      copyPathPreservingSymlink(source, destination);
      return;
    }
    if (!stat.isDirectory()) return;
    fs.mkdirSync(destination, { recursive: true, mode: stat.mode & 0o777 });
    for (const entry of fs.readdirSync(source)) {
      visit(path.join(source, entry), path.join(destination, entry));
    }
  };
  visit(sourceRoot, destinationRoot);
}

function writePrivateJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  fs.chmodSync(filePath, 0o600);
}

function createForensicSnapshot(input: R4MigrationExecutorInput, migrationId: string) {
  assertUnusedOutputRoot(input.snapshotRoot, "snapshotRoot");
  fs.mkdirSync(input.snapshotRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(input.snapshotRoot, 0o700);

  const snapshotStateRoot = path.join(input.snapshotRoot, "legacy-state");
  copyTreePreservingSymlinks(input.legacyStateRoot, snapshotStateRoot);
  copyPathPreservingSymlink(
    input.legacyConfigPath,
    path.join(input.snapshotRoot, "legacy-config.json")
  );
  for (const entry of input.extraForensicFiles ?? []) {
    const normalized = entry.snapshotRelativePath.split(path.sep).join("/");
    if (
      normalized.startsWith("../") ||
      path.isAbsolute(normalized) ||
      normalized === ".." ||
      normalized.length === 0
    ) {
      throw new Error("R4 extra forensic snapshot path must be relative and bounded");
    }
    copyPathPreservingSymlink(
      entry.sourcePath,
      path.join(input.snapshotRoot, "extra", normalized)
    );
  }

  const stateRelativeFiles = collectRelativeFiles(input.legacyStateRoot);
  const stateClassification = buildRenameMigrationManifest(
    "snapshotting",
    stateRelativeFiles
  );
  const unknown = stateClassification.entries.filter(
    (entry) => entry.classification === "unknown-do-not-activate"
  );
  if (unknown.length > 0) {
    throw new Error(`R4_UNKNOWN_STATE_ENTRIES:${unknown.length}`);
  }

  const files: SnapshotFileEntry[] = [];
  const snapshotFiles = collectRelativeFiles(input.snapshotRoot).filter(
    (relativePath) => relativePath !== "snapshot-manifest.json"
  );
  for (const relativePath of snapshotFiles) {
    const absolute = path.join(input.snapshotRoot, relativePath);
    const hashed = hashPath(absolute);
    files.push({ relativePath, ...hashed });
  }
  const manifest: SnapshotManifest = {
    schemaVersion: 1,
    migrationId,
    files,
    stateClassification
  };
  const manifestSource = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestSha256 = sha256Buffer(manifestSource);
  fs.writeFileSync(path.join(input.snapshotRoot, "snapshot-manifest.json"), manifestSource, {
    encoding: "utf8",
    mode: 0o600
  });
  return { manifest, manifestSha256 };
}

function copyApprovedStateEntries(
  legacyStateRoot: string,
  targetStateRoot: string,
  entries: readonly RenameStateEntry[]
): {
  copiedDurableEntries: number;
  skippedArchiveEntries: number;
  skippedEphemeralEntries: number;
  resetSecurityEntries: number;
} {
  let copiedDurableEntries = 0;
  let skippedArchiveEntries = 0;
  let skippedEphemeralEntries = 0;
  let resetSecurityEntries = 0;

  for (const entry of entries) {
    if (entry.classification === "unknown-do-not-activate") {
      throw new Error(`R4_UNKNOWN_STATE_ENTRY:${entry.relativePath}`);
    }
    if (entry.classification === "durable-copy-with-revalidation") {
      throw new Error(`R4_NONTERMINAL_STATE_REVALIDATION_REQUIRED:${entry.relativePath}`);
    }
    if (entry.relativePath === "runtime/continuity.sqlite") {
      continue;
    }
    if (entry.classification === "durable-copy") {
      copyPathPreservingSymlink(
        path.join(legacyStateRoot, entry.relativePath),
        path.join(targetStateRoot, entry.relativePath)
      );
      copiedDurableEntries += 1;
      continue;
    }
    if (entry.classification === "archive-only") {
      skippedArchiveEntries += 1;
      continue;
    }
    if (entry.classification === "ephemeral-never-migrate") {
      skippedEphemeralEntries += 1;
      continue;
    }
    if (
      entry.classification === "security-reset" ||
      entry.classification === "security-selective-transfer"
    ) {
      resetSecurityEntries += 1;
    }
  }

  return {
    copiedDurableEntries,
    skippedArchiveEntries,
    skippedEphemeralEntries,
    resetSecurityEntries
  };
}

function assertLegacyContinuityReady(
  sourcePath: string
): Exclude<R4LegacyContinuitySourceContract, "invalid"> {
  if (!fs.existsSync(sourcePath)) throw new Error("R4 legacy continuity database is missing");
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const integrity = source.prepare("PRAGMA quick_check").get() as { quick_check?: string };
    if (integrity.quick_check !== "ok") {
      throw new Error("R4 legacy continuity database quick_check failed");
    }
    const inspection = inspectR4LegacyContinuitySource(source);
    if (inspection.sourceContract === "invalid") {
      throw new Error(
        `R4 legacy continuity source contract is invalid at schema v${String(inspection.schemaVersion)}`
      );
    }
    return inspection.sourceContract;
  } finally {
    source.close();
  }
}

export async function backupR4SqliteDatabaseForMigration(
  sourcePath: string,
  targetPath: string,
  options: { forceVacuumInto?: boolean } = {}
): Promise<"node-sqlite-backup" | "vacuum-into"> {
  if (!fs.existsSync(sourcePath)) throw new Error("R4 legacy continuity database is missing");
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
    throw new Error("R4 target continuity backup path must not contain an existing database");
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });

  const sqliteModule = (await import("node:sqlite")) as unknown as {
    backup?: (source: DatabaseSync, destination: string) => Promise<unknown>;
  };
  const nativeBackup = options.forceVacuumInto ? undefined : sqliteModule.backup;
  if (typeof nativeBackup === "function") {
    const source = new DatabaseSync(sourcePath, { readOnly: true });
    try {
      await nativeBackup(source, targetPath);
      return "node-sqlite-backup";
    } finally {
      source.close();
    }
  }

  if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const escapedTarget = path.resolve(targetPath).replaceAll("'", "''");
    source.exec(`VACUUM INTO '${escapedTarget}'`);
    return "vacuum-into";
  } finally {
    source.close();
  }
}

function verifyTargetContinuityDatabase(databasePath: string): {
  schemaVersion: number;
  runtimeBindingRowsUpdated: number;
  runtimeResourceRowsUpdated: number;
} {
  const upgraded = new ContinuityDatabase({ path: databasePath });
  try {
    if (upgraded.schemaVersion() !== LATEST_CONTINUITY_SCHEMA_VERSION) {
      throw new Error(
        `R4 target continuity upgrade expected schema ${LATEST_CONTINUITY_SCHEMA_VERSION}, received ${upgraded.schemaVersion()}`
      );
    }
  } finally {
    upgraded.close();
  }

  const identityMigration = migrateChatCockpitTargetContinuityDatabase(databasePath);
  const inspection = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = inspection.prepare("PRAGMA integrity_check").get() as {
      integrity_check?: string;
    };
    if (integrity.integrity_check !== "ok") {
      throw new Error("R4 target continuity integrity_check failed");
    }
    const foreignKeyViolations = inspection.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length > 0) {
      throw new Error("R4 target continuity foreign_key_check failed");
    }
    const schemaRow = inspection
      .prepare("SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations")
      .get() as { version: number };
    if (Number(schemaRow.version) !== LATEST_CONTINUITY_SCHEMA_VERSION) {
      throw new Error("R4 target continuity schema version changed after identity migration");
    }
    const migrationRow = inspection
      .prepare("SELECT name FROM product_identity_migrations WHERE name = ?")
      .get(CHATCOCKPIT_TARGET_IDENTITY_MIGRATION) as { name: string } | undefined;
    if (!migrationRow) throw new Error("R4 target continuity identity migration marker is missing");
    const oldRuntimeBindings = inspection
      .prepare("SELECT COUNT(*) AS count FROM runtime_bindings WHERE runtime_kind='tokenpilot-runner'")
      .get() as { count: number };
    const oldResourceSources = inspection
      .prepare("SELECT COUNT(*) AS count FROM runtime_resource_items WHERE source_kind='tokenpilot-local'")
      .get() as { count: number };
    if (Number(oldRuntimeBindings.count) !== 0 || Number(oldResourceSources.count) !== 0) {
      throw new Error("R4 target continuity retained old active domain identity rows");
    }
    return {
      schemaVersion: Number(schemaRow.version),
      runtimeBindingRowsUpdated: identityMigration.runtimeBindingRowsUpdated,
      runtimeResourceRowsUpdated: identityMigration.runtimeResourceRowsUpdated
    };
  } finally {
    inspection.close();
  }
}

function stageTargetConfig(input: R4MigrationExecutorInput, stagingConfigPath: string) {
  const legacyRaw = readJson(input.legacyConfigPath);
  const targetRaw = fs.existsSync(input.targetConfigPath) ? readJson(input.targetConfigPath) : null;
  const assessment = assessChatCockpitTargetConfig({
    legacyConfigRaw: legacyRaw,
    targetConfigRaw: targetRaw
  });
  if (assessment.disposition === "conflict" || !assessment.expected) {
    throw new Error(`R4_TARGET_CONFIG_CONFLICT:${assessment.blockers.join("|")}`);
  }
  const targetConfig: TokenPilotUserConfig = migrateLegacyUserConfigToChatCockpit(legacyRaw);
  writePrivateJson(stagingConfigPath, targetConfig);
  return targetConfig;
}

function generateFreshRuntimeAuthority(input: R4MigrationExecutorInput, stateRoot: string, configPath: string) {
  const context = buildSourceDistributionContextForProduct("chatcockpit", input.repoRoot, {
    stateRoot,
    configPath,
    primaryWorkspaceRoot: input.repoRoot
  });
  const paths = buildPaths(context);
  const initialized = initLocalRuntime(paths, { force: true });
  if (!initialized.created || !initialized.tokenGenerated) {
    throw new Error("R4 fresh ChatCockpit runtime authority generation failed");
  }
  const envSource = fs.readFileSync(initialized.envPath, "utf8");
  if (/^TOKENPILOT_/m.test(envSource)) {
    throw new Error("R4 target runtime env emitted legacy TOKENPILOT_ authority");
  }
  if (!/^CHATCOCKPIT_API_TOKEN=cc_local_[A-Za-z0-9_-]+$/m.test(envSource)) {
    throw new Error("R4 target runtime env is missing fresh ChatCockpit owner authority");
  }
}

export async function buildR4MigrationStaging(
  input: R4MigrationExecutorInput
): Promise<R4MigrationExecutorResult> {
  assertSandboxed(input);
  if (!fs.existsSync(input.legacyStateRoot) || !fs.existsSync(input.legacyConfigPath)) {
    throw new Error("R4 legacy migration input is missing");
  }
  assertUnusedOutputRoot(input.snapshotRoot, "snapshotRoot");
  assertUnusedOutputRoot(input.stagingRoot, "stagingRoot");

  const preview = buildRenameMigrationPreview({
    legacyStateRoot: input.legacyStateRoot,
    targetStateRoot: input.targetStateRoot,
    legacyConfigPath: input.legacyConfigPath,
    targetConfigPath: input.targetConfigPath
  });
  if (preview.state !== "legacy-detected" || preview.blockers.length > 0) {
    throw new Error(
      `R4_PREFLIGHT_DRIFT:${preview.state}:${preview.blockers.join("|") || "target-disposition-changed"}`
    );
  }
  const previewUnknown = preview.manifest.entries.filter(
    (entry) => entry.classification === "unknown-do-not-activate"
  ).length;
  if (previewUnknown > 0) {
    throw new Error(`R4_UNKNOWN_STATE_ENTRIES:${previewUnknown}`);
  }
  const sourceDatabasePath = path.join(input.legacyStateRoot, "runtime", "continuity.sqlite");
  const legacyContinuitySourceContract = assertLegacyContinuityReady(sourceDatabasePath);

  const migrationId = `r4_${randomUUID()}`;
  const snapshot = createForensicSnapshot(input, migrationId);
  const entries = snapshot.manifest.stateClassification.entries;
  const unknownCount = entries.filter(
    (entry) => entry.classification === "unknown-do-not-activate"
  ).length;
  if (unknownCount > 0) throw new Error(`R4_UNKNOWN_STATE_ENTRIES:${unknownCount}`);

  fs.mkdirSync(input.stagingRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(input.stagingRoot, 0o700);
  const stagingStateRoot = path.join(input.stagingRoot, "state");
  const stagingConfigPath = path.join(input.stagingRoot, "config", "config.json");
  fs.mkdirSync(stagingStateRoot, { recursive: true, mode: 0o700 });

  const copyStats = copyApprovedStateEntries(input.legacyStateRoot, stagingStateRoot, entries);
  const targetDatabasePath = path.join(stagingStateRoot, "runtime", "continuity.sqlite");
  const continuityBackupMethod = await backupR4SqliteDatabaseForMigration(
    sourceDatabasePath,
    targetDatabasePath
  );
  const continuity = verifyTargetContinuityDatabase(targetDatabasePath);

  const targetConfig = stageTargetConfig(input, stagingConfigPath);
  generateFreshRuntimeAuthority(input, stagingStateRoot, stagingConfigPath);

  return {
    ok: true,
    migrationId,
    snapshotManifestSha256: snapshot.manifestSha256,
    snapshotFileCount: snapshot.manifest.files.length,
    classifiedStateEntries: entries.length,
    ...copyStats,
    targetConfigDefaultRepoId: targetConfig.defaultRepoId as "primary",
    legacyContinuitySourceContract,
    continuityBackupMethod,
    targetContinuitySchemaVersion: continuity.schemaVersion,
    runtimeBindingRowsUpdated: continuity.runtimeBindingRowsUpdated,
    runtimeResourceRowsUpdated: continuity.runtimeResourceRowsUpdated,
    freshRuntimeAuthorityGenerated: true
  };
}

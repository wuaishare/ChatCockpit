import path from "node:path";

import type {
  RenameMigrationManifest,
  RenameMigrationState,
  RenameStateEntry
} from "./rename-types.js";

function normalized(relativePath: string): string {
  return relativePath.split(path.sep).join("/").replace(/^\.\//, "");
}

export function classifyRenameStatePath(relativePath: string): RenameStateEntry {
  const value = normalized(relativePath);

  if (value === "runtime/continuity.sqlite") {
    return {
      relativePath: value,
      classification: "durable-copy",
      action: "copy-to-new-state",
      reason: "durable continuity source of truth"
    };
  }
  if (/^jobs\/(?:queued|running)\/[^/]+\.json$/.test(value)) {
    return {
      relativePath: value,
      classification: "durable-copy-with-revalidation",
      action: "copy-then-reconcile",
      reason: "nonterminal queued/running work requires ownership and schema revalidation"
    };
  }
  if (
    value.startsWith("jobs/completed/") ||
    value.startsWith("jobs/failed/") ||
    value.startsWith("bundles/") ||
    value.startsWith("manifests/")
  ) {
    return {
      relativePath: value,
      classification: "durable-copy",
      action: "copy-to-new-state",
      reason: "durable artifact/evidence state"
    };
  }
  if (/^runtime\/worktrees\//.test(value)) {
    return {
      relativePath: value,
      classification: "archive-only",
      action: "retain-in-legacy-state-and-verify-worktree-clean",
      reason: "registered Git worktrees are external workspace state and must not become active target runtime state"
    };
  }
  if (/^runtime\/job-processes\//.test(value)) {
    return {
      relativePath: value,
      classification: "ephemeral-never-migrate",
      action: "reconcile-from-new-runtime",
      reason: "old process ownership and PID-linked job process records are invalid after quiesce"
    };
  }
  if (/^runtime\/capabilities\//.test(value)) {
    return {
      relativePath: value,
      classification: "ephemeral-never-migrate",
      action: "reprobe-under-new-runtime",
      reason: "capability truth must be observed again under the ChatCockpit runtime"
    };
  }
  if (/^repomix-output(?:-[^/]+)?\.xml$/i.test(value)) {
    return {
      relativePath: value,
      classification: "archive-only",
      action: "retain-only-in-legacy-snapshot",
      reason: "legacy generated repository bundles are historical artifacts and can be regenerated"
    };
  }
  if (/^runtime\/continuity\.sqlite-(?:wal|shm)$/.test(value)) {
    return {
      relativePath: value,
      classification: "archive-only",
      action: "retain-in-forensic-snapshot-only",
      reason: "WAL/SHM are forensic source components; active target DB must come from a consistent SQLite backup"
    };
  }
  if (value === "runtime/durable-proof-real-config.json") {
    return {
      relativePath: value,
      classification: "archive-only",
      action: "retain-only-in-legacy-snapshot",
      reason: "historical migration/proof fixture is not active runtime configuration"
    };
  }
  if (value === ".DS_Store") {
    return {
      relativePath: value,
      classification: "ephemeral-never-migrate",
      action: "discard-os-metadata",
      reason: "filesystem UI metadata is not product state"
    };
  }
  if (value === "runtime/server.env") {
    return {
      relativePath: value,
      classification: "security-selective-transfer",
      action: "rebuild-target-env-and-transfer-approved-owner-secret-only",
      reason: "env file mixes configuration and secret material"
    };
  }
  if (/^runtime\/oauth\.sqlite(?:-wal|-shm)?$/.test(value)) {
    return {
      relativePath: value,
      classification: "security-reset",
      action: "do-not-copy-active-authority",
      reason: "OAuth grants require ChatCockpit reauthorization"
    };
  }
  if (value === "runtime/process-supervisor.token") {
    return {
      relativePath: value,
      classification: "security-reset",
      action: "regenerate-under-new-runtime-generation",
      reason: "supervisor IPC authority must not survive rename"
    };
  }
  if (
    value.endsWith(".pid") ||
    value.endsWith(".sock") ||
    value.endsWith(".plist") ||
    value === "runtime/process-supervisor-status.json" ||
    value === "runtime/runner-status.json"
  ) {
    return {
      relativePath: value,
      classification: "ephemeral-never-migrate",
      action: "recreate-from-new-runtime",
      reason: "ephemeral process/service identity"
    };
  }
  if (value.endsWith(".log") || value.endsWith("-events.jsonl")) {
    return {
      relativePath: value,
      classification: "archive-only",
      action: "retain-only-in-legacy-snapshot",
      reason: "diagnostic history is not active runtime authority"
    };
  }
  return {
    relativePath: value,
    classification: "unknown-do-not-activate",
    action: "exclude-until-explicitly-classified",
    reason: "unknown state is fail-closed"
  };
}

export function buildRenameMigrationManifest(
  state: RenameMigrationState,
  relativePaths: readonly string[]
): RenameMigrationManifest {
  return {
    schemaVersion: 1,
    sourceIdentity: "tokenpilot",
    targetIdentity: "chatcockpit",
    state,
    entries: relativePaths
      .map(classifyRenameStatePath)
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    identityPreservations: [
      { kind: "repo-id", value: "tokenpilot", action: "preserve" }
    ],
    secretMaterialIncluded: false
  };
}

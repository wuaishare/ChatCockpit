export type RenameMigrationState =
  | "not-required"
  | "legacy-detected"
  | "conflict"
  | "ready-to-migrate"
  | "quiescing"
  | "snapshotting"
  | "migrating"
  | "verifying"
  | "completed"
  | "recovery-required"
  | "failed";

export type RenameStateEntryClass =
  | "durable-copy"
  | "durable-copy-with-revalidation"
  | "security-reset"
  | "security-selective-transfer"
  | "ephemeral-never-migrate"
  | "archive-only"
  | "unknown-do-not-activate";

export interface RenameStateEntry {
  relativePath: string;
  classification: RenameStateEntryClass;
  action: string;
  reason: string;
}

export interface RenameIdentityPreservation {
  kind: "repo-id" | "historical-evidence";
  value: string;
  action: "preserve";
}

export interface RenameMigrationManifest {
  schemaVersion: 1;
  sourceIdentity: "tokenpilot";
  targetIdentity: "chatcockpit";
  state: RenameMigrationState;
  entries: RenameStateEntry[];
  identityPreservations: RenameIdentityPreservation[];
  secretMaterialIncluded: false;
}

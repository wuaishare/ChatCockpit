import type { RenameMigrationState } from "./rename-types.js";

const ALLOWED: Readonly<Record<RenameMigrationState, readonly RenameMigrationState[]>> = {
  "not-required": [],
  "legacy-detected": ["conflict", "ready-to-migrate", "failed"],
  conflict: ["legacy-detected", "ready-to-migrate", "failed"],
  "ready-to-migrate": ["conflict", "quiescing", "failed"],
  quiescing: ["snapshotting", "recovery-required", "failed"],
  snapshotting: ["migrating", "recovery-required", "failed"],
  migrating: ["verifying", "recovery-required", "failed"],
  verifying: ["completed", "recovery-required", "failed"],
  completed: [],
  "recovery-required": ["verifying", "failed"],
  failed: []
};

export function canRenameMigrationTransition(
  from: RenameMigrationState,
  to: RenameMigrationState
): boolean {
  return ALLOWED[from].includes(to);
}

export function assertRenameMigrationTransition(
  from: RenameMigrationState,
  to: RenameMigrationState
): void {
  if (!canRenameMigrationTransition(from, to)) {
    throw new Error(`Rename migration transition ${from} -> ${to} is not allowed`);
  }
}

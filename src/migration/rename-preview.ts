import fs from "node:fs";
import path from "node:path";

import { buildRenameMigrationManifest } from "./rename-state-classifier.js";
import type { RenameMigrationManifest, RenameMigrationState } from "./rename-types.js";

export interface RenamePreviewInput {
  legacyStateRoot: string;
  targetStateRoot: string;
  legacyConfigPath: string;
  targetConfigPath: string;
}

export interface RenameMigrationPreview {
  state: RenameMigrationState;
  legacyStatePresent: boolean;
  targetStatePresent: boolean;
  legacyConfigPresent: boolean;
  targetConfigPresent: boolean;
  manifest: RenameMigrationManifest;
}

function collectRelativeFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const values: string[] = [];

  const visit = (current: string, relative: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isSymbolicLink()) {
        values.push(childRelative);
        continue;
      }
      if (entry.isDirectory()) {
        visit(absolute, childRelative);
        continue;
      }
      if (entry.isFile()) values.push(childRelative);
    }
  };

  visit(root, "");
  return values;
}

function deriveState(input: RenamePreviewInput): RenameMigrationState {
  const legacyStatePresent = fs.existsSync(input.legacyStateRoot);
  const targetStatePresent = fs.existsSync(input.targetStateRoot);
  const legacyConfigPresent = fs.existsSync(input.legacyConfigPath);
  const targetConfigPresent = fs.existsSync(input.targetConfigPath);

  if (!legacyStatePresent && !legacyConfigPresent) return "not-required";
  if (targetStatePresent || targetConfigPresent) return "conflict";
  return "legacy-detected";
}

export function buildRenameMigrationPreview(input: RenamePreviewInput): RenameMigrationPreview {
  const state = deriveState(input);
  const legacyStatePresent = fs.existsSync(input.legacyStateRoot);
  const targetStatePresent = fs.existsSync(input.targetStateRoot);
  const legacyConfigPresent = fs.existsSync(input.legacyConfigPath);
  const targetConfigPresent = fs.existsSync(input.targetConfigPath);
  const relativeFiles = collectRelativeFiles(input.legacyStateRoot);

  return {
    state,
    legacyStatePresent,
    targetStatePresent,
    legacyConfigPresent,
    targetConfigPresent,
    manifest: buildRenameMigrationManifest(state, relativeFiles)
  };
}

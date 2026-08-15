import fs from "node:fs";
import path from "node:path";

import { assessChatCockpitTargetConfig } from "./chatcockpit-config-migration.js";
import { buildRenameMigrationManifest } from "./rename-state-classifier.js";
import type {
  RenameMigrationManifest,
  RenameMigrationState,
  RenameTargetConfigDisposition,
  RenameTargetStateDisposition
} from "./rename-types.js";

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
  targetStateDisposition: RenameTargetStateDisposition;
  targetConfigDisposition: RenameTargetConfigDisposition;
  blockers: string[];
  manifest: RenameMigrationManifest;
}

const TARGET_EMPTY_SCAFFOLD_DIRS = new Set([
  "bundles",
  "jobs",
  "jobs/queued",
  "jobs/running",
  "jobs/completed",
  "jobs/failed",
  "manifests",
  "runtime"
]);

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

function assessTargetState(root: string): {
  disposition: RenameTargetStateDisposition;
  blockers: string[];
} {
  if (!fs.existsSync(root)) {
    return { disposition: "absent", blockers: [] };
  }
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return {
      disposition: "active-conflict",
      blockers: ["target-state-root-is-not-a-real-directory"]
    };
  }

  const blockers: string[] = [];
  const visit = (current: string, relative: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const childRelative = (relative ? path.join(relative, entry.name) : entry.name)
        .split(path.sep)
        .join("/");
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        blockers.push(`target-state-symbolic-link:${childRelative}`);
        continue;
      }
      if (!entry.isDirectory()) {
        blockers.push(`target-state-active-entry:${childRelative}`);
        continue;
      }
      if (!TARGET_EMPTY_SCAFFOLD_DIRS.has(childRelative)) {
        blockers.push(`target-state-unexpected-directory:${childRelative}`);
        continue;
      }
      visit(absolute, childRelative);
    }
  };
  visit(root, "");

  return {
    disposition: blockers.length === 0 ? "empty-scaffold" : "active-conflict",
    blockers
  };
}

function readJson(filePath: string): { raw: unknown | null; blocker: string | null } {
  if (!fs.existsSync(filePath)) return { raw: null, blocker: null };
  try {
    return { raw: JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown, blocker: null };
  } catch (error) {
    return {
      raw: null,
      blocker: `config-json-invalid:${path.basename(filePath)}:${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }
}

function deriveState(input: {
  legacyStatePresent: boolean;
  legacyConfigPresent: boolean;
  targetStateDisposition: RenameTargetStateDisposition;
  targetConfigDisposition: RenameTargetConfigDisposition;
}): RenameMigrationState {
  if (!input.legacyStatePresent && !input.legacyConfigPresent) return "not-required";
  if (
    input.targetStateDisposition === "active-conflict" ||
    input.targetConfigDisposition === "conflict"
  ) {
    return "conflict";
  }
  return "legacy-detected";
}

export function buildRenameMigrationPreview(input: RenamePreviewInput): RenameMigrationPreview {
  const legacyStatePresent = fs.existsSync(input.legacyStateRoot);
  const targetStatePresent = fs.existsSync(input.targetStateRoot);
  const legacyConfigPresent = fs.existsSync(input.legacyConfigPath);
  const targetConfigPresent = fs.existsSync(input.targetConfigPath);
  const relativeFiles = collectRelativeFiles(input.legacyStateRoot);
  const targetState = assessTargetState(input.targetStateRoot);
  const legacyConfig = readJson(input.legacyConfigPath);
  const targetConfig = readJson(input.targetConfigPath);
  const configBlockers = [legacyConfig.blocker, targetConfig.blocker].filter(
    (value): value is string => Boolean(value)
  );

  let targetConfigDisposition: RenameTargetConfigDisposition = targetConfigPresent
    ? "conflict"
    : "absent";
  let assessmentBlockers: string[] = [];
  if (configBlockers.length === 0) {
    const assessment = assessChatCockpitTargetConfig({
      legacyConfigRaw: legacyConfig.raw,
      targetConfigRaw: targetConfig.raw
    });
    targetConfigDisposition = assessment.disposition;
    assessmentBlockers = assessment.blockers;
  }

  const blockers = [...targetState.blockers, ...configBlockers, ...assessmentBlockers];
  const state = deriveState({
    legacyStatePresent,
    legacyConfigPresent,
    targetStateDisposition: targetState.disposition,
    targetConfigDisposition
  });

  return {
    state,
    legacyStatePresent,
    targetStatePresent,
    legacyConfigPresent,
    targetConfigPresent,
    targetStateDisposition: targetState.disposition,
    targetConfigDisposition,
    blockers,
    manifest: buildRenameMigrationManifest(state, relativeFiles)
  };
}

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  computeWebArtifactDigest,
  verifyWebBuildIntegrity,
  type RuntimeBuildProvenance
} from "../core/build-provenance.js";
import type { TokenPilotPaths } from "../types.js";

export interface UiRuntimeDistribution {
  uiDistDir: string;
  immutableSnapshot: boolean;
}

function snapshotMatches(
  directory: string,
  provenance: RuntimeBuildProvenance
): boolean {
  if (!provenance.webSha256) return false;
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    const marker = JSON.parse(
      fs.readFileSync(path.join(directory, "build-provenance.json"), "utf8")
    ) as Partial<RuntimeBuildProvenance & { schemaVersion?: number }>;
    if (
      marker.schemaVersion !== 2 ||
      marker.version !== provenance.version ||
      marker.buildId !== provenance.buildId ||
      marker.revision !== provenance.revision ||
      marker.builtAt !== provenance.builtAt ||
      marker.sourceDirty !== provenance.sourceDirty ||
      marker.webSha256 !== provenance.webSha256
    ) {
      return false;
    }
    return computeWebArtifactDigest(directory) === provenance.webSha256;
  } catch {
    return false;
  }
}

export function prepareUiRuntimeDistribution(
  paths: TokenPilotPaths,
  runtimeBuildProvenance: RuntimeBuildProvenance | null
): UiRuntimeDistribution {
  const sourceUiDistDir = path.join(paths.installRoot, "web", "dist");
  if (!runtimeBuildProvenance?.webSha256) {
    return { uiDistDir: sourceUiDistDir, immutableSnapshot: false };
  }

  const snapshotRoot = path.join(paths.runtimeDir, "ui-generations");
  const snapshotDir = path.join(snapshotRoot, runtimeBuildProvenance.webSha256);
  if (snapshotMatches(snapshotDir, runtimeBuildProvenance)) {
    return { uiDistDir: snapshotDir, immutableSnapshot: true };
  }

  const sourceIntegrity = verifyWebBuildIntegrity(
    paths.installRoot,
    runtimeBuildProvenance
  );
  if (!sourceIntegrity.ok) {
    return { uiDistDir: sourceUiDistDir, immutableSnapshot: false };
  }

  fs.mkdirSync(snapshotRoot, { recursive: true });
  if (fs.existsSync(snapshotDir)) {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
  const stagingDir = `${snapshotDir}.staging-${process.pid}-${randomUUID()}`;
  try {
    fs.cpSync(sourceUiDistDir, stagingDir, {
      recursive: true,
      dereference: false,
      errorOnExist: true
    });
    if (!snapshotMatches(stagingDir, runtimeBuildProvenance)) {
      throw new Error("UI runtime snapshot failed provenance verification");
    }
    try {
      fs.renameSync(stagingDir, snapshotDir);
    } catch (error) {
      if (!snapshotMatches(snapshotDir, runtimeBuildProvenance)) throw error;
    }
  } finally {
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  if (!snapshotMatches(snapshotDir, runtimeBuildProvenance)) {
    return { uiDistDir: sourceUiDistDir, immutableSnapshot: false };
  }
  return { uiDistDir: snapshotDir, immutableSnapshot: true };
}

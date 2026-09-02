import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildSourceDistributionContext } from "../../src/core/distribution-context.js";
import { buildPaths } from "../../src/core/paths.js";

const fixtureHomes = new Map<string, string>();
const cleanupRoots = new Set<string>();
let cleanupRegistered = false;

function canonical(value: string): string {
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) return resolved;
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.once("exit", () => {
    for (const root of cleanupRoots) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        // Best-effort test cleanup only.
      }
    }
  });
}

export function buildFixturePaths(repoRoot: string): ReturnType<typeof buildPaths> {
  registerCleanup();
  const normalizedRepoRoot = canonical(repoRoot);
  let homeRoot = fixtureHomes.get(normalizedRepoRoot);
  if (!homeRoot) {
    const configuredTempRoot = process.env.TMPDIR?.trim() || os.tmpdir();
    const fixtureBase = fs.existsSync(configuredTempRoot) ? configuredTempRoot : os.tmpdir();
    const fixtureRoot = fs.mkdtempSync(path.join(fixtureBase, "cc-"));
    homeRoot = fixtureRoot;
    fixtureHomes.set(normalizedRepoRoot, homeRoot);
    cleanupRoots.add(fixtureRoot);
  }

  return buildPaths(
    buildSourceDistributionContext(
      normalizedRepoRoot,
      {},
      { ...process.env, HOME: homeRoot }
    )
  );
}

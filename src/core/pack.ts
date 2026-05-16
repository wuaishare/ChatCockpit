import path from "node:path";

import { buildBundleManifest } from "./manifest.js";
import { runCommand } from "./shell.js";
import type { RepoBundleManifest, TokenPilotPaths } from "../types.js";

export function runPack(paths: TokenPilotPaths): RepoBundleManifest {
  const result = runCommand(
    path.join(paths.repoRoot, "node_modules", ".bin", "repomix"),
    ["--config", ".repomix.config.json"],
    paths.repoRoot
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "repomix failed");
  }

  const repomixXmlPath = path.join(paths.workspaceDir, "repomix-output.xml");
  return buildBundleManifest(paths.repoRoot, paths.bundlesDir, repomixXmlPath);
}

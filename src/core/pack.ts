import fs from "node:fs";
import path from "node:path";

import { buildBundleManifest } from "./manifest.js";
import { runCommand } from "./shell.js";
import type { RepoBundleManifest, TokenPilotPaths } from "../types.js";

export function runPack(paths: TokenPilotPaths): RepoBundleManifest {
  const repomixBin = path.join(paths.repoRoot, "node_modules", ".bin", "repomix");
  const repomixCli = path.join(paths.repoRoot, "node_modules", "repomix", "bin", "repomix.cjs");

  if (fs.existsSync(repomixCli)) {
    const result = runCommand(process.execPath, [repomixCli, "--config", ".repomix.config.json"], paths.repoRoot);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "repomix failed");
    }
  } else if (fs.existsSync(repomixBin)) {
    const result = runCommand(repomixBin, ["--config", ".repomix.config.json"], paths.repoRoot);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "repomix failed");
    }
  } else {
    fs.writeFileSync(
      path.join(paths.workspaceDir, "repomix-output.xml"),
      "<repoBundle mode=\"fixture\" />\n",
      "utf8"
    );
  }

  const repomixXmlPath = path.join(paths.workspaceDir, "repomix-output.xml");
  return buildBundleManifest(paths.repoRoot, paths.bundlesDir, repomixXmlPath);
}

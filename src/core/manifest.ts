import fs from "node:fs";
import path from "node:path";

import { writeJson, writeText } from "./files.js";
import type { RepoBundleManifest } from "../types.js";

interface RepomixConfig {
  include?: string[];
}

function readRepomixIncludeEntries(repoRoot: string): string[] {
  const configPath = path.join(repoRoot, ".repomix.config.json");
  if (!fs.existsSync(configPath)) {
    return [];
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as RepomixConfig;
  return (config.include || [])
    .filter((entry) => !entry.endsWith("/**"))
    .map((entry) => entry.replace(/^\.\//, ""))
    .sort();
}

export function buildBundleManifest(
  repoRoot: string,
  bundlesDir: string,
  repomixXmlPath: string
): RepoBundleManifest {
  const createdAt = new Date().toISOString();
  const repoName = path.basename(repoRoot);
  const promptPath = path.join(bundlesDir, "bundle-prompt.md");
  const summaryPath = path.join(bundlesDir, "bundle-summary.md");
  const publicIncludeEntries = readRepomixIncludeEntries(repoRoot);

  const manifest: RepoBundleManifest = {
    createdAt,
    repoId: repoName.toLowerCase(),
    repoName,
    repomixXmlPath: ".tokenpilot/repomix-output.xml",
    promptPath: ".tokenpilot/bundles/bundle-prompt.md",
    summaryPath: ".tokenpilot/bundles/bundle-summary.md",
    publicIncludeEntries,
    sourceFiles: publicIncludeEntries
  };

  writeText(
    promptPath,
    [
      "# TokenPilot Repo Bundle Prompt",
      "",
      `Repo: \`${repoName}\``,
      `Created: \`${createdAt}\``,
      "",
      "Artifacts:",
      `- XML bundle: \`${manifest.repomixXmlPath}\``,
      `- Summary: \`${manifest.summaryPath}\``,
      "",
      "Use this bundle as the high-density repository context input for ChatGPT planning and review."
    ].join("\n")
  );

  writeText(
    summaryPath,
    [
      "# TokenPilot Bundle Summary",
      "",
      `- Repo id: \`${manifest.repoId}\``,
      `- XML bundle: \`${manifest.repomixXmlPath}\``,
      `- Explicit public include entries: \`${publicIncludeEntries.length}\``
    ].join("\n")
  );

  writeJson(path.join(bundlesDir, "bundle-manifest.json"), manifest);
  return manifest;
}

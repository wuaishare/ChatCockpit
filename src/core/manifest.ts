import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { timestampSlug, writeJson, writeText } from "./files.js";
import {
  isPublicRepoBundleIncludeEntry,
  readRepoBundleIncludeEntries
} from "./repo-bundle.js";
import type { RepoBundleManifest } from "../types.js";

export function buildBundleManifest(
  repoRoot: string,
  bundlesDir: string,
  repomixXmlPath: string,
  repoId?: string
): RepoBundleManifest {
  const createdAt = new Date().toISOString();
  const repoName = path.basename(repoRoot);
  const baseName = `bundle-${timestampSlug(new Date(createdAt))}-${crypto.randomUUID().slice(0, 8)}`;
  const promptPath = path.join(bundlesDir, `${baseName}-prompt.md`);
  const summaryPath = path.join(bundlesDir, `${baseName}-summary.md`);
  const manifestPath = path.join(bundlesDir, `${baseName}-manifest.json`);
  const publicIncludeEntries = readRepoBundleIncludeEntries(repoRoot)
    .filter(isPublicRepoBundleIncludeEntry)
    .sort();

  const manifest: RepoBundleManifest = {
    createdAt,
    repoId: repoId?.trim() || repoName.toLowerCase(),
    repoName,
    repomixXmlPath: path.relative(repoRoot, repomixXmlPath).replace(/\\/g, "/"),
    promptPath: path.relative(repoRoot, promptPath).replace(/\\/g, "/"),
    summaryPath: path.relative(repoRoot, summaryPath).replace(/\\/g, "/"),
    manifestPath: path.relative(repoRoot, manifestPath).replace(/\\/g, "/"),
    publicIncludeEntries,
    // Deprecated compatibility field. New code should read publicIncludeEntries.
    sourceFiles: publicIncludeEntries
  };

  writeText(
    promptPath,
    [
      "# ChatCockpit Repo Bundle Prompt",
      "",
      `Repo: \`${repoName}\``,
      `Created: \`${createdAt}\``,
      "",
      "Artifacts:",
      `- XML bundle: \`${manifest.repomixXmlPath}\``,
      `- Summary: \`${manifest.summaryPath}\``,
      `- Manifest: \`${manifest.manifestPath}\``,
      "",
      "Use this bundle as the high-density repository context input for ChatGPT planning and review."
    ].join("\n")
  );

  writeText(
    summaryPath,
    [
      "# ChatCockpit Bundle Summary",
      "",
      `- Repo id: \`${manifest.repoId}\``,
      `- XML bundle: \`${manifest.repomixXmlPath}\``,
      `- Prompt: \`${manifest.promptPath}\``,
      `- Summary: \`${manifest.summaryPath}\``,
      `- Manifest: \`${manifest.manifestPath}\``,
      `- Explicit public include entries: \`${publicIncludeEntries.length}\``
    ].join("\n")
  );

  writeJson(manifestPath, manifest);
  return manifest;
}

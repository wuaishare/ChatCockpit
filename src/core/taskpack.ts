import path from "node:path";

import { writeJson, writeText } from "./files.js";
import type { TaskPackArtifact, TaskPackInput, TokenPilotPaths } from "../types.js";

function toBullet(items: string[] | undefined): string[] {
  if (!items || items.length === 0) return ["- None specified"];
  return items.map((item) => `- ${item}`);
}

export function createTaskPack(
  paths: TokenPilotPaths,
  input: TaskPackInput
): TaskPackArtifact {
  const createdAt = new Date().toISOString();
  const slug = input.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "task-pack";
  const markdownFilePath = path.join(paths.manifestsDir, `${slug}.md`);
  const jsonFilePath = path.join(paths.manifestsDir, `${slug}.json`);
  const markdownPath = `.tokenpilot/manifests/${slug}.md`;
  const jsonPath = `.tokenpilot/manifests/${slug}.json`;

  const markdown = [
    "# Codex Task Pack",
    "",
    `Created: \`${createdAt}\``,
    "",
    "## 1. Task Goal",
    "",
    input.title,
    "",
    "## 2. Background Summary",
    "",
    input.contextSummary?.trim() || input.problem.trim(),
    "",
    "## 3. Task Scope",
    "",
    "### Must Inspect",
    ...toBullet(input.mustInspect),
    "",
    "### May Inspect",
    ...toBullet(input.mayInspect),
    "",
    "### Must Not Modify",
    ...toBullet(input.mustNotModify),
    "",
    "## 4. Execution Requirements",
    "",
    "1. Confirm the real root cause before changing code.",
    "2. Prefer the smallest verifiable change.",
    "3. Avoid unrelated dependency or architecture churn.",
    "4. Keep diffs scoped to the requested area.",
    "",
    "## 5. Verification Commands",
    "",
    ...(input.verificationCommands && input.verificationCommands.length > 0
      ? ["```bash", ...input.verificationCommands, "```"]
      : ["```bash", "# Add project-specific verification commands here", "```"]),
    "",
    "## 6. Acceptance Criteria",
    "",
    ...toBullet(input.acceptanceCriteria),
    "",
    "## 7. Problem Statement",
    "",
    input.problem.trim(),
    ""
  ].join("\n");

  const artifact: TaskPackArtifact = {
    createdAt,
    title: input.title,
    markdownPath,
    jsonPath,
    input
  };

  writeText(markdownFilePath, markdown);
  writeJson(jsonFilePath, artifact);
  return artifact;
}

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();

const forbiddenExactPaths = new Set([
  "docs/governance/decision-evolution.md",
  "docs/governance/confirmed-product-decisions.md",
  "docs/architecture/web-ui-and-provider-strategy.md",
  "docs/architecture/web-ui-mvp-plan.md",
  "docs/architecture/gpt-actions-codex-execution-mvp.md"
]);

const forbiddenPathPrefixes = [
  "docs/exec-plans/",
  ".ops-private/"
];

const forbiddenReferenceTokens = [
  "docs/governance/decision-evolution.md",
  "docs/governance/confirmed-product-decisions.md",
  "docs/architecture/web-ui-and-provider-strategy.md",
  "docs/architecture/web-ui-mvp-plan.md",
  "docs/architecture/gpt-actions-codex-execution-mvp.md",
  "docs/exec-plans/"
];

const requiredPublicContracts = [
  "docs/governance/product-principles.md",
  "docs/zh-CN/governance/product-principles.md",
  "docs/governance/public-vs-private-artifacts.md",
  "docs/zh-CN/governance/public-vs-private-artifacts.md"
];

const fallbackExcludedDirectories = new Set([
  ".git",
  ".ops-private",
  ".tokenpilot",
  ".codex",
  ".servbay",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results"
]);

function normalize(value: string): string {
  return value.split(path.sep).join("/").replace(/^\.\//, "");
}

function hasGitIndex(): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return result.status === 0 && result.stdout.trim() === "true";
}

function listTrackedFiles(): string[] {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, "git ls-files failed");
  return result.stdout.split("\0").filter(Boolean).map(normalize);
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && fallbackExcludedDirectories.has(entry.name)) {
      continue;
    }
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(normalize(path.relative(repoRoot, entryPath)));
    }
  }
  return files;
}

function isForbiddenPath(relativePath: string): boolean {
  return (
    forbiddenExactPaths.has(relativePath) ||
    forbiddenPathPrefixes.some(
      (prefix) => relativePath === prefix.slice(0, -1) || relativePath.startsWith(prefix)
    )
  );
}

for (const contract of requiredPublicContracts) {
  assert.equal(fs.existsSync(path.join(repoRoot, contract)), true, `Missing public contract: ${contract}`);
}

for (const exactPath of forbiddenExactPaths) {
  assert.equal(fs.existsSync(path.join(repoRoot, exactPath)), false, `Private knowledge path exists: ${exactPath}`);
}
assert.equal(fs.existsSync(path.join(repoRoot, "docs", "exec-plans")), false, "Private execution plans must not exist in the public tree");

const files = hasGitIndex() ? listTrackedFiles() : walkFiles(repoRoot);
const forbiddenFiles = files.filter(isForbiddenPath);
assert.deepEqual(forbiddenFiles, [], `Private knowledge paths are public: ${forbiddenFiles.join(", ")}`);

const textFiles = files.filter((relativePath) =>
  relativePath === "README.md" ||
  relativePath === "README.en.md" ||
  relativePath === "AGENTS.md" ||
  relativePath.endsWith(".md")
);

const staleReferences: string[] = [];
for (const relativePath of textFiles) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    continue;
  }
  const content = fs.readFileSync(absolutePath, "utf8");
  for (const token of forbiddenReferenceTokens) {
    if (content.includes(token)) {
      // AGENTS intentionally names retired paths as a repository rule.
      if (relativePath === "AGENTS.md") {
        continue;
      }
      staleReferences.push(`${relativePath} -> ${token}`);
    }
  }
}

assert.deepEqual(staleReferences, [], `Stale private-knowledge references:\n${staleReferences.join("\n")}`);
process.stdout.write("VERIFY_KNOWLEDGE_BOUNDARY_OK\n");

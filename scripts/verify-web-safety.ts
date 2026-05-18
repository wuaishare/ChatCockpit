import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type ScanTarget = {
  label: string;
  dir?: boolean;
  required?: boolean;
  path: string;
  scope: "strict" | "docs";
};

type Finding = {
  target: string;
  pattern: string;
  file: string;
};

const repoRoot = process.cwd();

const targets: ScanTarget[] = [
  { label: "web/src", path: "web/src", dir: true, required: true, scope: "strict" },
  { label: "web/index.html", path: "web/index.html", required: true, scope: "strict" },
  { label: "web/vite.config.ts", path: "web/vite.config.ts", required: true, scope: "strict" },
  { label: "web/dist", path: "web/dist", dir: true, required: false, scope: "strict" },
  { label: "README.md", path: "README.md", required: true, scope: "docs" },
  {
    label: "docs/architecture/web-ui-mvp-plan.md",
    path: "docs/architecture/web-ui-mvp-plan.md",
    required: true,
    scope: "docs"
  },
  {
    label: "docs/architecture/web-ui-and-provider-strategy.md",
    path: "docs/architecture/web-ui-and-provider-strategy.md",
    required: true,
    scope: "docs"
  }
];

const strictPatterns: Array<{ label: string; test: (content: string) => boolean }> = [
  { label: "/Users/ absolute path", test: (content) => content.includes("/Users/") },
  { label: "TOKENPILOT_API_TOKEN assignment", test: (content) => /TOKENPILOT_API_TOKEN\s*=/.test(content) },
  { label: "server.env reference", test: (content) => content.includes("server.env") },
  { label: ".tokenpilot/runtime reference", test: (content) => content.includes(".tokenpilot/runtime") },
  { label: ".codex reference", test: (content) => content.includes(".codex/") || content.includes(".codex\\") },
  { label: ".servbay reference", test: (content) => content.includes(".servbay/") || content.includes(".servbay\\") },
  {
    label: "Authorization Bearer non-test value",
    test: (content) =>
      /Authorization\s*:\s*["'`]?Bearer\s+(?!test-token\b|<|your-|replace-with-|demo-token\b)[^"'`\s<][^"'`\n]*/i.test(
        content
      )
  },
  {
    label: "token-looking secret assignment",
    test: (content) =>
      /\b(token|secret|password|api[_-]?key)\b\s*[:=]\s*["'`](?!test-token|demo-token|replace-with-|your-|tokenpilot\.example\.com)[^"'`\n]{8,}["'`]/i.test(
        content
      )
  }
];

const docPatterns: Array<{ label: string; test: (content: string) => boolean }> = [
  { label: "/Users/ absolute path", test: (content) => content.includes("/Users/") },
  {
    label: "Authorization Bearer non-test value",
    test: (content) =>
      /Authorization\s*:\s*["'`]?Bearer\s+(?!test-token\b|<|your-|replace-with-|demo-token\b)[^"'`\s<][^"'`\n]*/i.test(
        content
      )
  }
];

function walkFiles(targetPath: string): string[] {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return [targetPath];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function relative(filePath: string): string {
  return path.relative(repoRoot, filePath) || filePath;
}

const findings: Finding[] = [];

for (const target of targets) {
  const absolute = path.join(repoRoot, target.path);
  if (!fs.existsSync(absolute)) {
    if (target.required) {
      throw new Error(`Missing required scan target: ${target.path}`);
    }
    continue;
  }

  const files = target.dir ? walkFiles(absolute) : [absolute];
  const patterns = target.scope === "strict" ? strictPatterns : docPatterns;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        findings.push({
          target: target.label,
          pattern: pattern.label,
          file: relative(filePath)
        });
      }
    }
  }
}

const trackedArtifactChecks = [
  ".playwright-mcp",
  ".tokenpilot",
  ".servbay",
  ".codex",
  "docs/superpowers"
];

for (const artifactPath of trackedArtifactChecks) {
  const result = spawnSync("git", ["ls-files", artifactPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `git ls-files failed for ${artifactPath}`);
  assert.equal(
    result.stdout.trim(),
    "",
    `Tracked local artifact detected in git index: ${artifactPath}`
  );
}

if (findings.length > 0) {
  const report = findings
    .map((finding) => `${finding.file} [${finding.target}] -> ${finding.pattern}`)
    .join("\n");
  throw new Error(`Web safety scan failed:\n${report}`);
}

process.stdout.write("VERIFY_WEB_SAFETY_OK\n");

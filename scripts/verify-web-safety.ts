import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type ScanTarget = {
  label: string;
  dir?: boolean;
  required?: boolean;
  path: string;
};

type Finding = {
  target: string;
  pattern: string;
  file: string;
};

const repoRoot = process.cwd();

const targets: ScanTarget[] = [
  { label: "README.md", path: "README.md", required: true },
  { label: "README.zh-CN.md", path: "README.zh-CN.md", required: true },
  { label: "docs", path: "docs", dir: true, required: true },
  { label: "openapi", path: "openapi", dir: true, required: true },
  { label: "scripts", path: "scripts", dir: true, required: true },
  { label: "src", path: "src", dir: true, required: true },
  { label: "web/src", path: "web/src", dir: true, required: true },
  { label: "web/index.html", path: "web/index.html", required: true },
  { label: "web/vite.config.ts", path: "web/vite.config.ts", required: true },
  { label: "web/dist", path: "web/dist", dir: true, required: false },
  { label: "package.json", path: "package.json", required: true },
  { label: ".gitignore", path: ".gitignore", required: true },
  { label: "AGENTS.md", path: "AGENTS.md", required: true }
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const privateHostPattern = /\b(?:https?:\/\/|Host:\s*)tokenpilot\.(?!example\.com\b)[a-z0-9.-]+\.[a-z]{2,}\b/i;
const homePathMarker = "/" + "Users/";
const servBayPathMarker = "/" + "Applications/" + "ServBay";
const localUser = process.env.USER?.trim();
const localUserPattern = localUser ? new RegExp(escapeRegExp(localUser), "i") : null;
const localIpPattern = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/;

const safetyPatterns: Array<{ label: string; test: (content: string) => boolean }> = [
  { label: "local home absolute path", test: (content) => content.includes(homePathMarker) },
  { label: "non-placeholder TokenPilot deployment host", test: (content) => privateHostPattern.test(content) },
  {
    label: "local machine username",
    test: (content) => Boolean(localUserPattern?.test(content))
  },
  {
    label: "local/private IP literal",
    test: (content) => {
      const withoutLoopback = content
        .split(/\r?\n/)
        .filter((line) => !line.includes("127.0.0.1"))
        .join("\n");
      return localIpPattern.test(withoutLoopback);
    }
  },
  { label: "ServBay absolute path", test: (content) => content.includes(servBayPathMarker) },
  {
    label: "literal TOKENPILOT_API_TOKEN assignment",
    test: (content) =>
      /TOKENPILOT_API_TOKEN\s*=\s*(?!your-|replace-with-|demo-token|test-token|\$\{|<)[^\s"'`]+/i.test(content)
  },
  {
    label: "Authorization Bearer non-test value",
    test: (content) =>
      /Authorization\s*:\s*["'`]?Bearer\s+(?!test-token\b|<|your-|replace-with-|demo-token\b|\$\{|\$TOKEN|token\b)[^"'`\s<][^"'`\n]*/i.test(
        content
      )
  },
  {
    label: "token-looking secret assignment",
    test: (content) =>
      /\b(token|secret|password|api[_-]?key)\b\s*[:=]\s*["'`](?!test-token|demo-token|replace-with-|your-|tokenpilot\.example\.com|tokenpilot-web-ui-fixture)[^"'`\n]{8,}["'`]/i.test(
        content
      )
  }
];

const scanFiles = new Map<string, string>();

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

function addScanFile(filePath: string, label: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return;
  }
  if (!scanFiles.has(filePath)) {
    scanFiles.set(filePath, label);
  }
}

function listGitFiles(args: string[]): string[] {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed`);
  return result.stdout.split("\0").filter(Boolean);
}

function scanContent(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !line.includes("TOKENPILOT_API_TOKEN"))
    .join("\n");
}

for (const target of targets) {
  const absolute = path.join(repoRoot, target.path);
  if (!fs.existsSync(absolute)) {
    if (target.required) {
      throw new Error(`Missing required scan target: ${target.path}`);
    }
    continue;
  }

  const files = target.dir ? walkFiles(absolute) : [absolute];
  for (const filePath of files) {
    addScanFile(filePath, target.label);
  }
}

for (const gitFile of [
  ...listGitFiles(["ls-files", "-z"]),
  ...listGitFiles(["ls-files", "--others", "--exclude-standard", "-z"])
]) {
  addScanFile(path.join(repoRoot, gitFile), "git-files");
}

const findings: Finding[] = [];

for (const [filePath, label] of scanFiles) {
  if (
    filePath.endsWith("scripts/verify-web-safety.ts") ||
    filePath.endsWith("scripts/scan-history-privacy.sh")
  ) {
    continue;
  }
  if (/\.(png|webp|jpe?g|gif|ico|woff2?)$/i.test(filePath)) {
    continue;
  }

  const content = scanContent(fs.readFileSync(filePath, "utf8"));
  for (const pattern of safetyPatterns) {
    if (pattern.test(content)) {
      findings.push({
        target: label,
        pattern: pattern.label,
        file: relative(filePath)
      });
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

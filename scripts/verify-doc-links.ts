import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const docsRoot = path.join(repoRoot, "docs");
const markdownFiles = [
  path.join(repoRoot, "README.md"),
  path.join(repoRoot, "README.en.md"),
  ...walkMarkdownFiles(docsRoot)
];

const ignoredSchemes = /^(?:https?:|mailto:|#)/i;
const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;
const failures: string[] = [];
const zhReadme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
const forbiddenZhReadmeTargets = [
  "docs/deployment/",
  "docs/architecture/",
  "docs/engineering/",
  "docs/governance/"
];

function walkMarkdownFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }
  return files;
}

function stripAngleBrackets(value: string): string {
  return value.replace(/^<|>$/g, "");
}

for (const filePath of markdownFiles) {
  const content = fs.readFileSync(filePath, "utf8");
  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = stripAngleBrackets(match[1].trim());
    if (!rawTarget || ignoredSchemes.test(rawTarget)) {
      continue;
    }
    const withoutFragment = rawTarget.split("#")[0];
    if (!withoutFragment) {
      continue;
    }
    const targetPath = path.resolve(path.dirname(filePath), decodeURI(withoutFragment));
    if (!fs.existsSync(targetPath)) {
      failures.push(`${path.relative(repoRoot, filePath)} -> ${rawTarget}`);
    }
  }
}

assert.equal(failures.length, 0, `Broken markdown links:\n${failures.join("\n")}`);
for (const target of forbiddenZhReadmeTargets) {
  assert.equal(
    zhReadme.includes(`](${target}`) || zhReadme.includes(`](./${target}`),
    false,
    `Chinese README should link to docs/zh-CN first, but found ${target}`
  );
}
process.stdout.write("VERIFY_DOC_LINKS_OK\n");

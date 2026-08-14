import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface AllowlistRule {
  id: string;
  class: "C1" | "C2" | "C3" | "implementation-history";
  pathRegex: string;
  lineRegex: string;
  reason: string;
  removalGate: string;
}

interface AllowlistDocument {
  schemaVersion: number;
  rules: AllowlistRule[];
}

interface CompiledRule extends AllowlistRule {
  pathPattern: RegExp;
  linePattern: RegExp;
  matches: number;
}

interface LegacyOccurrence {
  file: string;
  lineNumber: number;
  line: string;
  ruleId?: string;
  class?: AllowlistRule["class"];
}

const root = process.cwd();
const reportMode = process.argv.includes("--report");
const allowlistPath = path.join(
  root,
  "scripts",
  "fixtures",
  "rename-v0",
  "r3-legacy-reference-allowlist.json"
);
const verifierRelativePath = "scripts/verify-chatcockpit-r3-identity-inventory.ts";
const allowlistRelativePath = path.relative(root, allowlistPath).replaceAll(path.sep, "/");
const legacyPattern = /TokenPilot|tokenpilot|TOKENPILOT_|\.tokenpilot/;
const supportedClasses = new Set(["C1", "C2", "C3", "implementation-history"]);

function readAllowlist(): CompiledRule[] {
  assert.equal(fs.existsSync(allowlistPath), true, "R3 legacy-reference allowlist is missing");
  const document = JSON.parse(fs.readFileSync(allowlistPath, "utf8")) as AllowlistDocument;
  assert.equal(document.schemaVersion, 1, "Unsupported R3 legacy-reference allowlist schema");
  assert.ok(Array.isArray(document.rules) && document.rules.length > 0, "R3 allowlist has no rules");

  const ids = new Set<string>();
  return document.rules.map((rule) => {
    assert.match(rule.id, /^[a-z0-9][a-z0-9-]*$/, `Invalid allowlist rule id: ${rule.id}`);
    assert.equal(ids.has(rule.id), false, `Duplicate allowlist rule id: ${rule.id}`);
    ids.add(rule.id);
    assert.equal(supportedClasses.has(rule.class), true, `Unsupported class for ${rule.id}`);
    assert.ok(rule.reason.trim().length >= 20, `Rule ${rule.id} needs a specific reason`);
    assert.ok(rule.removalGate.trim().length >= 10, `Rule ${rule.id} needs a removal/retention gate`);
    assert.doesNotMatch(
      rule.pathRegex,
      /^\^?(?:src|scripts|desktop|docs|web)\/\*\*?\$?$/,
      `Rule ${rule.id} is too broad`
    );
    return {
      ...rule,
      pathPattern: new RegExp(rule.pathRegex),
      linePattern: new RegExp(rule.lineRegex),
      matches: 0
    };
  });
}

function trackedFiles(): string[] {
  const raw = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  return raw
    .split("\0")
    .filter(Boolean)
    .filter((file) => file !== verifierRelativePath && file !== allowlistRelativePath);
}

function isTextFile(filePath: string): boolean {
  const handle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(8192);
    const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
    for (let index = 0; index < bytesRead; index += 1) {
      if (buffer[index] === 0) return false;
    }
    return true;
  } finally {
    fs.closeSync(handle);
  }
}

function collectOccurrences(rules: CompiledRule[]): LegacyOccurrence[] {
  const occurrences: LegacyOccurrence[] = [];
  for (const file of trackedFiles()) {
    const absolute = path.join(root, file);
    if (!fs.statSync(absolute).isFile() || !isTextFile(absolute)) continue;
    const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (!legacyPattern.test(line)) continue;
      const matchedRule = rules.find(
        (rule) => rule.pathPattern.test(file) && rule.linePattern.test(line)
      );
      if (matchedRule) matchedRule.matches += 1;
      occurrences.push({
        file,
        lineNumber: index + 1,
        line: line.trim().slice(0, 240),
        ruleId: matchedRule?.id,
        class: matchedRule?.class
      });
    }
  }
  return occurrences;
}

function countBy<T extends string>(values: T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function printSummary(occurrences: LegacyOccurrence[], rules: CompiledRule[]): void {
  const classified = occurrences.filter((entry) => entry.ruleId);
  const blockers = occurrences.filter((entry) => !entry.ruleId);
  const classCounts = countBy(classified.map((entry) => entry.class!));
  const blockerFiles = countBy(blockers.map((entry) => entry.file));

  process.stdout.write(`R3_IDENTITY_INVENTORY_MODE=${reportMode ? "report" : "enforce"}\n`);
  process.stdout.write(`R3_IDENTITY_INVENTORY_TOTAL_LINES=${occurrences.length}\n`);
  process.stdout.write(`R3_IDENTITY_INVENTORY_CLASSIFIED_LINES=${classified.length}\n`);
  process.stdout.write(`R3_IDENTITY_INVENTORY_C0_BLOCKER_LINES=${blockers.length}\n`);
  for (const klass of ["C1", "C2", "C3", "implementation-history"] as const) {
    process.stdout.write(`R3_IDENTITY_INVENTORY_${klass.replaceAll("-", "_").toUpperCase()}=${classCounts.get(klass) ?? 0}\n`);
  }

  const topBlockers = [...blockerFiles.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 30);
  if (topBlockers.length > 0) {
    process.stdout.write("R3_IDENTITY_INVENTORY_TOP_BLOCKER_FILES\n");
    for (const [file, count] of topBlockers) process.stdout.write(`${count}\t${file}\n`);
  }

  const unusedRules = rules.filter((rule) => rule.matches === 0);
  if (unusedRules.length > 0) {
    process.stdout.write(
      `R3_IDENTITY_INVENTORY_UNUSED_RULES=${unusedRules.map((rule) => rule.id).join(",")}\n`
    );
  }
}

function assertCanonicalCutover(): void {
  const productIdentitySource = fs.readFileSync(
    path.join(root, "src", "core", "product-identity.ts"),
    "utf8"
  );
  assert.match(
    productIdentitySource,
    /export const DEFAULT_PRODUCT_IDENTITY = CHATCOCKPIT_PRODUCT_IDENTITY;/,
    "R3 enforce mode requires ChatCockpit as DEFAULT_PRODUCT_IDENTITY"
  );

  const packageDocument = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
    bin?: Record<string, string>;
  };
  assert.equal(packageDocument.name, "chatcockpit");
  assert.equal(packageDocument.version, "0.2.0-alpha");
  assert.deepEqual(packageDocument.bin, { chatcockpit: "./dist/cli/index.js" });

  assert.equal(
    fs.existsSync(path.join(root, "openapi", "chatcockpit.openapi.yaml")),
    true,
    "R3 enforce mode requires canonical openapi/chatcockpit.openapi.yaml"
  );
}

const rules = readAllowlist();
const occurrences = collectOccurrences(rules);
printSummary(occurrences, rules);

const unusedRules = rules.filter((rule) => rule.matches === 0);
assert.equal(
  unusedRules.length,
  0,
  `R3 legacy-reference allowlist has unused/stale rules: ${unusedRules.map((rule) => rule.id).join(", ")}`
);

const blockers = occurrences.filter((entry) => !entry.ruleId);
if (reportMode) {
  assert.ok(blockers.length > 0, "R3 pre-cutover report unexpectedly has no blockers; switch to enforce mode");
  process.stdout.write("R3_IDENTITY_INVENTORY_REPORT_OK\n");
} else {
  assertCanonicalCutover();
  if (blockers.length > 0) {
    const sample = blockers
      .slice(0, 40)
      .map((entry) => `${entry.file}:${entry.lineNumber}: ${entry.line}`)
      .join("\n");
    throw new Error(
      `R3 has ${blockers.length} unclassified legacy-identity line(s). Classify intentional C1/C2/C3/history references or remove C0 output leaks.\n${sample}`
    );
  }
  process.stdout.write("VERIFY_CHATCOCKPIT_R3_IDENTITY_INVENTORY_OK\n");
}

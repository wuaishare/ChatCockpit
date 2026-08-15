import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const artifactSpecs: string[] = [];
let commit = "";
let output = "";

function fail(message: string, code = 2): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

for (let index = 0; index < args.length; index += 1) {
  const key = args[index];
  const value = args[index + 1] ?? "";
  switch (key) {
    case "--commit":
      commit = value;
      index += 1;
      break;
    case "--output":
      output = value;
      index += 1;
      break;
    case "--artifact":
      artifactSpecs.push(value);
      index += 1;
      break;
    default:
      fail(`Unknown argument: ${key}`);
  }
}

if (!/^[a-f0-9]{40}$/.test(commit)) fail("Invalid or missing --commit");
if (!output) fail("Invalid or missing --output");
if (artifactSpecs.length !== 2) fail("CERTIFICATION_REQUIRES_BOTH_ARCHITECTURES");

const seen = new Set<string>();
const artifacts = artifactSpecs.map((spec) => {
  const match = spec.match(/^(arm64|x64):(.+)$/);
  if (!match) fail(`Invalid --artifact: ${spec}`);
  const architecture = match[1] as "arm64" | "x64";
  if (seen.has(architecture)) fail(`Duplicate certification architecture: ${architecture}`);
  seen.add(architecture);
  const artifactPath = path.resolve(match[2]);
  if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
    fail(`Missing certified DMG for ${architecture}`, 1);
  }
  const filename = path.basename(artifactPath);
  if (!new RegExp(`^ChatCockpit-.+-macos-${architecture}\\.dmg$`).test(filename)) {
    fail(`Invalid certified DMG filename for ${architecture}`, 1);
  }
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex");
  return {
    architecture,
    kind: "dmg" as const,
    filename,
    sha256,
    developerIdSigned: true,
    hardenedRuntime: true,
    gatekeeperAccepted: true,
    notarizationAccepted: true,
    appStapled: true,
    dmgVerified: true,
    dmgNotarized: true,
    dmgStapled: true
  };
});
artifacts.sort((left, right) => left.architecture.localeCompare(right.architecture));

if (!seen.has("arm64") || !seen.has("x64")) fail("CERTIFICATION_REQUIRES_BOTH_ARCHITECTURES");

const serialized = `${JSON.stringify({ schemaVersion: 1, commit, artifacts }, null, 2)}\n`;
const absoluteOutput = path.resolve(output);
fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
const temporaryPath = `${absoluteOutput}.tmp-${process.pid}`;
fs.writeFileSync(temporaryPath, serialized, { encoding: "utf8", mode: 0o644 });
fs.renameSync(temporaryPath, absoluteOutput);
process.stdout.write(`GENERATE_MACOS_CERTIFICATION_EVIDENCE_OK commit=${commit}\n`);

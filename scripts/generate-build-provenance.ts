import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  version: string;
};

function gitRevision(): string | null {
  const fromEnv = process.env.CHATCOCKPIT_BUILD_REVISION?.trim();
  if (fromEnv) return fromEnv.slice(0, 12);
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() || null;
  } catch {
    return null;
  }
}

const builtAt = process.env.CHATCOCKPIT_BUILD_TIMESTAMP?.trim() || new Date().toISOString();
const parsed = new Date(builtAt);
const buildId = process.env.CHATCOCKPIT_BUILD_ID?.trim() || (
  Number.isNaN(parsed.getTime())
    ? null
    : `${String(parsed.getUTCFullYear()).slice(-2)}${String(parsed.getUTCMonth() + 1).padStart(2, "0")}${String(parsed.getUTCDate()).padStart(2, "0")}${String(parsed.getUTCHours()).padStart(2, "0")}${String(parsed.getUTCMinutes()).padStart(2, "0")}`
);

const output = {
  schemaVersion: 1,
  version: packageJson.version,
  buildId,
  revision: gitRevision(),
  builtAt
};

fs.mkdirSync(path.join(repoRoot, "dist"), { recursive: true });
fs.writeFileSync(
  path.join(repoRoot, "dist", "build-provenance.json"),
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8"
);

process.stdout.write(`GENERATE_BUILD_PROVENANCE_OK ${output.version} ${output.buildId ?? "unknown"} ${output.revision ?? "unknown"}\n`);

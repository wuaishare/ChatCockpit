import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { computeRuntimeArtifactDigests } from "../src/core/build-provenance.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  version: string;
};

function gitRevision(): string | null {
  const fromEnv = process.env.CHATCOCKPIT_BUILD_REVISION?.trim();
  if (fromEnv) {
    if (!/^[a-f0-9]{7,40}$/i.test(fromEnv)) {
      throw new Error("CHATCOCKPIT_BUILD_REVISION must be a Git revision hash");
    }
    return fromEnv.slice(0, 12).toLowerCase();
  }
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

function sourceDirty(): boolean | null {
  const fromEnv = process.env.CHATCOCKPIT_BUILD_SOURCE_DIRTY?.trim().toLowerCase();
  if (fromEnv) {
    if (fromEnv === "true") return true;
    if (fromEnv === "false") return false;
    throw new Error("CHATCOCKPIT_BUILD_SOURCE_DIRTY must be true or false");
  }
  try {
    return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim().length > 0;
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
const artifacts = computeRuntimeArtifactDigests(repoRoot);
if (!artifacts.backendSha256 || !artifacts.webSha256) {
  throw new Error("Build provenance requires both compiled backend and Web UI artifacts");
}

const output = {
  schemaVersion: 2 as const,
  version: packageJson.version,
  buildId,
  revision: gitRevision(),
  builtAt,
  sourceDirty: sourceDirty(),
  backendSha256: artifacts.backendSha256,
  webSha256: artifacts.webSha256
};
const serialized = `${JSON.stringify(output, null, 2)}\n`;

fs.mkdirSync(path.join(repoRoot, "dist"), { recursive: true });
fs.writeFileSync(path.join(repoRoot, "dist", "build-provenance.json"), serialized, "utf8");
fs.mkdirSync(path.join(repoRoot, "web", "dist"), { recursive: true });
fs.writeFileSync(path.join(repoRoot, "web", "dist", "build-provenance.json"), serialized, "utf8");

process.stdout.write(
  `GENERATE_BUILD_PROVENANCE_OK ${output.version} ${output.buildId ?? "unknown"} ${output.revision ?? "unknown"} dirty=${output.sourceDirty ?? "unknown"}\n`
);

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RuntimeBuildProvenance {
  version: string;
  buildId: string | null;
  revision: string | null;
  builtAt: string | null;
}

interface PersistedBuildProvenance extends RuntimeBuildProvenance {
  schemaVersion: 1;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const provenancePath = path.join(repoRoot, "dist", "build-provenance.json");
const packagePath = path.join(repoRoot, "package.json");

function packageVersion(): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : "unknown";
  } catch {
    return "unknown";
  }
}

export function readRuntimeBuildProvenance(): RuntimeBuildProvenance {
  try {
    const parsed = JSON.parse(fs.readFileSync(provenancePath, "utf8")) as Partial<PersistedBuildProvenance>;
    if (parsed.schemaVersion !== 1 || typeof parsed.version !== "string" || !parsed.version.trim()) {
      throw new Error("invalid build provenance");
    }
    return {
      version: parsed.version.trim(),
      buildId: typeof parsed.buildId === "string" && parsed.buildId.trim() ? parsed.buildId.trim() : null,
      revision: typeof parsed.revision === "string" && /^[a-f0-9]{7,40}$/i.test(parsed.revision.trim())
        ? parsed.revision.trim()
        : null,
      builtAt: typeof parsed.builtAt === "string" && !Number.isNaN(Date.parse(parsed.builtAt))
        ? parsed.builtAt
        : null
    };
  } catch {
    return {
      version: packageVersion(),
      buildId: null,
      revision: null,
      builtAt: null
    };
  }
}

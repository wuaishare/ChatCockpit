import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RuntimeBuildProvenance {
  version: string;
  buildId: string | null;
  revision: string | null;
  builtAt: string | null;
  sourceDirty: boolean | null;
  backendSha256: string | null;
  webSha256: string | null;
}

interface PersistedBuildProvenance extends RuntimeBuildProvenance {
  schemaVersion: 2;
}

export type RuntimeBuildIntegrityCode =
  | "ok"
  | "provenance-unavailable"
  | "web-generation-missing"
  | "web-generation-mismatch"
  | "backend-artifact-mismatch"
  | "web-artifact-mismatch"
  | "source-not-clean"
  | "revision-mismatch";

export interface RuntimeBuildIntegrityResult {
  ok: boolean;
  code: RuntimeBuildIntegrityCode;
  provenance: RuntimeBuildProvenance;
  actualBackendSha256: string | null;
  actualWebSha256: string | null;
}

const defaultInstallRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROVENANCE_FILE = "build-provenance.json";
const WEB_PROVENANCE_RELATIVE_PATH = path.join("web", "dist", PROVENANCE_FILE);
const BACKEND_EXCLUDED_TOP_LEVEL = new Set([
  "macos",
  "macos-distribution",
  "macos-dmg",
  "macos-runtime",
  "macos-xcode",
  "release",
  "runtime-cache",
  "xcode-derived"
]);

function packageVersion(installRoot: string): string {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(installRoot, "package.json"), "utf8")
    ) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : "unknown";
  } catch {
    return "unknown";
  }
}

function fallbackProvenance(installRoot: string): RuntimeBuildProvenance {
  return {
    version: packageVersion(installRoot),
    buildId: null,
    revision: null,
    builtAt: null,
    sourceDirty: null,
    backendSha256: null,
    webSha256: null
  };
}

function parsePersistedProvenance(filePath: string): PersistedBuildProvenance | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<PersistedBuildProvenance>;
    if (
      parsed.schemaVersion !== 2 ||
      typeof parsed.version !== "string" ||
      !parsed.version.trim()
    ) {
      return null;
    }
    const sha = (value: unknown): string | null =>
      typeof value === "string" && /^[a-f0-9]{64}$/i.test(value.trim())
        ? value.trim().toLowerCase()
        : null;
    return {
      schemaVersion: 2,
      version: parsed.version.trim(),
      buildId:
        typeof parsed.buildId === "string" && parsed.buildId.trim()
          ? parsed.buildId.trim()
          : null,
      revision:
        typeof parsed.revision === "string" && /^[a-f0-9]{7,40}$/i.test(parsed.revision.trim())
          ? parsed.revision.trim().toLowerCase()
          : null,
      builtAt:
        typeof parsed.builtAt === "string" && !Number.isNaN(Date.parse(parsed.builtAt))
          ? parsed.builtAt
          : null,
      sourceDirty: typeof parsed.sourceDirty === "boolean" ? parsed.sourceDirty : null,
      backendSha256: sha(parsed.backendSha256),
      webSha256: sha(parsed.webSha256)
    };
  } catch {
    return null;
  }
}

function publicProvenance(value: PersistedBuildProvenance): RuntimeBuildProvenance {
  const { schemaVersion: _schemaVersion, ...provenance } = value;
  return provenance;
}

function collectTreeFiles(
  root: string,
  options: {
    excludedRelativePaths?: ReadonlySet<string>;
    excludedTopLevel?: ReadonlySet<string>;
  } = {}
): string[] {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      const topLevel = relativePath.split("/", 1)[0]!;
      if (options.excludedTopLevel?.has(topLevel)) continue;
      if (options.excludedRelativePaths?.has(relativePath)) continue;
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(relativePath);
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function treeSha256(
  root: string,
  options: {
    excludedRelativePaths?: ReadonlySet<string>;
    excludedTopLevel?: ReadonlySet<string>;
  } = {}
): string | null {
  const files = collectTreeFiles(root, options);
  if (files.length === 0) return null;
  const digest = createHash("sha256");
  for (const relativePath of files) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    digest.update(relativePath, "utf8");
    digest.update("\0", "utf8");
    if (fs.lstatSync(absolutePath).isSymbolicLink()) {
      digest.update(`link:${fs.readlinkSync(absolutePath)}`, "utf8");
    } else {
      digest.update(fs.readFileSync(absolutePath));
    }
    digest.update("\0", "utf8");
  }
  return digest.digest("hex");
}

export function computeWebArtifactDigest(webDistDir: string): string | null {
  return treeSha256(path.resolve(webDistDir), {
    excludedRelativePaths: new Set([PROVENANCE_FILE])
  });
}

export function computeRuntimeArtifactDigests(
  installRoot = defaultInstallRoot
): { backendSha256: string | null; webSha256: string | null } {
  const root = path.resolve(installRoot);
  return {
    backendSha256: treeSha256(path.join(root, "dist"), {
      excludedRelativePaths: new Set([PROVENANCE_FILE]),
      excludedTopLevel: BACKEND_EXCLUDED_TOP_LEVEL
    }),
    webSha256: computeWebArtifactDigest(path.join(root, "web", "dist"))
  };
}

export function readRuntimeBuildProvenance(
  installRoot = defaultInstallRoot
): RuntimeBuildProvenance {
  const root = path.resolve(installRoot);
  const parsed = parsePersistedProvenance(path.join(root, "dist", PROVENANCE_FILE));
  return parsed ? publicProvenance(parsed) : fallbackProvenance(root);
}

function sameGeneration(
  canonical: RuntimeBuildProvenance,
  webMarker: RuntimeBuildProvenance
): boolean {
  return (
    canonical.version === webMarker.version &&
    canonical.buildId === webMarker.buildId &&
    canonical.revision === webMarker.revision &&
    canonical.builtAt === webMarker.builtAt &&
    canonical.sourceDirty === webMarker.sourceDirty &&
    canonical.backendSha256 === webMarker.backendSha256 &&
    canonical.webSha256 === webMarker.webSha256
  );
}

export function verifyRuntimeBuildIntegrity(
  installRoot = defaultInstallRoot,
  options: { requireCleanSource?: boolean; expectedRevision?: string | null } = {}
): RuntimeBuildIntegrityResult {
  const root = path.resolve(installRoot);
  const canonical = parsePersistedProvenance(path.join(root, "dist", PROVENANCE_FILE));
  if (!canonical || !canonical.backendSha256 || !canonical.webSha256) {
    return {
      ok: false,
      code: "provenance-unavailable",
      provenance: fallbackProvenance(root),
      actualBackendSha256: null,
      actualWebSha256: null
    };
  }
  const provenance = publicProvenance(canonical);
  if (options.requireCleanSource && canonical.sourceDirty !== false) {
    return {
      ok: false,
      code: "source-not-clean",
      provenance,
      actualBackendSha256: null,
      actualWebSha256: null
    };
  }
  const expectedRevision = options.expectedRevision?.trim().toLowerCase() || null;
  if (
    expectedRevision &&
    (!canonical.revision ||
      !(
        expectedRevision.startsWith(canonical.revision) ||
        canonical.revision.startsWith(expectedRevision)
      ))
  ) {
    return {
      ok: false,
      code: "revision-mismatch",
      provenance,
      actualBackendSha256: null,
      actualWebSha256: null
    };
  }
  const webMarker = parsePersistedProvenance(path.join(root, WEB_PROVENANCE_RELATIVE_PATH));
  if (!webMarker) {
    return {
      ok: false,
      code: "web-generation-missing",
      provenance,
      actualBackendSha256: null,
      actualWebSha256: null
    };
  }
  if (!sameGeneration(canonical, webMarker)) {
    return {
      ok: false,
      code: "web-generation-mismatch",
      provenance,
      actualBackendSha256: null,
      actualWebSha256: null
    };
  }
  const actual = computeRuntimeArtifactDigests(root);
  if (actual.backendSha256 !== canonical.backendSha256) {
    return {
      ok: false,
      code: "backend-artifact-mismatch",
      provenance,
      actualBackendSha256: actual.backendSha256,
      actualWebSha256: actual.webSha256
    };
  }
  if (actual.webSha256 !== canonical.webSha256) {
    return {
      ok: false,
      code: "web-artifact-mismatch",
      provenance,
      actualBackendSha256: actual.backendSha256,
      actualWebSha256: actual.webSha256
    };
  }
  return {
    ok: true,
    code: "ok",
    provenance,
    actualBackendSha256: actual.backendSha256,
    actualWebSha256: actual.webSha256
  };
}

export function verifyWebBuildGeneration(
  installRoot = defaultInstallRoot,
  expectedProvenance: RuntimeBuildProvenance | null = null
): RuntimeBuildIntegrityResult {
  const root = path.resolve(installRoot);
  const canonical = expectedProvenance
    ? null
    : parsePersistedProvenance(path.join(root, "dist", PROVENANCE_FILE));
  const provenance = expectedProvenance ?? (canonical ? publicProvenance(canonical) : null);
  if (!provenance || !provenance.webSha256) {
    return {
      ok: false,
      code: "provenance-unavailable",
      provenance: provenance ?? fallbackProvenance(root),
      actualBackendSha256: null,
      actualWebSha256: null
    };
  }
  const webMarker = parsePersistedProvenance(path.join(root, WEB_PROVENANCE_RELATIVE_PATH));
  if (!webMarker) {
    return {
      ok: false,
      code: "web-generation-missing",
      provenance,
      actualBackendSha256: null,
      actualWebSha256: null
    };
  }
  if (!sameGeneration(provenance, publicProvenance(webMarker))) {
    return {
      ok: false,
      code: "web-generation-mismatch",
      provenance,
      actualBackendSha256: null,
      actualWebSha256: null
    };
  }
  return {
    ok: true,
    code: "ok",
    provenance,
    actualBackendSha256: null,
    actualWebSha256: null
  };
}

export function verifyWebBuildIntegrity(
  installRoot = defaultInstallRoot,
  expectedProvenance: RuntimeBuildProvenance | null = null
): RuntimeBuildIntegrityResult {
  const generation = verifyWebBuildGeneration(installRoot, expectedProvenance);
  if (!generation.ok) return generation;
  const root = path.resolve(installRoot);
  const actualWebSha256 = treeSha256(path.join(root, "web", "dist"), {
    excludedRelativePaths: new Set([PROVENANCE_FILE])
  });
  const expectedWebSha256 = generation.provenance.webSha256;
  return {
    ...generation,
    ok: actualWebSha256 === expectedWebSha256,
    code: actualWebSha256 === expectedWebSha256 ? "ok" : "web-artifact-mismatch",
    actualWebSha256
  };
}

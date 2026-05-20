import fs from "node:fs";
import path from "node:path";

import type {
  JobArtifactKey,
  JobRecord,
  TokenPilotJobArtifactSummary,
  TokenPilotJobPayload,
  TokenPilotPaths
} from "../types.js";

const MAX_ARTIFACT_BYTES = 256 * 1024;
const TEXT_ARTIFACT_EXTENSIONS = new Set([".md", ".txt", ".json", ".xml"]);

interface ResolvedJobArtifact extends TokenPilotJobArtifactSummary {
  diskPath: string;
}

function ensureArtifactPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const normalized = path.posix.normalize(value).replace(/^\.\/+/, "");
  if (
    path.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("\\") ||
    !normalized.startsWith(".tokenpilot/")
  ) {
    return null;
  }

  return normalized;
}

function buildArtifactSummary(
  key: JobArtifactKey,
  label: string,
  contentType: string,
  relativePath: unknown,
  paths: TokenPilotPaths
): ResolvedJobArtifact | null {
  const safeRelativePath = ensureArtifactPath(relativePath);
  if (!safeRelativePath) {
    return null;
  }

  const diskPath = path.join(paths.repoRoot, safeRelativePath);
  if (!fs.existsSync(diskPath) || !fs.statSync(diskPath).isFile()) {
    return null;
  }

  const ext = path.extname(diskPath).toLowerCase();
  if (!TEXT_ARTIFACT_EXTENSIONS.has(ext)) {
    return null;
  }

  return {
    key,
    label,
    path: safeRelativePath,
    contentType,
    diskPath
  };
}

export function listJobArtifacts(
  job: JobRecord<TokenPilotJobPayload>,
  paths: TokenPilotPaths
): ResolvedJobArtifact[] {
  if (!job.result || typeof job.result !== "object" || Array.isArray(job.result)) {
    return [];
  }

  const result = job.result as Record<string, unknown>;

  if (job.type === "pack") {
    return [
      buildArtifactSummary("repomixXml", "Repomix XML", "application/xml", result.repomixXmlPath, paths),
      buildArtifactSummary("prompt", "Bundle Prompt", "text/markdown", result.promptPath, paths),
      buildArtifactSummary("summary", "Bundle Summary", "text/markdown", result.summaryPath, paths),
      buildArtifactSummary("manifest", "Bundle Manifest", "application/json", result.manifestPath, paths)
    ].filter((artifact): artifact is ResolvedJobArtifact => Boolean(artifact));
  }

  if (job.type === "taskpack") {
    return [
      buildArtifactSummary("markdown", "Task Pack Markdown", "text/markdown", result.markdownPath, paths),
      buildArtifactSummary("json", "Task Pack JSON", "application/json", result.jsonPath, paths)
    ].filter((artifact): artifact is ResolvedJobArtifact => Boolean(artifact));
  }

  return [];
}

export function readJobArtifact(
  job: JobRecord<TokenPilotJobPayload>,
  paths: TokenPilotPaths,
  artifactKey: JobArtifactKey
): {
  artifact: TokenPilotJobArtifactSummary;
  content: string;
  truncated: boolean;
  size: number;
  encoding: string;
} {
  const artifact = listJobArtifacts(job, paths).find((entry) => entry.key === artifactKey);
  if (!artifact) {
    throw new Error(`Artifact not found for key: ${artifactKey}`);
  }

  const raw = fs.readFileSync(artifact.diskPath, "utf8");
  const size = Buffer.byteLength(raw, "utf8");
  const truncated = size > MAX_ARTIFACT_BYTES;
  const content = truncated
    ? Buffer.from(raw, "utf8").subarray(0, MAX_ARTIFACT_BYTES).toString("utf8")
    : raw;

  return {
    artifact: {
      key: artifact.key,
      label: artifact.label,
      path: artifact.path,
      contentType: artifact.contentType
    },
    content,
    truncated,
    size,
    encoding: "utf8"
  };
}

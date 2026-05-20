import fs from "node:fs";
import path from "node:path";

import type {
  JobArtifactKey,
  JobRecord,
  TokenPilotJobArtifactSummary,
  TokenPilotJobPayload,
  TokenPilotTextPreview,
  TokenPilotPaths
} from "../types.js";

const MAX_ARTIFACT_BYTES = 64 * 1024;
const MAX_ARTIFACT_CHUNK_BYTES = 64 * 1024;
const TEXT_ARTIFACT_EXTENSIONS = new Set([".md", ".txt", ".json", ".xml"]);

interface ResolvedJobArtifact extends TokenPilotJobArtifactSummary {
  diskPath: string;
}

function isUtf8Boundary(buffer: Buffer, offset: number): boolean {
  if (offset <= 0 || offset >= buffer.length) {
    return true;
  }

  return (buffer[offset] & 0b1100_0000) !== 0b1000_0000;
}

function assertUtf8Boundary(buffer: Buffer, offset: number): void {
  if (!isUtf8Boundary(buffer, offset)) {
    throw new Error("offset must align to a UTF-8 boundary");
  }
}

function resolveChunkEnd(buffer: Buffer, offset: number, requestedEnd: number): number {
  let end = Math.min(buffer.length, requestedEnd);

  while (end > offset && !isUtf8Boundary(buffer, end)) {
    end -= 1;
  }

  if (end > offset) {
    return end;
  }

  end = Math.min(buffer.length, requestedEnd);
  while (end < buffer.length && !isUtf8Boundary(buffer, end)) {
    end += 1;
  }

  return end;
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
  artifactKey: JobArtifactKey,
  options?: { offset?: number; limit?: number }
): {
  artifact: TokenPilotJobArtifactSummary;
  preview: TokenPilotTextPreview;
} {
  const artifact = listJobArtifacts(job, paths).find((entry) => entry.key === artifactKey);
  if (!artifact) {
    throw new Error(`Artifact not found for key: ${artifactKey}`);
  }

  const sourceBuffer = fs.readFileSync(artifact.diskPath);
  const size = sourceBuffer.length;
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const limit = Math.max(
    1,
    Math.min(MAX_ARTIFACT_CHUNK_BYTES, Math.floor(options?.limit ?? MAX_ARTIFACT_BYTES))
  );
  assertUtf8Boundary(sourceBuffer, offset);
  const end = resolveChunkEnd(sourceBuffer, offset, offset + limit);
  const previewBuffer = sourceBuffer.subarray(offset, end);
  const content = previewBuffer.toString("utf8");
  const nextOffset = end;
  const eof = nextOffset >= size;
  const truncated = offset > 0 || !eof;

  return {
    artifact: {
      key: artifact.key,
      label: artifact.label,
      path: artifact.path,
      contentType: artifact.contentType
    },
    preview: {
      path: artifact.path,
      content,
      truncated,
      size,
      encoding: "utf8",
      returnedBytes: previewBuffer.length,
      maxBytes: limit,
      previewMode: "head",
      offset,
      nextOffset: eof ? null : nextOffset,
      eof
    }
  };
}

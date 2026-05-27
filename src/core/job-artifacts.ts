import fs from "node:fs";
import path from "node:path";

import { loadUserConfig, resolveRepoMapping } from "./config.js";
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
const TEXT_ARTIFACT_EXTENSIONS = new Set([".md", ".txt", ".json", ".xml", ".jsonl", ".patch", ".diff"]);

interface ResolvedJobArtifact extends TokenPilotJobArtifactSummary {
  diskPath: string;
}

function resolveArtifactRepoRoot(
  job: JobRecord<TokenPilotJobPayload>,
  paths: TokenPilotPaths
): string {
  if (job.type !== "pack") {
    return paths.repoRoot;
  }

  const repoId =
    (typeof (job.result as { repoId?: unknown } | undefined)?.repoId === "string"
      ? (job.result as { repoId?: string }).repoId
      : undefined) ||
    (typeof (job.payload as { repoId?: unknown } | undefined)?.repoId === "string"
      ? (job.payload as { repoId?: string }).repoId
      : undefined);

  if (!repoId) {
    return paths.repoRoot;
  }

  try {
    const config = loadUserConfig(paths.repoRoot);
    return resolveRepoMapping(config, repoId).repoRoot;
  } catch {
    return paths.repoRoot;
  }
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
  repoRoot: string
): ResolvedJobArtifact | null {
  const safeRelativePath = ensureArtifactPath(relativePath);
  if (!safeRelativePath) {
    return null;
  }

  const diskPath = path.join(repoRoot, safeRelativePath);
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
  const artifactRepoRoot = resolveArtifactRepoRoot(job, paths);

  if (job.type === "pack") {
    return [
      buildArtifactSummary("repomixXml", "Repomix XML", "application/xml", result.repomixXmlPath, artifactRepoRoot),
      buildArtifactSummary("prompt", "Bundle Prompt", "text/markdown", result.promptPath, artifactRepoRoot),
      buildArtifactSummary("summary", "Bundle Summary", "text/markdown", result.summaryPath, artifactRepoRoot),
      buildArtifactSummary("manifest", "Bundle Manifest", "application/json", result.manifestPath, artifactRepoRoot)
    ].filter((artifact): artifact is ResolvedJobArtifact => Boolean(artifact));
  }

  if (job.type === "taskpack") {
    return [
      buildArtifactSummary("markdown", "Task Pack Markdown", "text/markdown", result.markdownPath, artifactRepoRoot),
      buildArtifactSummary("json", "Task Pack JSON", "application/json", result.jsonPath, artifactRepoRoot)
    ].filter((artifact): artifact is ResolvedJobArtifact => Boolean(artifact));
  }

  if (job.type === "codex-run") {
    return [
      buildArtifactSummary("codexPrompt", "Codex Prompt", "text/markdown", result.promptPath, artifactRepoRoot),
      buildArtifactSummary("codexStdout", "Codex JSONL Output", "application/jsonl", result.stdoutPath, artifactRepoRoot),
      buildArtifactSummary("codexStderr", "Codex Stderr", "text/plain", result.stderrPath, artifactRepoRoot),
      buildArtifactSummary("codexDiff", "Git Diff", "text/x-diff", result.diffPath, artifactRepoRoot),
      buildArtifactSummary("codexReview", "Codex Review", "text/markdown", result.reviewPath, artifactRepoRoot),
      buildArtifactSummary("codexSummary", "Codex Summary", "application/json", result.summaryPath, artifactRepoRoot)
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

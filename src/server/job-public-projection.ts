import type {
  JobRecord,
  TokenPilotJobPayload,
  TokenPilotPaths,
  TokenPilotPublicJobRecord
} from "../types.js";
import { getTrackedJobProcess } from "../core/job-processes.js";
import { listJobArtifacts } from "../core/job-artifacts.js";

function normalizePackLikeObject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = { ...(value as Record<string, unknown>) };

  if (typeof record.repoRoot === "string" && typeof record.repoId !== "string") {
    record.repoId = "tokenpilot";
  }

  delete record.repoRoot;
  return record;
}

function projectPackLikeObject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = normalizePackLikeObject(value) as Record<string, unknown>;
  return {
    ...(typeof record.createdAt === "string" ? { createdAt: record.createdAt } : {}),
    ...(typeof record.repoId === "string" ? { repoId: record.repoId } : {}),
    ...(typeof record.repoName === "string" ? { repoName: record.repoName } : {}),
    ...(typeof record.repomixXmlPath === "string"
      ? { repomixXmlPath: record.repomixXmlPath }
      : {}),
    ...(typeof record.promptPath === "string" ? { promptPath: record.promptPath } : {}),
    ...(typeof record.summaryPath === "string" ? { summaryPath: record.summaryPath } : {}),
    ...(typeof record.manifestPath === "string" ? { manifestPath: record.manifestPath } : {}),
    ...(Array.isArray(record.publicIncludeEntries)
      ? { publicIncludeEntries: record.publicIncludeEntries }
      : {})
  };
}

function projectTaskPackLikeObject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.createdAt === "string" ? { createdAt: record.createdAt } : {}),
    ...(typeof record.title === "string" ? { title: record.title } : {}),
    ...(typeof record.markdownPath === "string"
      ? { markdownPath: record.markdownPath }
      : {}),
    ...(typeof record.jsonPath === "string" ? { jsonPath: record.jsonPath } : {})
  };
}

function projectCodexRunLikeObject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.createdAt === "string" ? { createdAt: record.createdAt } : {}),
    ...(typeof record.repoId === "string" ? { repoId: record.repoId } : {}),
    ...(typeof record.title === "string" ? { title: record.title } : {}),
    ...(typeof record.executionMode === "string" ? { executionMode: record.executionMode } : {}),
    ...(typeof record.worktreePolicy === "string" ? { worktreePolicy: record.worktreePolicy } : {}),
    ...(typeof record.worktreeCreated === "boolean" ? { worktreeCreated: record.worktreeCreated } : {}),
    ...(typeof record.branchName === "string" ? { branchName: record.branchName } : {}),
    ...(typeof record.statusSummary === "string" ? { statusSummary: record.statusSummary } : {}),
    ...(typeof record.codexExitCode === "number" ? { codexExitCode: record.codexExitCode } : {}),
    ...(typeof record.reviewExitCode === "number" ? { reviewExitCode: record.reviewExitCode } : {}),
    ...(typeof record.gitStatus === "string" ? { gitStatus: record.gitStatus } : {}),
    ...(typeof record.hasDiff === "boolean" ? { hasDiff: record.hasDiff } : {}),
    ...(record.commit && typeof record.commit === "object" ? { commit: record.commit } : {}),
    ...(typeof record.promptPath === "string" ? { promptPath: record.promptPath } : {}),
    ...(typeof record.stdoutPath === "string" ? { stdoutPath: record.stdoutPath } : {}),
    ...(typeof record.stderrPath === "string" ? { stderrPath: record.stderrPath } : {}),
    ...(typeof record.diffPath === "string" ? { diffPath: record.diffPath } : {}),
    ...(typeof record.reviewPath === "string" ? { reviewPath: record.reviewPath } : {}),
    ...(typeof record.summaryPath === "string" ? { summaryPath: record.summaryPath } : {}),
    ...(Array.isArray(record.artifacts) ? { artifacts: record.artifacts } : {})
  };
}

function toRelativeRepoPath(value: string, repoRoot: string): string {
  const repoRootPrefix = `${repoRoot}/`;
  if (value === repoRoot) {
    return "<repo>";
  }
  if (value.startsWith(repoRootPrefix)) {
    return value.slice(repoRootPrefix.length);
  }
  return value.split(repoRootPrefix).join("<repo>/").split(repoRoot).join("<repo>");
}

export function sanitizeForApi(value: unknown, repoRoot: string): unknown {
  if (typeof value === "string") {
    return toRelativeRepoPath(value, repoRoot);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForApi(item, repoRoot));
  }

  if (value && typeof value === "object") {
    const normalized = normalizePackLikeObject(value) as Record<string, unknown>;
    const sanitized = Object.fromEntries(
      Object.entries(normalized).map(([key, nestedValue]) => [
        key,
        sanitizeForApi(nestedValue, repoRoot)
      ])
    );

    if (sanitized.type === "pack" && sanitized.payload && typeof sanitized.payload === "object") {
      sanitized.payload = projectPackLikeObject(sanitized.payload);
    }
    if (sanitized.type === "pack" && sanitized.result && typeof sanitized.result === "object") {
      sanitized.result = projectPackLikeObject(sanitized.result);
    }
    if (sanitized.type === "taskpack" && sanitized.payload && typeof sanitized.payload === "object") {
      sanitized.payload = projectTaskPackLikeObject(sanitized.payload);
    }
    if (sanitized.type === "taskpack" && sanitized.result && typeof sanitized.result === "object") {
      sanitized.result = projectTaskPackLikeObject(sanitized.result);
    }
    if (sanitized.type === "codex-run" && sanitized.payload && typeof sanitized.payload === "object") {
      sanitized.payload = projectCodexRunLikeObject(sanitized.payload);
    }
    if (sanitized.type === "codex-run" && sanitized.result && typeof sanitized.result === "object") {
      sanitized.result = projectCodexRunLikeObject(sanitized.result);
    }

    return sanitized;
  }

  return value;
}

function maskError(error: string | undefined, repoRoot: string): string | undefined {
  if (!error) return undefined;
  const firstLine = error.split("\n")[0] ?? error;
  return toRelativeRepoPath(firstLine, repoRoot);
}

function deriveJobHeadline(job: JobRecord<TokenPilotJobPayload>): string {
  if (job.type === "taskpack") {
    const title = (job.payload as { title?: unknown }).title;
    return typeof title === "string" && title.trim() ? title.trim() : "Task pack job";
  }
  if (job.type === "pack") {
    const repoId = (job.payload as { repoId?: unknown }).repoId;
    return typeof repoId === "string" && repoId.trim()
      ? `Pack repo ${repoId.trim()}`
      : "Pack job";
  }
  if (job.type === "codex-run") {
    const title = (job.payload as { title?: unknown }).title;
    return typeof title === "string" && title.trim() ? title.trim() : "Codex run job";
  }
  return "TokenPilot job";
}

function projectJobPayloadForUi(
  job: JobRecord<TokenPilotJobPayload>,
  repoRoot: string
): Record<string, unknown> {
  if (job.type === "taskpack") {
    const payload = job.payload as unknown as Record<string, unknown>;
    return { title: typeof payload.title === "string" ? payload.title : undefined };
  }
  if (job.type === "pack") {
    const payload = sanitizeForApi(job.payload, repoRoot) as Record<string, unknown>;
    return { repoId: typeof payload.repoId === "string" ? payload.repoId : undefined };
  }
  if (job.type === "codex-run") {
    const payload = sanitizeForApi(job.payload, repoRoot) as Record<string, unknown>;
    return {
      repoId: typeof payload.repoId === "string" ? payload.repoId : undefined,
      title: typeof payload.title === "string" ? payload.title : undefined,
      executionMode: typeof payload.executionMode === "string" ? payload.executionMode : undefined,
      worktreePolicy: typeof payload.worktreePolicy === "string" ? payload.worktreePolicy : undefined,
      commitPolicy: typeof payload.commitPolicy === "string" ? payload.commitPolicy : undefined
    };
  }
  return {};
}

function projectJobResultForUi(
  job: JobRecord<TokenPilotJobPayload>,
  repoRoot: string
): Record<string, unknown> | undefined {
  if (!job.result || typeof job.result !== "object" || Array.isArray(job.result)) {
    return undefined;
  }

  const result = sanitizeForApi(job.result, repoRoot) as Record<string, unknown>;
  if (job.type === "taskpack") {
    return {
      createdAt: typeof result.createdAt === "string" ? result.createdAt : undefined,
      title: typeof result.title === "string" ? result.title : undefined,
      markdownPath: typeof result.markdownPath === "string" ? result.markdownPath : undefined,
      jsonPath: typeof result.jsonPath === "string" ? result.jsonPath : undefined
    };
  }
  if (job.type === "pack") {
    return {
      createdAt: typeof result.createdAt === "string" ? result.createdAt : undefined,
      repoId: typeof result.repoId === "string" ? result.repoId : undefined,
      repoName: typeof result.repoName === "string" ? result.repoName : undefined,
      repomixXmlPath: typeof result.repomixXmlPath === "string" ? result.repomixXmlPath : undefined,
      promptPath: typeof result.promptPath === "string" ? result.promptPath : undefined,
      summaryPath: typeof result.summaryPath === "string" ? result.summaryPath : undefined,
      manifestPath: typeof result.manifestPath === "string" ? result.manifestPath : undefined,
      publicIncludeEntries: Array.isArray(result.publicIncludeEntries)
        ? result.publicIncludeEntries
        : undefined
    };
  }
  if (job.type === "codex-run") {
    return {
      createdAt: typeof result.createdAt === "string" ? result.createdAt : undefined,
      repoId: typeof result.repoId === "string" ? result.repoId : undefined,
      title: typeof result.title === "string" ? result.title : undefined,
      executionMode: typeof result.executionMode === "string" ? result.executionMode : undefined,
      worktreePolicy: typeof result.worktreePolicy === "string" ? result.worktreePolicy : undefined,
      worktreeCreated: typeof result.worktreeCreated === "boolean" ? result.worktreeCreated : undefined,
      branchName: typeof result.branchName === "string" ? result.branchName : undefined,
      statusSummary: typeof result.statusSummary === "string" ? result.statusSummary : undefined,
      codexExitCode: typeof result.codexExitCode === "number" ? result.codexExitCode : undefined,
      reviewExitCode: typeof result.reviewExitCode === "number" ? result.reviewExitCode : undefined,
      gitStatus: typeof result.gitStatus === "string" ? result.gitStatus : undefined,
      hasDiff: typeof result.hasDiff === "boolean" ? result.hasDiff : undefined,
      commit: result.commit && typeof result.commit === "object" ? result.commit : undefined,
      promptPath: typeof result.promptPath === "string" ? result.promptPath : undefined,
      stdoutPath: typeof result.stdoutPath === "string" ? result.stdoutPath : undefined,
      stderrPath: typeof result.stderrPath === "string" ? result.stderrPath : undefined,
      diffPath: typeof result.diffPath === "string" ? result.diffPath : undefined,
      reviewPath: typeof result.reviewPath === "string" ? result.reviewPath : undefined,
      summaryPath: typeof result.summaryPath === "string" ? result.summaryPath : undefined
    };
  }
  return undefined;
}

export function projectJobForUi(
  job: JobRecord<TokenPilotJobPayload>,
  paths: TokenPilotPaths,
  options: { includeResult?: boolean } = {}
): TokenPilotPublicJobRecord {
  const projectedResult = projectJobResultForUi(job, paths.repoRoot);
  const projectedError = maskError(job.error, paths.repoRoot);
  const trackedProcess = getTrackedJobProcess(paths, job.id);
  const artifacts = projectedResult
    ? listJobArtifacts(job, paths).map((artifact) => ({
        key: artifact.key,
        label: artifact.label,
        path: artifact.path,
        contentType: artifact.contentType
      }))
    : [];

  return {
    id: job.id,
    type: job.type,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    headline: deriveJobHeadline(job),
    hasResult: Boolean(job.result),
    hasError: Boolean(job.error),
    payload: projectJobPayloadForUi(job, paths.repoRoot),
    ...(trackedProcess ? { process: trackedProcess } : {}),
    ...(artifacts.length ? { artifacts } : {}),
    ...(options.includeResult && projectedResult ? { result: projectedResult } : {}),
    ...(projectedError ? { error: projectedError } : {})
  };
}

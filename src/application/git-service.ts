import {
  getGitDiff,
  getGitStatus,
  getStagedPublicSafePaths,
  gitCommit,
  gitStage,
  gitSync
} from "../core/git-api.js";
import { readRecentGitCommitsForPaths } from "../core/git-history.js";
import type {
  GitCommitPayload,
  GitStagePayload,
  GitSyncPayload,
  TokenPilotPaths
} from "../types.js";
import type { OperationContext } from "./operation-context.js";
import { wrapServiceOperationError } from "./service-error.js";

function runGitOperation<T>(
  code: string,
  message: string,
  operation: () => T
): T {
  try {
    return operation();
  } catch (error) {
    throw wrapServiceOperationError(
      code,
      error,
      message,
      "Check repoId, Git repository state, and the requested Git operation before retrying."
    );
  }
}

export class GitService {
  constructor(private readonly paths: TokenPilotPaths) {}

  recentCommits(
    _context: OperationContext,
    repoId: string,
    limit = 10
  ) {
    return runGitOperation(
      "GIT_RECENT_COMMITS_FAILED",
      "Recent Git commits could not be read.",
      () => readRecentGitCommitsForPaths(this.paths, repoId, limit)
    );
  }

  diff(_context: OperationContext, repoId: string, staged = false) {
    return runGitOperation(
      "GIT_DIFF_FAILED",
      "Git diff could not be read.",
      () => getGitDiff(this.paths, repoId, staged)
    );
  }

  status(_context: OperationContext, repoId: string) {
    return runGitOperation(
      "GIT_STATUS_FAILED",
      "Git status could not be read.",
      () => getGitStatus(this.paths, repoId)
    );
  }

  stagedPaths(_context: OperationContext, repoId: string) {
    return runGitOperation(
      "GIT_STAGED_PATHS_FAILED",
      "Staged Git paths could not be read.",
      () => getStagedPublicSafePaths(this.paths, repoId)
    );
  }

  stage(_context: OperationContext, payload: GitStagePayload) {
    return runGitOperation(
      "GIT_STAGE_FAILED",
      "Git paths could not be staged safely.",
      () => gitStage(this.paths, payload.repoId, payload.paths)
    );
  }

  sync(_context: OperationContext, payload: GitSyncPayload) {
    return runGitOperation(
      "GIT_SYNC_FAILED",
      "Git synchronization could not be completed safely.",
      () => gitSync(this.paths, payload)
    );
  }

  commit(_context: OperationContext, payload: GitCommitPayload) {
    return runGitOperation(
      "GIT_COMMIT_FAILED",
      "Git commit could not be completed.",
      () => gitCommit(this.paths, payload.repoId, payload.message, payload.body)
    );
  }
}

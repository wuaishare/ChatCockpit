import { getGitDiff, getGitStatus, gitCommit } from "../core/git-api.js";
import { readRecentGitCommitsForRepo } from "../core/git-history.js";
import type { GitCommitPayload, TokenPilotPaths } from "../types.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";

function runGitOperation<T>(code: string, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw new ServiceError(
      code,
      error instanceof Error ? error.message : String(error)
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
    return runGitOperation("GIT_RECENT_COMMITS_FAILED", () =>
      readRecentGitCommitsForRepo(this.paths.repoRoot, repoId, limit)
    );
  }

  diff(_context: OperationContext, repoId: string, staged = false) {
    return runGitOperation("GIT_DIFF_FAILED", () =>
      getGitDiff(this.paths, repoId, staged)
    );
  }

  status(_context: OperationContext, repoId: string) {
    return runGitOperation("GIT_STATUS_FAILED", () =>
      getGitStatus(this.paths, repoId)
    );
  }

  commit(_context: OperationContext, payload: GitCommitPayload) {
    return runGitOperation("GIT_COMMIT_FAILED", () =>
      gitCommit(this.paths, payload.repoId, payload.message, payload.body)
    );
  }
}

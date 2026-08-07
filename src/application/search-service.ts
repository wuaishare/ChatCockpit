import { searchRepo } from "../core/search.js";
import type { SearchPayload, TokenPilotPaths } from "../types.js";
import type { OperationContext } from "./operation-context.js";
import { wrapServiceOperationError } from "./service-error.js";

export class SearchService {
  constructor(private readonly paths: TokenPilotPaths) {}

  search(_context: OperationContext, payload: SearchPayload) {
    try {
      return searchRepo(this.paths, payload);
    } catch (error) {
      throw wrapServiceOperationError(
        "SEARCH_BLOCKED",
        error,
        "Search was blocked or could not be completed.",
        "Check repoId, relative search path, pattern, and workspace policy before retrying."
      );
    }
  }
}

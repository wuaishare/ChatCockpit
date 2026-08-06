import { searchRepo } from "../core/search.js";
import type { SearchPayload, TokenPilotPaths } from "../types.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";

export class SearchService {
  constructor(private readonly paths: TokenPilotPaths) {}

  search(_context: OperationContext, payload: SearchPayload) {
    try {
      return searchRepo(this.paths, payload);
    } catch (error) {
      throw new ServiceError(
        "SEARCH_BLOCKED",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

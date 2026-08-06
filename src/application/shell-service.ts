import { runShellCommand } from "../core/shell-api.js";
import type { ShellRunPayload, TokenPilotPaths } from "../types.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";

export class ShellService {
  constructor(private readonly paths: TokenPilotPaths) {}

  run(_context: OperationContext, payload: ShellRunPayload) {
    try {
      return runShellCommand(this.paths, payload);
    } catch (error) {
      throw new ServiceError(
        "SHELL_COMMAND_BLOCKED",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

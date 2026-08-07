import { runShellCommand } from "../core/shell-api.js";
import type { ShellRunPayload, TokenPilotPaths } from "../types.js";
import type { OperationContext } from "./operation-context.js";
import { wrapServiceOperationError } from "./service-error.js";

export class ShellService {
  constructor(private readonly paths: TokenPilotPaths) {}

  run(_context: OperationContext, payload: ShellRunPayload) {
    try {
      return runShellCommand(this.paths, payload);
    } catch (error) {
      throw wrapServiceOperationError(
        "SHELL_COMMAND_BLOCKED",
        error,
        "Command execution was blocked or could not be completed.",
        "Use an allowlisted command/subcommand with relative arguments and an allowed workdir."
      );
    }
  }
}

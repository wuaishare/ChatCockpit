import { buildPaths } from "../src/core/paths.ts";
import { requestLocalRuntimeRestart } from "../src/process-supervisor/runtime-restart-request.ts";

try {
  const result = await requestLocalRuntimeRestart(buildPaths(), {
    waitForCompletion: true
  });
  if (result.state === "failed") {
    process.stderr.write(
      `RUNTIME_RESTART_FAILED ${result.operationId} ${result.errorCode ?? "UNKNOWN"}\n`
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `RUNTIME_RESTART_${result.state.toUpperCase()} ${result.operationId}\n`
    );
  }
} catch (error) {
  process.stderr.write(
    `RUNTIME_RESTART_REQUEST_FAILED ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}

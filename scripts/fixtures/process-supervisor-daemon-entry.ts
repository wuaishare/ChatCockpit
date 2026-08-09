import { buildPaths } from "../../src/core/paths.ts";
import { ProcessSupervisorDaemon } from "../../src/process-supervisor/index.ts";

function positiveMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

const paths = buildPaths();
const daemon = new ProcessSupervisorDaemon(paths, {
  heartbeatIntervalMs: positiveMs(
    "TOKENPILOT_PROCESS_SUPERVISOR_HEARTBEAT_MS",
    100
  ),
  watchdogIntervalMs: positiveMs(
    "TOKENPILOT_PROCESS_SUPERVISOR_WATCHDOG_MS",
    100
  )
});

await daemon.start();
process.stdout.write("PROCESS_SUPERVISOR_FIXTURE_READY\n");

if (process.env.TOKENPILOT_PROCESS_SUPERVISOR_TEST_ABRUPT_EXIT === "true") {
  process.once("SIGUSR2", () => {
    // Test-only abrupt exit: intentionally bypass daemon.close() so the guardian
    // must react to parent stdio loss exactly as it would after an unexpected crash.
    process.exit(93);
  });
}

await new Promise<void>((resolve, reject) => {
  let stopping = false;
  const stop = () => {
    if (stopping) {
      return;
    }
    stopping = true;
    void daemon.close().then(resolve, reject);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
});

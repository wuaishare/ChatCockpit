import os from "node:os";
import path from "node:path";

import { buildR4PreflightReport } from "../src/migration/r4-preflight.js";

const reportOnly = process.argv.includes("--report");
const repoRoot = process.cwd();
const home = os.homedir();

const report = await buildR4PreflightReport({
  repoRoot,
  legacyStateRoot: path.join(repoRoot, ".tokenpilot"),
  targetStateRoot: path.join(home, ".chatcockpit"),
  legacyConfigPath: path.join(home, ".tokenpilot", "config.json"),
  targetConfigPath: path.join(home, ".chatcockpit", "config.json")
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (!reportOnly && report.state !== "ready-to-migrate") {
  process.exitCode = 2;
}

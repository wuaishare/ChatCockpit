import fs from "node:fs";

import { buildHealthStatusSnapshot } from "./gpt-config.js";
import { listJobs } from "./jobs.js";
import type { TokenPilotPaths } from "../types.js";

export interface SetupStatusStep {
  key: "runtime" | "auth" | "repo" | "runner" | "gpt" | "firstTask";
  ok: boolean;
  label: string;
  detail: string;
  nextAction: string;
}

export interface SetupStatus {
  ok: true;
  ready: boolean;
  authRequired: boolean;
  exposed: boolean;
  publicBaseUrlConfigured: boolean;
  openapiUrl: string;
  runnerStatus: "missing" | "ready";
  firstTaskSeen: boolean;
  steps: SetupStatusStep[];
}

function envFilePath(paths: TokenPilotPaths): string {
  return `${paths.runtimeDir}/server.env`;
}

function hasTokenConfigured(): boolean {
  return Boolean(process.env.TOKENPILOT_API_TOKEN?.trim());
}

export function buildSetupStatus(paths: TokenPilotPaths): SetupStatus {
  const health = buildHealthStatusSnapshot();
  const runtimeExists = fs.existsSync(paths.runtimeDir);
  const envExists = fs.existsSync(envFilePath(paths));
  const runnerReady = fs.existsSync(paths.runnerStatusPath);
  const firstTaskSeen = listJobs(paths).length > 0;
  const tokenConfigured = hasTokenConfigured();
  const repoReady = fs.existsSync(paths.repoRoot);
  const publicBaseUrlConfigured = Boolean(health.publicBaseUrl);

  const steps: SetupStatusStep[] = [
    {
      key: "runtime",
      ok: runtimeExists && envExists,
      label: "Local runtime",
      detail: envExists ? "server.env is present" : "server.env has not been created",
      nextAction: envExists ? "Continue" : "Run npm run init"
    },
    {
      key: "auth",
      ok: !health.authRequired || tokenConfigured,
      label: "Bearer auth",
      detail: health.authRequired
        ? "Protected endpoints require TOKENPILOT_API_TOKEN"
        : "Local-only mode does not require a token",
      nextAction: health.authRequired && !tokenConfigured ? "Set TOKENPILOT_API_TOKEN" : "Continue"
    },
    {
      key: "repo",
      ok: repoReady,
      label: "Repository allowlist",
      detail: repoReady ? "Default repoId can resolve locally" : "Repository root is unavailable",
      nextAction: repoReady ? "Continue" : "Check TOKENPILOT_REPO_ROOT"
    },
    {
      key: "runner",
      ok: runnerReady,
      label: "Runner",
      detail: runnerReady ? "Runner status file is present" : "Runner has not reported status yet",
      nextAction: runnerReady ? "Continue" : "Run npm run start:local"
    },
    {
      key: "gpt",
      ok: Boolean(health.openapiUrl),
      label: "GPT handoff",
      detail: publicBaseUrlConfigured
        ? "Public base URL is configured for GPT Actions"
        : "Local OpenAPI schema is available",
      nextAction: "Open GPT Helper and copy the instructions"
    },
    {
      key: "firstTask",
      ok: firstTaskSeen,
      label: "First safe task",
      detail: firstTaskSeen ? "At least one job is visible" : "No local job has been created yet",
      nextAction: firstTaskSeen ? "Review job details" : "Run a safe read/status task from ChatGPT"
    }
  ];

  return {
    ok: true,
    ready: steps.every((step) => step.ok),
    authRequired: health.authRequired,
    exposed: health.exposed,
    publicBaseUrlConfigured,
    openapiUrl: health.openapiUrl,
    runnerStatus: runnerReady ? "ready" : "missing",
    firstTaskSeen,
    steps
  };
}

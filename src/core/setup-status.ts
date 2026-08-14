import fs from "node:fs";

import { buildOAuthReadiness, type OAuthReadinessStatus } from "../auth/oauth-readiness.js";
import { buildHealthStatusSnapshot } from "./gpt-config.js";
import { readIdentityEnv } from "./identity-env.js";
import { listJobs } from "./jobs.js";
import type { TokenPilotPaths } from "../types.js";

export interface SetupStatusStep {
  key: "runtime" | "auth" | "oauth" | "repo" | "runner" | "gpt" | "firstTask";
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
  oauthStatus: OAuthReadinessStatus;
  oauthProtectedResourceMetadataUrl: string | null;
  openapiUrl: string;
  runnerStatus: "missing" | "ready";
  firstTaskSeen: boolean;
  steps: SetupStatusStep[];
}

function envFilePath(paths: TokenPilotPaths): string {
  return `${paths.runtimeDir}/server.env`;
}

function hasTokenConfigured(): boolean {
  return Boolean(readIdentityEnv("API_TOKEN"));
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
  const publicGptReady = publicBaseUrlConfigured && health.exposed;
  const oauth = buildOAuthReadiness(paths);

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
      key: "oauth",
      ok: !oauth.required || oauth.ready,
      label: "ChatGPT MCP OAuth",
      detail: oauth.detail,
      nextAction: oauth.nextAction
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
      ok: Boolean(health.openapiUrl) && (!publicBaseUrlConfigured || publicGptReady),
      label: "GPT handoff",
      detail: publicGptReady
        ? "Public base URL is configured and exposed for GPT Actions"
        : publicBaseUrlConfigured
          ? "Public base URL is configured, but the local server is not running in exposed mode"
          : "Local OpenAPI schema is available",
      nextAction: publicGptReady
        ? "Open GPT Helper and copy the instructions"
        : publicBaseUrlConfigured
          ? "Enable exposed mode or fix the public ingress before re-importing GPT Actions"
          : "Open GPT Helper and review the local integration details"
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
    oauthStatus: oauth.status,
    oauthProtectedResourceMetadataUrl: oauth.protectedResourceMetadataUrl,
    openapiUrl: health.openapiUrl,
    runnerStatus: runnerReady ? "ready" : "missing",
    firstTaskSeen,
    steps
  };
}

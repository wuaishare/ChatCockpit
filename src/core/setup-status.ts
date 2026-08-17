import fs from "node:fs";

import { buildOAuthReadiness, type OAuthReadinessStatus } from "../auth/oauth-readiness.js";
import { buildHealthStatusSnapshot } from "./gpt-config.js";
import { readIdentityEnv, runtimeIdentityEnvName } from "./identity-env.js";
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
  const apiTokenEnv = runtimeIdentityEnvName("API_TOKEN", paths.productIdentity);
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
      nextAction: envExists
        ? "Continue"
        : "Initialize the local Runtime in ChatCockpit App → Runtime"
    },
    {
      key: "auth",
      ok: true,
      label: "Machine API (optional)",
      detail: tokenConfigured
        ? `${apiTokenEnv} is configured for machine/API clients`
        : "Machine API authority is optional; Web Operator sessions and ChatGPT OAuth do not depend on it",
      nextAction: tokenConfigured
        ? "Continue"
        : "Optional: manage Machine API authority in ChatCockpit App → Access & Security"
    },
    {
      key: "oauth",
      ok: !oauth.required || oauth.ready,
      label: "ChatGPT MCP OAuth",
      detail: oauth.detail,
      nextAction: !oauth.required || oauth.ready
        ? "Continue"
        : "Open Integrations to review OAuth readiness; use the ChatCockpit App for machine-side prerequisites"
    },
    {
      key: "repo",
      ok: repoReady,
      label: "Repository allowlist",
      detail: repoReady ? "Default repoId can resolve locally" : "Repository root is unavailable",
      nextAction: repoReady
        ? "Continue"
        : "Authorize or repair the local Workspace in ChatCockpit App → Workspaces"
    },
    {
      key: "runner",
      ok: runnerReady,
      label: "Runner",
      detail: runnerReady ? "Runner status file is present" : "Runner has not reported status yet",
      nextAction: runnerReady
        ? "Continue"
        : "Start or diagnose Runtime services in ChatCockpit App → Runtime"
    },
    {
      key: "gpt",
      ok: Boolean(health.openapiUrl) && (!publicBaseUrlConfigured || publicGptReady),
      label: "Integrations",
      detail: publicGptReady
        ? "Public integration origin is configured for ChatGPT MCP and compatibility clients"
        : publicBaseUrlConfigured
          ? "Public integration origin is configured, but the local server is not running in exposed mode"
          : "Local integration and OpenAPI surfaces are available",
      nextAction: publicGptReady
        ? "Open Integrations and review the ChatGPT App / MCP connection"
        : publicBaseUrlConfigured
          ? "Review public access in ChatCockpit App → Access & Security, then return to Integrations"
          : "Open Integrations and review the local integration details"
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

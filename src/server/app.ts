import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

import type {
  CodexRunJobPayload,
  JobRecord,
  TaskPackInput,
  TokenPilotCommitSummary,
  TokenPilotGptConfigRecord,
  TokenPilotHealthStatus,
  TokenPilotJobPayload,
  TokenPilotPaths,
  JobStatus,
  JobType,
  TokenPilotPublicJobRecord
} from "../types.js";
import {
  controlJobProcess,
  getTrackedJobProcess,
  terminateAllJobProcesses
} from "../core/job-processes.js";
import {
  fileEditSchema,
  fileListSchema,
  fileReadBatchSchema,
  fileReadSchema,
  fileWriteSchema,
  gitCommitSchema,
  searchSchema,
  shellRunSchema
} from "../contracts/direct-tools.js";
import { ChatDirectService } from "../application/chat-direct-service.js";
import { buildContinuityServices } from "../application/continuity-services.js";
import { RuntimeApprovalService } from "../application/runtime-approval-service.js";
import { RuntimeBindingService } from "../application/runtime-binding-service.js";
import { RuntimeEventService } from "../application/runtime-event-service.js";
import { RuntimeRouter } from "../application/runtime-router.js";
import { RuntimeService } from "../application/runtime-service.js";
import { RuntimeTurnService } from "../application/runtime-turn-service.js";
import { buildGptConfig, buildHealthStatusSnapshot } from "../core/gpt-config.js";
import { buildSetupStatus } from "../core/setup-status.js";
import { isPathInsideRoot, resolvePathInsideRoot } from "../core/path-guards.js";
import { listJobArtifacts, readJobArtifact } from "../core/job-artifacts.js";
import { createJob, getJob, listJobs, listJobsPage } from "../core/jobs.js";
import {
  ContinuityDatabase,
  continuityDatabasePath
} from "../continuity/database.js";
import { registerMcpHttpRoutes } from "../mcp/http-adapter.js";
import { buildTokenPilotMcpHandler } from "../mcp/server.js";
import { CodexAppServerAdapter } from "../runtime/codex/app-server-adapter.js";
import type { CodingRuntimeAdapter } from "../runtime/codex/runtime-adapter.js";
import { CodexStandaloneCapabilityStore } from "../runtime/codex/standalone-capabilities.js";
import {
  isAuthRequired,
  tokenPilotAuthPlugin,
  validateServerAuthConfig
} from "./auth.js";
import { registerContinuityRoutes } from "./continuity-routes.js";
import { ApiError, sendApiError, sendUnknownApiError, validationError } from "./errors.js";
import { operationContextFromRequest } from "./request-context.js";
import { registerRuntimeRoutes } from "./runtime-routes.js";

const taskPackSchema = z.object({
  title: z.string().min(1),
  problem: z.string().min(1),
  contextSummary: z.string().optional(),
  mustInspect: z.array(z.string()).optional(),
  mayInspect: z.array(z.string()).optional(),
  mustNotModify: z.array(z.string()).optional(),
  verificationCommands: z.array(z.string()).optional(),
  acceptanceCriteria: z.array(z.string()).optional()
});

const packJobSchema = z
  .object({
    repoId: z.string().min(1).default("tokenpilot")
  })
  .default({
    repoId: "tokenpilot"
  });

const codexRunSchema = z.object({
  repoId: z.string().min(1).default("tokenpilot"),
  title: z.string().min(1),
  instructions: z.string().min(1),
  executionMode: z.enum(["plan", "review", "develop"]).default("develop"),
  worktreePolicy: z.enum(["auto", "always", "never"]).default("auto"),
  branchName: z.string().min(1).optional(),
  approvalPolicy: z.enum(["untrusted", "on-request", "never"]).default("never"),
  sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).default("workspace-write"),
  verificationCommands: z.array(z.string()).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  commitPolicy: z.enum(["none", "propose", "commit"]).default("propose"),
  commitTitle: z.string().min(1).optional(),
  commitBody: z.string().min(1).optional()
});

const recentCommitsQuerySchema = z.object({
  repoId: z.string().min(1).default("tokenpilot"),
  limit: z.coerce.number().int().positive().max(50).optional()
});

const listJobsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().regex(/^\d+$/).optional(),
  status: z.enum(["queued", "running", "completed", "failed"]).optional(),
  type: z.enum(["pack", "taskpack", "codex-run"]).optional(),
  includeResult: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === "true" || value === "1")
});

const artifactKeySchema = z.enum([
  "repomixXml",
  "prompt",
  "summary",
  "manifest",
  "markdown",
  "json",
  "codexPrompt",
  "codexStdout",
  "codexStderr",
  "codexDiff",
  "codexReview",
  "codexSummary"
]);

function normalizePackLikeObject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = { ...(value as Record<string, unknown>) };

  if (typeof record.repoRoot === "string" && typeof record.repoId !== "string") {
    record.repoId = "tokenpilot";
  }

  delete record.repoRoot;
  return record;
}

function projectPackLikeObject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = normalizePackLikeObject(value) as Record<string, unknown>;
  return {
    ...(typeof record.createdAt === "string" ? { createdAt: record.createdAt } : {}),
    ...(typeof record.repoId === "string" ? { repoId: record.repoId } : {}),
    ...(typeof record.repoName === "string" ? { repoName: record.repoName } : {}),
    ...(typeof record.repomixXmlPath === "string"
      ? { repomixXmlPath: record.repomixXmlPath }
      : {}),
    ...(typeof record.promptPath === "string" ? { promptPath: record.promptPath } : {}),
    ...(typeof record.summaryPath === "string" ? { summaryPath: record.summaryPath } : {}),
    ...(typeof record.manifestPath === "string" ? { manifestPath: record.manifestPath } : {}),
    ...(Array.isArray(record.publicIncludeEntries)
      ? { publicIncludeEntries: record.publicIncludeEntries }
      : {})
  };
}

function projectTaskPackLikeObject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;

  return {
    ...(typeof record.createdAt === "string" ? { createdAt: record.createdAt } : {}),
    ...(typeof record.title === "string" ? { title: record.title } : {}),
    ...(typeof record.markdownPath === "string"
      ? { markdownPath: record.markdownPath }
      : {}),
    ...(typeof record.jsonPath === "string" ? { jsonPath: record.jsonPath } : {})
  };
}

function projectCodexRunLikeObject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.createdAt === "string" ? { createdAt: record.createdAt } : {}),
    ...(typeof record.repoId === "string" ? { repoId: record.repoId } : {}),
    ...(typeof record.title === "string" ? { title: record.title } : {}),
    ...(typeof record.executionMode === "string" ? { executionMode: record.executionMode } : {}),
    ...(typeof record.worktreePolicy === "string" ? { worktreePolicy: record.worktreePolicy } : {}),
    ...(typeof record.worktreeCreated === "boolean" ? { worktreeCreated: record.worktreeCreated } : {}),
    ...(typeof record.branchName === "string" ? { branchName: record.branchName } : {}),
    ...(typeof record.statusSummary === "string" ? { statusSummary: record.statusSummary } : {}),
    ...(typeof record.codexExitCode === "number" ? { codexExitCode: record.codexExitCode } : {}),
    ...(typeof record.reviewExitCode === "number" ? { reviewExitCode: record.reviewExitCode } : {}),
    ...(typeof record.gitStatus === "string" ? { gitStatus: record.gitStatus } : {}),
    ...(typeof record.hasDiff === "boolean" ? { hasDiff: record.hasDiff } : {}),
    ...(record.commit && typeof record.commit === "object" ? { commit: record.commit } : {}),
    ...(typeof record.promptPath === "string" ? { promptPath: record.promptPath } : {}),
    ...(typeof record.stdoutPath === "string" ? { stdoutPath: record.stdoutPath } : {}),
    ...(typeof record.stderrPath === "string" ? { stderrPath: record.stderrPath } : {}),
    ...(typeof record.diffPath === "string" ? { diffPath: record.diffPath } : {}),
    ...(typeof record.reviewPath === "string" ? { reviewPath: record.reviewPath } : {}),
    ...(typeof record.summaryPath === "string" ? { summaryPath: record.summaryPath } : {}),
    ...(Array.isArray(record.artifacts) ? { artifacts: record.artifacts } : {})
  };
}

function toRelativeRepoPath(value: string, repoRoot: string): string {
  const repoRootPrefix = `${repoRoot}/`;
  if (value === repoRoot) {
    return "<repo>";
  }
  if (value.startsWith(repoRootPrefix)) {
    return value.slice(repoRootPrefix.length);
  }
  return value.split(repoRootPrefix).join("<repo>/").split(repoRoot).join("<repo>");
}

function sanitizeForApi(value: unknown, repoRoot: string): unknown {
  if (typeof value === "string") {
    return toRelativeRepoPath(value, repoRoot);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForApi(item, repoRoot));
  }

  if (value && typeof value === "object") {
    const normalized = normalizePackLikeObject(value) as Record<string, unknown>;
    const sanitized = Object.fromEntries(
      Object.entries(normalized).map(([key, nestedValue]) => [
        key,
        sanitizeForApi(nestedValue, repoRoot)
      ])
    );

    if (
      sanitized.type === "pack" &&
      sanitized.payload &&
      typeof sanitized.payload === "object"
    ) {
      sanitized.payload = projectPackLikeObject(sanitized.payload);
    }

    if (
      sanitized.type === "pack" &&
      sanitized.result &&
      typeof sanitized.result === "object"
    ) {
      sanitized.result = projectPackLikeObject(sanitized.result);
    }

    if (
      sanitized.type === "taskpack" &&
      sanitized.payload &&
      typeof sanitized.payload === "object"
    ) {
      sanitized.payload = projectTaskPackLikeObject(sanitized.payload);
    }

    if (
      sanitized.type === "taskpack" &&
      sanitized.result &&
      typeof sanitized.result === "object"
    ) {
      sanitized.result = projectTaskPackLikeObject(sanitized.result);
    }

    if (
      sanitized.type === "codex-run" &&
      sanitized.payload &&
      typeof sanitized.payload === "object"
    ) {
      sanitized.payload = projectCodexRunLikeObject(sanitized.payload);
    }

    if (
      sanitized.type === "codex-run" &&
      sanitized.result &&
      typeof sanitized.result === "object"
    ) {
      sanitized.result = projectCodexRunLikeObject(sanitized.result);
    }

    return sanitized;
  }

  return value;
}

function maskError(error: string | undefined, repoRoot: string): string | undefined {
  if (!error) {
    return undefined;
  }

  const firstLine = error.split("\n")[0] ?? error;
  return toRelativeRepoPath(firstLine, repoRoot);
}

type ReplyLike = Parameters<typeof sendApiError>[0];

function replyFrom(value: unknown): ReplyLike {
  return value as ReplyLike;
}

const uiAssetContentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function uiAssetContentType(filePath: string): string {
  return uiAssetContentTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function deriveJobHeadline(job: JobRecord<TokenPilotJobPayload>): string {
  if (job.type === "taskpack") {
    const title = (job.payload as { title?: unknown }).title;
    if (typeof title === "string" && title.trim()) {
      return title.trim();
    }
    return "Task pack job";
  }

  if (job.type === "pack") {
    const repoId = (job.payload as { repoId?: unknown }).repoId;
    if (typeof repoId === "string" && repoId.trim()) {
      return `Pack repo ${repoId.trim()}`;
    }
    return "Pack job";
  }

  if (job.type === "codex-run") {
    const title = (job.payload as { title?: unknown }).title;
    if (typeof title === "string" && title.trim()) {
      return title.trim();
    }
    return "Codex run job";
  }

  return "TokenPilot job";
}

function projectJobPayloadForUi(
  job: JobRecord<TokenPilotJobPayload>,
  repoRoot: string
): Record<string, unknown> {
  if (job.type === "taskpack") {
    const payload = job.payload as unknown as Record<string, unknown>;
    return {
      title: typeof payload.title === "string" ? payload.title : undefined
    };
  }

  if (job.type === "pack") {
    const payload = sanitizeForApi(job.payload, repoRoot) as Record<string, unknown>;
    return {
      repoId: typeof payload.repoId === "string" ? payload.repoId : undefined
    };
  }

  if (job.type === "codex-run") {
    const payload = sanitizeForApi(job.payload, repoRoot) as Record<string, unknown>;
    return {
      repoId: typeof payload.repoId === "string" ? payload.repoId : undefined,
      title: typeof payload.title === "string" ? payload.title : undefined,
      executionMode: typeof payload.executionMode === "string" ? payload.executionMode : undefined,
      worktreePolicy: typeof payload.worktreePolicy === "string" ? payload.worktreePolicy : undefined,
      commitPolicy: typeof payload.commitPolicy === "string" ? payload.commitPolicy : undefined
    };
  }

  return {};
}

function projectJobResultForUi(
  job: JobRecord<TokenPilotJobPayload>,
  repoRoot: string
): Record<string, unknown> | undefined {
  if (!job.result || typeof job.result !== "object" || Array.isArray(job.result)) {
    return undefined;
  }

  const result = sanitizeForApi(job.result, repoRoot) as Record<string, unknown>;

  if (job.type === "taskpack") {
    return {
      createdAt: typeof result.createdAt === "string" ? result.createdAt : undefined,
      title: typeof result.title === "string" ? result.title : undefined,
      markdownPath:
        typeof result.markdownPath === "string" ? result.markdownPath : undefined,
      jsonPath: typeof result.jsonPath === "string" ? result.jsonPath : undefined
    };
  }

  if (job.type === "pack") {
    return {
      createdAt: typeof result.createdAt === "string" ? result.createdAt : undefined,
      repoId: typeof result.repoId === "string" ? result.repoId : undefined,
      repoName: typeof result.repoName === "string" ? result.repoName : undefined,
      repomixXmlPath:
        typeof result.repomixXmlPath === "string" ? result.repomixXmlPath : undefined,
      promptPath: typeof result.promptPath === "string" ? result.promptPath : undefined,
      summaryPath: typeof result.summaryPath === "string" ? result.summaryPath : undefined,
      manifestPath: typeof result.manifestPath === "string" ? result.manifestPath : undefined,
      publicIncludeEntries: Array.isArray(result.publicIncludeEntries)
        ? result.publicIncludeEntries
        : undefined
    };
  }

  if (job.type === "codex-run") {
    return {
      createdAt: typeof result.createdAt === "string" ? result.createdAt : undefined,
      repoId: typeof result.repoId === "string" ? result.repoId : undefined,
      title: typeof result.title === "string" ? result.title : undefined,
      executionMode: typeof result.executionMode === "string" ? result.executionMode : undefined,
      worktreePolicy: typeof result.worktreePolicy === "string" ? result.worktreePolicy : undefined,
      worktreeCreated:
        typeof result.worktreeCreated === "boolean" ? result.worktreeCreated : undefined,
      branchName: typeof result.branchName === "string" ? result.branchName : undefined,
      statusSummary: typeof result.statusSummary === "string" ? result.statusSummary : undefined,
      codexExitCode: typeof result.codexExitCode === "number" ? result.codexExitCode : undefined,
      reviewExitCode: typeof result.reviewExitCode === "number" ? result.reviewExitCode : undefined,
      gitStatus: typeof result.gitStatus === "string" ? result.gitStatus : undefined,
      hasDiff: typeof result.hasDiff === "boolean" ? result.hasDiff : undefined,
      commit: result.commit && typeof result.commit === "object" ? result.commit : undefined,
      promptPath: typeof result.promptPath === "string" ? result.promptPath : undefined,
      stdoutPath: typeof result.stdoutPath === "string" ? result.stdoutPath : undefined,
      stderrPath: typeof result.stderrPath === "string" ? result.stderrPath : undefined,
      diffPath: typeof result.diffPath === "string" ? result.diffPath : undefined,
      reviewPath: typeof result.reviewPath === "string" ? result.reviewPath : undefined,
      summaryPath: typeof result.summaryPath === "string" ? result.summaryPath : undefined
    };
  }

  return undefined;
}

function projectJobForUi(
  job: JobRecord<TokenPilotJobPayload>,
  paths: TokenPilotPaths,
  options: { includeResult?: boolean } = {}
): TokenPilotPublicJobRecord {
  const projectedResult = projectJobResultForUi(job, paths.repoRoot);
  const projectedError = maskError(job.error, paths.repoRoot);
  const trackedProcess = getTrackedJobProcess(paths, job.id);
  const artifacts = projectedResult
    ? listJobArtifacts(job, paths).map((artifact) => ({
        key: artifact.key,
        label: artifact.label,
        path: artifact.path,
        contentType: artifact.contentType
      }))
    : [];
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    headline: deriveJobHeadline(job),
    hasResult: Boolean(job.result),
    hasError: Boolean(job.error),
    payload: projectJobPayloadForUi(job, paths.repoRoot),
    ...(trackedProcess ? { process: trackedProcess } : {}),
    ...(artifacts.length ? { artifacts } : {}),
    ...(options.includeResult && projectedResult ? { result: projectedResult } : {}),
    ...(projectedError ? { error: projectedError } : {})
  };
}

function buildHealthStatus(paths: TokenPilotPaths): TokenPilotHealthStatus {
  return buildHealthStatusSnapshot();
}

function buildPublicHealthStatus(paths: TokenPilotPaths): TokenPilotHealthStatus {
  return buildHealthStatus(paths);
}

function resolveOpenApiServerUrl(request: FastifyRequest): string {
  const configured = process.env.TOKENPILOT_PUBLIC_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const forwardedProtoHeader = request.headers["x-forwarded-proto"];
  const forwardedProto = Array.isArray(forwardedProtoHeader)
    ? forwardedProtoHeader[0]
    : forwardedProtoHeader;
  const protocol = forwardedProto?.split(",")[0]?.trim() || "http";
  const host = request.headers.host?.trim();

  if (!host) {
    return "https://tokenpilot.example.com";
  }

  return `${protocol}://${host}`;
}

function renderOpenApiDocument(request: FastifyRequest, repoRoot: string): string {
  const filePath = path.join(repoRoot, "openapi", "tokenpilot.openapi.yaml");
  const source = fs.readFileSync(filePath, "utf8");
  const serverUrl = resolveOpenApiServerUrl(request);

  return source.replace(
    /^servers:\n  - url: .+$/m,
    `servers:\n  - url: ${serverUrl}`
  );
}

function renderUiNotBuiltPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TokenPilot Web UI Not Built</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f2ea;
        --panel: rgba(255, 255, 255, 0.88);
        --text: #1d2a24;
        --muted: #5d6d63;
        --line: rgba(29, 42, 36, 0.12);
        --accent: #235744;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(35, 87, 68, 0.12), transparent 34%),
          linear-gradient(135deg, #f5f2ea 0%, #ebe4d7 100%);
        color: var(--text);
        font: 15px/1.6 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 24px;
      }
      main {
        width: min(720px, 100%);
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 22px 60px rgba(38, 54, 44, 0.12);
        backdrop-filter: blur(18px);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
        line-height: 1.1;
      }
      p {
        margin: 0 0 12px;
        color: var(--muted);
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        background: rgba(35, 87, 68, 0.08);
        padding: 2px 6px;
        border-radius: 8px;
      }
      ul {
        margin: 16px 0 0;
        padding-left: 18px;
      }
      li + li {
        margin-top: 6px;
      }
      .note {
        margin-top: 18px;
        padding-top: 18px;
        border-top: 1px solid var(--line);
      }
      a {
        color: var(--accent);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>TokenPilot Web UI is not built yet</h1>
      <p>The local-first operator Web UI is served from built static assets under <code>web/dist</code>.</p>
      <p>Build the frontend first, then restart the server and open <code>/ui</code> again.</p>
      <ul>
        <li><code>npm run build:web</code></li>
        <li><code>npm run server</code></li>
        <li>Open <code>http://127.0.0.1:4318/ui</code></li>
      </ul>
      <p class="note">Current public-safe entry points remain <code>/api/health</code> and <code>/openapi.yaml</code>. Full HTTPS / Custom GPT Actions automation loop is still under validation.</p>
    </main>
  </body>
</html>`;
}

export interface BuildServerOptions {
  codexAdapter?: CodingRuntimeAdapter;
}

export function buildServer(
  paths: TokenPilotPaths,
  options: BuildServerOptions = {}
) {
  validateServerAuthConfig();

  const app = Fastify({ logger: true });
  const continuityDatabase = new ContinuityDatabase({
    path: continuityDatabasePath(paths.runtimeDir)
  });
  const continuityServices = buildContinuityServices(paths, continuityDatabase);
  const standaloneCapabilityStore = new CodexStandaloneCapabilityStore(
    paths.runtimeDir
  );
  const codexAdapter =
    options.codexAdapter ??
    new CodexAppServerAdapter({
      workspaces: continuityServices.repositories.workspaces,
      standaloneCapabilityStore
    });
  const runtimeRouter = new RuntimeRouter(codexAdapter);
  const chatDirect = new ChatDirectService(
    paths,
    runtimeRouter,
    standaloneCapabilityStore,
    continuityServices.repositories
  );
  const runtimeService = new RuntimeService(runtimeRouter);
  const runtimeBindingService = new RuntimeBindingService(
    continuityServices.repositories,
    runtimeRouter
  );
  const runtimeEventService = new RuntimeEventService(
    continuityServices.repositories,
    runtimeRouter
  );
  const runtimeTurnService = new RuntimeTurnService(
    paths,
    continuityServices.repositories,
    runtimeRouter,
    continuityServices.taskExecutionPolicy
  );
  const runtimeApprovalService = new RuntimeApprovalService(
    continuityServices.repositories,
    runtimeRouter
  );
  runtimeEventService.attach();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return sendUnknownApiError(reply, error);
    }
    return sendUnknownApiError(reply, error);
  });
  app.register(tokenPilotAuthPlugin);
  app.addHook("onClose", async () => {
    runtimeEventService.detach();
    await runtimeService.close();
    continuityDatabase.close();
  });
  const mcpHandler = buildTokenPilotMcpHandler(
    paths,
    continuityServices,
    chatDirect,
    runtimeService,
    runtimeBindingService,
    runtimeTurnService,
    runtimeApprovalService,
    runtimeEventService,
    (error) => {
    app.log.error({ err: error }, "MCP request failed");
    }
  );
  registerMcpHttpRoutes(app, mcpHandler);
  registerContinuityRoutes(app, continuityServices);
  registerRuntimeRoutes(
    app,
    runtimeService,
    runtimeBindingService,
    runtimeTurnService,
    runtimeApprovalService,
    runtimeEventService
  );
  const uiDistDir = path.join(paths.repoRoot, "web", "dist");
  const hasUiDist = fs.existsSync(uiDistDir);
  const uiRootRealPath = hasUiDist ? fs.realpathSync(uiDistDir) : null;

  const healthHandler = async () => {
    return buildPublicHealthStatus(paths);
  };

  const gptConfigHandler = async () => {
    return {
      ok: true,
      config: buildGptConfig("zh-CN", paths.repoRoot)
    };
  };

  const setupStatusHandler = async () => buildSetupStatus(paths);

  const recentCommitsHandler = async (request: unknown, reply: unknown) => {
    const parsed = recentCommitsQuerySchema.safeParse(
      (request as { query?: unknown }).query ?? {}
    );
    const fastifyReply = replyFrom(reply);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }

    try {
      return await chatDirect.recentCommits(
        operationContextFromRequest(request),
        parsed.data.repoId,
        parsed.data.limit ?? 10
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  const listJobsHandler = async (request: unknown, reply: unknown) => {
    const parsed = listJobsQuerySchema.safeParse(
      (request as { query?: unknown }).query ?? {}
    );
    const fastifyReply = replyFrom(reply);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    const includeResult = parsed.data.includeResult ?? false;
    const page = listJobsPage(paths, {
      limit: parsed.data.limit,
      cursor: parsed.data.cursor,
      status: parsed.data.status as JobStatus | undefined,
      type: parsed.data.type as JobType | undefined
    });
    return {
      ok: true,
      jobs: page.jobs.map((job) => projectJobForUi(job, paths, { includeResult })),
      nextCursor: page.nextCursor,
      totalVisible: page.totalVisible,
      includeResult
    };
  };

  const getJobHandler = async (request: unknown, reply: unknown) => {
    const params = (request as { params: { id: string } }).params;
    const fastifyReply = replyFrom(reply);
    const job = getJob(paths, params.id);
    if (!job) {
      return sendApiError(fastifyReply, 404, "JOB_NOT_FOUND", "Job not found");
    }
    return {
      ok: true,
      job: projectJobForUi(job.job, paths, { includeResult: true })
    };
  };

  const listJobArtifactsHandler = async (request: unknown, reply: unknown) => {
    const params = (request as { params: { id: string } }).params;
    const fastifyReply = replyFrom(reply);
    const job = getJob(paths, params.id);
    if (!job) {
      return sendApiError(fastifyReply, 404, "JOB_NOT_FOUND", "Job not found");
    }

    return {
      ok: true,
      artifacts: listJobArtifacts(job.job, paths).map((artifact) => ({
        key: artifact.key,
        label: artifact.label,
        path: artifact.path,
        contentType: artifact.contentType
      }))
    };
  };

  const readJobArtifactHandler = async (request: unknown, reply: unknown) => {
    const params = (request as {
      params: { id: string; artifactKey: string };
      query?: { offset?: string; limit?: string };
    }).params;
    const query = (request as {
      query?: { offset?: string; limit?: string };
    }).query ?? {};
    const fastifyReply = replyFrom(reply);
    const job = getJob(paths, params.id);
    if (!job) {
      return sendApiError(fastifyReply, 404, "JOB_NOT_FOUND", "Job not found");
    }

    const parsedArtifactKey = artifactKeySchema.safeParse(params.artifactKey);
    if (!parsedArtifactKey.success) {
      return sendApiError(fastifyReply, 400, "VALIDATION_ERROR", "Unsupported artifact key");
    }

    try {
      const artifact = readJobArtifact(job.job, paths, parsedArtifactKey.data, {
        offset: query.offset ? Number(query.offset) : undefined,
        limit: query.limit ? Number(query.limit) : undefined
      });
      return {
        ok: true,
        artifact: artifact.artifact,
        file: artifact.preview
      };
    } catch (error) {
      return sendApiError(
        fastifyReply,
        404,
        "ARTIFACT_NOT_FOUND",
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const createPackHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = replyFrom(reply);
    const body = (request as { body?: unknown }).body ?? {};
    const parsed = packJobSchema.safeParse(body);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }

    const job = createJob(paths, "pack", parsed.data);
    return {
      ok: true,
      job: sanitizeForApi(job, paths.repoRoot)
    };
  };

  const createTaskPackHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = replyFrom(reply);
    const parsed = taskPackSchema.safeParse((request as { body: unknown }).body);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }

    const job = createJob(paths, "taskpack", parsed.data as TaskPackInput);
    return {
      ok: true,
      job: sanitizeForApi(job, paths.repoRoot)
    };
  };

  const createCodexRunHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = replyFrom(reply);
    const parsed = codexRunSchema.safeParse((request as { body: unknown }).body);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }

    const job = createJob(paths, "codex-run", parsed.data as CodexRunJobPayload);
    return {
      ok: true,
      job: sanitizeForApi(job, paths.repoRoot)
    };
  };

  const controlJobHandler = async (request: unknown, reply: unknown) => {
    const params = (request as { params: { id: string; action: string } }).params;
    const fastifyReply = replyFrom(reply);
    if (!["pause", "resume", "terminate"].includes(params.action)) {
      return sendApiError(fastifyReply, 400, "VALIDATION_ERROR", "Unsupported control action");
    }
    return controlJobProcess(paths, params.id, params.action as "pause" | "resume" | "terminate");
  };

  const terminateAllJobsHandler = async () => terminateAllJobProcesses(paths);

  const readFileHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = replyFrom(reply);
    const parsed = fileReadSchema.safeParse((request as { body: unknown }).body);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }

    try {
      return await chatDirect.read(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendApiError(
        fastifyReply,
        400,
        "FILES_READ_BLOCKED",
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const readFilesHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = replyFrom(reply);
    const parsed = fileReadBatchSchema.safeParse((request as { body: unknown }).body);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }

    try {
      return await chatDirect.readBatch(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendApiError(
        fastifyReply,
        400,
        "FILES_READ_BLOCKED",
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const writeFileHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = replyFrom(reply);
    const parsed = fileWriteSchema.safeParse((request as { body: unknown }).body);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await chatDirect.write(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  const editFileHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = replyFrom(reply);
    const parsed = fileEditSchema.safeParse((request as { body: unknown }).body);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await chatDirect.edit(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  const listDirectoryHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = replyFrom(reply);
    const parsed = fileListSchema.safeParse((request as { body: unknown }).body);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await chatDirect.list(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendApiError(
        fastifyReply,
        400,
        "FILES_LIST_BLOCKED",
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const searchHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = replyFrom(reply);
    const parsed = searchSchema.safeParse((request as { body: unknown }).body);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await chatDirect.search(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendApiError(
        fastifyReply,
        400,
        "SEARCH_BLOCKED",
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const shellRunHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = replyFrom(reply);
    const parsed = shellRunSchema.safeParse((request as { body: unknown }).body);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await chatDirect.shell(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  const gitDiffHandler = async (request: unknown, reply: unknown) => {
    const query = (request as { query?: { repoId?: string; staged?: string } }).query ?? {};
    const repoId = query.repoId ?? "tokenpilot";
    const staged = query.staged === "true" || query.staged === "1";
    try {
      return await chatDirect.gitDiff(
        operationContextFromRequest(request),
        repoId,
        staged
      );
    } catch (error) {
      return sendApiError(
        replyFrom(reply),
        400,
        "GIT_DIFF_FAILED",
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const gitStatusHandler = async (request: unknown, reply: unknown) => {
    const query = (request as { query?: { repoId?: string } }).query ?? {};
    const repoId = query.repoId ?? "tokenpilot";
    try {
      return await chatDirect.gitStatus(
        operationContextFromRequest(request),
        repoId
      );
    } catch (error) {
      return sendApiError(
        replyFrom(reply),
        400,
        "GIT_STATUS_FAILED",
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const gitCommitHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = replyFrom(reply);
    const parsed = gitCommitSchema.safeParse((request as { body: unknown }).body);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await chatDirect.gitCommit(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  app.get("/api/health", healthHandler);
  app.get("/tokenpilot/api/health", healthHandler);

  app.get("/api/gpt/config", gptConfigHandler);
  app.get("/tokenpilot/api/gpt/config", gptConfigHandler);

  app.get("/api/setup/status", setupStatusHandler);
  app.get("/tokenpilot/api/setup/status", setupStatusHandler);

  app.get("/api/git/recent-commits", recentCommitsHandler);
  app.get("/tokenpilot/api/git/recent-commits", recentCommitsHandler);

  app.get("/", async (_request, reply) => {
    reply.type("application/json; charset=utf-8");
    return {
      ok: true,
      service: "tokenpilot-control-plane",
      health: buildPublicHealthStatus(paths),
      ui: "/ui",
      openapi: "/openapi.yaml"
    };
  });

  app.get("/favicon.ico", async (_request, reply) => {
    reply.code(204);
    return reply.send();
  });

  app.get("/api/jobs", listJobsHandler);
  app.get("/tokenpilot/api/jobs", listJobsHandler);

  app.get("/api/jobs/:id", getJobHandler);
  app.get("/tokenpilot/api/jobs/:id", getJobHandler);

  app.get("/api/jobs/:id/artifacts", listJobArtifactsHandler);
  app.get("/tokenpilot/api/jobs/:id/artifacts", listJobArtifactsHandler);

  app.get("/api/jobs/:id/artifacts/:artifactKey", readJobArtifactHandler);
  app.get("/tokenpilot/api/jobs/:id/artifacts/:artifactKey", readJobArtifactHandler);

  app.post("/api/jobs/pack", createPackHandler);
  app.post("/tokenpilot/api/jobs/pack", createPackHandler);

  app.post("/api/jobs/taskpack", createTaskPackHandler);
  app.post("/tokenpilot/api/jobs/taskpack", createTaskPackHandler);

  app.post("/api/jobs/codex-run", createCodexRunHandler);
  app.post("/tokenpilot/api/jobs/codex-run", createCodexRunHandler);

  app.post("/api/jobs/:id/control/:action", controlJobHandler);
  app.post("/tokenpilot/api/jobs/:id/control/:action", controlJobHandler);

  app.post("/api/jobs/control/terminate-all", terminateAllJobsHandler);
  app.post("/tokenpilot/api/jobs/control/terminate-all", terminateAllJobsHandler);

  app.post("/api/files/read", readFileHandler);
  app.post("/tokenpilot/api/files/read", readFileHandler);

  app.post("/api/files/read-batch", readFilesHandler);
  app.post("/tokenpilot/api/files/read-batch", readFilesHandler);

  app.post("/api/files/write", writeFileHandler);
  app.post("/tokenpilot/api/files/write", writeFileHandler);

  app.post("/api/files/edit", editFileHandler);
  app.post("/tokenpilot/api/files/edit", editFileHandler);

  app.post("/api/files/list", listDirectoryHandler);
  app.post("/tokenpilot/api/files/list", listDirectoryHandler);

  app.post("/api/search", searchHandler);
  app.post("/tokenpilot/api/search", searchHandler);

  app.post("/api/shell/run", shellRunHandler);
  app.post("/tokenpilot/api/shell/run", shellRunHandler);

  app.get("/api/git/diff", gitDiffHandler);
  app.get("/tokenpilot/api/git/diff", gitDiffHandler);

  app.get("/api/git/status", gitStatusHandler);
  app.get("/tokenpilot/api/git/status", gitStatusHandler);

  app.post("/api/git/commit", gitCommitHandler);
  app.post("/tokenpilot/api/git/commit", gitCommitHandler);

  app.get("/openapi.yaml", async (request, reply) => {
    reply.type("text/yaml");
    return renderOpenApiDocument(request, paths.repoRoot);
  });

  app.get("/ui", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    if (!hasUiDist || !fs.existsSync(path.join(uiDistDir, "index.html"))) {
      return renderUiNotBuiltPage();
    }

    return fs.readFileSync(path.join(uiDistDir, "index.html"), "utf8");
  });

  app.get("/ui/*", async (request, reply) => {
    const indexPath = path.join(uiDistDir, "index.html");
    if (!hasUiDist || !uiRootRealPath || !fs.existsSync(indexPath)) {
      reply.type("text/html; charset=utf-8");
      return renderUiNotBuiltPage();
    }

    const requestUrl = (request as { url: string }).url;
    const rawSuffix = requestUrl.split("?", 1)[0].slice("/ui/".length);
    let suffix: string;

    try {
      suffix = decodeURIComponent(rawSuffix);
    } catch {
      return sendApiError(
        replyFrom(reply),
        400,
        "INVALID_UI_ASSET_PATH",
        "Invalid UI asset path encoding"
      );
    }

    if (suffix) {
      try {
        const { absolutePath } = resolvePathInsideRoot(
          uiDistDir,
          suffix,
          "UI asset path"
        );

        if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
          const realAssetPath = fs.realpathSync(absolutePath);
          if (!isPathInsideRoot(uiRootRealPath, realAssetPath)) {
            return sendApiError(
              replyFrom(reply),
              400,
              "INVALID_UI_ASSET_PATH",
              "UI asset path must stay within the built Web UI directory"
            );
          }

          reply.header("X-Content-Type-Options", "nosniff");
          reply.type(uiAssetContentType(realAssetPath));
          return fs.readFileSync(realAssetPath);
        }
      } catch (error) {
        return sendApiError(
          replyFrom(reply),
          400,
          "INVALID_UI_ASSET_PATH",
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    reply.type("text/html; charset=utf-8");
    return fs.readFileSync(indexPath, "utf8");
  });

  app.get("/privacy-policy", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return `<!doctype html>
<html lang="zh-Hans">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TokenPilot Privacy Policy</title>
  </head>
  <body>
    <main style="max-width: 760px; margin: 40px auto; font: 16px/1.7 -apple-system, BlinkMacSystemFont, sans-serif;">
      <h1>TokenPilot Privacy Policy</h1>
      <p>TokenPilot is a local-first automation layer for repository packaging, task-pack generation, and local runner orchestration.</p>
      <p>For this MVP, requests sent to the TokenPilot control plane may be logged locally for debugging and job traceability. Repository artifacts are generated on the local machine and remain under the local workspace unless the operator explicitly exposes the control plane or shares generated files.</p>
      <p>This MVP does not intentionally transmit repository contents to third-party services except through actions explicitly initiated by the operator, such as Custom GPT Actions calling the configured HTTPS endpoint.</p>
      <p>Operators are responsible for securing bearer tokens, public endpoints, and exposed infrastructure such as reverse proxies and tunnels.</p>
    </main>
  </body>
</html>`;
  });

  return app;
}

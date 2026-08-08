import Fastify from "fastify";
import { z } from "zod";

import type {
  CodexRunJobPayload,
  TaskPackInput,
  TokenPilotCommitSummary,
  TokenPilotGptConfigRecord,
  TokenPilotHealthStatus,
  TokenPilotPaths,
  JobStatus,
  JobType
} from "../types.js";
import {
  controlJobProcess,
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
import { buildDesktopCommanderHostCommandService } from "../application/host-command-service.js";
import { HostDirectService } from "../application/host-direct-service.js";
import { HostMutationService } from "../application/host-mutation-service.js";
import { resolveOAuthPublicConfig } from "../auth/oauth-config.js";
import { registerOAuthRoutes } from "../auth/oauth-routes.js";
import { OAuthService } from "../auth/oauth-service.js";
import { OAuthStore, oauthDatabasePath } from "../auth/oauth-store.js";
import { TOKENPILOT_MCP_SCOPE } from "../auth/oauth-types.js";
import { buildContinuityServices } from "../application/continuity-services.js";
import { RuntimeApprovalService } from "../application/runtime-approval-service.js";
import { RuntimeBindingService } from "../application/runtime-binding-service.js";
import { RuntimeEventService } from "../application/runtime-event-service.js";
import { RuntimeRouter } from "../application/runtime-router.js";
import { RuntimeService } from "../application/runtime-service.js";
import { RuntimeTurnService } from "../application/runtime-turn-service.js";
import { buildGptConfig, buildHealthStatusSnapshot } from "../core/gpt-config.js";
import { buildSetupStatus } from "../core/setup-status.js";
import { listJobArtifacts, readJobArtifact } from "../core/job-artifacts.js";
import { createJob, getJob, listJobs, listJobsPage } from "../core/jobs.js";
import {
  ContinuityDatabase,
  continuityDatabasePath
} from "../continuity/database.js";
import { registerMcpHttpRoutes } from "../mcp/http-adapter.js";
import { buildTokenPilotMcpHandler } from "../mcp/server.js";
import { buildConfiguredDirectCapabilityBroker } from "../direct/broker-factory.js";
import { DownstreamMcpExecutionRegistry } from "../direct/downstream-mcp-executor.js";
import {
  hostCommandDecisionSchema,
  hostCommandExecuteSchema,
  hostCommandPrepareSchema
} from "../contracts/host-command.js";
import {
  hostFileReadSchema,
  hostMutationDecisionSchema,
  hostMutationExecuteSchema,
  hostMutationPrepareSchema
} from "../contracts/host-direct.js";
import { CodexAppServerAdapter } from "../runtime/codex/app-server-adapter.js";
import type { CodingRuntimeAdapter } from "../runtime/codex/runtime-adapter.js";
import { CodexStandaloneCapabilityStore } from "../runtime/codex/standalone-capabilities.js";
import {
  createTokenPilotAuthPlugin,
  isExposedMode,
  validateServerAuthConfig
} from "./auth.js";
import { registerContinuityRoutes } from "./continuity-routes.js";
import { ApiError, sendApiError, sendUnknownApiError, validationError } from "./errors.js";
import { operationContextFromRequest } from "./request-context.js";
import { registerRuntimeRoutes } from "./runtime-routes.js";
import { projectJobForUi, sanitizeForApi } from "./job-public-projection.js";
import { registerStaticRoutes } from "./static-routes.js";

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
  limit: z.coerce.number().int().positive().max(50).optional(),
  executorId: z.string().min(1).max(160).optional()
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

type ReplyLike = Parameters<typeof sendApiError>[0];

function replyFrom(value: unknown): ReplyLike {
  return value as ReplyLike;
}

function buildHealthStatus(paths: TokenPilotPaths): TokenPilotHealthStatus {
  return buildHealthStatusSnapshot();
}

function buildPublicHealthStatus(paths: TokenPilotPaths): TokenPilotHealthStatus {
  return buildHealthStatus(paths);
}

export interface BuildServerOptions {
  codexAdapter?: CodingRuntimeAdapter;
  directExecutorsConfigPath?: string;
}

export function buildServer(
  paths: TokenPilotPaths,
  options: BuildServerOptions = {}
) {
  validateServerAuthConfig();

  const app = Fastify({ logger: true });
  const oauthConfig = isExposedMode() ? resolveOAuthPublicConfig() : null;
  const oauthStore = oauthConfig
    ? new OAuthStore({ path: oauthDatabasePath(paths.runtimeDir) })
    : null;
  const oauthService = oauthConfig && oauthStore
    ? new OAuthService({
        store: oauthStore,
        config: oauthConfig,
        ownerSecret: () => process.env.TOKENPILOT_API_TOKEN?.trim() || null
      })
    : null;
  if (oauthService && oauthConfig) {
    registerOAuthRoutes(app, oauthService, oauthConfig);
  }

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
  const directCapabilityBroker = buildConfiguredDirectCapabilityBroker({
    paths,
    codexStandaloneStore: standaloneCapabilityStore,
    ...(options.directExecutorsConfigPath
      ? { downstreamConfigPath: options.directExecutorsConfigPath }
      : {})
  });
  const downstreamMcpExecutionRegistry = new DownstreamMcpExecutionRegistry(
    paths.runtimeDir,
    options.directExecutorsConfigPath
  );
  const hostDirect = new HostDirectService(
    directCapabilityBroker,
    downstreamMcpExecutionRegistry,
    options.directExecutorsConfigPath
  );
  const hostMutation = new HostMutationService(
    paths,
    continuityServices.repositories,
    directCapabilityBroker,
    downstreamMcpExecutionRegistry,
    options.directExecutorsConfigPath
  );
  const hostCommand = buildDesktopCommanderHostCommandService({
    paths,
    repositories: continuityServices.repositories,
    broker: directCapabilityBroker,
    configPath: options.directExecutorsConfigPath
  });
  const chatDirect = new ChatDirectService(
    paths,
    runtimeRouter,
    directCapabilityBroker,
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
  app.register(
    createTokenPilotAuthPlugin(
      oauthService && oauthConfig
        ? {
            protectedResourceMetadataUrl: oauthConfig.protectedResourceMetadataUrl,
            scope: TOKENPILOT_MCP_SCOPE,
            verifyAccessToken: (token) => Boolean(oauthService.verifyMcpAccessToken(token))
          }
        : null
    )
  );
  app.addHook("onClose", async () => {
    runtimeEventService.detach();
    await runtimeService.close();
    continuityDatabase.close();
    oauthStore?.close();
  });
  const mcpHandler = buildTokenPilotMcpHandler(
    paths,
    continuityServices,
    chatDirect,
    hostDirect,
    hostMutation,
    hostCommand,
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
        parsed.data.limit ?? 10,
        parsed.data.executorId
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
        "Artifact could not be read or was not found."
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
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  const hostRootsHandler = async () => hostDirect.listRoots();

  const hostReadFileHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = replyFrom(reply);
    const parsed = hostFileReadSchema.safeParse((request as { body: unknown }).body);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await hostDirect.readFile(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  const hostMutationPrepareHandler = async (
    request: unknown,
    reply: unknown
  ) => {
    const fastifyReply = replyFrom(reply);
    const parsed = hostMutationPrepareSchema.safeParse(
      (request as { body: unknown }).body
    );
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await hostMutation.prepare(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  const hostMutationDecisionHandler = async (
    request: unknown,
    reply: unknown
  ) => {
    const fastifyReply = replyFrom(reply);
    const parsed = hostMutationDecisionSchema.safeParse(
      (request as { body: unknown }).body
    );
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await hostMutation.decide(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  const hostMutationExecuteHandler = async (
    request: unknown,
    reply: unknown
  ) => {
    const fastifyReply = replyFrom(reply);
    const parsed = hostMutationExecuteSchema.safeParse(
      (request as { body: unknown }).body
    );
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await hostMutation.execute(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  const hostCommandPrepareHandler = async (
    request: unknown,
    reply: unknown
  ) => {
    const fastifyReply = replyFrom(reply);
    const parsed = hostCommandPrepareSchema.safeParse(
      (request as { body: unknown }).body
    );
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await hostCommand.prepare(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  const hostCommandDecisionHandler = async (
    request: unknown,
    reply: unknown
  ) => {
    const fastifyReply = replyFrom(reply);
    const parsed = hostCommandDecisionSchema.safeParse(
      (request as { body: unknown }).body
    );
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await hostCommand.decide(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  const hostCommandExecuteHandler = async (
    request: unknown,
    reply: unknown
  ) => {
    const fastifyReply = replyFrom(reply);
    const parsed = hostCommandExecuteSchema.safeParse(
      (request as { body: unknown }).body
    );
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await hostCommand.execute(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
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
      return sendUnknownApiError(fastifyReply, error);
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
      return sendUnknownApiError(fastifyReply, error);
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
      return sendUnknownApiError(fastifyReply, error);
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
    const query = (
      request as {
        query?: { repoId?: string; staged?: string; executorId?: string };
      }
    ).query ?? {};
    const repoId = query.repoId ?? "tokenpilot";
    const staged = query.staged === "true" || query.staged === "1";
    try {
      return await chatDirect.gitDiff(
        operationContextFromRequest(request),
        repoId,
        staged,
        query.executorId
      );
    } catch (error) {
      return sendUnknownApiError(replyFrom(reply), error);
    }
  };

  const gitStatusHandler = async (request: unknown, reply: unknown) => {
    const query = (
      request as { query?: { repoId?: string; executorId?: string } }
    ).query ?? {};
    const repoId = query.repoId ?? "tokenpilot";
    try {
      return await chatDirect.gitStatus(
        operationContextFromRequest(request),
        repoId,
        query.executorId
      );
    } catch (error) {
      return sendUnknownApiError(replyFrom(reply), error);
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

  app.get("/api/host/roots", hostRootsHandler);
  app.get("/tokenpilot/api/host/roots", hostRootsHandler);

  app.post("/api/host/files/read", hostReadFileHandler);
  app.post("/tokenpilot/api/host/files/read", hostReadFileHandler);

  app.post("/api/host/mutations/prepare", hostMutationPrepareHandler);
  app.post(
    "/tokenpilot/api/host/mutations/prepare",
    hostMutationPrepareHandler
  );
  app.post("/api/host/mutations/decision", hostMutationDecisionHandler);
  app.post(
    "/tokenpilot/api/host/mutations/decision",
    hostMutationDecisionHandler
  );
  app.post("/api/host/mutations/execute", hostMutationExecuteHandler);
  app.post(
    "/tokenpilot/api/host/mutations/execute",
    hostMutationExecuteHandler
  );

  app.post("/api/host/commands/prepare", hostCommandPrepareHandler);
  app.post(
    "/tokenpilot/api/host/commands/prepare",
    hostCommandPrepareHandler
  );
  app.post("/api/host/commands/decision", hostCommandDecisionHandler);
  app.post(
    "/tokenpilot/api/host/commands/decision",
    hostCommandDecisionHandler
  );
  app.post("/api/host/commands/execute", hostCommandExecuteHandler);
  app.post(
    "/tokenpilot/api/host/commands/execute",
    hostCommandExecuteHandler
  );

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

  registerStaticRoutes(app, paths);

  return app;
}

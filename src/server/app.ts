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
  buildDirectToolSchemas,
  fileReadBatchSchema,
  fileReadSchema
} from "../contracts/direct-tools.js";
import { ChatDirectService } from "../application/chat-direct-service.js";
import { buildDesktopCommanderHostCommandService } from "../application/host-command-service.js";
import { buildDesktopCommanderHostProcessService } from "../application/host-process-service.js";
import { HostDirectService } from "../application/host-direct-service.js";
import { HostMutationService } from "../application/host-mutation-service.js";
import { resolveOAuthPublicConfig } from "../auth/oauth-config.js";
import { registerOAuthRoutes } from "../auth/oauth-routes.js";
import { OAuthService } from "../auth/oauth-service.js";
import { OAuthStore, oauthDatabasePath } from "../auth/oauth-store.js";
import { OperatorPasskeyService } from "../auth/operator-passkey-service.js";
import { OperatorStore, operatorDatabasePath } from "../auth/operator-store.js";
import { OperatorAuthError, OperatorService } from "../auth/operator-service.js";
import { OperatorTotpService } from "../auth/operator-totp-service.js";
import { buildContinuityServices } from "../application/continuity-services.js";
import { RuntimeApprovalService } from "../application/runtime-approval-service.js";
import { RuntimeBindingService } from "../application/runtime-binding-service.js";
import { buildRuntimeRecoveryServices } from "../application/runtime-recovery-services.js";
import { RuntimeResourceMutationService } from "../application/runtime-resource-mutation-service.js";
import { buildRuntimeResourceServices } from "../application/runtime-resource-services.js";
import { RuntimeEventService } from "../application/runtime-event-service.js";
import { RuntimeRouter } from "../application/runtime-router.js";
import { RuntimeService } from "../application/runtime-service.js";
import { RuntimeTurnService } from "../application/runtime-turn-service.js";
import { buildGptConfig, buildHealthStatusSnapshot } from "../core/gpt-config.js";
import { buildIntegrationStatusSnapshot } from "../core/integration-status.js";
import {
  buildConnectivityProviderPublicSnapshot,
  type ConnectivityProviderPublicSnapshot
} from "../connectivity/provider-public-projection.js";
import {
  PublicRouteCandidateStore,
  PublicRouteCandidateValidationError,
  type PublicRouteCandidateSource
} from "../connectivity/public-route-candidate.js";
import {
  PublicRouteVerificationError,
  PublicRouteVerificationStore,
  PublicRouteVerifier
} from "../connectivity/public-route-verification.js";
import { productIdentityForKey } from "../core/product-identity.js";
import { readIdentityEnv } from "../core/identity-env.js";
import { buildDistributionContextFromPaths } from "../core/distribution-context.js";
import { buildSetupStatus } from "../core/setup-status.js";
import { loadAccessPolicy } from "../security/access-policy.js";
import { listJobArtifacts, readJobArtifact } from "../core/job-artifacts.js";
import { createJob, getJob, listJobs, listJobsPage } from "../core/jobs.js";
import {
  ContinuityDatabase,
  continuityDatabasePath
} from "../continuity/database.js";
import { registerMcpHttpRoutes } from "../mcp/http-adapter.js";
import {
  buildTokenPilotMcpHandler,
  buildTokenPilotMcpToolCatalog
} from "../mcp/server.js";
import { buildConfiguredDirectCapabilityBroker } from "../direct/broker-factory.js";
import { DownstreamMcpExecutionRegistry } from "../direct/downstream-mcp-executor.js";
import { loadDownstreamMcpExecutorsConfig } from "../direct/downstream-mcp-config.js";
import { probeConfiguredDownstreamMcpExecutors } from "../direct/downstream-mcp-operator.js";
import {
  hostCommandDecisionSchema,
  hostCommandExecuteSchema,
  hostCommandPrepareSchema
} from "../contracts/host-command.js";
import {
  hostProcessDecisionSchema,
  hostProcessExecuteSchema,
  hostProcessListSchema,
  hostProcessPrepareSchema,
  hostProcessReadSchema
} from "../contracts/host-process.js";
import {
  hostFileReadSchema,
  hostMutationDecisionSchema,
  hostMutationExecuteSchema,
  hostMutationPrepareSchema
} from "../contracts/host-direct.js";
import { CodexAppServerAdapter } from "../runtime/codex/app-server-adapter.js";
import type { CodingRuntimeAdapter } from "../runtime/codex/runtime-adapter.js";
import { CodexStandaloneCapabilityStore } from "../runtime/codex/standalone-capabilities.js";
import { AcpRegistryAdapter } from "../runtime/resources/acp-registry-adapter.js";
import { CodexPluginMutationAdapter } from "../runtime/resources/codex-plugin-mutation-adapter.js";
import { CodexResourceInventoryAdapter } from "../runtime/resources/codex-resource-inventory-adapter.js";
import { CodexRuntimeProfileAdapter } from "../runtime/resources/codex-runtime-profile-adapter.js";
import { CodexSkillMutationAdapter } from "../runtime/resources/codex-skill-mutation-adapter.js";
import { DownstreamResourceInventoryAdapter } from "../runtime/resources/downstream-resource-inventory-adapter.js";
import { DownstreamRuntimeProfileAdapter } from "../runtime/resources/downstream-runtime-profile-adapter.js";
import { RuntimeProfileRegistry } from "../runtime/resources/runtime-profile-registry.js";
import { RuntimeResourceInventoryAdapterRegistry } from "../runtime/resources/runtime-resource-inventory-adapter-registry.js";
import {
  createTokenPilotAuthPlugin,
  isExposedMode,
  validateServerAuthConfig
} from "./auth.js";
import { registerContinuityRoutes } from "./continuity-routes.js";
import { ApiError, sendApiError, sendUnknownApiError, validationError } from "./errors.js";
import { operationContextFromRequest } from "./request-context.js";
import { registerRuntimeRoutes } from "./runtime-routes.js";
import { registerRecoveryRoutes } from "./recovery-routes.js";
import { isResourceMutationExposureEnabled } from "./runtime-resource-mutation-policy.js";
import { registerRuntimeResourceRoutes } from "./runtime-resource-routes.js";
import { projectJobForUi, sanitizeForApi } from "./job-public-projection.js";
import { registerStaticRoutes } from "./static-routes.js";
import { registerOperatorRoutes } from "./operator-routes.js";
import { registerAccessPolicyGate } from "./access-policy-gate.js";
import {
  registerWebSecurityHeaders,
  trustLoopbackProxy
} from "./security-headers.js";

const publicRouteCandidateSourceSchema = z.enum([
  "existing-environment",
  "cloudflare-tunnel",
  "ngrok",
  "frp-client"
]);

const publicRouteCandidateStageSchema = z.object({
  origin: z.string().min(1),
  source: publicRouteCandidateSourceSchema
});

const publicRouteCandidateVerifySchema = z.object({
  candidateId: z.string().min(1).max(200)
});

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

function buildProductRequestSchemas(defaultRepoId: string) {
  return {
    packJobSchema: z
      .object({
        repoId: z.string().min(1).default(defaultRepoId)
      })
      .default({
        repoId: defaultRepoId
      }),
    codexRunSchema: z.object({
      repoId: z.string().min(1).default(defaultRepoId),
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
    }),
    recentCommitsQuerySchema: z.object({
      repoId: z.string().min(1).default(defaultRepoId),
      limit: z.coerce.number().int().positive().max(50).optional(),
      executorId: z.string().min(1).max(160).optional()
    })
  };
}

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
  return buildHealthStatusSnapshot(paths.productIdentity);
}

function buildPublicHealthStatus(paths: TokenPilotPaths): TokenPilotHealthStatus {
  return buildHealthStatus(paths);
}

export interface BuildServerOptions {
  codexAdapter?: CodingRuntimeAdapter;
  codexSkillMutationAdapter?: CodexSkillMutationAdapter;
  codexPluginMutationAdapter?: CodexPluginMutationAdapter;
  runtimeResourceMutationNow?: () => string;
  directExecutorsConfigPath?: string;
  acpRegistryAdapter?: AcpRegistryAdapter | null;
  connectivityProviderPublicSnapshot?: () => ConnectivityProviderPublicSnapshot;
  publicRouteCandidateStore?: PublicRouteCandidateStore;
  publicRouteVerifier?: PublicRouteVerifier;
}

export function buildServer(
  paths: TokenPilotPaths,
  options: BuildServerOptions = {}
) {
  validateServerAuthConfig();
  const accessPolicy = loadAccessPolicy(paths);

  const identity = productIdentityForKey(paths.productIdentity);
  const {
    packJobSchema,
    codexRunSchema,
    recentCommitsQuerySchema
  } = buildProductRequestSchemas(identity.defaultRepoId);
  const {
    fileEditSchema,
    fileListSchema,
    fileWriteSchema,
    gitCommitSchema,
    searchSchema,
    shellRunSchema
  } = buildDirectToolSchemas(identity.defaultRepoId);

  const app = Fastify({
    logger: true,
    trustProxy: trustLoopbackProxy
  });
  registerAccessPolicyGate(app, accessPolicy);
  registerWebSecurityHeaders(app);
  const oauthConfig = isExposedMode()
    ? resolveOAuthPublicConfig(process.env, paths.productIdentity)
    : null;
  const oauthStore = oauthConfig
    ? new OAuthStore({ path: oauthDatabasePath(paths.runtimeDir) })
    : null;
  const oauthService = oauthConfig && oauthStore
    ? new OAuthService({
        store: oauthStore,
        config: oauthConfig
      })
    : null;
  const operatorStore = new OperatorStore({
    path: operatorDatabasePath(paths.runtimeDir)
  });
  const operatorService = new OperatorService({ store: operatorStore });
  const operatorPasskeyService = new OperatorPasskeyService({ store: operatorStore });
  const operatorTotpService = new OperatorTotpService({
    store: operatorStore,
    runtimeDir: paths.runtimeDir
  });
  const publicRouteCandidateStore =
    options.publicRouteCandidateStore ??
    new PublicRouteCandidateStore({ runtimeDir: paths.runtimeDir });
  const publicRouteVerifier =
    options.publicRouteVerifier ??
    new PublicRouteVerifier({
      candidateStore: publicRouteCandidateStore,
      verificationStore: new PublicRouteVerificationStore({ runtimeDir: paths.runtimeDir })
    });
  if (oauthService && oauthConfig) {
    registerOAuthRoutes(
      app,
      oauthService,
      oauthConfig,
      accessPolicy.consolePathPrefix
    );
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
      productIdentity: paths.productIdentity,
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
  const hostProcess = buildDesktopCommanderHostProcessService({
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
  const runtimeRecoveryServices = buildRuntimeRecoveryServices({
    paths,
    repositories: continuityServices.repositories,
    runtimeRouter,
    workspaceContinuity: continuityServices.workspaces,
    runtimeBindingService,
    handoffService: continuityServices.handoffs
  });
  const downstreamResourceSource = {
    loadConfig: () =>
      loadDownstreamMcpExecutorsConfig(options.directExecutorsConfigPath),
    probe: () =>
      probeConfiguredDownstreamMcpExecutors({
        paths,
        ...(options.directExecutorsConfigPath
          ? { configPath: options.directExecutorsConfigPath }
          : {})
      })
  };
  const acpRegistryAdapter =
    options.acpRegistryAdapter === null
      ? null
      : options.acpRegistryAdapter ?? new AcpRegistryAdapter();
  const runtimeProfileRegistry = new RuntimeProfileRegistry(
    [
      new CodexRuntimeProfileAdapter(runtimeRouter),
      new DownstreamRuntimeProfileAdapter(downstreamResourceSource),
      ...(acpRegistryAdapter ? [acpRegistryAdapter] : [])
    ],
    (sourceKind, error) => {
      app.log.warn(
        { sourceKind, err: error },
        "Runtime Profile source is temporarily unavailable"
      );
    }
  );
  const runtimeResourceAdapterRegistry =
    new RuntimeResourceInventoryAdapterRegistry([
      new CodexResourceInventoryAdapter(runtimeRouter),
      new DownstreamResourceInventoryAdapter(downstreamResourceSource, identity),
      ...(acpRegistryAdapter ? [acpRegistryAdapter] : [])
    ]);
  const codexSkillMutationAdapter =
    options.codexSkillMutationAdapter ??
    new CodexSkillMutationAdapter({
      workspaces: continuityServices.repositories.workspaces
    });
  const codexPluginMutationAdapter =
    options.codexPluginMutationAdapter ??
    new CodexPluginMutationAdapter({
      workspaces: continuityServices.repositories.workspaces
    });
  const runtimeResourceServices = buildRuntimeResourceServices({
    repositories: continuityServices.repositories,
    profiles: runtimeProfileRegistry,
    adapters: runtimeResourceAdapterRegistry,
    pluginMutationAvailable: true
  });
  const runtimeResourceMutationService = new RuntimeResourceMutationService(
    continuityServices.repositories,
    runtimeResourceServices.inventory,
    codexSkillMutationAdapter,
    {
      codexPlugins: codexPluginMutationAdapter,
      ...(options.runtimeResourceMutationNow
        ? { now: options.runtimeResourceMutationNow }
        : {})
    }
  );
  runtimeEventService.attach();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof OperatorAuthError) {
      return sendApiError(reply, error.statusCode, error.code, error.message);
    }
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
            scope: oauthConfig.mcpScope,
            verifyAccessToken: (token) => Boolean(oauthService.verifyMcpAccessToken(token))
          }
        : null,
      operatorService,
      accessPolicy.consolePathPrefix
    )
  );
  registerOperatorRoutes(
    app,
    operatorService,
    operatorPasskeyService,
    operatorTotpService
  );
  app.addHook("onClose", async () => {
    runtimeEventService.detach();
    await hostProcess.close();
    await runtimeService.close();
    continuityDatabase.close();
    oauthStore?.close();
    operatorStore.close();
  });
  const exposedRuntimeResourceMutationService = isResourceMutationExposureEnabled()
    ? runtimeResourceMutationService
    : null;
  const mcpToolCount = buildTokenPilotMcpToolCatalog(
    paths,
    continuityServices,
    chatDirect,
    hostDirect,
    hostMutation,
    hostCommand,
    hostProcess,
    runtimeService,
    runtimeBindingService,
    runtimeTurnService,
    runtimeApprovalService,
    runtimeEventService,
    runtimeRecoveryServices,
    runtimeResourceServices,
    exposedRuntimeResourceMutationService
  ).length;
  const mcpHandler = buildTokenPilotMcpHandler(
    paths,
    continuityServices,
    chatDirect,
    hostDirect,
    hostMutation,
    hostCommand,
    hostProcess,
    runtimeService,
    runtimeBindingService,
    runtimeTurnService,
    runtimeApprovalService,
    runtimeEventService,
    runtimeRecoveryServices,
    runtimeResourceServices,
    exposedRuntimeResourceMutationService,
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
  registerRecoveryRoutes(app, runtimeRecoveryServices);
  registerRuntimeResourceRoutes(
    app,
    runtimeResourceServices,
    runtimeResourceMutationService
  );
  const healthHandler = async () => {
    return buildPublicHealthStatus(paths);
  };

  const gptConfigHandler = async (request: unknown) => {
    const requestedLocale = (request as { query?: { locale?: unknown } }).query?.locale;
    const locale = requestedLocale === "en-US" ? "en-US" : "zh-CN";
    return {
      ok: true,
      config: buildGptConfig(
        locale,
        paths.repoRoot,
        buildDistributionContextFromPaths(paths)
      )
    };
  };

  const setupStatusHandler = async () => buildSetupStatus(paths);

  const integrationStatusHandler = async () =>
    buildIntegrationStatusSnapshot({
      paths,
      oauthSummary: oauthStore?.integrationSummary(new Date().toISOString()) ?? null,
      toolCount: mcpToolCount
    });

  const connectivityProviderStatusHandler = async () =>
    options.connectivityProviderPublicSnapshot?.() ??
    buildConnectivityProviderPublicSnapshot({ runtimeDir: paths.runtimeDir });

  const publicRouteCandidateStatusHandler = async () =>
    publicRouteCandidateStore.snapshot();

  const stagePublicRouteCandidateHandler = async (request: unknown, reply: unknown) => {
    const parsed = publicRouteCandidateStageSchema.safeParse(
      (request as { body?: unknown }).body ?? {}
    );
    const fastifyReply = replyFrom(reply);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return publicRouteCandidateStore.stage({
        origin: parsed.data.origin,
        source: parsed.data.source as PublicRouteCandidateSource
      });
    } catch (error) {
      if (error instanceof PublicRouteCandidateValidationError) {
        return sendApiError(
          fastifyReply,
          400,
          error.code.toUpperCase().replaceAll("-", "_"),
          error.message
        );
      }
      throw error;
    }
  };

  const discardPublicRouteCandidateHandler = async () =>
    publicRouteCandidateStore.clear();

  const publicRouteVerificationStatusHandler = async () =>
    publicRouteVerifier.snapshot();

  const verifyPublicRouteCandidateHandler = async (request: unknown, reply: unknown) => {
    const parsed = publicRouteCandidateVerifySchema.safeParse(
      (request as { body?: unknown }).body ?? {}
    );
    const fastifyReply = replyFrom(reply);
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await publicRouteVerifier.verify(parsed.data.candidateId);
    } catch (error) {
      if (error instanceof PublicRouteVerificationError && error.code === "candidate-stale") {
        return sendApiError(
          fastifyReply,
          409,
          "CANDIDATE_STALE",
          error.message
        );
      }
      throw error;
    }
  };

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

  const hostProcessPrepareHandler = async (
    request: unknown,
    reply: unknown
  ) => {
    const fastifyReply = replyFrom(reply);
    const parsed = hostProcessPrepareSchema.safeParse(
      (request as { body: unknown }).body
    );
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await hostProcess.prepare(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  const hostProcessDecisionHandler = async (
    request: unknown,
    reply: unknown
  ) => {
    const fastifyReply = replyFrom(reply);
    const parsed = hostProcessDecisionSchema.safeParse(
      (request as { body: unknown }).body
    );
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await hostProcess.decide(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  const hostProcessExecuteHandler = async (
    request: unknown,
    reply: unknown
  ) => {
    const fastifyReply = replyFrom(reply);
    const parsed = hostProcessExecuteSchema.safeParse(
      (request as { body: unknown }).body
    );
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await hostProcess.execute(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  const hostProcessReadHandler = async (
    request: unknown,
    reply: unknown
  ) => {
    const fastifyReply = replyFrom(reply);
    const parsed = hostProcessReadSchema.safeParse(
      (request as { body: unknown }).body
    );
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await hostProcess.read(
        operationContextFromRequest(request),
        parsed.data
      );
    } catch (error) {
      return sendUnknownApiError(fastifyReply, error);
    }
  };

  const hostProcessListHandler = async (
    request: unknown,
    reply: unknown
  ) => {
    const fastifyReply = replyFrom(reply);
    const parsed = hostProcessListSchema.safeParse(
      (request as { query?: unknown }).query ?? {}
    );
    if (!parsed.success) {
      return sendUnknownApiError(fastifyReply, validationError(parsed.error));
    }
    try {
      return await hostProcess.list(parsed.data);
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
    const repoId = query.repoId ?? identity.defaultRepoId;
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
    const repoId = query.repoId ?? identity.defaultRepoId;
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
  app.get("/api/integrations/status", integrationStatusHandler);
  app.get("/api/connectivity/providers", connectivityProviderStatusHandler);
  app.get("/api/connectivity/routes", publicRouteCandidateStatusHandler);
  app.post("/api/connectivity/routes/candidate", stagePublicRouteCandidateHandler);
  app.delete("/api/connectivity/routes/candidate", discardPublicRouteCandidateHandler);
  app.get("/api/connectivity/routes/verification", publicRouteVerificationStatusHandler);
  app.post("/api/connectivity/routes/candidate/verify", verifyPublicRouteCandidateHandler);

  app.get("/api/setup/status", setupStatusHandler);
  app.get("/tokenpilot/api/setup/status", setupStatusHandler);

  app.get("/api/git/recent-commits", recentCommitsHandler);
  app.get("/tokenpilot/api/git/recent-commits", recentCommitsHandler);

  app.get("/", async (_request, reply) => {
    reply.type("application/json; charset=utf-8");
    return {
      ok: true,
      service: `${identity.packageName}-control-plane`,
      health: buildPublicHealthStatus(paths),
      ui: accessPolicy.consolePathPrefix === "/ui" ? "/ui" : null,
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

  app.post("/api/host/processes/prepare", hostProcessPrepareHandler);
  app.post(
    "/tokenpilot/api/host/processes/prepare",
    hostProcessPrepareHandler
  );
  app.post("/api/host/processes/decision", hostProcessDecisionHandler);
  app.post(
    "/tokenpilot/api/host/processes/decision",
    hostProcessDecisionHandler
  );
  app.post("/api/host/processes/execute", hostProcessExecuteHandler);
  app.post(
    "/tokenpilot/api/host/processes/execute",
    hostProcessExecuteHandler
  );
  app.post("/api/host/processes/read", hostProcessReadHandler);
  app.post(
    "/tokenpilot/api/host/processes/read",
    hostProcessReadHandler
  );
  app.get("/api/host/processes", hostProcessListHandler);
  app.get("/tokenpilot/api/host/processes", hostProcessListHandler);

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

  registerStaticRoutes(app, paths, accessPolicy.consolePathPrefix);

  return app;
}

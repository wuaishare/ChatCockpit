import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { z } from "zod";

import type { ContinuityServices } from "../application/continuity-services.js";
import type { CodexThreadImportService } from "../application/codex-thread-import-service.js";
import { asyncJobQueueSchema } from "../contracts/async-job.js";
import {
  codexThreadImportAssessSchema,
  codexThreadImportContextSchema,
  codexThreadImportExecuteSchema,
  codexThreadImportGetSchema
} from "../contracts/codex-thread-import.js";
import {
  workspaceDiscoveryImportSchema,
  workspaceDiscoveryRootCreateSchema,
  workspaceDiscoveryRootMutationSchema,
  workspaceDiscoveryRootParamsSchema
} from "../contracts/workspace-onboarding.js";
import {
  developmentDocumentAppendVersionSchema,
  developmentDocumentCreateSchema,
  developmentDocumentGetSchema,
  developmentDocumentListSchema,
  developmentDocumentStatusSchema,
  developmentDocumentVersionGetSchema,
  taskDocumentBindSchema
} from "../contracts/development-documents.js";
import {
  evidenceRecordSchema,
  handoffAcceptSchema,
  handoffCancelSchema,
  handoffForkSchema,
  handoffPrepareSchema,
  leaseAcquireSchema,
  leaseReleaseSchema,
  projectGetSchema,
  projectListSchema,
  sessionGetSchema,
  sessionStartSchema,
  taskCompleteSchema,
  taskCreateSchema,
  taskSubmitReviewSchema,
  taskGetSchema,
  workspaceSnapshotSchema
} from "../contracts/continuity.js";
import { ApiError, sendUnknownApiError, validationError } from "./errors.js";
import { requireMachineLocalOwner } from "./machine-local-authority.js";
import { operationContextFromRequest } from "./request-context.js";

function parseOrReply<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  reply: FastifyReply
): z.infer<TSchema> | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    sendUnknownApiError(reply, validationError(parsed.error));
    return null;
  }
  return parsed.data;
}

function registerAliases(
  app: FastifyInstance,
  method: "GET" | "POST" | "DELETE",
  path: string,
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown
): void {
  for (const url of [path, `/tokenpilot${path}`]) {
    app.route({ method, url, handler });
  }
}

function requireContinuityOwner(request: FastifyRequest): void {
  if (request.chatCockpitAuth.kind !== "operator-session") {
    throw new ApiError(
      403,
      "OPERATOR_SESSION_REQUIRED",
      "Web Owner session is required for Codex thread import management"
    );
  }
}

export function registerContinuityRoutes(
  app: FastifyInstance,
  services: ContinuityServices,
  codexThreadImports?: CodexThreadImportService
): void {
  registerAliases(app, "GET", "/api/continuity/projects", (request, reply) => {
    const input = parseOrReply(projectListSchema, request.query ?? {}, reply);
    if (!input) return;
    try {
      return {
        ok: true,
        projects: services.projects.list(
          operationContextFromRequest(request),
          input.status
        )
      };
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });

  registerAliases(
    app,
    "GET",
    "/api/continuity/projects/:projectId",
    (request, reply) => {
      const input = parseOrReply(projectGetSchema, request.params, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.projects.get(
            operationContextFromRequest(request),
            input.projectId
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/continuity/workspace-discovery/roots",
    (request, reply) => {
      try {
        requireMachineLocalOwner(request);
        return {
          ok: true,
          ...services.workspaceOnboarding.listRoots(operationContextFromRequest(request))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/workspace-discovery/roots",
    (request, reply) => {
      const input = parseOrReply(workspaceDiscoveryRootCreateSchema, request.body, reply);
      if (!input) return;
      try {
        requireMachineLocalOwner(request);
        return {
          ok: true,
          ...services.workspaceOnboarding.addRoot(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "DELETE",
    "/api/continuity/workspace-discovery/roots/:rootId",
    (request, reply) => {
      const params = parseOrReply(workspaceDiscoveryRootParamsSchema, request.params, reply);
      if (!params) return;
      const body = parseOrReply(workspaceDiscoveryRootMutationSchema, request.body, reply);
      if (!body) return;
      try {
        requireMachineLocalOwner(request);
        return {
          ok: true,
          ...services.workspaceOnboarding.removeRoot(operationContextFromRequest(request), {
            rootId: params.rootId,
            expectedConfigRevision: body.expectedConfigRevision
          })
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/workspace-discovery/roots/:rootId/scan",
    (request, reply) => {
      const params = parseOrReply(workspaceDiscoveryRootParamsSchema, request.params, reply);
      if (!params) return;
      const body = parseOrReply(workspaceDiscoveryRootMutationSchema, request.body, reply);
      if (!body) return;
      try {
        requireMachineLocalOwner(request);
        return {
          ok: true,
          ...services.workspaceOnboarding.scanRoot(operationContextFromRequest(request), {
            rootId: params.rootId,
            expectedConfigRevision: body.expectedConfigRevision
          })
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/workspace-discovery/roots/:rootId/import",
    async (request, reply) => {
      const params = parseOrReply(workspaceDiscoveryRootParamsSchema, request.params, reply);
      if (!params) return;
      const body = parseOrReply(workspaceDiscoveryImportSchema, request.body, reply);
      if (!body) return;
      try {
        requireMachineLocalOwner(request);
        return {
          ok: true,
          ...(await services.workspaceOnboarding.importCandidate(
            operationContextFromRequest(request),
            {
              rootId: params.rootId,
              candidateId: body.candidateId,
              repoId: body.repoId,
              expectedConfigRevision: body.expectedConfigRevision,
              idempotencyKey: body.idempotencyKey
            }
          ))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  if (codexThreadImports) {
    registerAliases(
      app,
      "POST",
      "/api/continuity/workspaces/:workspaceId/codex-thread-imports/assess",
      async (request, reply) => {
        const input = parseOrReply(
          codexThreadImportAssessSchema,
          { ...(request.body as object), ...(request.params as object) },
          reply
        );
        if (!input) return;
        try {
          requireContinuityOwner(request);
          return {
            ok: true,
            ...(await codexThreadImports.assess(
              operationContextFromRequest(request),
              input
            ))
          };
        } catch (error) {
          return sendUnknownApiError(reply, error);
        }
      }
    );

    registerAliases(
      app,
      "POST",
      "/api/continuity/codex-thread-imports/:importId/execute",
      async (request, reply) => {
        const input = parseOrReply(
          codexThreadImportExecuteSchema,
          { ...(request.body as object), ...(request.params as object) },
          reply
        );
        if (!input) return;
        try {
          requireContinuityOwner(request);
          return {
            ok: true,
            ...(await codexThreadImports.execute(
              operationContextFromRequest(request),
              input
            ))
          };
        } catch (error) {
          return sendUnknownApiError(reply, error);
        }
      }
    );

    registerAliases(
      app,
      "GET",
      "/api/continuity/codex-thread-imports/:importId",
      (request, reply) => {
        const input = parseOrReply(codexThreadImportGetSchema, request.params, reply);
        if (!input) return;
        try {
          requireContinuityOwner(request);
          return {
            ok: true,
            import: codexThreadImports.get(
              operationContextFromRequest(request),
              input.importId
            )
          };
        } catch (error) {
          return sendUnknownApiError(reply, error);
        }
      }
    );

    registerAliases(
      app,
      "GET",
      "/api/continuity/codex-thread-imports/:importId/context",
      async (request, reply) => {
        const input = parseOrReply(
          codexThreadImportContextSchema,
          { ...(request.query as object), ...(request.params as object) },
          reply
        );
        if (!input) return;
        try {
          requireContinuityOwner(request);
          return {
            ok: true,
            context: await codexThreadImports.readContext(
              operationContextFromRequest(request),
              input
            )
          };
        } catch (error) {
          return sendUnknownApiError(reply, error);
        }
      }
    );
  }

  registerAliases(
    app,
    "GET",
    "/api/continuity/workspaces/:workspaceId/snapshot",
    (request, reply) => {
      const input = parseOrReply(workspaceSnapshotSchema, request.params, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          snapshot: services.workspaces.snapshot(
            operationContextFromRequest(request),
            input
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/continuity/documents",
    (request, reply) => {
      const input = parseOrReply(
        developmentDocumentListSchema,
        request.query ?? {},
        reply
      );
      if (!input) return;
      try {
        return {
          ok: true,
          documents: services.developmentDocuments.list(
            operationContextFromRequest(request),
            input
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/documents",
    (request, reply) => {
      const input = parseOrReply(
        developmentDocumentCreateSchema,
        request.body,
        reply
      );
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.developmentDocuments.create(
            operationContextFromRequest(request),
            input
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/continuity/documents/:documentId",
    (request, reply) => {
      const input = parseOrReply(
        developmentDocumentGetSchema,
        request.params,
        reply
      );
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.developmentDocuments.get(
            operationContextFromRequest(request),
            input
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/continuity/documents/:documentId/versions/:version",
    (request, reply) => {
      const input = parseOrReply(
        developmentDocumentVersionGetSchema,
        {
          ...(request.params as Record<string, unknown>),
          version: Number(
            (request.params as { version?: string }).version
          )
        },
        reply
      );
      if (!input) return;
      try {
        return {
          ok: true,
          version: services.developmentDocuments.getVersion(
            operationContextFromRequest(request),
            input
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/documents/append-version",
    (request, reply) => {
      const input = parseOrReply(
        developmentDocumentAppendVersionSchema,
        request.body,
        reply
      );
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.developmentDocuments.appendVersion(
            operationContextFromRequest(request),
            input
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/documents/update-status",
    (request, reply) => {
      const input = parseOrReply(
        developmentDocumentStatusSchema,
        request.body,
        reply
      );
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.developmentDocuments.updateStatus(
            operationContextFromRequest(request),
            input
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/tasks/bind-documents",
    (request, reply) => {
      const input = parseOrReply(taskDocumentBindSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.developmentDocuments.bindTaskDocuments(
            operationContextFromRequest(request),
            input
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/async-jobs/queue",
    (request, reply) => {
      const input = parseOrReply(asyncJobQueueSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.asyncJobs.queue(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(app, "POST", "/api/continuity/tasks", (request, reply) => {
    const input = parseOrReply(taskCreateSchema, request.body, reply);
    if (!input) return;
    try {
      return {
        ok: true,
        ...services.tasks.create(operationContextFromRequest(request), input)
      };
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });

  registerAliases(
    app,
    "POST",
    "/api/continuity/tasks/submit-review",
    (request, reply) => {
      const input = parseOrReply(taskSubmitReviewSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.taskCompletion.submitReview(
            operationContextFromRequest(request),
            input
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/tasks/complete",
    (request, reply) => {
      const input = parseOrReply(taskCompleteSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.taskCompletion.complete(
            operationContextFromRequest(request),
            input
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/continuity/tasks/:taskId",
    (request, reply) => {
      const input = parseOrReply(taskGetSchema, request.params, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          task: services.tasks.get(
            operationContextFromRequest(request),
            input.taskId
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/sessions/start",
    (request, reply) => {
      const input = parseOrReply(sessionStartSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.sessions.start(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/continuity/sessions/:sessionId",
    (request, reply) => {
      const input = parseOrReply(sessionGetSchema, request.params, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          session: services.sessions.get(
            operationContextFromRequest(request),
            input.sessionId
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/leases/acquire",
    (request, reply) => {
      const input = parseOrReply(leaseAcquireSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.leases.acquire(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/leases/release",
    (request, reply) => {
      const input = parseOrReply(leaseReleaseSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.leases.release(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/handoffs/prepare",
    (request, reply) => {
      const input = parseOrReply(handoffPrepareSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.handoffs.prepare(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/handoffs/cancel",
    (request, reply) => {
      const input = parseOrReply(handoffCancelSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.handoffs.cancel(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/handoffs/fork",
    (request, reply) => {
      const input = parseOrReply(handoffForkSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.handoffs.fork(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/handoffs/accept",
    (request, reply) => {
      const input = parseOrReply(handoffAcceptSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.handoffs.accept(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/evidence/record",
    (request, reply) => {
      const input = parseOrReply(evidenceRecordSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.evidence.record(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );
}

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { z } from "zod";

import type { ProjectService } from "../application/project-service.js";
import type { ProjectDevelopmentRoutingService } from "../application/project-development-routing-service.js";
import {
  projectRegistryAttachWorkspaceSchema,
  projectRegistryCreateSchema,
  projectRegistryListSchema,
  projectRegistryMutationSchema,
  projectRegistryProjectParamsSchema,
  projectRegistryRenameSchema,
  projectRegistryWorkspaceParamsSchema
} from "../contracts/project-registry.js";
import { sendUnknownApiError, validationError } from "./errors.js";
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

function ownerOnly(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => unknown | Promise<unknown>
): unknown | Promise<unknown> {
  try {
    requireMachineLocalOwner(request);
    return handler();
  } catch (error) {
    return sendUnknownApiError(reply, error);
  }
}

export function registerProjectRegistryRoutes(
  app: FastifyInstance,
  projects: ProjectService,
  projectDevelopmentRouting?: ProjectDevelopmentRoutingService
): void {
  app.get("/api/projects", (request, reply) =>
    ownerOnly(request, reply, () => {
      const input = parseOrReply(projectRegistryListSchema, request.query ?? {}, reply);
      if (!input) return;
      return {
        ok: true,
        ...projects.registry(operationContextFromRequest(request), input.status)
      };
    })
  );

  app.get("/api/projects/:projectId", (request, reply) =>
    ownerOnly(request, reply, async () => {
      const input = parseOrReply(projectRegistryProjectParamsSchema, request.params, reply);
      if (!input) return;
      const context = operationContextFromRequest(request);
      const project = projects.get(context, input.projectId);
      const configRevision = projects.configRevision();
      if (!projectDevelopmentRouting) {
        return { ok: true, configRevision, ...project };
      }
      const developmentCoordination = await projectDevelopmentRouting.coordinate(
        context,
        input.projectId
      );
      return {
        ok: true,
        configRevision,
        ...project,
        developmentCoordination,
        nativeDevelopment:
          projectDevelopmentRouting.toLegacyAssessment(developmentCoordination)
      };
    })
  );

  app.post("/api/projects", (request, reply) =>
    ownerOnly(request, reply, () => {
      const input = parseOrReply(projectRegistryCreateSchema, request.body, reply);
      if (!input) return;
      return {
        ok: true,
        ...projects.create(operationContextFromRequest(request), input)
      };
    })
  );

  app.post("/api/projects/:projectId/rename", (request, reply) =>
    ownerOnly(request, reply, () => {
      const params = parseOrReply(projectRegistryProjectParamsSchema, request.params, reply);
      if (!params) return;
      const body = parseOrReply(projectRegistryRenameSchema, request.body, reply);
      if (!body) return;
      return {
        ok: true,
        ...projects.rename(operationContextFromRequest(request), {
          projectId: params.projectId,
          displayName: body.displayName,
          expectedConfigRevision: body.expectedConfigRevision
        })
      };
    })
  );

  app.post("/api/projects/:projectId/workspaces", (request, reply) =>
    ownerOnly(request, reply, () => {
      const params = parseOrReply(projectRegistryProjectParamsSchema, request.params, reply);
      if (!params) return;
      const body = parseOrReply(projectRegistryAttachWorkspaceSchema, request.body, reply);
      if (!body) return;
      return {
        ok: true,
        ...projects.attachWorkspace(operationContextFromRequest(request), {
          projectId: params.projectId,
          repoId: body.repoId,
          path: body.path,
          expectedConfigRevision: body.expectedConfigRevision
        })
      };
    })
  );

  app.post(
    "/api/projects/:projectId/workspaces/:workspaceId/make-primary",
    (request, reply) =>
      ownerOnly(request, reply, () => {
        const params = parseOrReply(
          projectRegistryWorkspaceParamsSchema,
          request.params,
          reply
        );
        if (!params) return;
        const body = parseOrReply(projectRegistryMutationSchema, request.body, reply);
        if (!body) return;
        return {
          ok: true,
          ...projects.makePrimaryWorkspace(operationContextFromRequest(request), {
            projectId: params.projectId,
            workspaceId: params.workspaceId,
            expectedConfigRevision: body.expectedConfigRevision
          })
        };
      })
  );
}

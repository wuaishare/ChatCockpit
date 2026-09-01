import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { z } from "zod";

import type { ProjectService } from "../application/project-service.js";
import type { ProjectDevelopmentRoutingService } from "../application/project-development-routing-service.js";
import type { ProjectRootDiscoveryService } from "../application/project-root-discovery-service.js";
import {
  projectRegistryAttachRootSchema,
  projectRegistryAttachWorkspaceSchema,
  projectRegistryCreateSchema,
  projectRegistryListSchema,
  projectRegistryMutationSchema,
  projectRegistryProjectParamsSchema,
  projectRegistryRenameSchema,
  projectRegistryRootParamsSchema,
  projectRegistryWorkspaceParamsSchema
} from "../contracts/project-registry.js";
import { ApiError, sendUnknownApiError, validationError } from "./errors.js";
import { isMachineLocalRequest, requireMachineLocalOwner } from "./machine-local-authority.js";
import { OPERATOR_CSRF_HEADER } from "./operator-auth-context.js";
import { operationContextFromRequest } from "./request-context.js";

function parseOrReply<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  reply: FastifyReply
): z.infer<TSchema> | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const body = sendUnknownApiError(reply, validationError(parsed.error));
    void reply.send(body);
    return null;
  }
  return parsed.data;
}

function requireOperatorSession(request: FastifyRequest): void {
  if (request.chatCockpitAuth.kind !== "operator-session") {
    throw new ApiError(
      401,
      "OPERATOR_SESSION_REQUIRED",
      "An authenticated console administrator session is required"
    );
  }
}

function requireOperatorCsrf(request: FastifyRequest): void {
  const auth = request.chatCockpitAuth;
  if (auth.kind !== "operator-session") {
    throw new ApiError(
      401,
      "OPERATOR_SESSION_REQUIRED",
      "An authenticated console administrator session is required"
    );
  }
  const value = request.headers[OPERATOR_CSRF_HEADER];
  const csrf = Array.isArray(value) ? value[0] : value;
  if (typeof csrf !== "string" || !csrf) {
    throw new ApiError(403, "CSRF_REQUIRED", "Operator session mutation requires a CSRF token");
  }
  if (csrf !== auth.session.csrfToken) {
    throw new ApiError(403, "CSRF_INVALID", "Operator session CSRF token is invalid");
  }
}

function operatorOnly(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => unknown | Promise<unknown>,
  mutation = false
): unknown | Promise<unknown> {
  try {
    requireOperatorSession(request);
    if (mutation) requireOperatorCsrf(request);
    return handler();
  } catch (error) {
    return sendUnknownApiError(reply, error);
  }
}

function machineLocalOwnerOnly(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => unknown | Promise<unknown>,
  mutation = false
): unknown | Promise<unknown> {
  try {
    requireMachineLocalOwner(request);
    if (mutation) requireOperatorCsrf(request);
    return handler();
  } catch (error) {
    return sendUnknownApiError(reply, error);
  }
}

export function registerProjectRegistryRoutes(
  app: FastifyInstance,
  projects: ProjectService,
  projectDevelopmentRouting?: ProjectDevelopmentRoutingService,
  projectRootDiscovery?: ProjectRootDiscoveryService
): void {
  if (projectRootDiscovery) {
    app.get("/api/projects/discovery", (request, reply) =>
      machineLocalOwnerOnly(request, reply, async () => ({
        ok: true,
        ...(await projectRootDiscovery.listCandidates(operationContextFromRequest(request)))
      }))
    );
  }

  app.get("/api/projects", (request, reply) =>
    operatorOnly(request, reply, () => {
      const input = parseOrReply(projectRegistryListSchema, request.query ?? {}, reply);
      if (!input) return;
      return {
        ok: true,
        ...projects.registry(operationContextFromRequest(request), input.status)
      };
    })
  );

  app.get("/api/projects/:projectId", (request, reply) =>
    operatorOnly(request, reply, async () => {
      const input = parseOrReply(projectRegistryProjectParamsSchema, request.params, reply);
      if (!input) return;
      const context = operationContextFromRequest(request);
      const project = isMachineLocalRequest(request)
        ? projects.registryProject(context, input.projectId)
        : projects.registryProjectPublic(context, input.projectId);
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
    machineLocalOwnerOnly(request, reply, () => {
      const input = parseOrReply(projectRegistryCreateSchema, request.body, reply);
      if (!input) return;
      if ("root" in input) {
        return {
          ok: true,
          ...projects.createProject(operationContextFromRequest(request), {
            slug: input.slug,
            displayName: input.displayName,
            rootPath: input.root.path,
            kind: input.root.kind,
            role: input.root.role,
            access: input.root.access,
            repoId: input.root.repoId,
            expectedConfigRevision: input.expectedConfigRevision
          })
        };
      }
      return {
        ok: true,
        ...projects.create(operationContextFromRequest(request), input)
      };
    }, true)
  );

  app.post("/api/projects/:projectId/rename", (request, reply) =>
    operatorOnly(request, reply, () => {
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
    }, true)
  );

  app.post("/api/projects/:projectId/roots", (request, reply) =>
    machineLocalOwnerOnly(request, reply, () => {
      const params = parseOrReply(projectRegistryProjectParamsSchema, request.params, reply);
      if (!params) return;
      const body = parseOrReply(projectRegistryAttachRootSchema, request.body, reply);
      if (!body) return;
      return {
        ok: true,
        ...projects.attachRoot(operationContextFromRequest(request), {
          projectId: params.projectId,
          rootPath: body.path,
          kind: body.kind,
          role: body.role,
          access: body.access,
          repoId: body.repoId,
          expectedConfigRevision: body.expectedConfigRevision
        })
      };
    }, true)
  );

  app.post(
    "/api/projects/:projectId/roots/:rootId/make-primary",
    (request, reply) =>
      machineLocalOwnerOnly(request, reply, () => {
        const params = parseOrReply(projectRegistryRootParamsSchema, request.params, reply);
        if (!params) return;
        const body = parseOrReply(projectRegistryMutationSchema, request.body, reply);
        if (!body) return;
        return {
          ok: true,
          ...projects.makePrimaryRoot(operationContextFromRequest(request), {
            projectId: params.projectId,
            rootId: params.rootId,
            expectedConfigRevision: body.expectedConfigRevision
          })
        };
      }, true)
  );

  app.post(
    "/api/projects/:projectId/roots/:rootId/detach",
    (request, reply) =>
      machineLocalOwnerOnly(request, reply, () => {
        const params = parseOrReply(projectRegistryRootParamsSchema, request.params, reply);
        if (!params) return;
        const body = parseOrReply(projectRegistryMutationSchema, request.body, reply);
        if (!body) return;
        return {
          ok: true,
          ...projects.detachRoot(operationContextFromRequest(request), {
            projectId: params.projectId,
            rootId: params.rootId,
            expectedConfigRevision: body.expectedConfigRevision
          })
        };
      }, true)
  );

  // Compatibility route: a Workspace attach is a git-repository ProjectRoot attach.
  app.post("/api/projects/:projectId/workspaces", (request, reply) =>
    machineLocalOwnerOnly(request, reply, () => {
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
    }, true)
  );

  // Compatibility route: making a Workspace primary promotes its owning ProjectRoot.
  app.post(
    "/api/projects/:projectId/workspaces/:workspaceId/make-primary",
    (request, reply) =>
      machineLocalOwnerOnly(request, reply, () => {
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
      }, true)
  );
}

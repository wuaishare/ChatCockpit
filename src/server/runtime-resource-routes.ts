import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { z } from "zod";

import type { RuntimeResourceMutationService } from "../application/runtime-resource-mutation-service.js";
import type { RuntimeResourceServices } from "../application/runtime-resource-services.js";
import type { RuntimeResourceDescriptor } from "../application/runtime-resource-types.js";
import {
  runtimeResourceInventoryRequestSchema,
  runtimeResourceItemParamsSchema,
  runtimeResourceMutationActivityQuerySchema,
  runtimeResourceMutationApprovalParamsSchema,
  runtimeResourceMutationDecisionSchema,
  runtimeResourceMutationExecuteSchema,
  runtimeResourceMutationExecutionParamsSchema,
  runtimeResourceMutationPrepareSchema,
  runtimeResourceMutationWorkspaceQuerySchema,
  runtimeResourceSnapshotParamsSchema
} from "../contracts/runtime-resources.js";
import type { RuntimeResourceMutationOperation } from "../continuity/repositories/runtime-resource-mutation-repository.js";
import { sendApiError, sendUnknownApiError, validationError } from "./errors.js";
import { operationContextFromRequest } from "./request-context.js";
import { isResourceMutationExposureEnabled } from "./runtime-resource-mutation-policy.js";

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
  method: "GET" | "POST",
  path: string,
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown
): void {
  for (const url of [path, `/tokenpilot${path}`]) {
    app.route({ method, url, handler });
  }
}

function mutationOperations(resource: RuntimeResourceDescriptor): RuntimeResourceMutationOperation[] {
  if (resource.kind === "skill") {
    return ["skill.enable", "skill.disable"];
  }
  if (resource.kind === "plugin") {
    return ["plugin.install", "plugin.uninstall"];
  }
  return [];
}

function mutationWriteBlocked(reply: FastifyReply): unknown | null {
  if (isResourceMutationExposureEnabled()) return null;
  return sendApiError(
    reply,
    403,
    "RUNTIME_RESOURCE_MUTATION_EXPOSURE_DISABLED",
    "Runtime Resource mutation writes are disabled for this exposed ChatCockpit deployment."
  );
}

export function registerRuntimeResourceRoutes(
  app: FastifyInstance,
  services: RuntimeResourceServices,
  mutationService: RuntimeResourceMutationService
): void {
  registerAliases(app, "GET", "/api/resources/runtime-profiles", async (_request, reply) => {
    try {
      const projection = await services.providers.snapshot();
      return {
        ok: true,
        target: projection.target,
        providers: projection.providers,
        profiles: projection.profiles,
        management: services.management.snapshot(projection.profiles)
      };
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });

  registerAliases(app, "GET", "/api/resources/providers", async (_request, reply) => {
    try {
      const projection = await services.providers.snapshot();
      return {
        ok: true,
        ...services.management.snapshot(projection.profiles)
      };
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });

  registerAliases(app, "POST", "/api/resources/inventory", async (request, reply) => {
    const input = parseOrReply(runtimeResourceInventoryRequestSchema, request.body, reply);
    if (!input) return;
    try {
      const inventory = await services.inventory.inventory(input);
      return {
        ok: true,
        ...inventory,
        mutationWritesEnabled: isResourceMutationExposureEnabled(),
        mutationEligibility: inventory.resources
          .map((resource) => ({
            resourceId: resource.id,
            snapshotId: inventory.snapshot.id,
            operations: mutationOperations(resource).map((operation) =>
              services.mutations.eligibility({
                snapshotId: inventory.snapshot.id,
                resourceId: resource.id,
                operation
              })
            )
          }))
          .filter((entry) => entry.operations.length > 0)
      };
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });

  registerAliases(
    app,
    "GET",
    "/api/resources/snapshots/:snapshotId",
    (request, reply) => {
      const input = parseOrReply(
        runtimeResourceSnapshotParamsSchema,
        request.params,
        reply
      );
      if (!input) return;
      try {
        return {
          ok: true,
          snapshot: services.inventory.readSnapshot(input.snapshotId)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/resources/items/:resourceId",
    (request, reply) => {
      const input = parseOrReply(runtimeResourceItemParamsSchema, request.params, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.inventory.inspectResource(input.resourceId)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/resources/mutations/prepare",
    async (request, reply) => {
      const blocked = mutationWriteBlocked(reply);
      if (blocked) return blocked;
      const input = parseOrReply(runtimeResourceMutationPrepareSchema, request.body, reply);
      if (!input) return;
      try {
        const result = await mutationService.prepare(
          operationContextFromRequest(request),
          input
        );
        const workspaceId = result.approval.workspaceId;
        if (!workspaceId) {
          return sendApiError(
            reply,
            409,
            "RUNTIME_RESOURCE_MUTATION_WORKSPACE_REQUIRED",
            "Runtime Resource mutation approval has no Workspace scope."
          );
        }
        return {
          ok: true,
          approval: services.mutations.getApproval({
            workspaceId,
            approvalId: result.approval.id
          }),
          replayed: result.replayed
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/resources/mutations/decision",
    (request, reply) => {
      const blocked = mutationWriteBlocked(reply);
      if (blocked) return blocked;
      if (request.chatCockpitAuth.kind !== "operator-session") {
        return sendApiError(
          reply,
          403,
          "RUNTIME_RESOURCE_MUTATION_DECISION_FORBIDDEN",
          "Runtime Resource mutation decisions require an authenticated operator session"
        );
      }
      const input = parseOrReply(runtimeResourceMutationDecisionSchema, request.body, reply);
      if (!input) return;
      try {
        const result = mutationService.decide(operationContextFromRequest(request), input);
        const workspaceId = result.approval.workspaceId;
        if (!workspaceId) {
          return sendApiError(
            reply,
            409,
            "RUNTIME_RESOURCE_MUTATION_WORKSPACE_REQUIRED",
            "Runtime Resource mutation approval has no Workspace scope."
          );
        }
        return {
          ok: true,
          approval: services.mutations.getApproval({
            workspaceId,
            approvalId: result.approval.id
          }),
          replayed: result.replayed
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/resources/mutations/execute",
    async (request, reply) => {
      const blocked = mutationWriteBlocked(reply);
      if (blocked) return blocked;
      const input = parseOrReply(runtimeResourceMutationExecuteSchema, request.body, reply);
      if (!input) return;
      try {
        const result = await mutationService.execute(
          operationContextFromRequest(request),
          input
        );
        const workspaceId = result.execution.workspaceId;
        if (!workspaceId) {
          return sendApiError(
            reply,
            409,
            "RUNTIME_RESOURCE_MUTATION_WORKSPACE_REQUIRED",
            "Runtime Resource mutation execution has no Workspace scope."
          );
        }
        return {
          ok: true,
          approval: services.mutations.getApproval({
            workspaceId,
            approvalId: result.approval.id
          }),
          execution: services.mutations.getExecution({
            workspaceId,
            executionId: result.execution.id
          }),
          replayed: result.replayed
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/resources/mutations/approvals/:approvalId",
    (request, reply) => {
      const params = parseOrReply(
        runtimeResourceMutationApprovalParamsSchema,
        request.params,
        reply
      );
      if (!params) return;
      const query = parseOrReply(
        runtimeResourceMutationWorkspaceQuerySchema,
        request.query,
        reply
      );
      if (!query) return;
      try {
        return {
          ok: true,
          approval: services.mutations.getApproval({
            workspaceId: query.workspaceId,
            approvalId: params.approvalId
          })
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/resources/mutations/executions/:executionId",
    (request, reply) => {
      const params = parseOrReply(
        runtimeResourceMutationExecutionParamsSchema,
        request.params,
        reply
      );
      if (!params) return;
      const query = parseOrReply(
        runtimeResourceMutationWorkspaceQuerySchema,
        request.query,
        reply
      );
      if (!query) return;
      try {
        return {
          ok: true,
          execution: services.mutations.getExecution({
            workspaceId: query.workspaceId,
            executionId: params.executionId
          })
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/resources/mutations/activity",
    (request, reply) => {
      const input = parseOrReply(
        runtimeResourceMutationActivityQuerySchema,
        request.query,
        reply
      );
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.mutations.activity(input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

}

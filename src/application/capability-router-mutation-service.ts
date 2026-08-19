import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/client";

import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";
import { CapabilityRouterCatalogService } from "./capability-router-catalog-service.js";
import {
  projectCapabilityRouterResult,
  type CapabilityRouterResultProjection,
} from "./capability-router-result-projection.js";
import {
  loadDownstreamMcpExecutorsConfig,
  type DownstreamMcpExecutorConfig,
} from "../direct/downstream-mcp-config.js";
import { createDownstreamMcpClient } from "../direct/downstream-mcp-client-factory.js";
import type { DownstreamMcpClient } from "../direct/downstream-mcp-types.js";
import type { GovernanceLedger } from "../governance/governance-ledger.js";
import {
  buildGovernanceActorProvenance,
  hashGovernanceValue,
} from "../governance/governance-hash.js";
import type {
  GovernedExternalActionApprovalRecord,
  GovernedExternalActionExecutionRecord,
} from "../governance/governed-external-action-repository.js";

const APPROVAL_TTL_MS = 5 * 60 * 1000;
const TARGET_ID = "local-device";
const PREPARE_OPERATION = "capability.router.mutation.prepare";
const DECIDE_OPERATION = "capability.router.mutation.decide";
const EXECUTE_OPERATION = "capability.router.mutation.execute";

export type CapabilityRouterMutationClientFactory = (
  executor: DownstreamMcpExecutorConfig,
) => DownstreamMcpClient;

export interface CapabilityRouterMutationPrepareInput {
  idempotencyKey: string;
  executorId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface CapabilityRouterMutationDecisionInput {
  idempotencyKey: string;
  approvalId: string;
  expectedRevision: number;
  decision: "approved" | "denied";
}

export interface CapabilityRouterMutationExecuteInput {
  idempotencyKey: string;
  approvalId: string;
  expectedApprovalRevision: number;
  executorId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface CapabilityRouterMutationPrepareResult {
  ok: true;
  approval: GovernedExternalActionApprovalRecord;
  replayed: boolean;
}

export interface CapabilityRouterMutationDecisionResult {
  ok: true;
  approval: GovernedExternalActionApprovalRecord;
  replayed: boolean;
}

export interface CapabilityRouterMutationExecuteResult {
  ok: true;
  approval: GovernedExternalActionApprovalRecord;
  execution: GovernedExternalActionExecutionRecord;
  result: CapabilityRouterResultProjection;
  replayed: boolean;
}

interface MutationPreflight {
  executor: DownstreamMcpExecutorConfig;
  executorConfigHash: string;
  executorId: string;
  providerDisplayName: string;
  protocolFamily: "mcp-legacy-stdio" | "mcp-streamable-http";
  toolName: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown> | null;
}

interface PreparedMutationExecution {
  approval: GovernedExternalActionApprovalRecord;
  execution: GovernedExternalActionExecutionRecord;
  executor: DownstreamMcpExecutorConfig;
}

function approvalExpiry(now: string): string {
  return new Date(new Date(now).getTime() + APPROVAL_TTL_MS).toISOString();
}

function assertMutationAnnotations(
  annotations: Record<string, unknown> | null,
): void {
  if (annotations?.readOnlyHint === true) {
    throw new ServiceError(
      "CAPABILITY_ROUTER_TOOL_SAFETY_CONFLICT",
      "Capability Router mutation exposure conflicts with downstream read-only annotation",
    );
  }
}

function executorConfigHash(executor: DownstreamMcpExecutorConfig): string {
  return hashGovernanceValue({
    schemaVersion: 1,
    executor,
  });
}

function policyHash(input: {
  executorId: string;
  executorConfigHash: string;
  protocolFamily: string;
  toolName: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown> | null;
}): string {
  return hashGovernanceValue({
    schemaVersion: 1,
    targetId: TARGET_ID,
    providerId: input.executorId,
    executorConfigHash: input.executorConfigHash,
    protocolFamily: input.protocolFamily,
    toolName: input.toolName,
    mode: "mutation",
    inputSchema: input.inputSchema,
    annotations: input.annotations,
  });
}

function readPolicyHash(
  approval: GovernedExternalActionApprovalRecord,
): string | null {
  const value = approval.publicSummary.policyHash;
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
    ? value
    : null;
}

function validateArguments(
  validator: AjvJsonSchemaValidator,
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
): void {
  let validate: ReturnType<AjvJsonSchemaValidator["getValidator"]>;
  try {
    validate = validator.getValidator(schema as JsonSchemaType);
  } catch {
    throw new ServiceError(
      "CAPABILITY_ROUTER_SCHEMA_INVALID",
      "Capability Router tool input schema could not be compiled safely",
    );
  }
  if (!validate(args).valid) {
    throw new ServiceError(
      "CAPABILITY_ROUTER_ARGUMENTS_INVALID",
      "Capability Router tool arguments do not match the inspected input schema",
    );
  }
}

export class CapabilityRouterMutationService {
  private readonly catalog: CapabilityRouterCatalogService;
  private readonly validator = new AjvJsonSchemaValidator();

  constructor(
    runtimeDir: string,
    private readonly governance: GovernanceLedger,
    private readonly configPath?: string,
    private readonly clientFactory: CapabilityRouterMutationClientFactory = createDownstreamMcpClient,
  ) {
    this.catalog = new CapabilityRouterCatalogService(runtimeDir, configPath);
  }

  prepare(
    context: OperationContext,
    input: CapabilityRouterMutationPrepareInput,
  ): CapabilityRouterMutationPrepareResult {
    const argumentsHash = hashGovernanceValue(input.arguments);
    const requestedActor = buildGovernanceActorProvenance(context);
    const idempotencyInput = {
      targetId: TARGET_ID,
      executorId: input.executorId,
      toolName: input.toolName,
      argumentsHash,
      actor: {
        type: requestedActor.actorType,
        identityHash: requestedActor.actorIdentityHash,
      },
    };
    const replay = this.governance.idempotency.replay<{
      ok: true;
      approval: GovernedExternalActionApprovalRecord;
    }>(PREPARE_OPERATION, input.idempotencyKey, idempotencyInput);
    if (replay) return { ...replay.value, replayed: true };

    const preflight = this.requireMutationPreflight(
      input.executorId,
      input.toolName,
      input.arguments,
    );
    const approvedPolicyHash = this.preflightPolicyHash(preflight);
    const executed = this.governance.idempotency.execute(
      PREPARE_OPERATION,
      input.idempotencyKey,
      idempotencyInput,
      () => ({
        ok: true as const,
        approval: this.governance.externalActions.createApproval({
          targetId: TARGET_ID,
          providerId: preflight.executorId,
          toolName: preflight.toolName,
          argumentsHash,
          publicSummary: {
            targetId: TARGET_ID,
            providerId: preflight.executorId,
            providerDisplayName: preflight.providerDisplayName,
            protocolFamily: preflight.protocolFamily,
            toolName: preflight.toolName,
            action: "Provider-native mutation",
            policyHash: approvedPolicyHash,
          },
          requestedActor,
          expiresAt: approvalExpiry(context.now),
          now: context.now,
        }),
      }),
      context.now,
    );
    return { ...executed.value, replayed: executed.replayed };
  }

  decide(
    context: OperationContext,
    input: CapabilityRouterMutationDecisionInput,
  ): CapabilityRouterMutationDecisionResult {
    if (context.actorType === "remote-mcp") {
      throw new ServiceError(
        "CAPABILITY_ROUTER_MUTATION_DECISION_FORBIDDEN",
        "Remote MCP callers cannot decide Capability Router mutation approvals",
      );
    }
    const decidedActor = buildGovernanceActorProvenance(context);
    const idempotencyInput = {
      approvalId: input.approvalId,
      expectedRevision: input.expectedRevision,
      decision: input.decision,
      actor: {
        type: decidedActor.actorType,
        identityHash: decidedActor.actorIdentityHash,
      },
    };
    const executed = this.governance.idempotency.execute(
      DECIDE_OPERATION,
      input.idempotencyKey,
      idempotencyInput,
      () => ({
        ok: true as const,
        approval: this.governance.externalActions.decide({
          id: input.approvalId,
          expectedRevision: input.expectedRevision,
          decision: input.decision,
          decidedActor,
          now: context.now,
        }),
      }),
      context.now,
    );
    return { ...executed.value, replayed: executed.replayed };
  }

  async execute(
    context: OperationContext,
    input: CapabilityRouterMutationExecuteInput,
  ): Promise<CapabilityRouterMutationExecuteResult> {
    const argumentsHash = hashGovernanceValue(input.arguments);
    const executedActor = buildGovernanceActorProvenance(context);
    const idempotencyInput = {
      approvalId: input.approvalId,
      expectedApprovalRevision: input.expectedApprovalRevision,
      targetId: TARGET_ID,
      executorId: input.executorId,
      toolName: input.toolName,
      argumentsHash,
      actor: {
        type: executedActor.actorType,
        identityHash: executedActor.actorIdentityHash,
      },
    };
    const replay = this.governance.idempotency.replay<
      Omit<CapabilityRouterMutationExecuteResult, "replayed">
    >(EXECUTE_OPERATION, input.idempotencyKey, idempotencyInput);
    if (replay) return { ...replay.value, replayed: true };

    let approval = this.governance.externalActions.expireIfNeeded(
      input.approvalId,
      context.now,
    );
    this.assertExecutableApproval(approval, input, argumentsHash, context.now);

    let preflight: MutationPreflight;
    try {
      preflight = this.requireMutationPreflight(
        input.executorId,
        input.toolName,
        input.arguments,
      );
    } catch (error) {
      this.markStaleBestEffort(approval, context.now);
      throw error;
    }
    const currentPolicyHash = this.preflightPolicyHash(preflight);
    if (readPolicyHash(approval) !== currentPolicyHash) {
      this.markStaleBestEffort(approval, context.now);
      throw new ServiceError(
        "CAPABILITY_ROUTER_MUTATION_POLICY_CHANGED",
        "Capability Router provider policy or executor configuration changed after approval",
      );
    }

    const executed =
      await this.governance.idempotency.executePreparedExternalMutation<
        PreparedMutationExecution,
        CapabilityRouterResultProjection,
        Omit<CapabilityRouterMutationExecuteResult, "replayed">
      >(
        EXECUTE_OPERATION,
        input.idempotencyKey,
        idempotencyInput,
        () => {
          approval = this.governance.externalActions.expireIfNeeded(
            input.approvalId,
            context.now,
          );
          this.assertExecutableApproval(
            approval,
            input,
            argumentsHash,
            context.now,
          );
          if (readPolicyHash(approval) !== currentPolicyHash) {
            throw new ServiceError(
              "CAPABILITY_ROUTER_MUTATION_POLICY_CHANGED",
              "Capability Router provider policy changed before execution",
            );
          }
          const consumed = this.governance.externalActions.consume({
            id: approval.id,
            expectedRevision: approval.revision,
            now: context.now,
          });
          const execution = this.governance.externalActions.createExecution({
            approvalId: consumed.id,
            executedActor,
            now: context.now,
          });
          return {
            approval: consumed,
            execution,
            executor: preflight.executor,
          };
        },
        async (prepared) =>
          this.invokePreparedMutation(
            prepared,
            input.toolName,
            input.arguments,
            context.now,
          ),
        (prepared, result) => ({
          ok: true as const,
          approval: prepared.approval,
          execution: this.governance.externalActions.finishExecution({
            id: prepared.execution.id,
            status: "succeeded",
            now: context.now,
          }),
          result,
        }),
        undefined,
        context.now,
      );
    return { ...executed.value, replayed: executed.replayed };
  }

  private async invokePreparedMutation(
    prepared: PreparedMutationExecution,
    toolName: string,
    args: Record<string, unknown>,
    now: string,
  ): Promise<CapabilityRouterResultProjection> {
    let client: DownstreamMcpClient;
    try {
      client = this.clientFactory(prepared.executor);
    } catch (error) {
      this.finishExecutionBestEffort(
        prepared.execution.id,
        "failed-external",
        "CAPABILITY_ROUTER_PROVIDER_START_FAILED",
        now,
      );
      throw new ServiceError(
        "CAPABILITY_ROUTER_PROVIDER_START_FAILED",
        "Capability Router downstream provider could not be started",
        { cause: error },
      );
    }

    let rawResult: unknown;
    try {
      rawResult = await client.callTool(toolName, args);
    } catch (error) {
      this.finishExecutionBestEffort(
        prepared.execution.id,
        "failed-external",
        "CAPABILITY_ROUTER_PROVIDER_CALL_FAILED",
        now,
      );
      throw new ServiceError(
        "CAPABILITY_ROUTER_PROVIDER_CALL_FAILED",
        "Capability Router downstream provider mutation failed",
        { cause: error },
      );
    } finally {
      await client.close().catch(() => undefined);
    }

    let result: CapabilityRouterResultProjection;
    try {
      result = projectCapabilityRouterResult(rawResult);
    } catch (error) {
      this.finishExecutionBestEffort(
        prepared.execution.id,
        "failed-projection",
        "CAPABILITY_ROUTER_RESULT_PROJECTION_FAILED",
        now,
      );
      throw new ServiceError(
        "CAPABILITY_ROUTER_RESULT_PROJECTION_FAILED",
        "Capability Router provider result could not be projected safely",
        { cause: error },
      );
    }
    if (result.isError) {
      this.finishExecutionBestEffort(
        prepared.execution.id,
        "failed-external",
        "CAPABILITY_ROUTER_PROVIDER_TOOL_ERROR",
        now,
      );
      throw new ServiceError(
        "CAPABILITY_ROUTER_PROVIDER_TOOL_ERROR",
        "Capability Router downstream provider reported a mutation error",
      );
    }
    return result;
  }

  private requireMutationPreflight(
    executorId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): MutationPreflight {
    const before = this.requireMutationExecutor(executorId, toolName);
    const beforeHash = executorConfigHash(before);
    const inspection = this.requireMutationInspection(
      executorId,
      toolName,
      args,
    );
    const after = this.requireMutationExecutor(executorId, toolName);
    const afterHash = executorConfigHash(after);
    if (beforeHash !== afterHash) {
      throw new ServiceError(
        "CAPABILITY_ROUTER_EXPOSURE_CHANGED",
        "Capability Router executor configuration changed during validation",
      );
    }
    return {
      executor: after,
      executorConfigHash: afterHash,
      executorId: inspection.executorId,
      providerDisplayName: inspection.providerDisplayName,
      protocolFamily: inspection.protocolFamily,
      toolName: inspection.toolName,
      inputSchema: inspection.inputSchema,
      annotations: inspection.annotations,
    };
  }

  private requireMutationExecutor(
    executorId: string,
    toolName: string,
  ): DownstreamMcpExecutorConfig {
    try {
      const config = loadDownstreamMcpExecutorsConfig(this.configPath);
      const executor = config.executors.find(
        (candidate) => candidate.id === executorId,
      );
      const exposure = executor?.router?.tools.find(
        (tool) => tool.toolName === toolName,
      );
      if (
        !executor ||
        executor.router?.enabled !== true ||
        exposure?.mode !== "mutation"
      ) {
        throw new ServiceError(
          "CAPABILITY_ROUTER_EXPOSURE_CHANGED",
          "Capability Router mutation exposure is not currently enabled",
        );
      }
      return executor;
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        "CAPABILITY_ROUTER_EXPOSURE_CHANGED",
        "Capability Router mutation exposure could not be validated",
      );
    }
  }

  private requireMutationInspection(
    executorId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) {
    const inspection = this.catalog.inspect({ executorId, toolName });
    if (inspection.mode !== "mutation") {
      throw new ServiceError(
        "CAPABILITY_ROUTER_MUTATION_TOOL_REQUIRED",
        "Capability Router governed mutation requires an exposed mutation tool",
      );
    }
    if (inspection.status !== "ready" || !inspection.inputSchema) {
      throw new ServiceError(
        "CAPABILITY_ROUTER_TOOL_NOT_READY",
        "Capability Router mutation metadata is not ready for approval",
      );
    }
    assertMutationAnnotations(inspection.annotations);
    validateArguments(this.validator, inspection.inputSchema, args);
    return {
      ...inspection,
      inputSchema: inspection.inputSchema,
    };
  }

  private preflightPolicyHash(preflight: MutationPreflight): string {
    return policyHash({
      executorId: preflight.executorId,
      executorConfigHash: preflight.executorConfigHash,
      protocolFamily: preflight.protocolFamily,
      toolName: preflight.toolName,
      inputSchema: preflight.inputSchema,
      annotations: preflight.annotations,
    });
  }

  private assertExecutableApproval(
    approval: GovernedExternalActionApprovalRecord,
    input: CapabilityRouterMutationExecuteInput,
    argumentsHash: string,
    now: string,
  ): void {
    this.assertApprovalIdentity(approval, input);
    if (approval.revision !== input.expectedApprovalRevision) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        `Governed external action approval ${approval.id} no longer has revision ${input.expectedApprovalRevision}`,
      );
    }
    if (
      approval.decidedActor.actorType === null ||
      approval.decidedActor.actorType === "remote-mcp"
    ) {
      throw new ServiceError(
        "CAPABILITY_ROUTER_MUTATION_LOCAL_APPROVAL_REQUIRED",
        "Capability Router mutation requires a non-Remote-MCP operator decision",
      );
    }
    if (approval.argumentsHash !== argumentsHash) {
      this.markStaleBestEffort(approval, now);
      throw new ServiceError(
        "CAPABILITY_ROUTER_MUTATION_ARGUMENTS_CHANGED",
        "Capability Router mutation arguments changed after approval",
      );
    }
  }

  private assertApprovalIdentity(
    approval: GovernedExternalActionApprovalRecord,
    input: CapabilityRouterMutationExecuteInput,
  ): void {
    if (
      approval.targetId !== TARGET_ID ||
      approval.providerId !== input.executorId ||
      approval.toolName !== input.toolName
    ) {
      throw new ServiceError(
        "CAPABILITY_ROUTER_MUTATION_APPROVAL_MISMATCH",
        "Capability Router mutation approval does not match the requested target/provider/tool",
      );
    }
  }

  private finishExecutionBestEffort(
    executionId: string,
    status: "failed-external" | "failed-projection",
    errorCode: string,
    now: string,
  ): void {
    try {
      this.governance.externalActions.finishExecution({
        id: executionId,
        status,
        errorCode,
        now,
      });
    } catch {
      // The idempotency reservation remains pending after ambiguous provider
      // failure, so a failed status write must never cause an automatic replay.
    }
  }

  private markStaleBestEffort(
    approval: GovernedExternalActionApprovalRecord,
    now: string,
  ): void {
    if (!["pending", "approved"].includes(approval.status)) return;
    try {
      this.governance.externalActions.markStale({
        id: approval.id,
        expectedRevision: approval.revision,
        now,
      });
    } catch {
      // The caller still receives the primary drift error. A concurrent approval
      // transition must not be hidden by best-effort stale marking.
    }
  }
}

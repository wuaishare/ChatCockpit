import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/client";

import { ServiceError } from "./service-error.js";
import { CapabilityRouterCatalogService } from "./capability-router-catalog-service.js";
import {
  projectCapabilityRouterReadResult,
  type CapabilityRouterReadResultProjection
} from "./capability-router-result-projection.js";
import {
  loadDownstreamMcpExecutorsConfig,
  type DownstreamMcpExecutorConfig
} from "../direct/downstream-mcp-config.js";
import { createDownstreamMcpClient } from "../direct/downstream-mcp-client-factory.js";
import type { DownstreamMcpClient } from "../direct/downstream-mcp-types.js";

export interface CapabilityRouterReadInvocationRequest {
  executorId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface CapabilityRouterReadInvocationResult
  extends CapabilityRouterReadResultProjection {
  executorId: string;
  providerDisplayName: string;
  protocolFamily: "mcp-legacy-stdio" | "mcp-streamable-http";
  toolName: string;
}

export type CapabilityRouterClientFactory = (
  executor: DownstreamMcpExecutorConfig
) => DownstreamMcpClient;

function assertReadAnnotations(annotations: Record<string, unknown> | null): void {
  if (!annotations) return;
  if (annotations.destructiveHint === true || annotations.readOnlyHint === false) {
    throw new ServiceError(
      "CAPABILITY_ROUTER_TOOL_SAFETY_CONFLICT",
      "Capability Router read exposure conflicts with downstream tool safety annotations"
    );
  }
}

export class CapabilityRouterReadInvocationService {
  private readonly catalog: CapabilityRouterCatalogService;
  private readonly validator = new AjvJsonSchemaValidator();

  constructor(
    runtimeDir: string,
    private readonly configPath?: string,
    private readonly clientFactory: CapabilityRouterClientFactory =
      createDownstreamMcpClient
  ) {
    this.catalog = new CapabilityRouterCatalogService(runtimeDir, configPath);
  }

  async invoke(
    input: CapabilityRouterReadInvocationRequest
  ): Promise<CapabilityRouterReadInvocationResult> {
    const inspection = this.catalog.inspect({
      executorId: input.executorId,
      toolName: input.toolName
    });
    if (inspection.mode !== "read") {
      throw new ServiceError(
        "CAPABILITY_ROUTER_MUTATION_REQUIRES_APPROVAL",
        "Capability Router mutation tools require a governed approval lifecycle"
      );
    }
    if (inspection.status !== "ready" || !inspection.inputSchema) {
      throw new ServiceError(
        "CAPABILITY_ROUTER_TOOL_NOT_READY",
        "Capability Router tool metadata is not ready for invocation"
      );
    }
    assertReadAnnotations(inspection.annotations);

    let validate: ReturnType<AjvJsonSchemaValidator["getValidator"]>;
    try {
      validate = this.validator.getValidator(
        inspection.inputSchema as JsonSchemaType
      );
    } catch {
      throw new ServiceError(
        "CAPABILITY_ROUTER_SCHEMA_INVALID",
        "Capability Router tool input schema could not be compiled safely"
      );
    }
    const validated = validate(input.arguments);
    if (!validated.valid) {
      throw new ServiceError(
        "CAPABILITY_ROUTER_ARGUMENTS_INVALID",
        "Capability Router tool arguments do not match the inspected input schema"
      );
    }

    const config = loadDownstreamMcpExecutorsConfig(this.configPath);
    const executor = config.executors.find(
      (candidate) => candidate.id === input.executorId
    );
    const exposure = executor?.router?.tools.find(
      (tool) => tool.toolName === input.toolName
    );
    if (!executor || executor.router?.enabled !== true || exposure?.mode !== "read") {
      throw new ServiceError(
        "CAPABILITY_ROUTER_EXPOSURE_CHANGED",
        "Capability Router exposure changed before invocation"
      );
    }

    const client = this.clientFactory(executor);
    let rawResult: unknown;
    try {
      rawResult = await client.callTool(input.toolName, input.arguments);
    } catch (error) {
      throw new ServiceError(
        "CAPABILITY_ROUTER_PROVIDER_CALL_FAILED",
        "Capability Router downstream provider call failed",
        { cause: error }
      );
    } finally {
      await client.close().catch(() => undefined);
    }

    return {
      executorId: inspection.executorId,
      providerDisplayName: inspection.providerDisplayName,
      protocolFamily: inspection.protocolFamily,
      toolName: inspection.toolName,
      ...projectCapabilityRouterReadResult(rawResult)
    };
  }
}

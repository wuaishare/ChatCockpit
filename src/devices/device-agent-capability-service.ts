import { z } from "zod";

import { CapabilityRouterCatalogService } from "../application/capability-router-catalog-service.js";
import { CapabilityRouterReadInvocationService } from "../application/capability-router-read-invocation-service.js";
import { ServiceError } from "../application/service-error.js";
import {
  capabilityRouterInspectSchema,
  capabilityRouterListSchema,
  capabilityRouterReadInvokeSchema
} from "../contracts/capability-router.js";
import {
  DEVICE_CAPABILITY_RESULT_MAX_BYTES,
  type DeviceCapabilityRequestEnvelope,
  type DeviceCapabilityResultBody
} from "./device-capability-rpc.js";

const SAFE_SERVICE_ERROR_CODES = new Set([
  "CAPABILITY_ROUTER_PROVIDER_NOT_FOUND",
  "CAPABILITY_ROUTER_TOOL_NOT_FOUND",
  "CAPABILITY_ROUTER_TOOL_NOT_READY",
  "CAPABILITY_ROUTER_TOOL_SAFETY_CONFLICT",
  "CAPABILITY_ROUTER_SCHEMA_INVALID",
  "CAPABILITY_ROUTER_ARGUMENTS_INVALID",
  "CAPABILITY_ROUTER_EXPOSURE_CHANGED",
  "CAPABILITY_ROUTER_PROVIDER_ATTESTATION_FAILED",
  "CAPABILITY_ROUTER_PROVIDER_METADATA_CHANGED",
  "CAPABILITY_ROUTER_PROVIDER_CALL_FAILED",
  "CAPABILITY_ROUTER_PROVIDER_TOOL_ERROR"
]);

export interface DeviceAgentCapabilityServiceOptions {
  runtimeDir: string;
  configPath?: string;
  catalog?: CapabilityRouterCatalogService;
  reads?: CapabilityRouterReadInvocationService;
  now?: () => string;
}

function errorBody(
  requestId: string,
  code: string,
  message: string
): DeviceCapabilityResultBody {
  return {
    requestId,
    outcome: "error",
    error: { code, message }
  };
}

function boundedSuccess(
  requestId: string,
  result: unknown
): DeviceCapabilityResultBody {
  const body: DeviceCapabilityResultBody = {
    requestId,
    outcome: "ok",
    result
  };
  try {
    if (Buffer.byteLength(JSON.stringify(body), "utf8") <= DEVICE_CAPABILITY_RESULT_MAX_BYTES) {
      return body;
    }
  } catch {
    // Fall through to a bounded product-owned error.
  }
  return errorBody(
    requestId,
    "DEVICE_CAPABILITY_RESULT_TOO_LARGE",
    "Device capability result exceeded the allowed size"
  );
}

function projectReadOnlyCatalog(
  catalog: ReturnType<CapabilityRouterCatalogService["list"]>
): ReturnType<CapabilityRouterCatalogService["list"]> {
  return {
    ...catalog,
    providers: catalog.providers
      .map((provider) => ({
        ...provider,
        tools: provider.tools.filter((tool) => tool.mode === "read")
      }))
      .filter((provider) => provider.tools.length > 0)
  };
}

export class DeviceAgentCapabilityService {
  private readonly catalog: CapabilityRouterCatalogService;
  private readonly reads: CapabilityRouterReadInvocationService;
  private readonly now: () => string;

  constructor(options: DeviceAgentCapabilityServiceOptions) {
    this.catalog =
      options.catalog ??
      new CapabilityRouterCatalogService(options.runtimeDir, options.configPath);
    this.reads =
      options.reads ??
      new CapabilityRouterReadInvocationService(
        options.runtimeDir,
        options.configPath
      );
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async execute(
    request: DeviceCapabilityRequestEnvelope
  ): Promise<DeviceCapabilityResultBody> {
    const issuedAtMs = Date.parse(request.issuedAt);
    const expiresAtMs = Date.parse(request.expiresAt);
    const nowMs = Date.parse(this.now());
    if (
      request.protocolVersion !== 1 ||
      !Number.isFinite(issuedAtMs) ||
      !Number.isFinite(expiresAtMs) ||
      issuedAtMs > expiresAtMs
    ) {
      return errorBody(
        request.requestId,
        "DEVICE_CAPABILITY_REQUEST_INVALID",
        "Device capability request envelope is invalid"
      );
    }
    if (expiresAtMs <= nowMs) {
      return errorBody(
        request.requestId,
        "DEVICE_CAPABILITY_REQUEST_EXPIRED",
        "Device capability request expired before execution"
      );
    }

    if (
      request.payload &&
      typeof request.payload === "object" &&
      !Array.isArray(request.payload) &&
      "targetDevice" in request.payload
    ) {
      return errorBody(
        request.requestId,
        "DEVICE_CAPABILITY_ARGUMENTS_INVALID",
        "Device capability request arguments are invalid"
      );
    }

    try {
      switch (request.operation) {
        case "capabilities.list": {
          const input = capabilityRouterListSchema.parse(request.payload);
          return boundedSuccess(
            request.requestId,
            projectReadOnlyCatalog(this.catalog.list(input))
          );
        }
        case "capabilities.inspect": {
          const input = capabilityRouterInspectSchema.parse(request.payload);
          const inspection = this.catalog.inspect(input);
          if (inspection.mode !== "read") {
            return errorBody(
              request.requestId,
              "DEVICE_CAPABILITY_MUTATION_UNAVAILABLE",
              "Remote device capability mutations are unavailable"
            );
          }
          return boundedSuccess(request.requestId, inspection);
        }
        case "capabilities.read.invoke": {
          const input = capabilityRouterReadInvokeSchema.parse(request.payload);
          try {
            return boundedSuccess(
              request.requestId,
              await this.reads.invoke(input)
            );
          } catch (error) {
            if (
              error instanceof ServiceError &&
              error.code === "CAPABILITY_ROUTER_MUTATION_REQUIRES_APPROVAL"
            ) {
              return errorBody(
                request.requestId,
                "DEVICE_CAPABILITY_MUTATION_UNAVAILABLE",
                "Remote device capability mutations are unavailable"
              );
            }
            throw error;
          }
        }
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return errorBody(
          request.requestId,
          "DEVICE_CAPABILITY_ARGUMENTS_INVALID",
          "Device capability request arguments are invalid"
        );
      }
      if (
        error instanceof ServiceError &&
        SAFE_SERVICE_ERROR_CODES.has(error.code)
      ) {
        return errorBody(request.requestId, error.code, error.message);
      }
      return errorBody(
        request.requestId,
        "DEVICE_CAPABILITY_EXECUTION_FAILED",
        "Device capability request could not be completed"
      );
    }
  }
}

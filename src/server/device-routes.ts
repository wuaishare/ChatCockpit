import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  DEVICE_ENROLLMENT_POLL_AFTER_SECONDS,
  DeviceRegistryError,
  type DeviceEnrollmentDecision,
  type DeviceEnrollmentProjection,
  type DeviceRegistryStore,
  type ManagedDeviceRecord
} from "../devices/device-registry.js";
import { buildLocalDeviceTarget } from "../devices/local-device.js";
import { sendApiError } from "./errors.js";

function operatorSessionError(
  request: FastifyRequest,
  reply: FastifyReply
): ReturnType<typeof sendApiError> | null {
  if (request.chatCockpitAuth.kind === "operator-session") return null;
  return sendApiError(
    reply,
    401,
    "OPERATOR_SESSION_REQUIRED",
    "An authenticated console administrator session is required"
  );
}

function deviceError(
  reply: FastifyReply,
  error: unknown
): ReturnType<typeof sendApiError> {
  if (error instanceof DeviceRegistryError) {
    return sendApiError(reply, error.statusCode, error.code, error.message);
  }
  throw error;
}

function requiredString(
  value: unknown,
  code: string,
  message: string,
  maxLength: number
): string {
  if (typeof value !== "string") {
    throw new DeviceRegistryError(400, code, message);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new DeviceRegistryError(400, code, message);
  }
  return normalized;
}

function requiredEnrollmentId(value: unknown): string {
  const id = requiredString(
    value,
    "DEVICE_ENROLLMENT_ID_INVALID",
    "Device enrollment request ID is invalid",
    180
  );
  if (!/^cc_enroll_[A-Za-z0-9_-]{20,80}$/.test(id)) {
    throw new DeviceRegistryError(
      400,
      "DEVICE_ENROLLMENT_ID_INVALID",
      "Device enrollment request ID is invalid"
    );
  }
  return id;
}

function projectLocalDevice(now: string) {
  const target = buildLocalDeviceTarget();
  return {
    id: target.id,
    kind: "device" as const,
    locality: "local" as const,
    displayName: "This device",
    platform: target.platform,
    architecture: target.architecture,
    publicKeyFingerprint: null,
    pairedAt: null,
    lastSeenAt: now,
    revokedAt: null,
    revision: 1,
    trust: "local" as const,
    presence: "online" as const,
    management: {
      heartbeat: false as const,
      remoteControl: false as const
    }
  };
}

function projectEnrollmentForDevice(enrollment: DeviceEnrollmentProjection) {
  return {
    id: enrollment.id,
    status: enrollment.status,
    verificationCode:
      enrollment.status === "pending" || enrollment.status === "expired"
        ? enrollment.verificationCode
        : undefined,
    expiresAt: enrollment.expiresAt,
    decidedAt: enrollment.decidedAt,
    deviceId: enrollment.deviceId,
    pollAfterSeconds: DEVICE_ENROLLMENT_POLL_AFTER_SECONDS
  };
}

function projectManagedDevice(record: ManagedDeviceRecord) {
  return {
    id: record.id,
    displayName: record.displayName,
    platform: record.platform,
    architecture: record.architecture,
    publicKeyFingerprint: record.publicKeyFingerprint,
    pairedAt: record.pairedAt,
    lastSeenAt: record.lastSeenAt,
    revokedAt: record.revokedAt,
    revision: record.revision
  };
}

export function registerDeviceRoutes(
  app: FastifyInstance,
  store: DeviceRegistryStore,
  options: { now?: () => string } = {}
): void {
  const now = options.now ?? (() => new Date().toISOString());

  app.get("/api/devices", async (request, reply) => {
    const authError = operatorSessionError(request, reply);
    if (authError) return authError;
    const timestamp = now();
    return {
      ok: true,
      devices: [projectLocalDevice(timestamp), ...store.listDevices(timestamp)]
    };
  });

  app.get("/api/devices/enrollment-requests", async (request, reply) => {
    const authError = operatorSessionError(request, reply);
    if (authError) return authError;
    return {
      ok: true,
      enrollmentRequests: store.listPendingEnrollmentRequests(now())
    };
  });

  app.post("/api/devices/enrollment-requests", async (request, reply) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = store.createEnrollmentRequest(
        {
          displayName: requiredString(
            body.displayName,
            "DEVICE_DISPLAY_NAME_INVALID",
            "Device display name is invalid",
            80
          ),
          platform: requiredString(
            body.platform,
            "DEVICE_METADATA_INVALID",
            "Device platform is invalid",
            40
          ),
          architecture: requiredString(
            body.architecture,
            "DEVICE_METADATA_INVALID",
            "Device architecture is invalid",
            40
          ),
          publicKey: requiredString(
            body.publicKey,
            "DEVICE_PUBLIC_KEY_INVALID",
            "Device public key is invalid",
            512
          ),
          requestNonce: requiredString(
            body.requestNonce,
            "DEVICE_ENROLLMENT_NONCE_INVALID",
            "Device enrollment nonce is invalid",
            160
          ),
          signature: requiredString(
            body.signature,
            "DEVICE_SIGNATURE_INVALID",
            "Device enrollment signature is invalid",
            256
          )
        },
        now()
      );
      reply.code(result.created ? 201 : 200);
      return {
        ok: true,
        enrollment: {
          id: result.enrollment.id,
          displayName: result.enrollment.displayName,
          verificationCode: result.enrollment.verificationCode,
          expiresAt: result.enrollment.expiresAt,
          pollAfterSeconds: DEVICE_ENROLLMENT_POLL_AFTER_SECONDS
        }
      };
    } catch (error) {
      return deviceError(reply, error);
    }
  });

  app.post("/api/devices/enrollment-requests/:enrollmentId/status", async (request, reply) => {
    try {
      const params = request.params as { enrollmentId?: unknown };
      const body = (request.body ?? {}) as Record<string, unknown>;
      const enrollment = store.verifyEnrollmentStatus(
        {
          enrollmentId: requiredEnrollmentId(params.enrollmentId),
          signature: requiredString(
            body.signature,
            "DEVICE_SIGNATURE_INVALID",
            "Device enrollment status signature is invalid",
            256
          )
        },
        now()
      );
      return {
        ok: true,
        enrollment: projectEnrollmentForDevice(enrollment)
      };
    } catch (error) {
      return deviceError(reply, error);
    }
  });

  app.post("/api/devices/enrollment-requests/:enrollmentId/decision", async (request, reply) => {
    const authError = operatorSessionError(request, reply);
    if (authError) return authError;
    try {
      const params = request.params as { enrollmentId?: unknown };
      const body = (request.body ?? {}) as Record<string, unknown>;
      const decision = body.decision;
      if (decision !== "approve" && decision !== "deny") {
        throw new DeviceRegistryError(
          400,
          "DEVICE_ENROLLMENT_DECISION_INVALID",
          "Device enrollment decision must be approve or deny"
        );
      }
      const result = store.decideEnrollmentRequest(
        requiredEnrollmentId(params.enrollmentId),
        decision as DeviceEnrollmentDecision,
        now()
      );
      return {
        ok: true,
        enrollment: result.enrollment,
        device: result.device ? projectManagedDevice(result.device) : null
      };
    } catch (error) {
      return deviceError(reply, error);
    }
  });

  app.post("/api/devices/heartbeat", async (request, reply) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const deviceId = requiredString(
        body.deviceId,
        "DEVICE_NOT_TRUSTED",
        "Device ID is invalid",
        180
      );
      if (!/^cc_device_[A-Za-z0-9_-]{20,80}$/.test(deviceId)) {
        throw new DeviceRegistryError(400, "DEVICE_NOT_TRUSTED", "Device ID is invalid");
      }
      if (typeof body.sequence !== "number") {
        throw new DeviceRegistryError(
          400,
          "DEVICE_SEQUENCE_INVALID",
          "Device heartbeat sequence must be a positive integer"
        );
      }
      const device = store.recordHeartbeat(
        {
          deviceId,
          sequence: body.sequence,
          signature: requiredString(
            body.signature,
            "DEVICE_SIGNATURE_INVALID",
            "Device heartbeat signature is invalid",
            256
          )
        },
        now()
      );
      return {
        ok: true,
        deviceId: device.id,
        acceptedSequence: device.lastSequence,
        revision: device.revision
      };
    } catch (error) {
      return deviceError(reply, error);
    }
  });

  app.delete("/api/devices/:deviceId", async (request, reply) => {
    const authError = operatorSessionError(request, reply);
    if (authError) return authError;
    const rawDeviceId = (request.params as { deviceId?: unknown }).deviceId;
    if (typeof rawDeviceId !== "string" || !/^cc_device_[A-Za-z0-9_-]{20,80}$/.test(rawDeviceId)) {
      return sendApiError(reply, 400, "DEVICE_ID_INVALID", "Managed device ID is invalid");
    }
    const device = store.revokeDevice(rawDeviceId, now());
    if (!device) {
      return sendApiError(reply, 404, "DEVICE_NOT_FOUND", "Managed device was not found");
    }
    return {
      ok: true,
      deviceId: device.id,
      revokedAt: device.revokedAt,
      revision: device.revision
    };
  });
}

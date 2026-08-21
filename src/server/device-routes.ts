import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  DeviceRegistryError,
  type DeviceRegistryStore
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

  app.post("/api/devices/pairings", async (request, reply) => {
    const authError = operatorSessionError(request, reply);
    if (authError) return authError;
    try {
      const body = (request.body ?? {}) as { displayName?: unknown };
      const displayName = requiredString(
        body.displayName,
        "DEVICE_DISPLAY_NAME_INVALID",
        "Device display name must contain 1 to 80 characters",
        80
      );
      return {
        ok: true,
        pairing: store.createPairing(displayName, now())
      };
    } catch (error) {
      return deviceError(reply, error);
    }
  });

  app.post("/api/devices/pairings/claim", async (request, reply) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const device = store.claimPairing(
        {
          pairingId: requiredString(
            body.pairingId,
            "DEVICE_PAIRING_INVALID",
            "Device pairing ID is invalid",
            180
          ),
          code: requiredString(
            body.code,
            "DEVICE_PAIRING_INVALID",
            "Device pairing code is invalid",
            180
          ),
          publicKey: requiredString(
            body.publicKey,
            "DEVICE_PUBLIC_KEY_INVALID",
            "Device public key is invalid",
            512
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
          signature: requiredString(
            body.signature,
            "DEVICE_SIGNATURE_INVALID",
            "Device pairing signature is invalid",
            256
          )
        },
        now()
      );
      reply.code(201);
      return {
        ok: true,
        device: {
          id: device.id,
          displayName: device.displayName,
          pairedAt: device.pairedAt,
          publicKeyFingerprint: device.publicKeyFingerprint
        }
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
      const signature = requiredString(
        body.signature,
        "DEVICE_SIGNATURE_INVALID",
        "Device heartbeat signature is invalid",
        256
      );
      if (typeof body.sequence !== "number") {
        throw new DeviceRegistryError(
          400,
          "DEVICE_SEQUENCE_INVALID",
          "Device heartbeat sequence must be a positive integer"
        );
      }
      const device = store.recordHeartbeat(
        { deviceId, sequence: body.sequence, signature },
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
    const deviceId = (request.params as { deviceId?: unknown }).deviceId;
    if (typeof deviceId !== "string" || !/^cc_device_[A-Za-z0-9_-]{20,80}$/.test(deviceId)) {
      return sendApiError(reply, 400, "DEVICE_ID_INVALID", "Managed device ID is invalid");
    }
    const device = store.revokeDevice(deviceId, now());
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

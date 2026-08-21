import type { FastifyInstance } from "fastify";

import {
  projectHubIdentity,
  signHubIdentityProof,
  type HubIdentityRecord
} from "../devices/hub-identity.js";
import { sendApiError } from "./errors.js";

function requiredNonce(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Hub identity proof nonce is invalid");
  }
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(normalized)) {
    throw new Error("Hub identity proof nonce is invalid");
  }
  return normalized;
}

export function registerHubIdentityRoutes(
  app: FastifyInstance,
  identity: HubIdentityRecord
): void {
  const projection = projectHubIdentity(identity);

  app.get("/api/hub/identity", async () => ({
    ok: true,
    hub: {
      schemaVersion: projection.schemaVersion,
      hubId: projection.hubId,
      algorithm: projection.algorithm,
      publicKey: projection.publicKeySpki,
      publicKeyFingerprint: projection.publicKeyFingerprint,
      createdAt: projection.createdAt
    }
  }));

  app.post("/api/hub/identity/proof", async (request, reply) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const nonce = requiredNonce(body.nonce);
      return {
        ok: true,
        hubId: projection.hubId,
        nonce,
        signature: signHubIdentityProof(identity, nonce)
      };
    } catch {
      return sendApiError(
        reply,
        400,
        "HUB_IDENTITY_NONCE_INVALID",
        "Hub identity proof nonce is invalid"
      );
    }
  });
}

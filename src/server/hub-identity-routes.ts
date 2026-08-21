import type { FastifyInstance } from "fastify";

import {
  projectHubIdentity,
  signHubIdentityProof,
  type HubIdentityRecord
} from "../devices/hub-identity.js";
import {
  projectLanTlsIdentity,
  signLanTlsCertificateProof,
  type LanTlsIdentityRecord
} from "../devices/lan-tls-identity.js";
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
  identity: HubIdentityRecord,
  options: {
    getLanTlsIdentity?: (() => Promise<LanTlsIdentityRecord>) | null;
  } = {}
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

  app.get("/api/hub/lan-tls", async (_request, reply) => {
    if (!options.getLanTlsIdentity) {
      return sendApiError(
        reply,
        404,
        "LAN_TLS_UNAVAILABLE",
        "LAN TLS identity is not enabled"
      );
    }
    try {
      const tlsIdentity = await options.getLanTlsIdentity();
      const tlsProjection = projectLanTlsIdentity(tlsIdentity);
      return {
        ok: true,
        hubId: projection.hubId,
        tls: {
          schemaVersion: tlsProjection.schemaVersion,
          algorithm: tlsProjection.algorithm,
          certificate: tlsIdentity.certificatePem,
          certificateFingerprint: tlsProjection.certificateFingerprint,
          createdAt: tlsProjection.createdAt,
          notAfter: tlsProjection.notAfter
        }
      };
    } catch {
      return sendApiError(
        reply,
        503,
        "LAN_TLS_UNAVAILABLE",
        "LAN TLS identity is unavailable"
      );
    }
  });

  app.post("/api/hub/lan-tls/proof", async (request, reply) => {
    if (!options.getLanTlsIdentity) {
      return sendApiError(
        reply,
        404,
        "LAN_TLS_UNAVAILABLE",
        "LAN TLS identity is not enabled"
      );
    }
    let nonce: string;
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      nonce = requiredNonce(body.nonce);
    } catch {
      return sendApiError(
        reply,
        400,
        "HUB_IDENTITY_NONCE_INVALID",
        "Hub identity proof nonce is invalid"
      );
    }
    try {
      const tlsIdentity = await options.getLanTlsIdentity();
      return {
        ok: true,
        hubId: projection.hubId,
        nonce,
        certificateFingerprint: tlsIdentity.certificateFingerprint,
        signature: signLanTlsCertificateProof(
          identity,
          nonce,
          tlsIdentity.certificateFingerprint
        )
      };
    } catch {
      return sendApiError(
        reply,
        503,
        "LAN_TLS_UNAVAILABLE",
        "LAN TLS identity is unavailable"
      );
    }
  });
}

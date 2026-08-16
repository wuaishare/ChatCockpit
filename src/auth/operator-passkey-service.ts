import { randomUUID } from "node:crypto";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type WebAuthnCredential
} from "@simplewebauthn/server";

import {
  OperatorStore,
  type OperatorPasskeyRecord
} from "./operator-store.js";
import { OperatorAuthError } from "./operator-service.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LABEL = "Passkey";

export interface OperatorPasskeyContext {
  rpId: string;
  origin: string;
}

export interface OperatorPasskeyProjection {
  id: string;
  label: string;
  rpId: string;
  origin: string;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export interface OperatorPasskeyAdapter {
  generateRegistrationOptions(input: Parameters<typeof generateRegistrationOptions>[0]): Promise<PublicKeyCredentialCreationOptionsJSON>;
  verifyRegistrationResponse(input: Parameters<typeof verifyRegistrationResponse>[0]): Promise<VerifiedRegistrationResponse>;
  generateAuthenticationOptions(input: Parameters<typeof generateAuthenticationOptions>[0]): Promise<PublicKeyCredentialRequestOptionsJSON>;
  verifyAuthenticationResponse(input: Parameters<typeof verifyAuthenticationResponse>[0]): Promise<VerifiedAuthenticationResponse>;
}

const defaultAdapter: OperatorPasskeyAdapter = {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
};

export interface OperatorPasskeyServiceOptions {
  store: OperatorStore;
  adapter?: OperatorPasskeyAdapter;
  now?: () => Date;
}

function toIso(value: number): string {
  return new Date(value).toISOString();
}

function normalizeLabel(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return DEFAULT_LABEL;
  return Array.from(trimmed).slice(0, 64).join("");
}

function project(record: OperatorPasskeyRecord): OperatorPasskeyProjection {
  return {
    id: record.id,
    label: record.label,
    rpId: record.rpId,
    origin: record.origin,
    deviceType: record.deviceType,
    backedUp: record.backedUp,
    transports: record.transports,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt
  };
}

export class OperatorPasskeyService {
  private readonly store: OperatorStore;
  private readonly adapter: OperatorPasskeyAdapter;
  private readonly now: () => Date;

  constructor(options: OperatorPasskeyServiceOptions) {
    this.store = options.store;
    this.adapter = options.adapter ?? defaultAdapter;
    this.now = options.now ?? (() => new Date());
  }

  list(context?: OperatorPasskeyContext): OperatorPasskeyProjection[] {
    const owner = this.requireOwner();
    return this.store
      .listPasskeys(owner.id, context?.rpId)
      .filter((record) => !context || record.origin === context.origin)
      .map(project);
  }

  hasPasskey(context: OperatorPasskeyContext): boolean {
    return this.list(context).length > 0;
  }

  async createRegistrationOptions(
    context: OperatorPasskeyContext
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const owner = this.requireOwner();
    const existing = this.store.listPasskeys(owner.id, context.rpId);
    const options = await this.adapter.generateRegistrationOptions({
      rpName: "ChatCockpit",
      rpID: context.rpId,
      userName: owner.username,
      userDisplayName: owner.username,
      userID: new TextEncoder().encode(owner.id),
      attestationType: "none",
      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as never
      })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required"
      }
    });
    this.persistChallenge(owner.id, "registration", options.challenge, context);
    return options;
  }

  async verifyRegistration(input: {
    context: OperatorPasskeyContext;
    challenge: string;
    response: RegistrationResponseJSON;
    label?: string;
  }): Promise<OperatorPasskeyProjection> {
    const owner = this.requireOwner();
    const challenge = this.consumeChallenge(
      owner.id,
      "registration",
      input.challenge,
      input.context
    );
    const result = await this.adapter.verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rpId,
      requireUserVerification: true
    });
    if (!result.verified || !result.registrationInfo) {
      throw new OperatorAuthError(
        "PASSKEY_REGISTRATION_FAILED",
        "Passkey registration could not be verified",
        400
      );
    }

    const credential = result.registrationInfo.credential;
    if (this.store.getPasskeyByCredentialId(credential.id)) {
      throw new OperatorAuthError(
        "PASSKEY_ALREADY_REGISTERED",
        "This Passkey is already registered",
        409
      );
    }
    const nowIso = this.now().toISOString();
    const record = this.store.createPasskey({
      id: randomUUID(),
      principalId: owner.id,
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: [...(credential.transports ?? [])],
      deviceType: result.registrationInfo.credentialDeviceType,
      backedUp: result.registrationInfo.credentialBackedUp,
      label: normalizeLabel(input.label),
      rpId: challenge.rpId,
      origin: challenge.origin,
      createdAt: nowIso
    });
    this.store.recordAuditEvent({
      eventType: "operator.passkey.registered",
      principalId: owner.id,
      createdAt: nowIso,
      details: {
        passkeyId: record.id,
        rpId: record.rpId,
        deviceType: record.deviceType,
        backedUp: record.backedUp
      }
    });
    return project(record);
  }

  async createAuthenticationOptions(
    context: OperatorPasskeyContext
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const owner = this.requireOwner();
    const credentials = this.store
      .listPasskeys(owner.id, context.rpId)
      .filter((credential) => credential.origin === context.origin);
    if (credentials.length === 0) {
      throw new OperatorAuthError(
        "PASSKEY_NOT_CONFIGURED",
        "No Passkey is configured for this Web origin",
        404
      );
    }
    const options = await this.adapter.generateAuthenticationOptions({
      rpID: context.rpId,
      userVerification: "required"
    });
    this.persistChallenge(owner.id, "authentication", options.challenge, context);
    return options;
  }

  async verifyAuthentication(input: {
    context: OperatorPasskeyContext;
    challenge: string;
    response: AuthenticationResponseJSON;
  }): Promise<{ principalId: string; passkey: OperatorPasskeyProjection }> {
    const owner = this.requireOwner();
    const challenge = this.consumeChallenge(
      owner.id,
      "authentication",
      input.challenge,
      input.context
    );
    const passkey = this.store.getPasskeyByCredentialId(input.response.id);
    if (
      !passkey ||
      passkey.principalId !== owner.id ||
      passkey.rpId !== challenge.rpId ||
      passkey.origin !== challenge.origin
    ) {
      throw new OperatorAuthError(
        "PASSKEY_CREDENTIAL_UNKNOWN",
        "Passkey credential is not registered for this Web origin",
        401
      );
    }

    const credential: WebAuthnCredential = {
      id: passkey.credentialId,
      publicKey: Uint8Array.from(passkey.publicKey),
      counter: passkey.counter,
      transports: passkey.transports as never
    };
    const result = await this.adapter.verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rpId,
      credential,
      requireUserVerification: true
    });
    if (!result.verified || !result.authenticationInfo.userVerified) {
      throw new OperatorAuthError(
        "PASSKEY_AUTHENTICATION_FAILED",
        "Passkey authentication could not be verified",
        401
      );
    }

    const nowIso = this.now().toISOString();
    const updated = this.store.updatePasskeyUsage({
      id: passkey.id,
      counter: result.authenticationInfo.newCounter,
      backedUp: result.authenticationInfo.credentialBackedUp,
      lastUsedAt: nowIso
    });
    this.store.recordAuditEvent({
      eventType: "operator.passkey.authenticated",
      principalId: owner.id,
      createdAt: nowIso,
      details: {
        passkeyId: updated.id,
        rpId: updated.rpId,
        deviceType: result.authenticationInfo.credentialDeviceType,
        backedUp: result.authenticationInfo.credentialBackedUp
      }
    });
    return { principalId: owner.id, passkey: project(updated) };
  }

  delete(passkeyId: string, context: OperatorPasskeyContext): boolean {
    const owner = this.requireOwner();
    const existing = this.store
      .listPasskeys(owner.id, context.rpId)
      .find(
        (credential) =>
          credential.id === passkeyId && credential.origin === context.origin
      );
    if (!existing) return false;
    const deleted = this.store.deletePasskey(passkeyId, owner.id);
    if (deleted) {
      this.store.recordAuditEvent({
        eventType: "operator.passkey.removed",
        principalId: owner.id,
        createdAt: this.now().toISOString(),
        details: { passkeyId }
      });
    }
    return deleted;
  }

  private requireOwner() {
    const owner = this.store.getOwner();
    if (!owner) {
      throw new OperatorAuthError(
        "OPERATOR_SETUP_REQUIRED",
        "Web Operator account has not been configured",
        503
      );
    }
    return owner;
  }

  private persistChallenge(
    principalId: string,
    kind: "registration" | "authentication",
    challenge: string,
    context: OperatorPasskeyContext
  ): void {
    const now = this.now();
    this.store.createWebAuthnChallenge({
      id: randomUUID(),
      principalId,
      kind,
      challenge,
      rpId: context.rpId,
      origin: context.origin,
      createdAt: now.toISOString(),
      expiresAt: toIso(now.getTime() + CHALLENGE_TTL_MS)
    });
  }

  private consumeChallenge(
    principalId: string,
    kind: "registration" | "authentication",
    challenge: string,
    context: OperatorPasskeyContext
  ) {
    const record = this.store.consumeWebAuthnChallenge({
      challenge,
      kind,
      consumedAt: this.now().toISOString()
    });
    if (
      !record ||
      record.principalId !== principalId ||
      record.rpId !== context.rpId ||
      record.origin !== context.origin
    ) {
      throw new OperatorAuthError(
        "PASSKEY_CHALLENGE_INVALID",
        "Passkey challenge is invalid or expired",
        401
      );
    }
    return record;
  }
}

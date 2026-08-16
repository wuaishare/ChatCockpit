import assert from "node:assert/strict";

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse
} from "@simplewebauthn/server";

import { hashOperatorPassword } from "../src/auth/operator-password.js";
import {
  OperatorPasskeyService,
  type OperatorPasskeyAdapter
} from "../src/auth/operator-passkey-service.js";
import { OperatorStore } from "../src/auth/operator-store.js";
import { OperatorAuthError, OperatorService } from "../src/auth/operator-service.js";

interface CapturedRegistrationInput {
  rpName: string;
  rpID: string;
  userName: string;
  attestationType?: string;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  excludeCredentials?: Array<{ id: string }>;
}

interface CapturedAuthenticationInput {
  rpID: string;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: unknown;
}

async function main(): Promise<void> {
  const store = new OperatorStore({ path: ":memory:" });
  const passwordHash = await hashOperatorPassword(
    "passkey-test-correct-horse-battery-staple"
  );
  const owner = store.setOwner(
    { username: "owner", passwordHash },
    "2026-08-16T10:30:00.000Z"
  ).principal;

  let nowMs = Date.parse("2026-08-16T10:30:00.000Z");
  let registrationInput: CapturedRegistrationInput | null = null;
  let authenticationInput: CapturedAuthenticationInput | null = null;
  let expectedRegistrationChallenge: string | undefined;
  let expectedAuthenticationChallenge: string | undefined;

  const adapter: OperatorPasskeyAdapter = {
    async generateRegistrationOptions(input) {
      registrationInput = input as CapturedRegistrationInput;
      return {
        challenge: "registration-challenge",
        rp: { id: input.rpID, name: input.rpName },
        user: {
          id: "dXNlci1pZA",
          name: input.userName,
          displayName: input.userDisplayName ?? input.userName
        },
        pubKeyCredParams: [{ alg: -7, type: "public-key" }],
        timeout: 60_000,
        attestation: "none",
        excludeCredentials: [],
        authenticatorSelection: input.authenticatorSelection
      } as PublicKeyCredentialCreationOptionsJSON;
    },
    async verifyRegistrationResponse(input) {
      expectedRegistrationChallenge = String(input.expectedChallenge);
      return {
        verified: true,
        registrationInfo: {
          fmt: "none",
          aaguid: "00000000-0000-0000-0000-000000000000",
          credential: {
            id: "credential-one",
            publicKey: Uint8Array.from([1, 3, 3, 7]),
            counter: 0,
            transports: ["internal", "hybrid"]
          },
          credentialType: "public-key",
          attestationObject: Uint8Array.from([]),
          userVerified: true,
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
          origin: "https://chatcockpit.example.com",
          rpID: "chatcockpit.example.com",
          authenticatorExtensionResults: {}
        }
      } as VerifiedRegistrationResponse;
    },
    async generateAuthenticationOptions(input) {
      authenticationInput = input as CapturedAuthenticationInput;
      return {
        challenge: "authentication-challenge",
        rpId: input.rpID,
        timeout: 60_000,
        userVerification: input.userVerification
      } as PublicKeyCredentialRequestOptionsJSON;
    },
    async verifyAuthenticationResponse(input) {
      expectedAuthenticationChallenge = String(input.expectedChallenge);
      assert.equal(input.credential.id, "credential-one");
      assert.deepEqual(Array.from(input.credential.publicKey), [1, 3, 3, 7]);
      assert.equal(input.credential.counter, 0);
      return {
        verified: true,
        authenticationInfo: {
          credentialID: "credential-one",
          newCounter: 9,
          userVerified: true,
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
          origin: "https://chatcockpit.example.com",
          rpID: "chatcockpit.example.com",
          authenticatorExtensionResults: {}
        }
      } as VerifiedAuthenticationResponse;
    }
  };

  const passkeys = new OperatorPasskeyService({
    store,
    adapter,
    now: () => new Date(nowMs)
  });
  const context = {
    rpId: "chatcockpit.example.com",
    origin: "https://chatcockpit.example.com"
  };

  const registrationOptions = await passkeys.createRegistrationOptions(context);
  assert.equal(registrationOptions.challenge, "registration-challenge");
  assert.equal(registrationInput?.rpName, "ChatCockpit");
  assert.equal(registrationInput?.rpID, context.rpId);
  assert.equal(registrationInput?.userName, "owner");
  assert.equal(registrationInput?.attestationType, "none");
  assert.equal(registrationInput?.authenticatorSelection?.residentKey, "required");
  assert.equal(registrationInput?.authenticatorSelection?.userVerification, "required");

  const registered = await passkeys.verifyRegistration({
    context,
    challenge: "registration-challenge",
    response: {} as RegistrationResponseJSON,
    label: "MacBook Touch ID"
  });
  assert.equal(expectedRegistrationChallenge, "registration-challenge");
  assert.equal(registered.label, "MacBook Touch ID");
  assert.equal(registered.rpId, context.rpId);
  assert.equal(registered.origin, context.origin);
  assert.equal(registered.backedUp, true);
  assert.equal(passkeys.hasPasskey(context), true);
  assert.equal("credentialId" in registered, false);
  assert.equal("publicKey" in registered, false);
  assert.equal("counter" in registered, false);

  const secondRegistration = await passkeys.createRegistrationOptions(context);
  assert.equal(secondRegistration.challenge, "registration-challenge");
  assert.deepEqual(
    registrationInput?.excludeCredentials?.map((entry) => entry.id),
    ["credential-one"]
  );

  const authOptions = await passkeys.createAuthenticationOptions(context);
  assert.equal(authOptions.challenge, "authentication-challenge");
  assert.equal(authenticationInput?.rpID, context.rpId);
  assert.equal(authenticationInput?.userVerification, "required");
  assert.equal(
    authenticationInput && "allowCredentials" in authenticationInput,
    false,
    "Discoverable Passkey authentication must not require a username-selected allowCredentials list"
  );

  nowMs += 1_000;
  const authenticated = await passkeys.verifyAuthentication({
    context,
    challenge: "authentication-challenge",
    response: { id: "credential-one" } as AuthenticationResponseJSON
  });
  assert.equal(expectedAuthenticationChallenge, "authentication-challenge");
  assert.equal(authenticated.principalId, owner.id);
  assert.equal(authenticated.passkey.lastUsedAt, new Date(nowMs).toISOString());
  assert.equal(store.getPasskeyByCredentialId("credential-one")?.counter, 9);

  assert.equal(
    store.consumeWebAuthnChallenge({
      challenge: "authentication-challenge",
      kind: "authentication",
      consumedAt: new Date(nowMs + 1).toISOString()
    }),
    null
  );

  const sessionService = new OperatorService({ store, now: () => new Date(nowMs) });
  const session = sessionService.issuePasskeySession({
    principalId: authenticated.principalId,
    source: "203.0.113.22",
    userAgent: "Passkey Test Browser"
  });
  assert.equal(sessionService.authenticate(session.sessionSecret)?.username, "owner");

  await passkeys.createRegistrationOptions(context);
  await sessionService.setOwnerPassword({
    username: "owner",
    password: "test-password-passkey-new-correct-horse-battery-staple"
  });
  assert.equal(
    store.consumeWebAuthnChallenge({
      challenge: "registration-challenge",
      kind: "registration",
      consumedAt: new Date(nowMs + 1).toISOString()
    }),
    null,
    "Password changes must invalidate pending WebAuthn challenges"
  );
  assert.equal(
    passkeys.hasPasskey(context),
    true,
    "Changing the fallback password must not delete registered Passkeys"
  );

  const wrongContext = {
    rpId: "other.example.com",
    origin: "https://other.example.com"
  };
  assert.equal(passkeys.hasPasskey(wrongContext), false);
  await assert.rejects(
    () => passkeys.createAuthenticationOptions(wrongContext),
    (error: unknown) =>
      error instanceof OperatorAuthError && error.code === "PASSKEY_NOT_CONFIGURED"
  );

  assert.equal(passkeys.delete(registered.id, wrongContext), false);
  assert.equal(passkeys.delete(registered.id, context), true);
  assert.equal(passkeys.hasPasskey(context), false);
  assert.equal(passkeys.delete(registered.id, context), false);

  const auditJson = JSON.stringify(store.listAuditEvents(100));
  assert.equal(auditJson.includes("credential-one"), false);
  assert.equal(auditJson.includes("AQM="), false);

  store.close();
  process.stdout.write("OPERATOR_PASSKEYS_OK\n");
}

await main();

import fs from "node:fs";

import {
  generateOperatorPassword,
  generateOperatorUsername,
  operatorCredentialVaultMatchesOwner,
  readOperatorCredentialVault,
  writeOperatorCredentialVault,
  type OperatorCredentialVaultRecord
} from "../auth/operator-credential-vault.js";
import { verifyOperatorPassword } from "../auth/operator-password.js";
import { OperatorService } from "../auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../auth/operator-store.js";
import { ensureWorkspaceDirs } from "../core/paths.js";
import type { TokenPilotPaths } from "../types.js";
import {
  accessPolicyPath,
  DEFAULT_CONSOLE_PATH_PREFIX,
  generateRandomConsolePathPrefix,
  loadAccessPolicy,
  updateAccessPolicy
} from "./access-policy.js";

export interface SecureBootstrapResult {
  ok: true;
  ownerCreated: boolean;
  credentialAvailable: boolean;
  consolePathRandomized: boolean;
}

function ensureRecoverableBootstrapCredential(
  paths: TokenPilotPaths
): OperatorCredentialVaultRecord {
  const existing = readOperatorCredentialVault(paths);
  if (existing) return existing;
  return writeOperatorCredentialVault(paths, {
    username: generateOperatorUsername(),
    password: generateOperatorPassword(),
    ownerUpdatedAt: null
  });
}

export async function setOperatorOwnerPasswordWithVault(
  paths: TokenPilotPaths,
  service: OperatorService,
  input: { username: string; password: string }
): Promise<{ username: string; revokedSessionCount: number }> {
  const result = await service.setOwnerPassword(input);
  const owner = service.store.getOwner();
  if (!owner || owner.username !== result.username) {
    throw new Error("Web Owner state could not be verified after password update");
  }
  writeOperatorCredentialVault(paths, {
    username: result.username,
    password: input.password,
    ownerUpdatedAt: owner.updatedAt
  });
  return result;
}

export async function ensureSecureBootstrap(paths: TokenPilotPaths): Promise<SecureBootstrapResult> {
  ensureWorkspaceDirs(paths);
  const policyFileExists = fs.existsSync(accessPolicyPath(paths));
  const store = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const service = new OperatorService({ store });

  try {
    const existingOwner = service.store.getOwner();
    if (existingOwner) {
      let credentialAvailable = operatorCredentialVaultMatchesOwner(
        paths,
        existingOwner
      );
      if (!credentialAvailable) {
        const recoverable = readOperatorCredentialVault(paths);
        if (
          recoverable?.username === existingOwner.username &&
          await verifyOperatorPassword(recoverable.password, existingOwner.passwordHash)
        ) {
          writeOperatorCredentialVault(paths, {
            username: recoverable.username,
            password: recoverable.password,
            ownerUpdatedAt: existingOwner.updatedAt
          });
          credentialAvailable = true;
        }
      }
      return {
        ok: true,
        ownerCreated: false,
        credentialAvailable,
        consolePathRandomized: false
      };
    }

    const credential = ensureRecoverableBootstrapCredential(paths);
    const currentPolicy = loadAccessPolicy(paths);
    let consolePathRandomized = false;
    if (!policyFileExists || currentPolicy.consolePathPrefix === DEFAULT_CONSOLE_PATH_PREFIX) {
      updateAccessPolicy(paths, {
        consolePathPrefix: generateRandomConsolePathPrefix()
      });
      consolePathRandomized = true;
    }

    await service.setOwnerPassword({
      username: credential.username,
      password: credential.password
    });
    const createdOwner = service.store.getOwner();
    if (!createdOwner || createdOwner.username !== credential.username) {
      throw new Error("Secure Bootstrap could not verify the generated Web Owner");
    }
    writeOperatorCredentialVault(paths, {
      username: credential.username,
      password: credential.password,
      ownerUpdatedAt: createdOwner.updatedAt
    });

    return {
      ok: true,
      ownerCreated: true,
      credentialAvailable: true,
      consolePathRandomized
    };
  } finally {
    store.close();
  }
}

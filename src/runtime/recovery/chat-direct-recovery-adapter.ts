import { ServiceError } from "../../application/service-error.js";
import type {
  ExternalSessionInspection,
  RecoverableExternalSession,
  RecoveryAdapterExecutionInput,
  RecoveryAdapterExecutionResult,
  RuntimeCompatibilityDescriptor,
  RuntimeRecoveryAdapter
} from "../../application/runtime-recovery-types.js";

export class ChatDirectRecoveryAdapter implements RuntimeRecoveryAdapter {
  readonly providerKind = "chat-direct";
  readonly protocolKind = "chat-direct" as const;
  private readonly now: () => string;

  constructor(options: { now?: () => string } = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async probeCompatibility(): Promise<RuntimeCompatibilityDescriptor> {
    return {
      providerKind: this.providerKind,
      protocolKind: this.protocolKind,
      available: true,
      executableSource: "internal",
      executableVersion: null,
      minimumSupportedVersion: null,
      testedVersionRange: null,
      protocolFamily: "chatcockpit-chat-direct",
      protocolVersion: "1",
      schemaFingerprint: null,
      compatibilityStatus: "ready",
      publicReason: null,
      probedAt: this.now()
    };
  }

  async listRecoverableSessions(_input: {
    projectId: string;
    workspaceId: string;
    repoId: string;
  }): Promise<RecoverableExternalSession[]> {
    // Chat Direct is a ChatCockpit continuity lane, not an external provider
    // session. Never manufacture a fake external identity for UI convenience.
    return [];
  }

  async inspectExternalSession(_input: {
    externalSessionId: string;
    projectId: string;
    workspaceId: string;
    repoId: string;
  }): Promise<ExternalSessionInspection> {
    throw new ServiceError(
      "RECOVERY_EXTERNAL_SESSION_UNSUPPORTED",
      "Chat Direct has no external runtime session to inspect"
    );
  }

  async executeRecovery(
    input: RecoveryAdapterExecutionInput
  ): Promise<RecoveryAdapterExecutionResult> {
    if (input.action !== "continue-chat-direct") {
      throw new ServiceError(
        "RECOVERY_ACTION_UNSUPPORTED",
        `Chat Direct Recovery does not execute ${input.action}`
      );
    }
    return {
      externalSession: null,
      relation: "continued"
    };
  }
}

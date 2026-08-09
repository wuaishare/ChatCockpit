import { ServiceError } from "../../application/service-error.js";
import { hashRecoveryAssessment } from "../../application/runtime-recovery-hash.js";
import type {
  ExternalSessionInspection,
  RecoverableExternalSession,
  RecoveryAdapterExecutionInput,
  RecoveryAdapterExecutionResult,
  RuntimeCompatibilityDescriptor,
  RuntimeRecoveryAdapter
} from "../../application/runtime-recovery-types.js";
import type {
  RuntimeCapabilitySnapshot,
  RuntimeThreadForkInput,
  RuntimeThreadListInput,
  RuntimeThreadListResult,
  RuntimeThreadProjection,
  RuntimeThreadReadInput,
  RuntimeThreadResumeInput
} from "../codex/runtime-adapter.js";

const REQUIRED_STABLE_METHODS = [
  "thread/list",
  "thread/read",
  "thread/resume",
  "thread/fork"
] as const;

// TokenPilot currently gates Native Codex Recovery by the stable App Server
// protocol/method fingerprint rather than claiming an unverified semver floor.
export const CODEX_RECOVERY_MINIMUM_SUPPORTED_VERSION: string | null = null;
export const CODEX_RECOVERY_TESTED_VERSION_RANGE: string | null = null;

interface CodexRecoveryRuntime {
  capabilities(): Promise<RuntimeCapabilitySnapshot>;
  listCodexThreads(input?: RuntimeThreadListInput): Promise<RuntimeThreadListResult>;
  readCodexThread(input: RuntimeThreadReadInput): Promise<RuntimeThreadProjection>;
  resumeCodexThread(input: RuntimeThreadResumeInput): Promise<RuntimeThreadProjection>;
  forkCodexThread(input: RuntimeThreadForkInput): Promise<RuntimeThreadProjection>;
}

function publicExecutableSource(
  source: string | null
): RuntimeCompatibilityDescriptor["executableSource"] {
  if (source === "configured") return "custom";
  if (source === "codex-app" || source === "chatgpt-app") return "bundled";
  if (source === "path" || source === "local-bin") return "path";
  return null;
}

function publicStatus(thread: RuntimeThreadProjection): string {
  return thread.status.type || "unknown";
}

function toExternalSession(
  thread: RuntimeThreadProjection
): RecoverableExternalSession {
  return {
    externalSessionId: thread.id,
    providerKind: "codex",
    protocolKind: "native-app-server",
    projectId: thread.projectId,
    workspaceId: thread.workspaceId,
    repoId: thread.repoId,
    status: publicStatus(thread),
    preview: thread.preview,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    recencyAt: thread.recencyAt
  };
}

function identityMatches(
  thread: RuntimeThreadProjection,
  expected: { projectId: string; workspaceId: string; repoId: string }
): boolean {
  return (
    thread.projectId === expected.projectId &&
    thread.workspaceId === expected.workspaceId &&
    thread.repoId === expected.repoId
  );
}

function toInspection(
  thread: RuntimeThreadProjection,
  expected: { projectId: string; workspaceId: string; repoId: string }
): ExternalSessionInspection {
  return {
    ...toExternalSession(thread),
    exists: true,
    authoritative: true,
    // Read-only inspection cannot prove App Server write ownership. A busy
    // conflict is therefore authoritative only when resume/fork returns it.
    busy: false,
    identityMatched: identityMatches(thread, expected)
  };
}

function assertIdentity(
  thread: RuntimeThreadProjection,
  expected: { projectId: string; workspaceId: string; repoId: string }
): void {
  if (!identityMatches(thread, expected)) {
    throw new ServiceError(
      "RUNTIME_WORKSPACE_MISMATCH",
      "Recovered Codex thread does not match the TokenPilot workspace identity",
      {
        details: {
          threadId: thread.id,
          expectedProjectId: expected.projectId,
          actualProjectId: thread.projectId,
          expectedWorkspaceId: expected.workspaceId,
          actualWorkspaceId: thread.workspaceId,
          expectedRepoId: expected.repoId,
          actualRepoId: thread.repoId
        }
      }
    );
  }
}

function compatibilityStatus(
  capabilities: RuntimeCapabilitySnapshot
): Pick<RuntimeCompatibilityDescriptor, "available" | "compatibilityStatus" | "publicReason"> {
  if (!capabilities.available) {
    const reason = capabilities.unavailableReason ?? "CODEX_APP_SERVER_UNAVAILABLE";
    const authRequired = /AUTH|LOGIN|ACCOUNT/i.test(reason);
    return {
      available: false,
      compatibilityStatus: authRequired ? "auth-required" : "unavailable",
      publicReason: authRequired
        ? "Codex authentication is required"
        : "Codex App Server is unavailable"
    };
  }
  if (capabilities.protocolFamily !== "app-server-v2") {
    return {
      available: false,
      compatibilityStatus: "protocol-incompatible",
      publicReason: "Codex App Server protocol family is not supported"
    };
  }
  const missing = REQUIRED_STABLE_METHODS.filter(
    (method) => !capabilities.stableMethods.includes(method)
  );
  if (missing.length > 0) {
    return {
      available: false,
      compatibilityStatus: "protocol-incompatible",
      publicReason: `Codex App Server is missing required stable methods: ${missing.join(", ")}`
    };
  }
  if (capabilities.experimentalApiEnabled) {
    return {
      available: true,
      compatibilityStatus: "degraded",
      publicReason:
        "Codex experimental API is enabled; Recovery uses stable methods only"
    };
  }
  return {
    available: true,
    compatibilityStatus: "ready",
    publicReason: null
  };
}

export class NativeCodexRecoveryAdapter implements RuntimeRecoveryAdapter {
  readonly providerKind = "codex";
  readonly protocolKind = "native-app-server" as const;
  private readonly now: () => string;

  constructor(
    private readonly runtime: CodexRecoveryRuntime,
    options: { now?: () => string } = {}
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async probeCompatibility(): Promise<RuntimeCompatibilityDescriptor> {
    const capabilities = await this.runtime.capabilities();
    const status = compatibilityStatus(capabilities);
    const stableMethods = [...capabilities.stableMethods].sort();
    const schemaFingerprint = hashRecoveryAssessment({
      protocolFamily: capabilities.protocolFamily,
      protocolVersion: capabilities.serverProtocolVersion,
      stableMethods
    });
    return {
      providerKind: this.providerKind,
      protocolKind: this.protocolKind,
      available: status.available,
      executableSource: publicExecutableSource(capabilities.binarySource),
      executableVersion: capabilities.binaryVersion,
      minimumSupportedVersion: CODEX_RECOVERY_MINIMUM_SUPPORTED_VERSION,
      testedVersionRange: CODEX_RECOVERY_TESTED_VERSION_RANGE,
      protocolFamily: capabilities.protocolFamily,
      protocolVersion: capabilities.serverProtocolVersion,
      schemaFingerprint,
      compatibilityStatus: status.compatibilityStatus,
      publicReason: status.publicReason,
      probedAt: this.now()
    };
  }

  async listRecoverableSessions(input: {
    projectId: string;
    workspaceId: string;
    repoId: string;
  }): Promise<RecoverableExternalSession[]> {
    const result = await this.runtime.listCodexThreads({
      workspaceId: input.workspaceId,
      limit: 100
    });
    return result.data
      .filter((thread) => identityMatches(thread, input))
      .map(toExternalSession);
  }

  async inspectExternalSession(input: {
    externalSessionId: string;
    projectId: string;
    workspaceId: string;
    repoId: string;
  }): Promise<ExternalSessionInspection> {
    const thread = await this.runtime.readCodexThread({
      threadId: input.externalSessionId,
      includeTurns: false
    });
    return toInspection(thread, input);
  }

  async executeRecovery(
    input: RecoveryAdapterExecutionInput
  ): Promise<RecoveryAdapterExecutionResult> {
    if (input.action === "resume-bound-codex") {
      if (!input.externalSessionId) {
        throw new ServiceError(
          "RECOVERY_ACTION_INVALID",
          "resume-bound-codex requires an external Codex thread id"
        );
      }
      const thread = await this.runtime.resumeCodexThread({
        threadId: input.externalSessionId
      });
      assertIdentity(thread, input);
      return {
        externalSession: toInspection(thread, input),
        relation: "resumed"
      };
    }
    if (input.action === "fork-bound-codex") {
      const sourceId = input.sourceExternalSessionId ?? input.externalSessionId;
      if (!sourceId) {
        throw new ServiceError(
          "RECOVERY_ACTION_INVALID",
          "fork-bound-codex requires a source Codex thread id"
        );
      }
      const thread = await this.runtime.forkCodexThread({
        threadId: sourceId,
        ...(input.lastTurnId ? { lastTurnId: input.lastTurnId } : {})
      });
      if (thread.id === sourceId) {
        throw new ServiceError(
          "CODEX_THREAD_RESPONSE_INVALID",
          "Codex App Server fork returned the source thread id"
        );
      }
      assertIdentity(thread, input);
      return {
        externalSession: toInspection(thread, input),
        relation: "forked"
      };
    }
    throw new ServiceError(
      "RECOVERY_ACTION_UNSUPPORTED",
      `Native Codex Recovery does not execute ${input.action}`
    );
  }
}

import { ServiceError } from "../../application/service-error.js";
import type { AsyncRunnerRuntimeBindingKind } from "../../continuity/types.js";
import { LEGACY_ASYNC_RUNNER_RUNTIME_KIND } from "../../continuity/runtime-identity.js";
import type {
  ExternalSessionInspection,
  RecoverableExternalSession,
  RecoveryAdapterExecutionInput,
  RecoveryAdapterExecutionResult,
  RuntimeCompatibilityDescriptor,
  RuntimeRecoveryAdapter
} from "../../application/runtime-recovery-types.js";

export interface RunnerRecoveryJobProjection {
  jobId: string;
  projectId: string;
  workspaceId: string;
  repoId: string;
  taskId: string;
  sessionId: string;
  bindingId: string;
  status: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunnerRecoverySource {
  list(): RunnerRecoveryJobProjection[];
  inspect(jobId: string): RunnerRecoveryJobProjection | null;
  reconcile(jobId: string): Promise<RunnerRecoveryJobProjection>;
}

function toExternal(job: RunnerRecoveryJobProjection): RecoverableExternalSession {
  const createdAt = Date.parse(job.createdAt);
  const updatedAt = Date.parse(job.updatedAt);
  return {
    externalSessionId: job.jobId,
    providerKind: "runner",
    protocolKind: "runner",
    projectId: job.projectId,
    workspaceId: job.workspaceId,
    repoId: job.repoId,
    status: job.status,
    preview: job.title,
    createdAt: Number.isFinite(createdAt) ? createdAt : null,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
    recencyAt: Number.isFinite(updatedAt) ? updatedAt : null
  };
}

function identityMatches(
  job: RunnerRecoveryJobProjection,
  expected: { projectId: string; workspaceId: string; repoId: string }
): boolean {
  return (
    job.projectId === expected.projectId &&
    job.workspaceId === expected.workspaceId &&
    job.repoId === expected.repoId
  );
}

function missingInspection(
  jobId: string,
  expected: { projectId: string; workspaceId: string; repoId: string }
): ExternalSessionInspection {
  return {
    externalSessionId: jobId,
    providerKind: "runner",
    protocolKind: "runner",
    projectId: expected.projectId,
    workspaceId: expected.workspaceId,
    repoId: expected.repoId,
    status: "missing",
    preview: "",
    createdAt: null,
    updatedAt: null,
    recencyAt: null,
    exists: false,
    authoritative: true,
    busy: false,
    identityMatched: false
  };
}

export class RunnerRecoveryAdapter implements RuntimeRecoveryAdapter {
  readonly providerKind = "runner";
  readonly protocolKind = "runner" as const;
  private readonly now: () => string;
  private readonly protocolFamily: AsyncRunnerRuntimeBindingKind;

  constructor(
    private readonly source: RunnerRecoverySource,
    options: {
      now?: () => string;
      protocolFamily?: AsyncRunnerRuntimeBindingKind;
    } = {}
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.protocolFamily =
      options.protocolFamily ?? LEGACY_ASYNC_RUNNER_RUNTIME_KIND;
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
      protocolFamily: this.protocolFamily,
      protocolVersion: "1",
      schemaFingerprint: null,
      compatibilityStatus: "ready",
      publicReason: null,
      probedAt: this.now()
    };
  }

  async listRecoverableSessions(input: {
    projectId: string;
    workspaceId: string;
    repoId: string;
  }): Promise<RecoverableExternalSession[]> {
    return this.source
      .list()
      .filter((job) => identityMatches(job, input))
      .map(toExternal);
  }

  async inspectExternalSession(input: {
    externalSessionId: string;
    projectId: string;
    workspaceId: string;
    repoId: string;
  }): Promise<ExternalSessionInspection> {
    const job = this.source.inspect(input.externalSessionId);
    if (!job) return missingInspection(input.externalSessionId, input);
    return {
      ...toExternal(job),
      exists: true,
      authoritative: true,
      busy: job.status === "running",
      identityMatched: identityMatches(job, input)
    };
  }

  async executeRecovery(
    input: RecoveryAdapterExecutionInput
  ): Promise<RecoveryAdapterExecutionResult> {
    if (input.action !== "reconcile-runner-binding") {
      throw new ServiceError(
        "RECOVERY_ACTION_UNSUPPORTED",
        `Runner Recovery does not execute ${input.action}`
      );
    }
    if (!input.externalSessionId) {
      throw new ServiceError(
        "RECOVERY_ACTION_INVALID",
        "reconcile-runner-binding requires a Runner Job id"
      );
    }
    const job = await this.source.reconcile(input.externalSessionId);
    if (!identityMatches(job, input)) {
      throw new ServiceError(
        "RUNTIME_WORKSPACE_MISMATCH",
        "Reconciled Runner Job does not match the ChatCockpit workspace identity"
      );
    }
    return {
      externalSession: {
        ...toExternal(job),
        exists: true,
        authoritative: true,
        busy: job.status === "running",
        identityMatched: true
      },
      relation: "reconciled"
    };
  }
}

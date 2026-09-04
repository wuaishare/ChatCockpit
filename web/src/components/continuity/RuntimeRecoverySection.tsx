import {
  Alert,
  App as AntApp,
  Button,
  Select,
  Tag
} from "antd";
import {
  BranchesOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  LinkOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
  WarningOutlined
} from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { UiText as Text } from "../UiText";

import {
  assessRuntimeRecovery,
  executeRuntimeRecovery
} from "../../api";
import { getUiCopy, type LocaleCode } from "../../i18n";
import { getOperationalStatusLabel, getOperationalStatusTone, type OperationalStatusTone } from "../../status-language";
import type {
  ApiProblem,
  ContinuitySessionMode,
  ContinuitySessionRecord,
  ContinuityWorkspaceSnapshot,
  ContinuityWorkspaceTaskProjection,
  RuntimeRecoveryAction,
  RuntimeRecoveryAssessResponse,
  RuntimeRecoveryClassification,
  RuntimeRecoveryExecuteResponse,
  ProductActionsResponse
} from "../../types";
import { StateNotice } from "../StateNotice";

interface RuntimeRecoverySectionProps {
  locale: LocaleCode;
  token: string | null;
  snapshot: ContinuityWorkspaceSnapshot;
  productActions: ProductActionsResponse | null;
  productActionsError: string | null;
  onRefreshSnapshot: () => Promise<void> | void;
}

type RecoveryProviderSelection = "auto" | "codex" | "runner" | "chat-direct";

function operationKey(name: string): string {
  return `${name}.web:${crypto.randomUUID()}`;
}

function problemMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as ApiProblem).message || fallback);
  }
  return fallback;
}

function recoveryActionAvailable(
  productActions: ProductActionsResponse | null,
  actionId: "runtime.recovery.assess" | "runtime.recovery.execute"
): boolean {
  return productActions?.actions
    .find((action) => action.id === actionId)
    ?.targets.some(
      (target) =>
        target.locality === "local" &&
        target.availability === "available-local" &&
        target.executionMode === "local-runtime"
    ) === true;
}

function availableSessions(
  projection: ContinuityWorkspaceTaskProjection
): ContinuitySessionRecord[] {
  return projection.sessions.filter(
    (session) => !["completed", "failed"].includes(session.status)
  );
}

function preferredSession(
  projection: ContinuityWorkspaceTaskProjection | null
): ContinuitySessionRecord | null {
  if (!projection) return null;
  const sessions = availableSessions(projection);
  return (
    sessions.find((session) => session.id === projection.task.activeSessionId) ??
    sessions[0] ??
    projection.sessions[0] ??
    null
  );
}

function classificationTone(
  classification: RuntimeRecoveryClassification
): OperationalStatusTone {
  if (classification === "healthy") return "success";
  if (classification === "recoverable" || classification === "binding-missing") {
    return "processing";
  }
  if (
    classification === "provider-unavailable" ||
    classification === "provider-auth-required" ||
    classification === "provider-version-unsupported" ||
    classification === "provider-protocol-incompatible" ||
    classification === "external-runtime-identity-mismatch" ||
    classification === "writer-conflict"
  ) {
    return "error";
  }
  if (
    classification === "pending-approval" ||
    classification === "active-run" ||
    classification === "external-runtime-busy" ||
    classification === "external-runtime-missing" ||
    classification === "handoff-required"
  ) {
    return "warning";
  }
  return "default";
}

function actionLabel(action: RuntimeRecoveryAction, locale: LocaleCode): string {
  const zh = locale === "zh-CN";
  const labels: Record<RuntimeRecoveryAction, string> = {
    "resume-bound-codex": zh ? "恢复已绑定 Codex Thread" : "Resume bound Codex thread",
    "fork-bound-codex": zh ? "分叉已绑定 Codex Thread" : "Fork bound Codex thread",
    "bind-existing-codex-thread": zh ? "绑定现有 Codex Thread" : "Bind existing Codex thread",
    "continue-via-handoff": zh ? "通过 Handoff 接续" : "Continue via handoff",
    "continue-chat-direct": zh ? "继续 Chat Direct" : "Continue Chat Direct",
    "reconcile-runner-binding": zh ? "对账 Runner Binding" : "Reconcile Runner binding"
  };
  return labels[action];
}

function classificationLabel(value: RuntimeRecoveryClassification, locale: LocaleCode): string {
  const zh = locale === "zh-CN";
  const labels: Record<RuntimeRecoveryClassification, [string, string]> = {
    healthy: ["健康", "Healthy"],
    recoverable: ["可恢复", "Recoverable"],
    "binding-missing": ["绑定缺失", "Binding missing"],
    "provider-unavailable": ["Provider 不可用", "Provider unavailable"],
    "provider-auth-required": ["Provider 需要认证", "Provider authentication required"],
    "provider-version-unsupported": ["Provider 版本不受支持", "Provider version unsupported"],
    "provider-protocol-incompatible": ["Provider 协议不兼容", "Provider protocol incompatible"],
    "external-runtime-missing": ["外部 Runtime 缺失", "External Runtime missing"],
    "external-runtime-busy": ["外部 Runtime 忙碌", "External Runtime busy"],
    "external-runtime-identity-mismatch": ["外部 Runtime 身份不匹配", "External Runtime identity mismatch"],
    "writer-conflict": ["Writer 冲突", "Writer conflict"],
    "pending-approval": ["等待批准", "Pending approval"],
    "active-run": ["存在活跃运行", "Active run"],
    "handoff-required": ["需要 Handoff", "Handoff required"],
    blocked: ["受阻", "Blocked"]
  };
  return labels[value][zh ? 0 : 1];
}

export function RuntimeRecoverySection({
  locale,
  token,
  snapshot,
  productActions,
  productActionsError,
  onRefreshSnapshot
}: RuntimeRecoverySectionProps) {
  const copy = getUiCopy(locale).continuity;
  const { message } = AntApp.useApp();
  const canAssessRecovery = recoveryActionAvailable(productActions, "runtime.recovery.assess");
  const canExecuteRecovery = recoveryActionAvailable(productActions, "runtime.recovery.execute");
  const taskOptions = useMemo(
    () =>
      snapshot.tasks.map((projection) => ({
        value: projection.task.id,
        label: `${projection.task.title} · ${getOperationalStatusLabel(locale, projection.task.status)}`
      })),
    [locale, snapshot.tasks]
  );
  const initialTask =
    snapshot.tasks.find((projection) =>
      projection.sessions.some(
        (session) => session.id === snapshot.activeLease?.sessionId
      )
    ) ??
    snapshot.tasks.find((projection) => projection.task.activeSessionId) ??
    snapshot.tasks[0] ??
    null;
  const [taskId, setTaskId] = useState<string | null>(initialTask?.task.id ?? null);
  const selectedTask = useMemo(
    () => snapshot.tasks.find((projection) => projection.task.id === taskId) ?? null,
    [snapshot.tasks, taskId]
  );
  const [sessionId, setSessionId] = useState<string | null>(
    preferredSession(initialTask)?.id ?? null
  );
  const [provider, setProvider] = useState<RecoveryProviderSelection>("auto");
  const [assessment, setAssessment] = useState<RuntimeRecoveryAssessResponse | null>(null);
  const [execution, setExecution] = useState<RuntimeRecoveryExecuteResponse | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [executing, setExecuting] = useState<RuntimeRecoveryAction | null>(null);
  const [targetThreadId, setTargetThreadId] = useState<string | null>(null);
  const [targetMode, setTargetMode] = useState<ContinuitySessionMode | null>(null);

  useEffect(() => {
    const stillExists = snapshot.tasks.some((projection) => projection.task.id === taskId);
    if (!stillExists) {
      const next = snapshot.tasks.find((projection) => projection.task.activeSessionId) ?? snapshot.tasks[0] ?? null;
      setTaskId(next?.task.id ?? null);
      setSessionId(preferredSession(next)?.id ?? null);
      setAssessment(null);
      setExecution(null);
    }
  }, [snapshot.tasks, taskId]);

  useEffect(() => {
    if (!selectedTask) {
      setSessionId(null);
      return;
    }
    if (!selectedTask.sessions.some((session) => session.id === sessionId)) {
      setSessionId(preferredSession(selectedTask)?.id ?? null);
    }
  }, [selectedTask, sessionId]);

  const sessionOptions = useMemo(
    () =>
      (selectedTask?.sessions ?? []).map((session) => ({
        value: session.id,
        label: `${session.title} · ${session.mode} · ${getOperationalStatusLabel(locale, session.status)}`
      })),
    [locale, selectedTask]
  );
  const selectedSession =
    selectedTask?.sessions.find((session) => session.id === sessionId) ?? null;
  const currentRuntime = selectedTask?.runtimes.find(
    (runtime) => runtime.sessionId === selectedSession?.id
  ) ?? null;
  const readyHandoff =
    selectedTask?.latestHandoff?.status === "ready" ? selectedTask.latestHandoff : null;

  useEffect(() => {
    if (readyHandoff && readyHandoff.toMode !== "unassigned") {
      setTargetMode(readyHandoff.toMode);
    } else {
      setTargetMode(null);
    }
  }, [readyHandoff?.id, readyHandoff?.toMode]);

  function invalidateAssessment(): void {
    setAssessment(null);
    setExecution(null);
    setTargetThreadId(null);
  }

  async function assess(): Promise<void> {
    if (!canAssessRecovery || !taskId || !sessionId) return;
    setAssessing(true);
    setExecution(null);
    setTargetThreadId(null);
    try {
      const result = await assessRuntimeRecovery(
        {
          workspaceId: snapshot.workspace.id,
          taskId,
          sessionId,
          ...(provider === "auto" ? {} : { providerKind: provider }),
          idempotencyKey: operationKey("recovery.assess")
        },
        token
      );
      setAssessment(result);
      if (result.assessment.candidates.length === 0) {
        setTargetThreadId(null);
      }
    } catch (error) {
      setAssessment(null);
      message.error(problemMessage(error, copy.operationFailed));
    } finally {
      setAssessing(false);
    }
  }

  async function execute(action: RuntimeRecoveryAction): Promise<void> {
    if (!canExecuteRecovery || !assessment || assessment.attempt.status !== "prepared") return;
    if (action === "bind-existing-codex-thread" && !targetThreadId) return;
    if (action === "continue-via-handoff" && !targetMode) return;
    setExecuting(action);
    try {
      const result = await executeRuntimeRecovery(
        {
          recoveryId: assessment.attempt.id,
          assessmentHash: assessment.assessment.assessmentHash,
          expectedRecoveryRevision: assessment.attempt.revision,
          action,
          ...(action === "bind-existing-codex-thread" && targetThreadId
            ? { targetThreadId }
            : {}),
          ...(action === "continue-via-handoff" && targetMode
            ? { targetMode }
            : {}),
          idempotencyKey: operationKey(`recovery.execute.${action}`)
        },
        token
      );
      setExecution(result);
      setAssessment((current) =>
        current ? { ...current, attempt: result.attempt } : current
      );
      await onRefreshSnapshot();
      message.success(copy.recoveryApplied);
    } catch (error) {
      message.error(problemMessage(error, copy.operationFailed));
    } finally {
      setExecuting(null);
    }
  }

  if (snapshot.tasks.length === 0) {
    return (
      <StateNotice
        kind="empty"
        title={copy.noTasksTitle}
        description={copy.noTasksDescription}
        retryLabel={copy.refreshSnapshot}
        onRetry={() => void onRefreshSnapshot()}
      />
    );
  }

  const assessmentPrepared = assessment?.attempt.status === "prepared";
  const compatibility = assessment?.assessment.compatibility ?? null;

  return (
    <div className="continuity-recovery">
      <Alert
        className="continuity-recovery__truth"
        type="info"
        showIcon
        icon={<SafetyCertificateOutlined />}
        message={copy.recoveryAuthoritativeNotice}
      />
      {!canAssessRecovery || !canExecuteRecovery ? (
        <Alert
          type="warning"
          showIcon
          message={productActionsError || copy.recoveryActionAvailabilityUnknown}
        />
      ) : null}

      <section className="continuity-recovery__controls" aria-label={copy.sections.recovery.title}>
        <div className="continuity-recovery__field">
          <span>{copy.recoverySelectTask}</span>
          <Select
            value={taskId ?? undefined}
            options={taskOptions}
            onChange={(value) => {
              const next = snapshot.tasks.find((projection) => projection.task.id === value) ?? null;
              setTaskId(value);
              setSessionId(preferredSession(next)?.id ?? null);
              invalidateAssessment();
            }}
          />
        </div>
        <div className="continuity-recovery__field">
          <span>{copy.recoverySelectSession}</span>
          <Select
            value={sessionId ?? undefined}
            options={sessionOptions}
            onChange={(value) => {
              setSessionId(value);
              invalidateAssessment();
            }}
          />
        </div>
        <div className="continuity-recovery__field">
          <span>{copy.recoveryProvider}</span>
          <Select
            value={provider}
            options={[
              { value: "auto", label: copy.recoveryProviderAuto },
              { value: "codex", label: "Codex App Server" },
              { value: "runner", label: "ChatCockpit Runner" },
              { value: "chat-direct", label: "Chat Direct" }
            ]}
            onChange={(value) => {
              setProvider(value as RecoveryProviderSelection);
              invalidateAssessment();
            }}
          />
        </div>
        <Button
          type="primary"
          icon={assessment ? <ReloadOutlined /> : <SyncOutlined />}
          loading={assessing}
          disabled={!canAssessRecovery || !taskId || !sessionId || Boolean(executing)}
          onClick={() => void assess()}
        >
          {assessment ? copy.recoveryReassess : copy.recoveryAssess}
        </Button>
      </section>

      <section className="continuity-recovery__context">
        <div>
          <span>{copy.taskStatus}</span>
          <strong>{selectedTask ? getOperationalStatusLabel(locale, selectedTask.task.status) : "—"}</strong>
        </div>
        <div>
          <span>{copy.activeSession}</span>
          <strong>{selectedSession?.mode ?? "—"}</strong>
        </div>
        <div>
          <span>{copy.runtimeBinding}</span>
          <code>{currentRuntime?.binding?.id ?? "—"}</code>
        </div>
        <div>
          <span>{copy.gitSummary}</span>
          <code>{snapshot.git.headCommit?.slice(0, 12) ?? "—"}</code>
        </div>
        <div>
          <span>Handoff</span>
          <strong>{selectedTask?.latestHandoff ? getOperationalStatusLabel(locale, selectedTask.latestHandoff.status) : "—"}</strong>
        </div>
        <div>
          <span>{copy.verificationVerified}</span>
          <strong>{selectedTask?.evidence ? getOperationalStatusLabel(locale, selectedTask.evidence.verificationState) : "—"}</strong>
        </div>
      </section>

      {!assessment ? (
        <StateNotice
          kind="empty"
          title={copy.recoveryNoAssessment}
          description={copy.recoveryNoAssessmentDescription}
          retryLabel={copy.recoveryAssess}
          onRetry={canAssessRecovery ? () => void assess() : undefined}
        />
      ) : (
        <>
          <section className="continuity-recovery__assessment">
            <header>
              <div>
                <Text as="h3">{copy.recoveryClassification}</Text>
                <div className="continuity-recovery__status-row">
                  <Tag color={classificationTone(assessment.assessment.classification)}>
                    {classificationLabel(assessment.assessment.classification, locale)}
                  </Tag>
                  <Tag color={getOperationalStatusTone(assessment.attempt.status)}>
                    {getOperationalStatusLabel(locale, assessment.attempt.status)}
                  </Tag>
                </div>
              </div>
              <div className="continuity-recovery__attempt-id">
                <span>{copy.recoveryAttempt}</span>
                <code>{assessment.attempt.id}</code>
              </div>
            </header>

            <div className="continuity-recovery__facts">
              <div>
                <span>{copy.recoveryCompatibility}</span>
                <strong>{compatibility ? getOperationalStatusLabel(locale, compatibility.compatibilityStatus) : "—"}</strong>
              </div>
              <div>
                <span>{copy.recoveryVersion}</span>
                <code>{compatibility?.executableVersion ?? "—"}</code>
              </div>
              <div>
                <span>{copy.recoveryProtocol}</span>
                <code>
                  {compatibility?.protocolFamily ?? "—"}
                  {compatibility?.protocolVersion ? ` · ${compatibility.protocolVersion}` : ""}
                </code>
              </div>
              <div>
                <span>{copy.recoveryExpires}</span>
                <strong>{new Date(assessment.assessment.expiresAt).toLocaleString()}</strong>
              </div>
            </div>

            {compatibility?.publicReason ? (
              <Alert type="warning" showIcon message={compatibility.publicReason} />
            ) : null}
          </section>

          <section className="continuity-recovery__grid">
            <article className="continuity-recovery__panel">
              <header>
                <LinkOutlined />
                <strong>{copy.recoveryExternalRuntime}</strong>
              </header>
              {assessment.assessment.externalSession ? (
                <div className="continuity-recovery__external">
                  <code>{assessment.assessment.externalSession.externalSessionId}</code>
                  <div>
                    <Tag color={getOperationalStatusTone(assessment.assessment.externalSession.status)}>
                      {getOperationalStatusLabel(locale, assessment.assessment.externalSession.status)}
                    </Tag>
                    {assessment.assessment.externalSession.authoritative ? (
                      <Tag color="success">{locale === "zh-CN" ? "权威来源" : "Authoritative"}</Tag>
                    ) : null}
                    {assessment.assessment.externalSession.busy ? (
                      <Tag color="warning">{locale === "zh-CN" ? "忙碌" : "Busy"}</Tag>
                    ) : null}
                    {!assessment.assessment.externalSession.identityMatched ? (
                      <Tag color="error">{locale === "zh-CN" ? "身份不匹配" : "Identity mismatch"}</Tag>
                    ) : null}
                  </div>
                  {assessment.assessment.externalSession.preview ? (
                    <Text as="p" type="secondary">
                      {assessment.assessment.externalSession.preview}
                    </Text>
                  ) : null}
                </div>
              ) : (
                <Text as="p" type="secondary">—</Text>
              )}
            </article>

            <article className="continuity-recovery__panel">
              <header>
                <BranchesOutlined />
                <strong>{copy.recoveryCandidates}</strong>
              </header>
              {assessment.assessment.candidates.length === 0 ? (
                <Text as="p" type="secondary">{copy.recoveryNoCandidates}</Text>
              ) : (
                <div className="continuity-recovery__candidate-list">
                  {assessment.assessment.candidates.map((candidate) => (
                    <button
                      type="button"
                      className={candidate.externalSessionId === targetThreadId ? "is-selected" : ""}
                      key={candidate.externalSessionId}
                      onClick={() => setTargetThreadId(candidate.externalSessionId)}
                    >
                      <code>{candidate.externalSessionId}</code>
                      <span>{candidate.preview || getOperationalStatusLabel(locale, candidate.status)}</span>
                      <Tag color={getOperationalStatusTone(candidate.status)}>
                        {getOperationalStatusLabel(locale, candidate.status)}
                      </Tag>
                    </button>
                  ))}
                </div>
              )}
            </article>
          </section>

          <section className="continuity-recovery__grid">
            <article className="continuity-recovery__panel">
              <header>
                {assessment.assessment.blockers.length > 0 ? (
                  <WarningOutlined />
                ) : (
                  <CheckCircleOutlined />
                )}
                <strong>{copy.recoveryBlockers}</strong>
              </header>
              {assessment.assessment.blockers.length === 0 ? (
                <Text as="p" type="secondary">{copy.recoveryNoBlockers}</Text>
              ) : (
                <ul className="continuity-recovery__blockers">
                  {assessment.assessment.blockers.map((entry, index) => (
                    <li key={`${entry.code}:${index}`}>
                      <code>{entry.code}</code>
                      <span>{entry.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="continuity-recovery__panel">
              <header>
                <SafetyCertificateOutlined />
                <strong>{copy.recoveryActions}</strong>
              </header>
              {assessment.assessment.availableActions.length === 0 ? (
                <Text as="p" type="secondary">{copy.recoveryNoActions}</Text>
              ) : (
                <div className="continuity-recovery__actions">
                  {assessment.assessment.availableActions.includes(
                    "bind-existing-codex-thread"
                  ) ? (
                    <div className="continuity-recovery__action-input">
                      <span>{copy.recoveryTargetThread}</span>
                      <Select
                        value={targetThreadId ?? undefined}
                        options={assessment.assessment.candidates.map((candidate) => ({
                          value: candidate.externalSessionId,
                          label: `${candidate.externalSessionId} · ${getOperationalStatusLabel(locale, candidate.status)}`
                        }))}
                        placeholder={copy.recoveryTargetThread}
                        onChange={setTargetThreadId}
                      />
                    </div>
                  ) : null}
                  {assessment.assessment.availableActions.includes(
                    "continue-via-handoff"
                  ) ? (
                    <div className="continuity-recovery__action-input">
                      <span>{copy.recoveryTargetMode}</span>
                      <Select
                        value={targetMode ?? undefined}
                        options={[
                          "chat-direct",
                          "codex-session",
                          "async-agent"
                        ].map((mode) => ({ value: mode, label: mode }))}
                        placeholder={copy.recoveryTargetMode}
                        onChange={(value) => setTargetMode(value as ContinuitySessionMode)}
                      />
                    </div>
                  ) : null}
                  <div className="continuity-recovery__action-buttons">
                    {assessment.assessment.availableActions.map((action) => {
                      const needsThread =
                        action === "bind-existing-codex-thread" && !targetThreadId;
                      const needsMode = action === "continue-via-handoff" && !targetMode;
                      return (
                        <Button
                          key={action}
                          type={action === "resume-bound-codex" ? "primary" : "default"}
                          loading={executing === action}
                          disabled={
                            !canExecuteRecovery ||
                            !assessmentPrepared ||
                            Boolean(executing && executing !== action) ||
                            needsThread ||
                            needsMode
                          }
                          onClick={() => void execute(action)}
                        >
                          {actionLabel(action, locale)}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </article>
          </section>
        </>
      )}

      {execution ? (
        <Alert
          className="continuity-recovery__result"
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          message={copy.recoveryApplied}
          description={
            <div className="continuity-recovery__result-details">
              <span>
                {copy.recoveryAttempt}: <code>{execution.attempt.id}</code>
              </span>
              <span>
                {copy.recoveryResultBinding}: <code>{execution.resultingBinding?.id ?? "—"}</code>
              </span>
              <span>
                <ClockCircleOutlined /> {execution.action}
              </span>
            </div>
          }
        />
      ) : null}
    </div>
  );
}

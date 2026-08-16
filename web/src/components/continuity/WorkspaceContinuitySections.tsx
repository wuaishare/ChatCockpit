import { Alert, Button, Popconfirm, Tag } from "antd";
import { Text } from "@lobehub/ui";
import {
  BranchesOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
  ForkOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
  UnlockOutlined
} from "@ant-design/icons";

import { getUiCopy, type LocaleCode } from "../../i18n";
import { consolePath } from "../../console-path";
import type {
  ContinuityHandoffRecord,
  ContinuityWorkspaceSnapshot,
  ContinuityWorkspaceTaskProjection,
  ContinuityVerificationState
} from "../../types";
import { StateNotice } from "../StateNotice";
import { PlanningStatus } from "./DevelopmentDocumentsSection";

function formatDate(value: string | null, locale: LocaleCode): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function shortId(value: string | null): string {
  return value ? value.slice(0, 12) : "—";
}

export function WriterBanner({
  locale,
  snapshot
}: {
  locale: LocaleCode;
  snapshot: ContinuityWorkspaceSnapshot;
}) {
  const copy = getUiCopy(locale).continuity;
  const lease = snapshot.activeLease;
  return (
    <Alert
      className="continuity-writer-banner"
      showIcon
      type={lease ? "warning" : "success"}
      icon={lease ? <LockOutlined /> : <UnlockOutlined />}
      message={lease ? copy.activeWriter : copy.noActiveWriter}
      description={
        lease ? (
          <div className="continuity-writer-banner__details">
            <span>{copy.writerReadOnlyNotice}</span>
            <span>
              {copy.writerSession}: <code>{lease.sessionId}</code>
            </span>
            <span>
              {copy.writerMode}: <strong>{lease.holderType}</strong>
            </span>
            <span>
              {copy.writerExpires}: <strong>{formatDate(lease.expiresAt, locale)}</strong>
            </span>
          </div>
        ) : (
          copy.writerAvailableNotice
        )
      }
    />
  );
}

export function GitSummary({
  locale,
  snapshot
}: {
  locale: LocaleCode;
  snapshot: ContinuityWorkspaceSnapshot;
}) {
  const copy = getUiCopy(locale).continuity;
  return (
    <section className="continuity-git-summary">
      <header>
        <div>
          <BranchesOutlined aria-hidden="true" />
          <strong>{copy.gitSummary}</strong>
        </div>
        <Tag color={snapshot.git.dirty ? "orange" : "green"}>
          {snapshot.git.dirty ? copy.dirty : copy.clean}
        </Tag>
      </header>
      {snapshot.git.available ? (
        <>
          <div className="continuity-git-summary__facts">
            <span>
              {copy.branch}: <code>{snapshot.git.branch || "—"}</code>
            </span>
            <span>
              {copy.headCommit}: <code>{shortId(snapshot.git.headCommit)}</code>
            </span>
          </div>
          <div className="continuity-changed-files">
            <strong>{copy.changedFiles}</strong>
            {snapshot.git.changedPaths.length > 0 ? (
              <div className="continuity-chip-list">
                {snapshot.git.changedPaths.map((file) => (
                  <code key={file}>{file}</code>
                ))}
              </div>
            ) : (
              <span>{copy.noChangedFiles}</span>
            )}
          </div>
        </>
      ) : (
        <span className="continuity-git-summary__unavailable">{copy.gitUnavailable}</span>
      )}
    </section>
  );
}

export function TasksSection({
  locale,
  snapshot,
  mutating,
  onSubmitReview,
  onComplete
}: {
  locale: LocaleCode;
  snapshot: ContinuityWorkspaceSnapshot;
  mutating: string | null;
  onSubmitReview: (projection: ContinuityWorkspaceTaskProjection) => void;
  onComplete: (projection: ContinuityWorkspaceTaskProjection) => void;
}) {
  const copy = getUiCopy(locale).continuity;
  if (snapshot.tasks.length === 0) {
    return (
      <StateNotice
        kind="empty"
        title={copy.noTasksTitle}
        description={copy.noTasksDescription}
        retryLabel={copy.refreshSnapshot}
      />
    );
  }
  return (
    <div className="continuity-entity-list">
      {snapshot.tasks.map((projection) => {
        const { task, sessions, latestHandoff, evidence, completion } = projection;
        const canSubmitReview =
          ["in-progress", "blocked"].includes(task.status) &&
          evidence?.verificationState === "verified";
        const canComplete = task.status === "review" && completion.eligible;
        return (
          <article className="continuity-entity-card" key={task.id}>
            <header>
              <div>
                <Text as="h3">{task.title}</Text>
                <Text as="p" type="secondary">{task.goal}</Text>
              </div>
              <VerificationTag
                state={evidence?.verificationState ?? "missing"}
                locale={locale}
              />
            </header>
            <div className="continuity-entity-card__facts">
              <span>{copy.taskStatus}: <strong>{task.status}</strong></span>
              <span>{copy.priority}: <strong>{task.priority}</strong></span>
              <span>{copy.planningPolicy}: <strong>{task.executionPolicy}</strong></span>
              <span>{copy.activeSession}: <code>{task.activeSessionId || "—"}</code></span>
              <span>{copy.parentTask}: <code>{task.parentTaskId || "—"}</code></span>
              <span>{copy.revision}: <strong>{task.revision}</strong></span>
            </div>
            <PlanningStatus locale={locale} projection={projection} />
            <div
              className={`continuity-completion-state ${
                completion.eligible ? "is-ready" : "is-blocked"
              }`}
            >
              <div className="continuity-completion-state__heading">
                {completion.eligible ? <CheckCircleOutlined /> : <LockOutlined />}
                <strong>
                  {completion.eligible ? copy.completionReady : copy.completionBlocked}
                </strong>
              </div>
              {completion.blockers.length > 0 ? (
                <div className="continuity-completion-blockers">
                  <strong>{copy.completionBlockers}</strong>
                  <ul>
                    {completion.blockers.map((blocker, index) => (
                      <li key={`${blocker.code}:${index}`}>
                        <code>{blocker.code}</code>
                        <span>{blocker.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <div className="continuity-entity-card__footer">
              <span>{sessions.length} {copy.sections.sessions.label}</span>
              <span>
                {latestHandoff
                  ? `${copy.sections.handoffs.label}: ${latestHandoff.status}`
                  : copy.noHandoffsTitle}
              </span>
            </div>
            <div className="continuity-entity-card__actions">
              <Popconfirm
                title={copy.submitReview}
                disabled={!canSubmitReview}
                onConfirm={() => onSubmitReview(projection)}
              >
                <Button
                  disabled={!canSubmitReview}
                  loading={mutating === `review:${task.id}`}
                >
                  {copy.submitReview}
                </Button>
              </Popconfirm>
              <Popconfirm
                title={copy.completeTask}
                disabled={!canComplete}
                onConfirm={() => onComplete(projection)}
              >
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  disabled={!canComplete}
                  loading={mutating === `complete:${task.id}`}
                >
                  {copy.completeTask}
                </Button>
              </Popconfirm>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function SessionsSection({
  locale,
  snapshot
}: {
  locale: LocaleCode;
  snapshot: ContinuityWorkspaceSnapshot;
}) {
  const copy = getUiCopy(locale).continuity;
  const sessions = snapshot.tasks.flatMap(({ task, sessions, runtimes }) =>
    sessions.map((session) => ({
      task,
      session,
      runtime: runtimes.find((entry) => entry.sessionId === session.id) ?? null
    }))
  );
  if (sessions.length === 0) {
    return (
      <StateNotice
        kind="empty"
        title={copy.noSessionsTitle}
        description={copy.noSessionsDescription}
        retryLabel={copy.refreshSnapshot}
      />
    );
  }
  return (
    <div className="continuity-entity-list">
      {sessions.map(({ task, session, runtime }) => (
        <article className="continuity-entity-card" key={session.id}>
          <header>
            <div>
              <Text as="h3">{session.title}</Text>
              <Text as="p" type="secondary">{task.title}</Text>
            </div>
            <Tag>{session.status}</Tag>
          </header>
          <div className="continuity-entity-card__facts">
            <span>{copy.writerMode}: <strong>{session.mode}</strong></span>
            <span>{copy.createdAt}: <strong>{formatDate(session.startedAt, locale)}</strong></span>
            <span>{copy.revision}: <strong>{session.revision}</strong></span>
          </div>
          {runtime?.binding ? (
            <div className="continuity-runtime-binding">
              <div className="continuity-runtime-binding__heading">
                <SwapOutlined />
                <strong>{copy.runtimeBinding}</strong>
                <Tag>{runtime.binding.runtimeKind}</Tag>
              </div>
              <div className="continuity-entity-card__facts">
                <span>
                  {copy.bindingStatus}: <strong>{runtime.binding.status}</strong>
                </span>
                <span>
                  {copy.externalRun}: <code>{runtime.binding.externalRunId || "—"}</code>
                </span>
              </div>
              {runtime.job ? (
                <div className="continuity-runtime-job">
                  <div className="continuity-runtime-job__heading">
                    <strong>{copy.asyncJob}</strong>
                    <Tag color={runtime.job.status === "completed" ? "green" : undefined}>
                      {copy.jobStatus}: {runtime.job.status}
                    </Tag>
                  </div>
                  <code>{runtime.job.id}</code>
                  <div className="continuity-runtime-job__artifacts">
                    <strong>{copy.jobArtifacts}</strong>
                    {runtime.job.artifacts.length > 0 ? (
                      <div className="continuity-chip-list">
                        {runtime.job.artifacts.map((artifact) => (
                          <a
                            key={artifact.key}
                            href={consolePath(`jobs/${encodeURIComponent(runtime.job!.id)}`)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <FileTextOutlined /> {artifact.label}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span>{copy.noJobArtifacts}</span>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function HandoffsSection({
  locale,
  snapshot,
  mutating,
  onAccept,
  onCancel,
  onFork
}: {
  locale: LocaleCode;
  snapshot: ContinuityWorkspaceSnapshot;
  mutating: string | null;
  onAccept: (handoff: ContinuityHandoffRecord) => void;
  onCancel: (handoff: ContinuityHandoffRecord) => void;
  onFork: (handoff: ContinuityHandoffRecord) => void;
}) {
  const copy = getUiCopy(locale).continuity;
  const handoffs = snapshot.tasks
    .map(({ task, latestHandoff, evidence }) => ({ task, handoff: latestHandoff, evidence }))
    .filter(
      (entry): entry is typeof entry & { handoff: ContinuityHandoffRecord } =>
        Boolean(entry.handoff)
    );
  if (handoffs.length === 0) {
    return (
      <StateNotice
        kind="empty"
        title={copy.noHandoffsTitle}
        description={copy.noHandoffsDescription}
        retryLabel={copy.refreshSnapshot}
      />
    );
  }
  return (
    <div className="continuity-entity-list">
      {handoffs.map(({ task, handoff, evidence }) => (
        <article className="continuity-handoff-card" key={handoff.id}>
          <header>
            <div>
              <Text as="h3">{task.title}</Text>
              <Text as="p" type="secondary">{handoff.goal}</Text>
            </div>
            <div className="continuity-handoff-card__status">
              <Tag color={handoff.status === "ready" ? "blue" : "default"}>{handoff.status}</Tag>
              <VerificationTag state={evidence?.verificationState ?? "missing"} locale={locale} />
            </div>
          </header>
          <div className="continuity-entity-card__facts">
            <span>{copy.handoffFrom}: <strong>{handoff.fromMode}</strong></span>
            <span>{copy.handoffTo}: <strong>{handoff.toMode}</strong></span>
            <span>{copy.createdAt}: <strong>{formatDate(handoff.createdAt, locale)}</strong></span>
          </div>
          <HandoffItems label={copy.completedItems} items={handoff.completedItems} />
          <HandoffItems label={copy.pendingItems} items={handoff.pendingItems} />
          <HandoffItems label={copy.risks} items={handoff.risks} />
          <div className="continuity-handoff-card__next">
            <strong>{copy.nextAction}</strong>
            <span>{handoff.nextAction}</span>
          </div>
          {handoff.status === "ready" ? (
            <div className="continuity-handoff-card__actions">
              <Popconfirm title={copy.acceptHandoff} onConfirm={() => onAccept(handoff)}>
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  loading={mutating === `accept:${handoff.id}`}
                >
                  {copy.acceptHandoff}
                </Button>
              </Popconfirm>
              <Button icon={<ForkOutlined />} onClick={() => onFork(handoff)}>
                {copy.forkHandoff}
              </Button>
              <Popconfirm title={copy.cancelHandoff} onConfirm={() => onCancel(handoff)}>
                <Button
                  danger
                  icon={<CloseCircleOutlined />}
                  loading={mutating === `cancel:${handoff.id}`}
                >
                  {copy.cancelHandoff}
                </Button>
              </Popconfirm>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function HandoffItems({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="continuity-handoff-items">
      <strong>{label}</strong>
      <ul>
        {items.map((item, index) => (
          <li key={`${index}:${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function EvidenceSection({
  locale,
  snapshot
}: {
  locale: LocaleCode;
  snapshot: ContinuityWorkspaceSnapshot;
}) {
  const copy = getUiCopy(locale).continuity;
  const evidence = snapshot.tasks.filter((projection) => projection.evidence);
  if (evidence.length === 0) {
    return (
      <StateNotice
        kind="empty"
        title={copy.noEvidenceTitle}
        description={copy.noEvidenceDescription}
        retryLabel={copy.refreshSnapshot}
      />
    );
  }
  return (
    <div className="continuity-entity-list">
      {evidence.map(({ task, evidence }) => {
        if (!evidence) return null;
        return (
          <article className="continuity-evidence-card" key={evidence.bundle.id}>
            <header>
              <div>
                <Text as="h3">{task.title}</Text>
                <Text as="p" type="secondary">
                  {evidence.bundle.passedItemCount}/{evidence.bundle.requiredItemCount} {copy.requiredEvidence}
                </Text>
              </div>
              <VerificationTag state={evidence.verificationState} locale={locale} />
            </header>
            <div className="continuity-evidence-list">
              {evidence.items.map((item) => (
                <div className="continuity-evidence-item" key={item.id}>
                  <span className={`continuity-evidence-item__status is-${item.status}`}>
                    {item.status === "passed" ? <CheckCircleOutlined /> : <ClockCircleOutlined />}
                  </span>
                  <div>
                    <strong>{item.label}</strong>
                    {item.summary ? <span>{item.summary}</span> : null}
                  </div>
                  <Tag>{item.required ? copy.requiredEvidence : copy.optionalEvidence}</Tag>
                </div>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function ApprovalsSection({
  locale,
  snapshot
}: {
  locale: LocaleCode;
  snapshot: ContinuityWorkspaceSnapshot;
}) {
  const copy = getUiCopy(locale).continuity;
  if (snapshot.pendingApprovals.length === 0) {
    return (
      <StateNotice
        kind="empty"
        title={copy.noApprovalsTitle}
        description={copy.noApprovalsDescription}
        retryLabel={copy.refreshSnapshot}
      />
    );
  }
  return (
    <div className="continuity-entity-list">
      {snapshot.pendingApprovals.map((approval) => (
        <article className="continuity-entity-card" key={approval.id}>
          <header>
            <div>
              <Text as="h3">{approval.requestMethod}</Text>
              <Text as="p" type="secondary">
                {formatDate(approval.receivedAt, locale)}
              </Text>
            </div>
            <Tag color="orange">{approval.status}</Tag>
          </header>
          <div className="continuity-entity-card__facts">
            <span>{copy.approvalKind}: <strong>{approval.kind}</strong></span>
            <span>{copy.approvalStatus}: <strong>{approval.status}</strong></span>
            <span>{copy.writerSession}: <code>{approval.sessionId}</code></span>
          </div>
          <pre className="continuity-approval-summary">
            {JSON.stringify(approval.publicSummary, null, 2)}
          </pre>
        </article>
      ))}
    </div>
  );
}

function VerificationTag({
  state,
  locale
}: {
  state: ContinuityVerificationState;
  locale: LocaleCode;
}) {
  const copy = getUiCopy(locale).continuity;
  const labels: Record<ContinuityVerificationState, string> = {
    verified: copy.verificationVerified,
    incomplete: copy.verificationIncomplete,
    missing: copy.verificationMissing
  };
  const colors: Record<ContinuityVerificationState, string> = {
    verified: "green",
    incomplete: "orange",
    missing: "red"
  };
  return (
    <Tag icon={<SafetyCertificateOutlined />} color={colors[state]}>
      {labels[state]}
    </Tag>
  );
}

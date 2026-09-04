import { Alert, App as AntApp, Button, Form, Input, Modal, Select, Tag } from "antd";
import { UiText as Text } from "../UiText";
import {
  CheckCircleOutlined,
  FileAddOutlined,
  FileTextOutlined,
  LinkOutlined,
  PlusOutlined
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  appendDevelopmentDocumentVersion,
  bindContinuityTaskDocuments,
  createDevelopmentDocument,
  fetchDevelopmentDocument,
  fetchDevelopmentDocuments,
  updateDevelopmentDocumentStatus
} from "../../api";
import { getUiCopy, type LocaleCode } from "../../i18n";
import { getOperationalStatusLabel, getOperationalStatusTone } from "../../status-language";
import type {
  ApiProblem,
  ContinuityDevelopmentDocumentDetail,
  ContinuityDevelopmentDocumentKind,
  ContinuityDevelopmentDocumentStatus,
  ContinuityDevelopmentDocumentSummary,
  ContinuityPlanningRequirementState,
  ContinuityWorkspaceSnapshot,
  ContinuityWorkspaceTaskProjection
} from "../../types";
import { StateNotice } from "../StateNotice";

interface DevelopmentDocumentsSectionProps {
  locale: LocaleCode;
  token: string | null;
  snapshot: ContinuityWorkspaceSnapshot;
  mutationAvailable: boolean;
  availabilityError: string | null;
  onRefreshSnapshot: () => Promise<void> | void;
}

interface CreateDocumentValues {
  kind: ContinuityDevelopmentDocumentKind;
  title: string;
  contentMarkdown: string;
  changeSummary?: string;
}

interface AppendVersionValues {
  contentMarkdown: string;
  changeSummary?: string;
}

interface BindDocumentsValues {
  taskId: string;
  specId?: string;
  planId?: string;
}

function idempotencyKey(operation: string): string {
  return `${operation}.web:${crypto.randomUUID()}`;
}

function problemMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as ApiProblem).message || fallback);
  }
  return fallback;
}

function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

export function DevelopmentDocumentsSection({
  locale,
  token,
  snapshot,
  mutationAvailable,
  availabilityError,
  onRefreshSnapshot
}: DevelopmentDocumentsSectionProps) {
  const copy = getUiCopy(locale).continuity;
  const { message } = AntApp.useApp();
  const [documents, setDocuments] = useState<ContinuityDevelopmentDocumentSummary[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContinuityDevelopmentDocumentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [mutating, setMutating] = useState<string | null>(null);
  const [createForm] = Form.useForm<CreateDocumentValues>();
  const [versionForm] = Form.useForm<AppendVersionValues>();
  const [bindForm] = Form.useForm<BindDocumentsValues>();
  const selectedTaskId = Form.useWatch("taskId", bindForm);

  const bindableTasks = useMemo(
    () =>
      snapshot.tasks.filter(
        ({ task }) => !["completed", "cancelled"].includes(task.status)
      ),
    [snapshot.tasks]
  );
  const selectedTask =
    bindableTasks.find(({ task }) => task.id === selectedTaskId) ??
    bindableTasks[0] ??
    null;
  const specOptions = useMemo(
    () =>
      documents
        .filter(
          ({ document }) =>
            document.kind === "spec" &&
            !["superseded", "archived"].includes(document.status)
        )
        .map(({ document }) => ({
          label: `${document.title} · v${document.currentVersion} · ${getOperationalStatusLabel(locale, document.status)}`,
          value: document.id
        })),
    [documents, locale]
  );
  const planOptions = useMemo(
    () =>
      documents
        .filter(
          ({ document }) =>
            document.kind === "plan" &&
            !["superseded", "archived"].includes(document.status)
        )
        .map(({ document }) => ({
          label: `${document.title} · v${document.currentVersion} · ${getOperationalStatusLabel(locale, document.status)}`,
          value: document.id
        })),
    [documents, locale]
  );

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchDevelopmentDocuments(snapshot.workspace.id, token);
      setDocuments(response.documents);
      setSelectedDocumentId((current) => {
        if (current && response.documents.some(({ document }) => document.id === current)) {
          return current;
        }
        return response.documents[0]?.document.id ?? null;
      });
    } catch (loadError) {
      setDocuments([]);
      setSelectedDocumentId(null);
      setDetail(null);
      setError(problemMessage(loadError, copy.operationFailed));
    } finally {
      setLoading(false);
    }
  }, [copy.operationFailed, snapshot.workspace.id, token]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (!selectedDocumentId) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    let active = true;
    setDetailLoading(true);
    void fetchDevelopmentDocument(selectedDocumentId, token)
      .then((response) => {
        if (!active) return;
        const { ok: _ok, ...documentDetail } = response;
        setDetail(documentDetail);
      })
      .catch((loadError) => {
        if (!active) return;
        setDetail(null);
        message.error(problemMessage(loadError, copy.operationFailed));
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [copy.operationFailed, message, selectedDocumentId, token]);

  useEffect(() => {
    const task = selectedTask?.task;
    if (!task) {
      bindForm.resetFields();
      return;
    }
    bindForm.setFieldsValue({
      taskId: task.id,
      specId: task.specId ?? undefined,
      planId: task.planId ?? undefined
    });
  }, [bindForm, selectedTask?.task.id, selectedTask?.task.revision]);

  async function refreshAll(preferredDocumentId?: string): Promise<void> {
    await Promise.all([loadDocuments(), Promise.resolve(onRefreshSnapshot())]);
    if (preferredDocumentId) setSelectedDocumentId(preferredDocumentId);
  }

  async function submitCreate(values: CreateDocumentValues): Promise<void> {
    if (!mutationAvailable) return;
    setMutating("create");
    try {
      const response = await createDevelopmentDocument(
        {
          projectId: snapshot.project.id,
          workspaceId: snapshot.workspace.id,
          kind: values.kind,
          title: values.title,
          contentMarkdown: values.contentMarkdown,
          changeSummary: values.changeSummary,
          idempotencyKey: idempotencyKey("development-document.create")
        },
        token
      );
      setCreateOpen(false);
      createForm.resetFields();
      await refreshAll(response.document.id);
      message.success(copy.operationComplete);
    } catch (mutationError) {
      message.error(problemMessage(mutationError, copy.operationFailed));
    } finally {
      setMutating(null);
    }
  }

  async function submitVersion(values: AppendVersionValues): Promise<void> {
    if (!mutationAvailable || !detail) return;
    setMutating(`version:${detail.document.id}`);
    try {
      const response = await appendDevelopmentDocumentVersion(
        {
          documentId: detail.document.id,
          contentMarkdown: values.contentMarkdown,
          changeSummary: values.changeSummary,
          expectedRevision: detail.document.revision,
          idempotencyKey: idempotencyKey("development-document.append-version")
        },
        token
      );
      setVersionOpen(false);
      versionForm.resetFields();
      await refreshAll(response.document.id);
      message.success(copy.operationComplete);
    } catch (mutationError) {
      message.error(problemMessage(mutationError, copy.operationFailed));
    } finally {
      setMutating(null);
    }
  }

  async function transitionDocument(
    status: ContinuityDevelopmentDocumentStatus
  ): Promise<void> {
    if (!mutationAvailable || !detail) return;
    setMutating(`status:${detail.document.id}`);
    try {
      const response = await updateDevelopmentDocumentStatus(
        {
          documentId: detail.document.id,
          status,
          expectedRevision: detail.document.revision,
          idempotencyKey: idempotencyKey("development-document.update-status")
        },
        token
      );
      await refreshAll(response.document.id);
      message.success(copy.operationComplete);
    } catch (mutationError) {
      message.error(problemMessage(mutationError, copy.operationFailed));
    } finally {
      setMutating(null);
    }
  }

  async function submitBinding(values: BindDocumentsValues): Promise<void> {
    if (!mutationAvailable) return;
    const projection = snapshot.tasks.find(({ task }) => task.id === values.taskId);
    if (!projection) return;
    setMutating(`bind:${projection.task.id}`);
    try {
      await bindContinuityTaskDocuments(
        {
          taskId: projection.task.id,
          specId: values.specId || null,
          planId: values.planId || null,
          expectedTaskRevision: projection.task.revision,
          idempotencyKey: idempotencyKey("task.bind-documents")
        },
        token
      );
      await refreshAll(selectedDocumentId ?? undefined);
      message.success(copy.operationComplete);
    } catch (mutationError) {
      message.error(problemMessage(mutationError, copy.operationFailed));
    } finally {
      setMutating(null);
    }
  }

  function openVersion(): void {
    if (!mutationAvailable || !detail) return;
    versionForm.setFieldsValue({
      contentMarkdown: detail.currentContent.contentMarkdown,
      changeSummary: ""
    });
    setVersionOpen(true);
  }

  return (
    <section className="continuity-documents" aria-label={copy.sections.documents.title}>
      {!mutationAvailable ? (
        <Alert
          type="warning"
          showIcon
          message={availabilityError || copy.actionAvailabilityUnknown}
        />
      ) : null}
      <div className="continuity-documents__toolbar">
        <div>
          <strong>{copy.sections.documents.title}</strong>
          <span>{documents.length}</span>
        </div>
        <Button
          type="primary"
          icon={<FileAddOutlined />}
          disabled={!mutationAvailable}
          onClick={() => {
            createForm.setFieldsValue({ kind: "spec", changeSummary: "" });
            setCreateOpen(true);
          }}
        >
          {copy.createDocument}
        </Button>
      </div>

      {error ? (
        <StateNotice
          kind="error"
          title={copy.requestFailedTitle}
          description={error}
          retryLabel={copy.refreshSnapshot}
          onRetry={() => void loadDocuments()}
        />
      ) : loading && documents.length === 0 ? (
        <StateNotice
          kind="loading"
          title={copy.loadingTitle}
          description={copy.loadingDescription}
          retryLabel={copy.refreshSnapshot}
        />
      ) : documents.length === 0 ? (
        <StateNotice
          kind="empty"
          title={copy.noDocumentsTitle}
          description={copy.noDocumentsDescription}
          retryLabel={mutationAvailable ? copy.createDocument : copy.refreshSnapshot}
          onRetry={mutationAvailable ? () => setCreateOpen(true) : () => void loadDocuments()}
        />
      ) : (
        <div className="continuity-documents__workspace">
          <nav className="continuity-document-index" aria-label={copy.sections.documents.label}>
            {documents.map(({ document, currentVersion }) => (
              <button
                key={document.id}
                type="button"
                className={
                  document.id === selectedDocumentId
                    ? "continuity-document-index__item is-active"
                    : "continuity-document-index__item"
                }
                onClick={() => setSelectedDocumentId(document.id)}
              >
                <span className="continuity-document-index__title">
                  <FileTextOutlined aria-hidden="true" />
                  <strong>{document.title}</strong>
                </span>
                <span className="continuity-document-index__meta">
                  <Tag>{document.kind}</Tag>
                  <Tag color={getOperationalStatusTone(document.status)}>
                    {getOperationalStatusLabel(locale, document.status)}
                  </Tag>
                  <code>v{document.currentVersion}</code>
                  <code>{shortHash(currentVersion.contentHash)}</code>
                </span>
              </button>
            ))}
          </nav>

          <div className="continuity-document-detail">
            {detailLoading ? (
              <StateNotice
                kind="loading"
                title={copy.loadingTitle}
                description={copy.loadingDescription}
                retryLabel={copy.refreshSnapshot}
              />
            ) : detail ? (
              <>
                <header className="continuity-document-detail__header">
                  <div>
                    <div className="continuity-document-detail__eyebrow">
                      <Tag>{detail.document.kind}</Tag>
                      <Tag color={getOperationalStatusTone(detail.document.status)}>
                        {getOperationalStatusLabel(locale, detail.document.status)}
                      </Tag>
                    </div>
                    <Text as="h3">{detail.document.title}</Text>
                  </div>
                  <div className="continuity-document-detail__actions">
                    <Button
                      icon={<PlusOutlined />}
                      disabled={!mutationAvailable}
                      onClick={openVersion}
                    >
                      {copy.appendVersion}
                    </Button>
                    {detail.document.status === "draft" ? (
                      <Button
                        loading={mutating === `status:${detail.document.id}`}
                        disabled={!mutationAvailable}
                        onClick={() => void transitionDocument("ready")}
                      >
                        {copy.markReady}
                      </Button>
                    ) : null}
                    {detail.document.status === "ready" ? (
                      <>
                        <Button
                          loading={mutating === `status:${detail.document.id}`}
                          disabled={!mutationAvailable}
                          onClick={() => void transitionDocument("draft")}
                        >
                          {copy.returnDraft}
                        </Button>
                        <Button
                          type="primary"
                          icon={<CheckCircleOutlined />}
                          loading={mutating === `status:${detail.document.id}`}
                          disabled={!mutationAvailable}
                          onClick={() => void transitionDocument("approved")}
                        >
                          {copy.approveDocument}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </header>

                <div className="continuity-document-detail__facts">
                  <span>
                    {copy.documentVersion}: <strong>v{detail.document.currentVersion}</strong>
                  </span>
                  <span>
                    {copy.documentHash}: <code>{detail.currentVersion.contentHash}</code>
                  </span>
                  <span>
                    {copy.revision}: <strong>{detail.document.revision}</strong>
                  </span>
                </div>

                <section className="continuity-document-content">
                  <strong>{copy.currentContent}</strong>
                  <pre>{detail.currentContent.contentMarkdown}</pre>
                </section>

                <section className="continuity-document-history">
                  <strong>{copy.documentHistory}</strong>
                  <ol>
                    {detail.versions.map((version) => (
                      <li key={version.id}>
                        <span>v{version.version}</span>
                        <span>{version.changeSummary}</span>
                        <code>{shortHash(version.contentHash)}</code>
                      </li>
                    ))}
                  </ol>
                </section>
              </>
            ) : (
              <StateNotice
                kind="empty"
                title={copy.noDocumentSelected}
                description={copy.noDocumentsDescription}
                retryLabel={copy.refreshSnapshot}
              />
            )}
          </div>
        </div>
      )}

      <section className="continuity-document-binding">
        <header>
          <div>
            <LinkOutlined aria-hidden="true" />
            <strong>{copy.taskDocumentBinding}</strong>
          </div>
          {selectedTask ? (
            <PlanningStatus locale={locale} projection={selectedTask} compact />
          ) : null}
        </header>
        {bindableTasks.length > 0 ? (
          <Form form={bindForm} layout="vertical" onFinish={submitBinding}>
            <div className="continuity-document-binding__fields">
              <Form.Item name="taskId" label={copy.selectTask} rules={[{ required: true }]}>
                <Select
                  options={bindableTasks.map(({ task }) => ({
                    label: `${task.title} · ${task.executionPolicy}`,
                    value: task.id
                  }))}
                />
              </Form.Item>
              <Form.Item name="specId" label={copy.selectSpec}>
                <Select
                  allowClear
                  placeholder={copy.clearBinding}
                  options={specOptions}
                />
              </Form.Item>
              <Form.Item name="planId" label={copy.selectPlan}>
                <Select
                  allowClear
                  placeholder={copy.clearBinding}
                  options={planOptions}
                />
              </Form.Item>
            </div>
            <Button
              htmlType="submit"
              type="primary"
              icon={<LinkOutlined />}
              loading={Boolean(selectedTask && mutating === `bind:${selectedTask.task.id}`)}
              disabled={!mutationAvailable}
            >
              {copy.saveBinding}
            </Button>
          </Form>
        ) : (
          <span>{copy.noTasksDescription}</span>
        )}
      </section>

      <Modal
        open={createOpen}
        title={copy.createDocumentTitle}
        okText={copy.createDocument}
        cancelText={copy.cancelHandoff}
        confirmLoading={mutating === "create"}
        okButtonProps={{ disabled: !mutationAvailable }}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void createForm.submit()}
        destroyOnHidden
        width={760}
      >
        <Form form={createForm} layout="vertical" onFinish={submitCreate}>
          <Form.Item name="kind" label={copy.documentKind} rules={[{ required: true }]}>
            <Select
              options={[
                { label: copy.spec, value: "spec" },
                { label: copy.plan, value: "plan" }
              ]}
            />
          </Form.Item>
          <Form.Item name="title" label={copy.documentTitle} rules={[{ required: true }]}>
            <Input maxLength={240} />
          </Form.Item>
          <Form.Item name="contentMarkdown" label={copy.contentMarkdown} rules={[{ required: true }]}>
            <Input.TextArea
              className="continuity-markdown-editor"
              rows={16}
              maxLength={250_000}
              showCount
            />
          </Form.Item>
          <Form.Item name="changeSummary" label={copy.changeSummary}>
            <Input maxLength={4_000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={versionOpen}
        title={copy.appendVersionTitle}
        okText={copy.appendVersion}
        cancelText={copy.cancelHandoff}
        confirmLoading={Boolean(detail && mutating === `version:${detail.document.id}`)}
        okButtonProps={{ disabled: !mutationAvailable }}
        onCancel={() => setVersionOpen(false)}
        onOk={() => void versionForm.submit()}
        destroyOnHidden
        width={820}
      >
        <Form form={versionForm} layout="vertical" onFinish={submitVersion}>
          <Form.Item name="contentMarkdown" label={copy.contentMarkdown} rules={[{ required: true }]}>
            <Input.TextArea
              className="continuity-markdown-editor"
              rows={18}
              maxLength={250_000}
              showCount
            />
          </Form.Item>
          <Form.Item name="changeSummary" label={copy.changeSummary}>
            <Input maxLength={4_000} />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

function PlanningStatus({
  locale,
  projection,
  compact = false
}: {
  locale: LocaleCode;
  projection: ContinuityWorkspaceTaskProjection;
  compact?: boolean;
}) {
  const copy = getUiCopy(locale).continuity;
  const assessment = projection.executionPolicy;
  return (
    <div
      className={`continuity-planning-status ${assessment.allowed ? "is-ready" : "is-blocked"}${
        compact ? " is-compact" : ""
      }`}
    >
      <strong>{assessment.allowed ? copy.planningReady : copy.planningBlocked}</strong>
      <Tag>{
        assessment.policy === "planning-required"
          ? copy.planningRequired
          : copy.planningOptional
      }</Tag>
      {!compact ? (
        <div className="continuity-planning-status__requirements">
          <PlanningRequirement
            label={copy.spec}
            state={assessment.spec.state}
            pinnedVersion={assessment.spec.pinnedVersion}
            currentVersion={assessment.spec.currentVersion}
            locale={locale}
          />
          <PlanningRequirement
            label={copy.plan}
            state={assessment.plan.state}
            pinnedVersion={assessment.plan.pinnedVersion}
            currentVersion={assessment.plan.currentVersion}
            locale={locale}
          />
        </div>
      ) : null}
      {!compact && assessment.blockers.length > 0 ? (
        <div className="continuity-planning-status__blockers">
          <span>{copy.planningBlockers}</span>
          {assessment.blockers.map((blocker) => (
            <code key={blocker}>{blocker}</code>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PlanningRequirement({
  locale,
  label,
  state,
  pinnedVersion,
  currentVersion
}: {
  locale: LocaleCode;
  label: string;
  state: ContinuityPlanningRequirementState;
  pinnedVersion: number | null;
  currentVersion: number | null;
}) {
  const copy = getUiCopy(locale).continuity;
  const stateLabel: Record<ContinuityPlanningRequirementState, string> = {
    "not-bound": copy.planningStateNotBound,
    "relation-invalid": copy.planningStateRelationInvalid,
    unapproved: copy.planningStateUnapproved,
    stale: copy.planningStateStale,
    "approved-current": copy.planningStateApprovedCurrent
  };
  return (
    <span>
      <strong>{label}</strong>
      <Tag color={state === "approved-current" ? "success" : state === "stale" ? "warning" : "default"}>
        {stateLabel[state]}
      </Tag>
      <code>
        {pinnedVersion === null ? "—" : `v${pinnedVersion}`}
        {currentVersion !== null && currentVersion !== pinnedVersion
          ? ` → v${currentVersion}`
          : ""}
      </code>
    </span>
  );
}

export { PlanningStatus };

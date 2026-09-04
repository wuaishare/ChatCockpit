import { App as AntApp, Button, Form, Input, Modal, Select } from "antd";
import { ImportOutlined, SwapOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";

import {
  acceptContinuityHandoff,
  cancelContinuityHandoff,
  completeContinuityTask,
  forkContinuityHandoff,
  prepareContinuityHandoff,
  submitContinuityTaskReview
} from "../../api";
import { getUiCopy, type LocaleCode } from "../../i18n";
import type {
  ApiProblem,
  ContinuityHandoffRecord,
  ContinuitySectionKey,
  ContinuitySessionMode,
  ContinuitySessionRecord,
  ContinuityWorkspaceSnapshot,
  ContinuityWorkspaceTaskProjection,
  ProductActionsResponse
} from "../../types";
import { CodexThreadImportDrawer } from "./CodexThreadImportDrawer";
import { DevelopmentDocumentsSection } from "./DevelopmentDocumentsSection";
import { RuntimeRecoverySection } from "./RuntimeRecoverySection";
import {
  ApprovalsSection,
  EvidenceSection,
  GitSummary,
  HandoffsSection,
  SessionsSection,
  TasksSection,
  WriterBanner
} from "./WorkspaceContinuitySections";

interface WorkspaceContinuityPanelProps {
  locale: LocaleCode;
  token: string | null;
  snapshot: ContinuityWorkspaceSnapshot;
  productActions: ProductActionsResponse | null;
  productActionsError: string | null;
  activeSection: ContinuitySectionKey;
  onRefresh: () => Promise<void> | void;
  onSectionChange: (section: ContinuitySectionKey) => void;
}

interface PrepareHandoffFormValues {
  taskId: string;
  sessionId: string;
  toMode: ContinuitySessionMode | "unassigned";
  goal: string;
  completedItems: string;
  pendingItems: string;
  risks: string;
  nextAction: string;
}

interface ForkHandoffFormValues {
  title: string;
  sessionTitle: string;
  mode: ContinuitySessionMode;
}

function idempotencyKey(operation: string): string {
  return `${operation}.web:${crypto.randomUUID()}`;
}

function lines(value: string | undefined): string[] {
  return (value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function problemMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as ApiProblem).message || fallback);
  }
  return fallback;
}

function activeSessions(
  task: ContinuityWorkspaceTaskProjection,
  snapshot: ContinuityWorkspaceSnapshot
): ContinuitySessionRecord[] {
  return task.sessions.filter((session) => {
    if (["completed", "failed"].includes(session.status)) return false;
    return !snapshot.activeLease || snapshot.activeLease.sessionId === session.id;
  });
}

export function WorkspaceContinuityPanel({
  locale,
  token,
  snapshot,
  productActions,
  productActionsError,
  activeSection,
  onRefresh,
  onSectionChange
}: WorkspaceContinuityPanelProps) {
  const copy = getUiCopy(locale).continuity;
  const { message } = AntApp.useApp();
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [codexImportOpen, setCodexImportOpen] = useState(false);
  const [forkHandoff, setForkHandoff] = useState<ContinuityHandoffRecord | null>(null);
  const [mutating, setMutating] = useState<string | null>(null);
  const [prepareForm] = Form.useForm<PrepareHandoffFormValues>();
  const [forkForm] = Form.useForm<ForkHandoffFormValues>();
  const selectedPrepareTaskId = Form.useWatch("taskId", prepareForm);

  const eligibleTasks = useMemo(
    () =>
      snapshot.tasks.filter(
        (task) =>
          task.latestHandoff?.status !== "ready" &&
          activeSessions(task, snapshot).length > 0
      ),
    [snapshot]
  );
  const selectedPrepareTask =
    eligibleTasks.find(({ task }) => task.id === selectedPrepareTaskId) ??
    eligibleTasks[0] ??
    null;

  function openPrepare(): void {
    const candidate = eligibleTasks[0];
    const session = candidate ? activeSessions(candidate, snapshot)[0] : null;
    if (!candidate || !session) return;
    prepareForm.setFieldsValue({
      taskId: candidate.task.id,
      sessionId: session.id,
      toMode: "unassigned",
      goal: candidate.task.goal,
      completedItems: candidate.latestHandoff?.completedItems.join("\n") ?? "",
      pendingItems: candidate.latestHandoff?.pendingItems.join("\n") ?? "",
      risks: candidate.latestHandoff?.risks.join("\n") ?? "",
      nextAction: candidate.latestHandoff?.nextAction ?? ""
    });
    setPrepareOpen(true);
  }

  async function submitPrepare(values: PrepareHandoffFormValues): Promise<void> {
    const projection = snapshot.tasks.find(({ task }) => task.id === values.taskId);
    if (!projection) return;
    setMutating("prepare");
    try {
      await prepareContinuityHandoff(
        {
          taskId: projection.task.id,
          sessionId: values.sessionId,
          toMode: values.toMode,
          goal: values.goal,
          completedItems: lines(values.completedItems),
          pendingItems: lines(values.pendingItems),
          changedFiles: snapshot.git.changedPaths,
          risks: lines(values.risks),
          nextAction: values.nextAction,
          gitHead: snapshot.git.headCommit,
          gitBranch: snapshot.git.branch,
          gitDirty: snapshot.git.dirty,
          evidenceBundleId: projection.evidence?.bundle.id ?? null,
          expectedTaskRevision: projection.task.revision,
          idempotencyKey: idempotencyKey("handoff.prepare")
        },
        token
      );
      setPrepareOpen(false);
      prepareForm.resetFields();
      await onRefresh();
      message.success(copy.operationComplete);
    } catch (error) {
      message.error(problemMessage(error, copy.operationFailed));
    } finally {
      setMutating(null);
    }
  }

  async function decide(
    action: "accept" | "cancel",
    handoff: ContinuityHandoffRecord
  ): Promise<void> {
    setMutating(`${action}:${handoff.id}`);
    try {
      const payload = {
        handoffId: handoff.id,
        expectedRevision: handoff.revision,
        idempotencyKey: idempotencyKey(`handoff.${action}`)
      };
      if (action === "accept") {
        await acceptContinuityHandoff(payload, token);
      } else {
        await cancelContinuityHandoff(payload, token);
      }
      await onRefresh();
      message.success(copy.operationComplete);
    } catch (error) {
      message.error(problemMessage(error, copy.operationFailed));
    } finally {
      setMutating(null);
    }
  }

  async function transitionTask(
    action: "review" | "complete",
    projection: ContinuityWorkspaceTaskProjection
  ): Promise<void> {
    const mutationKey = `${action}:${projection.task.id}`;
    setMutating(mutationKey);
    try {
      const payload = {
        taskId: projection.task.id,
        expectedRevision: projection.task.revision,
        idempotencyKey: idempotencyKey(`task.${action}`)
      };
      if (action === "review") {
        await submitContinuityTaskReview(payload, token);
      } else {
        await completeContinuityTask(payload, token);
      }
      await onRefresh();
      message.success(copy.operationComplete);
    } catch (error) {
      message.error(problemMessage(error, copy.operationFailed));
    } finally {
      setMutating(null);
    }
  }

  function openFork(handoff: ContinuityHandoffRecord): void {
    const source = snapshot.tasks.find(({ task }) => task.id === handoff.taskId);
    const mode = handoff.toMode === "unassigned" ? "chat-direct" : handoff.toMode;
    forkForm.setFieldsValue({
      title: source ? `${source.task.title} · Fork` : "Forked task",
      sessionTitle: `${copy.forkHandoff} · ${mode}`,
      mode
    });
    setForkHandoff(handoff);
  }

  async function submitFork(values: ForkHandoffFormValues): Promise<void> {
    if (!forkHandoff) return;
    setMutating(`fork:${forkHandoff.id}`);
    try {
      await forkContinuityHandoff(
        {
          handoffId: forkHandoff.id,
          expectedRevision: forkHandoff.revision,
          title: values.title,
          sessionTitle: values.sessionTitle,
          mode: values.mode,
          idempotencyKey: idempotencyKey("handoff.fork")
        },
        token
      );
      setForkHandoff(null);
      forkForm.resetFields();
      await onRefresh();
      message.success(copy.operationComplete);
    } catch (error) {
      message.error(problemMessage(error, copy.operationFailed));
    } finally {
      setMutating(null);
    }
  }

  return (
    <div className="continuity-runtime">
      <WriterBanner locale={locale} snapshot={snapshot} />
      <GitSummary locale={locale} snapshot={snapshot} />

      <div className="continuity-runtime__actions">
        <Button
          type="primary"
          icon={<SwapOutlined />}
          disabled={eligibleTasks.length === 0}
          onClick={openPrepare}
        >
          {copy.prepareHandoff}
        </Button>
        {activeSection === "sessions" ? (
          <Button
            icon={<ImportOutlined />}
            onClick={() => setCodexImportOpen(true)}
          >
            {copy.importCodexThread}
          </Button>
        ) : null}
        <Button onClick={() => void onRefresh()}>{copy.refreshSnapshot}</Button>
      </div>

      {activeSection === "documents" ? (
        <DevelopmentDocumentsSection
          locale={locale}
          token={token}
          snapshot={snapshot}
          onRefreshSnapshot={onRefresh}
        />
      ) : null}
      {activeSection === "tasks" ? (
        <TasksSection
          locale={locale}
          snapshot={snapshot}
          mutating={mutating}
          onSubmitReview={(projection) => void transitionTask("review", projection)}
          onComplete={(projection) => void transitionTask("complete", projection)}
        />
      ) : null}
      {activeSection === "sessions" ? (
        <SessionsSection locale={locale} snapshot={snapshot} />
      ) : null}
      {activeSection === "recovery" ? (
        <RuntimeRecoverySection
          locale={locale}
          token={token}
          snapshot={snapshot}
          productActions={productActions}
          productActionsError={productActionsError}
          onRefreshSnapshot={onRefresh}
        />
      ) : null}
      {activeSection === "handoffs" ? (
        <HandoffsSection
          locale={locale}
          snapshot={snapshot}
          mutating={mutating}
          onAccept={(handoff) => void decide("accept", handoff)}
          onCancel={(handoff) => void decide("cancel", handoff)}
          onFork={openFork}
        />
      ) : null}
      {activeSection === "evidence" ? (
        <EvidenceSection locale={locale} snapshot={snapshot} />
      ) : null}
      {activeSection === "approvals" ? (
        <ApprovalsSection locale={locale} snapshot={snapshot} />
      ) : null}

      <CodexThreadImportDrawer
        locale={locale}
        token={token}
        workspaceId={snapshot.workspace.id}
        workspaceLabel={`${snapshot.project.displayName} · ${snapshot.workspace.repoId}`}
        open={codexImportOpen}
        onClose={() => setCodexImportOpen(false)}
        onComplete={onRefresh}
        onOpenRecovery={() => onSectionChange("recovery")}
      />

      <Modal
        open={prepareOpen}
        title={copy.prepareHandoffTitle}
        okText={copy.submitHandoff}
        cancelText={copy.cancelHandoff}
        confirmLoading={mutating === "prepare"}
        onCancel={() => setPrepareOpen(false)}
        onOk={() => void prepareForm.submit()}
        destroyOnHidden
      >
        <Form form={prepareForm} layout="vertical" onFinish={submitPrepare}>
          <Form.Item name="taskId" label={copy.sourceTask} rules={[{ required: true }]}>
            <Select
              options={eligibleTasks.map(({ task }) => ({
                label: task.title,
                value: task.id
              }))}
              onChange={(taskId) => {
                const projection = eligibleTasks.find(({ task }) => task.id === taskId);
                const session = projection ? activeSessions(projection, snapshot)[0] : null;
                prepareForm.setFieldValue("sessionId", session?.id);
              }}
            />
          </Form.Item>
          <Form.Item name="sessionId" label={copy.sourceSession} rules={[{ required: true }]}>
            <Select
              options={(selectedPrepareTask
                ? activeSessions(selectedPrepareTask, snapshot)
                : []
              ).map((session) => ({
                label: `${session.title} · ${session.mode}`,
                value: session.id
              }))}
            />
          </Form.Item>
          <Form.Item name="toMode" label={copy.targetMode} rules={[{ required: true }]}>
            <Select
              options={[
                "unassigned",
                "chat-direct",
                "codex-session",
                "async-agent"
              ].map((value) => ({ label: value, value }))}
            />
          </Form.Item>
          <Form.Item name="goal" label={copy.goal} rules={[{ required: true }]}>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
          </Form.Item>
          <Form.Item name="completedItems" label={copy.completedItems} extra={copy.onePerLine}>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
          <Form.Item name="pendingItems" label={copy.pendingItems} extra={copy.onePerLine}>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
          <Form.Item name="risks" label={copy.risks} extra={copy.onePerLine}>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
          </Form.Item>
          <Form.Item name="nextAction" label={copy.nextAction} rules={[{ required: true }]}>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(forkHandoff)}
        title={copy.forkHandoffTitle}
        okText={copy.forkHandoff}
        cancelText={copy.cancelHandoff}
        confirmLoading={Boolean(forkHandoff && mutating === `fork:${forkHandoff.id}`)}
        onCancel={() => setForkHandoff(null)}
        onOk={() => void forkForm.submit()}
        destroyOnHidden
      >
        <Form form={forkForm} layout="vertical" onFinish={submitFork}>
          <Form.Item name="title" label={copy.childTaskTitle} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="sessionTitle" label={copy.childSessionTitle} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="mode" label={copy.targetMode} rules={[{ required: true }]}>
            <Select
              options={["chat-direct", "codex-session", "async-agent"].map((value) => ({
                label: value,
                value
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

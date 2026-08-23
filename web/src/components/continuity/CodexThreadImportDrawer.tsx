import {
  Alert,
  App as AntApp,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Space,
  Tag
} from "antd";
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  SafetyCertificateOutlined
} from "@ant-design/icons";
import { useState } from "react";
import { UiText as Text } from "../UiText";

import {
  assessCodexThreadImport,
  executeCodexThreadImport,
  fetchCodexRuntimeAccountStatus,
  fetchCodexRuntimeThread,
  resumeNativeCodexThread
} from "../../api";
import { getUiCopy, type LocaleCode } from "../../i18n";
import type {
  ApiProblem,
  CodexRuntimeAccountStatusResponse,
  CodexRuntimeThreadProjection,
  CodexThreadImportAssessmentResponse,
  CodexThreadImportExecutionResponse
} from "../../types";

interface CodexThreadImportDrawerProps {
  locale: LocaleCode;
  token: string | null;
  workspaceId: string;
  workspaceLabel: string;
  open: boolean;
  onClose: () => void;
  onComplete: () => Promise<void> | void;
  onOpenRecovery: () => void;
}

interface ThreadReferenceFormValues {
  threadRef: string;
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

function problemCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof (error as ApiProblem).code === "string" ? (error as ApiProblem).code! : null;
}

function normalizeThreadReference(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("codex://")) {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol !== "codex:" ||
      parsed.hostname !== "threads" ||
      parsed.search ||
      parsed.hash ||
      !parsed.pathname.startsWith("/")
    ) {
      throw new Error("Invalid codex://threads/<thread-id> reference");
    }
    return decodeURIComponent(parsed.pathname.slice(1));
  }
  if (trimmed.includes("://")) {
    throw new Error("Only codex:// thread references or raw Thread IDs are supported");
  }
  if (!trimmed) throw new Error("Codex Thread ID is required");
  return trimmed;
}

export function CodexThreadImportDrawer({
  locale,
  token,
  workspaceId,
  workspaceLabel,
  open,
  onClose,
  onComplete,
  onOpenRecovery
}: CodexThreadImportDrawerProps) {
  const copy = getUiCopy(locale).continuity;
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<ThreadReferenceFormValues>();
  const [thread, setThread] = useState<CodexRuntimeThreadProjection | null>(null);
  const [account, setAccount] = useState<CodexRuntimeAccountStatusResponse["account"] | null>(
    null
  );
  const [assessment, setAssessment] =
    useState<CodexThreadImportAssessmentResponse | null>(null);
  const [execution, setExecution] =
    useState<CodexThreadImportExecutionResponse | null>(null);
  const [nativeResumed, setNativeResumed] = useState(false);
  const [nativeWriterBusy, setNativeWriterBusy] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [preparingTransfer, setPreparingTransfer] = useState(false);
  const [executing, setExecuting] = useState(false);

  function reset(): void {
    form.resetFields();
    setThread(null);
    setAccount(null);
    setAssessment(null);
    setExecution(null);
    setNativeResumed(false);
    setNativeWriterBusy(false);
    setInspecting(false);
    setResuming(false);
    setPreparingTransfer(false);
    setExecuting(false);
  }

  function close(): void {
    reset();
    onClose();
  }

  async function inspect(values: ThreadReferenceFormValues): Promise<void> {
    setInspecting(true);
    setThread(null);
    setAccount(null);
    setAssessment(null);
    setExecution(null);
    setNativeResumed(false);
    setNativeWriterBusy(false);
    try {
      const threadId = normalizeThreadReference(values.threadRef);
      const [threadResponse, accountResponse] = await Promise.all([
        fetchCodexRuntimeThread(threadId, token),
        fetchCodexRuntimeAccountStatus(token)
      ]);
      if (threadResponse.thread.workspaceId !== workspaceId) {
        throw new Error("The Codex Thread does not belong to the selected ChatCockpit workspace");
      }
      setThread(threadResponse.thread);
      setAccount(accountResponse.account);
    } catch (error) {
      message.error(problemMessage(error, copy.operationFailed));
    } finally {
      setInspecting(false);
    }
  }

  async function resumeNative(): Promise<void> {
    if (!thread) return;
    setResuming(true);
    setNativeWriterBusy(false);
    try {
      const response = await resumeNativeCodexThread(
        {
          workspaceId,
          threadId: thread.id,
          idempotencyKey: idempotencyKey("codex-native.thread.resume")
        },
        token
      );
      setThread(response.thread);
      setNativeResumed(true);
      await onComplete();
      message.success(copy.nativeResumeComplete);
    } catch (error) {
      if (problemCode(error) === "CODEX_THREAD_ACTIVE_WRITER") {
        setNativeWriterBusy(true);
        message.warning(copy.nativeWriterBusyTitle);
      } else {
        message.error(problemMessage(error, copy.operationFailed));
      }
    } finally {
      setResuming(false);
    }
  }

  async function prepareTransfer(): Promise<void> {
    if (!thread) return;
    setPreparingTransfer(true);
    setAssessment(null);
    try {
      const response = await assessCodexThreadImport(
        workspaceId,
        {
          threadRef: thread.id,
          idempotencyKey: idempotencyKey("codex-thread-transfer.assess")
        },
        token
      );
      setAssessment(response);
    } catch (error) {
      message.error(problemMessage(error, copy.operationFailed));
    } finally {
      setPreparingTransfer(false);
    }
  }

  async function executeTransfer(): Promise<void> {
    if (!assessment) return;
    setExecuting(true);
    try {
      const response = await executeCodexThreadImport(
        assessment.import.id,
        {
          assessmentHash: assessment.assessmentHash,
          expectedRevision: assessment.import.revision,
          action: "handoff-to-chat-direct",
          idempotencyKey: idempotencyKey("codex-thread-transfer.execute")
        },
        token
      );
      setExecution(response);
      await onComplete();
      message.success(copy.importComplete);
    } catch (error) {
      message.error(problemMessage(error, copy.operationFailed));
    } finally {
      setExecuting(false);
    }
  }

  function openRecovery(): void {
    close();
    onOpenRecovery();
  }

  const previewMessages = execution?.context.messages.slice(0, 6) ?? [];
  const quotaState = !account || account.rateLimits.length === 0
    ? "unknown"
    : account.limited
      ? "limited"
      : "available";
  const quotaLimited = quotaState === "limited";
  const transferPreferred = quotaLimited || nativeWriterBusy;

  return (
    <Drawer
      open={open}
      title={copy.importCodexThreadTitle}
      width={560}
      className="codex-thread-import-drawer"
      onClose={close}
      destroyOnHidden
    >
      <div className="codex-thread-import">
        <Text as="p" type="secondary" className="codex-thread-import__description">
          {copy.importCodexThreadDescription}
        </Text>

        {!thread && !execution ? (
          <Form form={form} layout="vertical" onFinish={inspect}>
            <Form.Item
              name="threadRef"
              label={copy.threadReference}
              rules={[
                { required: true, message: copy.threadReferencePlaceholder },
                { max: 512 }
              ]}
            >
              <Input
                autoComplete="off"
                spellCheck={false}
                placeholder={copy.threadReferencePlaceholder}
                prefix={<CodeOutlined aria-hidden="true" />}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={inspecting}>
              {copy.assessThread}
            </Button>
          </Form>
        ) : null}

        {thread && !execution ? (
          <div className="codex-thread-import__assessment">
            <Alert type="success" showIcon message={copy.assessmentReady} />
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label={copy.threadReference}>
                <code>{thread.id}</code>
              </Descriptions.Item>
              <Descriptions.Item label={copy.threadSource}>
                {thread.sourceKind || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={copy.threadProvider}>
                {thread.modelProvider || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={copy.threadStatus}>
                <Tag>{thread.status.type}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={copy.threadWorkspace}>
                <code>{workspaceLabel}</code>
              </Descriptions.Item>
              <Descriptions.Item label="Codex quota">
                <Tag color={quotaState === "limited" ? "warning" : quotaState === "available" ? "success" : "default"}>
                  {quotaState}
                </Tag>
              </Descriptions.Item>
            </Descriptions>

            {nativeResumed ? (
              <Alert type="success" showIcon message={copy.nativeResumeComplete} />
            ) : null}

            {nativeWriterBusy ? (
              <Alert
                type="warning"
                showIcon
                message={copy.nativeWriterBusyTitle}
                description={copy.nativeWriterBusyDescription}
              />
            ) : null}

            <section className="codex-thread-import__codex-option">
              <strong>{copy.resumeNativeCodex}</strong>
              <Text as="p" type="secondary">
                {copy.continueWithCodexDescription}
              </Text>
              <Alert
                type={quotaState === "limited" ? "warning" : quotaState === "available" ? "success" : "info"}
                showIcon
                message={
                  quotaState === "limited"
                    ? copy.noCodexQuotaNotice
                    : quotaState === "available"
                      ? copy.codexQuotaAvailableNotice
                      : copy.codexQuotaUnknownNotice
                }
              />
              <Button
                type={transferPreferred ? "default" : "primary"}
                loading={resuming}
                disabled={nativeResumed}
                onClick={() => void resumeNative()}
              >
                {copy.resumeNativeCodex}
              </Button>
            </section>

            <section className="codex-thread-import__handoff-card">
              <div className="codex-thread-import__handoff-heading">
                <SafetyCertificateOutlined aria-hidden="true" />
                <strong>{copy.handoffToChatGpt}</strong>
              </div>
              <Text as="p" type="secondary">
                {copy.handoffToChatGptDescription}
              </Text>
              {!assessment ? (
                <Button
                  type={transferPreferred ? "primary" : "default"}
                  icon={<ArrowRightOutlined />}
                  loading={preparingTransfer}
                  onClick={() => void prepareTransfer()}
                >
                  {copy.executeChatDirectHandoff}
                </Button>
              ) : (
                <Space direction="vertical" size="small">
                  <Text type="secondary">
                    {copy.assessmentExpires}:{" "}
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeStyle: "medium"
                    }).format(new Date(assessment.expiresAt))}
                  </Text>
                  <Button
                    type="primary"
                    icon={<ArrowRightOutlined />}
                    loading={executing}
                    onClick={() => void executeTransfer()}
                  >
                    {copy.executeChatDirectHandoff}
                  </Button>
                </Space>
              )}
            </section>

            <section className="codex-thread-import__codex-option">
              <strong>{copy.continueWithCodex}</strong>
              <Text as="p" type="secondary">
                {copy.continueWithCodexDescription}
              </Text>
              <Button onClick={openRecovery}>{copy.sections.recovery.label}</Button>
            </section>
          </div>
        ) : null}

        {execution ? (
          <div className="codex-thread-import__complete">
            <Alert
              type="success"
              showIcon
              icon={<CheckCircleOutlined />}
              message={copy.importComplete}
              description={
                <span>
                  {copy.continuationSession}: <code>{execution.continuationSession.id}</code>
                </span>
              }
            />

            <section className="codex-thread-import__context">
              <div className="codex-thread-import__context-heading">
                <strong>{copy.contextPreview}</strong>
                <Tag color={execution.context.truncated ? "warning" : "success"}>
                  {execution.context.truncated ? copy.contextTruncated : copy.contextComplete}
                </Tag>
              </div>
              {previewMessages.map((entry) => (
                <article
                  key={entry.id}
                  className={`codex-thread-import__message is-${entry.role}`}
                >
                  <span>{entry.role === "user" ? "User" : "Assistant"}</span>
                  <p>{entry.text}</p>
                </article>
              ))}
            </section>

            <Space wrap>
              <Button type="primary" onClick={close}>
                {copy.sections.sessions.label}
              </Button>
              <Button onClick={openRecovery}>{copy.continueWithCodex}</Button>
            </Space>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

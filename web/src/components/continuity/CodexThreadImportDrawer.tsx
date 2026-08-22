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
import { Text } from "@lobehub/ui";
import { useState } from "react";

import {
  assessCodexThreadImport,
  executeCodexThreadImport
} from "../../api";
import { getUiCopy, type LocaleCode } from "../../i18n";
import type {
  ApiProblem,
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
  const [assessment, setAssessment] =
    useState<CodexThreadImportAssessmentResponse | null>(null);
  const [execution, setExecution] =
    useState<CodexThreadImportExecutionResponse | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [executing, setExecuting] = useState(false);

  function reset(): void {
    form.resetFields();
    setAssessment(null);
    setExecution(null);
    setAssessing(false);
    setExecuting(false);
  }

  function close(): void {
    reset();
    onClose();
  }

  async function assess(values: ThreadReferenceFormValues): Promise<void> {
    setAssessing(true);
    setAssessment(null);
    setExecution(null);
    try {
      const response = await assessCodexThreadImport(
        workspaceId,
        {
          threadRef: values.threadRef.trim(),
          idempotencyKey: idempotencyKey("codex-thread-import.assess")
        },
        token
      );
      setAssessment(response);
    } catch (error) {
      message.error(problemMessage(error, copy.operationFailed));
    } finally {
      setAssessing(false);
    }
  }

  async function execute(): Promise<void> {
    if (!assessment) return;
    setExecuting(true);
    try {
      const response = await executeCodexThreadImport(
        assessment.import.id,
        {
          assessmentHash: assessment.assessmentHash,
          expectedRevision: assessment.import.revision,
          action: "handoff-to-chat-direct",
          idempotencyKey: idempotencyKey("codex-thread-import.execute")
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

        {!execution ? (
          <Form form={form} layout="vertical" onFinish={assess}>
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
            <Button
              type="primary"
              htmlType="submit"
              loading={assessing}
              disabled={executing}
            >
              {copy.assessThread}
            </Button>
          </Form>
        ) : null}

        {assessment && !execution ? (
          <div className="codex-thread-import__assessment">
            <Alert
              type="success"
              showIcon
              message={copy.assessmentReady}
            />
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label={copy.threadReference}>
                <code>{assessment.thread.id}</code>
              </Descriptions.Item>
              <Descriptions.Item label={copy.threadSource}>
                {assessment.thread.sourceKind || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={copy.threadProvider}>
                {assessment.thread.modelProvider || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={copy.threadStatus}>
                <Tag>{assessment.thread.status.type}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={copy.threadWorkspace}>
                <code>{workspaceLabel}</code>
              </Descriptions.Item>
              <Descriptions.Item label={copy.assessmentExpires}>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "medium"
                }).format(new Date(assessment.expiresAt))}
              </Descriptions.Item>
            </Descriptions>

            <section className="codex-thread-import__handoff-card">
              <div className="codex-thread-import__handoff-heading">
                <SafetyCertificateOutlined aria-hidden="true" />
                <strong>{copy.handoffToChatGpt}</strong>
              </div>
              <Text as="p" type="secondary">
                {copy.handoffToChatGptDescription}
              </Text>
              <Alert
                type="info"
                showIcon
                message={copy.noCodexQuotaNotice}
              />
              <Button
                type="primary"
                icon={<ArrowRightOutlined />}
                loading={executing}
                onClick={() => void execute()}
              >
                {copy.executeChatDirectHandoff}
              </Button>
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
                <Tag color={execution.context.truncated ? "gold" : "green"}>
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

import { Alert, Button, Descriptions, Empty, Modal, Space, Spin, Tag } from "antd";
import { SafetyCertificateOutlined, WarningOutlined } from "@ant-design/icons";
import { UiText as Text } from "../UiText";

import type { ResourceCenterCopy } from "../../i18n/resources";
import type { OperationalStatusTone } from "../../status-language";
import type {
  RuntimeResourceMutationActivityResponse,
  RuntimeResourceMutationApproval,
  RuntimeResourceMutationApprovalStatus,
  RuntimeResourceMutationExecution,
  RuntimeResourceMutationOperation,
  RuntimeResourceMutationVerificationStatus
} from "../../types";
import {
  isDestructiveMutation,
  mutationApprovalState
} from "./resource-mutation-model";

interface ResourceMutationReviewModalProps {
  locale: string;
  copy: ResourceCenterCopy;
  open: boolean;
  approval: RuntimeResourceMutationApproval | null;
  execution: RuntimeResourceMutationExecution | null;
  busy: boolean;
  error: string | null;
  onApproveAndExecute: () => void;
  onDeny: () => void;
  onCancel: () => void;
}

interface ResourceMutationActivityProps {
  locale: string;
  copy: ResourceCenterCopy;
  activity: RuntimeResourceMutationActivityResponse | null;
  loading: boolean;
  onReviewApproval: (approval: RuntimeResourceMutationApproval) => void;
}

function operationLabel(
  operation: RuntimeResourceMutationOperation,
  copy: ResourceCenterCopy
): string {
  if (operation === "skill.enable") return copy.skillEnable;
  if (operation === "skill.disable") return copy.skillDisable;
  if (operation === "plugin.install") return copy.pluginInstall;
  return copy.pluginUninstall;
}

function approvalStatusLabel(
  status: RuntimeResourceMutationApprovalStatus,
  copy: ResourceCenterCopy
): string {
  if (status === "pending") return copy.pendingApproval;
  if (status === "approved") return copy.approvedMutation;
  if (status === "denied") return copy.deniedMutation;
  if (status === "expired") return copy.expiredMutation;
  if (status === "consumed") return copy.consumedMutation;
  return copy.mutationTargetChanged;
}

function executionStatusLabel(
  status: RuntimeResourceMutationVerificationStatus,
  copy: ResourceCenterCopy
): string {
  if (status === "executing") return copy.executingMutation;
  if (status === "verified") return copy.verifiedMutation;
  if (status === "failed-external") return copy.externalMutationFailed;
  if (status === "failed-verification") return copy.mutationVerificationFailed;
  return copy.mutationTargetChanged;
}

function statusTone(
  status: RuntimeResourceMutationApprovalStatus | RuntimeResourceMutationVerificationStatus
): OperationalStatusTone {
  if (status === "verified") return "success";
  if (status === "pending" || status === "approved" || status === "executing") {
    return "processing";
  }
  if (status === "expired" || status === "stale") return "warning";
  if (status === "denied" || status === "failed-external" || status === "failed-verification") {
    return "error";
  }
  return "default";
}

function booleanLabel(value: boolean | null, copy: ResourceCenterCopy): string {
  if (value === null) return copy.unknown;
  return value ? copy.yes : copy.no;
}

export function ResourceMutationReviewModal({
  locale,
  copy,
  open,
  approval,
  execution,
  busy,
  error,
  onApproveAndExecute,
  onDeny,
  onCancel
}: ResourceMutationReviewModalProps) {
  if (!approval) return null;

  const state = mutationApprovalState(approval);
  const canDecide = approval.status === "pending" && !execution;
  const destructive = isDestructiveMutation(approval.operation);
  const displayName =
    typeof approval.publicSummary.displayName === "string"
      ? approval.publicSummary.displayName
      : approval.resourceId;

  return (
    <Modal
      title={copy.reviewChangeTitle}
      open={open}
      width={620}
      rootClassName="resource-center__mutation-modal"
      closable={!busy}
      keyboard={!busy}
      maskClosable={!busy}
      onCancel={onCancel}
      footer={
        canDecide
          ? [
              <Button key="cancel" disabled={busy} onClick={onCancel}>
                {copy.cancelChange}
              </Button>,
              <Button key="deny" danger disabled={busy} onClick={onDeny}>
                {copy.denyChange}
              </Button>,
              <Button
                key="approve"
                type="primary"
                danger={destructive}
                loading={busy}
                onClick={onApproveAndExecute}
              >
                {copy.approveAndExecute}
              </Button>
            ]
          : [
              <Button key="close" disabled={busy} onClick={onCancel}>
                {copy.cancelChange}
              </Button>
            ]
      }
      destroyOnHidden
    >
      <div className="resource-center__mutation-review">
        <div className="resource-center__mutation-review-heading">
          <div>
            <Text as="div" strong className="resource-center__mutation-review-name">
              {displayName}
            </Text>
            <Text as="div" type="secondary">
              {operationLabel(approval.operation, copy)}
            </Text>
          </div>
          <Tag color={statusTone(execution?.verificationStatus ?? approval.status)}>
            {execution
              ? executionStatusLabel(execution.verificationStatus, copy)
              : approvalStatusLabel(approval.status, copy)}
          </Tag>
        </div>

        {destructive ? (
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message={copy.pluginUninstall}
            description={copy.authoritativeRefreshRequired}
          />
        ) : (
          <Alert
            type="info"
            showIcon
            icon={<SafetyCertificateOutlined />}
            message={copy.authoritativeRefreshRequired}
          />
        )}

        {error ? <Alert type="error" showIcon message={copy.mutationFailedTitle} description={error} /> : null}

        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label={copy.beforeState}>
            {booleanLabel(state.before, copy)}
          </Descriptions.Item>
          <Descriptions.Item label={copy.requestedState}>
            {booleanLabel(state.requested, copy)}
          </Descriptions.Item>
          <Descriptions.Item label={copy.scope}>{approval.resourceScope}</Descriptions.Item>
          <Descriptions.Item label={copy.protocol}>{approval.runtimeProfileId}</Descriptions.Item>
          <Descriptions.Item label={copy.approvalExpires}>
            {new Date(approval.expiresAt).toLocaleString(locale)}
          </Descriptions.Item>
        </Descriptions>
      </div>
    </Modal>
  );
}

export function ResourceMutationActivity({
  locale,
  copy,
  activity,
  loading,
  onReviewApproval
}: ResourceMutationActivityProps) {
  const approvalsById = new Map(
    (activity?.approvals ?? []).map((approval) => [approval.id, approval] as const)
  );
  const entries = [
    ...(activity?.approvals ?? []).map((approval) => ({
      key: `approval:${approval.id}`,
      type: "approval" as const,
      operation: approval.operation,
      resourceId: approval.resourceId,
      displayName:
        typeof approval.publicSummary.displayName === "string"
          ? approval.publicSummary.displayName
          : approval.resourceId,
      status: approval.status,
      actor: approval.decidedActor?.type ?? approval.requestedActor?.type ?? null,
      timestamp: approval.updatedAt,
      approval
    })),
    ...(activity?.executions ?? []).map((execution) => {
      const approval = approvalsById.get(execution.approvalId);
      return {
        key: `execution:${execution.id}`,
        type: "execution" as const,
        operation: execution.operation,
        resourceId: execution.resourceId,
        displayName:
          approval && typeof approval.publicSummary.displayName === "string"
            ? approval.publicSummary.displayName
            : execution.resourceId,
        status: execution.verificationStatus,
        actor: execution.executedActor?.type ?? null,
        timestamp: execution.finishedAt ?? execution.startedAt,
        approval: null
      };
    })
  ]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 20);

  return (
    <section className="resource-center__mutation-activity panel" aria-labelledby="resource-mutation-activity-title">
      <div className="resource-center__section-header resource-center__mutation-activity-header">
        <div>
          <Text as="h2" id="resource-mutation-activity-title" className="resource-center__section-title">
            {copy.mutationActivity}
          </Text>
          <Text as="p" type="secondary" className="resource-center__section-description">
            {copy.authoritativeRefreshRequired}
          </Text>
        </div>
        {loading ? <Spin size="small" /> : null}
      </div>

      {!loading && entries.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={copy.none} />
      ) : (
        <ol className="resource-center__mutation-activity-list">
          {entries.map((entry) => (
            <li key={entry.key} className="resource-center__mutation-activity-item">
              <div className="resource-center__mutation-activity-main">
                <div className="resource-center__mutation-activity-title-row">
                  <Text as="span" strong>{entry.displayName}</Text>
                  <Tag color={statusTone(entry.status)}>
                    {entry.type === "approval"
                      ? approvalStatusLabel(entry.status as RuntimeResourceMutationApprovalStatus, copy)
                      : executionStatusLabel(
                          entry.status as RuntimeResourceMutationVerificationStatus,
                          copy
                        )}
                  </Tag>
                </div>
                <Text as="span" type="secondary">
                  {operationLabel(entry.operation, copy)}
                </Text>
              </div>
              <Space size={6} wrap className="resource-center__mutation-activity-meta">
                {entry.actor ? <Tag>{entry.actor}</Tag> : null}
                <time dateTime={entry.timestamp}>
                  {new Date(entry.timestamp).toLocaleString(locale)}
                </time>
                {entry.type === "approval" && entry.status === "pending" && entry.approval ? (
                  <Button type="link" size="small" onClick={() => onReviewApproval(entry.approval!)}>
                    {copy.reviewChangeTitle}
                  </Button>
                ) : null}
              </Space>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

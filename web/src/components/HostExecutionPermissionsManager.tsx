import { useEffect, useMemo, useState } from "react";

import {
  CheckOutlined,
  CloseOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ToolOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Divider,
  List,
  Modal,
  Radio,
  Space,
  Spin,
  Tag,
  Typography,
  message
} from "antd";

import {
  decideHostCommandApproval,
  fetchHostExecutionPermissions,
  fetchPendingHostCommandApprovals,
  updateHostExecutionPermissions,
  type HostCommandPendingApprovalSummary,
  type HostExecutionPermissionsResponse,
  type HostPermissionProfile
} from "../api";
import type { LocaleCode } from "../i18n";

interface HostExecutionPermissionsManagerProps {
  locale: LocaleCode;
  open: boolean;
}

const PROFILE_ORDER: HostPermissionProfile[] = [
  "restricted",
  "development",
  "device-maintenance",
  "full-host"
];

function copyFor(locale: LocaleCode) {
  if (locale === "zh-CN") {
    return {
      title: "执行权限",
      description:
        "控制 ChatCockpit 可以越出项目原生沙箱执行到什么程度。权限档位与单次主机命令审批是两条独立边界。",
      loading: "正在读取执行权限…",
      save: "保存权限档位",
      saved: "执行权限已更新",
      refresh: "刷新待审批",
      approvalTitle: "待审批的主机命令",
      approvalDescription:
        "远程 MCP 调用方不能批准自己的请求。只有已登录的 Operator 可以批准或拒绝，批准仍只对该条精确命令、参数、目录、执行器和超时生效。",
      noApprovals: "当前没有待审批的主机命令。",
      approve: "批准",
      deny: "拒绝",
      expires: "过期时间",
      fullWarning:
        "完整主机访问属于 danger-level 高风险模式。主机命令的实际影响可能超出所选 Host Root；Host Root 只约束工作目录与 Host 文件 API。直接 shell/脚本解释器入口仍被阻止，但启用后仍应视为可影响整台主机，并依赖每条精确人工审批与审计。",
      maintenanceNote:
        "设备维护档只增加只读诊断（如 df、du、diskutil list/info、system_profiler、vm_stat）。清理、删除等优化操作不会被这一档自动放开。",
      profiles: {
        restricted: {
          label: "受限",
          description: "仅保留项目原生沙箱与基础有界 Host 只读检查；禁用 host-managed 构建。"
        },
        development: {
          label: "开发（默认）",
          description: "项目开发 + 精确 allowlist 的 host-managed 构建；保持当前开发工作流。"
        },
        "device-maintenance": {
          label: "设备维护",
          description: "在开发档基础上增加有界、只读的磁盘/系统诊断能力。"
        },
        "full-host": {
          label: "完整主机访问",
          description: "高风险：主机命令可影响 Host Root 之外的系统资源；依赖显式启用、精确人工审批、审计与超时治理。"
        }
      }
    } as const;
  }
  return {
    title: "Execution permissions",
    description:
      "Controls how far ChatCockpit may execute beyond the native project sandbox. Permission scope and per-command Host approval remain separate boundaries.",
    loading: "Reading execution permissions…",
    save: "Save permission profile",
    saved: "Execution permissions updated",
    refresh: "Refresh approvals",
    approvalTitle: "Pending Host command approvals",
    approvalDescription:
      "Remote MCP callers cannot approve their own requests. Only a signed-in Operator can approve or deny, and approval remains bound to the exact command, arguments, working directory, executor and timeout.",
    noApprovals: "There are no pending Host command approvals.",
    approve: "Approve",
    deny: "Deny",
    expires: "Expires",
    fullWarning:
      "Full Host access is a danger-level mode. A Host command may affect system resources outside the selected Host Root; Host Roots only constrain the working directory and Host file APIs. Direct shell/script interpreter entry points remain blocked, but this profile should still be treated as capable of affecting the whole host and relies on exact human approval and audit for every command.",
    maintenanceNote:
      "Device maintenance only adds bounded read-only diagnostics such as df, du, diskutil list/info, system_profiler and vm_stat. Cleanup or deletion is not automatically enabled by this profile.",
    profiles: {
      restricted: {
        label: "Restricted",
        description: "Native project sandbox plus bounded basic Host reads; host-managed builds are disabled."
      },
      development: {
        label: "Development (default)",
        description: "Project development plus the exact host-managed build allowlist used by the normal development workflow."
      },
      "device-maintenance": {
        label: "Device maintenance",
        description: "Development permissions plus bounded read-only disk and system diagnostics."
      },
      "full-host": {
        label: "Full Host access",
        description: "High risk: Host commands may affect system resources outside Host Roots and rely on explicit enablement, exact human approval, audit and timeout governance."
      }
    }
  } as const;
}

function problemMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === "object" && "message" in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return String(cause);
}

function exactCommandDisplay(approval: HostCommandPendingApprovalSummary): string {
  return [approval.command, ...approval.args.map((arg) => JSON.stringify(arg))].join(" ");
}

export function HostExecutionPermissionsManager({
  locale,
  open
}: HostExecutionPermissionsManagerProps) {
  const copy = useMemo(() => copyFor(locale), [locale]);
  const [permissions, setPermissions] =
    useState<HostExecutionPermissionsResponse | null>(null);
  const [selected, setSelected] = useState<HostPermissionProfile>("development");
  const [approvals, setApprovals] = useState<HostCommandPendingApprovalSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [permissionResponse, approvalResponse] = await Promise.all([
        fetchHostExecutionPermissions(),
        fetchPendingHostCommandApprovals()
      ]);
      setPermissions(permissionResponse);
      setSelected(permissionResponse.hostPermissionProfile);
      setApprovals(approvalResponse.approvals);
    } catch (cause) {
      setError(problemMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  async function persist(profile: HostPermissionProfile) {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateHostExecutionPermissions(profile);
      setPermissions(updated);
      setSelected(updated.hostPermissionProfile);
      message.success(copy.saved);
    } catch (cause) {
      setError(problemMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  function saveSelected() {
    if (selected === "full-host") {
      Modal.confirm({
        title: copy.profiles["full-host"].label,
        icon: <SafetyCertificateOutlined />,
        content: copy.fullWarning,
        okText: copy.save,
        okButtonProps: { danger: true },
        cancelText: locale === "zh-CN" ? "取消" : "Cancel",
        onOk: async () => {
          await persist(selected);
        }
      });
      return;
    }
    void persist(selected);
  }

  async function decide(
    approval: HostCommandPendingApprovalSummary,
    decision: "approved" | "denied"
  ) {
    setDecisionId(approval.id);
    setError(null);
    try {
      await decideHostCommandApproval({
        approvalId: approval.id,
        expectedRevision: approval.revision,
        decision
      });
      const refreshed = await fetchPendingHostCommandApprovals();
      setApprovals(refreshed.approvals);
    } catch (cause) {
      setError(problemMessage(cause));
    } finally {
      setDecisionId(null);
    }
  }

  return (
    <>
      <Divider />
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        <ToolOutlined /> {copy.title}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {copy.description}
      </Typography.Paragraph>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}

      {loading && !permissions ? (
        <Space>
          <Spin size="small" />
          <Typography.Text type="secondary">{copy.loading}</Typography.Text>
        </Space>
      ) : (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Radio.Group
            value={selected}
            onChange={(event) => setSelected(event.target.value as HostPermissionProfile)}
            disabled={saving}
            style={{ width: "100%" }}
          >
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              {PROFILE_ORDER.map((profile) => (
                <Radio key={profile} value={profile} style={{ alignItems: "flex-start" }}>
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{copy.profiles[profile].label}</Typography.Text>
                    <Typography.Text type="secondary">
                      {copy.profiles[profile].description}
                    </Typography.Text>
                  </Space>
                </Radio>
              ))}
            </Space>
          </Radio.Group>

          {selected === "device-maintenance" ? (
            <Alert type="info" showIcon message={copy.maintenanceNote} />
          ) : null}
          {selected === "full-host" ? (
            <Alert type="warning" showIcon message={copy.fullWarning} />
          ) : null}

          <Button
            type="primary"
            loading={saving}
            disabled={!permissions || selected === permissions.hostPermissionProfile}
            onClick={saveSelected}
          >
            {copy.save}
          </Button>
        </Space>
      )}

      <Divider />
      <Space style={{ width: "100%", justifyContent: "space-between" }} align="start">
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {copy.approvalTitle}
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>
            {copy.approvalDescription}
          </Typography.Paragraph>
        </div>
        <Button
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => void refresh()}
        >
          {copy.refresh}
        </Button>
      </Space>

      <List
        dataSource={approvals}
        locale={{ emptyText: copy.noApprovals }}
        renderItem={(approval) => {
          const command = exactCommandDisplay(approval);
          const busy = decisionId === approval.id;
          return (
            <List.Item
              actions={[
                <Button
                  key="deny"
                  danger
                  icon={<CloseOutlined />}
                  loading={busy}
                  onClick={() => void decide(approval, "denied")}
                >
                  {copy.deny}
                </Button>,
                <Button
                  key="approve"
                  type="primary"
                  icon={<CheckOutlined />}
                  loading={busy}
                  onClick={() => void decide(approval, "approved")}
                >
                  {copy.approve}
                </Button>
              ]}
            >
              <List.Item.Meta
                title={
                  <Space wrap>
                    <Typography.Text code>{command}</Typography.Text>
                    <Tag color={approval.effect === "write" ? "warning" : undefined}>
                      {approval.effect}
                    </Tag>
                  </Space>
                }
                description={
                  <Space direction="vertical" size={2}>
                    <Typography.Text type="secondary">
                      {locale === "zh-CN" ? "工作目录" : "Working directory"}: {approval.workdir}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {locale === "zh-CN" ? "执行器" : "Executor"}: {approval.executorId} · {locale === "zh-CN" ? "超时" : "Timeout"}: {approval.timeoutMs} ms
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {copy.expires}: {new Date(approval.expiresAt).toLocaleString(locale)}
                    </Typography.Text>
                  </Space>
                }
              />
            </List.Item>
          );
        }}
      />
    </>
  );
}

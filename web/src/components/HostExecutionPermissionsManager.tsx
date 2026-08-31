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
  decideHostMutationApproval,
  decideHostProcessApproval,
  fetchHostExecutionPermissions,
  fetchPendingHostCommandApprovals,
  fetchPendingHostMutationApprovals,
  fetchPendingHostProcessApprovals,
  updateHostExecutionPermissions,
  updateWorkspaceExecutionPermissions,
  type HostCommandPendingApprovalSummary,
  type HostExecutionPermissionsResponse,
  type HostMutationPendingApprovalSummary,
  type HostPermissionProfile,
  type HostProcessPendingApprovalSummary,
  type WorkspaceExecutionProfile
} from "../api";
import type { LocaleCode } from "../i18n";

interface ExecutionPermissionsManagerProps {
  locale: LocaleCode;
  open: boolean;
}

const WORKSPACE_PROFILE_ORDER: WorkspaceExecutionProfile[] = [
  "restricted",
  "development"
];

const HOST_PROFILE_ORDER: HostPermissionProfile[] = [
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
        "Workspace 开发权限与 Host/设备管理权限分域控制。普通项目开发不再通过 Host 权限或逐命令白名单治理。",
      workspaceTitle: "Workspace 开发权限",
      workspaceDescription:
        "Development 允许已授权 Workspace 运行通用开发 CLI、shell、解释器与 Git 操作；未知命令默认按写操作治理。网络仍需按任务显式开启，Host/设备能力不会随之开放。",
      workspaceWarning:
        "当前原生 Codex sandbox 能可靠限制 Workspace 写入范围和网络开关，但不能宣称把所有读取也严格限制在 Workspace 内。Development 适用于你信任的本机开发项目；不信任的代码请使用受限档或隔离执行环境。",
      hostTitle: "Host / 设备权限",
      loading: "正在读取执行权限…",
      save: "保存权限档位",
      saveWorkspace: "保存 Workspace 权限",
      saved: "执行权限已更新",
      refresh: "刷新待审批",
      approvalTitle: "待审批的主机操作",
      approvalDescription:
        "远程 MCP 调用方不能批准自己的请求。只有已登录的 Operator 可以批准或拒绝；命令、文件变更与托管进程审批都只对已准备的精确操作生效。",
      commandApprovalTitle: "主机命令",
      mutationApprovalTitle: "文件变更",
      processApprovalTitle: "托管进程",
      noApprovals: "当前没有待审批的主机命令。",
      noMutationApprovals: "当前没有待审批的主机文件变更。",
      noProcessApprovals: "当前没有待审批的托管进程操作。",
      approve: "批准",
      deny: "拒绝",
      expires: "过期时间",
      fullWarning:
        "本机 Full Host 是 danger-level 高风险策略：开放精确审批的 Pure Host 命令与 Host Root 文件写改，命令影响可能超出所选 Root。它本身仍保持保守的 shell/解释器限制；但某个 OAuth 授权关系若由 Owner 明确升级为 Full Access，该授权可额外执行通用一次性 Host 解释器/命令，并使用由 durable Process Supervisor 托管、绑定到该授权与调用方的 Pure Host 长期进程。系统级任意 PID attach/list/kill 仍不会开放。",
      maintenanceNote:
        "设备维护档只增加只读诊断（如 df、du、diskutil list/info、system_profiler、vm_stat）。清理、删除等优化操作不会被这一档自动放开。",
      workspaceProfiles: {
        restricted: {
          label: "受限",
          description: "保留保守命令策略，适合不信任项目或临时检查；未知 CLI 与任意 shell 不执行。"
        },
        development: {
          label: "开发（默认）",
          description: "通用 Coding Runtime：未知 CLI、shell、解释器和 Git 操作均可在 Workspace 治理边界内运行，未知操作默认按 write 处理。"
        }
      },
      profiles: {
        restricted: {
          label: "受限",
          description: "仅保留基础有界 Host 只读检查；禁用 host-managed 构建、Host Direct Workspace 写改与托管进程。"
        },
        development: {
          label: "开发（默认）",
          description: "保留项目开发所需的精确 host-managed 构建、Host Direct Workspace 兼容写改与托管进程；不开放 Pure Host 文件写改或设备诊断。"
        },
        "device-maintenance": {
          label: "设备维护",
          description: "在开发档基础上增加有界、只读的磁盘/系统诊断；仍不开放 Pure Host 文件写改。"
        },
        "full-host": {
          label: "完整主机访问",
          description: "高风险的本机 Host 策略：增加精确审批的 Pure Host 命令与 Host Root 文件写改；本档本身仍保持保守 shell/解释器限制。单独由 Owner 授予的 OAuth Full Access 可进一步开放通用一次性 Host 解释器/命令和受治理的 Pure Host 托管进程。"
        }
      }
    } as const;
  }
  return {
    title: "Execution permissions",
    description:
      "Workspace development permissions and Host/device administration permissions are separate policy domains. Normal coding no longer depends on Host privileges or a per-command source allowlist.",
    workspaceTitle: "Workspace development permissions",
    workspaceDescription:
      "Development allows general development CLIs, shells, interpreters and Git operations in an authorized Workspace; unknown commands default to governed writes. Network remains explicit per task and Host/device access is not implied.",
    workspaceWarning:
      "The current native Codex sandbox reliably governs Workspace writes and the network switch, but ChatCockpit does not claim strict Workspace-only read confinement. Use Development for local projects you trust; use Restricted or an isolated environment for untrusted code.",
    hostTitle: "Host / device permissions",
    loading: "Reading execution permissions…",
    save: "Save permission profile",
    saveWorkspace: "Save Workspace permissions",
    saved: "Execution permissions updated",
    refresh: "Refresh approvals",
    approvalTitle: "Pending Host operation approvals",
    approvalDescription:
      "Remote MCP callers cannot approve their own requests. Only a signed-in Operator can approve or deny; command, file-mutation and managed-process approvals remain bound to the exact prepared operation.",
    commandApprovalTitle: "Host commands",
    mutationApprovalTitle: "File mutations",
    processApprovalTitle: "Managed processes",
    noApprovals: "There are no pending Host command approvals.",
    noMutationApprovals: "There are no pending Host file mutations.",
    noProcessApprovals: "There are no pending managed-process actions.",
    approve: "Approve",
    deny: "Deny",
    expires: "Expires",
    fullWarning:
      "The local Full Host profile is a danger-level policy: it enables exact-approved Pure Host commands and Host Root file mutations, and commands may affect resources outside the selected Root. The profile itself keeps conservative shell/interpreter restrictions; however, an OAuth authorization relation explicitly upgraded by the Owner to Full Access may additionally run general one-shot Host interpreters/commands and grant-bound Pure Host long-lived processes through the durable Process Supervisor. System-wide arbitrary PID attach/list/kill remains unavailable.",
    maintenanceNote:
      "Device maintenance only adds bounded read-only diagnostics such as df, du, diskutil list/info, system_profiler and vm_stat. Cleanup or deletion is not automatically enabled by this profile.",
    workspaceProfiles: {
      restricted: {
        label: "Restricted",
        description: "Keeps the conservative command policy for untrusted projects or temporary inspection; unknown CLIs and arbitrary shells are not executed."
      },
      development: {
        label: "Development (default)",
        description: "General Coding Runtime: unknown CLIs, shells, interpreters and Git operations may run under Workspace governance; uncertain operations default to writes."
      }
    },
    profiles: {
      restricted: {
        label: "Restricted",
        description: "Keeps bounded basic Host reads only; host-managed builds, Host Direct Workspace mutations and managed processes are disabled."
      },
      development: {
        label: "Development (default)",
        description: "Keeps exact host-managed builds plus Host Direct Workspace compatibility mutations and managed processes needed by the development workflow; Pure Host file mutation and device diagnostics remain disabled."
      },
      "device-maintenance": {
        label: "Device maintenance",
        description: "Development permissions plus bounded read-only disk and system diagnostics; Pure Host file mutations remain disabled."
      },
      "full-host": {
        label: "Full Host access",
        description: "High-risk local Host policy: adds exact-approved Pure Host commands and Host Root file mutations while keeping conservative shell/interpreter restrictions for this profile itself. Separately granted OAuth Full Access can add general one-shot Host interpreters/commands and governed Pure Host managed processes."
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

function summaryText(summary: Record<string, unknown>, key: string): string | null {
  const value = summary[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function mutationApprovalDisplay(approval: HostMutationPendingApprovalSummary): string {
  return `${approval.operation} ${summaryText(approval.publicSummary, "target") ?? approval.rootId}`;
}

function processApprovalDisplay(approval: HostProcessPendingApprovalSummary): string {
  const target =
    summaryText(approval.publicSummary, "command") ??
    summaryText(approval.publicSummary, "processId") ??
    approval.processId ??
    "";
  return target ? `${approval.operation} ${target}` : approval.operation;
}

export function ExecutionPermissionsManager({
  locale,
  open
}: ExecutionPermissionsManagerProps) {
  const copy = useMemo(() => copyFor(locale), [locale]);
  const [permissions, setPermissions] =
    useState<HostExecutionPermissionsResponse | null>(null);
  const [workspaceSelected, setWorkspaceSelected] =
    useState<WorkspaceExecutionProfile>("development");
  const [selected, setSelected] = useState<HostPermissionProfile>("development");
  const [approvals, setApprovals] = useState<HostCommandPendingApprovalSummary[]>([]);
  const [mutationApprovals, setMutationApprovals] = useState<HostMutationPendingApprovalSummary[]>([]);
  const [processApprovals, setProcessApprovals] = useState<HostProcessPendingApprovalSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [
        permissionResponse,
        commandApprovalResponse,
        mutationApprovalResponse,
        processApprovalResponse
      ] = await Promise.all([
        fetchHostExecutionPermissions(),
        fetchPendingHostCommandApprovals(),
        fetchPendingHostMutationApprovals(),
        fetchPendingHostProcessApprovals()
      ]);
      setPermissions(permissionResponse);
      setWorkspaceSelected(permissionResponse.workspaceExecutionProfile);
      setSelected(permissionResponse.hostPermissionProfile);
      setApprovals(commandApprovalResponse.approvals);
      setMutationApprovals(mutationApprovalResponse.approvals);
      setProcessApprovals(processApprovalResponse.approvals);
    } catch (cause) {
      setError(problemMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  async function persistWorkspace(profile: WorkspaceExecutionProfile) {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateWorkspaceExecutionPermissions(profile);
      setPermissions(updated);
      setWorkspaceSelected(updated.workspaceExecutionProfile);
      setSelected(updated.hostPermissionProfile);
      message.success(copy.saved);
    } catch (cause) {
      setError(problemMessage(cause));
    } finally {
      setSaving(false);
    }
  }

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

  async function decideMutation(
    approval: HostMutationPendingApprovalSummary,
    decision: "approved" | "denied"
  ) {
    setDecisionId(approval.id);
    setError(null);
    try {
      await decideHostMutationApproval({
        approvalId: approval.id,
        expectedRevision: approval.revision,
        decision
      });
      const refreshed = await fetchPendingHostMutationApprovals();
      setMutationApprovals(refreshed.approvals);
    } catch (cause) {
      setError(problemMessage(cause));
    } finally {
      setDecisionId(null);
    }
  }

  async function decideProcess(
    approval: HostProcessPendingApprovalSummary,
    decision: "approved" | "denied"
  ) {
    setDecisionId(approval.id);
    setError(null);
    try {
      await decideHostProcessApproval({
        approvalId: approval.id,
        expectedRevision: approval.revision,
        decision
      });
      const refreshed = await fetchPendingHostProcessApprovals();
      setProcessApprovals(refreshed.approvals);
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
          <Typography.Title level={5} style={{ margin: 0 }}>
            {copy.workspaceTitle}
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {copy.workspaceDescription}
          </Typography.Paragraph>
          <Radio.Group
            value={workspaceSelected}
            onChange={(event) =>
              setWorkspaceSelected(event.target.value as WorkspaceExecutionProfile)
            }
            disabled={saving}
            style={{ width: "100%" }}
          >
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              {WORKSPACE_PROFILE_ORDER.map((profile) => (
                <Radio key={profile} value={profile} style={{ alignItems: "flex-start" }}>
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>
                      {copy.workspaceProfiles[profile].label}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {copy.workspaceProfiles[profile].description}
                    </Typography.Text>
                  </Space>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
          {workspaceSelected === "development" ? (
            <Alert type="warning" showIcon message={copy.workspaceWarning} />
          ) : null}
          <Button
            type="primary"
            loading={saving}
            disabled={
              !permissions ||
              workspaceSelected === permissions.workspaceExecutionProfile
            }
            onClick={() => void persistWorkspace(workspaceSelected)}
          >
            {copy.saveWorkspace}
          </Button>

          <Divider style={{ margin: "8px 0" }} />
          <Typography.Title level={5} style={{ margin: 0 }}>
            {copy.hostTitle}
          </Typography.Title>
          <Radio.Group
            value={selected}
            onChange={(event) => setSelected(event.target.value as HostPermissionProfile)}
            disabled={saving}
            style={{ width: "100%" }}
          >
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              {HOST_PROFILE_ORDER.map((profile) => (
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

      <Typography.Title level={5} style={{ marginBottom: 8 }}>
        {copy.commandApprovalTitle}
      </Typography.Title>
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

      <Divider />
      <Typography.Title level={5} style={{ marginBottom: 8 }}>
        {copy.mutationApprovalTitle}
      </Typography.Title>
      <List
        dataSource={mutationApprovals}
        locale={{ emptyText: copy.noMutationApprovals }}
        renderItem={(approval) => {
          const busy = decisionId === approval.id;
          return (
            <List.Item
              actions={[
                <Button
                  key="deny"
                  danger
                  icon={<CloseOutlined />}
                  loading={busy}
                  onClick={() => void decideMutation(approval, "denied")}
                >
                  {copy.deny}
                </Button>,
                <Button
                  key="approve"
                  type="primary"
                  icon={<CheckOutlined />}
                  loading={busy}
                  onClick={() => void decideMutation(approval, "approved")}
                >
                  {copy.approve}
                </Button>
              ]}
            >
              <List.Item.Meta
                title={
                  <Space wrap>
                    <Typography.Text code>{mutationApprovalDisplay(approval)}</Typography.Text>
                    <Tag>{approval.targetKind}</Tag>
                  </Space>
                }
                description={
                  <Space direction="vertical" size={2}>
                    <Typography.Text type="secondary">
                      {locale === "zh-CN" ? "执行器" : "Executor"}: {approval.executorId}
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

      <Divider />
      <Typography.Title level={5} style={{ marginBottom: 8 }}>
        {copy.processApprovalTitle}
      </Typography.Title>
      <List
        dataSource={processApprovals}
        locale={{ emptyText: copy.noProcessApprovals }}
        renderItem={(approval) => {
          const busy = decisionId === approval.id;
          return (
            <List.Item
              actions={[
                <Button
                  key="deny"
                  danger
                  icon={<CloseOutlined />}
                  loading={busy}
                  onClick={() => void decideProcess(approval, "denied")}
                >
                  {copy.deny}
                </Button>,
                <Button
                  key="approve"
                  type="primary"
                  icon={<CheckOutlined />}
                  loading={busy}
                  onClick={() => void decideProcess(approval, "approved")}
                >
                  {copy.approve}
                </Button>
              ]}
            >
              <List.Item.Meta
                title={
                  <Space wrap>
                    <Typography.Text code>{processApprovalDisplay(approval)}</Typography.Text>
                    <Tag>{approval.operation}</Tag>
                  </Space>
                }
                description={
                  <Space direction="vertical" size={2}>
                    <Typography.Text type="secondary">
                      {locale === "zh-CN" ? "执行器" : "Executor"}: {approval.executorId}
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

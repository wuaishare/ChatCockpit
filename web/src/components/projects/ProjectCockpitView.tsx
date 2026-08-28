import {
  App as AntApp,
  Alert,
  Button,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Tag,
  Tooltip
} from "antd";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  FolderAddOutlined,
  MoreOutlined,
  ReloadOutlined,
  StarOutlined
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  attachProjectRoot,
  detachProjectRoot,
  fetchProject,
  fetchWorkspaceContinuitySnapshot,
  makeProjectRootPrimary,
  renameProject
} from "../../api";
import type { LocaleCode } from "../../i18n";
import {
  getProjectsCopy,
  projectRootAccessLabel,
  projectRootKindLabel,
  projectRootRoleLabel
} from "../../i18n/projects";
import type {
  ApiProblem,
  ContinuityWorkspaceSnapshot,
  ProjectDevelopmentObservationStatus,
  ProjectDevelopmentProvider,
  ProjectRegistryDetailResponse,
  ProjectRootAccess,
  ProjectRootKind,
  ProjectRootRole
} from "../../types";
import { StateNotice } from "../StateNotice";
import { UiText as Text } from "../UiText";
import "./projects.css";

interface ProjectCockpitViewProps {
  locale: LocaleCode;
  token: string | null;
  projectId: string;
  onBack: () => void;
}

interface AddRootValues {
  path: string;
  kind: ProjectRootKind;
  role: ProjectRootRole;
  access: ProjectRootAccess;
  repoId?: string;
}

function problemMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as ApiProblem).message || fallback);
  }
  return fallback;
}

function shortCommit(value: string | null): string {
  return value ? value.slice(0, 12) : "—";
}

function observationColor(status: ProjectDevelopmentObservationStatus): string {
  if (status === "ready") return "success";
  if (status === "degraded") return "warning";
  return "default";
}

export function ProjectCockpitView({
  locale,
  token,
  projectId,
  onBack
}: ProjectCockpitViewProps) {
  const copy = getProjectsCopy(locale);
  const { message, modal } = AntApp.useApp();
  const [detail, setDetail] = useState<ProjectRegistryDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ContinuityWorkspaceSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [addRootOpen, setAddRootOpen] = useState(false);
  const [addRootLoading, setAddRootLoading] = useState(false);
  const [rootMutation, setRootMutation] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameLoading, setRenameLoading] = useState(false);
  const [addRootForm] = Form.useForm<AddRootValues>();
  const [renameForm] = Form.useForm<{ displayName: string }>();
  const addRootKind = Form.useWatch("kind", addRootForm) ?? "git-repository";

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchProject(projectId);
      setDetail(response);
      setSelectedWorkspaceId((current) => {
        if (current && response.workspaces.some((workspace) => workspace.id === current)) {
          return current;
        }
        return response.project.defaultWorkspaceId
          ?? response.workspaces.find((workspace) => workspace.status === "ready")?.id
          ?? response.workspaces[0]?.id
          ?? null;
      });
      renameForm.setFieldsValue({ displayName: response.project.displayName });
    } catch (loadError) {
      setDetail(null);
      setError(problemMessage(loadError, copy.requestFailed));
    } finally {
      setLoading(false);
    }
  }, [copy.requestFailed, projectId, renameForm]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const loadSnapshot = useCallback(async () => {
    if (!selectedWorkspaceId) {
      setSnapshot(null);
      return;
    }
    setSnapshotLoading(true);
    try {
      const response = await fetchWorkspaceContinuitySnapshot(selectedWorkspaceId, token);
      setSnapshot(response.snapshot);
    } catch {
      setSnapshot(null);
    } finally {
      setSnapshotLoading(false);
    }
  }, [selectedWorkspaceId, token]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const submitAddRoot = async (values: AddRootValues) => {
    if (!detail) return;
    setAddRootLoading(true);
    try {
      await attachProjectRoot(projectId, {
        path: values.path.trim(),
        kind: values.kind,
        role: values.role,
        access: values.access,
        repoId: values.kind === "git-repository" ? values.repoId?.trim() : undefined,
        expectedConfigRevision: detail.configRevision
      });
      setAddRootOpen(false);
      addRootForm.resetFields();
      await loadDetail();
      message.success(copy.operationSucceeded);
    } catch (actionError) {
      message.error(problemMessage(actionError, copy.operationFailed));
    } finally {
      setAddRootLoading(false);
    }
  };

  const makePrimaryRoot = async (rootId: string) => {
    if (!detail) return;
    setRootMutation(rootId);
    try {
      await makeProjectRootPrimary(projectId, rootId, detail.configRevision);
      await loadDetail();
      message.success(copy.operationSucceeded);
    } catch (actionError) {
      message.error(problemMessage(actionError, copy.operationFailed));
    } finally {
      setRootMutation(null);
    }
  };

  const confirmDetachRoot = (rootId: string) => {
    if (!detail || detail.roots.length <= 1) return;
    modal.confirm({
      title: copy.detachRootConfirmTitle,
      content: copy.detachRootConfirmDescription,
      okText: copy.detachRoot,
      cancelText: copy.cancel,
      okButtonProps: { danger: true },
      async onOk() {
        setRootMutation(rootId);
        try {
          await detachProjectRoot(projectId, rootId, detail.configRevision);
          await loadDetail();
          message.success(copy.operationSucceeded);
        } catch (actionError) {
          message.error(problemMessage(actionError, copy.operationFailed));
          throw actionError;
        } finally {
          setRootMutation(null);
        }
      }
    });
  };

  const submitRename = async ({ displayName }: { displayName: string }) => {
    if (!detail) return;
    setRenameLoading(true);
    try {
      await renameProject(projectId, {
        displayName: displayName.trim(),
        expectedConfigRevision: detail.configRevision
      });
      setRenameOpen(false);
      await loadDetail();
      message.success(copy.operationSucceeded);
    } catch (actionError) {
      message.error(problemMessage(actionError, copy.operationFailed));
    } finally {
      setRenameLoading(false);
    }
  };

  if (loading) {
    return (
      <StateNotice kind="loading" title={copy.loading} description={copy.cockpitDescription} retryLabel={copy.refresh} />
    );
  }
  if (error || !detail) {
    return (
      <StateNotice
        kind="error"
        title={copy.requestFailed}
        description={error ?? copy.requestFailed}
        retryLabel={copy.refresh}
        onRetry={() => void loadDetail()}
      />
    );
  }

  const primaryRoot = detail.roots.find((root) => root.primary) ?? null;
  const selectedWorkspace = detail.workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  const providers = detail.developmentCoordination.providers ?? [];
  const providerNeedsAttention = providers.some(
    (provider) => provider.runtimeAvailability === "unavailable" || provider.observation.status === "degraded"
  );
  const workspaceNeedsAttention = Boolean(
    selectedWorkspace && (selectedWorkspace.status !== "ready" || selectedWorkspace.dirty)
  );
  const rootNeedsAttention = !primaryRoot || primaryRoot.status !== "ready";
  const readiness = rootNeedsAttention || workspaceNeedsAttention
    ? copy.readinessAttention
    : providerNeedsAttention
      ? copy.readinessLimited
      : copy.readinessReady;
  const readinessColor = rootNeedsAttention || workspaceNeedsAttention || providerNeedsAttention
    ? "warning"
    : "success";
  const attentionVisible = Boolean(
    snapshot && (
      snapshot.tasks.length > 0 ||
      snapshot.pendingApprovals.length > 0 ||
      snapshot.readOnly ||
      snapshot.git.dirty
    )
  );

  return (
    <section className="project-cockpit-view" aria-labelledby="project-cockpit-view-title">
      <header className="project-cockpit-view__hero panel">
        <div className="project-cockpit-view__heading">
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>
            {copy.cockpitBack}
          </Button>
          <div>
            <div className="project-cockpit-view__title-row">
              <Text as="h1" id="project-cockpit-view-title" className="project-cockpit-view__title">
                {detail.project.displayName}
              </Text>
              <Tag color={detail.project.status === "active" ? "success" : "default"}>
                {detail.project.status === "active" ? copy.statusActive : copy.statusArchived}
              </Tag>
            </div>
            <div className="project-cockpit-view__meta">
              <code>{detail.project.slug}</code>
              <span>{copy.projectRoots}: <strong>{detail.roots.length}</strong></span>
              <span>{copy.executionWorkspaces}: <strong>{detail.workspaces.length}</strong></span>
            </div>
          </div>
        </div>
        <div className="project-cockpit-view__actions">
          <Tooltip title={copy.refresh}>
            <Button aria-label={copy.refresh} icon={<ReloadOutlined />} onClick={() => void loadDetail()} />
          </Tooltip>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [{
                key: "rename",
                label: copy.renameProject,
                onClick: () => setRenameOpen(true)
              }]
            }}
          >
            <Button aria-label={copy.projectActions} icon={<MoreOutlined />} />
          </Dropdown>
        </div>
      </header>

      <section className="project-section panel" aria-labelledby="project-readiness-title">
        <header className="project-section__heading">
          <div>
            <Text as="h2" id="project-readiness-title">{copy.readiness}</Text>
            <Tag color={readinessColor}>{readiness}</Tag>
          </div>
        </header>
        <div className="project-readiness">
          <ReadinessItem
            label={copy.primaryRoot}
            value={primaryRoot ? projectRootRoleLabel(locale, primaryRoot.role) : "—"}
            state={primaryRoot?.status ?? "missing"}
            locale={locale}
          />
          <ReadinessItem
            label={copy.workspace}
            value={selectedWorkspace?.repoId ?? copy.noExecutionWorkspace}
            state={selectedWorkspace?.status === "ready"
              ? "ready"
              : selectedWorkspace?.status === "missing"
                ? "missing"
                : "blocked"}
            locale={locale}
          />
          <ReadinessItem
            label={copy.git}
            value={!selectedWorkspace
              ? copy.unavailable
              : selectedWorkspace.dirty ? copy.dirty : copy.clean}
            state={!selectedWorkspace ? "missing" : selectedWorkspace.dirty ? "attention" : "ready"}
            locale={locale}
          />
          <ReadinessItem
            label={copy.provider}
            value={providers[0]?.displayName ?? copy.unavailable}
            state={!providers.length ? "missing" : providerNeedsAttention ? "attention" : "ready"}
            locale={locale}
          />
        </div>
      </section>

      <section className="project-section panel" aria-labelledby="project-roots-title">
        <header className="project-section__heading">
          <div>
            <Text as="h2" id="project-roots-title">{copy.projectRoots}</Text>
            <Text as="p" type="secondary">{copy.addRootDescription}</Text>
          </div>
          <Button type="primary" icon={<FolderAddOutlined />} onClick={() => {
            addRootForm.resetFields();
            addRootForm.setFieldsValue({
              kind: "git-repository",
              role: "supporting-source",
              access: "read-write"
            });
            setAddRootOpen(true);
          }}>
            {copy.addRoot}
          </Button>
        </header>

        {detail.roots.length === 0 ? (
          <Empty description={copy.addRootDescription} />
        ) : (
          <div className="project-root-list">
            {detail.roots.map((root) => {
              const linkedWorkspaces = detail.workspaces.filter((workspace) =>
                root.executionWorkspaceIds.includes(workspace.id)
              );
              return (
                <article className="project-root-row" key={root.id}>
                  <div className="project-root-row__main">
                    <div className="project-root-row__title">
                      <strong>{projectRootRoleLabel(locale, root.role)}</strong>
                      <Tag>{projectRootKindLabel(locale, root.kind)}</Tag>
                      <Tag>{projectRootAccessLabel(locale, root.access)}</Tag>
                      {root.primary ? <Tag color="processing" icon={<StarOutlined />}>{copy.currentPrimary}</Tag> : null}
                      <Tag color={root.status === "ready" ? "success" : "warning"}>
                        {root.status === "ready" ? copy.ready : root.status === "missing" ? copy.missing : copy.blocked}
                      </Tag>
                    </div>
                    <code className="project-root-row__path">{root.privatePath}</code>
                  </div>

                  <div className="project-root-row__workspaces">
                    {linkedWorkspaces.length > 0 ? linkedWorkspaces.map((workspace) => (
                      <button
                        type="button"
                        className={`project-workspace-chip${workspace.id === selectedWorkspaceId ? " is-selected" : ""}`}
                        key={workspace.id}
                        onClick={() => setSelectedWorkspaceId(workspace.id)}
                      >
                        <strong>{workspace.repoId}</strong>
                        <span>{workspace.branch ?? "—"}</span>
                        <span className={workspace.dirty ? "is-attention" : ""}>
                          {workspace.dirty ? copy.dirty : copy.clean}
                        </span>
                      </button>
                    )) : (
                      <span className="project-root-row__empty">{copy.noExecutionWorkspace}</span>
                    )}
                  </div>

                  <div className="project-root-row__actions">
                    {!root.primary ? (
                      <Button
                        loading={rootMutation === root.id}
                        onClick={() => void makePrimaryRoot(root.id)}
                      >
                        {copy.makePrimaryRoot}
                      </Button>
                    ) : null}
                    <Tooltip title={detail.roots.length <= 1 ? copy.detachRootConfirmDescription : undefined}>
                      <Button
                        danger
                        icon={<DeleteOutlined />}
                        disabled={detail.roots.length <= 1}
                        loading={rootMutation === root.id}
                        onClick={() => confirmDetachRoot(root.id)}
                      >
                        {copy.detachRoot}
                      </Button>
                    </Tooltip>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {providers.length > 0 ? (
        <section className="project-section panel" aria-labelledby="project-context-title">
          <header className="project-section__heading">
            <div>
              <Text as="h2" id="project-context-title">{copy.developmentContext}</Text>
              <Text as="p" type="secondary">
                {copy.modelLoopOwner}: {copy.callerOwnsLoop}. {copy.explicitProviderTransfer}.
              </Text>
            </div>
          </header>
          <div className="project-provider-list">
            {providers.map((provider) => (
              <ProviderRow key={provider.id} provider={provider} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}

      {attentionVisible ? (
        <section className="project-section panel" aria-labelledby="project-attention-title">
          <header className="project-section__heading">
            <div>
              <Text as="h2" id="project-attention-title">{copy.attentionAndTasks}</Text>
              {selectedWorkspace ? (
                <Text as="p" type="secondary">{copy.selectedWorkspace}: {selectedWorkspace.repoId}</Text>
              ) : null}
            </div>
          </header>
          <div className="project-attention">
            <AttentionItem label={copy.activeTasks} value={snapshot?.tasks.length ?? 0} attention={(snapshot?.tasks.length ?? 0) > 0} />
            <AttentionItem label={copy.pendingApprovals} value={snapshot?.pendingApprovals.length ?? 0} attention={(snapshot?.pendingApprovals.length ?? 0) > 0} />
            <AttentionItem label={copy.writerState} value={snapshot?.readOnly ? copy.readOnlyState : copy.writable} attention={Boolean(snapshot?.readOnly)} />
            {snapshot?.git.dirty ? <Alert type="warning" showIcon message={copy.dirty} /> : null}
          </div>
        </section>
      ) : null}

      {snapshotLoading ? <span className="project-cockpit-view__background-status">{copy.loading}</span> : null}

      <Modal
        open={addRootOpen}
        title={copy.addRoot}
        okText={copy.addRoot}
        cancelText={copy.cancel}
        confirmLoading={addRootLoading}
        onCancel={() => setAddRootOpen(false)}
        onOk={() => void addRootForm.submit()}
        destroyOnHidden
      >
        <Text as="p" type="secondary">{copy.addRootDescription}</Text>
        <Form form={addRootForm} layout="vertical" onFinish={submitAddRoot}>
          <Form.Item name="kind" label={copy.rootKind} rules={[{ required: true }]}>
            <Select options={[
              { value: "git-repository", label: copy.gitRepository },
              { value: "directory", label: copy.directory }
            ]} />
          </Form.Item>
          <Form.Item name="role" label={copy.rootRole} rules={[{ required: true }]}>
            <Select options={[
              { value: "supporting-source", label: copy.supportingSource },
              { value: "documentation", label: copy.documentation },
              { value: "knowledge", label: copy.knowledge },
              { value: "assets", label: copy.assets }
            ]} />
          </Form.Item>
          <Form.Item name="access" label={copy.rootAccess} rules={[{ required: true }]}>
            <Select options={[
              { value: "read-write", label: copy.readWrite },
              { value: "read-only", label: copy.readOnly }
            ]} />
          </Form.Item>
          {addRootKind === "git-repository" ? (
            <Form.Item name="repoId" label={copy.repoId} rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9._-]{0,79}$/ }]}>
              <Input autoComplete="off" />
            </Form.Item>
          ) : null}
          <Form.Item name="path" label={copy.localPath} rules={[{ required: true }]}>
            <Input autoComplete="off" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={renameOpen}
        title={copy.renameProject}
        okText={copy.save}
        cancelText={copy.cancel}
        confirmLoading={renameLoading}
        onCancel={() => setRenameOpen(false)}
        onOk={() => void renameForm.submit()}
        destroyOnHidden
      >
        <Form form={renameForm} layout="vertical" onFinish={submitRename}>
          <Form.Item name="displayName" label={copy.displayName} rules={[{ required: true }]}>
            <Input autoComplete="off" />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

function ReadinessItem({
  label,
  value,
  state,
  locale
}: {
  label: string;
  value: string;
  state: "ready" | "missing" | "blocked" | "attention";
  locale: LocaleCode;
}) {
  const copy = getProjectsCopy(locale);
  const stateLabel = state === "ready"
    ? copy.ready
    : state === "attention"
      ? copy.readinessAttention
      : state === "blocked"
        ? copy.blocked
        : copy.missing;
  return (
    <div className="project-readiness__item">
      <span>{label}</span>
      <strong>{value}</strong>
      <Tag color={state === "ready" ? "success" : "warning"}>{stateLabel}</Tag>
    </div>
  );
}

function ProviderRow({
  provider,
  locale
}: {
  provider: ProjectDevelopmentProvider;
  locale: LocaleCode;
}) {
  const copy = getProjectsCopy(locale);
  const context = provider.continuation.matchingContext;
  const meaningfulCapabilities = provider.capabilities.filter((capability) =>
    capability.observation.status === "degraded" ||
    (capability.configuredCount ?? 0) > 0 ||
    (capability.applicableCount ?? 0) > 0
  );
  const continuationLabel = provider.continuation.action === "resume"
    ? copy.continuationResume
    : provider.continuation.action === "start"
      ? copy.continuationStart
      : provider.continuation.action === "repair"
        ? copy.continuationRepair
        : copy.continuationUnavailable;

  return (
    <article className="project-provider-row">
      <div className="project-provider-row__identity">
        <strong>{provider.displayName}</strong>
        <code>{provider.runtimeKind}</code>
      </div>
      <div className="project-provider-row__state">
        <Tag color={provider.runtimeAvailability === "available" ? "success" : provider.runtimeAvailability === "unavailable" ? "error" : "default"}>
          {provider.runtimeAvailability === "available" ? copy.providerAvailable : provider.runtimeAvailability === "unavailable" ? copy.providerUnavailable : copy.unknown}
        </Tag>
        <Tag color={observationColor(provider.observation.status)}>
          {provider.observation.status === "ready" ? copy.observationReady : provider.observation.status === "degraded" ? copy.observationDegraded : copy.observationNotRequired}
        </Tag>
      </div>
      <div className="project-provider-row__continuation">
        <span>{continuationLabel}</span>
        {context ? <strong>{context.name?.trim() || context.preview?.trim() || context.id.slice(0, 12)}</strong> : null}
      </div>
      {meaningfulCapabilities.length > 0 ? (
        <div className="project-provider-row__capabilities">
          {meaningfulCapabilities.map((capability) => (
            <span key={capability.id}>
              <strong>{capability.displayName}</strong>
              {capability.configuredCount !== null ? <small>{copy.configured} {capability.configuredCount}</small> : null}
              {capability.applicableCount !== null ? <small>{copy.applicable} {capability.applicableCount}</small> : null}
              {capability.disabledCount ? <small>{copy.disabled} {capability.disabledCount}</small> : null}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function AttentionItem({
  label,
  value,
  attention
}: {
  label: string;
  value: string | number;
  attention: boolean;
}) {
  return (
    <div className={`project-attention__item${attention ? " is-attention" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

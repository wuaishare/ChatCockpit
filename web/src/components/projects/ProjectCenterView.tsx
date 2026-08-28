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
  Spin,
  Tag,
  Tooltip
} from "antd";
import {
  ApartmentOutlined,
  FolderAddOutlined,
  ImportOutlined,
  MoreOutlined,
  ProjectOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  attachProjectRoot,
  createProject,
  fetchProjectDiscovery,
  fetchProjects
} from "../../api";
import type { LocaleCode } from "../../i18n";
import {
  getProjectsCopy,
  projectRootKindLabel,
  projectRootRoleLabel
} from "../../i18n/projects";
import type {
  ApiProblem,
  ProjectRegistryProjection,
  ProjectRootDiscoveryCandidate,
  ProjectRootDiscoverySourceSnapshot,
  ProjectRootAccess,
  ProjectRootKind,
  ProjectRootRole
} from "../../types";
import { WorkspaceOnboardingDrawer } from "../continuity/WorkspaceOnboardingDrawer";
import { StateNotice } from "../StateNotice";
import { UiText as Text } from "../UiText";
import "./projects.css";

interface ProjectCenterViewProps {
  locale: LocaleCode;
  token: string | null;
  authRequired: boolean;
  onOpenProject: (projectId: string) => void;
}

interface AddProjectFormValues {
  displayName: string;
  slug: string;
  kind: ProjectRootKind;
  repoId?: string;
  path: string;
}

interface AttachRootFormValues {
  projectId: string;
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

function formatObserved(value: number | null, locale: LocaleCode): string {
  if (!value) return "—";
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(milliseconds));
}

export function ProjectCenterView({
  locale,
  token,
  authRequired,
  onOpenProject
}: ProjectCenterViewProps) {
  const copy = getProjectsCopy(locale);
  const { message } = AntApp.useApp();
  const [projects, setProjects] = useState<ProjectRegistryProjection[]>([]);
  const [configRevision, setConfigRevision] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ProjectRootDiscoveryCandidate[]>([]);
  const [sources, setSources] = useState<ProjectRootDiscoverySourceSnapshot[]>([]);
  const [discoveryTruncated, setDiscoveryTruncated] = useState(false);
  const [attachCandidate, setAttachCandidate] = useState<ProjectRootDiscoveryCandidate | null>(null);
  const [attachLoading, setAttachLoading] = useState(false);
  const [discoveryLocationsOpen, setDiscoveryLocationsOpen] = useState(false);
  const [addForm] = Form.useForm<AddProjectFormValues>();
  const [attachForm] = Form.useForm<AttachRootFormValues>();
  const addKind = Form.useWatch("kind", addForm) ?? "git-repository";
  const protectedView = authRequired && !token?.trim();

  const loadProjects = useCallback(async () => {
    if (protectedView) {
      setProjects([]);
      setConfigRevision(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchProjects();
      setProjects(response.projects);
      setConfigRevision(response.configRevision);
    } catch (loadError) {
      setProjects([]);
      setConfigRevision(null);
      setError(problemMessage(loadError, copy.requestFailed));
    } finally {
      setLoading(false);
    }
  }, [copy.requestFailed, protectedView]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return projects;
    return projects.filter(({ project, workspaces }) =>
      [project.displayName, project.slug, ...workspaces.map((workspace) => workspace.repoId)]
        .some((value) => value.toLocaleLowerCase().includes(needle))
    );
  }, [projects, query]);

  const openAddProject = useCallback((candidate?: ProjectRootDiscoveryCandidate) => {
    addForm.resetFields();
    addForm.setFieldsValue({
      displayName: candidate?.name ?? "",
      slug: candidate?.suggestedRepoId ?? "",
      kind: candidate?.kind ?? "git-repository",
      repoId: candidate?.kind === "git-repository"
        ? (candidate.suggestedRepoId ?? undefined)
        : undefined,
      path: candidate?.privatePath ?? ""
    });
    setAddOpen(true);
  }, [addForm]);

  const submitAddProject = async (values: AddProjectFormValues) => {
    if (!configRevision) return;
    setAddLoading(true);
    try {
      const result = await createProject({
        displayName: values.displayName.trim(),
        slug: values.slug.trim(),
        root: {
          path: values.path.trim(),
          kind: values.kind,
          role: "primary-source",
          access: "read-write",
          repoId: values.kind === "git-repository" ? values.repoId?.trim() : undefined
        },
        expectedConfigRevision: configRevision
      });
      setConfigRevision(result.configRevision);
      setAddOpen(false);
      addForm.resetFields();
      await loadProjects();
      message.success(copy.operationSucceeded);
      onOpenProject(result.project.id);
    } catch (actionError) {
      message.error(problemMessage(actionError, copy.operationFailed));
    } finally {
      setAddLoading(false);
    }
  };

  const loadDiscovery = useCallback(async () => {
    setDiscoveryLoading(true);
    setDiscoveryError(null);
    try {
      const response = await fetchProjectDiscovery();
      setCandidates(response.candidates);
      setSources(response.sources);
      setDiscoveryTruncated(response.truncated);
      setConfigRevision(response.configRevision);
    } catch (loadError) {
      setCandidates([]);
      setSources([]);
      setDiscoveryError(problemMessage(loadError, copy.requestFailed));
    } finally {
      setDiscoveryLoading(false);
    }
  }, [copy.requestFailed]);

  const openImport = () => {
    setImportOpen(true);
    void loadDiscovery();
  };

  const openAttach = (candidate: ProjectRootDiscoveryCandidate) => {
    attachForm.resetFields();
    attachForm.setFieldsValue({
      projectId: projects[0]?.project.id,
      role: "supporting-source",
      access: "read-write",
      repoId: candidate.kind === "git-repository"
        ? (candidate.suggestedRepoId ?? undefined)
        : undefined
    });
    setAttachCandidate(candidate);
  };

  const submitAttach = async (values: AttachRootFormValues) => {
    if (!attachCandidate || !configRevision) return;
    setAttachLoading(true);
    try {
      const result = await attachProjectRoot(values.projectId, {
        path: attachCandidate.privatePath,
        kind: attachCandidate.kind,
        role: values.role,
        access: values.access,
        repoId: attachCandidate.kind === "git-repository" ? values.repoId?.trim() : undefined,
        expectedConfigRevision: configRevision
      });
      setConfigRevision(result.configRevision);
      setAttachCandidate(null);
      attachForm.resetFields();
      await Promise.all([loadProjects(), loadDiscovery()]);
      message.success(copy.operationSucceeded);
    } catch (actionError) {
      message.error(problemMessage(actionError, copy.operationFailed));
    } finally {
      setAttachLoading(false);
    }
  };

  if (protectedView) {
    return (
      <StateNotice
        kind="empty"
        title={copy.requestFailed}
        description={copy.centerDescription}
        retryLabel={copy.refresh}
      />
    );
  }

  return (
    <section className="project-center" aria-labelledby="project-center-title">
      <header className="project-center__hero panel">
        <div className="project-center__hero-copy">
          <div className="project-center__title-row">
            <ProjectOutlined aria-hidden="true" />
            <Text as="h1" id="project-center-title" className="project-center__title">
              {copy.centerTitle}
            </Text>
          </div>
          <Text as="p" type="secondary" className="project-center__description">
            {copy.centerDescription}
          </Text>
        </div>
        <div className="project-center__hero-actions">
          <Tooltip title={copy.refresh}>
            <Button
              aria-label={copy.refresh}
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => void loadProjects()}
            />
          </Tooltip>
          <Button icon={<FolderAddOutlined />} onClick={() => openAddProject()}>
            {copy.addProject}
          </Button>
          <Button type="primary" icon={<ImportOutlined />} onClick={openImport}>
            {copy.importExisting}
          </Button>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [{
                key: "discovery-locations",
                icon: <SettingOutlined />,
                label: copy.discoveryLocations,
                onClick: () => setDiscoveryLocationsOpen(true)
              }]
            }}
          >
            <Button aria-label={copy.discoveryLocations} icon={<MoreOutlined />} />
          </Dropdown>
        </div>
      </header>

      <div className="project-center__toolbar panel">
        <Input
          allowClear
          value={query}
          prefix={<SearchOutlined />}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="project-center__count">{filteredProjects.length}</span>
      </div>

      {loading ? (
        <StateNotice kind="loading" title={copy.loading} description={copy.centerDescription} retryLabel={copy.refresh} />
      ) : error ? (
        <StateNotice kind="error" title={copy.requestFailed} description={error} retryLabel={copy.refresh} onRetry={() => void loadProjects()} />
      ) : filteredProjects.length === 0 ? (
        <div className="panel project-center__empty">
          <Empty description={query ? copy.searchPlaceholder : copy.noProjectsDescription} />
          {!query ? (
            <div className="project-center__empty-actions">
              <Button icon={<FolderAddOutlined />} onClick={() => openAddProject()}>{copy.addProject}</Button>
              <Button type="primary" icon={<ImportOutlined />} onClick={openImport}>{copy.importExisting}</Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="project-center__list">
          {filteredProjects.map((projection) => (
            <ProjectRow
              key={projection.project.id}
              locale={locale}
              projection={projection}
              onOpen={() => onOpenProject(projection.project.id)}
            />
          ))}
        </div>
      )}

      <Modal
        open={addOpen}
        title={copy.addProjectTitle}
        okText={copy.create}
        cancelText={copy.cancel}
        confirmLoading={addLoading}
        onCancel={() => setAddOpen(false)}
        onOk={() => void addForm.submit()}
        destroyOnHidden
      >
        <Text as="p" type="secondary">{copy.addProjectDescription}</Text>
        <Form form={addForm} layout="vertical" onFinish={submitAddProject}>
          <Form.Item name="displayName" label={copy.displayName} rules={[{ required: true }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="slug" label={copy.projectSlug} rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9._-]{0,79}$/ }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="kind" label={copy.rootKind} initialValue="git-repository" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "git-repository", label: copy.gitRepository },
                { value: "directory", label: copy.directory }
              ]}
            />
          </Form.Item>
          {addKind === "git-repository" ? (
            <Form.Item name="repoId" label={copy.repoId} rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9._-]{0,79}$/ }]}>
              <Input autoComplete="off" />
            </Form.Item>
          ) : null}
          <Form.Item name="path" label={copy.localPath} rules={[{ required: true }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Alert type="info" showIcon message={copy.manualPathHint} />
        </Form>
      </Modal>

      <Modal
        open={importOpen}
        width={880}
        footer={null}
        title={copy.discoveryImportTitle}
        onCancel={() => setImportOpen(false)}
        destroyOnHidden
      >
        <Text as="p" type="secondary">{copy.discoveryImportDescription}</Text>
        <SourceStrip sources={sources} locale={locale} />
        {discoveryTruncated ? <Alert type="warning" showIcon message={copy.discoveryTruncated} /> : null}
        {discoveryError ? <Alert type="error" showIcon message={discoveryError} /> : null}
        <div className="project-discovery-candidates">
          {discoveryLoading ? (
            <div className="project-discovery-candidates__loading"><Spin /></div>
          ) : candidates.length === 0 ? (
            <Empty description={copy.noDiscoveryCandidates} />
          ) : (
            candidates.map((candidate) => (
              <article className="project-discovery-candidate" key={candidate.candidateId}>
                <div className="project-discovery-candidate__main">
                  <div className="project-discovery-candidate__title-row">
                    <strong>{candidate.name}</strong>
                    <Tag>{projectRootKindLabel(locale, candidate.kind)}</Tag>
                    <Tag color={candidate.registration === "registered" ? "success" : "processing"}>
                      {candidate.registration === "registered" ? copy.registered : copy.unregistered}
                    </Tag>
                  </div>
                  <code className="project-discovery-candidate__path">{candidate.privatePath}</code>
                  <div className="project-discovery-candidate__sources" aria-label={copy.discoverySources}>
                    {candidate.sources.map((source) => (
                      <Tag key={source.sourceId}>
                        {source.sourceDisplayName} · {source.signalCount} {copy.sourceSignals}
                      </Tag>
                    ))}
                  </div>
                  <div className="project-discovery-candidate__meta">
                    {candidate.git ? <span>{copy.branch}: <code>{candidate.git.branch ?? "—"}</code></span> : null}
                    <span>{copy.lastObserved}: <strong>{formatObserved(candidate.latestObservedAt, locale)}</strong></span>
                  </div>
                </div>
                {candidate.registration === "registered" ? (
                  <Tag>{candidate.existingProjectSlug ?? candidate.existingRootId ?? copy.registered}</Tag>
                ) : (
                  <div className="project-discovery-candidate__actions">
                    <Button onClick={() => {
                      setImportOpen(false);
                      openAddProject(candidate);
                    }}>
                      {copy.createFromCandidate}
                    </Button>
                    <Button type="primary" onClick={() => openAttach(candidate)} disabled={projects.length === 0}>
                      {copy.attachToProject}
                    </Button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(attachCandidate)}
        title={copy.attachToProject}
        okText={copy.attachToProject}
        cancelText={copy.cancel}
        confirmLoading={attachLoading}
        onCancel={() => setAttachCandidate(null)}
        onOk={() => void attachForm.submit()}
        destroyOnHidden
      >
        {attachCandidate ? (
          <Form form={attachForm} layout="vertical" onFinish={submitAttach}>
            <Form.Item name="projectId" label={copy.targetProject} rules={[{ required: true }]}>
              <Select
                options={projects.map(({ project }) => ({ label: project.displayName, value: project.id }))}
              />
            </Form.Item>
            <Form.Item name="role" label={copy.rootRole} rules={[{ required: true }]}>
              <Select
                options={[
                  { value: "supporting-source", label: copy.supportingSource },
                  { value: "documentation", label: copy.documentation },
                  { value: "knowledge", label: copy.knowledge },
                  { value: "assets", label: copy.assets }
                ]}
              />
            </Form.Item>
            <Form.Item name="access" label={copy.rootAccess} rules={[{ required: true }]}>
              <Select
                options={[
                  { value: "read-write", label: copy.readWrite },
                  { value: "read-only", label: copy.readOnly }
                ]}
              />
            </Form.Item>
            {attachCandidate.kind === "git-repository" ? (
              <Form.Item name="repoId" label={copy.repoId} rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9._-]{0,79}$/ }]}>
                <Input autoComplete="off" />
              </Form.Item>
            ) : null}
            <code className="project-discovery-candidate__path">{attachCandidate.privatePath}</code>
          </Form>
        ) : null}
      </Modal>

      <WorkspaceOnboardingDrawer
        open={discoveryLocationsOpen}
        locale={locale}
        token={token}
        projects={projects}
        onClose={() => setDiscoveryLocationsOpen(false)}
        onImported={async () => {
          await loadProjects();
          setDiscoveryLocationsOpen(false);
        }}
      />
    </section>
  );
}

function SourceStrip({
  sources,
  locale
}: {
  sources: ProjectRootDiscoverySourceSnapshot[];
  locale: LocaleCode;
}) {
  const copy = getProjectsCopy(locale);
  if (sources.length === 0) return null;
  return (
    <div className="project-discovery-sources" aria-label={copy.discoverySources}>
      {sources.map((source) => (
        <Tag key={source.id} color={source.status === "ready" ? "success" : "default"}>
          {source.displayName}
          {source.status === "ready"
            ? ` · ${source.inspectedContexts}`
            : ` · ${copy.sourceUnavailable}`}
        </Tag>
      ))}
    </div>
  );
}

function ProjectRow({
  locale,
  projection,
  onOpen
}: {
  locale: LocaleCode;
  projection: ProjectRegistryProjection;
  onOpen: () => void;
}) {
  const copy = getProjectsCopy(locale);
  const { project, roots, workspaces } = projection;
  const primaryRoot = roots.find((root) => root.primary) ?? null;
  const primaryWorkspace = primaryRoot
    ? workspaces.find((workspace) => primaryRoot.executionWorkspaceIds.includes(workspace.id)) ?? null
    : null;
  const needsAttention =
    !primaryRoot ||
    primaryRoot.status !== "ready" ||
    Boolean(primaryWorkspace && (primaryWorkspace.status !== "ready" || primaryWorkspace.dirty));

  return (
    <article className="project-center-row panel">
      <button className="project-center-row__open" type="button" onClick={onOpen}>
        <span className="project-center-row__icon"><ApartmentOutlined /></span>
        <span className="project-center-row__identity">
          <strong>{project.displayName}</strong>
          <code>{project.slug}</code>
        </span>
      </button>

      <div className="project-center-row__root">
        <span className="project-center-row__label">{copy.primaryRoot}</span>
        {primaryRoot ? (
          <div className="project-center-row__root-main">
            <strong>{projectRootRoleLabel(locale, primaryRoot.role)}</strong>
            <Tag>{projectRootKindLabel(locale, primaryRoot.kind)}</Tag>
            <Tag color={primaryRoot.status === "ready" ? "success" : "warning"}>
              {primaryRoot.status === "ready" ? copy.ready : primaryRoot.status === "missing" ? copy.missing : copy.blocked}
            </Tag>
          </div>
        ) : <span>—</span>}
      </div>

      <div className="project-center-row__workspace">
        {primaryWorkspace ? (
          <>
            <div className="project-center-row__workspace-main">
              <strong>{primaryWorkspace.repoId}</strong>
              <Tag color={primaryWorkspace.dirty ? "warning" : "success"}>
                {primaryWorkspace.dirty ? copy.dirty : copy.clean}
              </Tag>
            </div>
            <div className="project-center-row__workspace-meta">
              <span>{copy.branch}: <code>{primaryWorkspace.branch ?? "—"}</code></span>
              <span>{copy.head}: <code>{shortCommit(primaryWorkspace.headCommit)}</code></span>
            </div>
          </>
        ) : (
          <span className="project-center-row__muted">{copy.noExecutionWorkspace}</span>
        )}
      </div>

      <div className="project-center-row__counts">
        <span>{copy.projectRoots} <strong>{roots.length}</strong></span>
        <span>{copy.executionWorkspaces} <strong>{workspaces.length}</strong></span>
      </div>

      <div className="project-center-row__end">
        <Tag color={needsAttention ? "warning" : "success"}>
          {needsAttention ? copy.readinessAttention : copy.readinessReady}
        </Tag>
        <Button type="link" onClick={onOpen}>{copy.openProject}</Button>
      </div>
    </article>
  );
}

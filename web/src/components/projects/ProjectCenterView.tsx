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
  GlobalOutlined,
  ImportOutlined,
  LaptopOutlined,
  MoreOutlined,
  ProjectOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  attachProjectRoot,
  createProject,
  fetchProductActions,
  fetchProjectDiscovery,
  fetchProjects,
  reconcileNativeProjects
} from "../../api";
import type { LocaleCode } from "../../i18n";
import {
  getProjectsCopy,
  projectRootKindLabel,
  projectRootRoleLabel
} from "../../i18n/projects";
import type {
  ApiProblem,
  ProductActionTargetAvailability,
  ProjectRegistryProjection,
  ProjectRootDiscoveryCandidate,
  ProjectRootDiscoveryGroup,
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
  path: string;
}

type AddProjectLocation = "local" | "remote";

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
  const [projectRootTargets, setProjectRootTargets] = useState<ProductActionTargetAvailability[]>([]);
  const [projectDiscoveryTargets, setProjectDiscoveryTargets] = useState<ProductActionTargetAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addStep, setAddStep] = useState<0 | 1>(0);
  const [addLocation, setAddLocation] = useState<AddProjectLocation>("local");
  const [importOpen, setImportOpen] = useState(false);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ProjectRootDiscoveryCandidate[]>([]);
  const [groups, setGroups] = useState<ProjectRootDiscoveryGroup[]>([]);
  const [sources, setSources] = useState<ProjectRootDiscoverySourceSnapshot[]>([]);
  const [groupLoadingId, setGroupLoadingId] = useState<string | null>(null);
  const [discoveryTruncated, setDiscoveryTruncated] = useState(false);
  const [attachCandidate, setAttachCandidate] = useState<ProjectRootDiscoveryCandidate | null>(null);
  const [attachLoading, setAttachLoading] = useState(false);
  const [discoveryLocationsOpen, setDiscoveryLocationsOpen] = useState(false);
  const nativeAssociationAttempted = useRef(false);
  const [addForm] = Form.useForm<AddProjectFormValues>();
  const [attachForm] = Form.useForm<AttachRootFormValues>();
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
      const [initialResponse, actionResponse] = await Promise.all([
        fetchProjects(),
        fetchProductActions().catch(() => null)
      ]);
      const rootTargets =
        actionResponse?.actions.find((action) => action.id === "project.root.manage")?.targets ?? [];
      const discoveryTargets =
        actionResponse?.actions.find((action) => action.id === "project.discovery")?.targets ?? [];
      const nativeAssociationTargets =
        actionResponse?.actions.find((action) => action.id === "project.native.associate")?.targets ?? [];
      const localNativeAssociationAvailable = nativeAssociationTargets.some(
        (target) => target.locality === "local" && target.availability === "available-local"
      );

      setProjects(initialResponse.projects);
      setConfigRevision(initialResponse.configRevision);
      setProjectRootTargets(rootTargets);
      setProjectDiscoveryTargets(discoveryTargets);

      if (localNativeAssociationAvailable && !nativeAssociationAttempted.current) {
        nativeAssociationAttempted.current = true;
        void (async () => {
          try {
            const reconciled = await reconcileNativeProjects();
            if (reconciled.created.length === 0) return;
            const refreshed = await fetchProjects();
            setProjects(refreshed.projects);
            setConfigRevision(refreshed.configRevision);
          } catch {
            nativeAssociationAttempted.current = false;
          }
        })();
      }
    } catch (loadError) {
      setProjects([]);
      setConfigRevision(null);
      setProjectRootTargets([]);
      setProjectDiscoveryTargets([]);
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

  const localProjectTarget = projectRootTargets.find((target) => target.locality === "local") ?? null;
  const remoteProjectTargets = projectRootTargets.filter((target) => target.locality === "remote");
  const localProjectAvailable = localProjectTarget?.availability === "available-local";
  const localProjectAvailabilityHint = !localProjectTarget
    ? copy.actionAvailabilityUnknown
    : localProjectTarget.availability === "requires-local-host"
      ? copy.localHostRequired
      : localProjectTarget.availability === "available-local"
        ? null
        : copy.actionUnavailable;
  const remoteProjectAvailabilityHint = remoteProjectTargets.length === 0
    ? copy.noRemoteTargets
    : copy.remoteProjectUnavailable;
  const localDiscoveryAvailable = projectDiscoveryTargets.some(
    (target) => target.locality === "local" && target.availability === "available-local"
  );

  const openAddProject = useCallback((candidate?: ProjectRootDiscoveryCandidate) => {
    addForm.resetFields();
    addForm.setFieldsValue({
      displayName: candidate?.name ?? "",
      path: candidate?.privatePath ?? ""
    });
    setAddLocation("local");
    setAddStep(candidate ? 1 : 0);
    setAddOpen(true);
  }, [addForm]);

  const submitAddProject = async (values: AddProjectFormValues) => {
    if (!configRevision || addLocation !== "local" || !localProjectAvailable) return;
    setAddLoading(true);
    try {
      const result = await createProject({
        displayName: values.displayName.trim(),
        root: {
          path: values.path.trim(),
          role: "primary-source",
          access: "read-write"
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
      setGroups(response.groups);
      setSources(response.sources);
      setDiscoveryTruncated(response.truncated);
      setConfigRevision(response.configRevision);
    } catch (loadError) {
      setCandidates([]);
      setGroups([]);
      setSources([]);
      setDiscoveryError(problemMessage(loadError, copy.requestFailed));
    } finally {
      setDiscoveryLoading(false);
    }
  }, [copy.requestFailed]);

  const openImport = () => {
    if (!localDiscoveryAvailable) return;
    setImportOpen(true);
    void loadDiscovery();
  };

  const groupedCandidateIds = useMemo(
    () => new Set(groups.flatMap((group) => group.candidateIds)),
    [groups]
  );

  const createDiscoveredGroup = async (group: ProjectRootDiscoveryGroup) => {
    if (!configRevision || group.registration !== "unregistered") return;
    const members = group.candidateIds
      .map((candidateId) => candidates.find((candidate) => candidate.candidateId === candidateId) ?? null)
      .filter((candidate): candidate is ProjectRootDiscoveryCandidate => Boolean(candidate));
    if (members.length === 0) return;

    setGroupLoadingId(group.groupId);
    try {
      const [primary, ...additional] = members;
      let result = await createProject({
        displayName: group.name,
        root: {
          path: primary.privatePath,
          kind: primary.kind,
          role: "primary-source",
          access: "read-write"
        },
        expectedConfigRevision: configRevision
      });
      let revision = result.configRevision;
      for (const candidate of additional) {
        result = await attachProjectRoot(result.project.id, {
          path: candidate.privatePath,
          kind: candidate.kind,
          role: "supporting-source",
          access: "read-write",
          expectedConfigRevision: revision
        });
        revision = result.configRevision;
      }
      setConfigRevision(revision);
      await Promise.all([loadProjects(), loadDiscovery()]);
      setImportOpen(false);
      message.success(copy.operationSucceeded);
      onOpenProject(result.project.id);
    } catch (actionError) {
      message.error(problemMessage(actionError, copy.operationFailed));
    } finally {
      setGroupLoadingId(null);
    }
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
          <Button
            type="primary"
            icon={<ImportOutlined />}
            disabled={!localDiscoveryAvailable}
            title={!localDiscoveryAvailable ? copy.localHostRequired : undefined}
            onClick={openImport}
          >
            {copy.importExisting}
          </Button>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [{
                key: "discovery-locations",
                icon: <SettingOutlined />,
                label: copy.discoveryLocations,
                disabled: !localDiscoveryAvailable,
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
              <Button
                type="primary"
                icon={<ImportOutlined />}
                disabled={!localDiscoveryAvailable}
                title={!localDiscoveryAvailable ? copy.localHostRequired : undefined}
                onClick={openImport}
              >
                {copy.importExisting}
              </Button>
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
        footer={[
          <Button key="cancel" onClick={() => setAddOpen(false)}>{copy.cancel}</Button>,
          ...(addStep === 0
            ? [
                <Button
                  key="next"
                  type="primary"
                  disabled={addLocation !== "local" || !localProjectAvailable}
                  onClick={() => setAddStep(1)}
                >
                  {copy.next}
                </Button>
              ]
            : [
                <Button key="back" onClick={() => setAddStep(0)}>{copy.back}</Button>,
                <Button key="create" type="primary" loading={addLoading} onClick={() => void addForm.submit()}>
                  {copy.create}
                </Button>
              ])
        ]}
        onCancel={() => setAddOpen(false)}
        destroyOnHidden
      >
        {addStep === 0 ? (
          <div className="project-add-location-grid" aria-label={copy.projectLocation}>
            <button
              type="button"
              className={`project-add-location-card${addLocation === "local" ? " is-selected" : ""}${!localProjectAvailable ? " is-disabled" : ""}`}
              disabled={!localProjectAvailable}
              onClick={() => setAddLocation("local")}
            >
              <span className="project-add-location-card__icon"><LaptopOutlined /></span>
              <strong>{copy.localProject}</strong>
              <span>{copy.localProjectDescription}</span>
              {localProjectAvailabilityHint ? <small>{localProjectAvailabilityHint}</small> : null}
            </button>
            <button
              type="button"
              className="project-add-location-card is-disabled"
              disabled
            >
              <span className="project-add-location-card__icon"><GlobalOutlined /></span>
              <strong>{copy.remoteProject}</strong>
              <span>{copy.remoteProjectDescription}</span>
              <small>{remoteProjectAvailabilityHint}</small>
            </button>
          </div>
        ) : (
          <>
            <Text as="p" type="secondary">{copy.addProjectDescription}</Text>
            <Form form={addForm} layout="vertical" onFinish={submitAddProject}>
              <Form.Item name="displayName" label={copy.displayName} rules={[{ required: true }]}>
                <Input autoComplete="off" placeholder={copy.projectNamePlaceholder} />
              </Form.Item>
              <Form.Item name="path" label={copy.sourceFolder} rules={[{ required: true }]}>
                <Input autoComplete="off" placeholder={copy.sourceFolderPlaceholder} />
              </Form.Item>
              <Alert type="info" showIcon message={copy.manualPathHint} />
            </Form>
          </>
        )}
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
        <SourceStrip sources={sources} groups={groups} candidates={candidates} locale={locale} />
        {discoveryTruncated ? <Alert type="warning" showIcon message={copy.discoveryTruncated} /> : null}
        {discoveryError ? <Alert type="error" showIcon message={discoveryError} /> : null}
        <div className="project-discovery-candidates">
          {discoveryLoading ? (
            <div className="project-discovery-candidates__loading"><Spin /></div>
          ) : candidates.length === 0 ? (
            <Empty description={copy.noDiscoveryCandidates} />
          ) : (
            <>
              {groups.map((group) => (
                <DiscoveryProjectGroupCard
                  key={group.groupId}
                  locale={locale}
                  group={group}
                  candidates={candidates}
                  loading={groupLoadingId === group.groupId}
                  onCreate={() => void createDiscoveredGroup(group)}
                />
              ))}
              {candidates.filter((candidate) => !groupedCandidateIds.has(candidate.candidateId)).map((candidate) => (
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
              ))}
            </>
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

function DiscoveryProjectGroupCard({
  locale,
  group,
  candidates,
  loading,
  onCreate
}: {
  locale: LocaleCode;
  group: ProjectRootDiscoveryGroup;
  candidates: ProjectRootDiscoveryCandidate[];
  loading: boolean;
  onCreate: () => void;
}) {
  const copy = getProjectsCopy(locale);
  const members = group.candidateIds
    .map((candidateId) => candidates.find((candidate) => candidate.candidateId === candidateId) ?? null)
    .filter((candidate): candidate is ProjectRootDiscoveryCandidate => Boolean(candidate));
  const signalCount = members.reduce((total, candidate) => {
    const source = candidate.sources.find((entry) => entry.sourceId === group.sourceId);
    return total + (source?.signalCount ?? 0);
  }, 0);
  const registrationLabel = group.registration === "registered"
    ? copy.registered
    : group.registration === "partially-registered"
      ? copy.partiallyRegistered
      : copy.unregistered;
  const registrationColor = group.registration === "registered"
    ? "success"
    : group.registration === "partially-registered"
      ? "warning"
      : "processing";

  return (
    <article className="project-discovery-group">
      <div className="project-discovery-group__header">
        <div className="project-discovery-group__identity">
          <div className="project-discovery-candidate__title-row">
            <strong>{group.name}</strong>
            <Tag>{group.sourceDisplayName}</Tag>
            <Tag color={registrationColor}>{registrationLabel}</Tag>
          </div>
          <span className="project-discovery-group__summary">
            {members.length} {copy.sourceCandidates} · {signalCount} {copy.sourceSignals}
          </span>
        </div>
        {group.registration === "registered" ? (
          <Tag>{group.existingProjectSlug ?? copy.registered}</Tag>
        ) : group.registration === "unregistered" ? (
          <Button type="primary" loading={loading} onClick={onCreate}>
            {copy.createFromCandidate}
          </Button>
        ) : null}
      </div>
      <div className="project-discovery-group__roots">
        {members.map((candidate) => (
          <div className="project-discovery-group__root" key={candidate.candidateId}>
            <div className="project-discovery-group__root-title">
              <strong>{candidate.name}</strong>
              <Tag>{projectRootKindLabel(locale, candidate.kind)}</Tag>
              {candidate.git ? <span>{copy.branch}: <code>{candidate.git.branch ?? "—"}</code></span> : null}
            </div>
            <code className="project-discovery-candidate__path">{candidate.privatePath}</code>
          </div>
        ))}
      </div>
      <div className="project-discovery-candidate__meta">
        <span>{copy.lastObserved}: <strong>{formatObserved(group.latestObservedAt, locale)}</strong></span>
      </div>
    </article>
  );
}

function SourceStrip({
  sources,
  groups,
  candidates,
  locale
}: {
  sources: ProjectRootDiscoverySourceSnapshot[];
  groups: ProjectRootDiscoveryGroup[];
  candidates: ProjectRootDiscoveryCandidate[];
  locale: LocaleCode;
}) {
  const copy = getProjectsCopy(locale);
  if (sources.length === 0) return null;
  return (
    <div className="project-discovery-sources" aria-label={copy.discoverySources}>
      {sources.map((source) => {
        const sourceCandidates = candidates.filter((candidate) =>
          candidate.sources.some((candidateSource) => candidateSource.sourceId === source.id)
        );
        const sourceGroups = groups.filter((group) => group.sourceId === source.id);
        const groupedIds = new Set(sourceGroups.flatMap((group) => group.candidateIds));
        const projectCount = sourceGroups.length + sourceCandidates.filter(
          (candidate) => !groupedIds.has(candidate.candidateId)
        ).length;
        return (
          <Tag
            key={source.id}
            color={source.status === "ready" ? "success" : "default"}
            title={source.status === "ready" ? `${source.inspectedContexts} ${copy.sourceSignals}` : undefined}
          >
            {source.displayName}
            {source.status === "ready"
              ? ` · ${projectCount} ${copy.sourceProjects} · ${sourceCandidates.length} ${copy.sourceCandidates}`
              : ` · ${copy.sourceUnavailable}`}
          </Tag>
        );
      })}
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

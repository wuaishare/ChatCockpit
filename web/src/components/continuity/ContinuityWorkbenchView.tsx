import { Button, Menu, Select, Tag } from "antd";
import type { MenuProps } from "antd";
import { Text } from "@lobehub/ui";
import {
  ApartmentOutlined,
  AuditOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  FileTextOutlined,
  ProjectOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SwapOutlined
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchContinuityProjects,
  fetchWorkspaceContinuitySnapshot
} from "../../api";
import { getUiCopy, type LocaleCode } from "../../i18n";
import type {
  ApiProblem,
  ContinuityProjectProjection,
  ContinuitySectionKey,
  ContinuityWorkspaceSnapshot,
  ContinuityWorkspaceStatus
} from "../../types";
import { StateNotice } from "../StateNotice";
import { WorkspaceContinuityPanel } from "./WorkspaceContinuityPanel";

interface ContinuityWorkbenchViewProps {
  locale: LocaleCode;
  token: string | null;
  authRequired: boolean;
  activeSection: ContinuitySectionKey;
  onSectionChange: (section: ContinuitySectionKey) => void;
}

const SECTION_ICONS: Record<ContinuitySectionKey, React.ReactNode> = {
  projects: <ProjectOutlined />,
  documents: <FileTextOutlined />,
  tasks: <CheckSquareOutlined />,
  sessions: <CodeOutlined />,
  handoffs: <SwapOutlined />,
  evidence: <SafetyCertificateOutlined />,
  approvals: <AuditOutlined />
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as ApiProblem).message || fallback);
  }
  return fallback;
}

function shortCommit(value: string | null): string {
  return value ? value.slice(0, 12) : "—";
}

export function ContinuityWorkbenchView({
  locale,
  token,
  authRequired,
  activeSection,
  onSectionChange
}: ContinuityWorkbenchViewProps) {
  const copy = getUiCopy(locale).continuity;
  const [projects, setProjects] = useState<ContinuityProjectProjection[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ContinuityWorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const protectedView = authRequired && !token?.trim();

  const loadProjects = useCallback(async () => {
    if (protectedView) {
      setProjects([]);
      setSelectedWorkspaceId(null);
      setSnapshot(null);
      setError(null);
      setSnapshotError(null);
      setLoading(false);
      setSnapshotLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetchContinuityProjects(token);
      setProjects(response.projects);
      setSelectedWorkspaceId((current) => {
        const workspaceIds = new Set(
          response.projects.flatMap(({ workspaces }) =>
            workspaces.map((workspace) => workspace.id)
          )
        );
        if (current && workspaceIds.has(current)) return current;
        const preferred = response.projects.find(
          ({ project, workspaces }) =>
            project.defaultWorkspaceId &&
            workspaces.some(
              (workspace) => workspace.id === project.defaultWorkspaceId
            )
        );
        return (
          preferred?.project.defaultWorkspaceId ??
          response.projects[0]?.workspaces[0]?.id ??
          null
        );
      });
    } catch (loadError) {
      setProjects([]);
      setError(errorMessage(loadError, copy.requestFailedTitle));
    } finally {
      setLoading(false);
    }
  }, [copy.requestFailedTitle, protectedView, token]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const loadSnapshot = useCallback(async () => {
    if (protectedView || !selectedWorkspaceId) {
      setSnapshot(null);
      setSnapshotError(null);
      setSnapshotLoading(false);
      return;
    }
    setSnapshotLoading(true);
    setSnapshotError(null);
    try {
      const response = await fetchWorkspaceContinuitySnapshot(
        selectedWorkspaceId,
        token
      );
      setSnapshot(response.snapshot);
    } catch (loadError) {
      setSnapshot(null);
      setSnapshotError(errorMessage(loadError, copy.requestFailedTitle));
    } finally {
      setSnapshotLoading(false);
    }
  }, [copy.requestFailedTitle, protectedView, selectedWorkspaceId, token]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const menuItems = useMemo<MenuProps["items"]>(
    () =>
      (Object.keys(copy.sections) as ContinuitySectionKey[]).map((section) => ({
        key: section,
        icon: SECTION_ICONS[section],
        label: copy.sections[section].label
      })),
    [copy.sections]
  );

  const workspaceCount = projects.reduce(
    (total, projection) => total + projection.workspaces.length,
    0
  );
  const readyWorkspaceCount = projects.reduce(
    (total, projection) =>
      total + projection.workspaces.filter((workspace) => workspace.status === "ready").length,
    0
  );
  const workspaceOptions = useMemo(
    () =>
      projects.flatMap(({ project, workspaces }) =>
        workspaces.map((workspace) => ({
          label: `${project.displayName} · ${workspace.repoId}`,
          value: workspace.id
        }))
      ),
    [projects]
  );
  const sectionCopy = copy.sections[activeSection];

  return (
    <section className="continuity-workbench" aria-labelledby="continuity-workbench-title">
      <header className="continuity-workbench__header panel">
        <div>
          <div className="continuity-workbench__title-row">
            <ApartmentOutlined aria-hidden="true" />
            <Text as="h1" id="continuity-workbench-title" className="continuity-workbench__title">
              {copy.shellTitle}
            </Text>
          </div>
          <Text as="p" type="secondary" className="continuity-workbench__description">
            {copy.shellDescription}
          </Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void loadProjects()}
          loading={loading}
          disabled={protectedView}
        >
          {copy.refresh}
        </Button>
      </header>

      <div className="continuity-shell">
        <aside className="continuity-nav panel" aria-label={copy.shellTitle}>
          <Menu
            className="continuity-nav__menu"
            mode="inline"
            selectedKeys={[activeSection]}
            items={menuItems}
            onClick={({ key }) => onSectionChange(key as ContinuitySectionKey)}
          />
          <div className="continuity-nav__integrity">
            <SafetyCertificateOutlined aria-hidden="true" />
            <span>{copy.noFakeData}</span>
          </div>
        </aside>

        <main className="continuity-content panel">
          <header className="continuity-content__header">
            <div>
              <Text as="h2" className="continuity-content__title">
                {sectionCopy.title}
              </Text>
              <Text as="p" type="secondary" className="continuity-content__description">
                {sectionCopy.description}
              </Text>
            </div>
            <div className="continuity-workspace-selector">
              <span>{copy.workspaceSelector}</span>
              <Select
                value={selectedWorkspaceId ?? undefined}
                options={workspaceOptions}
                placeholder={copy.selectWorkspaceHint}
                onChange={setSelectedWorkspaceId}
                disabled={workspaceOptions.length === 0}
              />
            </div>
          </header>

          {protectedView ? (
            <StateNotice
              kind="empty"
              title={copy.protectedTitle}
              description={copy.protectedDescription}
              retryLabel={copy.refresh}
            />
          ) : loading ? (
            <StateNotice
              kind="loading"
              title={copy.loadingTitle}
              description={copy.loadingDescription}
              retryLabel={copy.refresh}
            />
          ) : error ? (
            <StateNotice
              kind="error"
              title={copy.requestFailedTitle}
              description={error}
              retryLabel={copy.refresh}
              onRetry={() => void loadProjects()}
            />
          ) : !selectedWorkspaceId ? (
            <StateNotice
              kind="empty"
              title={copy.noProjectsTitle}
              description={copy.selectWorkspaceHint}
              retryLabel={copy.refresh}
            />
          ) : snapshotLoading ? (
            <StateNotice
              kind="loading"
              title={copy.loadingTitle}
              description={copy.loadingDescription}
              retryLabel={copy.refreshSnapshot}
            />
          ) : snapshotError ? (
            <StateNotice
              kind="error"
              title={copy.requestFailedTitle}
              description={snapshotError}
              retryLabel={copy.refreshSnapshot}
              onRetry={() => void loadSnapshot()}
            />
          ) : snapshot ? (
            <WorkspaceContinuityPanel
              locale={locale}
              token={token}
              snapshot={snapshot}
              activeSection={activeSection}
              onRefresh={loadSnapshot}
              projectsContent={
                <ProjectsSection
                  locale={locale}
                  projects={projects}
                  workspaceCount={workspaceCount}
                  readyWorkspaceCount={readyWorkspaceCount}
                  selectedWorkspaceId={selectedWorkspaceId}
                  onSelectWorkspace={setSelectedWorkspaceId}
                />
              }
            />
          ) : null}
        </main>
      </div>
    </section>
  );
}

function ProjectsSection({
  locale,
  projects,
  workspaceCount,
  readyWorkspaceCount,
  selectedWorkspaceId,
  onSelectWorkspace
}: {
  locale: LocaleCode;
  projects: ContinuityProjectProjection[];
  workspaceCount: number;
  readyWorkspaceCount: number;
  selectedWorkspaceId: string;
  onSelectWorkspace: (workspaceId: string) => void;
}) {
  const copy = getUiCopy(locale).continuity;

  if (projects.length === 0) {
    return (
      <StateNotice
        kind="empty"
        title={copy.noProjectsTitle}
        description={copy.noProjectsDescription}
        retryLabel={copy.refresh}
      />
    );
  }

  return (
    <div className="continuity-projects">
      <div className="continuity-summary" aria-label={copy.sections.projects.title}>
        <SummaryMetric value={projects.length} label={copy.projectCount} />
        <SummaryMetric value={workspaceCount} label={copy.workspaceCount} />
        <SummaryMetric value={readyWorkspaceCount} label={copy.readyWorkspaceCount} />
      </div>

      <div className="continuity-project-list">
        {projects.map(({ project, workspaces }) => (
          <article className="continuity-project" key={project.id}>
            <header className="continuity-project__header">
              <div>
                <div className="continuity-project__name-row">
                  <Text as="h3" className="continuity-project__name">
                    {project.displayName}
                  </Text>
                  <Tag>{copy.statusActive}</Tag>
                </div>
                <code className="continuity-project__slug">{project.slug}</code>
              </div>
              <div className="continuity-project__revision">
                <span>{copy.revision}</span>
                <strong>{project.revision}</strong>
              </div>
            </header>

            <div className="continuity-project__workspace-heading">
              <span>{copy.workspaces}</span>
              <strong>{workspaces.length}</strong>
            </div>
            <div className="continuity-workspace-list">
              {workspaces.map((workspace) => {
                const isDefault = workspace.id === project.defaultWorkspaceId;
                return (
                  <button
                    type="button"
                    className={`continuity-workspace ${
                      selectedWorkspaceId === workspace.id ? "is-selected" : ""
                    }`}
                    key={workspace.id}
                    onClick={() => onSelectWorkspace(workspace.id)}
                  >
                    <div className="continuity-workspace__main">
                      <div className="continuity-workspace__name-row">
                        <strong>{workspace.repoId}</strong>
                        <WorkspaceStatusTag status={workspace.status} locale={locale} />
                        {isDefault ? <Tag color="blue">{copy.defaultWorkspace}</Tag> : null}
                      </div>
                      <div className="continuity-workspace__meta">
                        <span>
                          {copy.branch}: <code>{workspace.branch || "—"}</code>
                        </span>
                        <span>
                          {copy.headCommit}: <code>{shortCommit(workspace.headCommit)}</code>
                        </span>
                        <span>
                          {copy.revision}: <strong>{workspace.revision}</strong>
                        </span>
                      </div>
                    </div>
                    <span
                      className={`continuity-workspace__cleanliness ${
                        workspace.dirty ? "is-dirty" : "is-clean"
                      }`}
                    >
                      {workspace.dirty ? copy.dirty : copy.clean}
                    </span>
                  </button>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function SummaryMetric({ value, label }: { value: number; label: string }) {
  return (
    <div className="continuity-summary__metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function WorkspaceStatusTag({
  status,
  locale
}: {
  status: ContinuityWorkspaceStatus;
  locale: LocaleCode;
}) {
  const copy = getUiCopy(locale).continuity;
  const labelByStatus: Record<ContinuityWorkspaceStatus, string> = {
    ready: copy.statusReady,
    missing: copy.statusMissing,
    blocked: copy.statusBlocked,
    archived: copy.statusArchived
  };
  const colorByStatus: Record<ContinuityWorkspaceStatus, string> = {
    ready: "green",
    missing: "orange",
    blocked: "red",
    archived: "default"
  };
  return <Tag color={colorByStatus[status]}>{labelByStatus[status]}</Tag>;
}


import { Button, Menu, Select } from "antd";
import type { MenuProps } from "antd";
import { UiText as Text } from "../UiText";
import {
  ApartmentOutlined,
  AuditOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
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
  ProductActionsResponse
} from "../../types";
import { StateNotice } from "../StateNotice";
import { WorkspaceContinuityPanel } from "./WorkspaceContinuityPanel";

interface ContinuityWorkbenchViewProps {
  locale: LocaleCode;
  token: string | null;
  authRequired: boolean;
  productActions: ProductActionsResponse | null;
  productActionsError: string | null;
  activeSection: ContinuitySectionKey;
  onSectionChange: (section: ContinuitySectionKey) => void;
  onOpenProjects: () => void;
}

const SECTION_ICONS: Record<ContinuitySectionKey, React.ReactNode> = {
  projects: <FolderOpenOutlined />,
  documents: <FileTextOutlined />,
  tasks: <CheckSquareOutlined />,
  sessions: <CodeOutlined />,
  recovery: <SyncOutlined />,
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

export function ContinuityWorkbenchView({
  locale,
  token,
  authRequired,
  productActions,
  productActionsError,
  activeSection,
  onSectionChange,
  onOpenProjects
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
      (Object.keys(copy.sections) as ContinuitySectionKey[])
        .filter((section) => section !== "projects")
        .map((section) => ({
          key: section,
          icon: SECTION_ICONS[section],
          label: copy.sections[section].label
        })),
    [copy.sections]
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
          onClick={() => void Promise.all([loadProjects(), loadSnapshot()])}
          loading={loading}
          disabled={protectedView}
        >
          {copy.refresh}
        </Button>
      </header>

      <div className="continuity-shell">
        <nav className="continuity-nav panel" aria-label={copy.shellTitle}>
          <Menu
            className="continuity-nav__menu"
            mode="horizontal"
            selectedKeys={[activeSection]}
            items={menuItems}
            onClick={({ key }) => onSectionChange(key as ContinuitySectionKey)}
          />
        </nav>

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
              <div className="continuity-workspace-selector__controls">
                <Select
                  value={selectedWorkspaceId ?? undefined}
                  options={workspaceOptions}
                  placeholder={copy.selectWorkspaceHint}
                  onChange={setSelectedWorkspaceId}
                  disabled={workspaceOptions.length === 0}
                />
                <Button
                  icon={<FolderOpenOutlined />}
                  onClick={onOpenProjects}
                  disabled={protectedView}
                >
                  {copy.openProjectCenter}
                </Button>
              </div>
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
              productActions={productActions}
              productActionsError={productActionsError}
              activeSection={activeSection}
              onRefresh={loadSnapshot}
              onSectionChange={onSectionChange}
            />
          ) : null}
        </main>
      </div>
    </section>
  );
}

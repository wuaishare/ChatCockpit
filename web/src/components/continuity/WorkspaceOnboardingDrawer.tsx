import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Popconfirm,
  Space,
  Spin,
  Tag
} from "antd";
import {
  DeleteOutlined,
  FolderAddOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  addDiscoveryRoot,
  fetchWorkspaceDiscoveryRoots,
  importWorkspaceCandidate,
  removeDiscoveryRoot,
  scanWorkspaceDiscoveryRoot
} from "../../api";
import { getUiCopy, type LocaleCode } from "../../i18n";
import type {
  ApiProblem,
  ContinuityProjectProjection,
  WorkspaceDiscoveryCandidate,
  WorkspaceDiscoveryRoot,
  WorkspaceDiscoveryScanResponse
} from "../../types";

interface WorkspaceOnboardingDrawerProps {
  open: boolean;
  locale: LocaleCode;
  token: string | null;
  projects: ContinuityProjectProjection[];
  onClose: () => void;
  onImported: (workspaceId: string) => Promise<void> | void;
}

function problem(error: unknown): ApiProblem | null {
  if (!error || typeof error !== "object") return null;
  if ("message" in error) return error as ApiProblem;
  return null;
}

function message(error: unknown, fallback: string): string {
  const parsed = problem(error);
  return parsed?.message || (error instanceof Error ? error.message : fallback);
}

function newImportKey(): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `workspace-ui-import:${suffix}`;
}

export function WorkspaceOnboardingDrawer({
  open,
  locale,
  token,
  projects,
  onClose,
  onImported
}: WorkspaceOnboardingDrawerProps) {
  const copy = getUiCopy(locale).continuity;
  const [configRevision, setConfigRevision] = useState<string | null>(null);
  const [roots, setRoots] = useState<WorkspaceDiscoveryRoot[]>([]);
  const [rootPath, setRootPath] = useState("");
  const [scan, setScan] = useState<WorkspaceDiscoveryScanResponse | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<WorkspaceDiscoveryCandidate | null>(null);
  const [repoId, setRepoId] = useState("");
  const [importKey, setImportKey] = useState(newImportKey);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [machineLocalBlocked, setMachineLocalBlocked] = useState(false);

  const registeredWorkspaceCount = useMemo(
    () => projects.reduce((total, projection) => total + projection.workspaces.length, 0),
    [projects]
  );

  const resetCandidate = useCallback(() => {
    setScan(null);
    setSelectedCandidate(null);
    setRepoId("");
    setImportKey(newImportKey());
  }, []);

  const loadRoots = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setMachineLocalBlocked(false);
    try {
      const response = await fetchWorkspaceDiscoveryRoots(token);
      setConfigRevision(response.configRevision);
      setRoots(response.roots);
    } catch (loadError) {
      const parsed = problem(loadError);
      setRoots([]);
      setConfigRevision(null);
      if (
        parsed?.code === "MACHINE_LOCAL_AUTHORITY_REQUIRED" ||
        parsed?.status === 404
      ) {
        setMachineLocalBlocked(true);
      } else {
        setError(message(loadError, copy.requestFailedTitle));
      }
    } finally {
      setLoading(false);
    }
  }, [copy.requestFailedTitle, open, token]);

  useEffect(() => {
    if (!open) return;
    resetCandidate();
    void loadRoots();
  }, [loadRoots, open, resetCandidate]);

  const handleAddRoot = async () => {
    if (!configRevision || !rootPath.trim()) return;
    setActionLoading(true);
    setError(null);
    try {
      const response = await addDiscoveryRoot(rootPath.trim(), configRevision, token);
      setConfigRevision(response.configRevision);
      setRoots(response.roots);
      setRootPath("");
      resetCandidate();
    } catch (actionError) {
      setError(message(actionError, copy.operationFailed));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveRoot = async (root: WorkspaceDiscoveryRoot) => {
    if (!configRevision) return;
    setActionLoading(true);
    setError(null);
    try {
      const response = await removeDiscoveryRoot(root.id, configRevision, token);
      setConfigRevision(response.configRevision);
      setRoots(response.roots);
      if (scan?.root.id === root.id) resetCandidate();
    } catch (actionError) {
      setError(message(actionError, copy.operationFailed));
    } finally {
      setActionLoading(false);
    }
  };

  const handleScan = async (root: WorkspaceDiscoveryRoot) => {
    if (!configRevision) return;
    setActionLoading(true);
    setError(null);
    setSelectedCandidate(null);
    setRepoId("");
    try {
      const response = await scanWorkspaceDiscoveryRoot(root.id, configRevision, token);
      setScan(response);
      setConfigRevision(response.configRevision);
    } catch (actionError) {
      setError(message(actionError, copy.operationFailed));
    } finally {
      setActionLoading(false);
    }
  };

  const selectCandidate = (candidate: WorkspaceDiscoveryCandidate) => {
    if (candidate.registration === "registered") return;
    setSelectedCandidate(candidate);
    setRepoId(candidate.suggestedRepoId);
    setImportKey(newImportKey());
  };

  const handleImport = async () => {
    if (!scan || !selectedCandidate || !configRevision || !repoId.trim()) return;
    setActionLoading(true);
    setError(null);
    try {
      const response = await importWorkspaceCandidate(
        scan.root.id,
        {
          candidateId: selectedCandidate.candidateId,
          repoId: repoId.trim(),
          expectedConfigRevision: configRevision,
          idempotencyKey: importKey
        },
        token
      );
      setConfigRevision(response.configRevision);
      await onImported(response.workspace.id);
      const rescanned = await scanWorkspaceDiscoveryRoot(
        scan.root.id,
        response.configRevision,
        token
      );
      setScan(rescanned);
      setConfigRevision(rescanned.configRevision);
      setSelectedCandidate(null);
      setRepoId("");
      setImportKey(newImportKey());
    } catch (actionError) {
      setError(message(actionError, copy.operationFailed));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <Drawer
      className="continuity-workspace-drawer"
      title={copy.workspaceManagerTitle}
      open={open}
      onClose={onClose}
      width={720}
      destroyOnHidden
    >
      <p className="continuity-workspace-drawer__intro">{copy.workspaceManagerDescription}</p>

      {machineLocalBlocked ? (
        <Alert
          type="warning"
          showIcon
          title={copy.manageWorkspaces}
          description={copy.machineLocalRequired}
        />
      ) : loading ? (
        <div className="continuity-workspace-drawer__loading">
          <Spin />
        </div>
      ) : (
        <Space direction="vertical" size="large" className="continuity-workspace-drawer__stack">
          {error ? (
            <Alert
              type="error"
              showIcon
              title={copy.operationFailed}
              description={error}
              action={<Button onClick={() => void loadRoots()}>{copy.refresh}</Button>}
            />
          ) : null}

          <section className="continuity-workspace-manager__section">
            <div className="continuity-workspace-manager__heading">
              <div>
                <h3>{copy.registeredProjects}</h3>
                <p>{registeredWorkspaceCount} {copy.workspaceCount.toLowerCase()}</p>
              </div>
            </div>
            <div className="continuity-workspace-manager__registered">
              {projects.map(({ project, workspaces }) =>
                workspaces.map((workspace) => (
                  <div className="continuity-workspace-manager__registered-item" key={workspace.id}>
                    <div>
                      <strong>{project.displayName}</strong>
                      <code>{workspace.repoId}</code>
                    </div>
                    <Tag>{workspace.status === "ready" ? copy.statusReady : workspace.status}</Tag>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="continuity-workspace-manager__section">
            <div className="continuity-workspace-manager__heading">
              <div>
                <h3>{copy.discoveryRoots}</h3>
                <p>{copy.discoveryRootHint}</p>
              </div>
            </div>

            <label className="continuity-workspace-manager__field">
              <span>{copy.discoveryRootPath}</span>
              <div className="continuity-workspace-manager__input-row">
                <Input
                  value={rootPath}
                  onChange={(event) => setRootPath(event.target.value)}
                  placeholder={copy.discoveryRootPath}
                  autoComplete="off"
                  disabled={actionLoading || !configRevision}
                  onPressEnter={() => void handleAddRoot()}
                />
                <Button
                  type="primary"
                  icon={<FolderAddOutlined />}
                  onClick={() => void handleAddRoot()}
                  loading={actionLoading}
                  disabled={!rootPath.trim() || !configRevision}
                >
                  {copy.addRoot}
                </Button>
              </div>
            </label>

            {roots.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <div>
                    <strong>{copy.noDiscoveryRoots}</strong>
                    <p>{copy.noDiscoveryRootsDescription}</p>
                  </div>
                }
              />
            ) : (
              <div className="continuity-workspace-manager__roots">
                {roots.map((root) => (
                  <article className="continuity-workspace-manager__root" key={root.id}>
                    <div className="continuity-workspace-manager__root-main">
                      <strong>{root.displayName}</strong>
                      <code title={root.path}>{root.path}</code>
                    </div>
                    <Space wrap>
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={() => void handleScan(root)}
                        loading={actionLoading && scan?.root.id === root.id}
                        disabled={actionLoading}
                      >
                        {copy.scanProjects}
                      </Button>
                      <Popconfirm
                        title={copy.removeRoot}
                        description={copy.permissionNoSiblings}
                        onConfirm={() => void handleRemoveRoot(root)}
                        okText={copy.removeRoot}
                      >
                        <Button danger icon={<DeleteOutlined />} disabled={actionLoading}>
                          {copy.removeRoot}
                        </Button>
                      </Popconfirm>
                    </Space>
                  </article>
                ))}
              </div>
            )}
          </section>

          {scan ? (
            <section className="continuity-workspace-manager__section">
              <div className="continuity-workspace-manager__heading">
                <div>
                  <h3>{copy.discoveredProjects}</h3>
                  <p>{scan.root.displayName}</p>
                </div>
                <Tag>{scan.candidates.length}</Tag>
              </div>
              {scan.truncated ? <Alert type="warning" showIcon message={copy.scanTruncated} /> : null}
              {scan.candidates.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={copy.noCandidates} />
              ) : (
                <div className="continuity-workspace-manager__candidates">
                  {scan.candidates.map((candidate) => (
                    <button
                      type="button"
                      key={candidate.candidateId}
                      className={`continuity-workspace-manager__candidate ${
                        selectedCandidate?.candidateId === candidate.candidateId ? "is-selected" : ""
                      }`}
                      disabled={candidate.registration === "registered"}
                      onClick={() => selectCandidate(candidate)}
                    >
                      <div>
                        <strong>{candidate.name}</strong>
                        <span>
                          {copy.branch}: {candidate.git.branch ?? "—"}
                          {candidate.git.dirty ? ` · ${copy.dirty}` : ` · ${copy.clean}`}
                        </span>
                      </div>
                      <Tag color={candidate.registration === "registered" ? "default" : "blue"}>
                        {candidate.registration === "registered"
                          ? copy.registeredCandidate
                          : copy.unregisteredCandidate}
                      </Tag>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {selectedCandidate ? (
            <section className="continuity-workspace-manager__section continuity-workspace-manager__review">
              <div className="continuity-workspace-manager__heading">
                <div>
                  <h3>{copy.reviewImport}</h3>
                  <p>{selectedCandidate.name}</p>
                </div>
              </div>
              <label className="continuity-workspace-manager__field">
                <span>{copy.repoIdLabel}</span>
                <Input
                  value={repoId}
                  onChange={(event) => setRepoId(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <Alert
                type="info"
                showIcon
                icon={<SafetyCertificateOutlined />}
                title={copy.permissionReview}
                description={
                  <ul className="continuity-workspace-manager__permissions">
                    <li>{copy.permissionExactProject}</li>
                    <li>{copy.permissionNoSiblings}</li>
                  </ul>
                }
              />
              <div className="continuity-workspace-manager__footer">
                <Button
                  type="primary"
                  onClick={() => void handleImport()}
                  loading={actionLoading}
                  disabled={!repoId.trim()}
                >
                  {copy.importProject}
                </Button>
              </div>
            </section>
          ) : null}
        </Space>
      )}
    </Drawer>
  );
}

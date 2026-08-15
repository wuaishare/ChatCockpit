import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Select,
  Space,
  Tabs,
  Tag,
  Tooltip
} from "antd";
import {
  ApiOutlined,
  AppstoreOutlined,
  CloudServerOutlined,
  CodeOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ToolOutlined
} from "@ant-design/icons";
import { Text } from "@lobehub/ui";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  fetchContinuityProjects,
  fetchRuntimeResourceItem,
  fetchRuntimeResourceProfiles,
  inventoryRuntimeResources
} from "../../api";
import { getResourceCenterCopy } from "../../i18n/resources";
import type { LocaleCode } from "../../i18n";
import type {
  ApiProblem,
  ContinuityProjectProjection,
  RuntimeProfileDescriptor,
  RuntimeResourceAuthStatus,
  RuntimeResourceCompatibilityStatus,
  RuntimeResourceDescriptor,
  RuntimeResourceInspectResponse,
  RuntimeResourceInventoryResponse,
  RuntimeResourceKind,
  RuntimeResourceMutationOperation,
  RuntimeResourceScope,
  RuntimeResourceSourceKind,
  RuntimeResourceUpdateStatus
} from "../../types";
import { StateNotice } from "../StateNotice";
import {
  ResourceMutationActivity,
  ResourceMutationReviewModal
} from "./ResourceMutationReview";
import { eligibleMutationsForResource } from "./resource-mutation-model";
import { useResourceMutationWorkflow } from "./use-resource-mutation-workflow";
import "./resource-center.css";

interface ResourceCenterViewProps {
  locale: LocaleCode;
  token: string | null;
  authRequired: boolean;
}

type ResourceTab = "all" | RuntimeResourceKind;

const RESOURCE_TABS: Array<{
  key: ResourceTab;
  icon: ReactNode;
}> = [
  { key: "all", icon: <AppstoreOutlined /> },
  { key: "skill", icon: <CodeOutlined /> },
  { key: "mcp-server", icon: <ApiOutlined /> },
  { key: "plugin", icon: <ToolOutlined /> },
  { key: "runtime-adapter", icon: <CloudServerOutlined /> },
  { key: "acp-agent", icon: <SafetyCertificateOutlined /> }
];

function operationKey(): string {
  return `resources.inventory.web:${crypto.randomUUID()}`;
}

function problemMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as ApiProblem).message || fallback);
  }
  return fallback;
}

function booleanText(value: boolean | null, yes: string, no: string, unknown: string) {
  if (value === null) return unknown;
  return value ? yes : no;
}

function profileTone(
  value: RuntimeProfileDescriptor["compatibilityStatus"]
): string {
  if (value === "ready") return "success";
  if (value === "degraded") return "warning";
  return "error";
}

function resourceTone(value: RuntimeResourceCompatibilityStatus): string {
  if (value === "ready") return "success";
  if (value === "degraded") return "warning";
  if (value === "blocked") return "error";
  return "default";
}

function authTone(value: RuntimeResourceAuthStatus | RuntimeProfileDescriptor["authStatus"]): string {
  if (value === "ready" || value === "not-applicable") return "success";
  if (value === "required") return "warning";
  if (value === "unsupported") return "error";
  return "default";
}

function updateTone(value: RuntimeResourceUpdateStatus): string {
  if (value === "current" || value === "not-applicable") return "success";
  if (value === "update-available") return "warning";
  return "default";
}

export function ResourceCenterView({
  locale,
  token,
  authRequired
}: ResourceCenterViewProps) {
  const copy = getResourceCenterCopy(locale);
  const [profiles, setProfiles] = useState<RuntimeProfileDescriptor[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ContinuityProjectProjection[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [inventory, setInventory] = useState<RuntimeResourceInventoryResponse | null>(null);
  const [activeTab, setActiveTab] = useState<ResourceTab>("all");
  const [profileLoading, setProfileLoading] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspection, setInspection] = useState<RuntimeResourceInspectResponse | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    mutationApproval,
    mutationExecution,
    mutationReviewOpen,
    mutationBusy,
    mutationPendingResourceId,
    mutationError,
    mutationActivity,
    mutationActivityLoading,
    loadMutationActivity,
    prepareMutation,
    approveAndExecuteMutation,
    denyMutation,
    reopenPendingMutation,
    closeMutationReview,
    resetMutationWorkflow
  } = useResourceMutationWorkflow({
    token,
    copy,
    inventory,
    selectedProfileId,
    selectedWorkspaceId,
    setInventory
  });

  const protectedWithoutToken = authRequired && !token?.trim();

  useEffect(() => {
    if (protectedWithoutToken) {
      setProfiles([]);
      setSelectedProfileId(null);
      setInventory(null);
      resetMutationWorkflow();
      setError(null);
      return;
    }
    void loadProfiles();
    void loadWorkspaces();
  }, [token, authRequired]);

  async function loadProfiles(): Promise<void> {
    setProfileLoading(true);
    setError(null);
    try {
      const result = await fetchRuntimeResourceProfiles(token);
      setProfiles(result.profiles);
      setSelectedProfileId((current) =>
        result.profiles.some((profile) => profile.id === current)
          ? current
          : (result.profiles[0]?.id ?? null)
      );
    } catch (loadError) {
      setProfiles([]);
      setSelectedProfileId(null);
      setInventory(null);
      setError(problemMessage(loadError, copy.requestFailedTitle));
    } finally {
      setProfileLoading(false);
    }
  }

  async function loadWorkspaces(): Promise<void> {
    try {
      const result = await fetchContinuityProjects(token);
      setProjects(result.projects);
      const available = result.projects.flatMap((project) => project.workspaces);
      setSelectedWorkspaceId((current) =>
        available.some((workspace) => workspace.id === current)
          ? current
          : (result.projects
              .map((project) =>
                project.workspaces.find(
                  (workspace) => workspace.id === project.project.defaultWorkspaceId
                )
              )
              .find(Boolean)?.id ?? available.find((workspace) => workspace.status === "ready")?.id ?? available[0]?.id ?? null)
      );
    } catch {
      setProjects([]);
      setSelectedWorkspaceId(null);
    }
  }

  async function readInventory(
    runtimeProfileId: string,
    workspaceId: string | null,
    needsWorkspace: boolean
  ): Promise<RuntimeResourceInventoryResponse> {
    return inventoryRuntimeResources(
      {
        runtimeProfileId,
        ...(needsWorkspace && workspaceId ? { workspaceId } : {}),
        idempotencyKey: operationKey()
      },
      token
    );
  }

  async function refreshInventory(): Promise<void> {
    if (!selectedProfileId) return;
    const profile = profiles.find((entry) => entry.id === selectedProfileId) ?? null;
    const needsWorkspace =
      profile?.providerKind === "codex" && profile.protocolKind === "native-app-server";
    if (needsWorkspace && !selectedWorkspaceId) return;
    setInventoryLoading(true);
    setError(null);
    setDrawerOpen(false);
    setInspection(null);
    try {
      const result = await readInventory(
        selectedProfileId,
        selectedWorkspaceId,
        needsWorkspace
      );
      setInventory(result);
      setActiveTab("all");
      if (needsWorkspace && selectedWorkspaceId) {
        await loadMutationActivity(selectedWorkspaceId);
      } else {
        resetMutationWorkflow();
      }
    } catch (inventoryError) {
      setError(problemMessage(inventoryError, copy.requestFailedTitle));
    } finally {
      setInventoryLoading(false);
    }
  }

  async function inspectResource(resource: RuntimeResourceDescriptor): Promise<void> {
    setDrawerOpen(true);
    setInspection(null);
    setInspectLoading(true);
    try {
      setInspection(await fetchRuntimeResourceItem(resource.id, token));
      if (requiresWorkspace && selectedWorkspaceId) {
        await loadMutationActivity(selectedWorkspaceId);
      }
    } catch (inspectError) {
      setDrawerOpen(false);
      setError(problemMessage(inspectError, copy.requestFailedTitle));
    } finally {
      setInspectLoading(false);
    }
  }

  function selectProfile(profileId: string): void {
    if (mutationBusy || profileId === selectedProfileId) return;
    setSelectedProfileId(profileId);
    setInventory(null);
    resetMutationWorkflow();
    setInspection(null);
    setDrawerOpen(false);
    setActiveTab("all");
    setError(null);
  }

  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const requiresWorkspace =
    selectedProfile?.providerKind === "codex" &&
    selectedProfile.protocolKind === "native-app-server";
  const workspaceOptions = useMemo(
    () =>
      projects.flatMap((project) =>
        project.workspaces.map((workspace) => ({
          value: workspace.id,
          label: `${project.project.displayName} · ${workspace.branch ?? workspace.repoId} · ${workspace.status}`,
          disabled: workspace.status !== "ready"
        }))
      ),
    [projects]
  );

  const kindCounts = useMemo(() => {
    const counts = new Map<ResourceTab, number>([["all", inventory?.resources.length ?? 0]]);
    for (const resource of inventory?.resources ?? []) {
      counts.set(resource.kind, (counts.get(resource.kind) ?? 0) + 1);
    }
    return counts;
  }, [inventory]);

  const visibleResources = useMemo(
    () =>
      (inventory?.resources ?? []).filter(
        (resource) => activeTab === "all" || resource.kind === activeTab
      ),
    [activeTab, inventory]
  );

  const kindLabel = (kind: ResourceTab): string => {
    if (kind === "all") return copy.all;
    if (kind === "skill") return copy.skills;
    if (kind === "mcp-server") return copy.mcpServers;
    if (kind === "plugin") return copy.plugins;
    if (kind === "runtime-adapter") return copy.adapters;
    return copy.agents;
  };

  const scopeLabel = (scope: RuntimeResourceScope): string => {
    const labels: Record<RuntimeResourceScope, string> = {
      user: copy.userScope,
      workspace: copy.workspaceScope,
      runtime: copy.runtimeScope,
      registry: copy.registryScope,
      unknown: copy.unknownScope
    };
    return labels[scope];
  };

  const authLabel = (
    status: RuntimeResourceAuthStatus | RuntimeProfileDescriptor["authStatus"]
  ): string => {
    if (status === "ready") return copy.ready;
    if (status === "required") return copy.required;
    if (status === "unsupported") return copy.unsupported;
    if (status === "not-applicable") return copy.notApplicable;
    return copy.unknown;
  };

  const compatibilityLabel = (
    status: RuntimeResourceCompatibilityStatus | RuntimeProfileDescriptor["compatibilityStatus"]
  ): string => {
    if (status === "ready") return copy.ready;
    if (status === "degraded") return copy.degraded;
    if (status === "blocked") return copy.blocked;
    if (status === "unsupported") return copy.unsupported;
    if (status === "unavailable") return copy.unavailable;
    return copy.unknown;
  };

  const updateLabel = (status: RuntimeResourceUpdateStatus): string => {
    if (status === "current") return copy.current;
    if (status === "update-available") return copy.updateAvailable;
    if (status === "not-applicable") return copy.notApplicable;
    return copy.unknown;
  };

  const sourceLabel = (source: RuntimeResourceSourceKind): string => {
    if (source === "runtime-native") return copy.runtimeNative;
    if (source === "tokenpilot-local") return copy.legacyLocal;
    return copy.acpRegistry;
  };

  const mutationLabel = (operation: RuntimeResourceMutationOperation): string => {
    if (operation === "skill.enable") return copy.skillEnable;
    if (operation === "skill.disable") return copy.skillDisable;
    if (operation === "plugin.install") return copy.pluginInstall;
    return copy.pluginUninstall;
  };

  if (protectedWithoutToken) {
    return (
      <div className="view-stack">
        <StateNotice
          kind="empty"
          title={copy.protectedTitle}
          description={copy.protectedDescription}
          retryLabel={copy.refreshInventory}
        />
      </div>
    );
  }

  if (profileLoading && profiles.length === 0) {
    return (
      <div className="view-stack">
        <StateNotice
          kind="loading"
          title={copy.loadingTitle}
          description={copy.loadingDescription}
          retryLabel={copy.refreshInventory}
        />
      </div>
    );
  }

  return (
    <div className="view-stack resource-center">
      <section className="resource-center__hero panel" aria-labelledby="resource-center-title">
        <div>
          <Text as="h1" id="resource-center-title" className="resource-center__title">
            {copy.title}
          </Text>
          <Text as="p" type="secondary" className="resource-center__description">
            {copy.description}
          </Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void loadProfiles()}
          loading={profileLoading}
          disabled={mutationBusy}
        >
          {copy.profilesTitle}
        </Button>
      </section>

      <Alert
        className="resource-center__truth"
        type="info"
        showIcon
        icon={<SafetyCertificateOutlined />}
        message={copy.truthNotice}
      />

      {error ? (
        <StateNotice
          kind="error"
          title={copy.requestFailedTitle}
          description={error}
          retryLabel={copy.refreshInventory}
          onRetry={() => void loadProfiles()}
        />
      ) : null}

      <section className="resource-center__profiles panel" aria-labelledby="runtime-profiles-title">
        <div className="resource-center__section-header">
          <div>
            <Text as="h2" id="runtime-profiles-title" className="resource-center__section-title">
              {copy.profilesTitle}
            </Text>
            <Text as="p" type="secondary" className="resource-center__section-description">
              {copy.profilesDescription}
            </Text>
          </div>
          <div className="resource-center__inventory-controls">
            {requiresWorkspace ? (
              <div className="resource-center__workspace-picker">
                <span>{copy.workspace}</span>
                <Select
                  value={selectedWorkspaceId ?? undefined}
                  options={workspaceOptions}
                  disabled={mutationBusy}
                  placeholder={copy.workspaceUnavailable}
                  onChange={(value) => {
                    setSelectedWorkspaceId(value);
                    setInventory(null);
                    resetMutationWorkflow();
                  }}
                />
              </div>
            ) : null}
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              loading={inventoryLoading}
              disabled={
                mutationBusy ||
                !selectedProfile ||
                (requiresWorkspace && !selectedWorkspaceId)
              }
              onClick={() => void refreshInventory()}
            >
              {inventoryLoading ? copy.refreshingInventory : copy.refreshInventory}
            </Button>
          </div>
        </div>

        {requiresWorkspace && workspaceOptions.length === 0 ? (
          <Alert
            className="resource-center__workspace-alert"
            type="warning"
            showIcon
            message={copy.workspaceRequired}
            description={copy.workspaceUnavailable}
          />
        ) : null}

        {profiles.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div>
                <Text as="div" strong>{copy.noProfilesTitle}</Text>
                <Text as="div" type="secondary">{copy.noProfilesDescription}</Text>
              </div>
            }
          />
        ) : (
          <div className="resource-center__profile-grid">
            {profiles.map((profile) => {
              const selected = profile.id === selectedProfileId;
              return (
                <button
                  key={profile.id}
                  type="button"
                  className={`resource-center__profile-card${selected ? " resource-center__profile-card--selected" : ""}`}
                  aria-pressed={selected}
                  disabled={mutationBusy}
                  onClick={() => selectProfile(profile.id)}
                >
                  <div className="resource-center__profile-heading">
                    <div>
                      <Text as="div" strong className="resource-center__profile-name">
                        {profile.displayName}
                      </Text>
                      <Text as="div" type="secondary" className="resource-center__profile-provider">
                        {profile.providerKind} · {profile.protocolKind}
                      </Text>
                    </div>
                    {selected ? <Tag color="processing">{copy.selected}</Tag> : null}
                  </div>
                  <div className="resource-center__profile-status">
                    <Tag color={profileTone(profile.compatibilityStatus)}>
                      {compatibilityLabel(profile.compatibilityStatus)}
                    </Tag>
                    <Tag color={authTone(profile.authStatus)}>{authLabel(profile.authStatus)}</Tag>
                  </div>
                  <dl className="resource-center__profile-facts">
                    <div><dt>{copy.version}</dt><dd>{profile.executableVersion ?? copy.unknown}</dd></div>
                    <div><dt>{copy.protocol}</dt><dd>{profile.protocolVersion ?? profile.protocolKind}</dd></div>
                    <div><dt>{copy.source}</dt><dd>{profile.executableSource ?? copy.unknown}</dd></div>
                    <div><dt>{copy.capabilities}</dt><dd>{profile.capabilities.length}</dd></div>
                  </dl>
                  {profile.publicReason ? (
                    <Text as="div" type="secondary" className="resource-center__profile-reason">
                      {profile.publicReason}
                    </Text>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {!inventory ? (
        <section className="resource-center__empty panel">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div>
                <Text as="div" strong>{copy.inventoryEmptyTitle}</Text>
                <Text as="div" type="secondary">{copy.inventoryEmptyDescription}</Text>
              </div>
            }
          />
        </section>
      ) : (
        <>
          <section className="resource-center__snapshot panel" aria-labelledby="resource-snapshot-title">
            <div className="resource-center__section-header">
              <div>
                <Text as="h2" id="resource-snapshot-title" className="resource-center__section-title">
                  {copy.snapshotTitle}
                </Text>
                <Text as="p" type="secondary" className="resource-center__section-description">
                  {copy.snapshotDescription}
                </Text>
              </div>
              <Tag color={inventory.snapshot.status === "ready" ? "success" : inventory.snapshot.status === "partial" ? "warning" : "error"}>
                {inventory.snapshot.status}
              </Tag>
            </div>

            <div className="resource-center__metrics" role="list" aria-label={copy.snapshotTitle}>
              <div role="listitem"><span>{copy.resources}</span><strong>{inventory.resources.length}</strong></div>
              <div role="listitem"><span>{copy.added}</span><strong>{inventory.diff.added.length}</strong></div>
              <div role="listitem"><span>{copy.changed}</span><strong>{inventory.diff.changed.length}</strong></div>
              <div role="listitem"><span>{copy.removed}</span><strong>{inventory.diff.removed.length}</strong></div>
              <div role="listitem"><span>{copy.unchanged}</span><strong>{inventory.diff.unchanged.length}</strong></div>
            </div>

            <div className="resource-center__snapshot-meta">
              <span>{copy.capturedAt}: {new Date(inventory.snapshot.capturedAt).toLocaleString(locale)}</span>
              <span>{copy.diagnostics}: {inventory.diagnostics.length}</span>
              <span>{inventory.replayed ? copy.replayed : copy.liveRead}</span>
            </div>

            {inventory.diagnostics.length > 0 ? (
              <div className="resource-center__diagnostics">
                {inventory.diagnostics.map((diagnostic) => (
                  <div key={`${diagnostic.source}:${diagnostic.code ?? diagnostic.status}`} className="resource-center__diagnostic">
                    <Tag color={diagnostic.status === "ready" ? "success" : diagnostic.status === "degraded" ? "warning" : "error"}>
                      {diagnostic.status}
                    </Tag>
                    <Text as="span" strong>{diagnostic.source}</Text>
                    <Text as="span" type="secondary">{diagnostic.message ?? diagnostic.code ?? copy.none}</Text>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {!inventory.mutationWritesEnabled && inventory.mutationEligibility.length > 0 ? (
            <Alert
              className="resource-center__mutation-gate"
              type="warning"
              showIcon
              message={copy.mutationExposureDisabled}
            />
          ) : null}

          <section className="resource-center__inventory panel" aria-label={copy.resources}>
            <Tabs
              activeKey={activeTab}
              onChange={(key) => setActiveTab(key as ResourceTab)}
              items={RESOURCE_TABS.map((tab) => ({
                key: tab.key,
                label: (
                  <span className="resource-center__tab-label">
                    {tab.icon}
                    <span>{kindLabel(tab.key)}</span>
                    <span className="resource-center__tab-count">{kindCounts.get(tab.key) ?? 0}</span>
                  </span>
                )
              }))}
            />

            {visibleResources.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <div>
                    <Text as="div" strong>{copy.noResourcesTitle}</Text>
                    <Text as="div" type="secondary">{copy.noResourcesDescription}</Text>
                  </div>
                }
              />
            ) : (
              <div className="resource-center__table-scroll">
                <table className="resource-center__table">
                  <thead>
                    <tr>
                      <th scope="col">{copy.resourceName}</th>
                      <th scope="col">{copy.scope}</th>
                      <th scope="col">{copy.enabled}</th>
                      <th scope="col">{copy.auth}</th>
                      <th scope="col">{copy.compatibility}</th>
                      <th scope="col">{copy.update}</th>
                      <th scope="col" className="resource-center__table-action">{copy.mutationActions}</th>
                      <th scope="col" className="resource-center__table-action">{copy.details}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleResources.map((resource) => {
                      const mutation = eligibleMutationsForResource(inventory, resource.id)[0];
                      const mutationDisabled = !inventory.mutationWritesEnabled || mutationBusy;
                      return (
                        <tr key={resource.id}>
                          <td>
                            <div className="resource-center__resource-name">
                              <Text as="div" strong>{resource.displayName}</Text>
                              <Text as="div" type="secondary" className="resource-center__resource-meta">
                                {resource.version ?? copy.unknown} · {resource.sourceLabel}
                              </Text>
                            </div>
                          </td>
                          <td><Tag>{scopeLabel(resource.scope)}</Tag></td>
                          <td>
                            <Tag color={resource.enabled === true ? "success" : resource.enabled === false ? "default" : undefined}>
                              {booleanText(resource.enabled, copy.yes, copy.no, copy.unknown)}
                            </Tag>
                          </td>
                          <td><Tag color={authTone(resource.authStatus)}>{authLabel(resource.authStatus)}</Tag></td>
                          <td><Tag color={resourceTone(resource.compatibilityStatus)}>{compatibilityLabel(resource.compatibilityStatus)}</Tag></td>
                          <td><Tag color={updateTone(resource.updateStatus)}>{updateLabel(resource.updateStatus)}</Tag></td>
                          <td className="resource-center__table-action">
                            {mutation ? (
                              <Tooltip
                                title={
                                  inventory.mutationWritesEnabled
                                    ? mutation.publicReason
                                    : copy.mutationExposureDisabled
                                }
                              >
                                <span>
                                  <Button
                                    danger={mutation.operation === "plugin.uninstall"}
                                    disabled={mutationDisabled}
                                    loading={
                                      mutationBusy && mutationPendingResourceId === resource.id
                                    }
                                    onClick={() =>
                                      void prepareMutation(resource, mutation.operation)
                                    }
                                  >
                                    {mutationLabel(mutation.operation)}
                                  </Button>
                                </span>
                              </Tooltip>
                            ) : (
                              <Tag>{copy.mutationUnavailable}</Tag>
                            )}
                          </td>
                          <td className="resource-center__table-action">
                            <Button type="link" onClick={() => void inspectResource(resource)}>
                              {copy.inspect}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {requiresWorkspace && selectedWorkspaceId ? (
            <ResourceMutationActivity
              locale={locale}
              copy={copy}
              activity={mutationActivity}
              loading={mutationActivityLoading}
              onReviewApproval={reopenPendingMutation}
            />
          ) : null}
        </>
      )}

      <ResourceMutationReviewModal
        locale={locale}
        copy={copy}
        open={mutationReviewOpen}
        approval={mutationApproval}
        execution={mutationExecution}
        busy={mutationBusy}
        error={mutationError}
        onApproveAndExecute={() => void approveAndExecuteMutation()}
        onDeny={() => void denyMutation()}
        onCancel={closeMutationReview}
      />

      <Drawer
        title={copy.resourceDetailsTitle}
        width={480}
        open={drawerOpen}
        loading={inspectLoading}
        onClose={() => setDrawerOpen(false)}
      >
        {inspection ? (
          <div className="resource-center__drawer">
            <div className="resource-center__drawer-heading">
              <div>
                <Text as="div" strong className="resource-center__drawer-title">
                  {inspection.resource.displayName}
                </Text>
                <Text as="div" type="secondary">{inspection.resource.kind}</Text>
              </div>
              <Space size={4} wrap>
                <Tag color={resourceTone(inspection.resource.compatibilityStatus)}>
                  {compatibilityLabel(inspection.resource.compatibilityStatus)}
                </Tag>
                <Tag>{scopeLabel(inspection.resource.scope)}</Tag>
              </Space>
            </div>

            {inspection.resource.description ? (
              <Text as="p" type="secondary" className="resource-center__drawer-description">
                {inspection.resource.description}
              </Text>
            ) : null}

            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label={copy.externalId}>{inspection.resource.externalId}</Descriptions.Item>
              <Descriptions.Item label={copy.version}>{inspection.resource.version ?? copy.unknown}</Descriptions.Item>
              <Descriptions.Item label={copy.availableVersion}>{inspection.resource.availableVersion ?? copy.unknown}</Descriptions.Item>
              <Descriptions.Item label={copy.installed}>{booleanText(inspection.resource.installed, copy.yes, copy.no, copy.unknown)}</Descriptions.Item>
              <Descriptions.Item label={copy.enabled}>{booleanText(inspection.resource.enabled, copy.yes, copy.no, copy.unknown)}</Descriptions.Item>
              <Descriptions.Item label={copy.auth}><Tag color={authTone(inspection.resource.authStatus)}>{authLabel(inspection.resource.authStatus)}</Tag></Descriptions.Item>
              <Descriptions.Item label={copy.update}><Tag color={updateTone(inspection.resource.updateStatus)}>{updateLabel(inspection.resource.updateStatus)}</Tag></Descriptions.Item>
              <Descriptions.Item label={copy.source}>{sourceLabel(inspection.resource.sourceKind)} · {inspection.resource.sourceLabel}</Descriptions.Item>
              <Descriptions.Item label={copy.capabilities}>
                <Space size={[4, 4]} wrap>
                  {inspection.resource.capabilities.length > 0
                    ? inspection.resource.capabilities.map((capability) => <Tag key={capability}>{capability}</Tag>)
                    : copy.none}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label={copy.reason}>{inspection.resource.publicReason ?? copy.none}</Descriptions.Item>
              <Descriptions.Item label={copy.capturedAt}>{new Date(inspection.snapshot.capturedAt).toLocaleString(locale)}</Descriptions.Item>
              <Descriptions.Item label={copy.fingerprint}>
                <Tooltip title={inspection.resource.fingerprint}>
                  <code className="resource-center__fingerprint">{inspection.resource.fingerprint.slice(0, 16)}…</code>
                </Tooltip>
              </Descriptions.Item>
            </Descriptions>

            <Alert
              type="info"
              showIcon
              icon={<InfoCircleOutlined />}
              message={copy.truthNotice}
            />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

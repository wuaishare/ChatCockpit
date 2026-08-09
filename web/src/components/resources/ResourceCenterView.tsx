import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
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
  fetchRuntimeResourceItem,
  fetchRuntimeResourceProfiles,
  inventoryRuntimeResources
} from "../../api";
import { getResourceCenterCopy } from "../../i18n/resources";
import type { LocaleCode } from "../../i18n";
import type {
  ApiProblem,
  RuntimeProfileDescriptor,
  RuntimeResourceAuthStatus,
  RuntimeResourceCompatibilityStatus,
  RuntimeResourceDescriptor,
  RuntimeResourceInspectResponse,
  RuntimeResourceInventoryResponse,
  RuntimeResourceKind,
  RuntimeResourceScope,
  RuntimeResourceSourceKind,
  RuntimeResourceUpdateStatus
} from "../../types";
import { StateNotice } from "../StateNotice";
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
  const [inventory, setInventory] = useState<RuntimeResourceInventoryResponse | null>(null);
  const [activeTab, setActiveTab] = useState<ResourceTab>("all");
  const [profileLoading, setProfileLoading] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspection, setInspection] = useState<RuntimeResourceInspectResponse | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const protectedWithoutToken = authRequired && !token?.trim();

  useEffect(() => {
    if (protectedWithoutToken) {
      setProfiles([]);
      setSelectedProfileId(null);
      setInventory(null);
      setError(null);
      return;
    }
    void loadProfiles();
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

  async function refreshInventory(): Promise<void> {
    if (!selectedProfileId) return;
    setInventoryLoading(true);
    setError(null);
    setDrawerOpen(false);
    setInspection(null);
    try {
      const result = await inventoryRuntimeResources(
        {
          runtimeProfileId: selectedProfileId,
          idempotencyKey: operationKey()
        },
        token
      );
      setInventory(result);
      setActiveTab("all");
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
    } catch (inspectError) {
      setDrawerOpen(false);
      setError(problemMessage(inspectError, copy.requestFailedTitle));
    } finally {
      setInspectLoading(false);
    }
  }

  function selectProfile(profileId: string): void {
    if (profileId === selectedProfileId) return;
    setSelectedProfileId(profileId);
    setInventory(null);
    setInspection(null);
    setDrawerOpen(false);
    setActiveTab("all");
    setError(null);
  }

  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ?? null;

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
    if (source === "tokenpilot-local") return copy.tokenpilotLocal;
    return copy.acpRegistry;
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
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            loading={inventoryLoading}
            disabled={!selectedProfile}
            onClick={() => void refreshInventory()}
          >
            {inventoryLoading ? copy.refreshingInventory : copy.refreshInventory}
          </Button>
        </div>

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
                      <th scope="col" className="resource-center__table-action">{copy.details}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleResources.map((resource) => (
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
                          <Button type="link" onClick={() => void inspectResource(resource)}>
                            {copy.inspect}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

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

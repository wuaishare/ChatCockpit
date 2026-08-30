import { useEffect, useState } from "react";
import { Button, Modal, Popconfirm, Segmented, Select, Spin, Tag } from "antd";
import { CopyButton } from "./CopyButton";
import { UiText as Text } from "./UiText";
import {
  fetchOAuthAuthorizationGrants,
  fetchOAuthGrantDeviceAccess,
  grantOAuthDeviceAccess,
  revokeOAuthAuthorizationGrant,
  revokeOAuthDeviceAccess
} from "../api";
import type {
  GptConfigModel,
  IntegrationStatusResponse,
  OAuthAuthorizationGrantStatus,
  OAuthAuthorizationGrantSummary,
  OAuthDeviceAccessLevel,
  OAuthGrantDeviceAccessList
} from "../types";
import type { LocaleCode } from "../i18n";
import { getIntegrationsCopy } from "../i18n/integrations";
import type { OperationalStatusTone } from "../status-language";
import { SectionCard } from "./SectionCard";

type OAuthGrantFilter = OAuthAuthorizationGrantStatus | "all";

interface IntegrationsViewProps {
  locale: LocaleCode;
  status: IntegrationStatusResponse;
  config: GptConfigModel | null;
  configError: string | null;
  onRefresh?: () => Promise<void> | void;
}

export function IntegrationsView({
  locale,
  status,
  config,
  configError,
  onRefresh
}: IntegrationsViewProps) {
  const copy = getIntegrationsCopy(locale);
  const oauthLabel = status.mcp.oauthStatus === "ready"
    ? copy.ready
    : status.mcp.oauthStatus === "disabled"
      ? copy.disabled
      : copy.needsAttention;
  const oauthTagColor: OperationalStatusTone = status.mcp.oauthStatus === "ready"
    ? "success"
    : status.mcp.oauthStatus === "disabled"
      ? "default"
      : "warning";
  const compatibilityInstructions = config?.instructions ?? "";
  const schemaImportUrl = config?.schemaImportUrl ?? status.openapiUrl;
  const [grants, setGrants] = useState<OAuthAuthorizationGrantSummary[]>([]);
  const [grantFilter, setGrantFilter] = useState<OAuthGrantFilter>("active");
  const [grantsEnabled, setGrantsEnabled] = useState(true);
  const [grantsLoading, setGrantsLoading] = useState(true);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);
  const [expandedDeviceAccessGrantId, setExpandedDeviceAccessGrantId] = useState<string | null>(null);
  const [deviceAccessByGrant, setDeviceAccessByGrant] = useState<Record<string, OAuthGrantDeviceAccessList>>({});
  const [deviceAccessLoadingGrantId, setDeviceAccessLoadingGrantId] = useState<string | null>(null);
  const [deviceAccessErrorByGrant, setDeviceAccessErrorByGrant] = useState<Record<string, string | null>>({});
  const [mutatingDeviceAccessKey, setMutatingDeviceAccessKey] = useState<string | null>(null);

  const loadGrants = async () => {
    setGrantsLoading(true);
    setGrantError(null);
    try {
      const response = await fetchOAuthAuthorizationGrants();
      setGrantsEnabled(response.enabled);
      setGrants(response.grants);
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error
        ? Number(error.status)
        : null;
      setGrantError(
        status === 404
          ? copy.grantApiVersionMismatch
          : typeof error === "object" && error && "message" in error && typeof error.message === "string"
            ? error.message
            : copy.grantLoadFailed
      );
    } finally {
      setGrantsLoading(false);
    }
  };

  useEffect(() => {
    void loadGrants();
  }, []);

  const revokeGrant = async (grantId: string) => {
    if (revokingGrantId) return;
    setRevokingGrantId(grantId);
    setGrantError(null);
    try {
      const updated = await revokeOAuthAuthorizationGrant(grantId);
      setGrants((current) => current.map((grant) => grant.id === updated.id ? updated : grant));
      setDeviceAccessByGrant((current) => {
        const existing = current[grantId];
        if (!existing) return current;
        return {
          ...current,
          [grantId]: {
            ...existing,
            grantRevoked: true,
            devices: existing.devices.map((device) => ({ ...device, effective: false }))
          }
        };
      });
      await onRefresh?.();
    } catch (error) {
      setGrantError(
        typeof error === "object" && error && "message" in error && typeof error.message === "string"
          ? error.message
          : copy.grantRevokeFailed
      );
    } finally {
      setRevokingGrantId(null);
    }
  };

  const loadDeviceAccess = async (grantId: string) => {
    if (deviceAccessLoadingGrantId) return;
    setDeviceAccessLoadingGrantId(grantId);
    setDeviceAccessErrorByGrant((current) => ({ ...current, [grantId]: null }));
    try {
      const response = await fetchOAuthGrantDeviceAccess(grantId);
      setDeviceAccessByGrant((current) => ({ ...current, [grantId]: response.access }));
    } catch (error) {
      setDeviceAccessErrorByGrant((current) => ({
        ...current,
        [grantId]: typeof error === "object" && error && "message" in error && typeof error.message === "string"
          ? error.message
          : copy.deviceAccessLoadFailed
      }));
    } finally {
      setDeviceAccessLoadingGrantId(null);
    }
  };

  const toggleDeviceAccess = async (grantId: string) => {
    if (expandedDeviceAccessGrantId === grantId) {
      setExpandedDeviceAccessGrantId(null);
      return;
    }
    if (deviceAccessLoadingGrantId && deviceAccessLoadingGrantId !== grantId) return;
    setExpandedDeviceAccessGrantId(grantId);
    if (!deviceAccessByGrant[grantId]) {
      await loadDeviceAccess(grantId);
    }
  };

  const setDeviceAccessLevel = async (
    grantId: string,
    deviceId: string,
    accessLevel: OAuthDeviceAccessLevel
  ) => {
    const key = `${grantId}:${deviceId}`;
    if (mutatingDeviceAccessKey) return;
    setMutatingDeviceAccessKey(key);
    setDeviceAccessErrorByGrant((current) => ({ ...current, [grantId]: null }));
    try {
      const response = await grantOAuthDeviceAccess(grantId, deviceId, accessLevel);
      setDeviceAccessByGrant((current) => ({ ...current, [grantId]: response.access }));
    } catch (error) {
      setDeviceAccessErrorByGrant((current) => ({
        ...current,
        [grantId]: typeof error === "object" && error && "message" in error && typeof error.message === "string"
          ? error.message
          : copy.deviceAccessMutationFailed
      }));
    } finally {
      setMutatingDeviceAccessKey(null);
    }
  };

  const requestDeviceAccessLevel = (
    grantId: string,
    deviceId: string,
    accessLevel: OAuthDeviceAccessLevel
  ) => {
    if (accessLevel !== "full-access") {
      void setDeviceAccessLevel(grantId, deviceId, accessLevel);
      return;
    }
    Modal.confirm({
      title: copy.deviceAccessFullAccessTitle,
      content: copy.deviceAccessFullAccessDescription,
      okText: copy.deviceAccessFullAccessConfirm,
      cancelText: copy.deviceAccessFullAccessCancel,
      okButtonProps: { danger: true },
      onOk: async () => {
        await setDeviceAccessLevel(grantId, deviceId, accessLevel);
      }
    });
  };

  const removeDeviceAccess = async (grantId: string, deviceId: string) => {
    const key = `${grantId}:${deviceId}`;
    if (mutatingDeviceAccessKey) return;
    setMutatingDeviceAccessKey(key);
    setDeviceAccessErrorByGrant((current) => ({ ...current, [grantId]: null }));
    try {
      const response = await revokeOAuthDeviceAccess(grantId, deviceId);
      setDeviceAccessByGrant((current) => ({ ...current, [grantId]: response.access }));
    } catch (error) {
      setDeviceAccessErrorByGrant((current) => ({
        ...current,
        [grantId]: typeof error === "object" && error && "message" in error && typeof error.message === "string"
          ? error.message
          : copy.deviceAccessMutationFailed
      }));
    } finally {
      setMutatingDeviceAccessKey(null);
    }
  };

  const grantStatus = (value: OAuthAuthorizationGrantStatus) => {
    switch (value) {
      case "active": return { label: copy.grantStatusActive, color: "success" };
      case "pending": return { label: copy.grantStatusPending, color: "processing" };
      case "revoked": return { label: copy.grantStatusRevoked, color: "default" };
      default: return { label: copy.grantStatusInactive, color: "warning" };
    }
  };

  const formatTime = (value: string | null) => value
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value))
    : "—";

  const deviceAccessLevelOptions: Array<{ value: OAuthDeviceAccessLevel; label: string }> = [
    { value: "read-only", label: copy.deviceAccessLevelReadOnly },
    { value: "project-write", label: copy.deviceAccessLevelProjectWrite },
    { value: "project-exec", label: copy.deviceAccessLevelProjectExec },
    { value: "full-access", label: copy.deviceAccessLevelFullAccess }
  ];
  const grantCounts: Record<OAuthAuthorizationGrantStatus, number> = {
    active: grants.filter((grant) => grant.status === "active").length,
    pending: grants.filter((grant) => grant.status === "pending").length,
    inactive: grants.filter((grant) => grant.status === "inactive").length,
    revoked: grants.filter((grant) => grant.status === "revoked").length
  };
  const visibleGrants = grantFilter === "all"
    ? grants
    : grants.filter((grant) => grant.status === grantFilter);
  const grantFilterOptions = [
    { value: "active", label: `${copy.grantFilterActive} ${grantCounts.active}` },
    { value: "pending", label: `${copy.grantFilterPending} ${grantCounts.pending}` },
    { value: "inactive", label: `${copy.grantFilterInactive} ${grantCounts.inactive}` },
    { value: "revoked", label: `${copy.grantFilterRevoked} ${grantCounts.revoked}` },
    { value: "all", label: `${copy.grantFilterAll} ${grants.length}` }
  ];

  return (
    <div className="view-stack">
      <SectionCard
        title={copy.chatgptTitle}
        description={copy.chatgptDescription}
        extra={<Tag color="processing">{copy.primaryTag}</Tag>}
      >
        <div className="gpt-facts">
          <div className="gpt-fact">
            <span>{copy.mcpEndpoint}</span>
            <strong>{status.mcp.endpoint ?? copy.notConfigured}</strong>
          </div>
          <div className="gpt-fact">
            <span>{copy.oauthStatus}</span>
            <strong><Tag color={oauthTagColor}>{oauthLabel}</Tag></strong>
          </div>
          <div className="gpt-fact">
            <span>{copy.oauthScope}</span>
            <strong>{status.mcp.scope}</strong>
          </div>
          <div className="gpt-fact">
            <span>{copy.authorizedClients}</span>
            <strong>{status.mcp.authorizedClientCount}</strong>
          </div>
          <div className="gpt-fact">
            <span>{copy.activeAuthorizationGrants}</span>
            <strong>{status.mcp.activeAuthorizationGrantCount}</strong>
          </div>
          <div className="gpt-fact">
            <span>{copy.activeAccessTokens}</span>
            <strong>{status.mcp.activeAccessTokenCount}</strong>
          </div>
          <div className="gpt-fact">
            <span>{copy.activeRefreshTokens}</span>
            <strong>{status.mcp.activeRefreshTokenCount}</strong>
          </div>
          <div className="gpt-fact">
            <span>{copy.toolCatalog}</span>
            <strong>{status.mcp.toolCount} {copy.tools}</strong>
          </div>
        </div>
        <div className={`section-note ${status.mcp.oauthReady ? "" : "section-note--warning"}`}>
          <strong>{copy.reconnectGuidance}</strong>
          <span>{status.mcp.oauthReady ? copy.reconnectReady : copy.reconnectNeedsAttention}</span>
        </div>
      </SectionCard>

      <SectionCard
        title={copy.authorizationGrantsTitle}
        description={copy.authorizationGrantsDescription}
        extra={<Tag color={grantError ? "warning" : undefined}>{grantError ? copy.needsAttention : grants.length}</Tag>}
      >
        {grantError ? (
          <div className="section-note section-note--warning">{grantError}</div>
        ) : grantsLoading ? (
          <div className="oauth-grants__loading"><Spin size="small" /> <span>{copy.loadingTitle}</span></div>
        ) : !grantsEnabled || grants.length === 0 ? (
          <div className="notes-block">{copy.authorizationGrantsEmpty}</div>
        ) : (
          <>
            <Segmented
              className="oauth-grants__filters"
              value={grantFilter}
              options={grantFilterOptions}
              onChange={(value) => setGrantFilter(value as OAuthGrantFilter)}
            />
            {visibleGrants.length === 0 ? (
              <div className="notes-block">{copy.authorizationGrantsFilterEmpty}</div>
            ) : (
          <div className="oauth-grants">
            {visibleGrants.map((grant) => {
              const meta = grantStatus(grant.status);
              return (
                <div
                  className={`oauth-grant-card${expandedDeviceAccessGrantId === grant.id ? " oauth-grant-card--expanded" : ""}`}
                  key={grant.id}
                >
                  <div className="oauth-grant-card__header">
                    <div className="oauth-grant-card__title">
                      <strong>{grant.displayLabel}</strong>
                      <Tag color={meta.color}>{meta.label}</Tag>
                      {grant.legacy ? <Tag>{copy.grantLegacy}</Tag> : null}
                    </div>
                    <div className="oauth-grant-card__actions">
                      <Button
                        size="small"
                        onClick={() => void toggleDeviceAccess(grant.id)}
                      >
                        {expandedDeviceAccessGrantId === grant.id
                          ? copy.deviceAccessHide
                          : copy.deviceAccessManage}
                      </Button>
                      <Popconfirm
                        title={copy.revokeGrantTitle}
                        description={copy.revokeGrantDescription}
                        okText={copy.revokeGrantConfirm}
                        cancelText={copy.revokeGrantCancel}
                        okButtonProps={{ danger: true }}
                        disabled={grant.status === "revoked"}
                        onConfirm={() => revokeGrant(grant.id)}
                      >
                        <Button
                          danger
                          size="small"
                          disabled={grant.status === "revoked"}
                          loading={revokingGrantId === grant.id}
                        >
                          {copy.revokeGrant}
                        </Button>
                      </Popconfirm>
                    </div>
                  </div>
                  <div className="oauth-grant-card__facts">
                    <div><span>{copy.grantId}</span><code>{grant.id}</code></div>
                    <div><span>{copy.grantClient}</span><code>{grant.clientRegistrationId}</code></div>
                    <div><span>{copy.grantScope}</span><code>{grant.scope}</code></div>
                    <div><span>{copy.grantCreatedAt}</span><strong>{formatTime(grant.createdAt)}</strong></div>
                    <div><span>{copy.grantLastTokenIssuedAt}</span><strong>{formatTime(grant.lastTokenIssuedAt)}</strong></div>
                    <div><span>{copy.grantActiveTokens}</span><strong>{grant.activeAccessTokenCount} / {grant.activeRefreshTokenCount}</strong></div>
                  </div>
                  {expandedDeviceAccessGrantId === grant.id ? (
                    <div className="oauth-device-access">
                      <div className="oauth-device-access__heading">
                        <div>
                          <strong>{copy.deviceAccessTitle}</strong>
                          <span>{copy.deviceAccessDescription}</span>
                        </div>
                      </div>
                      {deviceAccessErrorByGrant[grant.id] ? (
                        <div className="section-note section-note--warning oauth-device-access__error">
                          <span>{deviceAccessErrorByGrant[grant.id]}</span>
                          {!deviceAccessByGrant[grant.id] ? (
                            <Button
                              size="small"
                              onClick={() => void loadDeviceAccess(grant.id)}
                            >
                              {copy.deviceAccessRetry}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                      {deviceAccessLoadingGrantId === grant.id ? (
                        <div className="oauth-device-access__loading">
                          <Spin size="small" /> <span>{copy.deviceAccessLoading}</span>
                        </div>
                      ) : deviceAccessByGrant[grant.id] ? (
                        <div className="oauth-device-access__list">
                          {deviceAccessByGrant[grant.id].devices.map((device) => {
                            const mutationKey = `${grant.id}:${device.deviceId}`;
                            const statusLabel = device.status === "available"
                              ? copy.deviceAccessAvailable
                              : device.status === "revoked"
                                ? copy.deviceAccessRevoked
                                : copy.deviceAccessMissing;
                            const statusColor: OperationalStatusTone = device.status === "available" ? "success" : "warning";
                            const canSetLevel = !deviceAccessByGrant[grant.id].grantRevoked && device.status === "available";
                            const canRemove = !deviceAccessByGrant[grant.id].grantRevoked && device.granted;
                            return (
                              <div className="oauth-device-access__row" key={device.deviceId}>
                                <div className="oauth-device-access__identity">
                                  <div className="oauth-device-access__name">
                                    <strong>{device.displayName}</strong>
                                    <Tag>{device.locality === "local" ? copy.deviceAccessLocal : copy.deviceAccessRemote}</Tag>
                                    <Tag color={statusColor}>{statusLabel}</Tag>
                                    {device.effective ? <Tag color="success">{copy.deviceAccessEffective}</Tag> : null}
                                  </div>
                                  <div className="oauth-device-access__meta">
                                    <code>{device.deviceId}</code>
                                    {device.platform || device.architecture ? (
                                      <span>{[device.platform, device.architecture].filter(Boolean).join(" · ")}</span>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="oauth-device-access__action">
                                  <Select<OAuthDeviceAccessLevel>
                                    size="small"
                                    className="oauth-device-access__level-select"
                                    value={device.accessLevel ?? undefined}
                                    placeholder={copy.deviceAccessNotGranted}
                                    options={deviceAccessLevelOptions}
                                    disabled={!canSetLevel}
                                    loading={mutatingDeviceAccessKey === mutationKey}
                                    onChange={(accessLevel) => requestDeviceAccessLevel(
                                      grant.id,
                                      device.deviceId,
                                      accessLevel
                                    )}
                                  />
                                  {device.effectiveAccessLevel ? (
                                    <Tag color="processing">
                                      {deviceAccessLevelOptions.find((option) => option.value === device.effectiveAccessLevel)?.label}
                                    </Tag>
                                  ) : null}
                                  <Button
                                    size="small"
                                    danger
                                    disabled={!canRemove}
                                    loading={mutatingDeviceAccessKey === mutationKey}
                                    onClick={() => void removeDeviceAccess(grant.id, device.deviceId)}
                                  >
                                    {copy.deviceAccessRemove}
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard
        title={copy.apiTitle}
        description={copy.apiDescription}
        extra={<Tag>{copy.advancedTag}</Tag>}
      >
        <div className="gpt-facts">
          <div className="gpt-fact">
            <span>{copy.localApiBase}</span>
            <strong>{status.localApiBaseUrl}</strong>
          </div>
          <div className="gpt-fact">
            <span>{copy.publicApiBase}</span>
            <strong>{status.publicApiBaseUrl ?? copy.notConfigured}</strong>
          </div>
          <div className="gpt-fact">
            <span>{copy.openapiUrl}</span>
            <strong>{status.openapiUrl}</strong>
          </div>
          <div className="gpt-fact">
            <span>{copy.machineAuth}</span>
            <strong>{status.machineApi.configured ? copy.configured : copy.notConfigured}</strong>
          </div>
        </div>
        <div className="gpt-inline-note">
          <Text>{copy.apiBoundary}</Text>
        </div>
      </SectionCard>

      <SectionCard
        title={copy.customGptTitle}
        description={copy.customGptDescription}
        extra={<Tag>{copy.compatibilityTag}</Tag>}
      >
        <div className="section-note section-note--warning">
          <strong>{copy.compatibilityTag}</strong>
          <span>{copy.customGptBoundary}</span>
        </div>

        {configError ? <div className="notes-block">{configError}</div> : null}

        <div className="job-detail__block">
          <strong>{copy.instructions}</strong>
          {compatibilityInstructions ? (
            <div className="copy-snippet">
              <pre className="text-snippet">{compatibilityInstructions}</pre>
              <CopyButton
                aria-label={copy.copyInstructions}
                content={compatibilityInstructions}
              />
            </div>
          ) : (
            <div className="notes-block">{copy.notConfigured}</div>
          )}
        </div>

        <div className="job-detail__block">
          <strong>{copy.schemaImportUrl}</strong>
          <div className="gpt-schema-line">
            <pre className="job-detail__preview">{schemaImportUrl}</pre>
            <CopyButton aria-label={copy.copyUrl} content={schemaImportUrl} />
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

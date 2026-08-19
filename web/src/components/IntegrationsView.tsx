import { useEffect, useState } from "react";
import { Button, Popconfirm, Spin, Tag } from "antd";
import { CopyButton, Text } from "@lobehub/ui";
import { ClipboardCopy } from "lucide-react";
import { fetchOAuthAuthorizationGrants, revokeOAuthAuthorizationGrant } from "../api";
import type {
  GptConfigModel,
  IntegrationStatusResponse,
  OAuthAuthorizationGrantStatus,
  OAuthAuthorizationGrantSummary
} from "../types";
import type { LocaleCode } from "../i18n";
import { getIntegrationsCopy } from "../i18n/integrations";
import { SectionCard } from "./SectionCard";

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
  const oauthTagColor = status.mcp.oauthStatus === "ready"
    ? "success"
    : status.mcp.oauthStatus === "disabled"
      ? "default"
      : "warning";
  const compatibilityInstructions = config?.instructions ?? "";
  const schemaImportUrl = config?.schemaImportUrl ?? status.openapiUrl;
  const [grants, setGrants] = useState<OAuthAuthorizationGrantSummary[]>([]);
  const [grantsEnabled, setGrantsEnabled] = useState(true);
  const [grantsLoading, setGrantsLoading] = useState(true);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);

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
          <div className="oauth-grants">
            {grants.map((grant) => {
              const meta = grantStatus(grant.status);
              return (
                <div className="oauth-grant-card" key={grant.id}>
                  <div className="oauth-grant-card__header">
                    <div className="oauth-grant-card__title">
                      <strong>{grant.displayLabel}</strong>
                      <Tag color={meta.color}>{meta.label}</Tag>
                      {grant.legacy ? <Tag>{copy.grantLegacy}</Tag> : null}
                    </div>
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
                  <div className="oauth-grant-card__facts">
                    <div><span>{copy.grantId}</span><code>{grant.id}</code></div>
                    <div><span>{copy.grantClient}</span><code>{grant.clientRegistrationId}</code></div>
                    <div><span>{copy.grantScope}</span><code>{grant.scope}</code></div>
                    <div><span>{copy.grantCreatedAt}</span><strong>{formatTime(grant.createdAt)}</strong></div>
                    <div><span>{copy.grantLastTokenIssuedAt}</span><strong>{formatTime(grant.lastTokenIssuedAt)}</strong></div>
                    <div><span>{copy.grantActiveTokens}</span><strong>{grant.activeAccessTokenCount} / {grant.activeRefreshTokenCount}</strong></div>
                  </div>
                </div>
              );
            })}
          </div>
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
                icon={ClipboardCopy}
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
            <CopyButton aria-label={copy.copyUrl} content={schemaImportUrl} icon={ClipboardCopy} />
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

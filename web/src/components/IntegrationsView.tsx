import { Tag } from "antd";
import { CopyButton, Text } from "@lobehub/ui";
import { ClipboardCopy } from "lucide-react";
import type { GptConfigModel, IntegrationStatusResponse } from "../types";
import type { LocaleCode } from "../i18n";
import { getIntegrationsCopy } from "../i18n/integrations";
import { SectionCard } from "./SectionCard";

interface IntegrationsViewProps {
  locale: LocaleCode;
  status: IntegrationStatusResponse;
  config: GptConfigModel | null;
  configError: string | null;
}

export function IntegrationsView({
  locale,
  status,
  config,
  configError
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

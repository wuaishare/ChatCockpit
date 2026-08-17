import { Button, Input, Select, Tag } from "antd";
import { CopyButton, Text } from "@lobehub/ui";
import { ClipboardCopy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LocaleCode } from "../i18n";
import { getPublicAccessCopy } from "../i18n/public-access";
import type {
  ConnectivityProviderDetection,
  ConnectivityProviderMachineAction,
  ConnectivityProviderPublicSnapshot,
  ConnectivityProviderPublicStatus,
  IntegrationStatusResponse,
  PublicRouteCandidateSnapshot,
  PublicRouteCandidateSource
} from "../types";
import { SectionCard } from "./SectionCard";

interface PublicAccessViewProps {
  locale: LocaleCode;
  status: IntegrationStatusResponse;
  exposed: boolean;
  providerStatus: ConnectivityProviderPublicSnapshot | null;
  providerStatusError: string | null;
  routeStatus: PublicRouteCandidateSnapshot | null;
  routeStatusError: string | null;
  routeMutating: boolean;
  onStageCandidate: (origin: string, source: PublicRouteCandidateSource) => void;
  onDiscardCandidate: () => void;
  onOpenIntegrations: () => void;
}

function EndpointValue({
  value,
  fallback,
  copyLabel,
  openable = false
}: {
  value: string | null;
  fallback: string;
  copyLabel: string;
  openable?: boolean;
}) {
  if (!value) return <strong>{fallback}</strong>;

  return (
    <strong className="public-access-endpoint">
      {openable ? (
        <a className="summary-entry-link" href={value} target="_blank" rel="noreferrer">
          {value}
        </a>
      ) : value}
      <CopyButton aria-label={copyLabel} content={value} icon={ClipboardCopy} />
    </strong>
  );
}

function providerDetectionLabel(
  detection: ConnectivityProviderDetection,
  copy: ReturnType<typeof getPublicAccessCopy>
): string {
  if (detection === "detected") return copy.providerDetected;
  if (detection === "not-detected") return copy.providerNotDetected;
  return copy.providerProbeFailed;
}

function providerDetectionColor(detection: ConnectivityProviderDetection): "success" | "default" | "warning" {
  if (detection === "detected") return "success";
  if (detection === "probe-failed") return "warning";
  return "default";
}

function providerActionLabel(
  action: ConnectivityProviderMachineAction,
  copy: ReturnType<typeof getPublicAccessCopy>
): string {
  if (action === "install") return copy.actionInstall;
  if (action === "upgrade") return copy.actionUpgrade;
  return copy.actionUninstall;
}

const ROUTE_CANDIDATE_PROVIDER_SOURCES = new Set<PublicRouteCandidateSource>([
  "cloudflare-tunnel",
  "ngrok",
  "frp-client"
]);

function providerCapabilitySummary(
  provider: ConnectivityProviderPublicStatus,
  copy: ReturnType<typeof getPublicAccessCopy>
): string {
  if (provider.actions.every((action) => action.reason === "adapter-not-implemented")) {
    return copy.providerObserveOnly;
  }
  if (provider.managedByChatCockpit) return copy.providerManaged;
  if (provider.detection === "detected") return copy.providerExternalUnmanaged;
  if (provider.actions.some((action) => action.reason === "homebrew-not-detected")) {
    return copy.providerHomebrewRequired;
  }
  return copy.providerNoMachineAction;
}

export function PublicAccessView({
  locale,
  status,
  exposed,
  providerStatus,
  providerStatusError,
  routeStatus,
  routeStatusError,
  routeMutating,
  onStageCandidate,
  onDiscardCandidate,
  onOpenIntegrations
}: PublicAccessViewProps) {
  const copy = getPublicAccessCopy(locale);
  const [candidateOrigin, setCandidateOrigin] = useState("");
  const [candidateSource, setCandidateSource] =
    useState<PublicRouteCandidateSource>("existing-environment");
  const routeSourceOptions = useMemo(
    () => [
      { value: "existing-environment" as const, label: copy.existingEnvironment },
      ...(providerStatus?.providers
        .filter((provider) => ROUTE_CANDIDATE_PROVIDER_SOURCES.has(provider.id as PublicRouteCandidateSource))
        .map((provider) => ({
          value: provider.id as PublicRouteCandidateSource,
          label: provider.displayName
        })) ?? [])
    ],
    [copy.existingEnvironment, providerStatus]
  );

  useEffect(() => {
    if (routeStatus?.candidate) {
      setCandidateOrigin(routeStatus.candidate.origin);
      setCandidateSource(routeStatus.candidate.source);
      return;
    }
    setCandidateOrigin("");
    setCandidateSource("existing-environment");
  }, [routeStatus?.candidate?.id]);
  const publicEndpointReady = Boolean(status.publicCockpitUrl && status.publicApiBaseUrl);
  const hasPublicApi = Boolean(status.publicApiBaseUrl);
  const publicHttpsReady = status.publicApiBaseUrl?.startsWith("https://") === true;
  const mcpReady = Boolean(status.mcp.endpoint);
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

  return (
    <div className="view-stack">
      <SectionCard
        title={copy.reachabilityTitle}
        description={copy.reachabilityDescription}
        extra={
          <Tag color={exposed ? "processing" : "default"}>
            {copy.exposureStatus} · {exposed ? copy.active : copy.inactive}
          </Tag>
        }
      >
        <div className="gpt-facts">
          <div className="gpt-fact">
            <span>{copy.localCockpit}</span>
            <EndpointValue
              value={status.localCockpitUrl}
              fallback={copy.notConfigured}
              copyLabel={`${copy.copyUrl}: ${copy.localCockpit}`}
              openable
            />
          </div>
          <div className="gpt-fact">
            <span>{copy.publicCockpit}</span>
            <EndpointValue
              value={status.publicCockpitUrl}
              fallback={copy.notConfigured}
              copyLabel={`${copy.copyUrl}: ${copy.publicCockpit}`}
              openable
            />
          </div>
          <div className="gpt-fact">
            <span>{copy.localApiBase}</span>
            <EndpointValue
              value={status.localApiBaseUrl}
              fallback={copy.notConfigured}
              copyLabel={`${copy.copyUrl}: ${copy.localApiBase}`}
            />
          </div>
          <div className="gpt-fact">
            <span>{copy.publicApiBase}</span>
            <EndpointValue
              value={status.publicApiBaseUrl}
              fallback={copy.notConfigured}
              copyLabel={`${copy.copyUrl}: ${copy.publicApiBase}`}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={copy.protocolsTitle}
        description={copy.protocolsDescription}
        extra={<Tag color={oauthTagColor}>{copy.oauthStatus} · {oauthLabel}</Tag>}
      >
        <div className="gpt-facts">
          <div className="gpt-fact">
            <span>{copy.openapiUrl}</span>
            <EndpointValue
              value={status.openapiUrl}
              fallback={copy.notConfigured}
              copyLabel={`${copy.copyUrl}: ${copy.openapiUrl}`}
            />
          </div>
          <div className="gpt-fact">
            <span>{copy.mcpEndpoint}</span>
            <EndpointValue
              value={status.mcp.endpoint}
              fallback={copy.notConfigured}
              copyLabel={`${copy.copyUrl}: ${copy.mcpEndpoint}`}
            />
          </div>
          <div className="gpt-fact">
            <span>{copy.oauthStatus}</span>
            <strong><Tag color={oauthTagColor}>{oauthLabel}</Tag></strong>
          </div>
        </div>
        {!status.publicApiBaseUrl ? (
          <div className="section-note section-note--warning public-access-note">
            <strong>{copy.publicApiBase}</strong>
            <span>{copy.localProtocolNote}</span>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title={copy.connectionPathTitle}
        description={copy.connectionPathDescription}
      >
        <div className="gpt-facts">
          <div className="gpt-fact">
            <span>{copy.existingEnvironment}</span>
            <strong>{copy.existingEnvironmentDescription}</strong>
          </div>
          <div className="gpt-fact">
            <span>{copy.manualSetup}</span>
            <strong>{copy.manualSetupDescription}</strong>
          </div>
        </div>
        <div className="gpt-inline-note">
          <Text>{copy.machineBoundary}</Text>
        </div>
      </SectionCard>

      <SectionCard
        title={copy.routeIntentTitle}
        description={copy.routeIntentDescription}
        extra={
          routeStatus?.candidate ? (
            <Tag color="warning">{copy.candidateStagedUnverified}</Tag>
          ) : null
        }
      >
        {routeStatus ? (
          <>
            <div className="gpt-facts">
              <div className="gpt-fact">
                <span>{copy.currentCanonicalRoute}</span>
                <EndpointValue
                  value={routeStatus.canonical.origin}
                  fallback={copy.notConfigured}
                  copyLabel={`${copy.copyUrl}: ${copy.currentCanonicalRoute}`}
                />
              </div>
              <div className="gpt-fact">
                <span>{copy.candidateRoute}</span>
                {routeStatus.candidate ? (
                  <strong className="public-access-route-candidate">
                    <span>{routeStatus.candidate.origin}</span>
                    <Tag color="warning">{copy.candidateStagedUnverified}</Tag>
                  </strong>
                ) : (
                  <strong>{copy.noCandidateRoute}</strong>
                )}
              </div>
              {routeStatus.candidate ? (
                <div className="gpt-fact">
                  <span>{copy.candidateSource}</span>
                  <strong>
                    {routeSourceOptions.find((option) => option.value === routeStatus.candidate?.source)?.label
                      ?? routeStatus.candidate.source}
                  </strong>
                </div>
              ) : null}
            </div>

            <div className="public-access-route-form">
              <label>
                <span>{copy.candidateSource}</span>
                <Select
                  value={candidateSource}
                  options={routeSourceOptions}
                  onChange={(value) => setCandidateSource(value as PublicRouteCandidateSource)}
                  disabled={routeMutating}
                />
              </label>
              <label className="public-access-route-origin-field">
                <span>{copy.candidateOrigin}</span>
                <Input
                  value={candidateOrigin}
                  placeholder={copy.candidateOriginPlaceholder}
                  onChange={(event) => setCandidateOrigin(event.target.value)}
                  disabled={routeMutating}
                />
              </label>
              <div className="public-access-route-actions">
                <Button
                  type="primary"
                  loading={routeMutating}
                  disabled={!candidateOrigin.trim() || routeMutating}
                  onClick={() => onStageCandidate(candidateOrigin.trim(), candidateSource)}
                >
                  {routeStatus.candidate ? copy.replaceCandidateRoute : copy.stageCandidateRoute}
                </Button>
                {routeStatus.candidate ? (
                  <Button
                    disabled={routeMutating}
                    onClick={onDiscardCandidate}
                  >
                    {copy.discardCandidateRoute}
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <div className="section-note section-note--warning public-access-note">
            <strong>{copy.routeIntentTitle}</strong>
            <span>{routeStatusError ?? copy.candidateStatusUnavailable}</span>
          </div>
        )}

        {routeStatusError && routeStatus ? (
          <div className="section-note section-note--warning public-access-note">
            <strong>{copy.routeIntentTitle}</strong>
            <span>{routeStatusError}</span>
          </div>
        ) : null}
        <div className="gpt-inline-note public-access-route-safety">
          <Text>{copy.candidateSafetyNote}</Text>
        </div>
      </SectionCard>

      <SectionCard
        title={copy.providersTitle}
        description={copy.providersDescription}
      >
        {providerStatus ? (
          <div className="gpt-facts">
            {providerStatus.providers.map((provider) => {
              const availableActions = provider.actions
                .filter((action) => action.available)
                .map((action) => providerActionLabel(action.action, copy));
              return (
                <div className="gpt-fact" key={provider.id}>
                  <span>{provider.displayName}</span>
                  <strong className="public-access-provider-status">
                    <span className="public-access-provider-primary">
                      <Tag color={providerDetectionColor(provider.detection)}>
                        {providerDetectionLabel(provider.detection, copy)}
                      </Tag>
                      {provider.version ? <span>{provider.version}</span> : null}
                    </span>
                    <Text type="secondary">{providerCapabilitySummary(provider, copy)}</Text>
                    {availableActions.length > 0 ? (
                      <Text type="secondary">
                        {copy.providerMachineActions}: {availableActions.join(" / ")} · {copy.providerUseAppCli}
                      </Text>
                    ) : null}
                  </strong>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="section-note section-note--warning public-access-note">
            <strong>{copy.providersTitle}</strong>
            <span>{providerStatusError ?? copy.providerStatusUnavailable}</span>
          </div>
        )}
        <div className="public-access-provider-bridge">
          <Button href="chatcockpit://settings/connectivity">
            {copy.openConnectivityInApp}
          </Button>
          <Text type="secondary">{copy.connectivityBridgeDescription}</Text>
        </div>
      </SectionCard>

      <SectionCard
        title={copy.diagnosticsTitle}
        description={copy.diagnosticsDescription}
      >
        <div className="gpt-facts">
          <div className="gpt-fact">
            <span>{copy.publicEndpoint}</span>
            <strong>
              <Tag color={publicEndpointReady ? "success" : "default"}>
                {publicEndpointReady ? copy.ready : copy.notConfigured}
              </Tag>
            </strong>
          </div>
          <div className="gpt-fact">
            <span>{copy.httpsRequired}</span>
            <strong>
              <Tag color={!hasPublicApi ? "default" : publicHttpsReady ? "success" : "warning"}>
                {!hasPublicApi ? copy.notConfigured : publicHttpsReady ? copy.httpsReady : copy.httpsMissing}
              </Tag>
            </strong>
          </div>
          <div className="gpt-fact">
            <span>{copy.mcpEndpoint}</span>
            <strong>
              <Tag color={mcpReady ? "success" : "default"}>
                {mcpReady ? copy.mcpReady : copy.mcpMissing}
              </Tag>
            </strong>
          </div>
          <div className="gpt-fact">
            <span>{copy.oauthStatus}</span>
            <strong><Tag color={oauthTagColor}>{oauthLabel}</Tag></strong>
          </div>
        </div>

        <div className={`section-note public-access-note ${status.mcp.oauthReady ? "" : "section-note--warning"}`}>
          <strong>{copy.oauthStatus}</strong>
          <span>{status.mcp.oauthReady ? copy.oauthReadyGuidance : copy.oauthGuidance}</span>
        </div>

        {status.mcp.oauthReady ? null : (
          <div className="gpt-overview-actions">
            <Button onClick={onOpenIntegrations}>{copy.openIntegrations}</Button>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

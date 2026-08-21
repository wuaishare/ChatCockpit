import { Button, Collapse, Input, Select, Steps, Tag } from "antd";
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
  PublicRouteBootstrapProofSnapshot,
  PublicRouteBootstrapVerificationReason,
  PublicRouteCandidateSnapshot,
  PublicRouteCandidateSource,
  PublicRouteCutoverIntentSnapshot,
  PublicRouteVerificationReason,
  PublicRouteVerificationSnapshot
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
  verificationStatus: PublicRouteVerificationSnapshot | null;
  verificationStatusError: string | null;
  routeVerifying: boolean;
  cutoverIntentStatus: PublicRouteCutoverIntentSnapshot | null;
  cutoverIntentStatusError: string | null;
  cutoverIntentMutating: boolean;
  bootstrapProofStatus: PublicRouteBootstrapProofSnapshot | null;
  bootstrapProofStatusError: string | null;
  bootstrapProofMutating: boolean;
  onStageCandidate: (origin: string, source: PublicRouteCandidateSource) => void;
  onDiscardCandidate: () => void;
  onVerifyCandidate: (candidateId: string) => void;
  onPrepareCutoverIntent: (candidateId: string, verificationId: string) => void;
  onCancelCutoverIntent: () => void;
  onPrepareBootstrapProof: (candidateId: string) => void;
  onVerifyBootstrapProof: (candidateId: string, proofId: string) => void;
  onCancelBootstrapProof: () => void;
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

function verificationReasonLabel(
  reason: PublicRouteVerificationReason | null,
  copy: ReturnType<typeof getPublicAccessCopy>
): string {
  return reason ? copy.verificationReasons[reason] : copy.ready;
}

function bootstrapVerificationReasonLabel(
  reason: PublicRouteBootstrapVerificationReason | null,
  copy: ReturnType<typeof getPublicAccessCopy>
): string {
  return reason ? copy.bootstrapVerificationReasons[reason] : copy.ready;
}

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
  verificationStatus,
  verificationStatusError,
  routeVerifying,
  cutoverIntentStatus,
  cutoverIntentStatusError,
  cutoverIntentMutating,
  bootstrapProofStatus,
  bootstrapProofStatusError,
  bootstrapProofMutating,
  onStageCandidate,
  onDiscardCandidate,
  onVerifyCandidate,
  onPrepareCutoverIntent,
  onCancelCutoverIntent,
  onPrepareBootstrapProof,
  onVerifyBootstrapProof,
  onCancelBootstrapProof,
  onOpenIntegrations
}: PublicAccessViewProps) {
  const copy = getPublicAccessCopy(locale);
  const [candidateOrigin, setCandidateOrigin] = useState("");
  const [candidateSource, setCandidateSource] =
    useState<PublicRouteCandidateSource>("existing-environment");
  const [onlineMaintenanceExpanded, setOnlineMaintenanceExpanded] = useState(false);
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
      setOnlineMaintenanceExpanded(false);
      return;
    }
    setCandidateOrigin("");
    setCandidateSource("existing-environment");
  }, [routeStatus?.candidate?.id]);
  const currentVerification = verificationStatus?.verification ?? null;
  const verification = currentVerification?.candidateId === routeStatus?.candidate?.id
    ? currentVerification
    : null;
  const verificationChecks = verification ? [
    { key: "dns", label: copy.verificationDns, check: verification.checks.dns },
    { key: "tls", label: copy.verificationTls, check: verification.checks.tls },
    { key: "reachability", label: copy.verificationReachability, check: verification.checks.reachability },
    { key: "identity", label: copy.verificationIdentity, check: verification.checks.identity },
    { key: "oauth", label: copy.verificationOauth, check: verification.checks.oauth }
  ] : [];
  const rawCutoverIntent = cutoverIntentStatus?.intent ?? null;
  const cutoverIntent = rawCutoverIntent &&
    rawCutoverIntent.candidateId === routeStatus?.candidate?.id &&
    rawCutoverIntent.verificationId === verification?.id
    ? rawCutoverIntent
    : null;
  const rawBootstrapProof = bootstrapProofStatus?.proof ?? null;
  const bootstrapProof = rawBootstrapProof &&
    rawBootstrapProof.candidateId === routeStatus?.candidate?.id &&
    rawBootstrapProof.candidateOrigin === routeStatus?.candidate?.origin
    ? rawBootstrapProof
    : null;
  const bootstrapVerification = bootstrapProof?.verification ?? null;
  const bootstrapChecks = bootstrapVerification ? [
    { key: "dns", label: copy.verificationDns, check: bootstrapVerification.checks.dns },
    { key: "tls", label: copy.verificationTls, check: bootstrapVerification.checks.tls },
    { key: "reachability", label: copy.verificationReachability, check: bootstrapVerification.checks.reachability },
    { key: "identity", label: copy.bootstrapIdentityCheck, check: bootstrapVerification.checks.identity }
  ] : [];
  const bootstrapMode = routeStatus?.canonical.configured === false;
  const routeWorkflowLocked = Boolean(cutoverIntent || bootstrapProof) ||
    cutoverIntentMutating || bootstrapProofMutating;
  const candidateStatusTag = bootstrapMode ? (
    bootstrapProof?.status === "verified" ? (
      <Tag color="success">{copy.bootstrapVerified}</Tag>
    ) : bootstrapVerification?.status === "failed" ? (
      <Tag color="error">{copy.bootstrapVerificationFailed}</Tag>
    ) : bootstrapProof?.status === "prepared" ? (
      <Tag color="processing">{copy.bootstrapPrepared}</Tag>
    ) : (
      <Tag color="warning">{copy.candidateStagedUnverified}</Tag>
    )
  ) : verification?.status === "verified" ? (
    <Tag color="success">{copy.candidateVerified}</Tag>
  ) : verification?.status === "failed" ? (
    <Tag color="error">{copy.candidateVerificationFailed}</Tag>
  ) : (
    <Tag color="warning">{copy.candidateStagedUnverified}</Tag>
  );
  const publicEndpointReady = Boolean(status.publicCockpitUrl && status.publicApiBaseUrl);
  const hasPublicApi = Boolean(status.publicApiBaseUrl);
  const publicHttpsReady = status.publicApiBaseUrl?.startsWith("https://") === true;
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
  const lanAccessLabel = status.lanAccess.status === "ready"
    ? copy.lanAccessReady
    : status.lanAccess.status === "listener-loopback"
      ? copy.lanAccessLoopbackOnly
      : status.lanAccess.status === "no-trusted-address"
        ? copy.lanAccessNoTrustedAddress
        : copy.lanAccessDisabled;
  const lanAccessTagColor = status.lanAccess.status === "ready"
    ? "success"
    : status.lanAccess.status === "disabled"
      ? "default"
      : "warning";
  const lanAccessDescription = status.lanAccess.status === "ready"
    ? copy.lanAccessReadyDescription
    : status.lanAccess.status === "listener-loopback"
      ? copy.lanAccessLoopbackDescription
      : status.lanAccess.status === "no-trusted-address"
        ? copy.lanAccessNoTrustedAddressDescription
        : copy.lanAccessDisabledDescription;
  const workflowVerificationFailed = bootstrapMode
    ? bootstrapVerification?.status === "failed"
    : verification?.status === "failed";
  const workflowCandidateVerified = bootstrapMode
    ? bootstrapProof?.status === "verified"
    : verification?.status === "verified";
  const workflowStage = publicEndpointReady && !routeStatus?.candidate
    ? 3
    : !routeStatus?.candidate
      ? 0
      : workflowCandidateVerified
        ? 2
        : 1;
  const workflowStatusError = Boolean(
    routeStatusError || verificationStatusError || cutoverIntentStatusError || bootstrapProofStatusError
  );
  const isOnlineSteadyState = workflowStage === 3 && Boolean(routeStatus) && !workflowStatusError;
  const displayWorkflowStage = isOnlineSteadyState && onlineMaintenanceExpanded ? 0 : workflowStage;
  const showWorkflowCard = !isOnlineSteadyState || onlineMaintenanceExpanded;
  const showVerificationDetails = displayWorkflowStage === 1 || workflowVerificationFailed;
  const showCandidateEditor = displayWorkflowStage === 0 ||
    (displayWorkflowStage === 1 && !routeWorkflowLocked);
  const showCutoverDetails = displayWorkflowStage === 2;
  const showRouteWorkspace = displayWorkflowStage !== 3 || !routeStatus || workflowStatusError;
  const detectedProviderCount = providerStatus?.providers.filter(
    (provider) => provider.detection === "detected"
  ).length ?? 0;

  return (
    <div className="view-stack">
      {showWorkflowCard ? (
        <SectionCard
          title={copy.workflowTitle}
          description={copy.workflowDescription}
          extra={
            routeStatus ? (
              displayWorkflowStage === 3 ? (
                <Tag color="success">{copy.workflowLive}</Tag>
              ) : (
                <Tag color={bootstrapMode ? "blue" : "purple"}>
                  {bootstrapMode ? copy.workflowBootstrapMode : copy.workflowReplacementMode}
                </Tag>
              )
            ) : null
          }
        >
          <Steps
            className="public-access-workflow-steps"
            size="small"
            current={displayWorkflowStage}
            status={
              workflowVerificationFailed
                ? "error"
                : displayWorkflowStage === 3
                  ? "finish"
                  : "process"
            }
            items={[
              { title: copy.workflowSetup },
              { title: copy.workflowVerify },
              { title: copy.workflowCutover },
              { title: copy.workflowLive }
            ]}
          />
          {displayWorkflowStage === 0 ? (
            <>
              <div className="gpt-facts public-access-workflow-entry">
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
            </>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard
        title={copy.statusOverviewTitle}
        description={copy.statusOverviewDescription}
        extra={
          <div className="public-access-status-actions">
            <Tag color={publicEndpointReady ? "success" : "default"}>
              {copy.publicEndpoint} · {publicEndpointReady ? copy.ready : copy.notConfigured}
            </Tag>
            {isOnlineSteadyState ? (
              <Button
                size="small"
                onClick={() => setOnlineMaintenanceExpanded((expanded) => !expanded)}
              >
                {onlineMaintenanceExpanded
                  ? copy.closePublicAccessMaintenance
                  : copy.changePublicAccess}
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="public-access-status-grid">
          <div className="public-access-status-block">
            <div className="public-access-status-block__header">
              <strong>{copy.addressesTitle}</strong>
              <div className="public-access-status-tags">
                <Tag color={lanAccessTagColor}>
                  {copy.lanAccess} · {lanAccessLabel}
                </Tag>
                <Tag color={exposed ? "processing" : "default"}>
                  {copy.exposureStatus} · {exposed ? copy.active : copy.inactive}
                </Tag>
              </div>
            </div>
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
                <span>{copy.lanCockpit}</span>
                <div className="public-access-endpoint-list">
                  {status.lanAccess.cockpitUrls.length > 0 ? (
                    status.lanAccess.cockpitUrls.map((url) => (
                      <EndpointValue
                        key={url}
                        value={url}
                        fallback={copy.notConfigured}
                        copyLabel={`${copy.copyUrl}: ${copy.lanCockpit}`}
                        openable
                      />
                    ))
                  ) : (
                    <strong>{copy.notConfigured}</strong>
                  )}
                </div>
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
              <div className="gpt-fact">
                <span>{copy.trustedLanCidrs}</span>
                <strong>
                  {status.lanAccess.trustedCidrs.length > 0
                    ? status.lanAccess.trustedCidrs.join(", ")
                    : copy.notConfigured}
                </strong>
              </div>
            </div>
            <div className="gpt-inline-note public-access-note">
              <Text>{lanAccessDescription}</Text>
            </div>
          </div>

          <div className="public-access-status-block">
            <div className="public-access-status-block__header">
              <strong>{copy.protocolHealthTitle}</strong>
              <Tag color={oauthTagColor}>{copy.oauthStatus} · {oauthLabel}</Tag>
            </div>
            <div className="gpt-facts">
              <div className="gpt-fact">
                <span>{copy.httpsRequired}</span>
                <strong>
                  <Tag color={!hasPublicApi ? "default" : publicHttpsReady ? "success" : "warning"}>
                    {!hasPublicApi ? copy.notConfigured : publicHttpsReady ? copy.httpsReady : copy.httpsMissing}
                  </Tag>
                </strong>
              </div>
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
          </div>
        </div>

        {!status.publicApiBaseUrl ? (
          <div className="section-note section-note--warning public-access-note">
            <strong>{copy.publicApiBase}</strong>
            <span>{copy.localProtocolNote}</span>
          </div>
        ) : null}

        {!status.mcp.oauthReady ? (
          <>
            <div className="section-note section-note--warning public-access-note">
              <strong>{copy.oauthStatus}</strong>
              <span>{copy.oauthGuidance}</span>
            </div>
            <div className="gpt-overview-actions">
              <Button onClick={onOpenIntegrations}>{copy.openIntegrations}</Button>
            </div>
          </>
        ) : null}
      </SectionCard>

      {showRouteWorkspace ? (
        <SectionCard
        title={copy.routeIntentTitle}
        description={copy.routeIntentDescription}
        extra={
          routeStatus?.candidate ? candidateStatusTag : null
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
                    {candidateStatusTag}
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
              {routeStatus.candidate ? (
                <div className="gpt-fact">
                  <span>{copy.verificationStatus}</span>
                  <strong>
                    {bootstrapMode ? candidateStatusTag : verification?.status === "verified" ? (
                      <Tag color="success">{copy.candidateVerified}</Tag>
                    ) : verification?.status === "failed" ? (
                      <Tag color="error">{copy.candidateVerificationFailed}</Tag>
                    ) : (
                      <Tag>{copy.candidateNotVerified}</Tag>
                    )}
                  </strong>
                </div>
              ) : null}
            </div>

            {!bootstrapMode && verification && showVerificationDetails ? (
              <div className="public-access-verification-grid">
                {verificationChecks.map((item) => (
                  <div className="public-access-verification-check" key={item.key}>
                    <span>{item.label}</span>
                    <strong>
                      <Tag color={item.check.ok ? "success" : "error"}>
                        {item.check.ok ? copy.ready : copy.candidateVerificationFailed}
                      </Tag>
                      <Text type="secondary">
                        {item.check.ok
                          ? copy.ready
                          : verificationReasonLabel(item.check.reason, copy)}
                        {item.check.statusCode ? ` · HTTP ${item.check.statusCode}` : ""}
                      </Text>
                    </strong>
                  </div>
                ))}
              </div>
            ) : null}

            {bootstrapMode && routeStatus.candidate ? (
              <div className="public-access-cutover-intent">
                <div className="public-access-cutover-intent__header">
                  <div>
                    <strong>{copy.bootstrapProofTitle}</strong>
                    <Text type="secondary">
                      {bootstrapProof?.status === "verified"
                        ? copy.bootstrapProofVerifiedDescription
                        : bootstrapProof
                          ? copy.bootstrapProofPreparedDescription
                          : copy.bootstrapProofDescription}
                    </Text>
                  </div>
                  {bootstrapProof?.status === "verified" ? (
                    <Tag color="success">{copy.bootstrapVerified}</Tag>
                  ) : bootstrapProof ? (
                    <Tag color="processing">{copy.bootstrapPrepared}</Tag>
                  ) : (
                    <Tag>{copy.bootstrapNotPrepared}</Tag>
                  )}
                </div>

                {bootstrapVerification && showVerificationDetails ? (
                  <div className="public-access-verification-grid">
                    {bootstrapChecks.map((item) => (
                      <div className="public-access-verification-check" key={item.key}>
                        <span>{item.label}</span>
                        <strong>
                          <Tag color={item.check.ok ? "success" : "error"}>
                            {item.check.ok ? copy.ready : copy.bootstrapVerificationFailed}
                          </Tag>
                          <Text type="secondary">
                            {item.check.ok
                              ? copy.ready
                              : bootstrapVerificationReasonLabel(item.check.reason, copy)}
                            {item.check.statusCode ? ` · HTTP ${item.check.statusCode}` : ""}
                          </Text>
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : null}

                {bootstrapProof ? (
                  <div className="gpt-facts">
                    <div className="gpt-fact">
                      <span>{copy.bootstrapProofExpires}</span>
                      <strong>{new Date(bootstrapProof.expiresAt).toLocaleString(locale)}</strong>
                    </div>
                  </div>
                ) : null}

                <div className="public-access-route-actions">
                  {!bootstrapProof ? (
                    <Button
                      type="primary"
                      loading={bootstrapProofMutating}
                      disabled={routeMutating || bootstrapProofMutating}
                      onClick={() => onPrepareBootstrapProof(routeStatus.candidate!.id)}
                    >
                      {copy.prepareBootstrapProof}
                    </Button>
                  ) : bootstrapProof.status === "prepared" ? (
                    <Button
                      type="primary"
                      loading={bootstrapProofMutating}
                      disabled={routeMutating || bootstrapProofMutating}
                      onClick={() => onVerifyBootstrapProof(routeStatus.candidate!.id, bootstrapProof.id)}
                    >
                      {copy.verifyBootstrapProof}
                    </Button>
                  ) : null}
                  {bootstrapProof ? (
                    <Button
                      disabled={bootstrapProofMutating}
                      onClick={onCancelBootstrapProof}
                    >
                      {copy.cancelBootstrapProof}
                    </Button>
                  ) : null}
                </div>

                {bootstrapProof?.status === "verified" ? (
                  <div className="section-note section-note--warning public-access-note">
                    <strong>{copy.bootstrapMachinePendingTitle}</strong>
                    <span>{copy.bootstrapMachinePendingDescription}</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!bootstrapMode && showCutoverDetails && cutoverIntent ? (
              <div className="public-access-cutover-intent">
                <div className="public-access-cutover-intent__header">
                  <div>
                    <strong>{copy.cutoverIntentTitle}</strong>
                    <Text type="secondary">{copy.cutoverIntentPendingDescription}</Text>
                  </div>
                  <Tag color="processing">{copy.cutoverIntentPending}</Tag>
                </div>
                <div className="gpt-facts">
                  <div className="gpt-fact">
                    <span>{copy.cutoverFrom}</span>
                    <strong>{cutoverIntent.expectedCanonicalOrigin}</strong>
                  </div>
                  <div className="gpt-fact">
                    <span>{copy.cutoverTo}</span>
                    <strong>{cutoverIntent.candidateOrigin}</strong>
                  </div>
                  <div className="gpt-fact">
                    <span>{copy.cutoverIntentExpires}</span>
                    <strong>{new Date(cutoverIntent.expiresAt).toLocaleString(locale)}</strong>
                  </div>
                </div>
                <div className="public-access-route-actions">
                  <Button loading={cutoverIntentMutating} onClick={onCancelCutoverIntent}>
                    {copy.cancelCutoverIntent}
                  </Button>
                </div>
              </div>
            ) : !bootstrapMode && showCutoverDetails && verification?.status === "verified" ? (
              <div className="public-access-cutover-ready">
                <div>
                  <strong>{copy.cutoverReadyTitle}</strong>
                  <Text type="secondary">{copy.cutoverReadyDescription}</Text>
                </div>
                <div className="public-access-route-actions">
                  <Button
                    type="primary"
                    loading={cutoverIntentMutating}
                    disabled={routeMutating || routeVerifying || cutoverIntentMutating}
                    onClick={() => onPrepareCutoverIntent(routeStatus.candidate!.id, verification.id)}
                  >
                    {copy.prepareCutoverIntent}
                  </Button>
                  <Button
                    disabled={routeMutating || routeVerifying || cutoverIntentMutating}
                    onClick={onDiscardCandidate}
                  >
                    {copy.discardCandidateRoute}
                  </Button>
                </div>
              </div>
            ) : null}

            {showCandidateEditor ? (
              <div className="public-access-route-form">
                <label>
                  <span>{copy.candidateSource}</span>
                  <Select
                    value={candidateSource}
                    options={routeSourceOptions}
                    onChange={(value) => setCandidateSource(value as PublicRouteCandidateSource)}
                    disabled={routeMutating || routeVerifying || routeWorkflowLocked}
                  />
                </label>
                <label className="public-access-route-origin-field">
                  <span>{copy.candidateOrigin}</span>
                  <Input
                    value={candidateOrigin}
                    placeholder={copy.candidateOriginPlaceholder}
                    onChange={(event) => setCandidateOrigin(event.target.value)}
                    disabled={routeMutating || routeVerifying || routeWorkflowLocked}
                  />
                </label>
                <div className="public-access-route-actions">
                  <Button
                    type="primary"
                    loading={routeMutating}
                    disabled={!candidateOrigin.trim() || routeMutating || routeVerifying || routeWorkflowLocked}
                    onClick={() => onStageCandidate(candidateOrigin.trim(), candidateSource)}
                  >
                    {routeStatus.candidate ? copy.replaceCandidateRoute : copy.stageCandidateRoute}
                  </Button>
                  {routeStatus.candidate && !bootstrapMode ? (
                    <Button
                      loading={routeVerifying}
                      disabled={routeMutating || routeVerifying || routeWorkflowLocked}
                      onClick={() => onVerifyCandidate(routeStatus.candidate!.id)}
                    >
                      {copy.verifyCandidateRoute}
                    </Button>
                  ) : null}
                  {routeStatus.candidate ? (
                    <Button
                      disabled={routeMutating || routeVerifying || routeWorkflowLocked}
                      onClick={onDiscardCandidate}
                    >
                      {copy.discardCandidateRoute}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
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
        {verificationStatusError ? (
          <div className="section-note section-note--warning public-access-note">
            <strong>{copy.verificationStatus}</strong>
            <span>{verificationStatusError}</span>
          </div>
        ) : null}
        {cutoverIntentStatusError ? (
          <div className="section-note section-note--warning public-access-note">
            <strong>{copy.cutoverIntentTitle}</strong>
            <span>{cutoverIntentStatusError}</span>
          </div>
        ) : null}
        {bootstrapProofStatusError ? (
          <div className="section-note section-note--warning public-access-note">
            <strong>{copy.bootstrapProofTitle}</strong>
            <span>{bootstrapProofStatusError}</span>
          </div>
        ) : null}
        <div className="gpt-inline-note public-access-route-safety">
          <Text>{copy.candidateSafetyNote}</Text>
        </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title={copy.providersTitle}
        description={copy.providersDescription}
      >
        <div className="public-access-provider-bridge">
          <Button href="chatcockpit://settings/connectivity">
            {copy.openConnectivityInApp}
          </Button>
          <Text type="secondary">{copy.connectivityBridgeDescription}</Text>
        </div>
        {providerStatus ? (
          <Collapse
            className="public-access-provider-details"
            ghost
            items={[
              {
                key: "provider-status",
                label: (
                  <span className="public-access-provider-details__label">
                    <span>{copy.providerDetailsTitle}</span>
                    <Tag>{copy.providerDetected} · {detectedProviderCount}/{providerStatus.providers.length}</Tag>
                  </span>
                ),
                children: (
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
                )
              }
            ]}
          />
        ) : (
          <div className="section-note section-note--warning public-access-note">
            <strong>{copy.providersTitle}</strong>
            <span>{providerStatusError ?? copy.providerStatusUnavailable}</span>
          </div>
        )}
      </SectionCard>

    </div>
  );
}

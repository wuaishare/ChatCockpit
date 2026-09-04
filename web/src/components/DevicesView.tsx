import { useEffect, useMemo, useState } from "react";
import { Button, Popconfirm, Spin, Tag } from "antd";
import { DesktopOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";

import {
  decideDeviceEnrollment,
  executeDeviceRuntimeLifecycle,
  fetchDeviceEnrollmentRequests,
  fetchDeviceRuntimeStatus,
  fetchDevices,
  fetchProductActions,
  revokeDevice,
  setDeviceExecutionPolicy
} from "../api";
import type {
  DeviceEnrollmentRequestSummary,
  DeviceRuntimeConditions,
  DeviceRuntimeLifecycleAction,
  ManagedDeviceSummary,
  ProductActionTargetAvailability,
  ProductActionsResponse
} from "../types";
import type { LocaleCode } from "../i18n";
import {
  hasLocalProductActionPath,
  productActionTargets
} from "../product-action-availability";
import { getDevicesCopy } from "../i18n/devices";
import { getDeviceOnboardingCopy } from "../i18n/device-onboarding";
import { DeviceOnboardingModal } from "./DeviceOnboardingModal";
import { SectionCard } from "./SectionCard";

interface DevicesViewProps {
  locale: LocaleCode;
}

function errorMessage(error: unknown, fallback: string, versionMismatch: string): string {
  if (typeof error === "object" && error) {
    const status = "status" in error ? Number(error.status) : null;
    if (status === 404) return versionMismatch;
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

export function DevicesView({ locale }: DevicesViewProps) {
  const copy = getDevicesCopy(locale);
  const onboardingCopy = getDeviceOnboardingCopy(locale);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [devices, setDevices] = useState<ManagedDeviceSummary[]>([]);
  const [requests, setRequests] = useState<DeviceEnrollmentRequestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisionKey, setDecisionKey] = useState<string | null>(null);
  const [policyActionKey, setPolicyActionKey] = useState<string | null>(null);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [runtimeByDevice, setRuntimeByDevice] = useState<Record<string, DeviceRuntimeConditions | null>>({});
  const [runtimeLoading, setRuntimeLoading] = useState<Record<string, boolean>>({});
  const [productActions, setProductActions] = useState<ProductActionsResponse | null>(null);
  const [runtimeActionKey, setRuntimeActionKey] = useState<string | null>(null);

  const remoteDevices = useMemo(
    () => devices.filter((device) => device.locality === "remote"),
    [devices]
  );
  const runtimeLifecycleTargets = useMemo(
    () => productActionTargets(productActions, "runtime.lifecycle"),
    [productActions]
  );
  const workspaceReadTargets = useMemo(
    () => productActionTargets(productActions, "workspace.read"),
    [productActions]
  );
  const canDecideEnrollment = hasLocalProductActionPath(productActions, "device.enrollment.decide");
  const canManageExecutionPolicy = hasLocalProductActionPath(productActions, "device.execution-policy.manage");
  const canRevokeDevice = hasLocalProductActionPath(productActions, "device.revoke");

  const formatTime = (value: string | null) => value
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "medium"
      }).format(new Date(value))
    : "—";

  const load = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [deviceResponse, requestResponse, actionResponse] = await Promise.all([
        fetchDevices(),
        fetchDeviceEnrollmentRequests(),
        fetchProductActions().catch(() => null)
      ]);
      setDevices(deviceResponse.devices);
      setRequests(requestResponse.enrollmentRequests);
      const nextRuntimeTargets = productActionTargets(actionResponse, "runtime.lifecycle");
      setProductActions(actionResponse);
      const runtimeCandidates = deviceResponse.devices.filter((device) =>
        device.locality === "remote" &&
        device.trust === "paired" &&
        nextRuntimeTargets.some((target) =>
          target.deviceId === device.id &&
          target.availability === "available-targeted" &&
          target.executionMode === "remote-device-rpc"
        )
      );
      setRuntimeLoading(Object.fromEntries(runtimeCandidates.map((device) => [device.id, true])));
      const runtimeEntries = await Promise.all(runtimeCandidates.map(async (device) => {
        try {
          const response = await fetchDeviceRuntimeStatus(device.id);
          return [device.id, response.conditions] as const;
        } catch {
          return [device.id, null] as const;
        }
      }));
      setRuntimeByDevice(Object.fromEntries(runtimeEntries));
      setRuntimeLoading({});
    } catch (loadError) {
      setError(errorMessage(loadError, copy.loadFailed, copy.apiVersionMismatch));
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => void load(false), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const decide = async (requestId: string, decision: "approve" | "deny") => {
    if (!canDecideEnrollment || decisionKey) return;
    setDecisionKey(`${requestId}:${decision}`);
    setError(null);
    try {
      await decideDeviceEnrollment(requestId, decision);
      await load(false);
    } catch (decisionError) {
      setError(errorMessage(decisionError, copy.decisionFailed, copy.apiVersionMismatch));
    } finally {
      setDecisionKey(null);
    }
  };

  const updateExecutionPolicy = async (
    device: ManagedDeviceSummary,
    action: "pause" | "resume"
  ) => {
    if (!canManageExecutionPolicy || policyActionKey) return;
    setPolicyActionKey(`${device.id}:${action}`);
    setError(null);
    try {
      await setDeviceExecutionPolicy(
        device.id,
        action,
        device.executionPolicyRevision
      );
      await load(false);
    } catch (policyError) {
      setError(errorMessage(policyError, copy.executionPolicyFailed, copy.apiVersionMismatch));
    } finally {
      setPolicyActionKey(null);
    }
  };

  const runRuntimeLifecycle = async (
    device: ManagedDeviceSummary,
    action: DeviceRuntimeLifecycleAction
  ) => {
    if (runtimeActionKey) return;
    setRuntimeActionKey(`${device.id}:${action}`);
    setError(null);
    try {
      const response = await executeDeviceRuntimeLifecycle(
        device.id,
        action,
        crypto.randomUUID()
      );
      const conditions = response.operation.postflightConditions;
      if (conditions) {
        setRuntimeByDevice((current) => ({ ...current, [device.id]: conditions }));
      } else {
        const refreshed = await fetchDeviceRuntimeStatus(device.id);
        setRuntimeByDevice((current) => ({ ...current, [device.id]: refreshed.conditions }));
      }
      await load(false);
    } catch (runtimeError) {
      setError(errorMessage(runtimeError, copy.runtimeActionFailed, copy.apiVersionMismatch));
    } finally {
      setRuntimeActionKey(null);
    }
  };

  const revoke = async (deviceId: string) => {
    if (!canRevokeDevice || revokingDeviceId) return;
    setRevokingDeviceId(deviceId);
    setError(null);
    try {
      await revokeDevice(deviceId);
      await load(false);
    } catch (revokeError) {
      setError(errorMessage(revokeError, copy.revokeFailed, copy.apiVersionMismatch));
    } finally {
      setRevokingDeviceId(null);
    }
  };

  const presenceMeta = (device: ManagedDeviceSummary) => {
    if (device.trust === "revoked") return { label: copy.revoked, color: "default" as const };
    if (device.presence === "online") return { label: copy.online, color: "success" as const };
    return { label: copy.offline, color: "warning" as const };
  };

  const runtimeMeta = (device: ManagedDeviceSummary) => {
    const target = runtimeLifecycleTargets.find((candidate) => candidate.deviceId === device.id) ?? null;
    if (device.locality === "local") {
      return { state: "local" as const, label: copy.runtimeLocal };
    }
    if (!target) return { state: "unknown" as const, label: copy.runtimeUnknown };
    if (target.availability === "offline") {
      return { state: "unknown" as const, label: copy.runtimeUnknown };
    }
    if (target.reason === "device-agent-update-required") {
      return { state: "unsupported" as const, label: copy.runtimeAgentUpdate };
    }
    if (target.reason === "target-capability-not-attested") {
      return { state: "unsupported" as const, label: copy.runtimeCapabilityNotAttested };
    }
    if (target.availability === "unsupported") {
      return { state: "unsupported" as const, label: copy.runtimeUnsupported };
    }
    if (target.availability === "unavailable") {
      return { state: "unavailable" as const, label: copy.runtimeChannelUnavailable };
    }
    if (target.availability !== "available-targeted") {
      return { state: "unknown" as const, label: copy.runtimeUnknown };
    }
    if (runtimeLoading[device.id]) return { state: "loading" as const, label: copy.runtimeLoading };
    const conditions = runtimeByDevice[device.id];
    if (!conditions) return { state: "unknown" as const, label: copy.runtimeUnknown };
    if (conditions.support !== "managed-macos") return { state: "unsupported" as const, label: copy.runtimeUnsupported };
    if (
      conditions.controlPlane === "running" &&
      conditions.runner === "registered" &&
      conditions.processSupervisor === "ready"
    ) return { state: "ready" as const, label: copy.runtimeReady };
    if (
      conditions.controlPlane === "stopped" &&
      conditions.runner === "stopped" &&
      conditions.processSupervisor === "stopped"
    ) return { state: "stopped" as const, label: copy.runtimeStopped };
    return { state: "unknown" as const, label: copy.runtimeUnknown };
  };

  const runtimeActionHint = (target: ProductActionTargetAvailability): string => {
    if (target.availability === "requires-local-host") return copy.runtimeLocalHostRequired;
    if (target.availability === "offline") return copy.runtimeUnknown;
    if (target.reason === "device-agent-update-required") return copy.runtimeAgentUpdate;
    if (target.reason === "target-capability-not-attested") return copy.runtimeCapabilityNotAttested;
    if (target.availability === "unsupported") return copy.runtimeUnsupported;
    return copy.runtimeChannelUnavailable;
  };

  const remoteReadLabel = (device: ManagedDeviceSummary) => {
    const target = workspaceReadTargets.find((candidate) => candidate.deviceId === device.id) ?? null;
    if (!target) return copy.remoteReadUnavailable;
    if (target.availability === "available-targeted") return copy.remoteReadReady;
    if (target.availability === "offline") return copy.remoteReadOffline;
    if (target.reason === "device-agent-update-required") return copy.remoteReadAgentUpdate;
    if (target.reason === "target-capability-not-attested") return copy.remoteReadCapabilityNotAttested;
    return copy.remoteReadUnavailable;
  };

  return (
    <div className="view-stack">
      <SectionCard
        title={copy.title}
        description={copy.description}
        extra={
          <div className="device-page-actions">
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setOnboardingOpen(true)}
            >
              {onboardingCopy.addDevice}
            </Button>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => void load(true)}
              loading={loading}
            >
              {copy.refresh}
            </Button>
          </div>
        }
      >
        {error ? <div className="section-note section-note--warning">{error}</div> : null}
        {!productActions && !loading ? (
          <div className="section-note section-note--warning">{copy.actionAvailabilityUnknown}</div>
        ) : null}
        {loading && devices.length === 0 ? (
          <div className="device-list__loading"><Spin size="small" /> <span>{copy.loading}</span></div>
        ) : (
          <div className="device-grid">
            {devices.map((device) => {
              const presence = presenceMeta(device);
              const runtime = runtimeMeta(device);
              const runtimeTarget = runtimeLifecycleTargets.find(
                (candidate) => candidate.deviceId === device.id
              ) ?? null;
              const runtimeActionAvailable =
                runtimeTarget?.availability === "available-targeted" &&
                runtimeTarget.executionMode === "remote-device-rpc";
              const runtimeActionUnavailable =
                Boolean(runtimeTarget) && !runtimeActionAvailable;
              return (
                <article className="device-card" key={device.id}>
                  <div className="device-card__header">
                    <div className="device-card__identity">
                      <span className="device-card__icon" aria-hidden="true">
                        <DesktopOutlined />
                      </span>
                      <div>
                        <strong>{device.displayName}</strong>
                        <span>{device.locality === "local" ? copy.localDevice : copy.pairedDevice}</span>
                      </div>
                    </div>
                    <div className="device-card__tags">
                      <Tag>{device.locality === "local" ? copy.local : copy.remote}</Tag>
                      <Tag color={presence.color}>{presence.label}</Tag>
                    </div>
                  </div>

                  <div className="gpt-facts device-card__facts">
                    <div className="gpt-fact">
                      <span>{copy.platform}</span>
                      <strong>{device.platform}</strong>
                    </div>
                    <div className="gpt-fact">
                      <span>{copy.architecture}</span>
                      <strong>{device.architecture}</strong>
                    </div>
                    <div className="gpt-fact">
                      <span>{copy.lastSeen}</span>
                      <strong>{formatTime(device.lastSeenAt)}</strong>
                    </div>
                    <div className="gpt-fact">
                      <span>{copy.pairedAt}</span>
                      <strong>{formatTime(device.pairedAt)}</strong>
                    </div>
                    {device.publicKeyFingerprint ? (
                      <div className="gpt-fact">
                        <span>{copy.fingerprint}</span>
                        <strong className="device-card__fingerprint">{device.publicKeyFingerprint}</strong>
                      </div>
                    ) : null}
                    <div className="gpt-fact">
                      <span>{copy.executionPolicy}</span>
                      <strong>{device.executionPolicy === "paused" ? copy.aiPaused : copy.aiActive}</strong>
                    </div>
                    <div className="gpt-fact">
                      <span>{copy.runtime}</span>
                      <strong>{runtime.label}</strong>
                    </div>
                    <div className="gpt-fact">
                      <span>{copy.management}</span>
                      <strong>
                        {device.management.heartbeat ? copy.presenceReady : copy.localPresence}
                        {device.locality === "remote"
                          ? ` · ${remoteReadLabel(device)} · ${runtime.label}`
                          : ""}
                      </strong>
                    </div>
                  </div>

                  {device.locality === "remote" && device.trust !== "revoked" ? (
                    <div className="device-card__actions">
                      {device.locality === "remote" && device.executionPolicy === "paused" ? (
                        <Button
                          size="small"
                          loading={policyActionKey === `${device.id}:resume`}
                          disabled={!canManageExecutionPolicy || Boolean(policyActionKey)}
                          onClick={() => void updateExecutionPolicy(device, "resume")}
                        >
                          {policyActionKey === `${device.id}:resume` ? copy.resuming : copy.resume}
                        </Button>
                      ) : device.locality === "remote" ? (
                        <Popconfirm
                          title={copy.pauseTitle}
                          description={copy.pauseDescription}
                          okText={copy.confirm}
                          cancelText={copy.cancel}
                          onConfirm={() => void updateExecutionPolicy(device, "pause")}
                        >
                          <Button
                            size="small"
                            loading={policyActionKey === `${device.id}:pause`}
                            disabled={!canManageExecutionPolicy || Boolean(policyActionKey)}
                          >
                            {policyActionKey === `${device.id}:pause` ? copy.pausing : copy.pause}
                          </Button>
                        </Popconfirm>
                      ) : null}
                      {runtimeActionAvailable && runtime.state === "stopped" ? (
                        <Button
                          size="small"
                          loading={runtimeActionKey === `${device.id}:start`}
                          disabled={Boolean(runtimeActionKey)}
                          onClick={() => void runRuntimeLifecycle(device, "start")}
                        >
                          {runtimeActionKey === `${device.id}:start` ? copy.startingRuntime : copy.startRuntime}
                        </Button>
                      ) : null}
                      {runtimeActionAvailable && runtime.state === "ready" ? (
                        <Popconfirm
                          title={copy.stopRuntimeTitle}
                          description={copy.stopRuntimeDescription}
                          okText={copy.confirm}
                          cancelText={copy.cancel}
                          okButtonProps={{ danger: true }}
                          onConfirm={() => void runRuntimeLifecycle(device, "stop")}
                        >
                          <Button
                            danger
                            size="small"
                            loading={runtimeActionKey === `${device.id}:stop`}
                            disabled={Boolean(runtimeActionKey)}
                          >
                            {runtimeActionKey === `${device.id}:stop` ? copy.stoppingRuntime : copy.stopRuntime}
                          </Button>
                        </Popconfirm>
                      ) : null}
                      {runtimeActionAvailable && runtime.state === "ready" ? (
                        <Popconfirm
                          title={copy.restartRuntimeTitle}
                          description={copy.restartRuntimeDescription}
                          okText={copy.confirm}
                          cancelText={copy.cancel}
                          onConfirm={() => void runRuntimeLifecycle(device, "restart")}
                        >
                          <Button
                            size="small"
                            loading={runtimeActionKey === `${device.id}:restart`}
                            disabled={Boolean(runtimeActionKey)}
                          >
                            {runtimeActionKey === `${device.id}:restart` ? copy.restartingRuntime : copy.restartRuntime}
                          </Button>
                        </Popconfirm>
                      ) : null}
                      {runtimeActionUnavailable && runtimeTarget ? (
                        <>
                          <Button size="small" disabled>{copy.manageRuntime}</Button>
                          <span className="device-card__action-hint">{runtimeActionHint(runtimeTarget)}</span>
                        </>
                      ) : null}
                      {device.locality === "remote" ? (
                        <Popconfirm
                          title={copy.revokeTitle}
                          description={copy.revokeDescription}
                          okText={copy.confirm}
                          cancelText={copy.cancel}
                          okButtonProps={{ danger: true }}
                          onConfirm={() => void revoke(device.id)}
                        >
                          <Button
                            danger
                            size="small"
                            loading={revokingDeviceId === device.id}
                            disabled={!canRevokeDevice || Boolean(revokingDeviceId)}
                          >
                            {revokingDeviceId === device.id ? copy.revoking : copy.revoke}
                          </Button>
                        </Popconfirm>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}

        {!loading && remoteDevices.length === 0 ? (
          <div className="section-note device-empty-state">
            <strong>{copy.noRemoteTitle}</strong>
            <span>{copy.noRemoteDescription}</span>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title={copy.requestsTitle}
        description={copy.requestsDescription}
        extra={<Tag icon={<SafetyCertificateOutlined />}>{requests.length}</Tag>}
      >
        {requests.length === 0 ? (
          <div className="section-note device-empty-state">
            <strong>{copy.noRequestsTitle}</strong>
            <span>{copy.noRequestsDescription}</span>
          </div>
        ) : (
          <div className="device-grid">
            {requests.map((request) => (
              <article className="device-card device-card--request" key={request.id}>
                <div className="device-card__header">
                  <div className="device-card__identity">
                    <span className="device-card__icon" aria-hidden="true">
                      <SafetyCertificateOutlined />
                    </span>
                    <div>
                      <strong>{request.displayName}</strong>
                      <span>{request.platform} · {request.architecture}</span>
                    </div>
                  </div>
                  <Tag color="processing">{copy.pending}</Tag>
                </div>

                <div className="device-verification-code" aria-label={copy.verificationCode}>
                  <span>{copy.verificationCode}</span>
                  <strong>{request.verificationCode}</strong>
                </div>

                <div className="gpt-facts device-card__facts">
                  <div className="gpt-fact">
                    <span>{copy.fingerprint}</span>
                    <strong className="device-card__fingerprint">{request.publicKeyFingerprint}</strong>
                  </div>
                  <div className="gpt-fact">
                    <span>{copy.requestedAt}</span>
                    <strong>{formatTime(request.createdAt)}</strong>
                  </div>
                  <div className="gpt-fact">
                    <span>{copy.expiresAt}</span>
                    <strong>{formatTime(request.expiresAt)}</strong>
                  </div>
                </div>

                <div className="device-card__actions device-card__actions--decision">
                  <Popconfirm
                    title={copy.denyTitle}
                    description={copy.denyDescription}
                    okText={copy.confirm}
                    cancelText={copy.cancel}
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void decide(request.id, "deny")}
                  >
                    <Button
                      danger
                      size="small"
                      loading={decisionKey === `${request.id}:deny`}
                      disabled={!canDecideEnrollment || (Boolean(decisionKey) && decisionKey !== `${request.id}:deny`)}
                    >
                      {decisionKey === `${request.id}:deny` ? copy.denying : copy.deny}
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title={copy.approveTitle}
                    description={copy.approveDescription}
                    okText={copy.confirm}
                    cancelText={copy.cancel}
                    onConfirm={() => void decide(request.id, "approve")}
                  >
                    <Button
                      type="primary"
                      size="small"
                      loading={decisionKey === `${request.id}:approve`}
                      disabled={!canDecideEnrollment || (Boolean(decisionKey) && decisionKey !== `${request.id}:approve`)}
                    >
                      {decisionKey === `${request.id}:approve` ? copy.approving : copy.approve}
                    </Button>
                  </Popconfirm>
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="section-note device-security-note">{copy.securityNote}</div>
      </SectionCard>

      <DeviceOnboardingModal
        locale={locale}
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
      />
    </div>
  );
}

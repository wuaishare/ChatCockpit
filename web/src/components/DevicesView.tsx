import { useEffect, useMemo, useState } from "react";
import { Button, Popconfirm, Spin, Tag } from "antd";
import { MonitorSmartphone, RefreshCw, ShieldCheck } from "lucide-react";

import {
  decideDeviceEnrollment,
  fetchDeviceEnrollmentRequests,
  fetchDevices,
  revokeDevice
} from "../api";
import type {
  DeviceEnrollmentRequestSummary,
  ManagedDeviceSummary
} from "../types";
import type { LocaleCode } from "../i18n";
import { getDevicesCopy } from "../i18n/devices";
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
  const [devices, setDevices] = useState<ManagedDeviceSummary[]>([]);
  const [requests, setRequests] = useState<DeviceEnrollmentRequestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisionKey, setDecisionKey] = useState<string | null>(null);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);

  const remoteDevices = useMemo(
    () => devices.filter((device) => device.locality === "remote"),
    [devices]
  );

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
      const [deviceResponse, requestResponse] = await Promise.all([
        fetchDevices(),
        fetchDeviceEnrollmentRequests()
      ]);
      setDevices(deviceResponse.devices);
      setRequests(requestResponse.requests);
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
    if (decisionKey) return;
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

  const revoke = async (deviceId: string) => {
    if (revokingDeviceId) return;
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
    if (device.presence === "online") return { label: copy.online, color: "success" as const };
    if (device.presence === "revoked") return { label: copy.revoked, color: "default" as const };
    return { label: copy.offline, color: "warning" as const };
  };

  return (
    <div className="view-stack">
      <SectionCard
        title={copy.title}
        description={copy.description}
        extra={
          <Button
            size="small"
            icon={<RefreshCw size={14} />}
            onClick={() => void load(true)}
            loading={loading}
          >
            {copy.refresh}
          </Button>
        }
      >
        {error ? <div className="section-note section-note--warning">{error}</div> : null}
        {loading && devices.length === 0 ? (
          <div className="device-list__loading"><Spin size="small" /> <span>{copy.loading}</span></div>
        ) : (
          <div className="device-grid">
            {devices.map((device) => {
              const presence = presenceMeta(device);
              return (
                <article className="device-card" key={device.id}>
                  <div className="device-card__header">
                    <div className="device-card__identity">
                      <span className="device-card__icon" aria-hidden="true">
                        <MonitorSmartphone size={18} />
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
                      <span>{copy.management}</span>
                      <strong>
                        {device.management.heartbeat ? copy.presenceReady : copy.localPresence}
                        {device.locality === "remote" && !device.management.remoteControl
                          ? ` · ${copy.remoteControlPending}`
                          : ""}
                      </strong>
                    </div>
                  </div>

                  {device.locality === "remote" && device.trust !== "revoked" ? (
                    <div className="device-card__actions">
                      <Popconfirm
                        title={copy.revokeTitle}
                        description={copy.revokeDescription}
                        okText={copy.confirm}
                        cancelText={copy.cancel}
                        okButtonProps={{ danger: true }}
                        onConfirm={() => void revoke(device.id)}
                      >
                        <Button danger size="small" loading={revokingDeviceId === device.id}>
                          {revokingDeviceId === device.id ? copy.revoking : copy.revoke}
                        </Button>
                      </Popconfirm>
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
        extra={<Tag icon={<ShieldCheck size={12} />}>{requests.length}</Tag>}
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
                      <ShieldCheck size={18} />
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
                      disabled={Boolean(decisionKey) && decisionKey !== `${request.id}:deny`}
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
                      disabled={Boolean(decisionKey) && decisionKey !== `${request.id}:approve`}
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
    </div>
  );
}

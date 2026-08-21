import { useEffect, useMemo, useState } from "react";
import { Button, Input, Popconfirm, Spin, Tag } from "antd";
import { CopyButton, Text } from "@lobehub/ui";
import { ClipboardCopy, MonitorSmartphone, RefreshCw } from "lucide-react";

import {
  createDevicePairing,
  fetchDevices,
  revokeDevice
} from "../api";
import type {
  DevicePairingTicket,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [pairing, setPairing] = useState<DevicePairingTicket | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
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

  const loadDevices = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchDevices();
      setDevices(response.devices);
    } catch (loadError) {
      setError(errorMessage(loadError, copy.loadFailed, copy.apiVersionMismatch));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDevices();
    const timer = window.setInterval(() => void loadDevices(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const preparePairing = async () => {
    const name = displayName.trim();
    if (!name || pairingLoading) return;
    setPairingLoading(true);
    setError(null);
    try {
      const response = await createDevicePairing(name);
      setPairing(response.pairing);
      setDisplayName("");
    } catch (pairingError) {
      setError(errorMessage(pairingError, copy.pairingFailed, copy.apiVersionMismatch));
    } finally {
      setPairingLoading(false);
    }
  };

  const revoke = async (deviceId: string) => {
    if (revokingDeviceId) return;
    setRevokingDeviceId(deviceId);
    setError(null);
    try {
      await revokeDevice(deviceId);
      await loadDevices();
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
            onClick={() => void loadDevices()}
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
                      <span>{copy.controlStatus}</span>
                      <strong>
                        {device.management.heartbeat ? copy.presenceReady : copy.localDevice}
                        {device.management.remoteControl ? "" : ` · ${copy.remoteControlPending}`}
                      </strong>
                    </div>
                  </div>

                  {device.locality === "remote" && device.trust !== "revoked" ? (
                    <div className="device-card__actions">
                      <Popconfirm
                        title={copy.revokeTitle}
                        description={copy.revokeDescription}
                        okText={copy.revokeConfirm}
                        cancelText={copy.revokeCancel}
                        okButtonProps={{ danger: true }}
                        onConfirm={() => void revoke(device.id)}
                      >
                        <Button danger size="small" loading={revokingDeviceId === device.id}>
                          {copy.revoke}
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
            <strong>{copy.emptyTitle}</strong>
            <span>{copy.emptyDescription}</span>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title={copy.pairTitle} description={copy.pairDescription}>
        <div className="device-pairing-form">
          <label htmlFor="device-pairing-name">{copy.deviceName}</label>
          <div className="device-pairing-form__row">
            <Input
              id="device-pairing-name"
              value={displayName}
              maxLength={80}
              placeholder={copy.deviceNamePlaceholder}
              onChange={(event) => setDisplayName(event.target.value)}
              onPressEnter={() => void preparePairing()}
            />
            <Button
              type="primary"
              disabled={!displayName.trim()}
              loading={pairingLoading}
              onClick={() => void preparePairing()}
            >
              {pairingLoading ? copy.creatingPairing : copy.createPairing}
            </Button>
          </div>
        </div>

        {pairing ? (
          <div className="device-pairing-ticket">
            <div className="gpt-facts">
              <div className="gpt-fact">
                <span>{copy.pairingCode}</span>
                <strong className="device-pairing-ticket__code">
                  {pairing.code}
                  <CopyButton
                    aria-label={copy.copyPairingCode}
                    content={pairing.code}
                    icon={ClipboardCopy}
                  />
                </strong>
              </div>
              <div className="gpt-fact">
                <span>{copy.pairingId}</span>
                <strong>{pairing.id}</strong>
              </div>
              <div className="gpt-fact">
                <span>{copy.expiresAt}</span>
                <strong>{formatTime(pairing.expiresAt)}</strong>
              </div>
            </div>
            <div className="section-note">
              <strong>{copy.pairingSecurityNote}</strong>
              <Text>{copy.pairingClientPending}</Text>
            </div>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}

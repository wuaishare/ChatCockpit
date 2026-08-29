import { ReloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Alert, Button, Modal, Spin, Steps, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";

import { fetchDeviceOnboarding } from "../api";
import type { DeviceOnboardingResponse } from "../types";
import type { LocaleCode } from "../i18n";
import { getDeviceOnboardingCopy } from "../i18n/device-onboarding";
import { CopyButton } from "./CopyButton";

interface DeviceOnboardingModalProps {
  locale: LocaleCode;
  open: boolean;
  onClose(): void;
}

function errorText(error: unknown, fallback: string): string {
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

export function DeviceOnboardingModal({ locale, open, onClose }: DeviceOnboardingModalProps) {
  const copy = getDeviceOnboardingCopy(locale);
  const [projection, setProjection] = useState<DeviceOnboardingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setProjection(await fetchDeviceOnboarding());
    } catch (loadError) {
      setError(errorText(loadError, copy.loadFailed));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void load();
    const timer = window.setInterval(() => {
      void fetchDeviceOnboarding()
        .then((next) => setProjection(next))
        .catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [open]);

  const currentStep = useMemo(() => {
    if (!projection) return 0;
    // pendingCount is global Hub state, not proof that this wizard initiated
    // a specific enrollment request, so it must not advance the stepper.
    return projection.routes.remote.available ? 1 : 0;
  }, [projection]);

  const nearbyReason = useMemo(() => {
    if (!projection || projection.routes.nearby.reason === "ready") return null;
    switch (projection.routes.nearby.reason) {
      case "trusted-lan-disabled":
        return copy.nearbyTrustedLanDisabled;
      case "secure-transport-unavailable":
        return copy.nearbySecureTransportUnavailable;
      case "discovery-unavailable":
        return copy.nearbyDiscoveryUnavailable;
    }
  }, [copy, projection]);

  const remoteReason = useMemo(() => {
    if (!projection || projection.routes.remote.reason === "ready") return null;
    return projection.routes.remote.reason === "public-route-not-configured"
      ? copy.remoteNotConfigured
      : copy.remoteNotHttps;
  }, [copy, projection]);

  return (
    <Modal
      open={open}
      title={copy.title}
      width={760}
      onCancel={onClose}
      footer={[
        <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          {copy.retry}
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>{copy.close}</Button>
      ]}
    >
      <div className="device-onboarding">
        <p className="device-onboarding__description">{copy.description}</p>
        <Steps
          current={currentStep}
          size="small"
          items={[
            { title: copy.stepRoute },
            { title: copy.stepConnect },
            { title: copy.stepApprove }
          ]}
        />

        {loading && !projection ? (
          <div className="device-onboarding__loading"><Spin size="small" /> <span>{copy.loading}</span></div>
        ) : null}

        {error ? (
          <Alert
            type="error"
            showIcon
            message={copy.loadFailed}
            description={error}
            action={<Button size="small" onClick={() => void load()}>{copy.retry}</Button>}
          />
        ) : null}

        {projection ? (
          <>
            <section className="device-onboarding__card">
              <div className="device-onboarding__card-header">
                <div>
                  <strong>{projection.routes.remote.available ? copy.remoteReadyTitle : copy.remoteUnavailableTitle}</strong>
                  {projection.routes.remote.origin ? <code>{projection.routes.remote.origin}</code> : null}
                </div>
                {projection.routes.remote.available ? (
                  <Tag color={projection.routes.remote.verified ? "success" : "warning"}>
                    {projection.routes.remote.verified ? copy.remoteVerified : copy.remoteUnverified}
                  </Tag>
                ) : (
                  <Tag color="warning">{copy.stepRoute}</Tag>
                )}
              </div>

              <p>
                {projection.routes.remote.available
                  ? copy.remoteReadyDescription
                  : copy.remoteUnavailableDescription}
              </p>
              {remoteReason ? <Alert type="warning" showIcon message={remoteReason} /> : null}

              {projection.bootstrap.installedCli.connectCommand ? (
                <div className="device-onboarding__command">
                  <span>{copy.commandLabel}</span>
                  <div>
                    <code>{projection.bootstrap.installedCli.connectCommand}</code>
                    <CopyButton
                      aria-label={copy.copyCommand}
                      content={projection.bootstrap.installedCli.connectCommand}
                    />
                  </div>
                </div>
              ) : null}

              <div className="device-onboarding__notes">
                <span>{copy.installedCliRequirement}</span>
                <span>{copy.distributionUnavailable}</span>
              </div>
            </section>

            <section className="device-onboarding__card device-onboarding__card--approval">
              <div className="device-onboarding__card-header">
                <div>
                  <strong>{copy.waitingTitle}</strong>
                  <span>{copy.waitingDescription}</span>
                </div>
                <Tag icon={<SafetyCertificateOutlined />} color={projection.enrollment.pendingCount > 0 ? "processing" : undefined}>
                  {copy.pendingCount}: {projection.enrollment.pendingCount}
                </Tag>
              </div>
            </section>

            <section className="device-onboarding__card">
              <div className="device-onboarding__card-header">
                <div>
                  <strong>{copy.nearbyTitle}</strong>
                  <span>{copy.nearbyDescription}</span>
                </div>
                <Tag color={projection.routes.nearby.available ? "success" : "default"}>
                  {projection.routes.nearby.available ? copy.nearbyReady : copy.nearbyUnavailable}
                </Tag>
              </div>
              {nearbyReason ? <Alert type="info" showIcon message={nearbyReason} /> : null}
              {projection.routes.nearby.available ? (
                <div className="device-onboarding__command">
                  <span>{copy.nearbyVerifyLabel}</span>
                  <div>
                    <code>{projection.bootstrap.installedCli.verifyLanCommand}</code>
                    <CopyButton
                      aria-label={copy.copyCommand}
                      content={projection.bootstrap.installedCli.verifyLanCommand}
                    />
                  </div>
                </div>
              ) : null}
            </section>

            <section className="device-onboarding__advanced">
              <strong>{copy.advancedTitle}</strong>
              <div>
                <span>{copy.hubFingerprint}</span>
                <code>{projection.advanced.publicKeyFingerprint}</code>
              </div>
              <div>
                <span>{copy.stagedRoute}</span>
                <code>{projection.advanced.stagedPublicRoute?.origin ?? copy.stagedRouteNone}</code>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

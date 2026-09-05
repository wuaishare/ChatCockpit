import { Button, Descriptions, Empty, List, Popconfirm, Space, Tag } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";

import {
  executeDeviceRuntimeLifecycle,
  fetchDeviceRuntimeStatus,
  fetchProductActions
} from "../api";
import { getRuntimeCopy } from "../i18n/runtime";
import type { LocaleCode } from "../i18n";
import type {
  DeviceRuntimeConditions,
  DeviceRuntimeLifecycleAction,
  HealthModel,
  ProductActionTargetAvailability
} from "../types";
import { getOperationalStatusTone } from "../status-language";
import {
  hasLocalProductActionPath,
  isProductActionTargetAvailable,
  isRemoteProductActionPath,
  productActionTargetRequiresLocalHost,
  productActionTargets
} from "../product-action-availability";
import { SectionCard } from "./SectionCard";
import { RuntimeLiveExecutionPanel } from "./RuntimeLiveExecutionPanel";

interface RuntimeViewProps {
  locale: LocaleCode;
  health: HealthModel;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function RuntimeView({ locale, health }: RuntimeViewProps) {
  const copy = getRuntimeCopy(locale);
  const [targets, setTargets] = useState<ProductActionTargetAvailability[]>([]);
  const [processTerminateAvailable, setProcessTerminateAvailable] = useState(false);
  const [conditionsByDevice, setConditionsByDevice] = useState<Record<string, DeviceRuntimeConditions | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const projection = await fetchProductActions();
      const runtimeTargets = productActionTargets(projection, "runtime.lifecycle");
      setTargets(runtimeTargets);
      setProcessTerminateAvailable(
        hasLocalProductActionPath(projection, "runtime.process.terminate")
      );

      const inspectableTargets = runtimeTargets.filter(isRemoteProductActionPath);
      const entries = await Promise.all(
        inspectableTargets.map(async (target) => {
          try {
            const response = await fetchDeviceRuntimeStatus(target.deviceId);
            return [target.deviceId, response.conditions] as const;
          } catch {
            return [target.deviceId, null] as const;
          }
        })
      );
      setConditionsByDevice(Object.fromEntries(entries));
    } catch (loadError) {
      setTargets([]);
      setProcessTerminateAvailable(false);
      setConditionsByDevice({});
      setError(errorMessage(loadError, copy.loadFailed));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function lifecycleReason(target: ProductActionTargetAvailability): string {
    if (isProductActionTargetAvailable(target)) {
      return copy.reasonReady;
    }
    if (productActionTargetRequiresLocalHost(target)) return copy.reasonLocalHost;
    if (target.availability === "offline" || target.reason === "device-offline") return copy.reasonOffline;
    if (target.reason === "device-agent-update-required") return copy.reasonAgentUpdate;
    if (target.reason === "target-capability-not-attested") return copy.reasonNotAttested;
    if (target.reason === "target-capability-not-implemented") return copy.reasonNotImplemented;
    if (target.reason === "policy-forbidden") return copy.reasonForbidden;
    if (target.reason === "approval-required") return copy.reasonApproval;
    return copy.reasonNoPath;
  }

  function runtimeState(target: ProductActionTargetAvailability): "running" | "stopped" | "unknown" | "unsupported" {
    if (target.locality === "local") return health.ok ? "running" : "unknown";
    if (target.availability === "unsupported") return "unsupported";
    const conditions = conditionsByDevice[target.deviceId];
    if (!conditions) return "unknown";
    if (conditions.support !== "managed-macos") return "unsupported";
    if (
      conditions.controlPlane === "running" &&
      conditions.runner === "registered" &&
      conditions.processSupervisor === "ready"
    ) {
      return "running";
    }
    if (
      conditions.controlPlane === "stopped" &&
      conditions.runner === "stopped" &&
      conditions.processSupervisor === "stopped"
    ) {
      return "stopped";
    }
    return "unknown";
  }

  function runtimeStateLabel(state: ReturnType<typeof runtimeState>): string {
    if (state === "running") return copy.running;
    if (state === "stopped") return copy.stopped;
    if (state === "unsupported") return copy.unsupported;
    return copy.unknown;
  }

  async function runLifecycle(
    target: ProductActionTargetAvailability,
    action: DeviceRuntimeLifecycleAction
  ): Promise<void> {
    if (!isRemoteProductActionPath(target)) {
      return;
    }
    const key = `${target.deviceId}:${action}`;
    setActionKey(key);
    setError(null);
    try {
      const response = await executeDeviceRuntimeLifecycle(target.deviceId, action, crypto.randomUUID());
      const conditions = response.operation.postflightConditions ??
        (await fetchDeviceRuntimeStatus(target.deviceId)).conditions;
      setConditionsByDevice((current) => ({ ...current, [target.deviceId]: conditions }));
    } catch (actionError) {
      setError(errorMessage(actionError, copy.actionFailed));
    } finally {
      setActionKey(null);
    }
  }

  const buildText = [health.build.version, health.build.buildId, health.build.revision]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="view-stack">
      <SectionCard title={copy.currentTitle} description={copy.currentDescription} tone="hero">
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
          <Descriptions.Item label={copy.health}>
            <Tag color={health.ok ? "success" : "warning"}>
              {health.ok ? copy.healthy : copy.unavailable}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label={copy.mode}>{health.mode}</Descriptions.Item>
          <Descriptions.Item label={copy.build}>{buildText || copy.unknown}</Descriptions.Item>
          <Descriptions.Item label={copy.exposure}>
            {health.exposed ? copy.public : copy.localOnly}
          </Descriptions.Item>
        </Descriptions>
      </SectionCard>

      <RuntimeLiveExecutionPanel
        locale={locale}
        processTerminateAvailable={processTerminateAvailable}
      />

      <SectionCard
        title={copy.targetsTitle}
        description={copy.targetsDescription}
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            {copy.refresh}
          </Button>
        }
      >
        {error ? <div className="section-note section-note--warning">{error}</div> : null}
        <List
          loading={loading && targets.length === 0}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={copy.noTargets} /> }}
          dataSource={targets}
          renderItem={(target) => {
            const state = runtimeState(target);
            const canControl = isRemoteProductActionPath(target);
            return (
              <List.Item
                actions={[
                  ...(canControl && state === "stopped"
                    ? [
                        <Button
                          key="start"
                          size="small"
                          loading={actionKey === `${target.deviceId}:start`}
                          disabled={Boolean(actionKey)}
                          onClick={() => void runLifecycle(target, "start")}
                        >
                          {copy.start}
                        </Button>
                      ]
                    : []),
                  ...(canControl && state === "running"
                    ? [
                        <Popconfirm
                          key="stop"
                          title={copy.stopTitle}
                          description={copy.stopDescription}
                          okText={copy.confirm}
                          cancelText={copy.cancel}
                          okButtonProps={{ danger: true }}
                          onConfirm={() => void runLifecycle(target, "stop")}
                        >
                          <Button
                            danger
                            size="small"
                            loading={actionKey === `${target.deviceId}:stop`}
                            disabled={Boolean(actionKey)}
                          >
                            {copy.stop}
                          </Button>
                        </Popconfirm>,
                        <Popconfirm
                          key="restart"
                          title={copy.restartTitle}
                          description={copy.restartDescription}
                          okText={copy.confirm}
                          cancelText={copy.cancel}
                          onConfirm={() => void runLifecycle(target, "restart")}
                        >
                          <Button
                            size="small"
                            loading={actionKey === `${target.deviceId}:restart`}
                            disabled={Boolean(actionKey)}
                          >
                            {copy.restart}
                          </Button>
                        </Popconfirm>
                      ]
                    : [])
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space wrap size={8}>
                      <span>{target.displayName}</span>
                      <Tag>{target.locality === "local" ? copy.local : copy.remote}</Tag>
                      <Tag color={getOperationalStatusTone(state)}>{runtimeStateLabel(state)}</Tag>
                    </Space>
                  }
                  description={
                    <Space wrap size={12}>
                      <span>{copy.platform}: {target.platform} · {target.architecture}</span>
                      <span>{copy.lifecycle}: {lifecycleReason(target)}</span>
                      <span>{copy.runtimeState}: {runtimeStateLabel(state)}</span>
                    </Space>
                  }
                />
              </List.Item>
            );
          }}
        />
      </SectionCard>
    </div>
  );
}

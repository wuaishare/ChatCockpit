export const DEVICE_RUNTIME_CONDITIONS_SCHEMA_VERSION = 1 as const;

export type DeviceRuntimeLifecycleSupport = "managed-macos" | "unsupported";
export type DeviceRuntimeControlPlaneState = "running" | "stopped" | "unknown";
export type DeviceRuntimeRunnerState = "registered" | "stopped" | "unknown";
export type DeviceRuntimeProcessSupervisorState =
  | "ready"
  | "registered"
  | "stopped"
  | "unknown";

export interface DeviceRuntimeConditions {
  schemaVersion: typeof DEVICE_RUNTIME_CONDITIONS_SCHEMA_VERSION;
  support: DeviceRuntimeLifecycleSupport;
  controlPlane: DeviceRuntimeControlPlaneState;
  runner: DeviceRuntimeRunnerState;
  processSupervisor: DeviceRuntimeProcessSupervisorState;
  observedAt: string;
}

export type DeviceRuntimeLifecycleErrorCode =
  | "DEVICE_RUNTIME_LIFECYCLE_UNSUPPORTED"
  | "DEVICE_RUNTIME_STATUS_FAILED"
  | "DEVICE_RUNTIME_STATUS_INVALID"
  | "DEVICE_RUNTIME_ACTION_FAILED";

export class DeviceRuntimeLifecycleError extends Error {
  constructor(
    readonly code: DeviceRuntimeLifecycleErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DeviceRuntimeLifecycleError";
  }
}

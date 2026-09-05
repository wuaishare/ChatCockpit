export const DESKTOP_HOST_BRIDGE_SCHEMA_VERSION = 1 as const;

export const DESKTOP_HOST_CAPABILITIES = {
  operatorSetup: "operator.setup",
  connectivity: "settings.connectivity",
  projectRootPick: "project.root.pick"
} as const;

export type DesktopHostCapability =
  (typeof DESKTOP_HOST_CAPABILITIES)[keyof typeof DESKTOP_HOST_CAPABILITIES];

export const DESKTOP_HOST_ACTIONS = {
  operatorSetup: DESKTOP_HOST_CAPABILITIES.operatorSetup,
  connectivity: DESKTOP_HOST_CAPABILITIES.connectivity
} as const;

export type DesktopHostAction =
  (typeof DESKTOP_HOST_ACTIONS)[keyof typeof DESKTOP_HOST_ACTIONS];

export const DESKTOP_HOST_PICKER_RESULT_EVENT =
  "chatcockpit:desktop-host-picker-result" as const;

export interface DesktopHostCapabilityProjection {
  schemaVersion: typeof DESKTOP_HOST_BRIDGE_SCHEMA_VERSION;
  capabilities: DesktopHostCapability[];
}

export type DesktopHostPickerResult =
  | {
      capability: typeof DESKTOP_HOST_CAPABILITIES.projectRootPick;
      status: "selected";
      path: string;
    }
  | {
      capability: typeof DESKTOP_HOST_CAPABILITIES.projectRootPick;
      status: "cancelled";
    };

declare global {
  interface Window {
    readonly __chatcockpitDesktopHostCapabilities?: unknown;
  }
}

const DESKTOP_HOST_CAPABILITY_VALUES = new Set<string>(
  Object.values(DESKTOP_HOST_CAPABILITIES)
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readDesktopHostCapabilityProjection():
  | DesktopHostCapabilityProjection
  | null {
  if (typeof window === "undefined") return null;

  const raw = window.__chatcockpitDesktopHostCapabilities;
  if (!isRecord(raw)) return null;

  const keys = Object.keys(raw).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "capabilities" ||
    keys[1] !== "schemaVersion" ||
    raw.schemaVersion !== DESKTOP_HOST_BRIDGE_SCHEMA_VERSION ||
    !Array.isArray(raw.capabilities)
  ) {
    return null;
  }

  const capabilities: DesktopHostCapability[] = [];
  const seen = new Set<DesktopHostCapability>();
  for (const value of raw.capabilities) {
    if (
      typeof value !== "string" ||
      !DESKTOP_HOST_CAPABILITY_VALUES.has(value)
    ) {
      return null;
    }
    const capability = value as DesktopHostCapability;
    if (!seen.has(capability)) {
      seen.add(capability);
      capabilities.push(capability);
    }
  }

  return {
    schemaVersion: DESKTOP_HOST_BRIDGE_SCHEMA_VERSION,
    capabilities
  };
}

export function hasDesktopHostCapability(
  capability: DesktopHostCapability
): boolean {
  return readDesktopHostCapabilityProjection()?.capabilities.includes(capability) === true;
}

export function desktopHostActionAttributes(action: DesktopHostAction) {
  return {
    "data-chatcockpit-desktop-host-action": action
  } as const;
}

export function desktopHostPickerAttributes(
  capability: typeof DESKTOP_HOST_CAPABILITIES.projectRootPick =
    DESKTOP_HOST_CAPABILITIES.projectRootPick
) {
  return {
    "data-chatcockpit-desktop-host-picker": capability
  } as const;
}

export function parseDesktopHostPickerResult(
  value: unknown
): DesktopHostPickerResult | null {
  if (!isRecord(value)) return null;
  if (
    value.capability !== DESKTOP_HOST_CAPABILITIES.projectRootPick ||
    (value.status !== "selected" && value.status !== "cancelled")
  ) {
    return null;
  }

  const keys = Object.keys(value).sort();
  if (value.status === "selected") {
    if (
      keys.length !== 3 ||
      keys[0] !== "capability" ||
      keys[1] !== "path" ||
      keys[2] !== "status" ||
      typeof value.path !== "string" ||
      value.path.length === 0
    ) {
      return null;
    }
    return {
      capability: DESKTOP_HOST_CAPABILITIES.projectRootPick,
      status: "selected",
      path: value.path
    };
  }

  if (
    keys.length !== 2 ||
    keys[0] !== "capability" ||
    keys[1] !== "status"
  ) {
    return null;
  }
  return {
    capability: DESKTOP_HOST_CAPABILITIES.projectRootPick,
    status: "cancelled"
  };
}

export function subscribeDesktopHostPickerResults(
  listener: (result: DesktopHostPickerResult) => void
): () => void {
  if (typeof document === "undefined") return () => undefined;

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const result = parseDesktopHostPickerResult(event.detail);
    if (result) listener(result);
  };
  document.addEventListener(DESKTOP_HOST_PICKER_RESULT_EVENT, handler);
  return () => {
    document.removeEventListener(DESKTOP_HOST_PICKER_RESULT_EVENT, handler);
  };
}

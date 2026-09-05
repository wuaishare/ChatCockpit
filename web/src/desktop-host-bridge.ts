export const DESKTOP_HOST_BRIDGE_SCHEMA_VERSION = 1 as const;

export const DESKTOP_HOST_ACTIONS = {
  operatorSetup: "operator.setup",
  connectivity: "settings.connectivity"
} as const;

export type DesktopHostAction =
  (typeof DESKTOP_HOST_ACTIONS)[keyof typeof DESKTOP_HOST_ACTIONS];

export interface DesktopHostCapabilityProjection {
  schemaVersion: typeof DESKTOP_HOST_BRIDGE_SCHEMA_VERSION;
  capabilities: DesktopHostAction[];
}

declare global {
  interface Window {
    readonly __chatcockpitDesktopHostCapabilities?: unknown;
  }
}

const DESKTOP_HOST_ACTION_VALUES = new Set<string>(
  Object.values(DESKTOP_HOST_ACTIONS)
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

  const capabilities: DesktopHostAction[] = [];
  const seen = new Set<DesktopHostAction>();
  for (const value of raw.capabilities) {
    if (
      typeof value !== "string" ||
      !DESKTOP_HOST_ACTION_VALUES.has(value)
    ) {
      return null;
    }
    const action = value as DesktopHostAction;
    if (!seen.has(action)) {
      seen.add(action);
      capabilities.push(action);
    }
  }

  return {
    schemaVersion: DESKTOP_HOST_BRIDGE_SCHEMA_VERSION,
    capabilities
  };
}

export function hasDesktopHostCapability(action: DesktopHostAction): boolean {
  return readDesktopHostCapabilityProjection()?.capabilities.includes(action) === true;
}

export function desktopHostActionAttributes(action: DesktopHostAction) {
  return {
    "data-chatcockpit-desktop-host-action": action
  } as const;
}

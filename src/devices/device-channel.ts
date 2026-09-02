import crypto from "node:crypto";

import {
  normalizeDeviceChannelCapabilities,
  type DeviceChannelCapability
} from "./device-channel-capabilities.js";

export type DeviceChannelProtocolVersion = 1 | 2 | 3 | 4 | 5;
export type DeviceChannelCloseReason = "superseded" | "revoked" | "server-shutdown";
export type DeviceChannelLifecycleReason = DeviceChannelCloseReason | "disconnected";

export type DeviceChannelServerEvent =
  | "capability.request"
  | "runtime.lifecycle.request";

export interface DeviceChannelServerEventSender {
  (event: DeviceChannelServerEvent, data: unknown): boolean;
}

interface ActiveDeviceChannel {
  channelId: string;
  protocolVersion: DeviceChannelProtocolVersion;
  capabilities: ReadonlySet<DeviceChannelCapability> | null;
  close(reason: DeviceChannelCloseReason): void;
  send: DeviceChannelServerEventSender | null;
}

export interface DeviceChannelRegistration {
  channelId: string;
  protocolVersion: DeviceChannelProtocolVersion;
  dispose(): void;
}

export interface DeviceCapabilityRpcChannel {
  channelId: string;
  protocolVersion: DeviceChannelProtocolVersion;
  workspaceRpcAvailable: boolean;
  send(data: unknown): boolean;
}

export interface DeviceRuntimeLifecycleRpcChannel {
  channelId: string;
  send(data: unknown): boolean;
}

export type DeviceChannelCapabilityAvailability =
  | "available"
  | "channel-unavailable"
  | "legacy-update-required"
  | "not-attested";

export interface DeviceChannelLifecycleEvent {
  deviceId: string;
  channelId: string;
  reason: DeviceChannelLifecycleReason;
}

export class DeviceChannelHub {
  private readonly active = new Map<string, ActiveDeviceChannel>();
  private readonly lifecycleListeners = new Set<(event: DeviceChannelLifecycleEvent) => void>();

  register(
    deviceId: string,
    close: (reason: DeviceChannelCloseReason) => void,
    options: {
      protocolVersion?: DeviceChannelProtocolVersion;
      capabilities?: readonly DeviceChannelCapability[];
      send?: DeviceChannelServerEventSender;
    } = {}
  ): DeviceChannelRegistration {
    const channelId = `cc_channel_${crypto.randomBytes(18).toString("base64url")}`;
    const protocolVersion = options.protocolVersion ?? 1;
    const previous = this.active.get(deviceId);
    if (previous) {
      this.active.delete(deviceId);
      this.notifyLifecycle({
        deviceId,
        channelId: previous.channelId,
        reason: "superseded"
      });
      previous.close("superseded");
    }
    this.active.set(deviceId, {
      channelId,
      protocolVersion,
      capabilities: options.capabilities === undefined
        ? null
        : new Set(normalizeDeviceChannelCapabilities(options.capabilities)),
      close,
      send: options.send ?? null
    });
    return {
      channelId,
      protocolVersion,
      dispose: () => {
        const current = this.active.get(deviceId);
        if (current?.channelId !== channelId) return;
        this.active.delete(deviceId);
        this.notifyLifecycle({ deviceId, channelId, reason: "disconnected" });
      }
    };
  }

  isActive(deviceId: string): boolean {
    return this.active.has(deviceId);
  }

  isCapabilityRpcAvailable(deviceId: string): boolean {
    return this.capabilityAvailability(deviceId, "capability-rpc") === "available";
  }

  isWorkspaceRpcAvailable(deviceId: string): boolean {
    return this.capabilityAvailability(deviceId, "workspace-rpc") === "available";
  }

  capabilityRpcChannel(deviceId: string): DeviceCapabilityRpcChannel | null {
    const channel = this.active.get(deviceId);
    if (!channel || !this.supports(channel, "capability-rpc") || !channel.send) return null;
    return {
      channelId: channel.channelId,
      protocolVersion: channel.protocolVersion,
      workspaceRpcAvailable: this.supports(channel, "workspace-rpc"),
      send: (data) => channel.send!("capability.request", data)
    };
  }

  isRuntimeLifecycleRpcAvailable(deviceId: string): boolean {
    return this.capabilityAvailability(deviceId, "runtime-lifecycle") === "available";
  }

  capabilityAvailability(
    deviceId: string,
    capability: DeviceChannelCapability
  ): DeviceChannelCapabilityAvailability {
    const channel = this.active.get(deviceId);
    if (!channel) return "channel-unavailable";
    if (channel.capabilities !== null) {
      if (!channel.capabilities.has(capability)) return "not-attested";
      return channel.send === null ? "channel-unavailable" : "available";
    }
    if (!this.supports(channel, capability)) return "legacy-update-required";
    return channel.send === null ? "channel-unavailable" : "available";
  }

  runtimeLifecycleRpcChannel(deviceId: string): DeviceRuntimeLifecycleRpcChannel | null {
    const channel = this.active.get(deviceId);
    if (!channel || !this.supports(channel, "runtime-lifecycle") || !channel.send) return null;
    return {
      channelId: channel.channelId,
      send: (data) => channel.send!("runtime.lifecycle.request", data)
    };
  }

  activeDeviceIds(): ReadonlySet<string> {
    return new Set(this.active.keys());
  }

  onLifecycle(listener: (event: DeviceChannelLifecycleEvent) => void): () => void {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  closeDevice(deviceId: string, reason: DeviceChannelCloseReason): boolean {
    const current = this.active.get(deviceId);
    if (!current) return false;
    this.active.delete(deviceId);
    this.notifyLifecycle({ deviceId, channelId: current.channelId, reason });
    current.close(reason);
    return true;
  }

  closeAll(reason: DeviceChannelCloseReason = "server-shutdown"): void {
    const channels = [...this.active.entries()];
    this.active.clear();
    for (const [deviceId, channel] of channels) {
      this.notifyLifecycle({ deviceId, channelId: channel.channelId, reason });
      channel.close(reason);
    }
  }

  private supports(
    channel: ActiveDeviceChannel,
    capability: DeviceChannelCapability
  ): boolean {
    if (channel.capabilities !== null) return channel.capabilities.has(capability);
    if (capability === "capability-rpc") return channel.protocolVersion >= 2;
    if (capability === "runtime-lifecycle") return channel.protocolVersion >= 3;
    return channel.protocolVersion >= 4;
  }

  private notifyLifecycle(event: DeviceChannelLifecycleEvent): void {
    for (const listener of this.lifecycleListeners) listener(event);
  }
}

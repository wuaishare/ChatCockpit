import crypto from "node:crypto";

export type DeviceChannelProtocolVersion = 1 | 2;
export type DeviceChannelCloseReason = "superseded" | "revoked" | "server-shutdown";
export type DeviceChannelLifecycleReason = DeviceChannelCloseReason | "disconnected";

export interface DeviceChannelServerEventSender {
  (event: "capability.request", data: unknown): boolean;
}

interface ActiveDeviceChannel {
  channelId: string;
  protocolVersion: DeviceChannelProtocolVersion;
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
  send(data: unknown): boolean;
}

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
    const channel = this.active.get(deviceId);
    return channel?.protocolVersion === 2 && channel.send !== null;
  }

  capabilityRpcChannel(deviceId: string): DeviceCapabilityRpcChannel | null {
    const channel = this.active.get(deviceId);
    if (!channel || channel.protocolVersion !== 2 || !channel.send) return null;
    return {
      channelId: channel.channelId,
      send: (data) => channel.send!("capability.request", data)
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

  private notifyLifecycle(event: DeviceChannelLifecycleEvent): void {
    for (const listener of this.lifecycleListeners) listener(event);
  }
}

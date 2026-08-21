import crypto from "node:crypto";

export type DeviceChannelCloseReason = "superseded" | "revoked" | "server-shutdown";

interface ActiveDeviceChannel {
  channelId: string;
  close(reason: DeviceChannelCloseReason): void;
}

export interface DeviceChannelRegistration {
  channelId: string;
  dispose(): void;
}

export class DeviceChannelHub {
  private readonly active = new Map<string, ActiveDeviceChannel>();

  register(
    deviceId: string,
    close: (reason: DeviceChannelCloseReason) => void
  ): DeviceChannelRegistration {
    const channelId = `cc_channel_${crypto.randomBytes(18).toString("base64url")}`;
    const previous = this.active.get(deviceId);
    if (previous) {
      this.active.delete(deviceId);
      previous.close("superseded");
    }
    this.active.set(deviceId, { channelId, close });
    return {
      channelId,
      dispose: () => {
        const current = this.active.get(deviceId);
        if (current?.channelId === channelId) this.active.delete(deviceId);
      }
    };
  }

  isActive(deviceId: string): boolean {
    return this.active.has(deviceId);
  }

  activeDeviceIds(): ReadonlySet<string> {
    return new Set(this.active.keys());
  }

  closeDevice(deviceId: string, reason: DeviceChannelCloseReason): boolean {
    const current = this.active.get(deviceId);
    if (!current) return false;
    this.active.delete(deviceId);
    current.close(reason);
    return true;
  }

  closeAll(reason: DeviceChannelCloseReason = "server-shutdown"): void {
    const channels = [...this.active.entries()];
    this.active.clear();
    for (const [, channel] of channels) channel.close(reason);
  }
}

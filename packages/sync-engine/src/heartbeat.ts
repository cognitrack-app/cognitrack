import { Platform } from '@cognitrack/shared';

let isOnline = true;
const heartbeatListeners: ((online: boolean) => void)[] = [];

export function getOnlineStatus(): boolean {
  return isOnline;
}

export function onOnlineChange(cb: (online: boolean) => void): () => void {
  heartbeatListeners.push(cb);
  // Immediately call the existing listeners
  for (const listener of heartbeatListeners) {
    listener(isOnline);
  }
  // Return cleanup function
  return () => {
    const idx = heartbeatListeners.indexOf(cb);
    if (idx > -1) heartbeatListeners.splice(idx, 1);
  };
}

export function triggerOnlineChange(online: boolean): void {
  isOnline = online;
  for (const listener of heartbeatListeners) {
    listener(online);
  }
}

/**
 * HeartbeatSync class for periodic lastSeen updates.
 * Runs on a fixed interval (default 6 hours) to keep device alive in merge.
 */
export class HeartbeatSync {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly deviceId: string;
  private readonly platform: Platform;
  private readonly appVersion: string;
  private readonly updateDeviceLastSeen: (params: { deviceId: string; platform: Platform; appVersion: string }) => Promise<{ success: boolean }>;

  constructor(options: {
    intervalMs: number;
    deviceId: string;
    platform: Platform;
    appVersion: string;
    updateDeviceLastSeen: (params: { deviceId: string; platform: Platform; appVersion: string }) => Promise<{ success: boolean }>;
  }) {
    this.intervalMs = options.intervalMs;
    this.deviceId = options.deviceId;
    this.platform = options.platform;
    this.appVersion = options.appVersion;
    this.updateDeviceLastSeen = options.updateDeviceLastSeen;
  }

  start(): void {
    // Send initial heartbeat
    this.sendHeartbeat();
    // Schedule periodic heartbeats
    this.timer = setInterval(() => {
      this.sendHeartbeat();
    }, this.intervalMs);
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      const result = await this.updateDeviceLastSeen({
        deviceId: this.deviceId,
        platform: this.platform,
        appVersion: this.appVersion,
      });
      if (result.success) {
        console.log(`[HeartbeatSync] lastSeen updated for device ${this.deviceId}`);
      } else {
        console.warn('[HeartbeatSync] Failed to update lastSeen:', result);
      }
    } catch (err) {
      console.error('[HeartbeatSync] Error sending heartbeat:', err);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }
  /**
   * Create a new HeartbeatSync instance configured for 6-hour intervals (ENG-16).
   * Starts the heartbeat immediately.
   */
  static create(options: {
    deviceId: string;
    platform: Platform;
    appVersion: string;
    updateDeviceLastSeen: (params: { deviceId: string; platform: Platform; appVersion: string }) => Promise<{ success: boolean }>;
  }): HeartbeatSync {
    const instance = new HeartbeatSync({
      intervalMs: 6 * 60 * 60 * 1000, // 6 hours in ms
      deviceId: options.deviceId,
      platform: options.platform,
      appVersion: options.appVersion,
      updateDeviceLastSeen: options.updateDeviceLastSeen,
    });
    instance.start();
    return instance;
  }
}

/**
 * sync/heartbeat.ts
 *
 * Heartbeat synchronization for idle devices.
 * Sends lightweight lastSeen update every 6 hours instead of skipping sync.
 * ENG-16: Heartbeat sync for idle devices.
 * ENG-17: Uses updateDeviceLastSeen callable with set+merge.
 */

import type { Platform } from '../types';

export interface HeartbeatSyncOptions {
  intervalMs: number;                    // Default: 6 hours
  deviceId: string;
  platform: Platform;
  appVersion: string;
  updateDeviceLastSeen: (params: { deviceId: string; platform: Platform; appVersion: string }) => Promise<{ success: boolean }>;
}

/**
 * HeartbeatSync class for periodic lastSeen updates.
 * Runs on a fixed interval (default 6 hours) to keep device alive in merge.
 * Called by both mobile and desktop agents.
 */
export class HeartbeatSync {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly deviceId: string;
  private readonly platform: Platform;
  private readonly appVersion: string;
  private readonly updateDeviceLastSeen: HeartbeatSyncOptions['updateDeviceLastSeen'];

  constructor(options: HeartbeatSyncOptions) {
    this.intervalMs = options.intervalMs;
    this.deviceId = options.deviceId;
    this.platform = options.platform;
    this.appVersion = options.appVersion;
    this.updateDeviceLastSeen = options.updateDeviceLastSeen;
  }

  /**
   * Start the heartbeat timer.
   * Sends immediate heartbeat on start, then every intervalMs.
   */
  start(): void {
    // Send initial heartbeat
    this.sendHeartbeat();

    // Schedule periodic heartbeats
    this.timer = setInterval(() => {
      this.sendHeartbeat();
    }, this.intervalMs);
  }

  /**
   * Send a single heartbeat by calling updateDeviceLastSeen.
   * Uses set with merge: true on the server (ENG-17).
   */
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

  /**
   * Stop the heartbeat timer.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Check if heartbeat is running.
   */
  isRunning(): boolean {
    return this.timer !== null;
  }
}

/**
 * Factory function for creating a HeartbeatSync with default options.
 * Default interval: 6 hours (ENG-16).
 */
export function createHeartbeatSync(
  deviceId: string,
  platform: Platform,
  appVersion: string,
  updateDeviceLastSeen: HeartbeatSyncOptions['updateDeviceLastSeen'],
  intervalMs: number = 6 * 60 * 60 * 1000 // 6 hours
): HeartbeatSync {
  return new HeartbeatSync({ intervalMs, deviceId, platform, appVersion, updateDeviceLastSeen });
}
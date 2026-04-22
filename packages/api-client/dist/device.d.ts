import type { Platform } from '@cognitrack/shared';
export interface Device {
    deviceId: string;
    userId: string;
    platform: Platform;
    displayName: string;
    appVersion: string;
    type: 'desktop' | 'mobile';
    registeredAt?: unknown;
    lastSeenAt?: unknown;
}
/**
 * Upsert a device record under users/{userId}/devices/{deviceId}.
 * Uses merge:true so calling on every launch is safe.
 *
 * SECURITY: Firestore rules enforce request.auth.uid == userId,
 * so this path is protected — no other user can write to your devices.
 */
export declare function registerDevice(userId: string, deviceId: string, platform: Platform, displayName: string, appVersion: string): Promise<Device>;
/**
 * Fetch a single device record.
 */
export declare function getDevice(userId: string, deviceId: string): Promise<Device | null>;
/**
 * Fetch all devices registered for a user.
 */
export declare function getDevices(userId: string): Promise<Device[]>;
/**
 * Update the lastSeenAt timestamp — call on every app launch.
 */
export declare function updateDeviceLastSeen(userId: string, deviceId: string): Promise<void>;

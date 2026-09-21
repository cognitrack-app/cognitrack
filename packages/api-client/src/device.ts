import {
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  serverTimestamp,
  runTransaction,
  Transaction,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Platform } from '@cognitrack/shared';

export interface Device {
  deviceId:    string;
  userId:      string;
  platform:    Platform;
  displayName: string;     // e.g. "Gaurav's Windows PC"
  appVersion:  string;
  type:        'desktop' | 'mobile';
  registeredAt?: unknown;  // serverTimestamp()
  lastSeenAt?:   unknown;  // serverTimestamp()
}

/**
 * Upsert a device record under users/{userId}/devices/{deviceId}.
 * Uses a transaction to atomically check existence and set registeredAt only once.
 * This prevents race conditions where concurrent launches could both see !exists
 * and both write registeredAt, overwriting the original registration date.
 *
 * SECURITY: Firestore rules enforce request.auth.uid == userId,
 * so this path is protected — no other user can write to your devices.
 */
export async function registerDevice(
  userId: string,
  deviceId: string,
  platform: Platform,
  displayName: string,
  appVersion: string,
): Promise<Device> {
  // ✔ Correct path: users/{userId}/devices/{deviceId}
  const ref = doc(db, 'users', userId, 'devices', deviceId);

  // Use transaction for atomic check-and-set (matches mobile implementation)
  const deviceData = await runTransaction(db, async (transaction: Transaction) => {
    const snapshot = await transaction.get(ref);

    const base = {
      deviceId,
      userId,
      platform,
      displayName,
      appVersion,
      type: (platform === 'android' || platform === 'ios' ? 'mobile' : 'desktop') as Device['type'],
      lastSeenAt: serverTimestamp(),
    };

    // Only set registeredAt when the document is being created for the first time.
    const data = snapshot.exists()
      ? base
      : { ...base, registeredAt: serverTimestamp() };

    transaction.set(ref, data, { merge: true });
    return data as Device;
  });

  return deviceData;
}


/**
 * Fetch a single device record.
 */
export async function getDevice(userId: string, deviceId: string): Promise<Device | null> {
  const ref = doc(db, 'users', userId, 'devices', deviceId);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as Device) : null;
}

/**
 * Fetch all devices registered for a user.
 */
export async function getDevices(userId: string): Promise<Device[]> {
  const snap = await getDocs(collection(db, 'users', userId, 'devices'));
  return snap.docs.map(d => d.data() as Device);
}

/**
 * Update the lastSeenAt timestamp — call on every app launch.
 */
export async function updateDeviceLastSeen(userId: string, deviceId: string): Promise<void> {
  const ref = doc(db, 'users', userId, 'devices', deviceId);
  await setDoc(ref, { lastSeenAt: serverTimestamp() }, { merge: true });
}
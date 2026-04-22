import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Platform } from '@cognitrack/shared';

interface RegisterDevicePayload {
  deviceId: string;      // SHA-256 hash
  platform: Platform;
  displayName: string;   // e.g. "Gaurav's Windows PC"
}

export const registerDevice = onCall(
  { enforceAppCheck: false },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
    const uid = request.auth.uid;
    const { deviceId, platform, displayName } = request.data as RegisterDevicePayload;

    await getFirestore()
      .collection('users').doc(uid)
      .collection('devices').doc(deviceId)
      .set({
        displayName,
        platform,
        lastSeen: FieldValue.serverTimestamp(),
        registeredAt: FieldValue.serverTimestamp(),
      }, { merge: true });  // merge: true makes it safe to call on every launch

    return { success: true };
  }
);

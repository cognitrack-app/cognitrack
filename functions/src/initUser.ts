/**
 * initUser.ts
 *
 * Fires when a new Firebase Auth user is created.
 *
 * Writes:
 *   /users/{uid}/config/preferences  — UserConfig with defaults
 *
 * The display_id is generated as: "0x" + first 4 hex chars of uid in uppercase
 * + "_" + initials derived from the displayName, matching the UI format.
 *
 * Calibration is marked incomplete until the 7-day calibration pass
 * in calibrateUserBaselines() updates it.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { UserConfig } from '@cognitrack/shared';

/**
 * Triggered by auth user creation — wired via Firestore user record write.
 * The mobile/desktop agent writes a /users/{uid}/devices/{deviceId} doc on first
 * launch; we gate initUser on the FIRST device registration instead of Auth
 * trigger so we have a guaranteed Firestore path available.
 *
 * To use an Auth trigger instead, export as:
 *   export const initUser = onCall(...) or use getAuth().beforeCreate(...)
 */
export const initUser = onDocumentCreated(
  'users/{uid}/devices/{deviceId}',
  async (event) => {
    const uid = event.params.uid;
    const db  = getFirestore();

    const configRef = db.collection('users').doc(uid)
      .collection('config').doc('preferences');

    // Don't overwrite if already initialised
    const existing = await configRef.get();
    if (existing.exists) return;

    // Try to fetch display name from Auth.
    // For email/password accounts displayName is always null — fall back to
    // the email local-part (e.g. "gaurav.pandey@gmail.com" → "Gaurav Pandey").
    let displayName = 'User';
    try {
      const authUser = await getAuth().getUser(uid);
      if (authUser.displayName) {
        displayName = authUser.displayName;
      } else if (authUser.email) {
        // Convert email local-part to a human-readable name:
        //   gaurav.pandey → Gaurav Pandey
        //   john_doe      → John Doe
        displayName = authUser.email
          .split('@')[0]!
          .replace(/[._-]+/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
      }
    } catch (_) {
      // Auth record may not exist yet in emulator; safe to ignore
    }

    // Build display_id: "0x" + 4 hex chars + "_" + initials
    const hex    = uid.replace(/-/g, '').slice(0, 4).toUpperCase();
    const parts  = displayName.trim().split(' ');
    const initials = parts
      .filter(Boolean)
      .map(p => p[0]!.toUpperCase())
      .slice(0, 2)
      .join('');
    const displayId = `0x${hex}_${initials || 'XX'}`;

    const config: UserConfig = {
      display_id: displayId,
      onboarding_complete: false,
      permissions_granted: [],
      cognitive_debt_critical_threshold: 70,
      switch_baseline: 40,
      switch_critical_threshold: 80,
      sleep_target_hours: 7.5,
      wake_hour: 7,
      created_at: new Date().toISOString(),
      last_calibrated_at: new Date().toISOString(),
    };

    await configRef.set(config);
    console.log(`✅ initUser: wrote config for uid=${uid}, display_id=${displayId}`);
  }
);

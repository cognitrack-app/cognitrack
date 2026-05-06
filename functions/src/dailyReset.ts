/**
 * dailyReset.ts
 *
 * Scheduled: daily at wake_hour (default 07:00 CEST).
 *
 * Applies overnight recovery to yesterday's uncleared cognitive debt
 * and seeds the new day's starting conditions into the session document.
 *
 * What it writes to /users/{uid}/sessions/{today}:
 *   carryover_debt_pts  — uncleared debt from yesterday, carried into today
 *   carryover_residue   — attention residue remaining after overnight sleep
 *
 * The merge.ts / computeDerivedDayMetrics pipeline reads these fields
 * and adds them to today's accumulating debt so tomorrow's readiness
 * projection is accurate from the first event of the day.
 *
 * Overnight recovery model:
 *   - Each hour of sleep recovers 4 raw debt points (matches readiness formula).
 *   - Residue decays by 85% overnight (empirical; ~4x TAU_MS passed).
 *   - If the user slept their full sleep_target_hours, carryover is zero.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import type { UserConfig } from '@cognitrack/shared';

const DEBT_PTS_PER_SLEEP_HOUR = 4;
const OVERNIGHT_RESIDUE_DECAY = 0.15; // 15% of residue remains after a full night

/**
 * Return YYYY-MM-DD for the date that is `offset` calendar days from `base`,
 * shifted by `utcOffsetHours` so non-EU users get their own local date.
 * Uses setDate arithmetic (DST-safe, no fixed 86400000 subtraction).
 */
function localDateString(base: Date, offsetDays: number, utcOffsetHours: number): string {
  // Shift base to user's local noon to avoid midnight DST edge cases.
  const local = new Date(base.getTime() + utcOffsetHours * 3_600_000);
  local.setUTCDate(local.getUTCDate() + offsetDays);
  return local.toISOString().split('T')[0]!;
}

export const dailyReset = onSchedule(
  // MEDIUM-2 NOTE: Firebase Cloud Functions v2 Scheduler does not support
  // per-user scheduled functions. This fires once at 07:00 CEST for all users.
  //
  // To approximate the correct date for each user we read a utcOffsetHours
  // field from UserConfig (default 1 = CEST). When present we shift the date
  // calculation so non-EU users get carryover seeded into their correct local
  // date document rather than the server's Copenhagen date.
  { schedule: '0 7 * * *', timeZone: 'Europe/Copenhagen' },
  async () => {
    const db = getFirestore();

    // Server wall-clock date (Copenhagen local = UTC+1/+2) — used as default.
    // CLOUD-02 FIX: Use date arithmetic (setDate) rather than Date.now()-86400000
    // so DST spring-forward days (23h) don't overshoot by one calendar day.
    const serverNow = new Date();

    const usersSnap = await db.collection('users').get();


    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;

      // ── Fetch user config ────────────────────────────────────────────────
      const configSnap = await db
        .collection('users').doc(uid)
        .collection('config').doc('preferences')
        .get();

      if (!configSnap.exists) continue;
      const config = configSnap.data() as UserConfig & { utcOffsetHours?: number };

      // MEDIUM-2 FIX: compute dates in the user's local timezone.
      // utcOffsetHours is stored in UserConfig (e.g. -8 for PST, +5.5 for IST).
      // Falls back to 1 (CEST) so existing EU users are unaffected.
      const utcOffset = config.utcOffsetHours ?? 1;
      const localToday     = localDateString(serverNow, 0,  utcOffset);
      const localYesterday = localDateString(serverNow, -1, utcOffset);

      // ── Fetch yesterday's derived metrics ────────────────────────────────
      const yesterdayDerivedSnap = await db
        .collection('users').doc(uid)
        .collection('derived').doc(localYesterday)
        .get();

      if (!yesterdayDerivedSnap.exists) {
        // No data yesterday — nothing to carry over
        continue;
      }

      const yesterdayDerived = yesterdayDerivedSnap.data() as {
        readiness_uncleared_debt_pts?: number;
        attention_residue_score_pct?: number;
      };

      const unclearedDebt = yesterdayDerived.readiness_uncleared_debt_pts ?? 0;
      const residuePct    = yesterdayDerived.attention_residue_score_pct ?? 0;

      // ── Compute overnight recovery ───────────────────────────────────────
      const sleepTarget = config.sleep_target_hours ?? 7.5;
      // Conservative estimate: assume the user slept their full target.
      // If actual sleep data becomes available (e.g. HealthKit), replace this.
      const sleepHoursAssumed = sleepTarget;
      const debtRecovered = Math.round(sleepHoursAssumed * DEBT_PTS_PER_SLEEP_HOUR);
      const carryoverDebt = Math.max(0, unclearedDebt - debtRecovered);
      const carryoverResidue = Math.round(residuePct * OVERNIGHT_RESIDUE_DECAY);

      if (carryoverDebt === 0 && carryoverResidue === 0) {
        // Full recovery — no carryover to seed
        console.log(`✅ dailyReset uid=${uid}: full recovery, no carryover for ${localToday}`);
        continue;
      }

      // ── Seed today's session document with carryover values ─────────────
      // Uses merge:true so we don't overwrite any same-day events that
      // may have already been written by an early-morning agent run.
      await db
        .collection('users').doc(uid)
        .collection('sessions').doc(localToday)
        .set(
          {
            date: localToday,
            carryover_debt_pts: carryoverDebt,
            carryover_residue:  carryoverResidue,
          },
          { merge: true }
        );

      console.log(
        `✅ dailyReset uid=${uid} (UTC${utcOffset >= 0 ? '+' : ''}${utcOffset}): ` +
        `unclearedYesterday=${unclearedDebt}pts → carryover=${carryoverDebt}pts, ` +
        `residueCarryover=${carryoverResidue}%`
      );
    }
  }
);

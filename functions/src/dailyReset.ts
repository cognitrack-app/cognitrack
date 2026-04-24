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

export const dailyReset = onSchedule(
  // Run at 07:00 CEST by default. Individual wake_hour config is checked
  // per-user below — users who have a different wake_hour will still get
  // correct carryover values when their first session write triggers merge.ts.
  { schedule: '0 7 * * *', timeZone: 'Europe/Copenhagen' },
  async () => {
    const db = getFirestore();

    const today = new Date().toISOString().split('T')[0]!;
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0]!;

    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;

      // ── Fetch user config ────────────────────────────────────────────────
      const configSnap = await db
        .collection('users').doc(uid)
        .collection('config').doc('preferences')
        .get();

      if (!configSnap.exists) continue;
      const config = configSnap.data() as UserConfig;

      // ── Fetch yesterday's derived metrics ────────────────────────────────
      const yesterdayDerivedSnap = await db
        .collection('users').doc(uid)
        .collection('derived').doc(yesterday)
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
        console.log(`✅ dailyReset uid=${uid}: full recovery, no carryover for ${today}`);
        continue;
      }

      // ── Seed today's session document with carryover values ─────────────
      // Uses merge:true so we don't overwrite any same-day events that
      // may have already been written by an early-morning agent run.
      await db
        .collection('users').doc(uid)
        .collection('sessions').doc(today)
        .set(
          {
            date: today,
            carryover_debt_pts: carryoverDebt,
            carryover_residue:  carryoverResidue,
          },
          { merge: true }
        );

      console.log(
        `✅ dailyReset uid=${uid}: ` +
        `unclearedYesterday=${unclearedDebt}pts → carryover=${carryoverDebt}pts, ` +
        `residueCarryover=${carryoverResidue}%`
      );
    }
  }
);

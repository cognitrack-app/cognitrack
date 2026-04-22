/**
 * weeklyRollup.ts
 *
 * Scheduled: every Monday at 03:00 CEST.
 *
 * For every user:
 *  1. Fetches the last 7 sessions.
 *  2. Computes an enriched WeeklyReport (extends the original avgCombinedLoad
 *     and avgFragmentation with all new metrics).
 *  3. Writes to /users/{uid}/weeklyReports/{weekId}.
 *
 * Also backfills any /derived/{date} documents that may have been missed
 * during the week (e.g. the user only had phone data for some days).
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import type {
  SessionDocument,
  UserConfig,
  WeeklyReport,
} from '@cognitrack/shared';
import { computeDerivedDayMetrics } from './derivations';

export const weeklyRollup = onSchedule(
  { schedule: '0 3 * * 1', timeZone: 'Europe/Copenhagen' },
  async () => {
    const db = getFirestore();

    const today = new Date();
    // Build the 7 date strings for the past week (Mon–Sun)
    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - i - 1);
      return d.toISOString().split('T')[0]!;
    });
    const weekId = `week-${weekDates[6]}-to-${weekDates[0]}`;

    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;

      // Fetch user config
      const configSnap = await db
        .collection('users').doc(uid)
        .collection('config').doc('preferences')
        .get();
      const config: UserConfig = configSnap.exists
        ? (configSnap.data() as UserConfig)
        : {
            display_id: uid.slice(0, 8).toUpperCase(),
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

      // Fetch session documents for the week
      const sessionDocs = await Promise.all(
        weekDates.map(date =>
          db.collection('users').doc(uid)
            .collection('sessions').doc(date).get()
        )
      );

      const validSessions: SessionDocument[] = sessionDocs
        .filter(d => d.exists)
        .map(d => d.data() as SessionDocument);

      if (validSessions.length === 0) continue;

      // ──────────────────────────────────────────────────────────────────────────
      // Backfill /derived/{date} for any day that is missing it
      // ──────────────────────────────────────────────────────────────────────────
      for (let i = 0; i < validSessions.length; i++) {
        const daySession = validSessions[i]!;
        const derivedSnap = await db
          .collection('users').doc(uid)
          .collection('derived').doc(daySession.date)
          .get();

        if (!derivedSnap.exists) {
          // Treat sessions before this day as "last 7" context
          const ctx = validSessions.slice(i + 1, i + 8);
          const derived = computeDerivedDayMetrics(daySession, ctx, config);
          await db.collection('users').doc(uid)
            .collection('derived').doc(daySession.date)
            .set(derived, { merge: true });
          console.log(`✅ Backfilled derived/${daySession.date} for uid=${uid}`);
        }
      }

      // ──────────────────────────────────────────────────────────────────────────
      // Build enriched WeeklyReport
      // ──────────────────────────────────────────────────────────────────────────
      const avg = (arr: number[]): number =>
        arr.length === 0 ? 0 : Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

      const combinedLoads = validSessions.map(
        s => s.combinedLoad ?? s.phoneMetrics?.cognitiveLoadPct ?? 0
      );
      const frags = validSessions.map(s => s.dualFragmentation ?? 0);
      const debts = validSessions.map(s => s.phoneMetrics?.cognitiveDebt ?? 0);
      const residues = validSessions.map(
        s => Math.round((s.phoneMetrics?.residueAtEOD ?? 0) * 100)
      );
      const focusMinutes = validSessions.map(s => {
        const pp = s.phoneMetrics;
        return pp
          ? Math.round(pp.totalScreenTime * 60 * (pp.categoryBreakdown.productive ?? 0))
          : 0;
      });
      const recoveryMinutes = validSessions.map(s => {
        const st = s.phoneMetrics?.totalScreenTime ?? 0;
        return Math.max(0, 16 - st) * 60;
      });

      // Peak debt day
      let peakDebtIdx = 0;
      combinedLoads.forEach((v, i) => { if (v > (combinedLoads[peakDebtIdx] ?? 0)) peakDebtIdx = i; });

      // Total breaches across week
      const totalBreaches = validSessions.reduce((sum, s) => {
        const p = s.phoneMetrics;
        if (!p) return sum;
        const critThreshold = config.switch_critical_threshold ?? 80;
        return sum + p.hourlyLoad.filter(l => (l / 100) * critThreshold * 1.2 > critThreshold).length;
      }, 0);

      const report: WeeklyReport = {
        week_id: weekId,
        avg_combined_load: avg(combinedLoads),
        avg_fragmentation: avg(frags),
        avg_cognitive_debt: avg(debts),
        avg_attention_residue: avg(residues),
        avg_focus_minutes: avg(focusMinutes),
        avg_recovery_minutes: avg(recoveryMinutes),
        peak_debt_day: validSessions[peakDebtIdx]?.date ?? weekDates[0]!,
        peak_debt_value: combinedLoads[peakDebtIdx] ?? 0,
        total_breaches: totalBreaches,
        computed_at: new Date().toISOString(),
      };

      await db.collection('users').doc(uid)
        .collection('weeklyReports').doc(weekId)
        .set(report, { merge: true });

      console.log(
        `✅ Weekly rollup for uid=${uid} week=${weekId}: ` +
        `avgLoad=${report.avg_combined_load}%, ` +
        `avgFrag=${report.avg_fragmentation}, ` +
        `peakDay=${report.peak_debt_day}`
      );
    }
  }
);

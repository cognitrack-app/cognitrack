/**
 * calibrateBaselines.ts
 *
 * Scheduled: daily at 03:30 CEST.
 *
 * After a user has 7 or more session documents, compute personalized
 * thresholds from their actual usage data and update UserConfig.
 *
 * Calibrated fields:
 *   switch_baseline         — user's avg hourly switch rate on normal days
 *   switch_critical_threshold  — baseline * 2 (capped at 120)
 *   cognitive_debt_critical_threshold — 75th percentile of their debt scores
 *
 * Skips users who have fewer than 7 sessions or were calibrated < 6 days ago.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import type { SessionDocument, UserConfig } from '@cognitrack/shared';

export const calibrateBaselines = onSchedule(
  { schedule: '30 3 * * *', timeZone: 'Europe/Copenhagen' },
  async () => {
    const db = getFirestore();
    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const configRef = db.collection('users').doc(uid)
        .collection('config').doc('preferences');

      const configSnap = await configRef.get();
      if (!configSnap.exists) continue;

      const config = configSnap.data() as UserConfig;

      // Skip if calibrated recently
      const lastCal = new Date(config.last_calibrated_at).getTime();
      if (Date.now() - lastCal < 6 * 24 * 60 * 60 * 1000) continue;

      // Fetch last 14 sessions for stable calibration
      const sessionsSnap = await db
        .collection('users').doc(uid)
        .collection('sessions')
        .orderBy('date', 'desc')
        .limit(14)
        .get();

      if (sessionsSnap.size < 7) continue;

      const sessions: SessionDocument[] = sessionsSnap.docs.map(d => d.data() as SessionDocument);

      // Average hourly switches across all days
      const dailyAvgSwitches = sessions.map(s => {
        const total = (s.phoneMetrics?.totalSwitches ?? 0) +
          Object.values(s.desktopSessions ?? {}).reduce((sum, d) => sum + d.totalSwitches, 0);
        // Divide by active hours (where combined load > 10%)
        const combinedHourly: number[] = s.combinedHourlyLoad ??
          (s.phoneMetrics?.hourlyLoad ?? Array(24).fill(0));
        const activeHours = combinedHourly.filter(l => l > 10).length || 8;
        return total / activeHours;
      });

      // Remove top/bottom 15% outliers
      const sorted = [...dailyAvgSwitches].sort((a, b) => a - b);
      const trim = Math.floor(sorted.length * 0.15);
      const trimmed = sorted.slice(trim, sorted.length - trim);
      const newBaseline = Math.round(
        trimmed.reduce((a, b) => a + b, 0) / trimmed.length
      );

      // 75th percentile debt score
      const debtScores = sessions
        .map(s => s.combinedLoad ?? s.phoneMetrics?.cognitiveLoadPct ?? 0)
        .sort((a, b) => a - b);
      const p75idx = Math.floor(debtScores.length * 0.75);
      const newDebtCritical = Math.round(debtScores[p75idx] ?? 70);

      const updates: Partial<UserConfig> = {
        switch_baseline: Math.max(20, newBaseline),
        switch_critical_threshold: Math.min(120, Math.max(40, newBaseline * 2)),
        cognitive_debt_critical_threshold: Math.max(50, Math.min(90, newDebtCritical)),
        last_calibrated_at: new Date().toISOString(),
      };

      await configRef.update(updates);
      console.log(
        `✅ Calibrated uid=${uid}: ` +
        `switchBaseline=${updates.switch_baseline}, ` +
        `critThreshold=${updates.switch_critical_threshold}, ` +
        `debtCritical=${updates.cognitive_debt_critical_threshold}`
      );
    }
  }
);

/**
 * merge.ts
 *
 * Fires on EVERY write to /users/{uid}/sessions/{date}.
 *
 * Pass 1 (cross-device merge): runs as soon as both phoneMetrics AND
 * desktopSessions are present. Writes combinedLoad, dualFragmentation,
 * phoneInterruptsDuringWork, combined switch fields back to the session doc.
 *
 * Pass 2 (derived metrics): after Pass 1 completes, fetches last 7 sessions
 * and UserConfig, runs computeDerivedDayMetrics, and writes the result to
 * /users/{uid}/derived/{date} — the single document the UI reads.
 *
 * Loop prevention: skips Pass 1 if lastMergeRun is already newer than both
 * agents' lastUpdated timestamps.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { computeDualDeviceFragmentation } from '@cognitrack/shared';
import type {
  DesktopSyncPayload,
  PhoneSyncPayload,
  SessionDocument,
  UserConfig,
} from '@cognitrack/shared';
import { computeDerivedDayMetrics } from './derivations';

export const mergeAgentData = onDocumentWritten(
  'users/{uid}/sessions/{date}',
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const data = after.data() as SessionDocument;
    if (!data) return;

    // Preserve carryover values written by dailyReset.ts this morning.
    // These fields are NOT part of any agent payload — they exist only in
    // the Firestore document and must be passed through to derivations.
    const existingData = (event.data?.before?.data() as Partial<SessionDocument>) ?? {};
    data.carryover_debt_pts  = data.carryover_debt_pts ?? existingData.carryover_debt_pts ?? 0;
    data.carryover_residue   = data.carryover_residue ?? existingData.carryover_residue ?? 0;

    const phone = data.phoneMetrics as PhoneSyncPayload | undefined;
    const desktopSessions = data.desktopSessions as
      | Record<string, DesktopSyncPayload>
      | undefined;
    const lastMergeRun = data.lastMergeRun;

    const uid = event.params.uid;
    const date = event.params.date;
    const db = getFirestore();
    const sessionRef = db.collection('users').doc(uid).collection('sessions').doc(date);
    const derivedRef  = db.collection('users').doc(uid).collection('derived').doc(date);

    // ────────────────────────────────────────────────────────────────────────────
    // PASS 1 ─ Cross-device merge
    // Requires BOTH phone AND at least one desktop to have reported.
    // Skips if we already merged after both agents' last updates.
    // ────────────────────────────────────────────────────────────────────────────

    const hasPhone = !!phone;
    const hasDesktop = !!desktopSessions && Object.keys(desktopSessions).length > 0;

    if (hasPhone && hasDesktop) {
      const desktops = Object.values(desktopSessions!);
      const primaryDesktop = desktops.reduce((best, d) =>
        d.totalFocusedTime > best.totalFocusedTime ? d : best
      );

      // Loop prevention
      if (lastMergeRun) {
        const mergeTime   = new Date(lastMergeRun).getTime();
        const phoneTime   = new Date(phone!.lastUpdated).getTime();
        const desktopTime = new Date(primaryDesktop.lastUpdated).getTime();
        if (mergeTime > phoneTime && mergeTime > desktopTime) {
          // Already up to date — skip Pass 1 but still run Pass 2 to refresh derived doc
          await runDerivedPass(db, uid, date, data, derivedRef);
          return;
        }
      }

      // Fragmentation score
      const fragReport = computeDualDeviceFragmentation({
        phoneHourlyDebt:     phone!.hourlyLoad,
        desktopHourlyDebt:   primaryDesktop.hourlyLoad,
        phoneCategoryBreakdown:   phone!.categoryBreakdown,
        desktopCategoryBreakdown: primaryDesktop.categoryBreakdown,
      });

      // Combined load: 55% phone + 45% primary desktop
      const combinedLoad = Math.round(
        phone!.cognitiveLoadPct * 0.55 + primaryDesktop.cognitiveLoadPct * 0.45
      );

      // CLOUD-04 FIX: This metric counts the number of HOURS in the day where
      // both desktop load was > 30% AND phone load was > 20% simultaneously.
      // This is NOT an interruption count — a user who checks their phone
      // briefly 20 times in one hour still registers as 1 overlap hour, while
      // a user who checks it once across 5 different work hours registers as 5.
      // Renamed phoneHighLoadOverlapHours to accurately describe the metric.
      // The UI should label this "Hours of concurrent phone & desktop load",
      // not "Interruptions During Work".
      const phoneHighLoadOverlapHours = primaryDesktop.hourlyLoad.reduce(
        (count, desktopLoad, hour) => {
          const phoneLoad = phone!.hourlyLoad[hour] ?? 0;
          return desktopLoad > 30 && phoneLoad > 20 ? count + 1 : count;
        },
        0
      );

      // Combined switches: ALL devices summed
      const combinedSwitchesTotal =
        phone!.totalSwitches +
        desktops.reduce((s, d) => s + d.totalSwitches, 0);

      const combinedSwitchVelocityPeak = Math.max(
        phone!.switchVelocityPeak,
        ...desktops.map(d => d.switchVelocityPeak)
      );

      // Element-wise max hourly load across devices
      const combinedHourlyLoad = Array.from({ length: 24 }, (_, i) =>
        Math.max(
          phone!.hourlyLoad[i] ?? 0,
          ...desktops.map(d => d.hourlyLoad[i] ?? 0)
        )
      );

      await sessionRef.update({
        combinedLoad,
        dualFragmentation: fragReport.score,
        phoneHighLoadOverlapHours,   // CLOUD-04: renamed from phoneInterruptsDuringWork
        combinedSwitchesTotal,
        combinedSwitchVelocityPeak,
        combinedHourlyLoad,
        lastMergeRun: new Date().toISOString(),
      });

      // Refresh data snapshot with the merged fields before Pass 2
      data.combinedLoad                = combinedLoad;
      data.dualFragmentation            = fragReport.score;
      data.phoneHighLoadOverlapHours    = phoneHighLoadOverlapHours; // CLOUD-04: renamed
      data.combinedSwitchesTotal        = combinedSwitchesTotal;
      data.combinedSwitchVelocityPeak   = combinedSwitchVelocityPeak;
      data.combinedHourlyLoad           = combinedHourlyLoad;

      console.log(
        `✅ Merged ${date} for uid=${uid}: ` +
        `combinedLoad=${combinedLoad}%, frag=${fragReport.score}, ` +
        `phoneHighLoadOverlapHours=${phoneHighLoadOverlapHours}, ` +
        `combinedSwitches=${combinedSwitchesTotal}`
      );
    }

    // ────────────────────────────────────────────────────────────────────────────
    // PASS 2 ─ Derived metrics (runs after every write, phone-only or combined)
    // ────────────────────────────────────────────────────────────────────────────
    await runDerivedPass(db, uid, date, data, derivedRef);
  }
);

// ────────────────────────────────────────────────────────────────────────────
// Helper: fetch context, compute DerivedDayMetrics, write to /derived/{date}
// ────────────────────────────────────────────────────────────────────────────
async function runDerivedPass(
  db: FirebaseFirestore.Firestore,
  uid: string,
  date: string,
  today: SessionDocument,
  derivedRef: FirebaseFirestore.DocumentReference
): Promise<void> {
  // Fetch last 7 session documents (descending — yesterday first)
  const last7Snap = await db
    .collection('users').doc(uid)
    .collection('sessions')
    .orderBy('date', 'desc')
    .limit(8)
    .get();

  const last7: SessionDocument[] = last7Snap.docs
    .map(d => d.data() as SessionDocument)
    .filter(s => s.date !== date)  // exclude today
    .slice(0, 7);

  // Fetch user config — fallback to sensible defaults if not yet written
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

  const derived = computeDerivedDayMetrics(today, last7, config);

  await derivedRef.set(derived, { merge: true });

  console.log(
    `✅ Derived metrics written for ${date} uid=${uid}: ` +
    `debtScore=${derived.cognitive_debt_score_pct}%, ` +
    `combinedSwitches=${derived.context_switches_count_today}, ` +
    `syncStatus=${derived.data_sync_status}`
  );
}

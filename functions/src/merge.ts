/**
 * merge.ts
 *
 * Fires on EVERY write to /users/{uid}/sessions/{date}.
 *
 * Pass 1 (cross-device merge): runs as soon as both phoneMetrics AND
 * desktopSessions are present. Writes combinedLoad, dualFragmentation,
 * phoneHighLoadOverlapHours, combined switch fields back to the session doc.
 *
 * Multi-desktop aggregation: ALL desktops are weighted by totalFocusedTime
 * (productive + tools hours). This preserves every desktop's switches,
 * load profile, and category breakdown proportionally to actual usage.
 *
 * Pass 2 (derived metrics): after Pass 1 completes, fetches last 7 sessions
 * and UserConfig, runs computeDerivedDayMetrics, and writes the result to
 * /users/{uid}/derived/{date} — the single document the UI reads.
 *
 * Loop prevention: uses a transaction with idempotency token to prevent
 * concurrent executions on the same session document.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue, Transaction } from 'firebase-admin/firestore';
import { computeDualDeviceFragmentation } from '@cognitrack/shared';
import type {
  DesktopSyncPayload,
  PhoneSyncPayload,
  SessionDocument,
  UserConfig,
} from '@cognitrack/shared';
import { computeDerivedDayMetrics } from './derivations';

const HOURS_IN_DAY = 24;
const REQUIRED_HOURLY_LOAD_LENGTH = 24;

function validateHourlyLoad(hourlyLoad: number[] | undefined, source: string): number[] {
  if (!hourlyLoad || !Array.isArray(hourlyLoad)) {
    throw new Error(`${source}: hourlyLoad is missing or not an array`);
  }
  if (hourlyLoad.length !== REQUIRED_HOURLY_LOAD_LENGTH) {
    throw new Error(`${source}: hourlyLoad has invalid length ${hourlyLoad.length}, expected ${REQUIRED_HOURLY_LOAD_LENGTH}`);
  }
  for (let i = 0; i < hourlyLoad.length; i++) {
    const val = hourlyLoad[i];
    if (typeof val !== 'number' || Number.isNaN(val)) {
      throw new Error(`${source}: hourlyLoad[${i}] is not a valid number`);
    }
  }
  return hourlyLoad;
}

function validateDesktopPayload(desktop: DesktopSyncPayload, deviceId: string): void {
  validateHourlyLoad(desktop.hourlyLoad, `desktop ${deviceId}`);
  if (typeof desktop.cognitiveLoadPct !== 'number' || Number.isNaN(desktop.cognitiveLoadPct)) {
    throw new Error(`desktop ${deviceId}: cognitiveLoadPct is not a valid number`);
  }
  if (typeof desktop.totalFocusedTime !== 'number' || Number.isNaN(desktop.totalFocusedTime)) {
    throw new Error(`desktop ${deviceId}: totalFocusedTime is not a valid number`);
  }
}

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

    const uid = event.params.uid;
    const date = event.params.date;
    const db = getFirestore();
    const sessionRef = db.collection('users').doc(uid).collection('sessions').doc(date);
    const derivedRef  = db.collection('users').doc(uid).collection('derived').doc(date);

    // ────────────────────────────────────────────────────────────────────────────
    // PASS 1 ─ Cross-device merge
    // Requires BOTH phone AND at least one desktop to have reported.
    // Skips if we already merged after both agents' last updates.
    // Uses a transaction with idempotency token to prevent race conditions.
    // ────────────────────────────────────────────────────────────────────────────

    const hasPhone = !!phone;
    const hasDesktop = !!desktopSessions && Object.keys(desktopSessions).length > 0;

    if (hasPhone && hasDesktop) {
      const desktops = Object.values(desktopSessions!);

      // Validate all payloads before processing
      validateHourlyLoad(phone!.hourlyLoad, 'phone');
      if (typeof phone!.cognitiveLoadPct !== 'number' || Number.isNaN(phone!.cognitiveLoadPct)) {
        throw new Error('phone: cognitiveLoadPct is not a valid number');
      }
      for (const [deviceId, desktop] of Object.entries(desktopSessions!)) {
        validateDesktopPayload(desktop, deviceId);
      }

      // Use a transaction for atomic read-compute-write with idempotency check
      await db.runTransaction(async (transaction: Transaction) => {
        const sessionDoc = await transaction.get(sessionRef);
        if (!sessionDoc.exists) return;

        const sessionData = sessionDoc.data() as SessionDocument;
        const currentLastMergeRun = sessionData.lastMergeRun;

        // Idempotency check: skip if lastMergeRun is newer than both agents' last updates
        if (currentLastMergeRun) {
          // Handle both string (legacy) and Timestamp (new) formats
          // Use duck typing since SessionDocument.lastMergeRun is typed as string | { toDate(): Date }
          const isTimestamp = typeof currentLastMergeRun === 'object' &&
                              currentLastMergeRun !== null &&
                              'toDate' in currentLastMergeRun;
          const mergeTime = isTimestamp
            ? (currentLastMergeRun as { toDate(): Date }).toDate().getTime()
            : new Date(currentLastMergeRun).getTime();
          const phoneTime = new Date(phone!.lastUpdated).getTime();
          const latestDesktopTime = Math.max(...desktops.map(d => new Date(d.lastUpdated).getTime()));
          if (mergeTime > phoneTime && mergeTime > latestDesktopTime) {
            // Already merged after both agents reported — skip Pass 1
            return;
          }
        }

        // ─── Weighted Multi-Desktop Aggregation ─────────────────────────────────────
        // Weight each desktop by totalFocusedTime (productive + tools hours).
        // This ensures a work laptop (6h focused) contributes more than a personal
        // laptop (1h focused), while still preserving ALL switches and load data.
        const weighted = aggregateDesktopsByFocusedTime(desktops);

        // Fragmentation: phone vs. ALL desktops (weighted hourly load)
        const fragReport = computeDualDeviceFragmentation({
          phoneHourlyDebt:     phone!.hourlyLoad,
          desktopHourlyDebt:   weighted.hourlyLoad,
          phoneCategoryBreakdown:   phone!.categoryBreakdown,
          desktopCategoryBreakdown: weighted.categoryBreakdown,
        });

        // Combined load: 55% phone + 45% weighted desktop aggregate
        const combinedLoad = Math.min(100, Math.round(
          phone!.cognitiveLoadPct * 0.55 + weighted.cognitiveLoadPct * 0.45
        ));

        // Phone high-load overlap hours: hours where ANY desktop >30% AND phone >20%
        const phoneHighLoadOverlapHours = weighted.hourlyLoad.reduce(
          (count, desktopLoad, hour) => {
            const phoneLoad = phone!.hourlyLoad[hour];
            return desktopLoad > 30 && phoneLoad > 20 ? count + 1 : count;
          },
          0
        );

        // Combined switches: phone + ALL desktops (every switch counts)
        const combinedSwitchesTotal =
          phone!.totalSwitches +
          desktops.reduce((s, d) => s + d.totalSwitches, 0);

        // Combined velocity peak: max across phone + ALL desktops
        const combinedSwitchVelocityPeak = Math.max(
          phone!.switchVelocityPeak,
          ...desktops.map(d => d.switchVelocityPeak)
        );

        // Combined hourly load: element-wise max(phone, weightedDesktop)
        const combinedHourlyLoad = Array.from({ length: HOURS_IN_DAY }, (_, i) =>
          Math.max(
            phone!.hourlyLoad[i],
            weighted.hourlyLoad[i]
          )
        );

        // Write merged fields with server timestamp for idempotency
        const mergeRunTime = FieldValue.serverTimestamp();
        transaction.update(sessionRef, {
          combinedLoad,
          dualFragmentation: fragReport.score,
          phoneHighLoadOverlapHours,
          combinedSwitchesTotal,
          combinedSwitchVelocityPeak,
          combinedHourlyLoad,
          lastMergeRun: mergeRunTime,
        });

        // Refresh data snapshot with the merged fields before Pass 2
        data.combinedLoad                = combinedLoad;
        data.dualFragmentation            = fragReport.score;
        data.phoneHighLoadOverlapHours    = phoneHighLoadOverlapHours;
        data.combinedSwitchesTotal        = combinedSwitchesTotal;
        data.combinedSwitchVelocityPeak   = combinedSwitchVelocityPeak;
        data.combinedHourlyLoad           = combinedHourlyLoad;
        data.lastMergeRun                 = new Date().toISOString(); // approximate for local use

        console.log(
          `✅ Merged ${date} for uid=${uid}: ` +
          `combinedLoad=${combinedLoad}%, frag=${fragReport.score}, ` +
          `phoneHighLoadOverlapHours=${phoneHighLoadOverlapHours}, ` +
          `combinedSwitches=${combinedSwitchesTotal}, ` +
          `desktops=${desktops.length} (weighted)`
        );
      });
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
  // Use a larger limit to account for potential malformed dates, then filter client-side
  const last7Snap = await db
    .collection('users').doc(uid)
    .collection('sessions')
    .orderBy('date', 'desc')
    .limit(14) // Fetch extra to handle any malformed/missing dates
    .get();

  const allSessions: SessionDocument[] = last7Snap.docs
    .map(d => d.data() as SessionDocument)
    .filter(s => s.date && typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date))
    .filter(s => s.date !== date)  // exclude today
    .sort((a, b) => b.date.localeCompare(a.date)) // ensure descending by date
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

  const derived = computeDerivedDayMetrics(today, allSessions, config);

  await derivedRef.set(derived, { merge: true });

  console.log(
    `✅ Derived metrics written for ${date} uid=${uid}: ` +
    `debtScore=${derived.cognitive_debt_score_pct}%, ` +
    `combinedSwitches=${derived.context_switches_count_today}, ` +
    `syncStatus=${derived.data_sync_status}`
  );
}

// ─── Weighted Multi-Desktop Aggregation Helper ────────────────────────────────────
// Aggregates all desktop payloads weighted by totalFocusedTime (productive + tools hours).
// Returns a single "virtual desktop" payload representing the user's total desktop activity.
interface AggregatedDesktop {
  cognitiveLoadPct: number;
  hourlyLoad: number[];
  categoryBreakdown: {
    productive: number;
    tools: number;
    social: number;
    entertainment: number;
    passiveWaste: number;
  };
}

function aggregateDesktopsByFocusedTime(desktops: DesktopSyncPayload[]): AggregatedDesktop {
  // Defensive: handle empty array (should not happen if called correctly, but guard anyway)
  if (desktops.length === 0) {
    // Return neutral aggregate — all zeros
    return {
      cognitiveLoadPct: 0,
      hourlyLoad: Array(HOURS_IN_DAY).fill(0),
      categoryBreakdown: {
        productive: 0,
        tools: 0,
        social: 0,
        entertainment: 0,
        passiveWaste: 100,
      },
    };
  }

  // Calculate weights: totalFocusedTime per desktop
  const weights = desktops.map(d => d.totalFocusedTime ?? 0);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  // Edge case: no focused time recorded (e.g., all desktops idle)
  // Fall back to equal weighting
  const normalizedWeights = totalWeight > 0
    ? weights.map(w => w / totalWeight)
    : weights.map(() => 1 / desktops.length);

  // Weighted cognitive load
  const cognitiveLoadPct = Math.round(
    desktops.reduce((sum, d, i) => sum + d.cognitiveLoadPct * normalizedWeights[i], 0)
  );

  // Weighted hourly load (element-wise)
  const hourlyLoad = Array.from({ length: HOURS_IN_DAY }, (_, h) =>
    Math.round(desktops.reduce((sum, d, i) => sum + (d.hourlyLoad[h] ?? 0) * normalizedWeights[i], 0))
  );

  // Weighted category breakdown (5 categories)
  const categoryKeys = ['productive', 'tools', 'social', 'entertainment', 'passiveWaste'] as const;
  const categoryBreakdown = categoryKeys.reduce((acc, key) => {
    const weightedSum = desktops.reduce((sum, d, i) => sum + (d.categoryBreakdown[key] ?? 0) * normalizedWeights[i], 0);
    acc[key] = Math.round(weightedSum);
    return acc;
  }, {} as AggregatedDesktop['categoryBreakdown']);

  // Ensure sum = 100 (floor 4, passiveWaste absorbs remainder)
  const firstFourSum = categoryBreakdown.productive + categoryBreakdown.tools + categoryBreakdown.social + categoryBreakdown.entertainment;
  categoryBreakdown.passiveWaste = Math.max(0, 100 - firstFourSum);

  return { cognitiveLoadPct, hourlyLoad, categoryBreakdown };
}
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
 *
 * ENG-05: Tolerant merge - wraps per-device validation/merge in try-catch,
 * collects errors array, logs structured WARNING to Cloud Logging with
 * {userId, date, deviceId, error}, continues with valid devices.
 *
 * ENG-10: Server timestamp ordering - uses FieldValue.serverTimestamp()
 * for merge ordering and updatedAt field.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue, Transaction } from 'firebase-admin/firestore';
import { Logging } from '@google-cloud/logging';
import { calculateWeightedOverlap, computeDualDeviceFragmentation, normalizeToUtcBuckets } from "@cognitrack/shared";
import type {
  DesktopSyncPayload,
  PhoneSyncPayload,
  SessionDocument,
  UserConfig,
} from '@cognitrack/shared';
import { computeDerivedDayMetrics, CachedContext, isCacheValidForContext } from './derivations';
import { invalidateDerivedCache } from './cache';

const HOURS_IN_DAY = 24;
const REQUIRED_HOURLY_LOAD_LENGTH = 24;

// Initialize Cloud Logging client for structured error logging (ENG-05)
const logging = new Logging();
const logName = 'cognitrack-merge-errors';
const log = logging.log(logName);

function validateHourlyLoad(hourlyLoad: number[] | undefined, source: string): boolean {
  if (!hourlyLoad || !Array.isArray(hourlyLoad)) {
    console.warn(`[MERGE SKIP] ${source}: hourlyLoad is missing or not an array`);
    return false;
  }
  if (hourlyLoad.length !== REQUIRED_HOURLY_LOAD_LENGTH) {
    console.warn(`[MERGE SKIP] ${source}: hourlyLoad has invalid length ${hourlyLoad.length}, expected ${REQUIRED_HOURLY_LOAD_LENGTH}`);
    return false;
  }
  for (let i = 0; i < hourlyLoad.length; i++) {
    const val = hourlyLoad[i];
    if (typeof val !== 'number' || Number.isNaN(val)) {
      console.warn(`[MERGE SKIP] ${source}: hourlyLoad[${i}] is not a valid number`);
      return false;
    }
  }
  return true;
}

function validateDesktopPayload(desktop: DesktopSyncPayload, deviceId: string): boolean {
  if (!validateHourlyLoad(desktop.hourlyLoad, `desktop ${deviceId}`)) return false;
  if (typeof desktop.cognitiveLoadPct !== 'number' || Number.isNaN(desktop.cognitiveLoadPct)) {
    console.warn(`[MERGE SKIP] desktop ${deviceId}: cognitiveLoadPct is not a valid number`);
    return false;
  }
  if (typeof desktop.totalFocusedTime !== 'number' || Number.isNaN(desktop.totalFocusedTime)) {
    console.warn(`[MERGE SKIP] desktop ${deviceId}: totalFocusedTime is not a valid number`);
    return false;
  }
  return true;
}

function validatePhonePayload(phone: PhoneSyncPayload): boolean {
  if (!validateHourlyLoad(phone.hourlyLoad, 'phone')) return false;
  if (typeof phone.cognitiveLoadPct !== 'number' || Number.isNaN(phone.cognitiveLoadPct)) {
    console.warn('[MERGE SKIP] phone: cognitiveLoadPct is not a valid number');
    return false;
  }
  return true;
}

/**
 * Logs a structured warning for a skipped device payload (ENG-05).
 * Uses Cloud Logging with severity WARNING and structured JSON payload.
 */
async function logMergeError(
  uid: string,
  date: string,
  deviceId: string,
  error: Error
): Promise<void> {
  const metadata = {
    severity: 'WARNING' as const,
    labels: {
      userId: uid,
      date,
      deviceId,
      function: 'mergeAgentData',
    },
  };

  const entry = log.entry(metadata, {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });

  try {
    await log.write(entry);
  } catch (logErr) {
    // Fallback to console if Cloud Logging fails - don't block merge
    console.error(`[LOGGING FAIL] uid=${uid} date=${date} deviceId=${deviceId}:`, logErr);
    console.error(`[MERGE ERROR] uid=${uid} date=${date} deviceId=${deviceId}:`, error.message);
  }
}

export const mergeAgentData = onDocumentWritten(
  { document: 'users/{uid}/sessions/{date}', region: 'us-central1' },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const data = after.data() as SessionDocument;
    if (!data) return;

    // Preserve carryover values written by dailyReset.ts this morning.
    // These fields are NOT part of any agent payload — they exist only in
    // the Firestore document and must be passed through to derivations.
    const existingData = (event.data?.before?.data() as Partial<SessionDocument>) ?? {};
    data.carryover_debt_pts = data.carryover_debt_pts ?? existingData.carryover_debt_pts ?? 0;
    data.carryover_residue = data.carryover_residue ?? existingData.carryover_residue ?? 0;

    const phone = data.phoneMetrics as PhoneSyncPayload | undefined;
    const desktopSessions = data.desktopSessions as
      | Record<string, DesktopSyncPayload>
      | undefined;

    const uid = event.params.uid;
    const date = event.params.date;
    const db = getFirestore();
    const sessionRef = db.collection('users').doc(uid).collection('sessions').doc(date);
    const derivedRef = db.collection('users').doc(uid).collection('derived').doc(date);

    // ────────────────────────────────────────────────────────────────────────────
    // PASS 1 ─ Cross-device merge
    // Requires BOTH phone AND at least one desktop to have reported.
    // Skips if we already merged after both agents' last updates.
    // Uses a transaction with idempotency token to prevent race conditions.
    // ENG-05: Tolerant merge - validate each device independently, log errors, continue
    // ────────────────────────────────────────────────────────────────────────────

    const hasPhone = !!phone;
    const hasDesktop = !!desktopSessions && Object.keys(desktopSessions).length > 0;

    // ENG-05: Track errors for tolerant merge logging
    const errors: Array<{ deviceId: string; error: string }> = [];

    if (hasPhone && hasDesktop) {
      const desktops = Object.entries(desktopSessions!);
      const validDesktops: Array<[string, DesktopSyncPayload]> = [];

      // ENG-05: Validate phone payload independently
      let phoneValid = false;
      if (phone) {
        if (validatePhonePayload(phone)) {
          phoneValid = true;
        } else {
          const error = new Error('phone payload validation failed');
          errors.push({ deviceId: 'phone', error: error.message });
          await logMergeError(uid, date, 'phone', error);
        }
      }

      // ENG-05: Validate each desktop payload independently
      for (const [deviceId, desktop] of desktops) {
        if (validateDesktopPayload(desktop, deviceId)) {
          validDesktops.push([deviceId, desktop]);
        } else {
          const error = new Error(`desktop ${deviceId} payload validation failed`);
          errors.push({ deviceId, error: error.message });
          await logMergeError(uid, date, deviceId, error);
        }
      }

      // Skip merge if phone is invalid or no valid desktops
      if (!phoneValid || validDesktops.length === 0) {
        console.warn(
          `⚠️ Merge skipped for ${date} uid=${uid}: ` +
          `phoneValid=${phoneValid}, validDesktops=${validDesktops.length}, errors=${errors.length}`
        );
        // Still run derived pass with available data
        await runDerivedPass(db, uid, date, data, derivedRef, errors);
        return;
      }

      // Use a transaction for atomic read-compute-write with idempotency check
      await db.runTransaction(async (transaction: Transaction) => {
        const sessionDoc = await transaction.get(sessionRef);
        if (!sessionDoc.exists) return;

        const sessionData = sessionDoc.data() as SessionDocument;
        const currentLastMergeRun = sessionData.lastMergeRun;

        // Idempotency check: skip if lastMergeRun is newer than or equal to the
        // server timestamp of the write that triggered this function.
        // ENG-10: Use server timestamp (event.data.after.updateTime) for merge
        // ordering instead of unreliable device timestamps (phone.lastUpdated, etc.)
        const triggerUpdateTime = event.data?.after?.updateTime;
        if (currentLastMergeRun && triggerUpdateTime) {
          // Both are Firestore Timestamp objects - compare milliseconds
          const lastMergeMs = typeof currentLastMergeRun === 'object' && 'toMillis' in currentLastMergeRun
            ? (currentLastMergeRun as { toMillis(): number }).toMillis()
            : (currentLastMergeRun as { toDate(): Date }).toDate().getTime();
          const triggerMs = triggerUpdateTime.toMillis();
          if (lastMergeMs >= triggerMs) {
            // Already merged for this version of the document — skip Pass 1
            console.log(
              `⏭️ Merge skipped for ${date} uid=${uid}: ` +
              `lastMergeRun=${lastMergeMs} >= triggerUpdateTime=${triggerMs}`
            );
            return;
          }
        }

        // ─── Weighted Multi-Desktop Aggregation ─────────────────────────────────────
        // Weight each desktop by totalFocusedTime (productive + tools hours).
        // This ensures a work laptop (6h focused) contributes more than a personal
        // laptop (1h focused), while still preserving ALL switches and load data.
        const weighted = aggregateDesktopsByFocusedTime(validDesktops.map(([, d]) => d));

        // Fragmentation: phone vs. ALL desktops (weighted hourly load)
        const fragReport = computeDualDeviceFragmentation({
          phoneHourlyDebt: phone!.hourlyLoad,
          desktopHourlyDebt: weighted.hourlyLoad,
          phoneCategoryBreakdown: phone!.categoryBreakdown,
          desktopCategoryBreakdown: weighted.categoryBreakdown,
        });

        // Combined load: 55% phone + 45% weighted desktop aggregate
        const combinedLoad = Math.min(100, Math.round(
          phone!.cognitiveLoadPct * 0.55 + weighted.cognitiveLoadPct * 0.45
        ));

        // Combined switch counts tracked separately per ENG-06 (not summed into combined).
        const phoneTotalSwitches = phone!.totalSwitches;
        const desktopTotalSwitches = validDesktops.reduce(
          (s, [, d]) => s + d.totalSwitches, 0
        );

        // Combined velocity peak: max across phone + ALL desktops
        const combinedSwitchVelocityPeak = Math.max(
          phone!.switchVelocityPeak,
          ...validDesktops.map(([, d]) => d.switchVelocityPeak)
        );

        /// Combined hourly load: weighted sum with cap (ENG-07, ENG-08).
        /// Uses calculateWeightedOverlap from shared package — weighted sum capped at 100 per hour,
        /// phoneHighLoadOverlapHours from the result, and separate switch counts (ENG-06).
        // ENG-09: Normalize hourly loads to UTC buckets using each device's timezone
        // before combining. This ensures hour 0 on phone aligns with hour 0 on desktop
        // in UTC time, regardless of local timezone offsets.
        const phoneTz = phone!.timezone ?? 'UTC';
        const desktopTz = weighted.timezone ?? 'UTC';
        
        const phoneUtcHourlyLoad = normalizeToUtcBuckets(phone!.hourlyLoad, phoneTz);
        const desktopUtcHourlyLoad = normalizeToUtcBuckets(weighted.hourlyLoad, desktopTz);
        
        const weightedOverlap = calculateWeightedOverlap(
          phoneUtcHourlyLoad,
          desktopUtcHourlyLoad,
          /* phoneWeight */ 0.55,
          /* desktopWeight */ 0.45
        );
        const combinedHourlyLoad = weightedOverlap.combinedHourlyLoad;
        const phoneHighLoadOverlapHours = weightedOverlap.phoneHighLoadOverlapHours;

        // ENG-10: Write merged fields with server timestamp for idempotency ordering
        const mergeRunTime = FieldValue.serverTimestamp();
        transaction.update(sessionRef, {
          combinedLoad,
          dualFragmentation: fragReport.score,
          phoneHighLoadOverlapHours,
          combinedSwitchesTotal: phoneTotalSwitches + desktopTotalSwitches,
          combinedSwitchVelocityPeak,
          combinedHourlyLoad,
          lastMergeRun: mergeRunTime,
          // ENG-05: Record merge metadata for debugging
          devicesProcessed: validDesktops.length + 1, // +1 for phone
          devicesSkipped: errors.length,
          mergeErrors: errors.length > 0 ? errors : FieldValue.delete(),
        });

        // Refresh data snapshot with the merged fields before Pass 2
        data.combinedLoad = combinedLoad;
        data.dualFragmentation = fragReport.score;
        data.phoneHighLoadOverlapHours = phoneHighLoadOverlapHours;
        data.combinedSwitchesTotal = phoneTotalSwitches + desktopTotalSwitches;
        data.combinedSwitchVelocityPeak = combinedSwitchVelocityPeak;
        data.combinedHourlyLoad = combinedHourlyLoad;
        data.lastMergeRun = new Date().toISOString(); // approximate for local use

        console.log(
          `✅ Merged ${date} for uid=${uid}: ` +
          `combinedLoad=${combinedLoad}%, frag=${fragReport.score}, ` +
          `phoneHighLoadOverlapHours=${phoneHighLoadOverlapHours}, ` +
          `combinedSwitches=${phoneTotalSwitches + desktopTotalSwitches}, ` +
          `desktops=${validDesktops.length} (weighted)` +
          (errors.length > 0 ? `, skipped=${errors.length}` : '')
        );
      });

      // ENG-11: Invalidate derived cache after successful merge write
      await invalidateDerivedCache(uid);
    }

    // ────────────────────────────────────────────────────────────────────────────
    // PASS 2 ─ Derived metrics (runs after every write, phone-only or combined)
    // ────────────────────────────────────────────────────────────────────────────
    await runDerivedPass(db, uid, date, data, derivedRef, errors);
  }
);

// ────────────────────────────────────────────────────────────────────────────
// Helper: fetch context, compute DerivedDayMetrics, write to /derived/{date}
// Uses cache (ENG-11): getDerivedCache -> compute -> setDerivedCache
// ────────────────────────────────────────────────────────────────────────────
async function runDerivedPass(
  db: FirebaseFirestore.Firestore,
  uid: string,
  date: string,
  today: SessionDocument,
  derivedRef: FirebaseFirestore.DocumentReference,
  mergeErrors: Array<{ deviceId: string; error: string }> = []
): Promise<void> {
  // Try to get cached context first (ENG-11)
  const { getDerivedCache, setDerivedCache } = await import('./cache.js');
  const cached = await getDerivedCache(uid);

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
    .filter(s => s.date !== date) // exclude today
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

  // Check if cache is valid and can be used
  let cachedContext: CachedContext | undefined;
  if (cached && allSessions.length > 0 && isCacheValidForContext(
    {
      last7: cached.last7Sessions.map(s => ({
        date: s.date,
        phoneMetrics: s.phoneMetrics ? {
          hourlyLoad: s.phoneMetrics.hourlyLoad,
          cognitiveLoadPct: s.phoneMetrics.cognitiveLoadPct,
          // cognitiveDebt not stored in cache - leave undefined (optional in CachedSession)
          residueAtEOD: s.phoneMetrics.residueAtEOD,
          totalSwitches: s.phoneMetrics.totalSwitches,
          switchVelocityPeak: s.phoneMetrics.switchVelocityPeak,
          totalScreenTime: s.phoneMetrics.totalScreenTime,
          totalPickups: s.phoneMetrics.totalPickups,
          peakLoadHour: s.phoneMetrics.peakLoadHour,
          // Cast categoryBreakdown to match CachedSession expected type
          categoryBreakdown: s.phoneMetrics.categoryBreakdown as {
            productive: number;
            tools: number;
            social: number;
            entertainment: number;
            passiveWaste: number;
          },
          break_events: s.phoneMetrics.break_events,
        } : undefined,
        desktopSessions: s.desktopSessions ? Object.fromEntries(
          Object.entries(s.desktopSessions).map(([k, d]) => [k, {
            hourlyLoad: d.hourlyLoad,
            cognitiveLoadPct: d.cognitiveLoadPct,
            // cognitiveDebt not stored in cache - leave undefined (optional in CachedSession)
            categoryBreakdown: d.categoryBreakdown as {
              productive: number;
              tools: number;
              social: number;
              entertainment: number;
              passiveWaste: number;
            },
            break_events: d.break_events,
            totalSwitches: d.totalSwitches,
            switchVelocityPeak: d.switchVelocityPeak,
            residueAtEOD: d.residueAtEOD,
            totalFocusedTime: d.totalFocusedTime,
            peakLoadHour: d.peakLoadHour,
          }])
        ) : undefined,
        combinedLoad: s.combinedLoad,
        combinedHourlyLoad: s.combinedHourlyLoad,
        carryover_debt_pts: s.carryover_debt_pts,
        carryover_residue: s.carryover_residue,
      })),
      config: {
        // Cache only stores minimal config - provide full UserConfig with defaults
        cognitive_debt_critical_threshold: cached.config.cognitive_debt_critical_threshold,
        switch_baseline: cached.config.switch_baseline,
        switch_critical_threshold: cached.config.switch_critical_threshold,
        sleep_target_hours: cached.config.sleep_target_hours,
        wake_hour: cached.config.wake_hour,
        display_id: '',
        onboarding_complete: false,
        permissions_granted: [],
        created_at: new Date().toISOString(),
        last_calibrated_at: new Date().toISOString(),
      },
    },
    allSessions.map(s => ({ date: s.date }))
  )) {
    // Convert CachedDerived to CachedContext format for derivations
    cachedContext = {
      last7: cached.last7Sessions.map(s => ({
        date: s.date,
        phoneMetrics: s.phoneMetrics ? {
          hourlyLoad: s.phoneMetrics.hourlyLoad,
          cognitiveLoadPct: s.phoneMetrics.cognitiveLoadPct,
          // cognitiveDebt not stored in cache - leave undefined (optional in CachedSession)
          residueAtEOD: s.phoneMetrics.residueAtEOD,
          totalSwitches: s.phoneMetrics.totalSwitches,
          switchVelocityPeak: s.phoneMetrics.switchVelocityPeak,
          totalScreenTime: s.phoneMetrics.totalScreenTime,
          totalPickups: s.phoneMetrics.totalPickups,
          peakLoadHour: s.phoneMetrics.peakLoadHour,
          // Cast categoryBreakdown to match CachedSession expected type
          categoryBreakdown: s.phoneMetrics.categoryBreakdown as {
            productive: number;
            tools: number;
            social: number;
            entertainment: number;
            passiveWaste: number;
          },
          break_events: s.phoneMetrics.break_events,
        } : undefined,
        desktopSessions: s.desktopSessions ? Object.fromEntries(
          Object.entries(s.desktopSessions).map(([k, d]) => [k, {
            hourlyLoad: d.hourlyLoad,
            cognitiveLoadPct: d.cognitiveLoadPct,
            // cognitiveDebt not stored in cache - leave undefined (optional in CachedSession)
            categoryBreakdown: d.categoryBreakdown as {
              productive: number;
              tools: number;
              social: number;
              entertainment: number;
              passiveWaste: number;
            },
            break_events: d.break_events,
            totalSwitches: d.totalSwitches,
            switchVelocityPeak: d.switchVelocityPeak,
            residueAtEOD: d.residueAtEOD,
            totalFocusedTime: d.totalFocusedTime,
            peakLoadHour: d.peakLoadHour,
          }])
        ) : undefined,
        combinedLoad: s.combinedLoad,
        combinedHourlyLoad: s.combinedHourlyLoad,
        carryover_debt_pts: s.carryover_debt_pts,
        carryover_residue: s.carryover_residue,
      })),
      config: {
        // Cache only stores minimal config - provide full UserConfig with defaults
        cognitive_debt_critical_threshold: cached.config.cognitive_debt_critical_threshold,
        switch_baseline: cached.config.switch_baseline,
        switch_critical_threshold: cached.config.switch_critical_threshold,
        sleep_target_hours: cached.config.sleep_target_hours,
        wake_hour: cached.config.wake_hour,
        display_id: '',
        onboarding_complete: false,
        permissions_granted: [],
        created_at: new Date().toISOString(),
        last_calibrated_at: new Date().toISOString(),
      },
    };
    console.log(`📦 Using cached context for uid=${uid} (${cached.last7Sessions.length} sessions)`);
  }

  const derived = computeDerivedDayMetrics(today, allSessions, config, cachedContext);

  // Include merge errors in derived doc for debugging
  const derivedWithErrors = {
    ...derived,
    mergeErrors: mergeErrors.length > 0 ? mergeErrors : undefined,
  };

  await derivedRef.set(derivedWithErrors, { merge: true });

  // Update cache with fresh context for next run (ENG-11)
  if (allSessions.length > 0) {
    const cacheData: any = {
      userId: uid,
      version: 'derivations-v1.3.0', // Match COMPUTATION_VERSION in cache.ts
      cachedAt: new Date(), // Will be converted to server timestamp in setDerivedCache
      last7Sessions: allSessions.slice(0, 7).map(s => ({
        date: s.date,
        combinedLoad: s.combinedLoad,
        combinedHourlyLoad: s.combinedHourlyLoad,
        phoneMetrics: s.phoneMetrics ? {
          hourlyLoad: s.phoneMetrics.hourlyLoad,
          cognitiveLoadPct: s.phoneMetrics.cognitiveLoadPct,
          categoryBreakdown: s.phoneMetrics.categoryBreakdown,
          break_events: s.phoneMetrics.break_events,
          totalSwitches: s.phoneMetrics.totalSwitches,
          switchVelocityPeak: s.phoneMetrics.switchVelocityPeak,
          residueAtEOD: s.phoneMetrics.residueAtEOD,
          totalScreenTime: s.phoneMetrics.totalScreenTime,
          totalPickups: s.phoneMetrics.totalPickups,
          peakLoadHour: s.phoneMetrics.peakLoadHour,
        } : undefined,
        desktopSessions: s.desktopSessions ? Object.fromEntries(
          Object.entries(s.desktopSessions).map(([k, d]) => [k, {
            hourlyLoad: d.hourlyLoad,
            cognitiveLoadPct: d.cognitiveLoadPct,
            categoryBreakdown: d.categoryBreakdown,
            break_events: d.break_events,
            totalSwitches: d.totalSwitches,
            switchVelocityPeak: d.switchVelocityPeak,
            residueAtEOD: d.residueAtEOD,
            totalFocusedTime: d.totalFocusedTime,
            peakLoadHour: d.peakLoadHour,
          }])
        ) : undefined,
        carryover_debt_pts: s.carryover_debt_pts,
        carryover_residue: s.carryover_residue,
      })),
      config: {
        cognitive_debt_critical_threshold: config.cognitive_debt_critical_threshold,
        switch_baseline: config.switch_baseline,
        switch_critical_threshold: config.switch_critical_threshold,
        sleep_target_hours: config.sleep_target_hours,
        wake_hour: config.wake_hour,
      },
      oldestSessionDate: allSessions[allSessions.length - 1]?.date ?? date,
    };
    await setDerivedCache(uid, cacheData);
  }

  console.log(
    `✅ Derived metrics written for ${date} uid=${uid}: ` +
    `debtScore=${derived.cognitive_debt_score_pct}%, ` +
    `combinedSwitches=${derived.context_switches_count_today}, ` +
    `syncStatus=${derived.data_sync_status}` +
    (mergeErrors.length > 0 ? `, mergeErrors=${mergeErrors.length}` : '') +
    (cachedContext ? `, cacheHit=true` : `, cacheHit=false`)
  );
}

// ─── Weighted Multi-Desktop Aggregation Helper ────────────────────────────────────
// Aggregates all desktop payloads weighted by totalFocusedTime (productive + tools hours).
// Returns a single "virtual desktop" payload representing the user's total desktop activity.
interface AggregatedDesktop {
  cognitiveLoadPct: number;
  hourlyLoad: number[];
  timezone: string;
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
      timezone: 'UTC',
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

  // ENG-09: Use the primary desktop's timezone for UTC alignment
  const aggregatedTimezone = desktops[0]?.timezone ?? 'UTC';

  return { cognitiveLoadPct, hourlyLoad, timezone: aggregatedTimezone, categoryBreakdown };
}
import { calculateCognitiveDebt } from '@cognitrack/shared';
import type { AppEvent, DesktopSyncPayload, DesktopCategoryBreakdown } from '@cognitrack/shared';
import type { BrowserWindow } from 'electron';
import type { SQLiteStore } from './sqliteStore';
import type { SyncEngine } from '@cognitrack/sync-engine';
import type { ActiveWindowTracker } from './activeWindowTracker';
import { getTodayDateString } from './utils';
import { extractBreakEvents } from './breakExtractor';

/**
 * BatchProcessor
 *
 * Reads raw app_events from SQLite for a given date, runs the shared
 * cognitive engine over them, persists the 11-scalar summary back to
 * daily_metrics, and pushes it into the SyncEngine offline queue.
 *
 * After upserting metrics, pushes a live stats update to the renderer
 * via the `tray:statsUpdate` IPC channel so the popover refreshes.
 *
 * This is the ONLY place calculateCognitiveDebt() is called on desktop.
 * Called:
 *   - Every hour via setInterval in index.ts
 *   - On app quit (before-quit event) to capture the final partial hour
 */
export async function processBatch(
  store: SQLiteStore,
  syncEngine: SyncEngine,
  userId: string,
  deviceId: string,
  mainWindow?: BrowserWindow | null,
  // HIGH-7 FIX: tracker is required to read isRunning() for the live stats
  // push. Previously isTracking was hardcoded to `true`, which caused the
  // tray UI to revert to "tracking active" after every hourly batch even
  // when the user had paused tracking.
  tracker?: ActiveWindowTracker | null,
  date = getTodayDateString(),
): Promise<void> {
  const rawEvents: AppEvent[] = store.getEventsForDate(date);

  if (rawEvents.length === 0) {
    console.log(`[batch] No events for ${date}, skipping`);
    return;
  }

  // ── Run the shared cognitive state machine ─────────────────────────────────────
  const report = calculateCognitiveDebt(rawEvents);

  // ── Compute category breakdown (total durationMs per category) ────────────
  const durationByCategory: Record<string, number> = {};
  let totalFocusedMs = 0;

  for (const e of rawEvents) {
    if (e.eventType !== 'switch') continue;
    durationByCategory[e.category] = (durationByCategory[e.category] ?? 0) + e.durationMs;
    if (e.category === 'productive' || e.category === 'tools') {
      totalFocusedMs += e.durationMs;
    }
  }

  const totalDuration = Object.values(durationByCategory).reduce((a, b) => a + b, 0) || 1;

  // ROUNDING FIX: Use Math.floor for the first four categories, then let
  // passiveWaste absorb the remainder so the sum is always exactly 100.
  // Math.round() on all five can produce sums of 99 or 101 due to floating
  // point representation — this caused Firestore validation errors downstream.
  const _productive    = Math.floor(((durationByCategory['productive']    ?? 0) / totalDuration) * 100);
  const _tools         = Math.floor(((durationByCategory['tools']         ?? 0) / totalDuration) * 100);
  const _social        = Math.floor(((durationByCategory['social']        ?? 0) / totalDuration) * 100);
  const _entertainment = Math.floor(((durationByCategory['entertainment'] ?? 0) / totalDuration) * 100);
  const categoryBreakdown: DesktopCategoryBreakdown = {
    productive:    _productive,
    tools:         _tools,
    social:        _social,
    entertainment: _entertainment,
    passiveWaste:  100 - _productive - _tools - _social - _entertainment,
  };

  const switchEvents     = rawEvents.filter(e => e.eventType === 'switch');
  const totalSwitches    = switchEvents.length;
  const totalFocusedTime = totalFocusedMs / 3_600_000; // ms → hours

  // PEAK VELOCITY FIX: O(n) two-pointer 5-minute sliding window.
  // Previous implementation counted max switches per 1-hour bucket, which
  // masked sub-hour bursts. E.g. 30 switches in 5 min within a quiet hour
  // = 6/min peak — old algo would report 30/60 = 0.5/min (12× undercount).
  // New: two-pointer expiry — left pointer expires events outside window,
  // right pointer advances once. O(n) total, correct at any granularity.
  let switchVelocityPeak = 0;
  let left = 0;
  for (let right = 0; right < switchEvents.length; right++) {
    const windowStart = switchEvents[right]!.timestamp - 5 * 60_000;
    while ((switchEvents[left]?.timestamp ?? 0) < windowStart) left++;
    const rate = (right - left + 1) / 5; // switches per minute
    if (rate > switchVelocityPeak) switchVelocityPeak = rate;
  }

  // ── Persist computed metrics to SQLite daily_metrics table ────────────────
  store.upsertDailyMetrics({
    date,
    cognitiveDebt:       report.cognitiveDebt,
    cognitiveLoadPct:    report.cognitiveLoadPct,
    wmCapacityRemaining: report.wmCapacityRemaining,
    residueAtEOD:        report.residueAtEOD,
    totalSwitches,
    totalFocusedTime,
    switchVelocityPeak,
    peakLoadHour:        report.peakLoadHour,
    hourlyLoad:          JSON.stringify(report.hourlyDebt),
    categoryBreakdown:   JSON.stringify(categoryBreakdown),
  });

  // ── Push live stats update to the tray popover ────────────────────────────
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tray:statsUpdate', {
      // HIGH-7 FIX: was hardcoded `isTracking: true`. The tracker can be
      // paused by the user at any time; hardcoding true caused the pause
      // button to reappear after every hourly batch even when stopped.
      isTracking:          tracker?.isRunning() ?? false,
      cognitiveLoadPct:    report.cognitiveLoadPct,
      totalSwitches,
      wmCapacityRemaining: report.wmCapacityRemaining,
      syncStatus:          syncEngine.getQueueStatus(),
    });
  }

  // ── Extract break events from idle markers in today's event stream ────────
  const break_events = extractBreakEvents(rawEvents, report.hourlyDebt);

  // ── Build Firestore payload (11 scalars, zero raw data) ───────────────────
  const payload: DesktopSyncPayload = {
    deviceId,
    agentType:           'desktop',
    platform:            process.platform as 'win32' | 'darwin',
    cognitiveDebt:       report.cognitiveDebt,
    cognitiveLoadPct:    report.cognitiveLoadPct,
    wmCapacityRemaining: report.wmCapacityRemaining,
    residueAtEOD:        report.residueAtEOD,
    totalSwitches,
    totalFocusedTime,
    switchVelocityPeak,
    categoryBreakdown,
    peakLoadHour:        report.peakLoadHour,
    hourlyLoad:          report.hourlyDebt,
    break_events,
    lastUpdated:         new Date().toISOString(),
  };

  // ── Push into offline sync queue (fires Firestore write when online) ──────
  syncEngine.push(userId, date, deviceId, payload);
  await syncEngine.flush();

  console.log(
    `[batch] ${date}: load=${report.cognitiveLoadPct}% switches=${totalSwitches} ` +
    `wm=${report.wmCapacityRemaining}% pushed to sync queue`,
  );
}

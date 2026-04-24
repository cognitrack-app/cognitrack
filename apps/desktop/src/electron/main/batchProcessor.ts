import { calculateCognitiveDebt, resolveCategory } from '@cognitrack/shared';
import type { AppEvent, BreakEvent, DesktopSyncPayload, DesktopCategoryBreakdown } from '@cognitrack/shared';

const BREAK_MIN_DURATION_MS = 5 * 60 * 1000;   // 5 min minimum idle gap
const BREAK_EFFICIENCY_THRESHOLD = 60;           // debt must drop >= this % to be 'STRUCTURED'

/**
 * Scans sorted app events for idle gaps >= 5 minutes and constructs
 * BreakEvent records with debt_before / debt_after / efficiency_pct.
 *
 * Debt snapshots use the hourlyDebt array already produced by the
 * cognitive engine, so there is no re-derivation cost.
 */
function detectBreakEvents(
  events: AppEvent[],
  hourlyDebt: number[],
): BreakEvent[] {
  if (events.length === 0) return [];

  const breaks: BreakEvent[] = [];
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]!;
    const next    = sorted[i + 1]!;
    const gap     = next.timestamp - current.timestamp;

    if (gap < BREAK_MIN_DURATION_MS) continue;

    const startDate      = new Date(current.timestamp);
    const endDate        = new Date(next.timestamp);
    const durationMinutes = Math.round(gap / 60_000);

    const hourBefore  = Math.max(0, startDate.getHours() - 1);
    const hourAfter   = Math.min(23, endDate.getHours());
    const debtBefore  = hourlyDebt[hourBefore] ?? 0;
    const debtAfter   = hourlyDebt[hourAfter]  ?? 0;
    const ptsRecovered = Math.max(0, debtBefore - debtAfter);
    const efficiencyPct = debtBefore === 0
      ? 0
      : Math.round((ptsRecovered / debtBefore) * 100);

    const activityType: BreakEvent['activity_type'] =
      durationMinutes >= 120                         ? 'SLEEP'
      : efficiencyPct >= BREAK_EFFICIENCY_THRESHOLD  ? 'STRUCTURED'
      : 'UNSTRUCTURED';

    breaks.push({
      start_time:       startDate.toISOString(),
      end_time:         endDate.toISOString(),
      activity_type:    activityType,
      duration_minutes: durationMinutes,
      debt_before:      debtBefore,
      debt_after:       debtAfter,
      pts_recovered:    ptsRecovered,
      efficiency_pct:   efficiencyPct,
    });
  }

  return breaks;
}
import type { BrowserWindow } from 'electron';
import type { SQLiteStore } from './sqliteStore';
import type { SyncEngine } from '@cognitrack/sync-engine';
import { getTodayDateString } from './utils';

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
  date = getTodayDateString(),
): Promise<void> {
  const rawEvents: AppEvent[] = store.getEventsForDate(date);

  if (rawEvents.length === 0) {
    console.log(`[batch] No events for ${date}, skipping`);
    return;
  }

  // ── Run the shared cognitive state machine ─────────────────────────────
  const report = calculateCognitiveDebt(rawEvents);

  // ── Compute category breakdown (total durationMs per category) ────────
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
  const categoryBreakdown: DesktopCategoryBreakdown = {
    productive:    Math.round(((durationByCategory['productive'] ?? 0) / totalDuration) * 100),
    tools:         Math.round(((durationByCategory['tools']      ?? 0) / totalDuration) * 100),
    social:        Math.round(((durationByCategory['social']     ?? 0) / totalDuration) * 100),
    entertainment: Math.round(((durationByCategory['entertainment'] ?? 0) / totalDuration) * 100),
    passiveWaste:  Math.round(((durationByCategory['passiveWaste']  ?? 0) / totalDuration) * 100),
  };

  const switchEvents   = rawEvents.filter(e => e.eventType === 'switch');
  const totalSwitches  = switchEvents.length;
  const totalFocusedTime = totalFocusedMs / 3_600_000; // convert ms → hours

  // Peak switch velocity: max switches in any single hour
  const hourlySwitches = new Array(24).fill(0) as number[];
  for (const e of switchEvents) {
    const hour = new Date(e.timestamp).getHours();
    hourlySwitches[hour]++;
  }
  const switchVelocityPeak = Math.max(...hourlySwitches);

  // ── Persist computed metrics to SQLite daily_metrics table ────────────
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

  // ── Push live stats update to the tray popover ────────────────────────
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tray:statsUpdate', {
      isTracking:          true,
      cognitiveLoadPct:    report.cognitiveLoadPct,
      totalSwitches,
      wmCapacityRemaining: report.wmCapacityRemaining,
      syncStatus:          syncEngine.getQueueStatus(),
    });
  }

  // ── Detect break events from idle gaps in today's event stream ────────
  const break_events = detectBreakEvents(rawEvents, report.hourlyDebt);

  // ── Build Firestore payload ────────────────────────────────────────────
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

  // ── Push into offline sync queue (fires Firestore write when online) ──
  syncEngine.push(userId, date, deviceId, payload);
  await syncEngine.flush();

  console.log(
    `[batch] ${date}: load=${report.cognitiveLoadPct}% switches=${totalSwitches} ` +
    `wm=${report.wmCapacityRemaining} pushed to sync queue`
  );
}

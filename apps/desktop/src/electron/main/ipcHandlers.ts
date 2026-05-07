import { ipcMain } from 'electron';
import type { SQLiteStore } from './sqliteStore';
import type { ActiveWindowTracker } from './activeWindowTracker';
import type { SyncEngine } from '@cognitrack/sync-engine';
import { fetchSessionByDate } from '@cognitrack/api-client';
import { getTodayDateString } from './utils';

/**
 * Tray-only IPC handlers for the desktop agent.
 *
 * The desktop client is a silent data pipe — all dashboard UI lives on
 * mobile. These handlers power ONLY the tiny tray popover:
 *   tracker:status        – is tracking active?
 *   tracker:pause         – pause tracking
 *   tracker:resume        – resume tracking
 *   tray:getStats         – 3 scalars for the popover readout
 *   sessions:getRange     – daily_metrics rows for a date range
 *   sync:pullMobileData   – fetch today's phone metrics from Firestore
 */
export function registerIpcHandlers(
  store: SQLiteStore,
  tracker: ActiveWindowTracker,
  syncEngine: SyncEngine,
  refreshTray: () => void,
  // Getter instead of a captured value so we always read the post-auth UID
  // even though registerIpcHandlers() is called before sign-in completes.
  getUserId: () => string,
): void {

  // ── Tracker lifecycle ───────────────────────────────────────────────────────

  ipcMain.handle('tracker:status', () => ({
    isTracking: tracker.isRunning(),
  }));

  ipcMain.handle('tracker:pause', () => {
    tracker.stop();
    refreshTray(); // update tray context menu label immediately
    return { isTracking: false };
  });

  ipcMain.handle('tracker:resume', () => {
    tracker.start();
    refreshTray(); // update tray context menu label immediately
    return { isTracking: true };
  });

  // ── Tray popover stats ────────────────────────────────────────────────────────

  ipcMain.handle('tray:getStats', () => {
    const today   = getTodayDateString();
    const metrics = store.getDailyMetrics(today);
    return {
      isTracking:          tracker.isRunning(),
      cognitiveLoadPct:    metrics?.cognitiveLoadPct    ?? 0,
      totalSwitches:       metrics?.totalSwitches       ?? 0,
      wmCapacityRemaining: metrics?.wmCapacityRemaining ?? 100,
      syncStatus:          syncEngine.getQueueStatus(),
    };
  });

  ipcMain.handle('sessions:getRange', (_event, userId: string, from: string, to: string) => {
    return store.getSessionsInRange(userId, from, to);
  });

  // ── Mobile sync ────────────────────────────────────────────────────────────────────

  /**
   * Pull today's (or a given date's) phone metrics from Firestore.
   *
   * The mobile app writes into `users/{uid}/sessions/{date}.phoneMetrics`.
   * This handler fetches that document and returns the phoneMetrics field so
   * the tray popover can show a cross-device cognitive load snapshot.
   *
   * Returns null if:
   *   - The user hasn't opened the phone app today
   *   - The Firestore document doesn't exist yet
   *   - The network is unavailable (fetchSessionByDate throws → caller handles)
   */
  ipcMain.handle('sync:pullMobileData', async (_event, date?: string) => {
    const uid = getUserId();
    if (!uid) {
      console.warn('[sync:pullMobileData] Called before auth — returning null');
      return null;
    }
    const targetDate = date ?? getTodayDateString();
    try {
      const session = await fetchSessionByDate(uid, targetDate);
      return session?.phoneMetrics ?? null;
    } catch (err) {
      console.error('[sync:pullMobileData] Firestore fetch failed:', err);
      return null;
    }
  });
}

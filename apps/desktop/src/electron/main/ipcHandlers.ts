import { ipcMain } from 'electron';
import type { SQLiteStore } from './sqliteStore';
import type { ActiveWindowTracker } from './activeWindowTracker';
import type { SyncEngine } from '@cognitrack/sync-engine';
import { getTodayDateString } from './utils';

/**
 * Tray-only IPC handlers for the desktop agent.
 *
 * The desktop client is a silent data pipe — all dashboard UI lives on
 * mobile. These handlers power ONLY the tiny tray popover:
 *   tracker:status   – is tracking active?
 *   tracker:pause    – pause tracking
 *   tracker:resume   – resume tracking
 *   tray:getStats    – 3 scalars for the popover readout
 */
export function registerIpcHandlers(
  store: SQLiteStore,
  tracker: ActiveWindowTracker,
  syncEngine: SyncEngine,
): void {

  // ── Tracker lifecycle ──────────────────────────────────────────────────

  ipcMain.handle('tracker:status', () => ({
    isTracking: tracker.isRunning(),
  }));

  ipcMain.handle('tracker:pause', () => {
    tracker.stop();
    return { isTracking: false };
  });

  ipcMain.handle('tracker:resume', () => {
    tracker.start();
    return { isTracking: true };
  });

  // ── Tray popover stats ─────────────────────────────────────────────────

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

  // Restore the sessions:getRange handler fixing the new Date() type mismatch
  ipcMain.handle('sessions:getRange', (_, userId: string, from: string, to: string) => {
    return store.getSessionsInRange(userId, from, to);
  });
}
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
const utils_1 = require("./utils");
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
function registerIpcHandlers(store, tracker, syncEngine) {
    // ── Tracker lifecycle ──────────────────────────────────────────────────
    electron_1.ipcMain.handle('tracker:status', () => ({
        isTracking: tracker.isRunning(),
    }));
    electron_1.ipcMain.handle('tracker:pause', () => {
        tracker.stop();
        return { isTracking: false };
    });
    electron_1.ipcMain.handle('tracker:resume', () => {
        tracker.start();
        return { isTracking: true };
    });
    // ── Tray popover stats ─────────────────────────────────────────────────
    electron_1.ipcMain.handle('tray:getStats', () => {
        const today = (0, utils_1.getTodayDateString)();
        const metrics = store.getDailyMetrics(today);
        return {
            isTracking: tracker.isRunning(),
            cognitiveLoadPct: metrics?.cognitiveLoadPct ?? 0,
            totalSwitches: metrics?.totalSwitches ?? 0,
            wmCapacityRemaining: metrics?.wmCapacityRemaining ?? 100,
            syncStatus: syncEngine.getQueueStatus(),
        };
    });
    // Restore the sessions:getRange handler fixing the new Date() type mismatch
    electron_1.ipcMain.handle('sessions:getRange', (_, userId, from, to) => {
        return store.getSessionsInRange(userId, from, to);
    });
}
//# sourceMappingURL=ipcHandlers.js.map
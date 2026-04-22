"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processBatch = processBatch;
const shared_1 = require("@cognitrack/shared");
const utils_1 = require("./utils");
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
async function processBatch(store, syncEngine, userId, deviceId, mainWindow, date = (0, utils_1.getTodayDateString)()) {
    const rawEvents = store.getEventsForDate(date);
    if (rawEvents.length === 0) {
        console.log(`[batch] No events for ${date}, skipping`);
        return;
    }
    // ── Run the shared cognitive state machine ─────────────────────────────
    const report = (0, shared_1.calculateCognitiveDebt)(rawEvents);
    // ── Compute category breakdown (total durationMs per category) ────────
    const durationByCategory = {};
    let totalFocusedMs = 0;
    for (const e of rawEvents) {
        if (e.eventType !== 'switch')
            continue;
        durationByCategory[e.category] = (durationByCategory[e.category] ?? 0) + e.durationMs;
        if (e.category === 'productive' || e.category === 'tools') {
            totalFocusedMs += e.durationMs;
        }
    }
    const totalDuration = Object.values(durationByCategory).reduce((a, b) => a + b, 0) || 1;
    const categoryBreakdown = {
        productive: Math.round(((durationByCategory['productive'] ?? 0) / totalDuration) * 100),
        tools: Math.round(((durationByCategory['tools'] ?? 0) / totalDuration) * 100),
        social: Math.round(((durationByCategory['social'] ?? 0) / totalDuration) * 100),
        entertainment: Math.round(((durationByCategory['entertainment'] ?? 0) / totalDuration) * 100),
        passiveWaste: Math.round(((durationByCategory['passiveWaste'] ?? 0) / totalDuration) * 100),
    };
    const switchEvents = rawEvents.filter(e => e.eventType === 'switch');
    const totalSwitches = switchEvents.length;
    const totalFocusedTime = totalFocusedMs / 3_600_000; // convert ms → hours
    // Peak switch velocity: max switches in any single hour
    const hourlySwitches = new Array(24).fill(0);
    for (const e of switchEvents) {
        const hour = new Date(e.timestamp).getHours();
        hourlySwitches[hour]++;
    }
    const switchVelocityPeak = Math.max(...hourlySwitches);
    // ── Persist computed metrics to SQLite daily_metrics table ────────────
    store.upsertDailyMetrics({
        date,
        cognitiveDebt: report.cognitiveDebt,
        cognitiveLoadPct: report.cognitiveLoadPct,
        wmCapacityRemaining: report.wmCapacityRemaining,
        residueAtEOD: report.residueAtEOD,
        totalSwitches,
        totalFocusedTime,
        switchVelocityPeak,
        peakLoadHour: report.peakLoadHour,
        hourlyLoad: JSON.stringify(report.hourlyDebt),
        categoryBreakdown: JSON.stringify(categoryBreakdown),
    });
    // ── Push live stats update to the tray popover ────────────────────────
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tray:statsUpdate', {
            isTracking: true,
            cognitiveLoadPct: report.cognitiveLoadPct,
            totalSwitches,
            wmCapacityRemaining: report.wmCapacityRemaining,
            syncStatus: syncEngine.getQueueStatus(),
        });
    }
    // ── Build Firestore payload (11 scalars, zero raw data) ───────────────
    const payload = {
        deviceId,
        agentType: 'desktop',
        platform: process.platform,
        cognitiveDebt: report.cognitiveDebt,
        cognitiveLoadPct: report.cognitiveLoadPct,
        wmCapacityRemaining: report.wmCapacityRemaining,
        residueAtEOD: report.residueAtEOD,
        totalSwitches,
        totalFocusedTime,
        switchVelocityPeak,
        categoryBreakdown,
        peakLoadHour: report.peakLoadHour,
        hourlyLoad: report.hourlyDebt,
        lastUpdated: new Date().toISOString(),
    };
    // ── Push into offline sync queue (fires Firestore write when online) ──
    syncEngine.push(userId, date, deviceId, payload);
    await syncEngine.flush();
    console.log(`[batch] ${date}: load=${report.cognitiveLoadPct}% switches=${totalSwitches} ` +
        `wm=${report.wmCapacityRemaining} pushed to sync queue`);
}
//# sourceMappingURL=batchProcessor.js.map
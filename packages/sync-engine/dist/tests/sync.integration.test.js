"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const sync_1 = require("../sync");
const queue_1 = require("../queue");
// ─── Mock @cognitrack/api-client — no live Firebase connection needed ────────────
vitest_1.vi.mock('@cognitrack/api-client', () => ({
    writeDesktopSession: vitest_1.vi.fn(),
}));
const api_client_1 = require("@cognitrack/api-client");
const mockWrite = api_client_1.writeDesktopSession;
// ─── Shared test fixture ────────────────────────────────────────────────────────
const mockSession = {
    deviceId: 'device-test-001',
    agentType: 'desktop',
    platform: 'win32',
    cognitiveDebt: 120,
    cognitiveLoadPct: 45,
    wmCapacityRemaining: 78,
    residueAtEOD: 0.3,
    totalSwitches: 22,
    totalFocusedTime: 3.5,
    switchVelocityPeak: 1.8,
    categoryBreakdown: { productive: 60, tools: 25, social: 10, entertainment: 5, passiveWaste: 0 },
    peakLoadHour: 14,
    hourlyLoad: Array(24).fill(0).map((_, i) => (i >= 9 && i <= 17 ? 45 : 5)),
    lastUpdated: '2026-04-19T10:00:00.000Z',
};
const BASE = { type: 'desktopSession', status: 'pending', attempts: 0 };
const makeData = (deviceId = 'd1') => ({ userId: 'u1', date: '2026-04-19', deviceId, session: mockSession });
// ─── SyncQueue unit tests ────────────────────────────────────────────────────────
(0, vitest_1.describe)('SyncQueue', () => {
    (0, vitest_1.it)('enqueues an item with pending status', () => {
        const q = new queue_1.SyncQueue(':memory:');
        const id = q.addItem({ ...BASE, data: makeData() });
        (0, vitest_1.expect)(q.getPendingItems()).toHaveLength(1);
        (0, vitest_1.expect)(id).toBeTruthy();
        (0, vitest_1.expect)(q.getStatus().pending).toBe(1);
    });
    (0, vitest_1.it)('updateItemStatus synced → removes from pending', () => {
        const q = new queue_1.SyncQueue(':memory:');
        const id = q.addItem({ ...BASE, data: makeData() });
        q.updateItemStatus(id, 'synced');
        (0, vitest_1.expect)(q.getPendingItems()).toHaveLength(0);
        (0, vitest_1.expect)(q.getStatus().synced).toBe(1);
    });
    (0, vitest_1.it)('updateItemStatus failed → increments attempts', () => {
        const q = new queue_1.SyncQueue(':memory:');
        const id = q.addItem({ ...BASE, data: makeData() });
        q.updateItemStatus(id, 'failed', 'network error');
        (0, vitest_1.expect)(q.getStatus().failed).toBe(1);
        (0, vitest_1.expect)(q.getItem(id)?.attempts).toBe(1);
    });
    (0, vitest_1.it)('requeueFailed resets failed items under retry limit back to pending', () => {
        const q = new queue_1.SyncQueue(':memory:');
        const id = q.addItem({ ...BASE, data: makeData() });
        q.updateItemStatus(id, 'failed', 'err');
        q.requeueFailed();
        (0, vitest_1.expect)(q.getPendingItems()).toHaveLength(1);
        (0, vitest_1.expect)(q.getStatus().failed).toBe(0);
    });
    (0, vitest_1.it)('getStatus returns accurate aggregate counts', () => {
        const q = new queue_1.SyncQueue(':memory:');
        const id1 = q.addItem({ ...BASE, data: makeData('d1') });
        const id2 = q.addItem({ ...BASE, data: makeData('d2') });
        q.updateItemStatus(id2, 'synced');
        const s = q.getStatus();
        (0, vitest_1.expect)(s.pending).toBe(1);
        (0, vitest_1.expect)(s.synced).toBe(1);
        (0, vitest_1.expect)(s.total).toBe(2);
    });
});
// ─── SyncEngine integration tests ───────────────────────────────────────────────
(0, vitest_1.describe)('SyncEngine', () => {
    (0, vitest_1.beforeEach)(() => mockWrite.mockReset());
    (0, vitest_1.it)('push() enqueues while offline and does not call Firestore', () => {
        const engine = new sync_1.SyncEngine(':memory:');
        engine.setOnline(false);
        engine.push('u1', '2026-04-19', 'd1', mockSession);
        (0, vitest_1.expect)(engine.getQueueStatus().pending).toBe(1);
        (0, vitest_1.expect)(mockWrite).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('flush() syncs pending → synced and calls writeDesktopSession', async () => {
        mockWrite.mockResolvedValue(undefined);
        const engine = new sync_1.SyncEngine(':memory:');
        engine.push('u1', '2026-04-19', 'd1', mockSession);
        engine.setOnline(true);
        await engine.flush();
        const status = engine.getQueueStatus();
        (0, vitest_1.expect)(status.synced).toBe(1);
        (0, vitest_1.expect)(status.pending).toBe(0);
        (0, vitest_1.expect)(mockWrite).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mockWrite).toHaveBeenCalledWith('u1', '2026-04-19', 'd1', mockSession);
    });
    (0, vitest_1.it)('flush() marks item failed on network error and preserves message', async () => {
        mockWrite.mockRejectedValue(new Error('Network error'));
        const engine = new sync_1.SyncEngine(':memory:');
        engine.push('u1', '2026-04-19', 'd1', mockSession);
        engine.setOnline(true);
        await engine.flush();
        const status = engine.getQueueStatus();
        (0, vitest_1.expect)(status.failed).toBe(1);
        (0, vitest_1.expect)(status.synced).toBe(0);
    });
    (0, vitest_1.it)('flush() is a no-op when offline', async () => {
        const engine = new sync_1.SyncEngine(':memory:');
        engine.push('u1', '2026-04-19', 'd1', mockSession);
        engine.setOnline(false);
        await engine.flush();
        (0, vitest_1.expect)(engine.getQueueStatus().pending).toBe(1);
        (0, vitest_1.expect)(mockWrite).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('resolveConflict returns the payload with the newer lastUpdated', () => {
        const engine = new sync_1.SyncEngine(':memory:');
        const older = { ...mockSession, lastUpdated: '2026-04-19T08:00:00.000Z', cognitiveLoadPct: 30 };
        const newer = { ...mockSession, lastUpdated: '2026-04-19T12:00:00.000Z', cognitiveLoadPct: 70 };
        (0, vitest_1.expect)(engine.resolveConflict(older, newer).cognitiveLoadPct).toBe(70);
        (0, vitest_1.expect)(engine.resolveConflict(newer, older).cognitiveLoadPct).toBe(70);
    });
    (0, vitest_1.it)('flush() syncs multiple items and reports all as synced', async () => {
        mockWrite.mockResolvedValue(undefined);
        const engine = new sync_1.SyncEngine(':memory:');
        engine.push('u1', '2026-04-19', 'd1', mockSession);
        engine.push('u1', '2026-04-19', 'd2', mockSession);
        engine.push('u1', '2026-04-19', 'd3', mockSession);
        engine.setOnline(true);
        await engine.flush();
        const status = engine.getQueueStatus();
        (0, vitest_1.expect)(status.synced).toBe(3);
        (0, vitest_1.expect)(status.pending).toBe(0);
        (0, vitest_1.expect)(mockWrite).toHaveBeenCalledTimes(3);
    });
});

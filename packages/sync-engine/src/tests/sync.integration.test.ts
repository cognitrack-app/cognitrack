import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../sync';
import { SyncQueue } from '../queue';
import type { DesktopSyncPayload } from '@cognitrack/shared';

// ─── Mock @cognitrack/api-client — no live Firebase connection needed ────────────
vi.mock('@cognitrack/api-client', () => ({
  writeDesktopSession: vi.fn(),
}));

import { writeDesktopSession } from '@cognitrack/api-client';
const mockWrite = writeDesktopSession as ReturnType<typeof vi.fn>;

// ─── Shared test fixture ────────────────────────────────────────────────────────
const mockSession: DesktopSyncPayload = {
  deviceId:            'device-test-001',
  agentType:           'desktop',
  platform:            'win32',
  cognitiveDebt:       120,
  cognitiveLoadPct:    45,
  wmCapacityRemaining: 78,
  residueAtEOD:        0.3,
  totalSwitches:       22,
  totalFocusedTime:    3.5,
  switchVelocityPeak:  1.8,
  categoryBreakdown:   { productive: 60, tools: 25, social: 10, entertainment: 5, passiveWaste: 0 },
  peakLoadHour:        14,
  hourlyLoad:          Array(24).fill(0).map((_, i) => (i >= 9 && i <= 17 ? 45 : 5)),
  lastUpdated:         '2026-04-19T10:00:00.000Z',
};

const BASE = { type: 'desktopSession' as const, status: 'pending' as const, attempts: 0 };
const makeData = (deviceId = 'd1') => ({ userId: 'u1', date: '2026-04-19', deviceId, session: mockSession });

// ─── SyncQueue unit tests ────────────────────────────────────────────────────────
describe('SyncQueue', () => {
  it('enqueues an item with pending status', () => {
    const q  = new SyncQueue(':memory:');
    const id = q.addItem({ ...BASE,  data: makeData() });
    expect(q.getPendingItems()).toHaveLength(1);
    expect(id).toBeTruthy();
    expect(q.getStatus().pending).toBe(1);
  });

  it('updateItemStatus synced → removes from pending', () => {
    const q  = new SyncQueue(':memory:');
    const id = q.addItem({ ...BASE,  data: makeData() });
    q.updateItemStatus(id, 'synced');
    expect(q.getPendingItems()).toHaveLength(0);
    expect(q.getStatus().synced).toBe(1);
  });

  it('updateItemStatus failed → increments attempts', () => {
    const q  = new SyncQueue(':memory:');
    const id = q.addItem({ ...BASE,  data: makeData() });
    q.updateItemStatus(id, 'failed', 'network error');
    expect(q.getStatus().failed).toBe(1);
    expect(q.getItem(id)?.attempts).toBe(1);
  });

  it('requeueFailed resets failed items under retry limit back to pending', () => {
    const q  = new SyncQueue(':memory:');
    const id = q.addItem({ ...BASE,  data: makeData() });
    q.updateItemStatus(id, 'failed', 'err');
    q.requeueFailed();
    expect(q.getPendingItems()).toHaveLength(1);
    expect(q.getStatus().failed).toBe(0);
  });

  it('getStatus returns accurate aggregate counts', () => {
    const q   = new SyncQueue(':memory:');
    const id1 = q.addItem({ ...BASE,  data: makeData('d1') });
    const id2 = q.addItem({ ...BASE,  data: makeData('d2') });
    q.updateItemStatus(id2, 'synced');
    const s = q.getStatus();
    expect(s.pending).toBe(1);
    expect(s.synced).toBe(1);
    expect(s.total).toBe(2);
  });
});

// ─── SyncEngine integration tests ───────────────────────────────────────────────
describe('SyncEngine', () => {
  beforeEach(() => mockWrite.mockReset());

  it('push() enqueues while offline and does not call Firestore', () => {
    const engine = new SyncEngine(':memory:');
    engine.setOnline(false);
    engine.push('u1', '2026-04-19', 'd1', mockSession);
    expect(engine.getQueueStatus().pending).toBe(1);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('flush() syncs pending → synced and calls writeDesktopSession', async () => {
    mockWrite.mockResolvedValue(undefined);
    const engine = new SyncEngine(':memory:');
    engine.push('u1', '2026-04-19', 'd1', mockSession);
    engine.setOnline(true);
    await engine.flush();
    const status = engine.getQueueStatus();
    expect(status.synced).toBe(1);
    expect(status.pending).toBe(0);
    expect(mockWrite).toHaveBeenCalledOnce();
    expect(mockWrite).toHaveBeenCalledWith('u1', '2026-04-19', 'd1', mockSession);
  });

  it('flush() marks item failed on network error and preserves message', async () => {
    mockWrite.mockRejectedValue(new Error('Network error'));
    const engine = new SyncEngine(':memory:');
    engine.push('u1', '2026-04-19', 'd1', mockSession);
    engine.setOnline(true);
    await engine.flush();
    const status = engine.getQueueStatus();
    expect(status.failed).toBe(1);
    expect(status.synced).toBe(0);
  });

  it('flush() is a no-op when offline', async () => {
    const engine = new SyncEngine(':memory:');
    engine.push('u1', '2026-04-19', 'd1', mockSession);
    engine.setOnline(false);
    await engine.flush();
    expect(engine.getQueueStatus().pending).toBe(1);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('resolveConflict returns the payload with the newer lastUpdated', () => {
    const engine = new SyncEngine(':memory:');
    const older  = { ...mockSession, lastUpdated: '2026-04-19T08:00:00.000Z', cognitiveLoadPct: 30 };
    const newer  = { ...mockSession, lastUpdated: '2026-04-19T12:00:00.000Z', cognitiveLoadPct: 70 };
    expect(engine.resolveConflict(older, newer).cognitiveLoadPct).toBe(70);
    expect(engine.resolveConflict(newer, older).cognitiveLoadPct).toBe(70);
  });

  it('flush() syncs multiple items and reports all as synced', async () => {
    mockWrite.mockResolvedValue(undefined);
    const engine = new SyncEngine(':memory:');
    engine.push('u1', '2026-04-19', 'd1', mockSession);
    engine.push('u1', '2026-04-19', 'd2', mockSession);
    engine.push('u1', '2026-04-19', 'd3', mockSession);
    engine.setOnline(true);
    await engine.flush();
    const status = engine.getQueueStatus();
    expect(status.synced).toBe(3);
    expect(status.pending).toBe(0);
    expect(mockWrite).toHaveBeenCalledTimes(3);
  });
});

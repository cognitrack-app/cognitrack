import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SyncEngine } from '../sync';
import type { DesktopSyncPayload } from '@cognitrack/shared';

// ─── Mock @cognitrack/api-client ───────────────────────────────────────────────
vi.mock('@cognitrack/api-client', () => ({
  writeDesktopSession: vi.fn(),
  readDesktopSession: vi.fn().mockResolvedValue(null),
}));

import { writeDesktopSession } from '@cognitrack/api-client';
const mockWrite = writeDesktopSession as ReturnType<typeof vi.fn>;
const mockRead = vi.fn().mockResolvedValue(null);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  return new Database(':memory:');
}

function setupQueue(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS sync_queue (user_id TEXT NOT NULL, date TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', retry_count INTEGER NOT NULL DEFAULT 0, next_retry_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, date))`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_queue_status_next_retry ON sync_queue(status, next_retry_at)`);
}

// ─── Shared test fixture ────────────────────────────────────────────────────────
const mockSession: DesktopSyncPayload = {
  deviceId:            'device-test-001',
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
  break_events:        [],
  lastUpdated:         '2026-04-19T10:00:00.000Z',
  schemaVersion:       2,
  date: '2026-04-19',
  timezone: 'UTC',
  hourlySwitches: Array(24).fill(0),
  totalTimeMs: 0,
};

const makePayload = (deviceId = 'd1') => ({
  userId: 'u1',
  date: '2026-04-19',
  deviceId,
  session: mockSession,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function qStats(db: Database.Database): { pending: number; syncing: number; synced: number; failed: number } {
  const stmt = db.prepare('SELECT status, COUNT(*) as count FROM sync_queue GROUP BY status');
  const rows = stmt.all() as { status: string; count: number }[];
  const stats = { pending: 0, syncing: 0, synced: 0, failed: 0 };
  for (const row of rows) {
    stats[row.status as keyof typeof stats] = row.count;
  }
  return stats;
}

// ─── SyncEngine integration tests ───────────────────────────────────────────────
describe('SyncEngine', () => {
  let db: Database.Database;
  let writeSessionFn: (userId: string, date: string, deviceId: string, session: any) => Promise<void>;

  beforeEach(() => {
    mockWrite.mockReset();
    mockRead.mockReset();
    mockRead.mockResolvedValue(null);

    db = makeDb();
    setupQueue(db);
    writeSessionFn = async (userId, date, deviceId, session) => {
      await mockWrite(userId, date, deviceId, session);
    };
  });

  it('push() enqueues while offline and does not call Firestore', async () => {
    const engine = new SyncEngine({
      db,
      writeSessionFn,
      getOnlineStatus: () => false,
      onOnlineChange: () => () => {},
    });
    engine.setOnline(false);
    engine.push('u1', '2026-04-19', 'd1', mockSession);

    const stats = qStats(db);
    expect(stats.pending).toBe(1);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('flush() syncs pending → synced and calls writeDesktopSession', async () => {
    mockWrite.mockResolvedValue(undefined);
    const engine = new SyncEngine({
      db,
      writeSessionFn,
      getOnlineStatus: () => true,
      onOnlineChange: () => () => {},
    });
    engine.push('u1', '2026-04-19', 'd1', mockSession);
    await engine.flush();

    const stats = qStats(db);
    expect(stats.synced).toBe(1);
    expect(stats.pending).toBe(0);
    expect(mockWrite).toHaveBeenCalledOnce();
    expect(mockWrite).toHaveBeenCalledWith('u1', '2026-04-19', 'd1', mockSession);
  });

  it('flush() marks item failed on network error and preserves message', async () => {
    const originalHandlers = process.listeners('unhandledRejection');
    process.removeAllListeners('unhandledRejection');

    mockWrite.mockImplementation(() => Promise.reject(new Error('Network error')));
    const engine = new SyncEngine({
      db,
      writeSessionFn,
      getOnlineStatus: () => true,
      onOnlineChange: () => () => {},
    });
    engine.push('u1', '2026-04-19', 'd1', mockSession);
    await engine.flush();

    for (const h of originalHandlers) process.on('unhandledRejection', h);

    const stats = qStats(db);
    // After 1 failure, row stays pending with backoff (maxRetries=20 before 'failed')
    expect(stats.pending).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.synced).toBe(0);
  });

  it('flush() is a no-op when offline', async () => {
    const engine = new SyncEngine({
      db,
      writeSessionFn,
      getOnlineStatus: () => false,
      onOnlineChange: () => () => {},
    });
    engine.push('u1', '2026-04-19', 'd1', mockSession);
    await engine.flush();

    const stats = qStats(db);
    expect(stats.pending).toBe(1);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('resolveConflict calls writeSessionFn', () => {
    const engine = new SyncEngine({
      db,
      writeSessionFn,
      getOnlineStatus: () => true,
      onOnlineChange: () => () => {},
    });
    engine.resolveConflict('u1', '2026-04-19', 'd1', mockSession);
    expect(mockWrite).toHaveBeenCalledWith('u1', '2026-04-19', 'd1', mockSession);
  });

  it('flush() syncs multiple items and reports all as synced', async () => {
    mockWrite.mockResolvedValue(undefined);
    const engine = new SyncEngine({
      db,
      writeSessionFn,
      getOnlineStatus: () => true,
      onOnlineChange: () => () => {},
    });
    // With deduplication (one row per user+date), use different dates for distinct items
    engine.push('u1', '2026-04-19', 'd1', mockSession);
    engine.push('u1', '2026-04-20', 'd2', mockSession);
    engine.push('u1', '2026-04-21', 'd3', mockSession);
    await engine.flush();

    const stats = qStats(db);
    expect(stats.synced).toBe(3);
    expect(stats.pending).toBe(0);
    expect(mockWrite).toHaveBeenCalledTimes(3);
  });
});

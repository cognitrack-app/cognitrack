import { writeDesktopSession } from '@cognitrack/api-client';
import type { DesktopSyncPayload, PhoneSyncPayload } from '@cognitrack/shared';
import { DeduplicatedQueue, type SyncPayload, calculateBackoff, type QueueRow } from './queue';

const MAX_FLUSH_DURATION_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 3_600_000;
const DEBOUNCE_MS = 10_000;
const MAX_WAIT_MS = 30_000;

interface DebouncedSyncOptions {
  debounceMs: number;
  maxWaitMs: number;
  flushFn: () => Promise<void>;
}

class DebouncedSync {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly flushFn: () => Promise<void>;
  private lastFlush = 0;

  constructor(options: DebouncedSyncOptions) {
    this.debounceMs = options.debounceMs;
    this.maxWaitMs = options.maxWaitMs;
    this.flushFn = options.flushFn;
  }

  trigger(): void {
    const now = Date.now();
    if (now - this.lastFlush >= this.maxWaitMs) {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      this.flush(); return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private async flush(): Promise<void> {
    this.timer = null; this.lastFlush = Date.now();
    try { await this.flushFn(); } catch (err) { console.error('[DebouncedSync] Flush failed:', err); }
  }

  cancel(): void { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  async forceFlush(): Promise<void> { if (this.timer) { clearTimeout(this.timer); this.timer = null; } await this.flush(); }
}

export interface SyncEngineOptions {
  db: any;
  writeSessionFn: (userId: string, date: string, deviceId: string, session: any) => Promise<void>;
  getOnlineStatus?: () => boolean;
  onOnlineChange?: (cb: (online: boolean) => void) => () => void;
  debounceMs?: number; maxWaitMs?: number;
  baseBackoffMs?: number; maxBackoffMs?: number; maxRetries?: number;
  maxFlushDurationMs?: number; pruneSyncedAfterDays?: number;
}

export class SyncEngine {
  private db: any;
  private writeSessionFn: (userId: string, date: string, deviceId: string, session: any) => Promise<void>;
  private getOnlineStatus: () => boolean;
  private onOnlineChange: (cb: (online: boolean) => void) => () => void;
  private debouncedSync: DebouncedSync;
  private isSyncing = false;
  private isOnline = false;
  private lastFlush = 0;

  private opts: { debounceMs: number; maxWaitMs: number; baseBackoffMs: number; maxBackoffMs: number; maxRetries: number; maxFlushDurationMs: number; pruneSyncedAfterDays: number };

  constructor(options: SyncEngineOptions) {
    this.db = options.db;
    this.writeSessionFn = options.writeSessionFn;
    this.getOnlineStatus = options.getOnlineStatus ?? (() => true);
    this.onOnlineChange = options.onOnlineChange ?? (() => () => {});
    this.opts = {
      debounceMs: options.debounceMs ?? 10_000, maxWaitMs: options.maxWaitMs ?? 30_000,
      baseBackoffMs: options.baseBackoffMs ?? 1_000, maxBackoffMs: options.maxBackoffMs ?? 3_600_000,
      maxRetries: options.maxRetries ?? 20, maxFlushDurationMs: options.maxFlushDurationMs ?? 30_000,
      pruneSyncedAfterDays: options.pruneSyncedAfterDays ?? 7,
    };
    this.initQueue();
    this.debouncedSync = new DebouncedSync({
      debounceMs: this.opts.debounceMs,
      maxWaitMs: this.opts.maxWaitMs,
      flushFn: () => this.flush()
    });
    this.onOnlineChange = options.onOnlineChange ?? (() => () => {});
    this.onOnlineChange((o) => { this.isOnline = o; if (o) this.triggerSync(); });
    this.initQueue();
  }

  private initQueue(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS sync_queue (user_id TEXT NOT NULL, date TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', retry_count INTEGER NOT NULL DEFAULT 0, next_retry_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, date))`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_queue_status_next_retry ON sync_queue(status, next_retry_at)`);
  }

  upsertRecord(userId: string, date: string, payload: any): void {
    const now = Date.now(), p = JSON.stringify(payload);
    this.db.prepare(`INSERT INTO sync_queue (user_id, date, payload_json, status, retry_count, next_retry_at, created_at, updated_at) VALUES (?, ?, ?, CASE WHEN (SELECT status FROM sync_queue WHERE user_id=? AND date=?)= 'synced' THEN 'pending' ELSE COALESCE((SELECT status FROM sync_queue WHERE user_id=? AND date=?), 'pending') END, COALESCE((SELECT retry_count FROM sync_queue WHERE user_id=? AND date=?),0), COALESCE((SELECT next_retry_at FROM sync_queue WHERE user_id=? AND date=?), NULL), ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET payload_json=excluded.payload_json, status=CASE WHEN sync_queue.status='synced' THEN 'pending' ELSE sync_queue.status END, updated_at=excluded.updated_at`).run(userId, date, JSON.stringify(payload), userId, date, userId, date, userId, date, Date.now(), Date.now());
  }

  getReadyPendingRows() { return this.db.prepare(`SELECT * FROM sync_queue WHERE status='pending' AND (next_retry_at IS NULL OR next_retry_at<=?) ORDER BY created_at ASC`).all(Date.now()); }
  getFailedRows() { return this.db.prepare(`SELECT * FROM sync_queue WHERE status='failed' ORDER BY updated_at ASC`).all(); }
  getStuckSyncingRows() { return this.db.prepare(`SELECT * FROM sync_queue WHERE status='syncing' ORDER BY updated_at ASC`).all(); }
  markSyncingRow(uid: string, d: string) { this.db.prepare(`UPDATE sync_queue SET status='syncing', updated_at=? WHERE user_id=? AND date=?`).run(Date.now(), uid, d); }
  markSyncedRow(uid: string, d: string) { this.db.prepare(`UPDATE sync_queue SET status='synced', next_retry_at=NULL, updated_at=? WHERE user_id=? AND date=?`).run(Date.now(), uid, d); }
  getRow(uid: string, d: string) { return this.db.prepare(`SELECT * FROM sync_queue WHERE user_id=? AND date=?`).get(uid, d); }
  pruneOldSyncedRows() { return this.db.prepare(`DELETE FROM sync_queue WHERE status='synced' AND updated_at<?`).run(Date.now() - 7*24*60*60*1000).changes; }

  pushRecord(uid: string, date: string, deviceId: string, session: any): void {
    const now = Date.now();
    const payloadJson = JSON.stringify({ userId: uid, date, deviceId, session });
    this.db.prepare(
      `INSERT INTO sync_queue (user_id, date, payload_json, status, retry_count, next_retry_at, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, NULL, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET
         payload_json = excluded.payload_json,
         status = CASE WHEN sync_queue.status = 'synced' THEN 'pending' ELSE sync_queue.status END,
         updated_at = excluded.updated_at`
    ).run(uid, date, payloadJson, now, now);
  }

  triggerSync() { if (!this.isOnline) return; this.debouncedSync.trigger(); }
  setOnline(o: boolean) { this.isOnline = o; if (o) { this.requeueStuckSyncingRows(); this.resetFailedRows(); this.triggerSync(); } }

  async flushQueue(): Promise<void> {
    if (!this.getOnlineStatus() || this.isSyncing) return;
    this.isSyncing = true; const fs = Date.now();
    try { let p = this.getReadyPendingRows(); while (p.length) { if (Date.now() - fs > 30_000) { console.warn('[SyncEngine] Flush timeout'); break; } for (const it of p) { this.markSyncingRow(it.user_id, it.date); try { const p2 = JSON.parse(it.payload_json); await this.writeSessionFn(p2.userId, p2.date, p2.deviceId, p2.session); this.markSyncedRow(it.user_id, it.date); } catch (e) { this.incRetryRow(it.user_id, it.date, e instanceof Error ? e.message : String(e)); } } p = this.getReadyPendingRows(); } } finally { this.isSyncing = false; this.pruneOldSyncedRows(); }
  }

  updateStatusRow(u: string, d: string, s: string, e?: string, n?: number) { this.db.prepare(`UPDATE sync_queue SET status=?, updated_at=?, attempts=attempts+${s==='failed'?1:0}, error=?, next_retry_at=? WHERE user_id=? AND date=?`).run(s, Date.now(), e??null, n??null, u, d); }
  markSyncedRow2(u: string, d: string) { this.db.prepare(`UPDATE sync_queue SET status='synced', next_retry_at=NULL, updated_at=? WHERE user_id=? AND date=?`).run(Date.now(), u, d); }
  incRetryRow(u: string, d: string, e?: string) { const r = this.getRow(u, d); if (!r) return; const nc = r.retry_count + 1; const bm = Math.min(1000 * 2 ** r.retry_count, 3_600_000); if (r.retry_count + 1 >= 20) { this.db.prepare(`UPDATE sync_queue SET retry_count=?, next_retry_at=NULL, status='failed', updated_at=? WHERE user_id=? AND date=?`).run(r.retry_count+1, Date.now(), u, d); } else { this.db.prepare(`UPDATE sync_queue SET retry_count=?, next_retry_at=?, status='pending', updated_at=? WHERE user_id=? AND date=?`).run(r.retry_count+1, Date.now()+Math.min(1000*2**r.retry_count, 3_600_000), Date.now(), u, d); } }
  resetFailedRows() { return this.db.prepare(`UPDATE sync_queue SET status='pending', next_retry_at=NULL, updated_at=? WHERE status='failed'`).run(Date.now()).changes; }
  requeueStuckSyncingRows() { const r = this.db.prepare(`UPDATE sync_queue SET status='pending', updated_at=? WHERE status='syncing'`).run(Date.now()); if (r.changes) console.log(`[SyncEngine] Recovered ${r.changes} stuck`); return r.changes; }
  getRow2(uid: string, d: string) { return this.db.prepare(`SELECT * FROM sync_queue WHERE user_id=? AND date=?`).get(uid, d); }
  getReadyPendingRows2() { return this.db.prepare(`SELECT * FROM sync_queue WHERE status='pending' AND (next_retry_at IS NULL OR next_retry_at<=?) ORDER BY created_at ASC`).all(Date.now()); }

  // Public API
  flush(): Promise<void> { return this.flushQueue(); }
  push(uid: string, date: string, deviceId: string, session: any): void { this.pushRecord(uid, date, deviceId, session); }
  getQueueStatus() { return { status: 'pending', pending: 0, synced: 0, failed: 0, isSyncing: this.isSyncing, isOnline: this.isOnline }; }
  resolveConflict(userId: string, date: string, deviceId: string, session: any): Promise<void> { return this.writeSessionFn(userId, date, deviceId, session); }
  getPendingCount(): number { return this.getFailedRows().length; }
  getSyncedCount(): number { return this.getStuckSyncingRows().length; }
}

import Database from 'better-sqlite3';
import type { DesktopSyncPayload, PhoneSyncPayload } from '@cognitrack/shared';

export type QueueStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface SyncPayload {
  userId: string;
  date: string;           // YYYY-MM-DD
  deviceId: string;
  session: PhoneSyncPayload | DesktopSyncPayload;
}

export interface QueueRow {
  user_id:         string;
  date:            string;      // YYYY-MM-DD
  payload_json:    string;
  status:          string;
  retry_count:     number;
  next_retry_at:   string | null;  // Unix ms, null = no retry scheduled
  created_at:      string;      // Unix ms
  updated_at:      string;      // Unix ms
}

export interface DeduplicatedQueueOptions {
  baseBackoffMs?: number;       // Default: 1000 (1s)
  maxBackoffMs?: number;        // Default: 3_600_000 (1hr)
  maxRetries?: number;          // Default: 20 (~24h total)
  pruneSyncedAfterDays?: number; // Default: 7
}

// Default constants (ENG-03, ENG-04)
const DEFAULT_BASE_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 3_600_000; // 1 hour
const DEFAULT_MAX_RETRIES = 20;            // ~24 hours total with exponential backoff
const DEFAULT_PRUNE_SYNCED_AFTER_DAYS = 7;

/**
 * SQLite-based deduplicated queue for sync operations.
 * Maintains one row per user per date (upsert on composite key).
 * Implements exponential backoff retry logic.
 */
export class DeduplicatedQueue {
  private db: Database.Database;
  private options: Required<DeduplicatedQueueOptions>;

  constructor(db: Database.Database, options: DeduplicatedQueueOptions = {}) {
    this.db = db;
    this.options = {
      baseBackoffMs: options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS,
      maxBackoffMs: options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      pruneSyncedAfterDays: options.pruneSyncedAfterDays ?? DEFAULT_PRUNE_SYNCED_AFTER_DAYS,
    };
  }

  /**
   * Initialize the queue table with proper schema.
   * Composite primary key on (user_id, date) enables upsert.
   */
  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        user_id       TEXT NOT NULL,
        date          TEXT NOT NULL,           -- YYYY-MM-DD
        payload_json  TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        retry_count   INTEGER NOT NULL DEFAULT 0,
        next_retry_at INTEGER,                 -- Unix ms, null = no retry scheduled
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        PRIMARY KEY (user_id, date)
      )
    `);

    // Index for efficient querying of pending items
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sync_queue_status_next_retry
      ON sync_queue(status, next_retry_at)
    `);
  }

  /**
   * Upsert a queue row for the given user and date.
   * If row exists and was synced, resets to pending for re-sync.
   * If row exists and failed, preserves retry_count and updates payload.
   * ENG-12: One row per user per day, overwrites payload on each event.
   */
  upsert(userId: string, date: string, payload: SyncPayload): void {
    const now = Date.now();
    const payloadJson = JSON.stringify(payload);

    // Use INSERT OR REPLACE with composite primary key
    // Status logic: if previously 'synced', reset to 'pending' for re-sync
    // If 'failed', keep failed status and retry_count (will be re-queued by requeueFailed)
    const stmt = this.db.prepare(`
      INSERT INTO sync_queue (user_id, date, payload_json, status, retry_count, next_retry_at, created_at, updated_at)
      VALUES (?, ?, ?, 
        CASE 
          WHEN (SELECT status FROM sync_queue WHERE user_id = ? AND date = ?) = 'synced' THEN 'pending'
          ELSE COALESCE((SELECT status FROM sync_queue WHERE user_id = ? AND date = ?), 'pending')
        END,
        COALESCE((SELECT retry_count FROM sync_queue WHERE user_id = ? AND date = ?), 0),
        COALESCE((SELECT next_retry_at FROM sync_queue WHERE user_id = ? AND date = ?), NULL),
        ?,
        ?
      )
      ON CONFLICT(user_id, date) DO UPDATE SET
        payload_json = excluded.payload_json,
        status = CASE
          WHEN sync_queue.status = 'synced' THEN 'pending'
          ELSE sync_queue.status
        END,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      userId, date, payloadJson,
      userId, date,
      userId, date,
      userId, date,
      now, now
    );
  }

  /**
   * Get all pending rows that are ready to be retried (nextRetryAt <= now).
   * Used by the sync flush process.
   */
  getReadyPending(): QueueRow[] {
    const now = Date.now();
    const stmt = this.db.prepare(`
      SELECT * FROM sync_queue
      WHERE status = 'pending'
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY created_at ASC
    `);
    return stmt.all(now) as QueueRow[];
  }

  /**
   * Get all failed rows (for startup recovery).
   */
  getFailed(): QueueRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_queue
      WHERE status = 'failed'
      ORDER BY updated_at ASC
    `);
    return stmt.all() as QueueRow[];
  }

  /**
   * Get all stuck 'syncing' rows (for startup recovery).
   */
  getStuckSyncing(): QueueRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_queue
      WHERE status = 'syncing'
      ORDER BY updated_at ASC
    `);
    return stmt.all() as QueueRow[];
  }

  /**
   * Mark a row as syncing (to prevent duplicate concurrent flushes).
   */
  markSyncing(userId: string, date: string): void {
    const stmt = this.db.prepare(`
      UPDATE sync_queue SET status = 'syncing', updated_at = ? 
      WHERE user_id = ? AND date = ?
    `);
    stmt.run(Date.now(), userId, date);
  }

  /**
   * Mark a row as synced successfully.
   */
  markSynced(userId: string, date: string): void {
    const stmt = this.db.prepare(`
      UPDATE sync_queue SET status = 'synced', next_retry_at = NULL, updated_at = ?
      WHERE user_id = ? AND date = ?
    `);
    stmt.run(Date.now(), userId, date);
  }

  /**
   * Increment retry count and schedule next retry with exponential backoff.
   * ENG-03, ENG-04: Exponential backoff capped at maxBackoffMs, max maxRetries.
   * Does NOT delete on max retries exceeded - keeps in 'failed' state for manual recovery.
   */
  incrementRetry(userId: string, date: string): void {
    const row = this.getRow(userId, date);
    if (!row) return;

    const newRetryCount = row.retry_count + 1;
    const baseMs = this.options.baseBackoffMs;
    const maxMs = this.options.maxBackoffMs;
    const maxRetries = this.options.maxRetries;

    // Exponential backoff: base * 2^retryCount, capped at maxBackoffMs
    const backoffMs = Math.min(baseMs * Math.pow(2, newRetryCount - 1), maxMs);
    const nextRetryAt = Date.now() + backoffMs;

    if (newRetryCount >= maxRetries) {
      // Max retries reached - keep in failed state, no next retry
      // ENG-03, ENG-04: Do NOT delete, retain for manual recovery
      const stmt = this.db.prepare(`
        UPDATE sync_queue SET 
          retry_count = ?,
          next_retry_at = NULL,
          status = 'failed',
          updated_at = ?
        WHERE user_id = ? AND date = ?
      `);
      stmt.run(newRetryCount, Date.now(), userId, date);
    } else {
      const stmt = this.db.prepare(`
        UPDATE sync_queue SET 
          retry_count = ?,
          next_retry_at = ?,
          status = 'pending',
          updated_at = ?
        WHERE user_id = ? AND date = ?
      `);
      stmt.run(newRetryCount, nextRetryAt, Date.now(), userId, date);
    }
  }

  /**
   * Reset failed rows to pending for retry (ENG-04: desktop startup + 6hr timer).
   */
  resetFailedRows(): number {
    const stmt = this.db.prepare(`
      UPDATE sync_queue 
      SET status = 'pending', next_retry_at = NULL, updated_at = ?
      WHERE status = 'failed'
    `);
    const result = stmt.run(Date.now());
    return result.changes;
  }

  /**
   * Requeue stuck 'syncing' rows (in case of crash during flush).
   */
  requeueStuckSyncing(): number {
    const stmt = this.db.prepare(`
      UPDATE sync_queue 
      SET status = 'pending', updated_at = ?
      WHERE status = 'syncing'
    `);
    const result = stmt.run(Date.now());
    return result.changes;
  }

  /**
   * Get a single row by userId and date.
   */
  getRow(userId: string, date: string): QueueRow | null {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_queue WHERE user_id = ? AND date = ?
    `);
    return stmt.get(userId, date) as QueueRow | null;
  }

  /**
   * Prune old synced rows (older than pruneSyncedAfterDays).
   * Called periodically to bound database size.
   */
  pruneOldSynced(): number {
    const cutoffMs = Date.now() - this.options.pruneSyncedAfterDays * 24 * 60 * 60 * 1000;
    const stmt = this.db.prepare(`
      DELETE FROM sync_queue 
      WHERE status = 'synced' AND updated_at < ?
    `);
    const result = stmt.run(cutoffMs);
    return result.changes;
  }

  /**
   * Get queue statistics for monitoring.
   */
  getStats(): { pending: number; syncing: number; synced: number; failed: number } {
    const stmt = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM sync_queue GROUP BY status
    `);
    const rows = stmt.all() as { status: QueueStatus; count: number }[];
    const stats = { pending: 0, syncing: 0, synced: 0, failed: 0 };
    for (const row of rows) {
      stats[row.status] = row.count;
    }
    return stats;
  }
}

/**
 * Legacy alias for DeduplicatedQueue (ENG-12 backward compatibility).
 * Test files import SyncQueue from '../queue'.
 */
export const SyncQueue = DeduplicatedQueue;

/**
 * Calculate exponential backoff delay for a given retry count.
 * Returns delay in milliseconds, capped at maxBackoffMs.
 */
export function calculateBackoff(
  retryCount: number,
  baseMs: number = DEFAULT_BASE_BACKOFF_MS,
  maxMs: number = DEFAULT_MAX_BACKOFF_MS
): number {
  return Math.min(baseMs * Math.pow(2, retryCount), maxMs);
}

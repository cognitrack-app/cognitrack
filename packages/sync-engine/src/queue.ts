import Database from 'better-sqlite3';
import type { DesktopSyncPayload } from '@cognitrack/shared';

export type QueueStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface DesktopSessionPayload {
  userId:   string;
  date:     string;
  deviceId: string;
  session:  DesktopSyncPayload;
}

export interface QueueItem {
  id:        string;
  type:      'desktopSession';
  data:      DesktopSessionPayload;
  status:    QueueStatus;
  createdAt: Date;
  updatedAt: Date;
  attempts:  number;
  error?:    string;
}

interface QueueRow {
  id:         string;
  type:       string;
  data:       string;
  status:     string;
  created_at: string;
  updated_at: string;
  attempts:   number;
  error:      string | null;
}

export class SyncQueue {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('wal_autocheckpoint = 100');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL,
        data       TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        attempts   INTEGER NOT NULL DEFAULT 0,
        error      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);
    `);
  }

  addItem(item: Omit<QueueItem, 'id' | 'createdAt' | 'updatedAt'>): string {
    const id  = `${item.type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO queue (id, type, data, status, created_at, updated_at, attempts) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, item.type, JSON.stringify(item.data), item.status, now, now, item.attempts);
    return id;
  }

  getPendingItems(batchSize = 20): QueueItem[] {
    const rows = this.db.prepare(
      `SELECT * FROM queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`
    ).all(batchSize) as QueueRow[];
    return rows.map(r => this.hydrate(r));
  }

  updateItemStatus(id: string, status: QueueStatus, error?: string): void {
    this.db.prepare(
      'UPDATE queue SET status = ?, updated_at = ?, attempts = attempts + 1, error = ? WHERE id = ?'
    ).run(status, new Date().toISOString(), error ?? null, id);
  }

  getItem(id: string): QueueItem | null {
    const row = this.db.prepare('SELECT * FROM queue WHERE id = ?').get(id) as QueueRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  getItemsByStatus(status: QueueStatus): QueueItem[] {
    const rows = this.db.prepare(
      'SELECT * FROM queue WHERE status = ? ORDER BY created_at ASC'
    ).all(status) as QueueRow[];
    return rows.map(r => this.hydrate(r));
  }

  requeueFailed(maxRetries = 5): void {
    this.db.prepare(
      `UPDATE queue SET status = 'pending' WHERE status = 'failed' AND attempts < ?`
    ).run(maxRetries);
  }

  deleteItem(id: string): void {
    this.db.prepare('DELETE FROM queue WHERE id = ?').run(id);
  }

  getStatus(): { pending: number; syncing: number; synced: number; failed: number; total: number } {
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'syncing'  THEN 1 ELSE 0 END) AS syncing,
        SUM(CASE WHEN status = 'synced'   THEN 1 ELSE 0 END) AS synced,
        SUM(CASE WHEN status = 'failed'   THEN 1 ELSE 0 END) AS failed,
        COUNT(*) AS total
      FROM queue
    `).get() as { pending: number; syncing: number; synced: number; failed: number; total: number };
    return {
      pending: row.pending ?? 0,
      syncing: row.syncing ?? 0,
      synced:  row.synced  ?? 0,
      failed:  row.failed  ?? 0,
      total:   row.total   ?? 0,
    };
  }

  private hydrate(row: QueueRow): QueueItem {
    return {
      id:        row.id,
      type:      row.type as 'desktopSession',
      data:      JSON.parse(row.data) as DesktopSessionPayload,
      status:    row.status as QueueStatus,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      attempts:  row.attempts,
      error:     row.error ?? undefined,
    };
  }
}

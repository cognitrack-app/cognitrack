"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncQueue = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
class SyncQueue {
    constructor(dbPath) {
        this.db = new better_sqlite3_1.default(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.init();
    }
    init() {
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
    addItem(item) {
        const id = `${item.type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const now = new Date().toISOString();
        this.db.prepare('INSERT INTO queue (id, type, data, status, created_at, updated_at, attempts) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, item.type, JSON.stringify(item.data), item.status, now, now, item.attempts);
        return id;
    }
    getPendingItems(batchSize = 20) {
        const rows = this.db.prepare(`SELECT * FROM queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`).all(batchSize);
        return rows.map(r => this.hydrate(r));
    }
    updateItemStatus(id, status, error) {
        this.db.prepare('UPDATE queue SET status = ?, updated_at = ?, attempts = attempts + 1, error = ? WHERE id = ?').run(status, new Date().toISOString(), error ?? null, id);
    }
    getItem(id) {
        const row = this.db.prepare('SELECT * FROM queue WHERE id = ?').get(id);
        return row ? this.hydrate(row) : null;
    }
    getItemsByStatus(status) {
        const rows = this.db.prepare('SELECT * FROM queue WHERE status = ? ORDER BY created_at ASC').all(status);
        return rows.map(r => this.hydrate(r));
    }
    requeueFailed(maxRetries = 5) {
        this.db.prepare(`UPDATE queue SET status = 'pending' WHERE status = 'failed' AND attempts < ?`).run(maxRetries);
    }
    deleteItem(id) {
        this.db.prepare('DELETE FROM queue WHERE id = ?').run(id);
    }
    getStatus() {
        const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'syncing'  THEN 1 ELSE 0 END) AS syncing,
        SUM(CASE WHEN status = 'synced'   THEN 1 ELSE 0 END) AS synced,
        SUM(CASE WHEN status = 'failed'   THEN 1 ELSE 0 END) AS failed,
        COUNT(*) AS total
      FROM queue
    `).get();
        return {
            pending: row.pending ?? 0,
            syncing: row.syncing ?? 0,
            synced: row.synced ?? 0,
            failed: row.failed ?? 0,
            total: row.total ?? 0,
        };
    }
    hydrate(row) {
        return {
            id: row.id,
            type: row.type,
            data: JSON.parse(row.data),
            status: row.status,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            attempts: row.attempts,
            error: row.error ?? undefined,
        };
    }
}
exports.SyncQueue = SyncQueue;

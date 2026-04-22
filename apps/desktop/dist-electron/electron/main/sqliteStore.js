"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SQLiteStore = void 0;
const electron_1 = require("electron");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
/**
 * SQLiteStore — crash-safe local storage for CogniTrack desktop agent.
 *
 * Uses better-sqlite3 (synchronous API) with WAL journal mode for
 * power-loss safety. All methods are synchronous.
 *
 * Tables:
 *   app_events   — raw tracking events; 7-day TTL enforced by INSERT trigger
 *   daily_metrics — computed 11-scalar summaries ready for Firestore sync
 */
class SQLiteStore {
    db;
    constructor() {
        const userDataPath = electron_1.app.getPath('userData');
        const dbDir = path_1.default.join(userDataPath, 'db');
        fs_1.default.mkdirSync(dbDir, { recursive: true });
        const dbPath = path_1.default.join(dbDir, 'cognitrack.db');
        this.db = new better_sqlite3_1.default(dbPath);
        // WAL mode: writes don't block reads; survives hard power loss
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        // Recommended for performance on desktop
        this.db.pragma('synchronous = NORMAL');
        this.init();
    }
    init() {
        this.db.exec(`
      -- ── Raw events (local-only, 7-day TTL) ────────────────────────────────
      CREATE TABLE IF NOT EXISTS app_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp  INTEGER NOT NULL,
        appId      TEXT    NOT NULL,
        category   TEXT    NOT NULL,
        eventType  TEXT    NOT NULL,
        durationMs INTEGER NOT NULL DEFAULT 0,
        deviceType TEXT    NOT NULL DEFAULT 'desktop'
      );

      CREATE INDEX IF NOT EXISTS idx_events_timestamp
        ON app_events(timestamp);

      -- 7-day TTL: delete events older than 7 days on every insert
      -- 604800000 ms = 7 days
      CREATE TRIGGER IF NOT EXISTS ttl_app_events
      AFTER INSERT ON app_events
      BEGIN
        DELETE FROM app_events
        WHERE timestamp < (NEW.timestamp - 604800000);
      END;

      -- ── Daily metrics (synced to Firestore as 11 scalars) ─────────────────
      CREATE TABLE IF NOT EXISTS daily_metrics (
        date                TEXT PRIMARY KEY,  -- YYYY-MM-DD
        cognitiveDebt       REAL NOT NULL DEFAULT 0,
        cognitiveLoadPct    REAL NOT NULL DEFAULT 0,
        wmCapacityRemaining REAL NOT NULL DEFAULT 100,
        residueAtEOD        REAL NOT NULL DEFAULT 0,
        totalSwitches       INTEGER NOT NULL DEFAULT 0,
        totalFocusedTime    REAL NOT NULL DEFAULT 0,
        switchVelocityPeak  REAL NOT NULL DEFAULT 0,
        peakLoadHour        INTEGER NOT NULL DEFAULT 0,
        hourlyLoad          TEXT NOT NULL DEFAULT '[]',
        categoryBreakdown   TEXT NOT NULL DEFAULT '{}',
        synced              INTEGER NOT NULL DEFAULT 0,
        updatedAt           INTEGER NOT NULL
      );
    `);
    }
    // ── Raw Events ─────────────────────────────────────────────────────────────
    /**
     * Insert a single raw app event.
     * The TTL trigger fires automatically and deletes events older than 7 days.
     * This is the method called by ActiveWindowTracker on every app switch.
     */
    insertEvent(event) {
        this.db.prepare(`
      INSERT INTO app_events (timestamp, appId, category, eventType, durationMs, deviceType)
      VALUES (@timestamp, @appId, @category, @eventType, @durationMs, @deviceType)
    `).run(event);
    }
    /**
     * Fetch all raw events for a given date (local midnight → next midnight).
     * Used by the batch processor to feed into calculateCognitiveDebt().
     */
    getEventsForDate(date) {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        const rows = this.db.prepare(`
      SELECT * FROM app_events
      WHERE timestamp >= ? AND timestamp < ?
      ORDER BY timestamp ASC
    `).all(start.getTime(), end.getTime());
        return rows.map(r => ({
            id: String(r.id),
            timestamp: r.timestamp,
            appId: r.appId,
            category: r.category,
            durationMs: r.durationMs,
            eventType: r.eventType,
            deviceType: r.deviceType,
        }));
    }
    /** Count of raw switch events today — used for live UI stats. */
    getSwitchCountToday() {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM app_events
      WHERE timestamp >= ? AND eventType = 'switch'
    `).get(start.getTime());
        return row.count;
    }
    /**
     * Hourly switch counts for today (for the live chart in the renderer).
     * Returns 24-element array indexed by hour.
     */
    getHourlySwitchesToday() {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        const rows = this.db.prepare(`
      SELECT
        CAST((timestamp / 3600000) AS INTEGER) % 24 AS hour,
        COUNT(*) AS switches
      FROM app_events
      WHERE timestamp >= ? AND timestamp < ? AND eventType = 'switch'
      GROUP BY hour
      ORDER BY hour
    `).all(start.getTime(), end.getTime());
        const result = new Array(24).fill(0);
        for (const row of rows)
            result[row.hour] = row.switches;
        return result;
    }
    // ── Daily Metrics ──────────────────────────────────────────────────────────
    /**
     * Upsert the computed daily metrics for a given date.
     * Called by the batch processor after running calculateCognitiveDebt().
     */
    upsertDailyMetrics(metrics) {
        this.db.prepare(`
      INSERT INTO daily_metrics (
        date, cognitiveDebt, cognitiveLoadPct, wmCapacityRemaining,
        residueAtEOD, totalSwitches, totalFocusedTime, switchVelocityPeak,
        peakLoadHour, hourlyLoad, categoryBreakdown, synced, updatedAt
      ) VALUES (
        @date, @cognitiveDebt, @cognitiveLoadPct, @wmCapacityRemaining,
        @residueAtEOD, @totalSwitches, @totalFocusedTime, @switchVelocityPeak,
        @peakLoadHour, @hourlyLoad, @categoryBreakdown, 0, @updatedAt
      )
      ON CONFLICT(date) DO UPDATE SET
        cognitiveDebt       = excluded.cognitiveDebt,
        cognitiveLoadPct    = excluded.cognitiveLoadPct,
        wmCapacityRemaining = excluded.wmCapacityRemaining,
        residueAtEOD        = excluded.residueAtEOD,
        totalSwitches       = excluded.totalSwitches,
        totalFocusedTime    = excluded.totalFocusedTime,
        switchVelocityPeak  = excluded.switchVelocityPeak,
        peakLoadHour        = excluded.peakLoadHour,
        hourlyLoad          = excluded.hourlyLoad,
        categoryBreakdown   = excluded.categoryBreakdown,
        synced              = 0,
        updatedAt           = excluded.updatedAt
    `).run({ ...metrics, updatedAt: Date.now() });
    }
    /** Fetch daily metrics row for a specific date. Null if not yet computed. */
    getDailyMetrics(date) {
        return this.db.prepare('SELECT * FROM daily_metrics WHERE date = ?').get(date) ?? null;
    }
    /** Fetch all unsynced daily metrics (synced = 0). */
    getUnsyncedMetrics() {
        return this.db.prepare(`SELECT * FROM daily_metrics WHERE synced = 0 ORDER BY date DESC`).all();
    }
    /** Mark a date's metrics as successfully synced to Firestore. */
    markSynced(date) {
        this.db.prepare(`UPDATE daily_metrics SET synced = 1, updatedAt = ? WHERE date = ?`).run(Date.now(), date);
    }
    /**
     * Fetch last N days of daily metrics for the history chart.
     */
    getMetricsHistory(days = 7) {
        return this.db.prepare(`
      SELECT * FROM daily_metrics
      ORDER BY date DESC
      LIMIT ?
    `).all(days);
    }
    /** Returns parsed daily_metrics for today as a CognitiveSession array for IPC. */
    getTodaysSessions(userId) {
        const today = new Date().toISOString().split('T')[0];
        const row = this.getDailyMetrics(today);
        return row ? [row] : [];
    }
    /** Returns 24-element hourly load array for a given date, for the chart IPC handler. */
    getHourlyBreakdown(userId, date) {
        const row = this.getDailyMetrics(date);
        if (!row)
            return [];
        const hourly = JSON.parse(row.hourlyLoad);
        return hourly.map((debt, hour) => ({ hour, debt }));
    }
    /** Returns top apps by durationMs for a given date, derived from app_events. */
    getMostUsedApps(userId, date) {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        const rows = this.db.prepare(`
      SELECT appId, SUM(durationMs) AS totalMs
      FROM app_events
      WHERE timestamp >= ? AND timestamp < ? AND eventType = 'switch'
      GROUP BY appId
      ORDER BY totalMs DESC
      LIMIT 10
    `).all(start.getTime(), end.getTime());
        return rows.map(r => ({
            appId: r.appId,
            appName: r.appId.split('.').slice(1).join('.') || r.appId,
            duration: Math.round(r.totalMs / 60000), // ms → minutes
        }));
    }
    /** Returns daily_metrics rows for a date range [from, to] inclusive. */
    getSessionsInRange(userId, from, to) {
        return this.db.prepare(`SELECT * FROM daily_metrics WHERE date >= ? AND date <= ? ORDER BY date ASC`).all(from, to);
    }
    /** Fetch a single daily_metrics row by date (used as getById in IPC). */
    getById(date) {
        return this.getDailyMetrics(date);
    }
    // ── Utilities ──────────────────────────────────────────────────────────────
    close() {
        this.db.close();
    }
}
exports.SQLiteStore = SQLiteStore;
//# sourceMappingURL=sqliteStore.js.map
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActiveWindowTracker = void 0;
const electron_1 = require("electron");
const shared_1 = require("@cognitrack/shared");
const POLL_INTERVAL_MS = 5_000; // 5-second poll (PRD spec)
const IDLE_THRESHOLD_S = 60; // 60s of no input = idle / break
let activeWin = null;
/**
 * Lazily loads active-win (ESM) at runtime.
 * Caches the function so the dynamic import only runs once.
 */
async function getActiveWin() {
    if (activeWin)
        return activeWin;
    const mod = await Promise.resolve().then(() => __importStar(require('active-win')));
    activeWin = mod.default ?? mod;
    return activeWin;
}
/**
 * ActiveWindowTracker
 *
 * Polls the OS every 5 seconds for the frontmost window.
 * Extracts ONLY the app name — window title and URL are explicitly never read.
 * Converts the raw name to a canonical appId via normalizeAppId() then
 * resolves its cognitive category, and writes a raw event to SQLite.
 *
 * Privacy boundary (v6 PRD §13.3):
 *   ✅  win.owner.name   — only field used
 *   ❌  win.title        — could contain sensitive content, never read
 *   ❌  win.url          — exposes browser history, never read
 */
class ActiveWindowTracker {
    store;
    intervalId = null;
    lastAppId = null;
    lastSwitchTs = Date.now();
    running = false;
    constructor(store) {
        this.store = store;
    }
    // ── Lifecycle ─────────────────────────────────────────────────────────────
    start() {
        if (this.running)
            return;
        this.running = true;
        this.lastSwitchTs = Date.now();
        // Warm up the ESM import in the background so first poll is instant
        getActiveWin().catch(err => console.error('[tracker] Failed to load active-win:', err));
        this.intervalId = setInterval(() => {
            this.poll().catch(err => console.error('[tracker] Poll error:', err));
        }, POLL_INTERVAL_MS);
        // System-level idle signals — lock screen or sleep = confirmed break
        electron_1.powerMonitor.on('lock-screen', this.onSystemIdle);
        electron_1.powerMonitor.on('suspend', this.onSystemIdle);
        console.log('[tracker] Started (5s poll interval)');
    }
    stop() {
        if (!this.running)
            return;
        this.running = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        electron_1.powerMonitor.off('lock-screen', this.onSystemIdle);
        electron_1.powerMonitor.off('suspend', this.onSystemIdle);
        console.log('[tracker] Stopped');
    }
    isRunning() {
        return this.running;
    }
    // ── Core poll logic ───────────────────────────────────────────────────────
    async poll() {
        // Check OS-level idle time first — no point querying active window if idle
        const idleSeconds = electron_1.powerMonitor.getSystemIdleTime();
        if (idleSeconds >= IDLE_THRESHOLD_S) {
            this.recordBreak();
            return;
        }
        let result;
        try {
            const fn = await getActiveWin();
            result = await fn();
        }
        catch (err) {
            // active-win can throw when Accessibility permissions are missing on macOS,
            // or when explorer.exe restarts on Windows. Log and skip this tick.
            console.warn('[tracker] active-win error (skipping tick):', err);
            return;
        }
        if (!result)
            return;
        // ✅ PRIVACY: Only read owner.name (process/app name)
        // ❌ NEVER access result.title or result.url
        const rawName = result.owner?.name ?? '';
        if (!rawName)
            return;
        const appId = (0, shared_1.normalizeAppId)(rawName, 'win32');
        const category = (0, shared_1.resolveCategory)(appId);
        const now = Date.now();
        // Only record an event when the foreground app actually changes
        if (appId !== this.lastAppId) {
            const durationMs = now - this.lastSwitchTs;
            this.store.insertEvent({
                timestamp: now,
                appId,
                category,
                eventType: 'switch',
                durationMs,
                deviceType: 'desktop',
            });
            this.lastAppId = appId;
            this.lastSwitchTs = now;
        }
    }
    // ── System idle handler (arrow fn so `this` is always bound) ─────────────
    onSystemIdle = () => {
        this.recordBreak();
    };
    recordBreak() {
        const now = Date.now();
        this.store.insertEvent({
            timestamp: now,
            appId: 'idle',
            category: 'productive', // category is irrelevant for idle events
            eventType: 'idle',
            durationMs: 0,
            deviceType: 'desktop',
        });
        // Reset tracking state so we don't compute a huge duration on resume
        this.lastAppId = null;
        this.lastSwitchTs = now;
    }
}
exports.ActiveWindowTracker = ActiveWindowTracker;
//# sourceMappingURL=activeWindowTracker.js.map
import { powerMonitor } from 'electron';
import { normalizeAppId, resolveCategory } from '@cognitrack/shared';
import type { SQLiteStore } from './sqliteStore';

// active-win v8 is ESM-only; we import it dynamically once at startup.
// The type import is fine at compile time.
import type { Result as ActiveWinResult } from 'active-win';

const POLL_INTERVAL_MS = 5_000; // 5-second poll (PRD spec)
const IDLE_THRESHOLD_S = 60; // 60s of no input = idle / break

// Windows explorer.exe restart handling
const MAX_ACTIVE_WIN_RETRIES = 3;
const ACTIVE_WIN_RETRY_BASE_MS = 1000;

let activeWin: (() => Promise<ActiveWinResult | undefined>) | null = null;

/**
 * Lazily loads active-win (ESM) at runtime.
 * Caches the function so the dynamic import only runs once.
 */
async function getActiveWin(): Promise<() => Promise<ActiveWinResult | undefined>> {
  if (activeWin) return activeWin;
  const mod = await import('active-win');
  activeWin = mod.default ?? mod;
  return activeWin!;
}

/**
 * Resets the active-win cache to force re-initialization.
 * Called when explorer.exe restarts on Windows to recover from stale state.
 */
function resetActiveWinCache(): void {
  activeWin = null;
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
export class ActiveWindowTracker {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastAppId: string | null = null;
  private lastSwitchTs = Date.now();
  private running = false;
  /**
   * DESK-01 FIX: True while we are in a continuous idle session.
   * Without this guard, poll() calls recordBreak() every 5 s while idle,
   * flooding SQLite with duplicate idle rows. detectBreakEvents() looks for
   * gaps ≥ 5 min between consecutive events — with rows 5 s apart no gap
   * ever qualifies, so break_events is always []. We insert ONE idle marker
   * per idle session and clear the flag when the user becomes active again.
   */
  private isIdle = false;

  constructor(private readonly store: SQLiteStore) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastSwitchTs = Date.now();

    // Warm up the ESM import in the background so first poll is instant
    getActiveWin().catch(err =>
      console.error('[tracker] Failed to load active-win:', err)
    );

    this.intervalId = setInterval(() => {
      this.poll().catch(err =>
        console.error('[tracker] Poll error:', err)
      );
    }, POLL_INTERVAL_MS);

    // System-level idle signals — lock screen or sleep = confirmed break
    powerMonitor.on('lock-screen', this.onSystemIdle);
    powerMonitor.on('suspend', this.onSystemIdle);

    console.log('[tracker] Started (5s poll interval)');
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    powerMonitor.off('lock-screen', this.onSystemIdle);
    powerMonitor.off('suspend', this.onSystemIdle);

    console.log('[tracker] Stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Core poll logic ───────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    // Check OS-level idle time first — no point querying active window if idle
    const idleSeconds = powerMonitor.getSystemIdleTime();
    if (idleSeconds >= IDLE_THRESHOLD_S) {
      this.recordBreak();
      return;
    }

    let result: ActiveWinResult | undefined;
    try {
      const fn = await getActiveWin();
      result = await fn();
    } catch (err) {
      // active-win can throw when Accessibility permissions are missing on macOS,
      // or when explorer.exe restarts on Windows.
      // On Windows, retry with exponential backoff to recover from explorer.exe restart.
      if (process.platform === 'win32') {
        await this.handleActiveWinError(err);
      } else {
        console.warn('[tracker] active-win error (skipping tick):', err);
      }
      return;
    }

    if (!result) return;

    // ✅ PRIVACY: Only read owner.name (process/app name)
    // ❌ NEVER access result.title or result.url
    const rawName = result.owner?.name ?? '';
    if (!rawName) return;

    const appId = normalizeAppId(rawName, process.platform === 'win32' ? 'win32' : 'darwin');
    const category = resolveCategory(appId);
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
      // DESK-01 FIX: Returning from idle — clear the guard so the next
      // break period will insert a fresh idle marker.
      this.isIdle = false;
    }
  }

  /**
   * Handles active-win errors on Windows with retry logic for explorer.exe restarts.
   * Uses exponential backoff: 1s, 2s, 4s... up to MAX_ACTIVE_WIN_RETRIES attempts.
   */
  private async handleActiveWinError(err: unknown): Promise<void> {
    console.warn('[tracker] active-win error on Windows, attempting recovery:', err);

    // Reset the active-win cache to force re-initialization
    resetActiveWinCache();

    for (let attempt = 1; attempt <= MAX_ACTIVE_WIN_RETRIES; attempt++) {
      const delay = ACTIVE_WIN_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      console.log(`[tracker] Retrying active-win (attempt ${attempt}/${MAX_ACTIVE_WIN_RETRIES}) after ${delay}ms`);

      await new Promise(resolve => setTimeout(resolve, delay));

      try {
        const fn = await getActiveWin();
        const result = await fn();
        if (result) {
          console.log('[tracker] active-win recovered successfully');
          return;
        }
      } catch (retryErr) {
        console.warn(`[tracker] active-win retry ${attempt} failed:`, retryErr);
      }
    }

    console.error('[tracker] active-win failed to recover after all retries');
  }

  // ── System idle handler (arrow fn so `this` is always bound) ─────────────

  private readonly onSystemIdle = (): void => {
    this.recordBreak();
  };

  private recordBreak(): void {
    // DESK-01 FIX: Only insert ONE idle event per continuous idle session.
    // poll() calls this every 5 s while idleSeconds >= threshold; without
    // this guard a 10-minute break generates ~120 duplicate SQLite rows,
    // and detectBreakEvents() never finds a gap >= 5 min between them.
    if (this.isIdle) return;
    this.isIdle = true;

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

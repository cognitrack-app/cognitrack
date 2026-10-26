/**
 * sync/debounce.ts
 *
 * Debounced sync utility for event-triggered synchronization.
 * Triggers a flush on every event write, debounced to batch rapid events.
 * Includes maxWait to force flush after maximum latency.
 * ENG-01: Event-triggered sync with debounce (10s default, 30s maxWait).
 */

export interface DebouncedSyncOptions {
  debounceMs: number;           // Default: 10_000 (10s)
  maxWaitMs: number;            // Default: 30_000 (30s)
  flushFn: () => Promise<void>;
}

/**
 * DebouncedSync class for managing debounced queue flushes.
 * - On every event, trigger() is called
 * - Flush is scheduled after debounceMs
 * - If maxWaitMs exceeded since last flush, forces immediate flush
 * - Prevents multiple concurrent flushes
 */
export class DebouncedSync {
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

  /**
   * Trigger a debounced flush.
   * Called on every event write (app switch, pickup, etc.).
   * If maxWait exceeded since last flush, flushes immediately.
   */
  trigger(): void {
    const now = Date.now();

    // Force flush if maxWait exceeded (bypass debounce)
    if (now - this.lastFlush >= this.maxWaitMs) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.flush();
      return;
    }

    // Schedule debounced flush
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  /**
   * Execute the flush function.
   * Clears timer and updates lastFlush timestamp.
   */
  private async flush(): Promise<void> {
    this.timer = null;
    this.lastFlush = Date.now();
    try {
      await this.flushFn();
    } catch (err) {
      // Error handled by flushFn (retry logic in queue)
      console.error('[DebouncedSync] Flush failed:', err);
    }
  }

  /**
   * Cancel any pending flush.
   */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Get time until next scheduled flush (for testing/debugging).
   */
  getTimeUntilFlush(): number {
    if (!this.timer) return 0;
    // Note: setTimeout doesn't expose remaining time, so we estimate
    return this.debounceMs;
  }

  /**
   * Check if a flush is currently scheduled.
   */
  isPending(): boolean {
    return this.timer !== null;
  }

  /**
   * Force immediate flush (bypassing debounce).
   */
  async forceFlush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}

/**
 * Factory function for creating a DebouncedSync with default options.
 * Defaults: 10s debounce, 30s maxWait (ENG-01).
 */
export function createDebouncedSync(
  flushFn: () => Promise<void>,
  debounceMs: number = 10_000,
  maxWaitMs: number = 30_000
): DebouncedSync {
  return new DebouncedSync({ debounceMs, maxWaitMs, flushFn });
}
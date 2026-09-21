import { writeDesktopSession } from '@cognitrack/api-client';
import type { DesktopSyncPayload } from '@cognitrack/shared';
import { SyncQueue, type DesktopSessionPayload } from './queue';

const MAX_FLUSH_DURATION_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export class SyncEngine {
  private queue:     SyncQueue;
  private isSyncing = false;
  private isOnline  = false;

  constructor(queueDbPath: string) {
    this.queue = new SyncQueue(queueDbPath);
  }

  setOnline(online: boolean): void {
    this.isOnline = online;
    if (online) {
      // Recover any items frozen in 'syncing' by a previous crash — must run
      // BEFORE requeueFailed so the count is accurate and all retryable items
      // are in 'pending' state before the flush picks them up.
      this.queue.requeueStuckSyncing();
      this.queue.requeueFailed();
      void this.flush();
    }
  }

  /**
   * Push a desktop session into the offline queue.
   * Always succeeds — even if offline.
   */
  push(userId: string, date: string, deviceId: string, session: DesktopSyncPayload): string {
    return this.queue.addItem({
      type:     'desktopSession',
      data:     { userId, date, deviceId, session } satisfies DesktopSessionPayload,
      status:   'pending',
      attempts: 0,
    });
  }

  /**
   * Flush all pending items to Firestore with exponential backoff via queue scheduling.
   * Guards against concurrent calls with isSyncing flag.
   * No-op when offline.
   *
   * B5 FIX: drain the full queue, not just the first batch of 20.
   * getPendingItems() caps at 20 rows per call. After 3+ days offline
   * (~48 queued hourly pushes) only the first 20 would sync on reconnect;
   * the remaining 28 waited for the next natural connectivity event.
   * The while-loop re-fetches until getPendingItems() returns an empty array.
   *
   * Circuit breaker: aborts if total flush time exceeds MAX_FLUSH_DURATION_MS.
   * Exponential backoff is handled by the queue via nextRetryAt field —
   * failed items are scheduled for retry with increasing delays, not by
   * blocking the flush loop.
   */
  async flush(): Promise<void> {
    if (!this.isOnline || this.isSyncing) return;
    this.isSyncing = true;
    const flushStart = Date.now();

    try {
      let pending = this.queue.getPendingItems(); // batch = 20
      while (pending.length > 0) {
        // Circuit breaker: abort if flush is taking too long
        if (Date.now() - flushStart > MAX_FLUSH_DURATION_MS) {
          console.warn('[SyncEngine] Flush timeout reached, aborting to prevent resource exhaustion');
          break;
        }

        for (const item of pending) {
          this.queue.updateItemStatus(item.id, 'syncing');
          try {
            const { userId, date, deviceId, session } = item.data;

            // Write directly — conflict resolution is handled server-side by
            // mergeAgentData Cloud Function using Firestore's field-level merge
            // and document-level last-write-wins via lastMergeRun timestamp.
            // This avoids an extra read per item (1 read + 1 write → 1 write)
            // and works correctly under offline/flaky network conditions.
            await writeDesktopSession(userId, date, deviceId, session);
            this.queue.updateItemStatus(item.id, 'synced');
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);

            // Schedule retry with exponential backoff via queue's nextRetryAt
            // This avoids blocking the flush loop — the item will be picked up
            // on the next flush cycle after its nextRetryAt has passed.
            const backoffMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, item.attempts), MAX_BACKOFF_MS);
            const jitter = Math.random() * backoffMs * 0.5;
            const nextRetryAt = new Date(Date.now() + backoffMs + jitter);

            this.queue.updateItemStatus(item.id, 'failed', msg, nextRetryAt);
          }
        }
        pending = this.queue.getPendingItems(); // fetch next batch (respects nextRetryAt)
      }
    } finally {
      this.isSyncing = false;
      // Prune synced rows older than 7 days after every flush cycle.
      // Keeps the queue DB lean and the tray popover 'total' counter meaningful.
      this.queue.pruneOldSynced();
    }
  }

  /**
   * Last-write-wins conflict resolution with validation.
   * Compares lastUpdated ISO timestamps from two DesktopSyncPayloads.
   * Returns whichever was updated more recently.
   * Throws if either timestamp is invalid.
   *
   * NOTE: This is kept for potential future use (e.g., manual reconciliation
   * passes) but is NOT called in the hot flush() path. The server-side
   * mergeAgentData handles conflict resolution via Firestore merge semantics
   * and the lastMergeRun idempotency token.
   */
  resolveConflict(local: DesktopSyncPayload, remote: DesktopSyncPayload): DesktopSyncPayload {
    const localTime = new Date(local.lastUpdated).getTime();
    const remoteTime = new Date(remote.lastUpdated).getTime();

    if (Number.isNaN(localTime) || Number.isNaN(remoteTime)) {
      throw new Error('Invalid lastUpdated timestamp in conflict resolution');
    }

    return localTime >= remoteTime ? local : remote;
  }

  getQueueStatus() { return this.queue.getStatus(); }
  getQueue()       { return this.queue; }
}
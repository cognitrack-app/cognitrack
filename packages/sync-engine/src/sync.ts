import { writeDesktopSession } from '@cognitrack/api-client';
import type { DesktopSyncPayload } from '@cognitrack/shared';
import { SyncQueue, type DesktopSessionPayload } from './queue';

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
   * Flush all pending items to Firestore.
   * Guards against concurrent calls with isSyncing flag.
   * No-op when offline.
   */
  async flush(): Promise<void> {
    if (!this.isOnline || this.isSyncing) return;
    this.isSyncing = true;
    try {
      const pending = this.queue.getPendingItems();
      for (const item of pending) {
        this.queue.updateItemStatus(item.id, 'syncing');
        try {
          const { userId, date, deviceId, session } = item.data;
          await writeDesktopSession(userId, date, deviceId, session);
          this.queue.updateItemStatus(item.id, 'synced');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.queue.updateItemStatus(item.id, 'failed', msg);
        }
      }
    } finally {
      this.isSyncing = false;
      // Prune synced rows older than 7 days after every flush cycle.
      // Keeps the queue DB lean and the tray popover 'total' counter meaningful.
      this.queue.pruneOldSynced();
    }
  }

  /**
   * Last-write-wins conflict resolution.
   * Compares lastUpdated ISO timestamps from two DesktopSyncPayloads.
   * Returns whichever was updated more recently.
   *
   * NOTE: This method is intentionally NOT called inside flush(). The current
   * conflict resolution strategy is Firestore's own merge semantics
   * (setDoc with merge:true), which effectively gives last-write-wins at the
   * field level. For a single desktop writing to its own deviceId key this is
   * sufficient. If multi-device conflict resolution is added in the future,
   * call this before writeDesktopSession(): fetch the remote document,
   * pass both payloads here, then write only if local wins.
   */
  resolveConflict(local: DesktopSyncPayload, remote: DesktopSyncPayload): DesktopSyncPayload {
    return new Date(local.lastUpdated) >= new Date(remote.lastUpdated) ? local : remote;
  }

  getQueueStatus() { return this.queue.getStatus(); }
  getQueue()       { return this.queue; }
}

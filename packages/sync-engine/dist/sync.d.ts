import type { DesktopSyncPayload } from '@cognitrack/shared';
import { SyncQueue } from './queue';
export declare class SyncEngine {
    private queue;
    private isSyncing;
    private isOnline;
    constructor(queueDbPath: string);
    setOnline(online: boolean): void;
    /**
     * Push a desktop session into the offline queue.
     * Always succeeds — even if offline.
     */
    push(userId: string, date: string, deviceId: string, session: DesktopSyncPayload): string;
    /**
     * Flush all pending items to Firestore.
     * Guards against concurrent calls with isSyncing flag.
     * No-op when offline.
     */
    flush(): Promise<void>;
    /**
     * Last-write-wins conflict resolution.
     * Compares lastUpdated ISO timestamps from two DesktopSyncPayloads.
     * Returns whichever was updated more recently.
     */
    resolveConflict(local: DesktopSyncPayload, remote: DesktopSyncPayload): DesktopSyncPayload;
    getQueueStatus(): {
        pending: number;
        syncing: number;
        synced: number;
        failed: number;
        total: number;
    };
    getQueue(): SyncQueue;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncEngine = void 0;
const api_client_1 = require("@cognitrack/api-client");
const queue_1 = require("./queue");
class SyncEngine {
    constructor(queueDbPath) {
        this.isSyncing = false;
        this.isOnline = false;
        this.queue = new queue_1.SyncQueue(queueDbPath);
    }
    setOnline(online) {
        this.isOnline = online;
        if (online) {
            this.queue.requeueFailed();
            void this.flush();
        }
    }
    /**
     * Push a desktop session into the offline queue.
     * Always succeeds — even if offline.
     */
    push(userId, date, deviceId, session) {
        return this.queue.addItem({
            type: 'desktopSession',
            data: { userId, date, deviceId, session },
            status: 'pending',
            attempts: 0,
        });
    }
    /**
     * Flush all pending items to Firestore.
     * Guards against concurrent calls with isSyncing flag.
     * No-op when offline.
     */
    async flush() {
        if (!this.isOnline || this.isSyncing)
            return;
        this.isSyncing = true;
        try {
            const pending = this.queue.getPendingItems();
            for (const item of pending) {
                this.queue.updateItemStatus(item.id, 'syncing');
                try {
                    const { userId, date, deviceId, session } = item.data;
                    await (0, api_client_1.writeDesktopSession)(userId, date, deviceId, session);
                    this.queue.updateItemStatus(item.id, 'synced');
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    this.queue.updateItemStatus(item.id, 'failed', msg);
                }
            }
        }
        finally {
            this.isSyncing = false;
        }
    }
    /**
     * Last-write-wins conflict resolution.
     * Compares lastUpdated ISO timestamps from two DesktopSyncPayloads.
     * Returns whichever was updated more recently.
     */
    resolveConflict(local, remote) {
        return new Date(local.lastUpdated) >= new Date(remote.lastUpdated) ? local : remote;
    }
    getQueueStatus() { return this.queue.getStatus(); }
    getQueue() { return this.queue; }
}
exports.SyncEngine = SyncEngine;

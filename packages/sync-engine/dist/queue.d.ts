import type { DesktopSyncPayload } from '@cognitrack/shared';
export type QueueStatus = 'pending' | 'syncing' | 'synced' | 'failed';
export interface DesktopSessionPayload {
    userId: string;
    date: string;
    deviceId: string;
    session: DesktopSyncPayload;
}
export interface QueueItem {
    id: string;
    type: 'desktopSession';
    data: DesktopSessionPayload;
    status: QueueStatus;
    createdAt: Date;
    updatedAt: Date;
    attempts: number;
    error?: string;
}
export declare class SyncQueue {
    private db;
    constructor(dbPath: string);
    private init;
    addItem(item: Omit<QueueItem, 'id' | 'createdAt' | 'updatedAt'>): string;
    getPendingItems(batchSize?: number): QueueItem[];
    updateItemStatus(id: string, status: QueueStatus, error?: string): void;
    getItem(id: string): QueueItem | null;
    getItemsByStatus(status: QueueStatus): QueueItem[];
    requeueFailed(maxRetries?: number): void;
    deleteItem(id: string): void;
    getStatus(): {
        pending: number;
        syncing: number;
        synced: number;
        failed: number;
        total: number;
    };
    private hydrate;
}

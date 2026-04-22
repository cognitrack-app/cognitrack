import type { DesktopSyncPayload, PhoneSyncPayload, SessionDocument } from '@cognitrack/shared';
export type { SessionDocument } from '@cognitrack/shared';
/**
 * Write (or merge) a desktop session payload into Firestore.
 *
 * Path: users/{userId}/sessions/{date}   e.g. users/abc123/sessions/2026-04-19
 *
 * Document shape:
 *   desktopSessions.{deviceId} = DesktopSyncPayload
 *
 * The mergeAgentData Cloud Function triggers on this exact path and field.
 * Using setDoc + merge:true so repeated writes from the same device on the
 * same day accumulate — they don't overwrite unrelated fields.
 */
export declare function writeDesktopSession(userId: string, date: string, // "2026-04-19"
deviceId: string, payload: DesktopSyncPayload): Promise<void>;
/**
 * Write a phone sync payload into Firestore.
 * Path: users/{userId}/sessions/{date}
 */
export declare function writePhoneSession(userId: string, date: string, payload: PhoneSyncPayload): Promise<void>;
/**
 * Real-time listener for a user's sessions, newest first.
 * Returns unsubscribe fn — MUST be called on app/component teardown.
 *
 * Uses the composite index: userId ASC + updatedAt DESC
 */
export declare function subscribeToSessions(userId: string, onUpdate: (sessions: SessionDocument[]) => void, onError?: (err: Error) => void): () => void;
/**
 * Real-time listener scoped to a single date.
 * Useful for the desktop app dashboard — live updates for today only.
 */
export declare function subscribeToDate(userId: string, date: string, // "2026-04-19"
onUpdate: (session: SessionDocument | null) => void, onError?: (err: Error) => void): () => void;
/**
 * Fetch all sessions updated since a given date.
 * Used on startup to hydrate local SQLite from Firestore.
 * Uses the composite index: userId ASC + updatedAt DESC
 */
export declare function fetchSessionsSince(userId: string, since: Date): Promise<SessionDocument[]>;
/**
 * Fetch a single session document by date.
 * Uses a direct document reference (O(1)) instead of a full collection scan.
 */
export declare function fetchSessionByDate(userId: string, date: string): Promise<SessionDocument | null>;

import {
  doc,
  setDoc,
  collection,
  query,
  where,
  orderBy,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { DesktopSyncPayload, PhoneSyncPayload, SessionDocument } from '@cognitrack/shared';

// Re-export for consumers that need the shape without importing shared directly
export type { SessionDocument } from '@cognitrack/shared';

// ──────────────────────────────────────────────────────────────────────────────
// WRITE
// ──────────────────────────────────────────────────────────────────────────────

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
export async function writeDesktopSession(
  userId: string,
  date: string,         // "2026-04-19"
  deviceId: string,
  payload: DesktopSyncPayload,
): Promise<void> {
  // ✔ Correct path: users/{userId}/sessions/{date}
  const ref = doc(db, 'users', userId, 'sessions', date);
  await setDoc(
    ref,
    {
      userId,
      date,
      deletedAt: null,
      updatedAt: serverTimestamp(),
      [`desktopSessions.${deviceId}`]: payload,
    },
    { merge: true },
  );
}

/**
 * Write a phone sync payload into Firestore.
 * Path: users/{userId}/sessions/{date}
 */
export async function writePhoneSession(
  userId: string,
  date: string,
  payload: PhoneSyncPayload,
): Promise<void> {
  const ref = doc(db, 'users', userId, 'sessions', date);
  await setDoc(
    ref,
    {
      userId,
      date,
      deletedAt: null,
      updatedAt: serverTimestamp(),
      phoneMetrics: payload,
    },
    { merge: true },
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// READ — REAL-TIME
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Real-time listener for a user's sessions, newest first.
 * Returns unsubscribe fn — MUST be called on app/component teardown.
 *
 * Uses the composite index: userId ASC + updatedAt DESC
 */
export function subscribeToSessions(
  userId: string,
  onUpdate: (sessions: SessionDocument[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(
    collection(db, 'users', userId, 'sessions'),
    where('userId', '==', userId),
    where('deletedAt', '==', null),
    orderBy('updatedAt', 'desc'),
  );

  return onSnapshot(
    q,
    snap => {
      const sessions = snap.docs.map(d => ({ ...d.data(), date: d.id }) as SessionDocument);
      onUpdate(sessions);
    },
    err => {
      console.error('[api-client] subscribeToSessions error:', err.code, err.message);
      onError?.(err);
    },
  );
}

/**
 * Real-time listener scoped to a single date.
 * Useful for the desktop app dashboard — live updates for today only.
 */
export function subscribeToDate(
  userId: string,
  date: string,          // "2026-04-19"
  onUpdate: (session: SessionDocument | null) => void,
  onError?: (err: Error) => void,
): () => void {
  const ref = doc(db, 'users', userId, 'sessions', date);
  return onSnapshot(
    ref,
    snap => onUpdate(snap.exists() ? (snap.data() as SessionDocument) : null),
    err => {
      console.error('[api-client] subscribeToDate error:', err.code, err.message);
      onError?.(err);
    },
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// READ — ONE-SHOT
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all sessions updated since a given date.
 * Used on startup to hydrate local SQLite from Firestore.
 * Uses the composite index: userId ASC + updatedAt DESC
 */
export async function fetchSessionsSince(
  userId: string,
  since: Date,
): Promise<SessionDocument[]> {
  const q = query(
    collection(db, 'users', userId, 'sessions'),
    where('userId', '==', userId),
    where('updatedAt', '>=', Timestamp.fromDate(since)),
    orderBy('updatedAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ ...d.data(), date: d.id }) as SessionDocument);
}

/**
 * Fetch a single session document by date.
 * Uses a direct document reference (O(1)) instead of a full collection scan.
 */
export async function fetchSessionByDate(
  userId: string,
  date: string,
): Promise<SessionDocument | null> {
  const ref  = doc(db, 'users', userId, 'sessions', date);
  const snap = await getDoc(ref);
  return snap.exists() ? ({ ...snap.data(), date: snap.id } as SessionDocument) : null;
}

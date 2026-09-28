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
 * Using setDoc with merge:true provides field-level atomicity for concurrent
 * writes to different desktopSessions.{deviceId} keys — no transaction needed
 * since each device writes to its own unique field path.
 */
export async function writeDesktopSession(
  userId: string,
  date: string,         // "2026-04-19"
  deviceId: string,
  payload: DesktopSyncPayload,
): Promise<void> {
  // ✔ Correct path: users/{userId}/sessions/{date}
  const ref = doc(db, 'users', userId, 'sessions', date);

  // setDoc with merge:true provides field-level atomicity for concurrent writes
  // to different desktopSessions.{deviceId} keys. No transaction needed since
  // there's no read-modify-write cycle — each device writes to its own field.
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
 *
 * Uses setDoc with merge:true for field-level atomicity (matches writeDesktopSession pattern).
 * This prevents potential field-level conflicts when multiple phones write simultaneously.
 */
export async function writePhoneSession(
  userId: string,
  date: string,
  payload: PhoneSyncPayload,
): Promise<void> {
  const ref = doc(db, 'users', userId, 'sessions', date);

  // setDoc with merge:true provides field-level atomicity. No transaction needed
  // since there's no read-modify-write cycle.
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

/**
 * Fetch a single desktop session payload by date and deviceId.
 * Returns the desktop payload for the given device, or null if not found.
 * Used for conflict resolution during sync.
 * Validates the payload shape to catch malformed data early.
 */
export async function readDesktopSession(
  userId: string,
  date: string,
  deviceId: string,
): Promise<DesktopSyncPayload | null> {
  const session = await fetchSessionByDate(userId, date);
  if (!session || !session.desktopSessions) return null;
  const payload = session.desktopSessions[deviceId] ?? null;
  if (!payload) return null;

  // Validate payload shape — same checks as merge.ts server-side
  if (!payload.hourlyLoad || !Array.isArray(payload.hourlyLoad) || payload.hourlyLoad.length !== 24) {
    console.warn(`[api-client] readDesktopSession: invalid hourlyLoad for ${deviceId}`);
    return null;
  }
  for (let i = 0; i < 24; i++) {
    const val = payload.hourlyLoad[i];
    if (typeof val !== 'number' || Number.isNaN(val)) {
      console.warn(`[api-client] readDesktopSession: invalid hourlyLoad[${i}] for ${deviceId}`);
      return null;
    }
  }
  if (typeof payload.cognitiveLoadPct !== 'number' || Number.isNaN(payload.cognitiveLoadPct)) {
    console.warn(`[api-client] readDesktopSession: invalid cognitiveLoadPct for ${deviceId}`);
    return null;
  }
  if (typeof payload.totalFocusedTime !== 'number' || Number.isNaN(payload.totalFocusedTime)) {
    console.warn(`[api-client] readDesktopSession: invalid totalFocusedTime for ${deviceId}`);
    return null;
  }

  return payload;
}

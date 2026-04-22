"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeDesktopSession = writeDesktopSession;
exports.writePhoneSession = writePhoneSession;
exports.subscribeToSessions = subscribeToSessions;
exports.subscribeToDate = subscribeToDate;
exports.fetchSessionsSince = fetchSessionsSince;
exports.fetchSessionByDate = fetchSessionByDate;
const firestore_1 = require("firebase/firestore");
const firebase_1 = require("./firebase");
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
async function writeDesktopSession(userId, date, // "2026-04-19"
deviceId, payload) {
    // ✔ Correct path: users/{userId}/sessions/{date}
    const ref = (0, firestore_1.doc)(firebase_1.db, 'users', userId, 'sessions', date);
    await (0, firestore_1.setDoc)(ref, {
        userId,
        date,
        deletedAt: null,
        updatedAt: (0, firestore_1.serverTimestamp)(),
        [`desktopSessions.${deviceId}`]: payload,
    }, { merge: true });
}
/**
 * Write a phone sync payload into Firestore.
 * Path: users/{userId}/sessions/{date}
 */
async function writePhoneSession(userId, date, payload) {
    const ref = (0, firestore_1.doc)(firebase_1.db, 'users', userId, 'sessions', date);
    await (0, firestore_1.setDoc)(ref, {
        userId,
        date,
        deletedAt: null,
        updatedAt: (0, firestore_1.serverTimestamp)(),
        phoneMetrics: payload,
    }, { merge: true });
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
function subscribeToSessions(userId, onUpdate, onError) {
    const q = (0, firestore_1.query)((0, firestore_1.collection)(firebase_1.db, 'users', userId, 'sessions'), (0, firestore_1.where)('userId', '==', userId), (0, firestore_1.where)('deletedAt', '==', null), (0, firestore_1.orderBy)('updatedAt', 'desc'));
    return (0, firestore_1.onSnapshot)(q, snap => {
        const sessions = snap.docs.map(d => ({ ...d.data(), date: d.id }));
        onUpdate(sessions);
    }, err => {
        console.error('[api-client] subscribeToSessions error:', err.code, err.message);
        onError?.(err);
    });
}
/**
 * Real-time listener scoped to a single date.
 * Useful for the desktop app dashboard — live updates for today only.
 */
function subscribeToDate(userId, date, // "2026-04-19"
onUpdate, onError) {
    const ref = (0, firestore_1.doc)(firebase_1.db, 'users', userId, 'sessions', date);
    return (0, firestore_1.onSnapshot)(ref, snap => onUpdate(snap.exists() ? snap.data() : null), err => {
        console.error('[api-client] subscribeToDate error:', err.code, err.message);
        onError?.(err);
    });
}
// ──────────────────────────────────────────────────────────────────────────────
// READ — ONE-SHOT
// ──────────────────────────────────────────────────────────────────────────────
/**
 * Fetch all sessions updated since a given date.
 * Used on startup to hydrate local SQLite from Firestore.
 * Uses the composite index: userId ASC + updatedAt DESC
 */
async function fetchSessionsSince(userId, since) {
    const q = (0, firestore_1.query)((0, firestore_1.collection)(firebase_1.db, 'users', userId, 'sessions'), (0, firestore_1.where)('userId', '==', userId), (0, firestore_1.where)('updatedAt', '>=', firestore_1.Timestamp.fromDate(since)), (0, firestore_1.orderBy)('updatedAt', 'desc'));
    const snap = await (0, firestore_1.getDocs)(q);
    return snap.docs.map(d => ({ ...d.data(), date: d.id }));
}
/**
 * Fetch a single session document by date.
 * Uses a direct document reference (O(1)) instead of a full collection scan.
 */
async function fetchSessionByDate(userId, date) {
    const ref = (0, firestore_1.doc)(firebase_1.db, 'users', userId, 'sessions', date);
    const snap = await (0, firestore_1.getDoc)(ref);
    return snap.exists() ? { ...snap.data(), date: snap.id } : null;
}

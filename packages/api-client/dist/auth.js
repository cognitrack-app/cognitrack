"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signIn = signIn;
exports.signUp = signUp;
exports.signOut = signOut;
exports.onAuthChange = onAuthChange;
exports.getCurrentUser = getCurrentUser;
exports.getCurrentUserId = getCurrentUserId;
const auth_1 = require("firebase/auth");
const firebase_1 = require("./firebase");
/**
 * Sign in with email + password.
 * Returns the Firebase User with a stable UID that persists across devices.
 * NOTE: anonymous auth was removed — it produces unstable UIDs that orphan
 * historical data when the user reinstalls or clears app storage.
 */
async function signIn(email, password) {
    const cred = await (0, auth_1.signInWithEmailAndPassword)(firebase_1.auth, email, password);
    return cred.user;
}
/**
 * Create a new account. Used on first launch / onboarding.
 */
async function signUp(email, password) {
    const cred = await (0, auth_1.createUserWithEmailAndPassword)(firebase_1.auth, email, password);
    return cred.user;
}
async function signOut() {
    await (0, auth_1.signOut)(firebase_1.auth);
}
/** Subscribe to auth state changes. Returns the unsubscribe function. */
function onAuthChange(callback) {
    return (0, auth_1.onAuthStateChanged)(firebase_1.auth, callback);
}
/** Returns the current user or null — synchronous. */
function getCurrentUser() {
    return firebase_1.auth.currentUser;
}
/**
 * Returns current user UID.
 * Throws if called before sign-in — deliberate fail-fast.
 */
function getCurrentUserId() {
    const user = firebase_1.auth.currentUser;
    if (!user)
        throw new Error('[api-client] getCurrentUserId() called with no authenticated user');
    return user.uid;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForAuth = waitForAuth;
exports.getTodayDateString = getTodayDateString;
const api_client_1 = require("@cognitrack/api-client");
/**
 * Waits for Firebase Auth to emit a signed-in user and resolves with the UID.
 * Rejects if the auth state resolves to null (user is not signed in).
 *
 * This replaces the old placeholder that returned 'default-user-id'.
 * Called once at app startup in index.ts before anything else runs.
 */
function waitForAuth() {
    return new Promise((resolve, reject) => {
        // onAuthChange fires once immediately with the persisted auth state,
        // then again on any subsequent sign-in/sign-out events.
        const unsub = (0, api_client_1.onAuthChange)(user => {
            unsub(); // unsubscribe after first emission
            if (user) {
                resolve(user.uid);
            }
            else {
                reject(new Error('[auth] No authenticated user — sign in required'));
            }
        });
    });
}
/**
 * Returns today's date as a YYYY-MM-DD string in the local timezone.
 * Used as the Firestore document key and SQLite daily_metrics primary key.
 */
function getTodayDateString() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
//# sourceMappingURL=utils.js.map
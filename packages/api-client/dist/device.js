"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDevice = registerDevice;
exports.getDevice = getDevice;
exports.getDevices = getDevices;
exports.updateDeviceLastSeen = updateDeviceLastSeen;
const firestore_1 = require("firebase/firestore");
const firebase_1 = require("./firebase");
/**
 * Upsert a device record under users/{userId}/devices/{deviceId}.
 * Uses merge:true so calling on every launch is safe.
 *
 * SECURITY: Firestore rules enforce request.auth.uid == userId,
 * so this path is protected — no other user can write to your devices.
 */
async function registerDevice(userId, deviceId, platform, displayName, appVersion) {
    // ✔ Correct path: users/{userId}/devices/{deviceId}
    const ref = (0, firestore_1.doc)(firebase_1.db, 'users', userId, 'devices', deviceId);
    const deviceData = {
        deviceId,
        userId,
        platform,
        displayName,
        appVersion,
        type: platform === 'android' || platform === 'ios' ? 'mobile' : 'desktop',
        registeredAt: (0, firestore_1.serverTimestamp)(),
        lastSeenAt: (0, firestore_1.serverTimestamp)(),
    };
    await (0, firestore_1.setDoc)(ref, deviceData, { merge: true });
    return deviceData;
}
/**
 * Fetch a single device record.
 */
async function getDevice(userId, deviceId) {
    const ref = (0, firestore_1.doc)(firebase_1.db, 'users', userId, 'devices', deviceId);
    const snap = await (0, firestore_1.getDoc)(ref);
    return snap.exists() ? snap.data() : null;
}
/**
 * Fetch all devices registered for a user.
 */
async function getDevices(userId) {
    const snap = await (0, firestore_1.getDocs)((0, firestore_1.collection)(firebase_1.db, 'users', userId, 'devices'));
    return snap.docs.map(d => d.data());
}
/**
 * Update the lastSeenAt timestamp — call on every app launch.
 */
async function updateDeviceLastSeen(userId, deviceId) {
    const ref = (0, firestore_1.doc)(firebase_1.db, 'users', userId, 'devices', deviceId);
    await (0, firestore_1.setDoc)(ref, { lastSeenAt: (0, firestore_1.serverTimestamp)() }, { merge: true });
}

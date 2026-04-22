"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLocalDateString = getLocalDateString;
exports.getLocalHour = getLocalHour;
/**
 * Returns today's date as YYYY-MM-DD in the device's LOCAL timezone.
 * Uses the Swedish locale as a zero-cost way to get ISO format from toLocaleDateString.
 */
function getLocalDateString(date) {
    return (date ?? new Date()).toLocaleDateString('sv-SE');
}
/**
 * Returns the hour (0-23) for a given Unix millisecond timestamp,
 * evaluated in local time.
 */
function getLocalHour(timestampMs) {
    return new Date(timestampMs).getHours();
}

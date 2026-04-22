"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeVelocityMultiplier = computeVelocityMultiplier;
exports.getSwitchVelocity = getSwitchVelocity;
/**
 * Linear penalty for rapid context switching.
 * <= 1 switch/min: no penalty (1.0)
 * >= 4 switches/min: hard cap at crisis mode (2.5)
 * 1–4: linear interpolation
 */
function computeVelocityMultiplier(switchesPerMinute) {
    if (switchesPerMinute <= 1.0)
        return 1.0;
    if (switchesPerMinute >= 4.0)
        return 2.5;
    return 1.0 + (switchesPerMinute - 1.0) * 0.5;
}
/**
 * Compute switch velocity (switches/minute) in the 5-minute window
 * ending at the last event's timestamp.
 */
function getSwitchVelocity(events, windowMs = 5 * 60 * 1000) {
    if (events.length === 0)
        return 0;
    const now = events[events.length - 1].timestamp;
    const windowStart = now - windowMs;
    const recentSwitches = events.filter((e) => e.eventType === 'switch' && e.timestamp >= windowStart).length;
    return recentSwitches / (windowMs / 60000); // per minute
}

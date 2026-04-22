"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeDualDeviceFragmentation = computeDualDeviceFragmentation;
/**
 * Compute dual-device fragmentation score.
 *
 * An hour counts as "dual-active" when:
 *   - phone load > 20%  AND
 *   - desktop load > 30%
 *
 * This detects hours where the user was meaningfully engaged on BOTH
 * devices simultaneously, which is the primary fragmentation signal.
 */
function computeDualDeviceFragmentation(input) {
    const { phoneHourlyDebt, desktopHourlyDebt } = input;
    let dualActiveHours = 0;
    let peakOverlapHour = 0;
    let maxOverlap = 0;
    for (let hour = 0; hour < 24; hour++) {
        const phoneLoad = phoneHourlyDebt[hour] ?? 0;
        const desktopLoad = desktopHourlyDebt[hour] ?? 0;
        if (phoneLoad > 20 && desktopLoad > 30) {
            dualActiveHours++;
            const overlap = phoneLoad + desktopLoad;
            if (overlap > maxOverlap) {
                maxOverlap = overlap;
                peakOverlapHour = hour;
            }
        }
    }
    return {
        score: Math.min(24, dualActiveHours),
        dualActiveHours,
        peakOverlapHour,
    };
}

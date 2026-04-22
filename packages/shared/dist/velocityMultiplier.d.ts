import type { AppEvent } from './types';
/**
 * Linear penalty for rapid context switching.
 * <= 1 switch/min: no penalty (1.0)
 * >= 4 switches/min: hard cap at crisis mode (2.5)
 * 1–4: linear interpolation
 */
export declare function computeVelocityMultiplier(switchesPerMinute: number): number;
/**
 * Compute switch velocity (switches/minute) in the 5-minute window
 * ending at the last event's timestamp.
 */
export declare function getSwitchVelocity(events: AppEvent[], windowMs?: number): number;
//# sourceMappingURL=velocityMultiplier.d.ts.map
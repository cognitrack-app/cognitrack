/**
 * Returns today's date as YYYY-MM-DD in the device's LOCAL timezone.
 * Uses the Swedish locale as a zero-cost way to get ISO format from toLocaleDateString.
 */
export declare function getLocalDateString(date?: Date): string;
/**
 * Returns the hour (0-23) for a given Unix millisecond timestamp,
 * evaluated in local time.
 */
export declare function getLocalHour(timestampMs: number): number;
//# sourceMappingURL=dateUtils.d.ts.map
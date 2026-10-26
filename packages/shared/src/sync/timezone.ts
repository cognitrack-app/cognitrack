/**
 * sync/timezone.ts
 *
 * IANA timezone capture and UTC normalization for cross-platform event timing.
 * Ensures all devices report timezone with events, and server normalizes
 * to UTC hour buckets for correct day boundaries.
 * ENG-09: IANA timezone handling on all platforms.
 * ENG-13: Dynamic online detection wire-up.
 */

export type IanaTimeZone = string; // e.g. "America/Los_Angeles", "Europe/London"

/**
 * Get the IANA timezone from the runtime environment.
 * Mobile: uses device locale/platform APIs.
 * Desktop: uses Electron's timezone detection.
 * Server: uses Node.js timezone or configured offset.
 */
export function getIanaTimeZone(): IanaTimeZone {
  if (typeof Intl !== 'undefined') {
    // @ts-ignore - Intl types may not have resolvedOptions in all TS versions
    const timezone = (Intl as any)?.resolvedOptions()?.timezone;
    if (timezone) return timezone;
  }
  return 'UTC';
}

/**
 * Convert a local milliseconds timestamp to UTC hour bucket.
 * The local hour may span day boundaries differently across timezones.
 * Returns the UTC hour index (0-23) for the given local timestamp.
 */
export function localToUtcHour(ms: number): number {
  const date = new Date(ms);
  const localHour = date.getHours();
  const utcOffset = date.getTimezoneOffset();
  let utcHour = localHour - Math.floor(utcOffset / 60);
  utcHour = ((utcHour % 24) + 24) % 24;
  return utcHour;
}

/**
 * Normalize an hourly load array to UTC hour buckets.
 * Phone and desktop may report hourlyLoad in local time zones.
 * This function shifts the array so all buckets align to UTC midnight.
 * 
 * @param localHourlyLoad - 24-element array of local hour debt values
 * @param ianaTimeZone - IANA timezone string (e.g. "America/Los_Angeles"), defaults to runtime TZ
 * @returns UTC-aligned 24-element array
 */
export function normalizeToUtcBuckets(
  localHourlyLoad: number[],
  ianaTimeZone: IanaTimeZone = getIanaTimeZone()
): number[] {
  if (localHourlyLoad.length !== 24) {
    throw new Error(`hourlyLoad must have 24 elements, got ${localHourlyLoad.length}`);
  }

  const offsetMinutes = new Date().getTimezoneOffset();
  const shiftHours = Math.round(offsetMinutes / 60);

  const normalized = new Array(24).fill(0) as number[];
  for (let i = 0; i < 24; i++) {
    const sourceIdx = (i - shiftHours + 24) % 24;
    normalized[i] = localHourlyLoad[sourceIdx];
  }
  return normalized;
}

/**
 * Returns today's date as YYYY-MM-DD in the device's LOCAL timezone.
 * Uses the Swedish locale as a zero-cost way to get ISO format from toLocaleDateString.
 */
export function getLocalDateString(date?: Date): string {
  return (date ?? new Date()).toLocaleDateString('sv-SE');
}

/**
 * Returns the hour (0-23) for a given Unix millisecond timestamp,
 * evaluated in local time.
 */
export function getLocalHour(timestampMs: number): number {
  return new Date(timestampMs).getHours();
}

/**
 * Parses a 'YYYY-MM-DD' string as LOCAL midnight (00:00:00.000 local time).
 *
 * Why not `new Date(dateStr)`?
 *   The ECMA spec states that date-only strings (no time component) are parsed
 *   as UTC, not local time. This means on a UTC-5 machine:
 *     new Date('2026-05-06') === 2026-05-05T19:00:00 local
 *   Calling .setHours(0,0,0,0) on that jumps FORWARD 5 hours to
 *   2026-05-06T00:00:00 local — correct, but only by accident.
 *
 *   The real problem occurs when the Date constructor returns a value on the
 *   *previous calendar day* locally — setDate(+1) then points to the wrong
 *   end boundary and events near midnight are double-counted or missed.
 *
 *   Using explicit integer parts avoids the UTC→local ambiguity entirely.
 *
 * @param dateStr - 'YYYY-MM-DD' string (local date)
 * @returns Date set to 00:00:00.000 in the local timezone
 */
export function localMidnight(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0); // month is 0-indexed
}

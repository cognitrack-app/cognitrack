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

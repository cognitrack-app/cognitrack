import type { AppEvent, BreakEvent } from '@cognitrack/shared';

/** Minimum continuous idle duration to count as a trackable break. */
const MIN_BREAK_MS = 5 * 60_000; // 5 minutes

/**
 * Extracts BreakEvent[] from a sorted day's AppEvent array.
 *
 * Algorithm:
 *  - An `idle` event marks the START of a break (one idle per session after
 *    the isIdle guard in activeWindowTracker.ts).
 *  - The break ends when the next `switch` event arrives, or at Date.now()
 *    if no further switch is recorded (user went offline for the evening).
 *  - Breaks shorter than 5 minutes are dropped (micro-pauses, not breaks).
 *  - `debt_before` / `debt_after` are taken from the hourlyDebt array produced
 *    by calculateCognitiveDebt(), using the hour bucket of the break start/end.
 *  - Activity type is classified by duration:
 *      IDLE       →  5–19 min  (unintentional short idle)
 *      STRUCTURED → 20–479 min (deliberate break or lunch)
 *      SLEEP      → 480+ min   (overnight / nap ≥ 8 h)
 *
 * @param events        Sorted (ascending timestamp) AppEvent[] for one day.
 * @param hourlyDebtPct 24-element normalised debt array (0–100) from CognitiveReport.
 * @returns BreakEvent[] ready for insertion into DesktopSyncPayload.break_events.
 */
export function extractBreakEvents(
  events: AppEvent[],
  hourlyDebtPct: number[],
): BreakEvent[] {
  const breaks: BreakEvent[] = [];

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.eventType !== 'idle') continue;

    // Find the first switch event that comes AFTER this idle marker.
    const nextSwitch = events.slice(i + 1).find(x => x.eventType === 'switch');

    // If there is no subsequent switch event (user went offline for the evening),
    // fall back to Date.now(). The batch always runs while the app is live so
    // Date.now() correctly captures the break duration up to the point of
    // measurement. Using e.timestamp would give durationMs=0, silently dropping
    // the user's final (and often longest) break of the day.
    const endTs      = nextSwitch?.timestamp ?? Date.now();
    const durationMs = endTs - e.timestamp;

    // Drop micro-pauses (< 5 min) — brief attention shifts, not real breaks.
    if (durationMs < MIN_BREAK_MS) continue;

    const startHour = new Date(e.timestamp).getHours();
    const endHour   = new Date(endTs).getHours();

    const debtBefore   = hourlyDebtPct[startHour] ?? 0;
    const debtAfter    = hourlyDebtPct[endHour]   ?? 0;
    const ptsRecovered = Math.max(0, debtBefore - debtAfter);
    const durationMin  = Math.round(durationMs / 60_000);

    const activityType: BreakEvent['activity_type'] =
      durationMin >= 480 ? 'SLEEP'       // ≥ 8 h
      : durationMin >= 20 ? 'STRUCTURED'  // 20–479 min
      : 'IDLE';                           // 5–19 min

    breaks.push({
      start_time:       new Date(e.timestamp).toISOString(),
      end_time:         new Date(endTs).toISOString(),
      activity_type:    activityType,
      duration_minutes: durationMin,
      debt_before:      debtBefore,
      debt_after:       debtAfter,
      pts_recovered:    Math.round(ptsRecovered * 10) / 10,
      efficiency_pct:   debtBefore > 0
        ? Math.min(100, Math.round((ptsRecovered / debtBefore) * 100))
        : 0,
    });
  }

  return breaks;
}

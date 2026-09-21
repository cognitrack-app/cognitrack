import type { Category, CategoryBreakdown, DesktopCategoryBreakdown, BreakActivityType } from './types';
import { FIVE_MIN_MS } from './constants';

/**
 * Category breakdown calculation shared between desktop and mobile.
 * Uses floor for first 4 categories, lets passiveWaste absorb remainder
 * so the sum is always exactly 100.
 */
export function computeCategoryBreakdown(
  durationByCategory: Record<string, number>,
  totalDuration: number
): CategoryBreakdown {
  if (totalDuration === 0) {
    return {
      productive: 0,
      entertainment: 0,
      social: 0,
      passiveWaste: 0,
    };
  }

  const rawPct = (ms: number) => (ms / totalDuration) * 100;

  const _productive = Math.floor(rawPct(durationByCategory['productive'] ?? 0));
  const _entertainment = Math.floor(rawPct(durationByCategory['entertainment'] ?? 0));
  const _social = Math.floor(rawPct(durationByCategory['social'] ?? 0));
  const _passiveWaste = Math.floor(rawPct(durationByCategory['passiveWaste'] ?? 0));

  return {
    productive: _productive,
    entertainment: _entertainment,
    social: _social,
    passiveWaste: 100 - _productive - _entertainment - _social - _passiveWaste,
  };
}

/**
 * Desktop category breakdown with 5 categories (includes tools).
 */
export function computeDesktopCategoryBreakdown(
  durationByCategory: Record<string, number>,
  totalDuration: number
): DesktopCategoryBreakdown {
  if (totalDuration === 0) {
    return {
      productive: 0,
      tools: 0,
      entertainment: 0,
      social: 0,
      passiveWaste: 0,
    };
  }

  const rawPct = (ms: number) => (ms / totalDuration) * 100;

  const _productive = Math.floor(rawPct(durationByCategory['productive'] ?? 0));
  const _tools = Math.floor(rawPct(durationByCategory['tools'] ?? 0));
  const _social = Math.floor(rawPct(durationByCategory['social'] ?? 0));
  const _entertainment = Math.floor(rawPct(durationByCategory['entertainment'] ?? 0));

  return {
    productive: _productive,
    tools: _tools,
    social: _social,
    entertainment: _entertainment,
    passiveWaste: 100 - _productive - _tools - _social - _entertainment,
  };
}

/**
 * Compute switch velocity peak using O(n) two-pointer 5-minute sliding window.
 * Returns switches per minute in the busiest 5-minute window.
 */
export function computeSwitchVelocityPeak(switchTimestamps: number[]): number {
  if (switchTimestamps.length === 0) return 0;

  let peak = 0;
  let left = 0;

  for (let right = 0; right < switchTimestamps.length; right++) {
    const windowStart = switchTimestamps[right] - FIVE_MIN_MS;
    while ((switchTimestamps[left] ?? 0) < windowStart) left++;
    const rate = (right - left + 1) / 5; // switches per minute
    if (rate > peak) peak = rate;
  }

  return peak;
}

export interface BreakEventInput {
  startTime: number;      // Unix ms
  endTime: number;        // Unix ms
  hourlyDebtPct: number[]; // 24-element array
}

export interface BreakEventOutput {
  start_time: string;
  end_time: string;
  activity_type: BreakActivityType;
  duration_minutes: number;
  debt_before: number;
  debt_after: number;
  pts_recovered: number;
  efficiency_pct: number;
}

/**
 * Break classification thresholds (in minutes).
 */
export const BREAK_CLASSIFICATION = {
  MIN_BREAK_MIN: 5,        // Minimum break duration to track
  STRUCTURED_MIN: 20,      // Deliberate break / lunch
  SLEEP_MIN: 480,          // Overnight / nap ≥ 8 hours
} as const;

/**
 * Extract break events from a day's event stream.
 * Used by both desktop (batchProcessor) and mobile (syncEngine).
 */
export function extractBreakEvents(
  events: { eventType: string; timestamp: number }[],
  hourlyDebtPct: number[],
  getLastEventTimestamp: () => number
): BreakEventOutput[] {
  const breaks: BreakEventOutput[] = [];

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.eventType !== 'idle') continue;

    // Find the first switch event after this idle marker.
    let nextSwitch: { timestamp: number } | null = null;
    for (let j = i + 1; j < events.length; j++) {
      if (events[j].eventType === 'switch') {
        nextSwitch = events[j];
        break;
      }
    }

    // If no subsequent switch, fall back to the last event's timestamp.
    const endTs = nextSwitch?.timestamp ?? getLastEventTimestamp();
    const durationMs = endTs - e.timestamp;

    // Drop micro-pauses (< 5 min).
    if (durationMs < BREAK_CLASSIFICATION.MIN_BREAK_MIN * 60_000) continue;

    const startHour = new Date(e.timestamp).getHours();
    const endHour = new Date(endTs).getHours();

    const debtBefore = hourlyDebtPct[startHour] ?? 0;
    const debtAfter = hourlyDebtPct[endHour] ?? 0;
    const ptsRecovered = Math.max(0, debtBefore - debtAfter);

    const durationMin = Math.round(durationMs / 60_000);

    let activityType: BreakActivityType;
    if (durationMin >= BREAK_CLASSIFICATION.SLEEP_MIN) {
      activityType = 'SLEEP';
    } else if (durationMin >= BREAK_CLASSIFICATION.STRUCTURED_MIN) {
      activityType = 'STRUCTURED';
    } else {
      activityType = 'IDLE';
    }

    const efficiencyPct = debtBefore > 0
      ? Math.min(100, Math.round((ptsRecovered / debtBefore) * 100))
      : 0;

    breaks.push({
      start_time: new Date(e.timestamp).toISOString(),
      end_time: new Date(endTs).toISOString(),
      activity_type: activityType,
      duration_minutes: durationMin,
      debt_before: debtBefore,
      debt_after: debtAfter,
      pts_recovered: Math.round(ptsRecovered * 10) / 10,
      efficiency_pct: efficiencyPct,
    });
  }

  return breaks;
}
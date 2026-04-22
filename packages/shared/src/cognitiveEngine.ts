import type { AppEvent, Category, CognitiveReport, CognitiveState } from './types';
import {
  CONTEXT_DISTANCE,
  DAILY_DEBT_THRESHOLD,
  FOCUS_BUILD_THRESHOLD_MS,
  FOCUS_DEPTH_GAIN,
  FOCUS_DEPTH_MAX,
  HOURLY_DEBT_THRESHOLD,
  WM_BREAK_GAIN,
  WM_FLOOR,
  WM_FOCUS_GAIN,
  WM_INITIAL,
  WM_SWITCH_COST,
} from './constants';
import { decayResidue, applySwitch } from './residueDecay';
import { computeVelocityMultiplier } from './velocityMultiplier';
import { getLocalHour } from './dateUtils';

// ─── Working Memory helper ───────────────────────────────────────────────────
export function updateWorkingMemory(
  currentWM: number,
  switchCost: number,
  isBreak: boolean,
  isSustainedFocus: boolean
): number {
  let wm = currentWM;
  if (isBreak) wm += WM_BREAK_GAIN;
  if (isSustainedFocus) wm += WM_FOCUS_GAIN;
  if (switchCost > 0) wm -= switchCost * WM_SWITCH_COST;
  return Math.min(WM_INITIAL, Math.max(WM_FLOOR, Math.round(wm)));
}

// ─── Focus Depth helper ─────────────────────────────────────────────────────
export function updateFocusDepth(
  currentDepth: number,
  msSinceLastSwitch: number,
  category: Category
): number {
  if (category !== 'productive' && category !== 'tools') return 0;
  if (msSinceLastSwitch < FOCUS_BUILD_THRESHOLD_MS) return currentDepth;
  return Math.min(FOCUS_DEPTH_MAX, currentDepth + FOCUS_DEPTH_GAIN);
}

// ─── Main Cognitive Engine ──────────────────────────────────────────────────

/**
 * Run the full cognitive state machine over a day's worth of AppEvents.
 *
 * Events MUST be for a single day and single device.
 * Returns a CognitiveReport suitable for Firestore sync.
 */
export function calculateCognitiveDebt(events: AppEvent[]): CognitiveReport {
  if (events.length === 0) {
    return {
      cognitiveDebt: 0,
      cognitiveLoadPct: 0,
      wmCapacityRemaining: WM_INITIAL,
      residueAtEOD: 0,
      hourlyDebt: Array(24).fill(0) as number[],
      peakLoadHour: 0,
    };
  }

  // Sort ascending by timestamp (defensive; callers should pre-sort)
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  const startTs = sorted[0]!.timestamp;

  const state: CognitiveState = {
    wm_capacity: WM_INITIAL,
    residue: 0,
    focus_depth: 0,
    last_switch_ts: startTs,
    last_residue_decay_ts: startTs,
  };

  let lastCategory: Category | null = null;
  let totalDebt = 0;

  // Raw debt accumulated per hour (index = 0–23)
  const hourlyRaw: number[] = Array(24).fill(0) as number[];

  // Switch velocity window: keep last 5-min switch timestamps
  const recentSwitchTs: number[] = [];

  for (const event of sorted) {
    const hour = getLocalHour(event.timestamp);

    if (event.eventType === 'switch') {
      const timeSinceLast = event.timestamp - state.last_switch_ts;

      // 1. Decay existing residue
      state.residue = decayResidue(state.residue, timeSinceLast);

      // 2. Context distance (switch cost)
      const switchCost: number =
        lastCategory !== null
          ? (CONTEXT_DISTANCE[lastCategory]?.[event.category] ?? 1.0)
          : 1.0;

      // 3. Velocity multiplier (count switches in last 5 min)
      const fiveMinAgo = event.timestamp - 5 * 60_000;
      // Prune old entries from rolling window
      while (recentSwitchTs.length > 0 && recentSwitchTs[0]! < fiveMinAgo) {
        recentSwitchTs.shift();
      }
      recentSwitchTs.push(event.timestamp);
      const switchesPerMin = recentSwitchTs.length / 5;
      const velocityMult = computeVelocityMultiplier(switchesPerMin);

      // 4. Adjusted switch cost
      const adjustedCost = switchCost * velocityMult;

      // 5. Stack new residue on top of decayed old residue
      state.residue = applySwitch(state.residue, timeSinceLast, switchCost);

      // 6. Deplete working memory
      state.wm_capacity = updateWorkingMemory(
        state.wm_capacity,
        adjustedCost,
        false,
        false
      );

      // 7. Reset focus depth on any switch
      state.focus_depth = 0;

      // 8. Compute debt contribution: cost amplified by residue
      const debtContribution = adjustedCost * (1 + state.residue);
      totalDebt += debtContribution;
      hourlyRaw[hour] = (hourlyRaw[hour] ?? 0) + debtContribution;

      // 9. Update state
      state.last_switch_ts = event.timestamp;
      state.last_residue_decay_ts = event.timestamp;
      lastCategory = event.category;

    } else if (event.eventType === 'break' || event.eventType === 'idle') {
      // Reward verified break
      state.wm_capacity = updateWorkingMemory(
        state.wm_capacity,
        0,
        true,
        false
      );
      state.focus_depth = 0;
      lastCategory = null;
      // Reset velocity window after a real break
      recentSwitchTs.length = 0;

    } else {
      // eventType === 'pickup' or uninterrupted active time
      // Check for sustained focus reward
      const msSinceLast = event.timestamp - state.last_switch_ts;
      if (msSinceLast >= FOCUS_BUILD_THRESHOLD_MS && lastCategory !== null) {
        state.focus_depth = updateFocusDepth(
          state.focus_depth,
          msSinceLast,
          lastCategory
        );
        if (state.focus_depth > 0) {
          state.wm_capacity = updateWorkingMemory(
            state.wm_capacity,
            0,
            false,
            true
          );
        }
      }
    }
  }

  // ─── Normalise to 0-100 per hour ────────────────────────────────────────
  const hourlyDebt: number[] = hourlyRaw.map((raw) =>
    Math.min(100, Math.round((raw / HOURLY_DEBT_THRESHOLD) * 100))
  );

  // Peak hour = hour with highest normalised load
  const peakLoadHour = hourlyDebt.reduce(
    (maxIdx, val, idx, arr) => (val > (arr[maxIdx] ?? 0) ? idx : maxIdx),
    0
  );

  const cognitiveLoadPct = Math.min(
    100,
    Math.round((totalDebt / DAILY_DEBT_THRESHOLD) * 100)
  );

  return {
    cognitiveDebt: Math.round(totalDebt * 10) / 10,
    cognitiveLoadPct,
    wmCapacityRemaining: state.wm_capacity,
    residueAtEOD: Math.round(state.residue * 1000) / 1000,
    hourlyDebt,
    peakLoadHour,
  };
}

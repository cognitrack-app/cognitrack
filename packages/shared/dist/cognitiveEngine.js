"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateWorkingMemory = updateWorkingMemory;
exports.updateFocusDepth = updateFocusDepth;
exports.calculateCognitiveDebt = calculateCognitiveDebt;
const constants_1 = require("./constants");
const residueDecay_1 = require("./residueDecay");
const velocityMultiplier_1 = require("./velocityMultiplier");
const dateUtils_1 = require("./dateUtils");
// ─── Working Memory helper ───────────────────────────────────────────────────
function updateWorkingMemory(currentWM, switchCost, isBreak, isSustainedFocus) {
    let wm = currentWM;
    if (isBreak)
        wm += constants_1.WM_BREAK_GAIN;
    if (isSustainedFocus)
        wm += constants_1.WM_FOCUS_GAIN;
    if (switchCost > 0)
        wm -= switchCost * constants_1.WM_SWITCH_COST;
    return Math.min(constants_1.WM_INITIAL, Math.max(constants_1.WM_FLOOR, Math.round(wm)));
}
// ─── Focus Depth helper ─────────────────────────────────────────────────────
function updateFocusDepth(currentDepth, msSinceLastSwitch, category) {
    if (category !== 'productive' && category !== 'tools')
        return 0;
    if (msSinceLastSwitch < constants_1.FOCUS_BUILD_THRESHOLD_MS)
        return currentDepth;
    return Math.min(constants_1.FOCUS_DEPTH_MAX, currentDepth + constants_1.FOCUS_DEPTH_GAIN);
}
// ─── Main Cognitive Engine ──────────────────────────────────────────────────
/**
 * Run the full cognitive state machine over a day's worth of AppEvents.
 *
 * Events MUST be for a single day and single device.
 * Returns a CognitiveReport suitable for Firestore sync.
 */
function calculateCognitiveDebt(events) {
    if (events.length === 0) {
        return {
            cognitiveDebt: 0,
            cognitiveLoadPct: 0,
            wmCapacityRemaining: constants_1.WM_INITIAL,
            residueAtEOD: 0,
            hourlyDebt: Array(24).fill(0),
            peakLoadHour: 0,
        };
    }
    // Sort ascending by timestamp (defensive; callers should pre-sort)
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    const startTs = sorted[0].timestamp;
    const state = {
        wm_capacity: constants_1.WM_INITIAL,
        residue: 0,
        focus_depth: 0,
        last_switch_ts: startTs,
        last_residue_decay_ts: startTs,
    };
    let lastCategory = null;
    let totalDebt = 0;
    // Raw debt accumulated per hour (index = 0–23)
    const hourlyRaw = Array(24).fill(0);
    // Switch velocity window: keep last 5-min switch timestamps
    const recentSwitchTs = [];
    for (const event of sorted) {
        const hour = (0, dateUtils_1.getLocalHour)(event.timestamp);
        if (event.eventType === 'switch') {
            const timeSinceLast = event.timestamp - state.last_switch_ts;
            // 1. Decay existing residue
            state.residue = (0, residueDecay_1.decayResidue)(state.residue, timeSinceLast);
            // 2. Context distance (switch cost)
            const switchCost = lastCategory !== null
                ? (constants_1.CONTEXT_DISTANCE[lastCategory]?.[event.category] ?? 1.0)
                : 1.0;
            // 3. Velocity multiplier (count switches in last 5 min)
            const fiveMinAgo = event.timestamp - 5 * 60000;
            // Prune old entries from rolling window
            while (recentSwitchTs.length > 0 && recentSwitchTs[0] < fiveMinAgo) {
                recentSwitchTs.shift();
            }
            recentSwitchTs.push(event.timestamp);
            const switchesPerMin = recentSwitchTs.length / 5;
            const velocityMult = (0, velocityMultiplier_1.computeVelocityMultiplier)(switchesPerMin);
            // 4. Adjusted switch cost
            const adjustedCost = switchCost * velocityMult;
            // 5. Stack new residue on top of decayed old residue
            state.residue = (0, residueDecay_1.applySwitch)(state.residue, timeSinceLast, switchCost);
            // 6. Deplete working memory
            state.wm_capacity = updateWorkingMemory(state.wm_capacity, adjustedCost, false, false);
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
        }
        else if (event.eventType === 'break' || event.eventType === 'idle') {
            // Reward verified break
            state.wm_capacity = updateWorkingMemory(state.wm_capacity, 0, true, false);
            state.focus_depth = 0;
            lastCategory = null;
            // Reset velocity window after a real break
            recentSwitchTs.length = 0;
        }
        else {
            // eventType === 'pickup' or uninterrupted active time
            // Check for sustained focus reward
            const msSinceLast = event.timestamp - state.last_switch_ts;
            if (msSinceLast >= constants_1.FOCUS_BUILD_THRESHOLD_MS && lastCategory !== null) {
                state.focus_depth = updateFocusDepth(state.focus_depth, msSinceLast, lastCategory);
                if (state.focus_depth > 0) {
                    state.wm_capacity = updateWorkingMemory(state.wm_capacity, 0, false, true);
                }
            }
        }
    }
    // ─── Normalise to 0-100 per hour ────────────────────────────────────────
    const hourlyDebt = hourlyRaw.map((raw) => Math.min(100, Math.round((raw / constants_1.HOURLY_DEBT_THRESHOLD) * 100)));
    // Peak hour = hour with highest normalised load
    const peakLoadHour = hourlyDebt.reduce((maxIdx, val, idx, arr) => (val > (arr[maxIdx] ?? 0) ? idx : maxIdx), 0);
    const cognitiveLoadPct = Math.min(100, Math.round((totalDebt / constants_1.DAILY_DEBT_THRESHOLD) * 100));
    return {
        cognitiveDebt: Math.round(totalDebt * 10) / 10,
        cognitiveLoadPct,
        wmCapacityRemaining: state.wm_capacity,
        residueAtEOD: Math.round(state.residue * 1000) / 1000,
        hourlyDebt,
        peakLoadHour,
    };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTEXT_DISTANCE = exports.HOURLY_DEBT_THRESHOLD = exports.DAILY_DEBT_THRESHOLD = exports.CROSS_DEVICE_MULTIPLIER = exports.TAU_MS = exports.FOCUS_DEPTH_MAX = exports.FOCUS_DEPTH_GAIN = exports.FOCUS_BUILD_THRESHOLD_MS = exports.WM_SWITCH_COST = exports.WM_BREAK_GAIN = exports.WM_FOCUS_GAIN = exports.WM_FLOOR = exports.WM_INITIAL = void 0;
// ─── Working Memory ────────────────────────────────────────────────────────────
exports.WM_INITIAL = 100;
exports.WM_FLOOR = 15; // Never fully depletes
exports.WM_FOCUS_GAIN = 6; // Per 5-min uninterrupted productive session
exports.WM_BREAK_GAIN = 14; // Per verified break (idle + non-work category)
exports.WM_SWITCH_COST = 0.15; // Proportional to switch cost
// ─── Focus Depth ───────────────────────────────────────────────────────────────
exports.FOCUS_BUILD_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes in ms
exports.FOCUS_DEPTH_GAIN = 2; // Per 5-min productive window
exports.FOCUS_DEPTH_MAX = 30;
// ─── Residue Decay ─────────────────────────────────────────────────────────────
// Fitted to 23-minute recovery window (Sophie Leroy, 2009)
exports.TAU_MS = 7.67 * 60 * 1000; // 460,200 ms
// ─── Cross-Device Multiplier ───────────────────────────────────────────────────
exports.CROSS_DEVICE_MULTIPLIER = 2.2;
// ─── Normalisation Thresholds ──────────────────────────────────────────────────
// Empirically: a very heavy day = ~500 raw debt units => 100% load
exports.DAILY_DEBT_THRESHOLD = 500;
// Per-hour: a very heavy hour = ~40 raw debt units => 100%
exports.HOURLY_DEBT_THRESHOLD = 40;
// ─── Context Distance Matrix (Asymmetric) ──────────────────────────────────────
// FROM category (row) → TO category (col)
// Research: Pettigrew & Martin 2016; Leroy 2009
exports.CONTEXT_DISTANCE = {
    productive: {
        productive: 1.0, // VSCode→Notion: shared mental model
        tools: 1.5, // VSCode→Slack: work-related, moderate
        social: 6.0, // VSCode→Instagram: high stimulus contrast
        entertainment: 5.0, // VSCode→YouTube
        passiveWaste: 7.0, // VSCode→TikTok: maximum contrast
    },
    social: {
        productive: 8.0, // Instagram→VSCode: dopamine crash + WM reload
        tools: 5.0,
        social: 2.0,
        entertainment: 2.5,
        passiveWaste: 1.5,
    },
    entertainment: {
        productive: 7.0,
        tools: 4.5,
        social: 2.0,
        entertainment: 1.5,
        passiveWaste: 1.0,
    },
    passiveWaste: {
        productive: 9.0, // TikTok→VSCode: hardest re-entry
        tools: 6.0,
        social: 1.5,
        entertainment: 1.0,
        passiveWaste: 1.0,
    },
    tools: {
        productive: 2.0,
        tools: 1.5,
        social: 5.0,
        entertainment: 4.0,
        passiveWaste: 6.0,
    },
};

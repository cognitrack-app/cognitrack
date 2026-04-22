import type { Category } from './types';

// ─── Working Memory ────────────────────────────────────────────────────────────
export const WM_INITIAL = 100;
export const WM_FLOOR = 15;       // Never fully depletes
export const WM_FOCUS_GAIN = 6;   // Per 5-min uninterrupted productive session
export const WM_BREAK_GAIN = 14;  // Per verified break (idle + non-work category)
export const WM_SWITCH_COST = 0.15; // Proportional to switch cost

// ─── Focus Depth ───────────────────────────────────────────────────────────────
export const FOCUS_BUILD_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes in ms
export const FOCUS_DEPTH_GAIN = 2;                      // Per 5-min productive window
export const FOCUS_DEPTH_MAX = 30;

// ─── Residue Decay ─────────────────────────────────────────────────────────────
// Fitted to 23-minute recovery window (Sophie Leroy, 2009)
export const TAU_MS = 7.67 * 60 * 1000; // 460,200 ms

// ─── Cross-Device Multiplier ───────────────────────────────────────────────────
export const CROSS_DEVICE_MULTIPLIER = 2.2;

// ─── Normalisation Thresholds ──────────────────────────────────────────────────
// Empirically: a very heavy day = ~500 raw debt units => 100% load
export const DAILY_DEBT_THRESHOLD = 500;
// Per-hour: a very heavy hour = ~40 raw debt units => 100%
export const HOURLY_DEBT_THRESHOLD = 40;

// ─── Context Distance Matrix (Asymmetric) ──────────────────────────────────────
// FROM category (row) → TO category (col)
// Research: Pettigrew & Martin 2016; Leroy 2009
export const CONTEXT_DISTANCE: Record<Category, Record<Category, number>> = {
  productive: {
    productive:    1.0,  // VSCode→Notion: shared mental model
    tools:         1.5,  // VSCode→Slack: work-related, moderate
    social:        6.0,  // VSCode→Instagram: high stimulus contrast
    entertainment: 5.0,  // VSCode→YouTube
    passiveWaste:  7.0,  // VSCode→TikTok: maximum contrast
  },
  social: {
    productive:    8.0,  // Instagram→VSCode: dopamine crash + WM reload
    tools:         5.0,
    social:        2.0,
    entertainment: 2.5,
    passiveWaste:  1.5,
  },
  entertainment: {
    productive:    7.0,
    tools:         4.5,
    social:        2.0,
    entertainment: 1.5,
    passiveWaste:  1.0,
  },
  passiveWaste: {
    productive:    9.0,  // TikTok→VSCode: hardest re-entry
    tools:         6.0,
    social:        1.5,
    entertainment: 1.0,
    passiveWaste:  1.0,
  },
  tools: {
    productive:    2.0,
    tools:         1.5,
    social:        5.0,
    entertainment: 4.0,
    passiveWaste:  6.0,
  },
};

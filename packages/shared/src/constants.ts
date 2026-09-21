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

// ─── Pickup Penalty ──────────────────────────────────────────────────────────────
export const PICKUP_PENALTY = 3.5;

// ─── Normalisation Thresholds ──────────────────────────────────────────────────
// Empirically: a very heavy day = ~500 raw debt units => 100% load
export const DAILY_DEBT_THRESHOLD = 500;
// Per-hour: a very heavy hour = ~40 raw debt units => 100%
export const HOURLY_DEBT_THRESHOLD = 40;

// ─── Sync Payload Schema Version ─────────────────────────────────────────────────
// Increment when payload structure changes in a backward-incompatible way.
// v1: Initial release
// v2: Added break_events, 5-category breakdown (tools), cross-device multiplier parity
export const SYNC_PAYLOAD_SCHEMA_VERSION = 2;

// ─── Shared Timing Constants ─────────────────────────────────────────────────────
// 5-minute window for velocity calculation and break detection
export const FIVE_MIN_MS = 5 * 60 * 1000; // 300,000 ms
// 7-day TTL for local event storage
export const TTL_SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000; // 604,800,000 ms
// Base backoff for sync retry (30 seconds)
export const BACKOFF_BASE_MS = 30 * 1000; // 30,000 ms
// Velocity multiplier cap at 4 switches/min
export const VELOCITY_CAP_SWITCHES_PER_MIN = 4;

// ─── Break Classification Thresholds ────────────────────────────────────────────
// Minimum break duration to track (5 minutes)
export const MIN_BREAK_MS = FIVE_MIN_MS;
// Structured break threshold (20 minutes)
export const STRUCTURED_BREAK_MIN = 20;
// Sleep/overnight break threshold (8 hours = 480 minutes)
export const SLEEP_BREAK_MIN = 480;

// ─── Adaptive Sync Configuration (Desktop) ──────────────────────────────────────
// Desktop sync runs on a timer with adaptive interval based on cognitive state changes.
// Floor: minimum interval between syncs (15 min) — prevents battery drain
// Ceiling: maximum interval (60 min) — ensures data freshness for merge
// Triggers: sync immediately if cognitive load delta > 15% OR velocity delta > 2.0 switches/min
export const ADAPTIVE_SYNC_MIN_INTERVAL_MS = 15 * 60 * 1000;     // 15 min = 900,000 ms
export const ADAPTIVE_SYNC_MAX_INTERVAL_MS = 60 * 60 * 1000;     // 60 min = 3,600,000 ms
export const ADAPTIVE_SYNC_LOAD_DELTA_THRESHOLD_PCT = 15;        // % cognitive load change
export const ADAPTIVE_SYNC_VELOCITY_DELTA_THRESHOLD = 2.0;       // switches/min change
export const ADAPTIVE_SYNC_JITTER_MS = 5 * 60 * 1000;            // ±5 min thundering-herd avoidance

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
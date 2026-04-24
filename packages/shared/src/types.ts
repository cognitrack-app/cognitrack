export type Category =
  | 'productive'
  | 'tools'
  | 'social'
  | 'entertainment'
  | 'passiveWaste';

export type Platform = 'darwin' | 'win32' | 'android' | 'ios';
export type DeviceType = 'phone' | 'desktop';

export interface AppEvent {
  id: string;
  timestamp: number;       // Unix ms
  appId: string;           // canonical app ID e.g. "win.vscode"
  category: Category;
  durationMs: number;
  eventType: 'switch' | 'pickup' | 'break' | 'idle';
  deviceType: DeviceType;
}

export interface CognitiveState {
  wm_capacity: number;            // Working memory [0-100]
  residue: number;                // Attention residue [0-1]
  focus_depth: number;            // Accumulated deep focus [0-30]
  last_switch_ts: number;         // Timestamp of last context switch (ms)
  last_residue_decay_ts: number;  // For exponential decay calculation (ms)
}

export interface CognitiveReport {
  cognitiveDebt: number;          // Raw accumulated debt (unitless)
  cognitiveLoadPct: number;       // Normalised 0-100
  wmCapacityRemaining: number;    // Working memory remaining [0-100]
  residueAtEOD: number;           // Residue at end of day [0-1]
  hourlyDebt: number[];           // 24-element array, each 0-100
  peakLoadHour: number;           // Hour index 0-23
}

export interface CategoryBreakdown {
  productive: number;
  entertainment: number;
  social: number;
  passiveWaste: number;
}

export interface DesktopCategoryBreakdown extends CategoryBreakdown {
  tools: number;
}

// ─── Break Event ─────────────────────────────────────────────────────────────
// Detected from idle events > 5 min during the local agent pass.
// Persisted BEFORE aggregation so recovery metrics can use per-break data.
export type BreakActivityType =
  | 'STRUCTURED'
  | 'UNSTRUCTURED'
  | 'NEURAL_BREATHWORK'
  | 'SLEEP'
  | 'IDLE';

export interface BreakEvent {
  start_time: string;         // ISO timestamp
  end_time: string;           // ISO timestamp
  activity_type: BreakActivityType;
  duration_minutes: number;
  debt_before: number;        // cognitiveLoadPct snapshot before break
  debt_after: number;         // cognitiveLoadPct snapshot after break
  pts_recovered: number;      // raw debt units recovered
  efficiency_pct: number;     // pts_recovered / expected_recovery * 100
}

// ─── Switch Breach ────────────────────────────────────────────────────────────
// An hour-bucket where switch velocity exceeded the user's critical threshold.
export interface SwitchBreach {
  hour: number;               // 0–23
  velocity: number;           // switches/min in that hour
  is_breach: boolean;
}

// ─── Phone Sync Payload ───────────────────────────────────────────────────────
export interface PhoneSyncPayload {
  date: string;                   // YYYY-MM-DD
  deviceId: string;               // SHA-256 hash
  agentType: 'phone';
  platform: 'android' | 'ios';
  cognitiveDebt: number;
  cognitiveLoadPct: number;
  wmCapacityRemaining: number;
  residueAtEOD: number;
  totalScreenTime: number;        // hours
  totalSwitches: number;
  totalPickups: number;
  switchVelocityPeak: number;     // switches/min in the busiest 5-min window
  categoryBreakdown: CategoryBreakdown;
  peakLoadHour: number;
  hourlyLoad: number[];           // 24-element, 0-100
  break_events: BreakEvent[];     // NEW — per-break quality records
  lastUpdated: string;            // ISO timestamp
}

// ─── Desktop Sync Payload ─────────────────────────────────────────────────────
export interface DesktopSyncPayload {
  deviceId: string;
  agentType: 'desktop';
  platform: 'darwin' | 'win32';
  cognitiveDebt: number;
  cognitiveLoadPct: number;
  wmCapacityRemaining: number;
  residueAtEOD: number;
  totalSwitches: number;
  totalFocusedTime: number;       // hours
  switchVelocityPeak: number;
  categoryBreakdown: DesktopCategoryBreakdown;
  peakLoadHour: number;
  hourlyLoad: number[];           // 24-element, 0-100
  break_events: BreakEvent[];     // NEW — mirrors phone field
  lastUpdated: string;
}

// ─── Session Document (Firestore: /users/{uid}/sessions/{date}) ───────────────
export interface SessionDocument {
  date: string;
  phoneMetrics?: PhoneSyncPayload;
  desktopSessions?: Record<string, DesktopSyncPayload>;
  // Set by mergeAgentData Cloud Function:
  combinedLoad?: number;
  dualFragmentation?: number;
  phoneInterruptsDuringWork?: number;
  // Combined switch stream across all devices — set by merge:
  combinedSwitchesTotal?: number;
  combinedSwitchVelocityPeak?: number;
  combinedHourlyLoad?: number[];  // element-wise max(phone, desktop) per hour
  lastMergeRun?: string;
  /** Written by dailyReset Cloud Function each morning. */
  carryover_debt_pts?:  number;
  carryover_residue?:   number;   // 0–100
}

// ─── User Config (Firestore: /users/{uid}/config/preferences) ─────────────────
// Written once at onboarding, updated after calibration week.
export interface UserConfig {
  display_id: string;                        // e.g. "0x9F2E_JD"
  onboarding_complete: boolean;
  permissions_granted: string[];             // ['screen_time', 'notifications', 'usage_stats']

  // Thresholds — personalised after 7-day calibration
  cognitive_debt_critical_threshold: number; // default 70
  switch_baseline: number;                   // switches/hr, default 40
  switch_critical_threshold: number;         // switches/hr, default 80

  // Sleep preferences
  sleep_target_hours: number;                // default 7.5
  wake_hour: number;                         // default 7 (7 AM)

  created_at: string;
  last_calibrated_at: string;
}

export interface RecoveryRadar {
  /** Time off-screen vs sleep_target_hours. 0–1, higher = more rest. */
  sleep:     number;
  /** Focus minutes / 240 (4h = perfect). 0–1. */
  focus:     number;
  /** 1 - (wm_strain / 100). Inverted — higher = less strain. 0–1. */
  wm_strain: number;
  /** Verified break minutes / (8h target). 0–1. */
  recovery:  number;
  /** Circadian alignment: 1 - |peakHour - 14| / 12. 0–1. */
  circadian: number;
}

// ─── Derived Day Metrics (Firestore: /users/{uid}/derived/{date}) ─────────────
// Computed by mergeAgentData Cloud Function after every session write.
// This is the SINGLE document the UI reads for all dashboard fields.
export interface DerivedDayMetrics {
  date: string;

  // ── Cognitive Debt
  cognitive_debt_score_pct: number;
  cognitive_debt_points_absolute: number;
  cognitive_debt_severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  cognitive_debt_history_6h: number[];        // last 6 hourly values around peak
  cognitive_debt_wow_change_pct: number;      // % vs same weekday last week
  cognitive_debt_critical_threshold: number;

  // ── Context Switches (COMBINED phone + desktop)
  context_switches_count_today: number;
  context_switches_velocity_hourly: number[]; // 24-element, switches/hr per hour
  context_switches_breaches: SwitchBreach[];
  context_switches_breach_count: number;
  context_switches_volatility_level: 'NORMAL' | 'ELEVATED' | 'HIGH_VOLATILITY';
  context_switches_baseline: number;
  context_switches_critical_threshold: number;

  // ── Screen Time (phone)
  screen_time_hours_today: number;
  screen_time_pct_change_vs_yesterday: number;
  screen_time_category_breakdown: CategoryBreakdown;

  // ── Device Pickups
  device_pickups_count_today: number;
  device_pickups_vs_avg_label: 'Below avg' | 'Average' | 'Above avg';

  // ── Attention Residue
  attention_residue_level: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  attention_residue_score_pct: number;
  attention_residue_trend_7d: number[];
  attention_residue_baseline_delta: number;

  // ── Working Memory
  working_memory_strain_pct: number;
  working_memory_decay_level: 'NORMAL' | 'MODERATE' | 'SEVERE';
  working_memory_neural_noise_index: number;  // 0–20, derived from velocity peak

  // ── Focus Blocks
  focus_blocks_duration_minutes_today: number;
  /** Compares today vs the 7-day rolling average (renamed from _vs_last_month). */
  focus_blocks_pct_change_vs_last_week: number;

  // ── Stress Peak
  stress_peak_hour: number;                   // 0–23
  stress_peak_vs_avg_label: string;

  // ── Recovery
  recovery_duration_minutes_today: number;
  /** Sum of break_events.duration_minutes where efficiency_pct >= 40. */
  recovery_verified_break_minutes: number;
  recovery_coefficient_by_period: {
    morning: number;
    noon: number;
    afternoon: number;
    evening: number;
  };
  recovery_vs_last_month_label: string;

  // ── Break Events (persisted from session, enriched here)
  break_events: BreakEvent[];

  // ── Debt Arc (24-hour line chart)
  debt_arc_hourly_points: number[];           // 24-element, cumulative debt %
  debt_arc_annotations: DebtArcAnnotation[];
  debt_arc_net_pts_delta: number;

  // ── Temporal Heatmap
  heatmap_weekly: number[][];                 // [7][24] — 7 days x 24 hours

  // ── Recovery Radar (5 axes)
  recovery_radar: RecoveryRadar;

  // ── Tomorrow's Readiness
  readiness_projected_baseline_pct: number;
  readiness_projected_sleep_hours: number;
  readiness_uncleared_debt_pts: number;
  readiness_circadian_alignment: 'GOOD' | 'MODERATE' | 'POOR';
  readiness_recommendation_text: string;

  // ── Load Indices (powers Day / Week / Month toggle)
  /** 7 values Mon–Sun for the Week toggle view. */
  cognitive_load_index_weekly: number[];
  /** 24-element per-hour load for the Day toggle view. */
  cognitive_load_index_daily: number[];
  /** 30-element per-day load for the Month toggle view. */
  cognitive_load_index_monthly: number[];
  cognitive_load_index_wow_change_pct: number;

  // ── Data Sync
  data_sync_last_synced_at: string;
  data_sync_status: 'LIVE' | 'DELAYED' | 'OFFLINE';
  /** 0–100: percentage of the last 7 days that have real session data. */
  data_completeness_pct: number;
  /** Active protocol tier based on current debt score. */
  sanctuary_active_tier: 0 | 1 | 2;

  // ── Cross-device (from SessionDocument merge)
  combined_load: number;
  dual_fragmentation: number;
  phone_interrupts_during_work: number;
  combined_switches_total: number;
  combined_switch_velocity_peak: number;
  combined_hourly_load: number[];

  computed_at: string;
}

// ─── Debt Arc Annotation ──────────────────────────────────────────────────────
export type DebtArcAnnotationType =
  | 'CONTEXT_SWITCH_PEAK'
  | 'NEURAL_RESET'
  | 'BREAK_FAILED'
  | 'BREAK_SUCCESSFUL'
  | 'DUAL_DEVICE_OVERLAP';

export interface DebtArcAnnotation {
  hour: number;
  type: DebtArcAnnotationType;
  label: string;
  value?: number;
}

// ─── Protocol (Firestore: /protocols/{id}) ────────────────────────────────────
export type ProtocolCategory =
  | 'BREATHING'
  | 'EYE_RELIEF'
  | 'MEDITATION'
  | 'NATURE_SOUND';

export interface Protocol {
  id: string;
  name: string;
  duration_sec: number;
  category: ProtocolCategory;
  tags: string[];
  tier_activation: 0 | 1 | 2;  // 0=always, 1=debt>50%, 2=debt>75%
  audio_url?: string;
  image_url?: string;
  description?: string;
}

// ─── Protocol Session (Firestore: /users/{uid}/protocol_sessions/{id}) ────────
export type ProtocolSessionStatus = 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';

export interface ProtocolSession {
  protocol_id: string;
  start_time: string;             // ISO
  completed_at: string | null;
  status: ProtocolSessionStatus;
  debt_before: number;
  debt_after: number | null;
  duration_completed_sec: number;
}

// ─── Weekly Report (Firestore: /users/{uid}/weeklyReports/{weekId}) ───────────
export interface WeeklyReport {
  week_id: string;                // "week-2026-04-14-to-2026-04-20"
  avg_combined_load: number;
  avg_fragmentation: number;
  avg_cognitive_debt: number;
  avg_attention_residue: number;
  avg_focus_minutes: number;
  avg_recovery_minutes: number;
  peak_debt_day: string;          // YYYY-MM-DD
  peak_debt_value: number;
  total_breaches: number;
  computed_at: string;
}

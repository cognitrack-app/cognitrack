import { computeDerivedDayMetrics } from './derivations';
import type { SessionDocument, UserConfig, StoredPhoneSyncPayload, StoredDesktopSyncPayload } from '@cognitrack/shared';

describe('derivations', () => {
  const mockPhoneMetrics: StoredPhoneSyncPayload = {
    userId: 'test-user',
    deviceId: 'phone-123',
    date: '2026-04-24',
    timezone: 'America/Los_Angeles',
    hourlyLoad: Array(24).fill(10),
    hourlySwitches: Array(24).fill(5),
    totalTimeMs: 4 * 60 * 60 * 1000,
    totalSwitches: 150,
    categoryBreakdown: {
      productive: 40,
      tools: 10,
      entertainment: 30,
      social: 20,
      passiveWaste: 0,
    },
    updatedAt: new Date().toISOString(),
    cognitiveDebt: 20,
    cognitiveLoadPct: 30,
    wmCapacityRemaining: 80,
    residueAtEOD: 0.1,
    lastUpdated: new Date().toISOString(),
    schemaVersion: 2,
    platform: 'ios',
    totalPickups: 40,
    totalScreenTime: 4,
    switchVelocityPeak: 60,
    peakLoadHour: 14,
    break_events: [],
  };

  const mockDesktopPayload: StoredDesktopSyncPayload = {
    userId: 'test-user',
    deviceId: 'desktop-456',
    date: '2026-04-24',
    timezone: 'America/Los_Angeles',
    hourlyLoad: Array(24).fill(15),
    hourlySwitches: Array(24).fill(8),
    totalTimeMs: 5 * 60 * 60 * 1000,
    totalSwitches: 200,
    categoryBreakdown: {
      productive: 70,
      tools: 20,
      entertainment: 5,
      social: 5,
      passiveWaste: 0,
    },
    updatedAt: new Date().toISOString(),
    cognitiveDebt: 15,
    cognitiveLoadPct: 25,
    wmCapacityRemaining: 85,
    residueAtEOD: 0.05,
    lastUpdated: new Date().toISOString(),
    schemaVersion: 2,
    platform: 'darwin',
    totalFocusedTime: 5,
    switchVelocityPeak: 50,
    peakLoadHour: 11,
    break_events: [],
  };

  const mockConfig: UserConfig = {
    display_id: '0x1234_TU',
    onboarding_complete: true,
    permissions_granted: ['screen_time', 'notifications'],
    cognitive_debt_critical_threshold: 70,
    switch_baseline: 40,
    switch_critical_threshold: 80,
    sleep_target_hours: 7.5,
    wake_hour: 7,
    created_at: new Date().toISOString(),
    last_calibrated_at: new Date().toISOString(),
  };

  const mockLast7: SessionDocument[] = [
    {
      date: '2026-04-23',
      phoneMetrics: { ...mockPhoneMetrics, cognitiveLoadPct: 35 },
      desktopSessions: { 'desktop-456': { ...mockDesktopPayload, cognitiveLoadPct: 30 } },
      combinedLoad: 33,
    },
    {
      date: '2026-04-22',
      phoneMetrics: { ...mockPhoneMetrics, cognitiveLoadPct: 28 },
      desktopSessions: { 'desktop-456': { ...mockDesktopPayload, cognitiveLoadPct: 22 } },
      combinedLoad: 26,
    },
    {
      date: '2026-04-21',
      phoneMetrics: { ...mockPhoneMetrics, cognitiveLoadPct: 32 },
      desktopSessions: { 'desktop-456': { ...mockDesktopPayload, cognitiveLoadPct: 28 } },
      combinedLoad: 31,
    },
    {
      date: '2026-04-20',
      phoneMetrics: { ...mockPhoneMetrics, cognitiveLoadPct: 25 },
      desktopSessions: { 'desktop-456': { ...mockDesktopPayload, cognitiveLoadPct: 20 } },
      combinedLoad: 23,
    },
    {
      date: '2026-04-19',
      phoneMetrics: { ...mockPhoneMetrics, cognitiveLoadPct: 40 },
      desktopSessions: { 'desktop-456': { ...mockDesktopPayload, cognitiveLoadPct: 35 } },
      combinedLoad: 38,
    },
    {
      date: '2026-04-18',
      phoneMetrics: { ...mockPhoneMetrics, cognitiveLoadPct: 38 },
      desktopSessions: { 'desktop-456': { ...mockDesktopPayload, cognitiveLoadPct: 32 } },
      combinedLoad: 36,
    },
    {
      date: '2026-04-17',
      phoneMetrics: { ...mockPhoneMetrics, cognitiveLoadPct: 30 },
      desktopSessions: { 'desktop-456': { ...mockDesktopPayload, cognitiveLoadPct: 25 } },
      combinedLoad: 28,
    },
  ];

  it('computes derived metrics for a combined session', () => {
    const today: SessionDocument = {
      date: '2026-04-24',
      phoneMetrics: mockPhoneMetrics,
      desktopSessions: { 'desktop-456': mockDesktopPayload },
      combinedLoad: 28,
      dualFragmentation: 2,
      phoneHighLoadOverlapHours: 3,
      combinedSwitchesTotal: 350,
      combinedSwitchVelocityPeak: 60,
      combinedHourlyLoad: Array(24).fill(12),
      lastMergeRun: new Date().toISOString(),
      carryover_debt_pts: 0,
      carryover_residue: 0,
    };

    const derived = computeDerivedDayMetrics(today, mockLast7, mockConfig);

    expect(derived.date).toBe('2026-04-24');
    expect(derived.cognitive_debt_score_pct).toBe(28);
    expect(derived.context_switches_count_today).toBe(350);
    expect(derived.context_switches_velocity_hourly).toHaveLength(24);
    expect(derived.context_switches_breach_count).toBeGreaterThanOrEqual(0);
    expect(derived.screen_time_hours_today).toBe(4);
    expect(derived.device_pickups_count_today).toBe(40);
    expect(derived.attention_residue_score_pct).toBeGreaterThanOrEqual(0);
    expect(derived.working_memory_strain_pct).toBeLessThanOrEqual(100);
    expect(derived.focus_blocks_duration_minutes_today).toBeGreaterThanOrEqual(0);
    expect(derived.recovery_duration_minutes_today).toBeGreaterThanOrEqual(0);
    expect(derived.debt_arc_hourly_points).toHaveLength(24);
    expect(derived.heatmap_weekly).toHaveLength(7);
    expect(derived.recovery_radar.sleep).toBeGreaterThanOrEqual(0);
    expect(derived.readiness_projected_baseline_pct).toBeGreaterThanOrEqual(0);
    expect(derived.cognitive_load_index_daily).toHaveLength(24);
    expect(derived.data_completeness_pct).toBeGreaterThanOrEqual(0);
    expect(derived.sanctuary_active_tier).toBeLessThanOrEqual(2);
  });

  it('handles phone-only sessions', () => {
    const today: SessionDocument = {
      date: '2026-04-24',
      phoneMetrics: mockPhoneMetrics,
      desktopSessions: {},
      combinedLoad: 30,
      dualFragmentation: 0,
      phoneHighLoadOverlapHours: 0,
      combinedSwitchesTotal: 150,
      combinedSwitchVelocityPeak: 60,
      combinedHourlyLoad: Array(24).fill(10),
      lastMergeRun: new Date().toISOString(),
      carryover_debt_pts: 0,
      carryover_residue: 0,
    };

    const derived = computeDerivedDayMetrics(today, mockLast7, mockConfig);

    expect(derived.cognitive_debt_score_pct).toBe(30);
    expect(derived.context_switches_count_today).toBe(150);
    expect(derived.screen_time_hours_today).toBe(4);
  });

  it('handles carryover from overnight', () => {
    const today: SessionDocument = {
      date: '2026-04-24',
      phoneMetrics: mockPhoneMetrics,
      desktopSessions: { 'desktop-456': mockDesktopPayload },
      combinedLoad: 28,
      dualFragmentation: 2,
      phoneHighLoadOverlapHours: 3,
      combinedSwitchesTotal: 350,
      combinedSwitchVelocityPeak: 60,
      combinedHourlyLoad: Array(24).fill(12),
      lastMergeRun: new Date().toISOString(),
      carryover_debt_pts: 15,
      carryover_residue: 10,
    };

    const derived = computeDerivedDayMetrics(today, mockLast7, mockConfig);

    expect(derived.cognitive_debt_points_absolute).toBeGreaterThan(0);
    expect(derived.attention_residue_score_pct).toBeGreaterThanOrEqual(10);
  });

  it('computes correct volatility levels', () => {
    const highVelocityPhone: StoredPhoneSyncPayload = {
      ...mockPhoneMetrics,
      switchVelocityPeak: 200, // Very high velocity
      hourlyLoad: Array(24).fill(80),
    };

    const today: SessionDocument = {
      date: '2026-04-24',
      phoneMetrics: highVelocityPhone,
      desktopSessions: {},
      combinedLoad: 80,
      dualFragmentation: 0,
      phoneHighLoadOverlapHours: 0,
      combinedSwitchesTotal: 500,
      combinedSwitchVelocityPeak: 200,
      combinedHourlyLoad: Array(24).fill(80),
      lastMergeRun: new Date().toISOString(),
      carryover_debt_pts: 0,
      carryover_residue: 0,
    };

    const derived = computeDerivedDayMetrics(today, mockLast7, mockConfig);

    expect(derived.context_switches_volatility_level).toBe('HIGH_VOLATILITY');
  });

  it('computes recovery radar correctly', () => {
    const today: SessionDocument = {
      date: '2026-04-24',
      phoneMetrics: mockPhoneMetrics,
      desktopSessions: { 'desktop-456': mockDesktopPayload },
      combinedLoad: 28,
      dualFragmentation: 2,
      phoneHighLoadOverlapHours: 3,
      combinedSwitchesTotal: 350,
      combinedSwitchVelocityPeak: 60,
      combinedHourlyLoad: Array(24).fill(12),
      lastMergeRun: new Date().toISOString(),
      carryover_debt_pts: 0,
      carryover_residue: 0,
    };

    const derived = computeDerivedDayMetrics(today, mockLast7, mockConfig);

    expect(derived.recovery_radar.sleep).toBeGreaterThanOrEqual(0);
    expect(derived.recovery_radar.focus).toBeGreaterThanOrEqual(0);
    expect(derived.recovery_radar.wm_strain).toBeGreaterThanOrEqual(0);
    expect(derived.recovery_radar.recovery).toBeGreaterThanOrEqual(0);
    expect(derived.recovery_radar.circadian).toBeGreaterThanOrEqual(0);
  });
});
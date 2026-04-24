import { computeDerivedDayMetrics } from './derivations';
import type { SessionDocument, UserConfig, PhoneSyncPayload, DesktopSyncPayload } from '@cognitrack/shared';

describe('derivations', () => {
  const mockPhoneMetrics: PhoneSyncPayload = {
    date: '2026-04-24',
    deviceId: 'phone-123',
    agentType: 'phone',
    platform: 'ios',
    cognitiveDebt: 20,
    cognitiveLoadPct: 30,
    wmCapacityRemaining: 80,
    residueAtEOD: 0.1,
    totalScreenTime: 4,
    totalSwitches: 150,
    totalPickups: 40,
    switchVelocityPeak: 60,
    categoryBreakdown: {
      productive: 0.4,
      entertainment: 0.3,
      social: 0.2,
      passiveWaste: 0.1,
    },
    peakLoadHour: 14,
    hourlyLoad: Array(24).fill(10),
    break_events: [],
    lastUpdated: new Date().toISOString(),
  };

  const mockDesktopPayload: DesktopSyncPayload = {
    deviceId: 'desktop-456',
    agentType: 'desktop',
    platform: 'darwin',
    cognitiveDebt: 15,
    cognitiveLoadPct: 25,
    wmCapacityRemaining: 85,
    residueAtEOD: 0.05,
    totalSwitches: 200,
    totalFocusedTime: 5,
    switchVelocityPeak: 50,
    categoryBreakdown: {
      productive: 0.7,
      tools: 0.2,
      entertainment: 0.05,
      social: 0.05,
      passiveWaste: 0,
    },
    peakLoadHour: 11,
    hourlyLoad: Array(24).fill(15),
    break_events: [],
    lastUpdated: new Date().toISOString(),
  };

  const mockSession: SessionDocument = {
    date: '2026-04-24',
    phoneMetrics: mockPhoneMetrics,
    desktopSessions: {
      'desktop-456': mockDesktopPayload,
    },
    carryover_debt_pts: 12,
    carryover_residue: 10,
  };



  const mockConfig: UserConfig = {
    display_id: 'TEST_USER',
    onboarding_complete: true,
    permissions_granted: [],
    cognitive_debt_critical_threshold: 75,
    switch_baseline: 45,
    switch_critical_threshold: 85,
    sleep_target_hours: 8,
    wake_hour: 6,
    created_at: new Date().toISOString(),
    last_calibrated_at: new Date().toISOString(),
  };

  it('computes derived metrics correctly', () => {
    // last7 has only 1 real session to simulate a Day 2 user
    const last7 = [mockSession];

    const result = computeDerivedDayMetrics(mockSession, last7, mockConfig);

    // Assertions on threshold values
    expect(result.cognitive_debt_critical_threshold).toBe(mockConfig.cognitive_debt_critical_threshold);
    expect(result.context_switches_baseline).toBe(mockConfig.switch_baseline);

    // focus_blocks_pct_change_vs_last_week is a number
    expect(typeof result.focus_blocks_pct_change_vs_last_week).toBe('number');
    expect(Number.isNaN(result.focus_blocks_pct_change_vs_last_week)).toBe(false);

    // recovery_radar.recovery is between 0 and 1
    expect(result.recovery_radar.recovery).toBeGreaterThanOrEqual(0);
    expect(result.recovery_radar.recovery).toBeLessThanOrEqual(1);

    // Length assertions
    expect(result.cognitive_load_index_daily.length).toBe(24);
    expect(result.cognitive_load_index_monthly.length).toBe(30);
    expect(result.heatmap_weekly.length).toBe(7);
    result.heatmap_weekly.forEach(row => {
      expect(row.length).toBe(24);
    });

    // recovery_radar keys
    expect(Object.keys(result.recovery_radar).sort()).toEqual([
      'circadian',
      'focus',
      'recovery',
      'sleep',
      'wm_strain',
    ]);

    // carryover_debt_pts on the session is correctly added to cognitive_debt_points_absolute
    // Desktop debt is multiplied by 0.45.
    // Base points = phone(20) + Math.round(desktop(15) * 0.45) = 20 + 7 = 27
    // With carryover = 27 + 12 = 39
    expect(result.cognitive_debt_points_absolute).toBe(39);

    // data_completeness_pct is Math.round((1/7)*100) when last7 has only 1 real session
    expect(result.data_completeness_pct).toBe(Math.round((1 / 7) * 100));
  });
});

/**
 * derivations.ts
 *
 * Pure functions that transform raw SessionDocuments + UserConfig into
 * DerivedDayMetrics — the single document the UI reads for every dashboard field.
 *
 * Called from mergeAgentData (real-time) and weeklyRollup (batch).
 * No Firestore imports here — this is pure computation.
 */

import type {
  SessionDocument,
  UserConfig,
  DerivedDayMetrics,
  BreakEvent,
  SwitchBreach,
  DebtArcAnnotation,
} from '@cognitrack/shared';

const AWAKE_HOURS = 16;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function avgArr(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Element-wise max of two 24-element arrays.
 * Used for combinedHourlyLoad = worst hour across phone + desktop.
 */
function hourlyMax(a: number[], b: number[]): number[] {
  return Array.from({ length: 24 }, (_, i) => Math.max(a[i] ?? 0, b[i] ?? 0));
}

/**
 * Element-wise sum capped at 100.
 * Used to combine phone switch velocity + desktop switch velocity per hour.
 */
function hourlySum(a: number[], b: number[]): number[] {
  return Array.from({ length: 24 }, (_, i) =>
    clamp((a[i] ?? 0) + (b[i] ?? 0), 0, 100)
  );
}

// ─── Main Derivation Function ──────────────────────────────────────────────────

export function computeDerivedDayMetrics(
  today: SessionDocument,
  /** Last 7 days in DESCENDING order (index 0 = yesterday, index 6 = 7 days ago) */
  last7: SessionDocument[],
  config: UserConfig
): DerivedDayMetrics {
  const p = today.phoneMetrics;
  const desktops = Object.values(today.desktopSessions ?? {});

  // Pick primary desktop = most focused time
  const primaryDesktop = desktops.length > 0
    ? desktops.reduce((best, d) => d.totalFocusedTime > best.totalFocusedTime ? d : best)
    : null;

  // ── Phone-only safe fallbacks ──────────────────────────────────────────────
  const phoneHourly: number[] = p?.hourlyLoad ?? Array(24).fill(0);
  const desktopHourly: number[] = primaryDesktop?.hourlyLoad ?? Array(24).fill(0);

  // ── Combined switch streams ────────────────────────────────────────────────
  // Total switches = phone + ALL desktops (not just primary — user may dual-monitor)
  const phoneSwitches = p?.totalSwitches ?? 0;
  const desktopSwitches = desktops.reduce((s, d) => s + d.totalSwitches, 0);
  const combinedSwitchesTotal = phoneSwitches + desktopSwitches;

  const phoneVelocityPeak = p?.switchVelocityPeak ?? 0;
  const desktopVelocityPeak = desktops.length > 0
    ? Math.max(...desktops.map(d => d.switchVelocityPeak))
    : 0;
  // switchVelocityPeak from both agents is in switches/MIN (count in 5-min window ÷ 5).
  // Store the raw value for the session fields, but convert to switches/HR for
  // threshold comparisons — UserConfig.switch_critical_threshold is switches/hr.
  const combinedSwitchVelocityPeak = Math.max(phoneVelocityPeak, desktopVelocityPeak);
  const combinedVelocityPeakPerHour = combinedSwitchVelocityPeak * 60;

  // Hourly switch velocity: sum phone + desktop per hour, normalised to switches/hr
  // phoneHourly and desktopHourly are 0–100 load% — convert to est. switches/hr
  // using: switches/hr = (load% / 100) * critical_threshold
  const critThreshold = config.switch_critical_threshold ?? 80;
  const baseline = config.switch_baseline ?? 40;

  const phoneVelocityHourly = phoneHourly.map(l => Math.round((l / 100) * critThreshold * 1.2));
  const desktopVelocityHourly = desktopHourly.map(l => Math.round((l / 100) * critThreshold * 0.8));
  const combinedVelocityHourly = hourlySum(phoneVelocityHourly, desktopVelocityHourly);

  const combinedHourlyLoad: number[] = hourlyMax(phoneHourly, desktopHourly);

  // ── Combined cognitive debt ────────────────────────────────────────────────
  // Use session's already-merged combinedLoad if present; fall back to phone
  const debtScore = today.combinedLoad ?? p?.cognitiveLoadPct ?? 0;
  const debtPoints = Math.round(
    (p?.cognitiveDebt ?? 0) +
    desktops.reduce((s, d) => s + d.cognitiveDebt, 0) * 0.45
  );

  // ── Carryover from overnight (written by dailyReset Cloud Function) ──────
  // If the user didn't fully recover yesterday, carry that deficit into
  // today's opening debt so projections accumulate correctly.
  const carryoverDebt    = today.carryover_debt_pts    ?? 0;
  const carryoverResidue = today.carryover_residue      ?? 0;   // 0–100

  // Add carryover to the debt point total (not the %-score — that would
  // double-count, since the session's cognitiveLoadPct already reflects
  // today's events only)
  const debtPointsWithCarryover = debtPoints + carryoverDebt;

  const debtSeverity =
    debtScore >= 80 ? 'CRITICAL'
    : debtScore >= 65 ? 'HIGH'
    : debtScore >= 45 ? 'MEDIUM'
    : 'LOW';

  // Last 6 hourly combined-load values centred around peak
  const peakHour = p?.peakLoadHour ?? 12;
  const history6h = combinedHourlyLoad.slice(
    Math.max(0, peakHour - 5),
    peakHour + 1
  );
  while (history6h.length < 6) history6h.unshift(0);

  // WoW change vs same weekday 7 sessions ago
  const sameLastWeekDebt = last7[6]?.combinedLoad ?? last7[6]?.phoneMetrics?.cognitiveLoadPct ?? debtScore;
  const wowDebt = sameLastWeekDebt === 0 ? 0
    : Math.round(((debtScore - sameLastWeekDebt) / sameLastWeekDebt) * 100);

  // ── Context Switch Breaches ────────────────────────────────────────────────
  const breaches: SwitchBreach[] = combinedVelocityHourly.map((vel, hour) => ({
    hour,
    velocity: vel,
    is_breach: vel > critThreshold,
  }));
  const breachCount = breaches.filter(b => b.is_breach).length;

  // CRITICAL-2 FIX: compare in switches/hr — combinedVelocityPeakPerHour is
  // already converted above. critThreshold and baseline are switches/hr per UserConfig.
  const volatility =
    combinedVelocityPeakPerHour > critThreshold ? 'HIGH_VOLATILITY'
    : combinedVelocityPeakPerHour > baseline * 1.5 ? 'ELEVATED'
    : 'NORMAL';

  // ── Screen Time ────────────────────────────────────────────────────────────
  const screenTimeHours = p?.totalScreenTime ?? 0;
  const yesterdayST = last7[0]?.phoneMetrics?.totalScreenTime ?? screenTimeHours;
  const stPctChange = yesterdayST === 0 ? 0
    : Math.round(((screenTimeHours - yesterdayST) / yesterdayST) * 100);

  // ── Device Pickups ─────────────────────────────────────────────────────────
  const pickups = p?.totalPickups ?? 0;
  const last7Pickups = last7.map(s => s.phoneMetrics?.totalPickups ?? 0);
  const avgPickups = avgArr(last7Pickups);
  const pickupsVsAvg =
    pickups < avgPickups * 0.8 ? 'Below avg'
    : pickups > avgPickups * 1.2 ? 'Above avg'
    : 'Average';

  // ── Attention Residue ──────────────────────────────────────────────────────
  // Combine phone + desktop residue — take the higher (worst case)
  const phoneResidue = p?.residueAtEOD ?? 0;
  const desktopResidue = primaryDesktop?.residueAtEOD ?? 0;
  const combinedResidue = Math.max(phoneResidue, desktopResidue);
  const residuePct = Math.round(combinedResidue * 100);

  // Adjust residue: carryoverResidue is the overnight remnant in %.
  // Blend it into combinedResidue so the residueLevel enum reflects it.
  const blendedResiduePct = Math.min(100, residuePct + carryoverResidue);

  const residueLevel =
    blendedResiduePct >= 70 ? 'SEVERE'
    : blendedResiduePct >= 45 ? 'HIGH'
    : blendedResiduePct >= 20 ? 'MODERATE'
    : 'LOW';

  const residueTrend7d = last7.map(s => {
    const pr = s.phoneMetrics?.residueAtEOD ?? 0;
    const dr = Object.values(s.desktopSessions ?? {}).reduce(
      (mx, d) => Math.max(mx, d.residueAtEOD), 0
    );
    return Math.round(Math.max(pr, dr) * 100);
  });

  const residueBaseline = avgArr(residueTrend7d) / 100;
  const residueDelta = Math.round((combinedResidue - residueBaseline) * 100);

  // ── Working Memory ─────────────────────────────────────────────────────────
  // WM strain = worst across all active devices
  const phoneWM = p?.wmCapacityRemaining ?? 100;
  const desktopWM = primaryDesktop?.wmCapacityRemaining ?? 100;
  const worstWM = Math.min(phoneWM, desktopWM);
  const wmStrain = 100 - worstWM;

  const wmDecay =
    wmStrain >= 70 ? 'SEVERE'
    : wmStrain >= 45 ? 'MODERATE'
    : 'NORMAL';

  // Neural noise index: velocity peak normalised to 0–20 (Hz-like scale for UI)
  // CRITICAL-2 FIX: neuralNoise is a 0–20 HUD scale (Hz-like).
  // Normalise against 1.5× critThreshold (switches/hr) so 20 = "maximum neural disruption".
  // Using the /hr value so the scale is meaningful (not always near 0).
  const neuralNoise = Math.round(
    clamp(combinedVelocityPeakPerHour / (critThreshold * 1.5), 0, 1) * 20 * 10
  ) / 10;

  // ── Focus Blocks ───────────────────────────────────────────────────────────
  // Phone productive fraction + desktop focusedTime
  const prodFraction = p?.categoryBreakdown.productive ?? 0;
  const phoneFocusMin = Math.round(screenTimeHours * 60 * prodFraction);
  const desktopFocusMin = primaryDesktop
    ? Math.round(primaryDesktop.totalFocusedTime * 60 * (primaryDesktop.categoryBreakdown.productive + primaryDesktop.categoryBreakdown.tools * 0.5))
    : 0;
  const totalFocusMin = phoneFocusMin + desktopFocusMin;

  const last7FocusMin = last7.map(s => {
    const pp = s.phoneMetrics;
    const dd = Object.values(s.desktopSessions ?? {}).reduce(
      (mx, d) => Math.max(mx, d.totalFocusedTime), 0
    );
    const pf = pp ? Math.round(pp.totalScreenTime * 60 * (pp.categoryBreakdown.productive ?? 0)) : 0;
    return pf + Math.round(dd * 60);
  });
  // Renamed: compares vs last 7-day average, not a calendar month
  const avgLast7DaysFocus = avgArr(last7FocusMin);
  const focusWoW = avgLast7DaysFocus === 0 ? 0
    : Math.round(((totalFocusMin - avgLast7DaysFocus) / avgLast7DaysFocus) * 100);

  // ── Stress Peak ────────────────────────────────────────────────────────────
  const last7PeakHours = last7.map(s => s.phoneMetrics?.peakLoadHour ?? 12);
  const avgPeakHour = Math.round(avgArr(last7PeakHours));
  const peakVsAvg =
    peakHour > avgPeakHour + 1 ? 'Later than avg'
    : peakHour < avgPeakHour - 1 ? 'Earlier than avg'
    : 'On average';

  // ── Recovery ───────────────────────────────────────────────────────────────
  // Compute from verified break events only (efficiency >= 40%).
  // Idle time and unstructured non-breaks are excluded.
  const phoneBreaksForRecovery: BreakEvent[] = p?.break_events ?? [];
  const desktopBreaksForRecovery: BreakEvent[] = desktops.flatMap(d => d.break_events ?? []);
  const allBreaksForRecovery = [...phoneBreaksForRecovery, ...desktopBreaksForRecovery];
  const verifiedBreakMinutes = allBreaksForRecovery
    .filter(b => b.efficiency_pct >= 40)
    .reduce((sum, b) => sum + b.duration_minutes, 0);
  // If no break events exist yet (phone-only early day), fall back to
  // time-off-screen as a rough proxy so the field is never zero.
  const recoveryHours = Math.max(0, AWAKE_HOURS - screenTimeHours);
  const recoveryMinutes = verifiedBreakMinutes > 0
    ? verifiedBreakMinutes
    : Math.round(recoveryHours * 60);

  // Recovery coefficient by period: 1 - avg_load = recovery quality
  const coeff = {
    morning:   Math.round((1 - avgArr(combinedHourlyLoad.slice(6, 12)) / 100) * 100),
    noon:      Math.round((1 - avgArr(combinedHourlyLoad.slice(12, 14)) / 100) * 100),
    afternoon: Math.round((1 - avgArr(combinedHourlyLoad.slice(14, 18)) / 100) * 100),
    evening:   Math.round((1 - avgArr(combinedHourlyLoad.slice(18, 22)) / 100) * 100),
  };

  // Recovery WoW label — compares against last 7 sessions' verified break minutes
  const last7RecoveryMin = last7.map(s => {
    const phoneB = s.phoneMetrics?.break_events ?? [];
    const desktopB = Object.values(s.desktopSessions ?? {}).flatMap(d => d.break_events ?? []);
    const verified = [...phoneB, ...desktopB]
      .filter(b => b.efficiency_pct >= 40)
      .reduce((sum, b) => sum + b.duration_minutes, 0);
    if (verified > 0) return verified;
    const st = s.phoneMetrics?.totalScreenTime ?? 0;
    return Math.max(0, AWAKE_HOURS - st) * 60;
  });
  const avgLastWeekRecovery = avgArr(last7RecoveryMin);
  const recoveryMoM = avgLastWeekRecovery === 0 ? 'Stable vs last wk.'
    : recoveryMinutes > avgLastWeekRecovery * 1.1 ? 'Improved vs last wk.'
    : recoveryMinutes < avgLastWeekRecovery * 0.9 ? 'Declined vs last wk.'
    : 'Stable vs last wk.';

  // ── Break Events (merged from both devices) ────────────────────────────────
  const phoneBreaks: BreakEvent[] = p?.break_events ?? [];
  const desktopBreaks: BreakEvent[] = desktops.flatMap(d => d.break_events ?? []);
  // Deduplicate overlapping breaks (same time window within 5 min)
  const allBreaks = [...phoneBreaks, ...desktopBreaks].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  // ── Debt Arc (24h cumulative line chart) ───────────────────────────────────
  // Build cumulative debt % using combinedHourlyLoad as a running accumulator
  const debtArcPoints: number[] = [];
  let cumulative = 0;
  for (let h = 0; h < 24; h++) {
    cumulative = clamp(cumulative + (combinedHourlyLoad[h]! / 24), 0, 100);
    debtArcPoints.push(Math.round(cumulative));
  }

  // Annotations: breaches, break events, fragmentation peaks
  const annotations: DebtArcAnnotation[] = [
    ...breaches
      .filter(b => b.is_breach)
      .map(b => ({
        hour: b.hour,
        type: 'CONTEXT_SWITCH_PEAK' as const,
        label: `${b.velocity} switches/hr`,
        value: b.velocity,
      })),
    ...allBreaks.map(b => {
      const h = new Date(b.start_time).getHours();
      const isEffective = b.efficiency_pct >= 60;
      return {
        hour: h,
        type: isEffective
          ? ('BREAK_SUCCESSFUL' as const)
          : ('BREAK_FAILED' as const),
        label: b.activity_type,
        value: b.efficiency_pct,
      };
    }),
  ].sort((a, b) => a.hour - b.hour);

  // Mark dual-device overlap hours
  for (let h = 0; h < 24; h++) {
    if ((phoneHourly[h]! > 20) && (desktopHourly[h]! > 30)) {
      annotations.push({
        hour: h,
        type: 'DUAL_DEVICE_OVERLAP',
        label: 'Dual device active',
      });
    }
  }

  const netPtsDelta = debtPointsWithCarryover - (last7[0] != null
    ? Math.round((last7[0].phoneMetrics?.cognitiveDebt ?? 0) +
        Object.values(last7[0].desktopSessions ?? {}).reduce((s, d) => s + d.cognitiveDebt, 0) * 0.45)
    : 0);

  // ── Heatmap [7][24] ────────────────────────────────────────────────────────
  // Build from combined hourly loads across last 7 sessions
  const heatmapWeekly: number[][] = last7
    .slice(0, 7)
    .map(s => {
      const ph = s.phoneMetrics?.hourlyLoad ?? Array(24).fill(0);
      const dh = Object.values(s.desktopSessions ?? {})
        .reduce<number[]>(
          (acc, d) => hourlyMax(acc, d.hourlyLoad),
          Array(24).fill(0)
        );
      return hourlyMax(ph, dh);
    })
    .reverse(); // oldest first (Mon–Sun order)
  while (heatmapWeekly.length < 7) heatmapWeekly.unshift(Array(24).fill(0));

  // ── Recovery Radar (5 axes, 0–1) ─────────────────────────────────────────
  const sleepTarget = config.sleep_target_hours ?? 7.5;
  const radarSleep = clamp(recoveryHours / sleepTarget, 0, 1);
  const radarFocus = clamp(totalFocusMin / 240, 0, 1);      // 4h = perfect
  const radarWmStrain = 1 - (wmStrain / 100);               // inverted
  // Use verified break minutes as the numerator (240 min = 4h = perfect recovery score).
  // Falls back to time-off-screen if no break events exist yet.
  const radarRecovery = verifiedBreakMinutes > 0
    ? clamp(verifiedBreakMinutes / 240, 0, 1)
    : clamp(recoveryHours / 8, 0, 1);
  // Circadian: how close peak load is to 14:00 (optimal window)
  const radarCircadian = 1 - Math.abs(peakHour - 14) / 12;

  // ── Readiness (Tomorrow) ───────────────────────────────────────────────────
  const unclearedDebt = Math.max(0, debtPointsWithCarryover - Math.round(recoveryHours * 4));
  const projectedBaseline = clamp(
    Math.round(unclearedDebt / 2 + blendedResiduePct * 0.3),
    0, 100
  );
  const circadianAlignment =
    radarCircadian > 0.7 ? 'GOOD'
    : radarCircadian > 0.4 ? 'MODERATE'
    : 'POOR';

  const bedtimeHour = Math.round(24 - sleepTarget);
  const bedtimeStr = `${bedtimeHour}:30`;
  const recText =
    projectedBaseline > 50
      ? `High debt carryover detected. Sleep before ${bedtimeStr} and avoid screens 1h before bed to reach <40% baseline tomorrow.`
      : projectedBaseline > 30
      ? `Moderate load projected. Sleep before ${bedtimeHour + 1}:00 to maintain cognitive baseline.`
      : 'On track. Maintain current recovery pattern for optimal cognitive performance.';

  // ── Daily Load Index (24h, for Day toggle view) ──────────────────────────
  // combinedHourlyLoad is already the per-hour 0–100 load for today.
  const cognitive_load_index_daily: number[] = combinedHourlyLoad;

  // ── Monthly Load Index (last 30 days, for Month toggle view) ──────────────
  // Built from up to last7 sessions; beyond 7 the weeklyRollup enriches this.
  // For now: last7 padded with zeros to 30 entries; weeklyRollup backfills rest.
  const last7DailyLoads = last7
    .map(s => s.combinedLoad ?? s.phoneMetrics?.cognitiveLoadPct ?? 0)
    .reverse();
  const cognitive_load_index_monthly: number[] = [
    ...Array(Math.max(0, 30 - last7DailyLoads.length - 1)).fill(0),
    ...last7DailyLoads,
    debtScore,
  ].slice(-30);

  // ── Data Completeness ──────────────────────────────────────────────────────
  // Always divide by 7 (not last7.length) - new users on Day 2 should
  // show 14% completeness, not a misleading 100%.
  const sessionsWithRealData = last7.filter(s =>
    (s.phoneMetrics?.totalSwitches ?? 0) > 0 ||
    Object.keys(s.desktopSessions ?? {}).length > 0
  ).length;
  const data_completeness_pct = Math.round((sessionsWithRealData / 7) * 100);

  // ── Sanctuary Active Tier ─────────────────────────────────────────────────
  // Tier 0 = always visible, Tier 1 = debt > 50%, Tier 2 = debt > 75%
  const sanctuary_active_tier: 0 | 1 | 2 =
    debtScore >= 75 ? 2
    : debtScore >= 50 ? 1
    : 0;

  // ── Weekly Load Index ──────────────────────────────────────────────────────
  const weeklyLoads = [
    ...last7.map(s => s.combinedLoad ?? s.phoneMetrics?.cognitiveLoadPct ?? 0).reverse(),
    debtScore,
  ].slice(-7);
  while (weeklyLoads.length < 7) weeklyLoads.unshift(0);
  // CLOUD-DERIVE-02 FIX: The old code computed (today - avg_last_6) / avg_last_6
  // and labelled it "wow" (week-over-week). That is NOT week-over-week — it
  // compares today vs a rolling 6-day average, which contradicts wowDebt above
  // (which correctly compares today vs the same weekday 7 sessions ago).
  // Reuse wowDebt so both fields are consistent and accurate.
  const wowWeekly = wowDebt;

  // ── Data Sync Status ───────────────────────────────────────────────────────
  const lastSyncedAt = p?.lastUpdated ?? primaryDesktop?.lastUpdated ?? new Date().toISOString();
  const minutesSinceSync =
    (Date.now() - new Date(lastSyncedAt).getTime()) / 60_000;
  const syncStatus =
    minutesSinceSync < 5 ? 'LIVE'
    : minutesSinceSync < 30 ? 'DELAYED'
    : 'OFFLINE';

  return {
    date: today.date,

    cognitive_debt_score_pct: debtScore,
    cognitive_debt_points_absolute: debtPointsWithCarryover,
    cognitive_debt_severity: debtSeverity,
    cognitive_debt_history_6h: history6h,
    cognitive_debt_wow_change_pct: wowDebt,
    cognitive_debt_critical_threshold: config.cognitive_debt_critical_threshold ?? 70,

    context_switches_count_today: combinedSwitchesTotal,
    context_switches_velocity_hourly: combinedVelocityHourly,
    context_switches_breaches: breaches,
    context_switches_breach_count: breachCount,
    context_switches_volatility_level: volatility,
    context_switches_baseline: baseline,
    context_switches_critical_threshold: critThreshold,

    screen_time_hours_today: screenTimeHours,
    screen_time_pct_change_vs_yesterday: stPctChange,
    screen_time_category_breakdown: p?.categoryBreakdown ?? {
      productive: 0, entertainment: 0, social: 0, passiveWaste: 0,
    },

    device_pickups_count_today: pickups,
    device_pickups_vs_avg_label: pickupsVsAvg,

    attention_residue_level: residueLevel,
    attention_residue_score_pct: blendedResiduePct,
    attention_residue_trend_7d: residueTrend7d,
    attention_residue_baseline_delta: residueDelta,

    working_memory_strain_pct: wmStrain,
    working_memory_decay_level: wmDecay,
    working_memory_neural_noise_index: neuralNoise,

    focus_blocks_duration_minutes_today: totalFocusMin,
    focus_blocks_pct_change_vs_last_week: focusWoW,

    stress_peak_hour: peakHour,
    stress_peak_vs_avg_label: peakVsAvg,

    recovery_duration_minutes_today: recoveryMinutes,
    recovery_verified_break_minutes: verifiedBreakMinutes,
    recovery_coefficient_by_period: coeff,
    recovery_vs_last_month_label: recoveryMoM,

    break_events: allBreaks,

    debt_arc_hourly_points: debtArcPoints,
    debt_arc_annotations: annotations,
    debt_arc_net_pts_delta: netPtsDelta,

    heatmap_weekly: heatmapWeekly,

    recovery_radar: {
      sleep:     Math.round(radarSleep * 100) / 100,
      focus:     Math.round(radarFocus * 100) / 100,
      wm_strain: Math.round(radarWmStrain * 100) / 100,
      recovery:  Math.round(radarRecovery * 100) / 100,
      circadian: Math.round(radarCircadian * 100) / 100,
    },

    readiness_projected_baseline_pct: projectedBaseline,
    readiness_projected_sleep_hours: sleepTarget,
    readiness_uncleared_debt_pts: unclearedDebt,
    readiness_circadian_alignment: circadianAlignment,
    readiness_recommendation_text: recText,

    cognitive_load_index_weekly: weeklyLoads,
    cognitive_load_index_daily,
    cognitive_load_index_monthly,
    cognitive_load_index_wow_change_pct: wowWeekly,

    data_sync_last_synced_at: lastSyncedAt,
    data_sync_status: syncStatus,
    data_completeness_pct,
    sanctuary_active_tier,

    combined_load: today.combinedLoad ?? debtScore,
    dual_fragmentation: today.dualFragmentation ?? 0,
    // CLOUD-DERIVE-01 FIX: merge.ts renamed phoneInterruptsDuringWork to
    // phoneHighLoadOverlapHours. The old field name is undefined on all
    // documents written after the CLOUD-04 fix, making this always 0.
    // Read the new field first; fall back to the old name for documents
    // written before the rename (backward compatibility).
    phone_interrupts_during_work:
      today.phoneHighLoadOverlapHours ?? today.phoneInterruptsDuringWork ?? 0,
    combined_switches_total: combinedSwitchesTotal,
    combined_switch_velocity_peak: combinedSwitchVelocityPeak,
    combined_hourly_load: combinedHourlyLoad,

    computed_at: new Date().toISOString(),
  };
}

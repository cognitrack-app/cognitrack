/**
 * metrics/overlap.ts
 *
 * Weighted overlap calculation for combined hourly load.
 * ENG-06, ENG-07, ENG-08: Separate switch counts, configurable load split, weighted sum.
 * Replaces element-wise max with weighted sum capped at 100.
 */

export interface WeightedOverlapResult {
  combinedHourlyLoad: number[];
  phoneHighLoadOverlapHours: number;
}

/**
 * Calculate weighted overlap between phone and desktop hourly loads.
 * Uses configurable load split ratio (default 55% phone, 45% desktop).
 * Returns combined hourly load (weighted sum capped at 100) and
 * phone high-load overlap hours count.
 */
export function calculateWeightedOverlap(
  phoneHourlyLoad: number[],
  desktopHourlyLoad: number[],
  phoneWeight: number = 0.55,
  desktopWeight: number = 0.45
): WeightedOverlapResult {
  const HOURS = 24;
  
  // Validate inputs
  if (phoneHourlyLoad.length !== HOURS || desktopHourlyLoad.length !== HOURS) {
    throw new Error(`Hourly load arrays must have ${HOURS} elements`);
  }

  // Normalize weights to sum to 1
  const totalWeight = phoneWeight + desktopWeight;
  const normPhoneWeight = phoneWeight / totalWeight;
  const normDesktopWeight = desktopWeight / totalWeight;

  // Weighted sum per hour, capped at 100
  const combinedHourlyLoad: number[] = [];
  let phoneHighLoadOverlapHours = 0;

  for (let h = 0; h < HOURS; h++) {
    const phoneLoad = phoneHourlyLoad[h] ?? 0;
    const desktopLoad = desktopHourlyLoad[h] ?? 0;

    // Weighted sum: phoneWeight * phoneLoad + desktopWeight * desktopLoad
    const weightedLoad = Math.round(
      phoneLoad * normPhoneWeight + desktopLoad * normDesktopWeight
    );
    const cappedLoad = Math.min(100, weightedLoad);
    combinedHourlyLoad.push(cappedLoad);

    // ENG-06: Count overlap hours where BOTH phone > 20 AND desktop > 30
    if (phoneLoad > 20 && desktopLoad > 30) {
      phoneHighLoadOverlapHours++;
    }
  }

  return { combinedHourlyLoad, phoneHighLoadOverlapHours };
}

/**
 * Calculate separate switch counts for phone and desktop.
 * ENG-06: Returns both counts separately instead of summing.
 */
export function calculateSeparateSwitchCounts(
  phoneSwitches: number,
  desktopSwitches: number
): { phoneTotalSwitches: number; desktopTotalSwitches: number; combinedSwitchesTotal: number } {
  return {
    phoneTotalSwitches: phoneSwitches,
    desktopTotalSwitches: desktopSwitches,
    combinedSwitchesTotal: phoneSwitches + desktopSwitches,
  };
}

/**
 * Calculate combined cognitive load percentage.
 * Uses weighted average of phone and desktop load percentages.
 */
export function calculateCombinedLoad(
  phoneLoadPct: number,
  desktopLoadPct: number,
  phoneWeight: number = 0.55,
  desktopWeight: number = 0.45
): number {
  const totalWeight = phoneWeight + desktopWeight;
  const normPhoneWeight = phoneWeight / totalWeight;
  const normDesktopWeight = desktopWeight / totalWeight;

  return Math.min(100, Math.round(
    phoneLoadPct * normPhoneWeight + desktopLoadPct * normDesktopWeight
  ));
}
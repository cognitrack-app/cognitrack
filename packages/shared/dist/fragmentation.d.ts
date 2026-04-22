import type { CategoryBreakdown, DesktopCategoryBreakdown } from './types';
export interface FragmentationInput {
    /** 24-element array of 0-100 load percentages from phone */
    phoneHourlyDebt: number[];
    /** 24-element array of 0-100 load percentages from desktop */
    desktopHourlyDebt: number[];
    phoneCategoryBreakdown: CategoryBreakdown;
    desktopCategoryBreakdown: DesktopCategoryBreakdown;
}
export interface FragmentationReport {
    /** 0–24: number of hours both devices were simultaneously active above threshold */
    score: number;
    /** Raw count of hours with dual-device activity */
    dualActiveHours: number;
    /** Hour (0–23) at which dual-device load was highest */
    peakOverlapHour: number;
}
/**
 * Compute dual-device fragmentation score.
 *
 * An hour counts as "dual-active" when:
 *   - phone load > 20%  AND
 *   - desktop load > 30%
 *
 * This detects hours where the user was meaningfully engaged on BOTH
 * devices simultaneously, which is the primary fragmentation signal.
 */
export declare function computeDualDeviceFragmentation(input: FragmentationInput): FragmentationReport;
//# sourceMappingURL=fragmentation.d.ts.map
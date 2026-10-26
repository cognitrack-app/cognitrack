/**
 * metrics/categoryPct.ts
 *
 * Centralized category percentage calculation.
 * Used by mobile, desktop, and Cloud Functions to ensure identical results.
 * ENG-15: Single source of truth for category percentages.
 * Algorithm: floor first 4 categories, passiveWaste absorbs remainder.
 */

import type { CategoryBreakdown } from '../types';

/**
 * Calculate category percentages from duration map.
 * Uses floor for first 4 categories, passiveWaste absorbs remainder to sum exactly 100.
 * This ensures identical results across phone, desktop, and Cloud Functions.
 */
export function calculateCategoryPercentages(
  durationByCategory: Record<string, number>,
  totalDuration: number
): CategoryBreakdown {
  if (totalDuration <= 0) {
    return {
      productive: 0,
      tools: 0,
      entertainment: 0,
      social: 0,
      passiveWaste: 0,
    };
  }

  const rawPct = (ms: number) => (ms / totalDuration) * 100;

  const _productive = Math.floor(rawPct(durationByCategory['productive'] ?? 0));
  const _tools = Math.floor(rawPct(durationByCategory['tools'] ?? 0));
  const _entertainment = Math.floor(rawPct(durationByCategory['entertainment'] ?? 0));
  const _social = Math.floor(rawPct(durationByCategory['social'] ?? 0));
  const _passiveWaste = Math.floor(rawPct(durationByCategory['passiveWaste'] ?? 0));

  // Sum of floored first 4 categories
  const firstFourSum = _productive + _tools + _entertainment + _social;
  // passiveWaste absorbs remainder to make total exactly 100
  const _passiveWasteAdjusted = Math.max(0, 100 - firstFourSum);

  return {
    productive: _productive,
    tools: _tools,
    entertainment: _entertainment,
    social: _social,
    passiveWaste: _passiveWasteAdjusted,
  };
}

/**
 * Calculate desktop category breakdown with 5 categories (includes tools).
 * Same algorithm as calculateCategoryPercentages but returns DesktopCategoryBreakdown.
 */
export function calculateDesktopCategoryPercentages(
  durationByCategory: Record<string, number>,
  totalDuration: number
): { productive: number; tools: number; social: number; entertainment: number; passiveWaste: number } {
  return calculateCategoryPercentages(durationByCategory, totalDuration);
}
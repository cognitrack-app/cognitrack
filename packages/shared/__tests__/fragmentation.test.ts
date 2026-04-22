import { computeDualDeviceFragmentation } from '../src/fragmentation';
import type { CategoryBreakdown, DesktopCategoryBreakdown } from '../src/types';

// ─ Zero-value fixtures ───────────────────────────────────────────────────────
const ZERO_HOURLY = Array<number>(24).fill(0);
const ZERO_CAT: CategoryBreakdown = { productive: 0, entertainment: 0, social: 0, passiveWaste: 0 };
const ZERO_DESKTOP_CAT: DesktopCategoryBreakdown = { ...ZERO_CAT, tools: 0 };

function makeInput(
  phoneOverrides: Partial<Record<number, number>> = {},
  desktopOverrides: Partial<Record<number, number>> = {}
) {
  const phoneHourlyDebt = [...ZERO_HOURLY];
  const desktopHourlyDebt = [...ZERO_HOURLY];
  for (const [hour, val] of Object.entries(phoneOverrides)) {
    phoneHourlyDebt[Number(hour)] = val as number;
  }
  for (const [hour, val] of Object.entries(desktopOverrides)) {
    desktopHourlyDebt[Number(hour)] = val as number;
  }
  return {
    phoneHourlyDebt,
    desktopHourlyDebt,
    phoneCategoryBreakdown: ZERO_CAT,
    desktopCategoryBreakdown: ZERO_DESKTOP_CAT,
  };
}

describe('computeDualDeviceFragmentation', () => {
  // ─ Baseline: no activity ──────────────────────────────────────────
  test('both devices idle → score 0, dualActiveHours 0', () => {
    const result = computeDualDeviceFragmentation(makeInput());
    expect(result.score).toBe(0);
    expect(result.dualActiveHours).toBe(0);
  });

  test('only phone active, desktop idle → score 0', () => {
    const result = computeDualDeviceFragmentation(makeInput({ 10: 80 }, {}));
    expect(result.score).toBe(0);
  });

  test('only desktop active, phone idle → score 0', () => {
    const result = computeDualDeviceFragmentation(makeInput({}, { 10: 80 }));
    expect(result.score).toBe(0);
  });

  // ─ Threshold behaviour (strict greater-than) ──────────────────────
  test('phone=20, desktop=30 → NOT counted (need >20 and >30)', () => {
    // Exactly at threshold — both conditions use strict >, not >=
    const result = computeDualDeviceFragmentation(makeInput({ 10: 20 }, { 10: 30 }));
    expect(result.score).toBe(0);
  });

  test('phone=21, desktop=31 → counted (one above threshold)', () => {
    const result = computeDualDeviceFragmentation(makeInput({ 10: 21 }, { 10: 31 }));
    expect(result.score).toBe(1);
  });

  test('phone=20, desktop=31 → NOT counted (phone not above 20)', () => {
    const result = computeDualDeviceFragmentation(makeInput({ 10: 20 }, { 10: 31 }));
    expect(result.score).toBe(0);
  });

  test('phone=21, desktop=30 → NOT counted (desktop not above 30)', () => {
    const result = computeDualDeviceFragmentation(makeInput({ 10: 21 }, { 10: 30 }));
    expect(result.score).toBe(0);
  });

  // ─ Single dual-active hour ───────────────────────────────────────
  test('one overlapping hour → score 1, correct peakOverlapHour', () => {
    // 2pm (hour 14): phone=50, desktop=60 → dual-active
    const result = computeDualDeviceFragmentation(makeInput({ 14: 50 }, { 14: 60 }));
    expect(result.score).toBe(1);
    expect(result.dualActiveHours).toBe(1);
    expect(result.peakOverlapHour).toBe(14);
  });

  // ─ Multiple overlapping hours + peak detection ──────────────────
  test('three overlapping hours → score 3, peakOverlapHour is highest combined load', () => {
    // hour 9:  phone=30, desktop=40 → overlap sum = 70
    // hour 11: phone=25, desktop=35 → overlap sum = 60
    // hour 14: phone=50, desktop=60 → overlap sum = 110 ← peak
    const result = computeDualDeviceFragmentation(
      makeInput(
        { 9: 30, 11: 25, 14: 50 },
        { 9: 40, 11: 35, 14: 60 }
      )
    );
    expect(result.score).toBe(3);
    expect(result.dualActiveHours).toBe(3);
    expect(result.peakOverlapHour).toBe(14); // 110 > 70 > 60
  });

  test('peakOverlapHour correctly identifies earliest of equally-tied hours (first one wins)', () => {
    // Both hour 9 and 14 have the same combined overlap of 80
    const result = computeDualDeviceFragmentation(
      makeInput({ 9: 40, 14: 40 }, { 9: 40, 14: 40 })
    );
    // The first hour encountered wins the tie (loop order 0→23)
    expect(result.peakOverlapHour).toBe(9);
  });

  // ─ Score cap ─────────────────────────────────────────────────────────
  test('all 24 hours dual-active → score capped at 24, dualActiveHours = 24', () => {
    const full = Array<number>(24).fill(50);
    const result = computeDualDeviceFragmentation({
      phoneHourlyDebt: full,
      desktopHourlyDebt: full,
      phoneCategoryBreakdown: ZERO_CAT,
      desktopCategoryBreakdown: ZERO_DESKTOP_CAT,
    });
    expect(result.score).toBe(24);
    expect(result.dualActiveHours).toBe(24);
  });

  // ─ Return shape ──────────────────────────────────────────────────────
  test('result always contains score, dualActiveHours, and peakOverlapHour', () => {
    const result = computeDualDeviceFragmentation(makeInput());
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('dualActiveHours');
    expect(result).toHaveProperty('peakOverlapHour');
  });

  test('score === dualActiveHours when dualActiveHours < 24', () => {
    const result = computeDualDeviceFragmentation(makeInput({ 10: 50 }, { 10: 50 }));
    expect(result.score).toBe(result.dualActiveHours);
  });
});

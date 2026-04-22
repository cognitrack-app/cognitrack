import { computeVelocityMultiplier, getSwitchVelocity } from '../src/velocityMultiplier';
import { makeEvent, makeSwitch } from './helpers';

describe('computeVelocityMultiplier', () => {
  // ─ Boundary: no penalty zone (≤1 switch/min) ────────────────────────
  test('≤0 → 1.0 (idle, no switches)', () => {
    expect(computeVelocityMultiplier(0)).toBe(1.0);
  });

  test('0.5 switches/min → 1.0 (well within safe zone)', () => {
    expect(computeVelocityMultiplier(0.5)).toBe(1.0);
  });

  test('exactly 1.0 switch/min → 1.0 (safe/penalty boundary, inclusive)', () => {
    expect(computeVelocityMultiplier(1.0)).toBe(1.0);
  });

  // ─ Crisis hard-cap (≥4 switches/min) ──────────────────────────────
  test('exactly 4.0 switches/min → 2.5 (crisis ceiling)', () => {
    expect(computeVelocityMultiplier(4.0)).toBe(2.5);
  });

  test('>4 switches/min → 2.5 (hard-capped, not unbounded)', () => {
    expect(computeVelocityMultiplier(10.0)).toBe(2.5);
    expect(computeVelocityMultiplier(100.0)).toBe(2.5);
  });

  // ─ Linear interpolation (1–4 switches/min) ──────────────────────
  // Formula: 1.0 + (rate - 1.0) * 0.5
  test('2.0 switches/min → 1.5', () => {
    expect(computeVelocityMultiplier(2.0)).toBe(1.5);
  });

  test('3.0 switches/min → 2.0 (architecture doc reference value)', () => {
    // From arch doc: "Example: 3 switches/min → multiplier = 2.0"
    expect(computeVelocityMultiplier(3.0)).toBe(2.0);
  });

  test('2.5 switches/min → 1.75 (midpoint interpolation)', () => {
    // 1.0 + (2.5 - 1.0) * 0.5 = 1.75
    expect(computeVelocityMultiplier(2.5)).toBeCloseTo(1.75, 5);
  });

  test('1.5 switches/min → 1.25', () => {
    // 1.0 + (1.5 - 1.0) * 0.5 = 1.25
    expect(computeVelocityMultiplier(1.5)).toBeCloseTo(1.25, 5);
  });

  test('multiplier is monotonically increasing with switch rate', () => {
    const rates = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0];
    const multipliers = rates.map(computeVelocityMultiplier);
    for (let i = 1; i < multipliers.length; i++) {
      expect(multipliers[i]).toBeGreaterThanOrEqual(multipliers[i - 1]!);
    }
  });
});

describe('getSwitchVelocity', () => {
  test('returns 0 for empty event array', () => {
    expect(getSwitchVelocity([])).toBe(0);
  });

  test('counts only switch events, ignores break/idle/pickup', () => {
    const now = Date.now();
    const events = [
      makeEvent({ timestamp: now - 4 * 60_000, eventType: 'switch' }),
      makeEvent({ timestamp: now - 3 * 60_000, eventType: 'switch' }),
      makeEvent({ timestamp: now - 2 * 60_000, eventType: 'break' }),  // not counted
      makeEvent({ timestamp: now - 1 * 60_000, eventType: 'switch' }),
      makeEvent({ timestamp: now,               eventType: 'idle' }),  // not counted
    ];
    // 3 switches in 5-min window → 3/5 = 0.6/min
    expect(getSwitchVelocity(events)).toBeCloseTo(0.6, 5);
  });

  test('excludes switches outside the 5-minute window', () => {
    const now = Date.now();
    const events = [
      makeSwitch(now - 10 * 60_000, 'productive'), // 10 min ago — outside window
      makeSwitch(now -  1 * 60_000, 'productive'), // 1 min ago — inside window
    ];
    // now = last event ts = now-1min; windowStart = (now-1min) - 5min = now-6min
    // Only the 1-min-ago switch is inside the window → 1/5 = 0.2/min
    expect(getSwitchVelocity(events)).toBeCloseTo(0.2, 5);
  });

  test('4 switches in 5 min → 0.8 switches/min', () => {
    const base = 0;
    const events = [
      makeSwitch(base + 0,       'productive'),
      makeSwitch(base + 60_000,  'social'),
      makeSwitch(base + 120_000, 'productive'),
      makeSwitch(base + 180_000, 'social'),
    ];
    // window is 5 min from last event (base+180s), so all 4 are inside
    expect(getSwitchVelocity(events)).toBeCloseTo(0.8, 5);
  });

  test('uses custom window duration when provided', () => {
    const base = 0;
    const events = [
      makeSwitch(base + 0,      'productive'),
      makeSwitch(base + 30_000, 'social'),
    ];
    // Custom 1-minute window → 2 switches / 1 min = 2/min
    expect(getSwitchVelocity(events, 60_000)).toBeCloseTo(2.0, 5);
  });
});

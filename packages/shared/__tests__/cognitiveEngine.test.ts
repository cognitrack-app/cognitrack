import {
  calculateCognitiveDebt,
  updateWorkingMemory,
  updateFocusDepth,
} from '../src/cognitiveEngine';
import {
  WM_INITIAL,
  WM_FLOOR,
  WM_BREAK_GAIN,
  WM_FOCUS_GAIN,
  FOCUS_BUILD_THRESHOLD_MS,
  FOCUS_DEPTH_MAX,
  FOCUS_DEPTH_GAIN,
} from '../src/constants';
import { makeSwitch, makeBreak, makeIdle } from './helpers';

// ─── calculateCognitiveDebt ───────────────────────────────────────────────

describe('calculateCognitiveDebt — empty / minimal input', () => {
  test('empty array returns zeroed report', () => {
    const report = calculateCognitiveDebt([]);
    expect(report.cognitiveDebt).toBe(0);
    expect(report.cognitiveLoadPct).toBe(0);
    expect(report.wmCapacityRemaining).toBe(WM_INITIAL);
    expect(report.residueAtEOD).toBe(0);
    expect(report.hourlyDebt).toHaveLength(24);
    expect(report.hourlyDebt.every((h) => h === 0)).toBe(true);
  });

  test('single switch event generates positive debt', () => {
    const report = calculateCognitiveDebt([makeSwitch(0, 'productive')]);
    expect(report.cognitiveDebt).toBeGreaterThan(0);
  });
});

describe('calculateCognitiveDebt — context distance & asymmetry', () => {
  test('passiveWaste→productive switch costs MORE than productive→productive', () => {
    // passiveWaste→productive = 9.0, productive→productive = 1.0
    const highCost = calculateCognitiveDebt([
      makeSwitch(0,    'passiveWaste'),
      makeSwitch(1000, 'productive'),
    ]);
    const lowCost = calculateCognitiveDebt([
      makeSwitch(0,    'productive'),
      makeSwitch(1000, 'productive'),
    ]);
    expect(highCost.cognitiveDebt).toBeGreaterThan(lowCost.cognitiveDebt);
  });

  test('social→productive is the second most expensive switch (8.0 vs 9.0)', () => {
    const social = calculateCognitiveDebt([
      makeSwitch(0, 'social'),
      makeSwitch(1000, 'productive'),
    ]);
    const passiveWaste = calculateCognitiveDebt([
      makeSwitch(0, 'passiveWaste'),
      makeSwitch(1000, 'productive'),
    ]);
    // passiveWaste→productive (9.0) > social→productive (8.0)
    expect(passiveWaste.cognitiveDebt).toBeGreaterThan(social.cognitiveDebt);
    // social→productive (8.0) is still high
    expect(social.cognitiveDebt).toBeGreaterThan(0);
  });

  test('productive→productive is the cheapest switch (1.0 baseline)', () => {
    const cheap = calculateCognitiveDebt([
      makeSwitch(0, 'productive'),
      makeSwitch(1000, 'productive'),
    ]);
    const expensive = calculateCognitiveDebt([
      makeSwitch(0, 'passiveWaste'),
      makeSwitch(1000, 'productive'),
    ]);
    expect(expensive.cognitiveDebt).toBeGreaterThan(cheap.cognitiveDebt);
  });
});

describe('calculateCognitiveDebt — velocity penalty', () => {
  test('rapid switching generates more debt than equivalent spaced switching', () => {
    // 10 switches every 6s → 10/5 = 2.0/min by the 10th switch → 1.5x multiplier
    const rapidEvents = Array.from({ length: 10 }, (_, i) =>
      makeSwitch(i * 6_000, i % 2 === 0 ? 'productive' : 'social')
    );

    // 10 switches every 10min → always 1 switch per 5-min window → no penalty
    const spacedEvents = Array.from({ length: 10 }, (_, i) =>
      makeSwitch(i * 600_000, i % 2 === 0 ? 'productive' : 'social')
    );

    const rapid = calculateCognitiveDebt(rapidEvents);
    const spaced = calculateCognitiveDebt(spacedEvents);

    // Rapid has both velocity multiplier AND higher stacked residue
    expect(rapid.cognitiveLoadPct).toBeGreaterThan(spaced.cognitiveLoadPct);
  });
});

describe('calculateCognitiveDebt — break / idle events', () => {
  test('break event after heavy switching raises WM capacity', () => {
    // Many expensive switches deplete WM, then a break should restore it
    const events = [
      makeSwitch(0,     'passiveWaste'),
      makeSwitch(500,   'productive'),
      makeSwitch(1000,  'social'),
      makeSwitch(1500,  'productive'),
      makeBreak(2000),               // should restore +14 WM
    ];
    const withBreak    = calculateCognitiveDebt(events);

    const withoutBreak = calculateCognitiveDebt(events.slice(0, -1));

    expect(withBreak.wmCapacityRemaining).toBeGreaterThan(
      withoutBreak.wmCapacityRemaining
    );
  });

  test('idle event does not increase debt', () => {
    const withIdle = calculateCognitiveDebt([
      makeSwitch(0, 'productive'),
      makeIdle(5000),
    ]);
    const withoutIdle = calculateCognitiveDebt([
      makeSwitch(0, 'productive'),
    ]);
    // Idle adds no debt — should be equal or less
    expect(withIdle.cognitiveDebt).toBeLessThanOrEqual(
      withoutIdle.cognitiveDebt + 0.001
    );
  });
});

describe('calculateCognitiveDebt — output shape & bounds', () => {
  test('hourlyDebt always has exactly 24 elements', () => {
    const report = calculateCognitiveDebt([
      makeSwitch(0, 'productive'),
      makeSwitch(1000, 'social'),
    ]);
    expect(report.hourlyDebt).toHaveLength(24);
  });

  test('every hourlyDebt value is between 0 and 100 (inclusive)', () => {
    const report = calculateCognitiveDebt([
      makeSwitch(0, 'productive'),
      makeSwitch(500, 'social'),
    ]);
    report.hourlyDebt.forEach((h) => {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(100);
    });
  });

  test('cognitiveLoadPct is capped at 100 even on an extremely heavy day', () => {
    // 500 rapid switches between passiveWaste and productive — far exceeds threshold
    const events = Array.from({ length: 500 }, (_, i) =>
      makeSwitch(i * 200, i % 2 === 0 ? 'passiveWaste' : 'productive')
    );
    const report = calculateCognitiveDebt(events);
    expect(report.cognitiveLoadPct).toBeLessThanOrEqual(100);
    expect(report.cognitiveLoadPct).toBe(100); // should hit the cap
  });

  test('wmCapacityRemaining never drops below WM_FLOOR (15)', () => {
    const events = Array.from({ length: 200 }, (_, i) =>
      makeSwitch(i * 100, i % 2 === 0 ? 'passiveWaste' : 'productive')
    );
    const report = calculateCognitiveDebt(events);
    expect(report.wmCapacityRemaining).toBeGreaterThanOrEqual(WM_FLOOR);
  });

  test('residueAtEOD is between 0 and 1', () => {
    const events = [
      makeSwitch(0,    'productive'),
      makeSwitch(500,  'passiveWaste'),
      makeSwitch(1000, 'productive'),
    ];
    const report = calculateCognitiveDebt(events);
    expect(report.residueAtEOD).toBeGreaterThanOrEqual(0);
    expect(report.residueAtEOD).toBeLessThanOrEqual(1);
  });

  test('events sorted out-of-order produce same result as in-order', () => {
    const inOrder  = [makeSwitch(0, 'productive'), makeSwitch(5000, 'social')];
    const reversed = [makeSwitch(5000, 'social'),   makeSwitch(0, 'productive')];
    const r1 = calculateCognitiveDebt(inOrder);
    const r2 = calculateCognitiveDebt(reversed);
    expect(r1.cognitiveDebt).toBeCloseTo(r2.cognitiveDebt, 1);
  });
});

// ─── updateWorkingMemory ──────────────────────────────────────────────────

describe('updateWorkingMemory', () => {
  test('break adds WM_BREAK_GAIN (14)', () => {
    // 80 + 14 = 94
    expect(updateWorkingMemory(80, 0, true, false)).toBe(94);
  });

  test('break does not exceed WM_INITIAL cap (100)', () => {
    expect(updateWorkingMemory(95, 0, true, false)).toBe(WM_INITIAL);
    expect(updateWorkingMemory(100, 0, true, false)).toBe(WM_INITIAL);
  });

  test('sustained focus adds WM_FOCUS_GAIN (6)', () => {
    // 80 + 6 = 86
    expect(updateWorkingMemory(80, 0, false, true)).toBe(86);
  });

  test('switch cost depletes WM proportionally (WM_SWITCH_COST = 0.15)', () => {
    // 100 - 9.0 * 0.15 = 100 - 1.35 = 98.65 → rounds to 99
    expect(updateWorkingMemory(100, 9.0, false, false)).toBe(99);
  });

  test('zero switch cost does not change WM', () => {
    expect(updateWorkingMemory(75, 0, false, false)).toBe(75);
  });

  test('WM never drops below WM_FLOOR (15) regardless of switch cost', () => {
    expect(updateWorkingMemory(WM_FLOOR, 10000, false, false)).toBe(WM_FLOOR);
    expect(updateWorkingMemory(16, 1000, false, false)).toBe(WM_FLOOR);
  });

  test('break and sustained focus can stack', () => {
    // 70 + 14 + 6 = 90
    expect(updateWorkingMemory(70, 0, true, true)).toBe(90);
  });
});

// ─── updateFocusDepth ─────────────────────────────────────────────────────

describe('updateFocusDepth', () => {
  test('non-productive categories always return 0 (resets depth)', () => {
    expect(updateFocusDepth(20, FOCUS_BUILD_THRESHOLD_MS + 1, 'social')).toBe(0);
    expect(updateFocusDepth(20, FOCUS_BUILD_THRESHOLD_MS + 1, 'entertainment')).toBe(0);
    expect(updateFocusDepth(20, FOCUS_BUILD_THRESHOLD_MS + 1, 'passiveWaste')).toBe(0);
  });

  test('productive category accumulates depth after 5-minute threshold', () => {
    // Exactly at threshold: msSinceLastSwitch == FOCUS_BUILD_THRESHOLD_MS
    // Condition is: msSinceLastSwitch < threshold → false → gain fires
    expect(updateFocusDepth(0, FOCUS_BUILD_THRESHOLD_MS, 'productive')).toBe(FOCUS_DEPTH_GAIN);
  });

  test('tools category also accumulates focus depth', () => {
    expect(updateFocusDepth(0, FOCUS_BUILD_THRESHOLD_MS, 'tools')).toBe(FOCUS_DEPTH_GAIN);
  });

  test('no gain if time since last switch is below 5-minute threshold', () => {
    const currentDepth = 10;
    expect(
      updateFocusDepth(currentDepth, FOCUS_BUILD_THRESHOLD_MS - 1, 'productive')
    ).toBe(currentDepth);
  });

  test('focus depth is capped at FOCUS_DEPTH_MAX (30)', () => {
    expect(updateFocusDepth(FOCUS_DEPTH_MAX, FOCUS_BUILD_THRESHOLD_MS, 'productive')).toBe(FOCUS_DEPTH_MAX);
    expect(updateFocusDepth(FOCUS_DEPTH_MAX - 1, FOCUS_BUILD_THRESHOLD_MS, 'productive')).toBe(FOCUS_DEPTH_MAX);
  });

  test('depth increments by exactly FOCUS_DEPTH_GAIN (2) per qualifying window', () => {
    const result = updateFocusDepth(6, FOCUS_BUILD_THRESHOLD_MS, 'productive');
    expect(result).toBe(6 + FOCUS_DEPTH_GAIN);
  });
});

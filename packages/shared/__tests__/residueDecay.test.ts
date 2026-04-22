import { decayResidue, applySwitch } from '../src/residueDecay';
import { TAU_MS } from '../src/constants';

// ─── Pre-computed reference values ──────────────────────────────────────────
// TAU_MS = 7.67 * 60 * 1000 = 460,200 ms
// At t=τ:    e^(-1)      ≈ 0.3679
// At t=5min: e^(-0.6519) ≈ 0.5208  (NOT 0.37 — the arch doc had a typo)
// At t=23min:e^(-2.998)  ≈ 0.0500  (full recovery: <5% residue)
// At t=30min:e^(-3.911)  ≈ 0.0200

describe('decayResidue', () => {
  test('returns same value for zero delta (no time elapsed)', () => {
    expect(decayResidue(0.8, 0)).toBe(0.8);
    expect(decayResidue(1.0, 0)).toBe(1.0);
    expect(decayResidue(0.0, 0)).toBe(0.0);
  });

  test('returns residue unchanged for negative delta', () => {
    expect(decayResidue(0.5, -5000)).toBe(0.5);
  });

  test('zero residue always stays zero regardless of time', () => {
    expect(decayResidue(0, TAU_MS)).toBe(0);
    expect(decayResidue(0, 23 * 60 * 1000)).toBe(0);
  });

  test('residue decays to 1/e (~36.8%) after exactly one τ (7.67 min)', () => {
    // e^(-TAU_MS / TAU_MS) = e^(-1) ≈ 0.3679
    const result = decayResidue(1.0, TAU_MS);
    expect(result).toBeCloseTo(0.3679, 3);
  });

  test('residue is ~52% of initial after 5 minutes', () => {
    // e^(-300000 / 460200) = e^(-0.6519) ≈ 0.5208
    const result = decayResidue(1.0, 5 * 60 * 1000);
    expect(result).toBeCloseTo(0.521, 2);
  });

  test('residue drops to ~5% after 23 min (full recovery per architecture spec)', () => {
    // This validates the 23-minute recovery window from Leroy 2009
    const result = decayResidue(1.0, 23 * 60 * 1000);
    expect(result).toBeCloseTo(0.05, 2);
  });

  test('residue is ~2% after 30 min (well below recovery threshold)', () => {
    const result = decayResidue(1.0, 30 * 60 * 1000);
    expect(result).toBeCloseTo(0.02, 2);
  });

  test('decay scales proportionally with initial residue value', () => {
    // decayResidue(0.5, t) should equal 0.5 * decayResidue(1.0, t)
    const full = decayResidue(1.0, TAU_MS);
    const half = decayResidue(0.5, TAU_MS);
    expect(half).toBeCloseTo(full * 0.5, 5);
  });

  test('longer time → lower residue (monotonic decay)', () => {
    const r1 = decayResidue(1.0, 1 * 60 * 1000);  // 1 min
    const r2 = decayResidue(1.0, 5 * 60 * 1000);  // 5 min
    const r3 = decayResidue(1.0, 15 * 60 * 1000); // 15 min
    const r4 = decayResidue(1.0, 30 * 60 * 1000); // 30 min
    expect(r1).toBeGreaterThan(r2);
    expect(r2).toBeGreaterThan(r3);
    expect(r3).toBeGreaterThan(r4);
  });
});

describe('applySwitch', () => {
  test('zero initial residue + max cost switch → 1.0 (normalized from 9/9)', () => {
    // passiveWaste→productive = 9.0; 9.0/9.0 = 1.0
    const result = applySwitch(0, 0, 9.0);
    expect(result).toBeCloseTo(1.0, 5);
  });

  test('zero initial residue + baseline switch cost → 1/9 ≈ 0.111', () => {
    // productive→productive = 1.0; 1.0/9.0 ≈ 0.111
    const result = applySwitch(0, 0, 1.0);
    expect(result).toBeCloseTo(0.111, 2);
  });

  test('stacks new residue on undecayed existing residue (0ms between)', () => {
    // decayed(0.5, 0ms) = 0.5; new = 4.5/9.0 = 0.5 → total = 1.0 (capped)
    const result = applySwitch(0.5, 0, 4.5);
    expect(result).toBeCloseTo(1.0, 5);
  });

  test('result is always capped at 1.0', () => {
    // Full residue + max cost
    expect(applySwitch(1.0, 0, 9.0)).toBeLessThanOrEqual(1.0);
    // Over-stacking
    expect(applySwitch(0.9, 0, 9.0)).toBeLessThanOrEqual(1.0);
  });

  test('fully recovered residue: only new switch cost remains', () => {
    // After 30 min, old residue(1.0) decays to ~0.020
    // productive→productive cost = 1.0 → new = 1.0/9.0 ≈ 0.111
    // total ≈ 0.020 + 0.111 = 0.131
    const thirtyMin = 30 * 60 * 1000;
    const result = applySwitch(1.0, thirtyMin, 1.0);
    expect(result).toBeCloseTo(0.131, 2);
  });

  test('result is always non-negative', () => {
    expect(applySwitch(0, 5 * 60 * 1000, 1.0)).toBeGreaterThanOrEqual(0);
    expect(applySwitch(0.1, 30 * 60 * 1000, 0.1)).toBeGreaterThanOrEqual(0);
  });
});

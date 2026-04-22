import { TAU_MS } from './constants';

/**
 * Exponential decay of attention residue over time.
 * R(dt) = residue * e^(-dt / TAU_MS)
 * At dt = 23 min: R ≈ 0.05 (5% residue = fully recovered)
 */
export function decayResidue(residue: number, deltaMs: number): number {
  if (deltaMs <= 0) return residue;
  return residue * Math.exp(-deltaMs / TAU_MS);
}

/**
 * Apply a new context switch on top of existing (partially decayed) residue.
 * switchCost is the raw context distance value (1.0–9.0 scale).
 * New residue stacks on undecayed old residue — models unresolved prior task.
 */
export function applySwitch(
  currentResidue: number,
  timeSinceLastSwitchMs: number,
  switchCost: number
): number {
  const decayed = decayResidue(currentResidue, timeSinceLastSwitchMs);
  // Normalise switchCost (max 9.0) to 0–1 contribution
  const newResidueFromSwitch = Math.min(1.0, switchCost / 9.0);
  return Math.min(1.0, decayed + newResidueFromSwitch);
}

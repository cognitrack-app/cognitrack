/**
 * Exponential decay of attention residue over time.
 * R(dt) = residue * e^(-dt / TAU_MS)
 * At dt = 23 min: R ≈ 0.05 (5% residue = fully recovered)
 */
export declare function decayResidue(residue: number, deltaMs: number): number;
/**
 * Apply a new context switch on top of existing (partially decayed) residue.
 * switchCost is the raw context distance value (1.0–9.0 scale).
 * New residue stacks on undecayed old residue — models unresolved prior task.
 */
export declare function applySwitch(currentResidue: number, timeSinceLastSwitchMs: number, switchCost: number): number;
//# sourceMappingURL=residueDecay.d.ts.map
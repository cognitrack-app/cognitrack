import type { AppEvent, Category, CognitiveReport } from './types';
export declare function updateWorkingMemory(currentWM: number, switchCost: number, isBreak: boolean, isSustainedFocus: boolean): number;
export declare function updateFocusDepth(currentDepth: number, msSinceLastSwitch: number, category: Category): number;
/**
 * Run the full cognitive state machine over a day's worth of AppEvents.
 *
 * Events MUST be for a single day and single device.
 * Returns a CognitiveReport suitable for Firestore sync.
 */
export declare function calculateCognitiveDebt(events: AppEvent[]): CognitiveReport;
//# sourceMappingURL=cognitiveEngine.d.ts.map
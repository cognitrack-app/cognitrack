export type Category = 'productive' | 'tools' | 'social' | 'entertainment' | 'passiveWaste';
export type Platform = 'darwin' | 'win32' | 'android' | 'ios';
export type DeviceType = 'phone' | 'desktop';
export interface AppEvent {
    id: string;
    timestamp: number;
    appId: string;
    category: Category;
    durationMs: number;
    eventType: 'switch' | 'pickup' | 'break' | 'idle';
    deviceType: DeviceType;
}
export interface CognitiveState {
    wm_capacity: number;
    residue: number;
    focus_depth: number;
    last_switch_ts: number;
    last_residue_decay_ts: number;
}
export interface CognitiveReport {
    cognitiveDebt: number;
    cognitiveLoadPct: number;
    wmCapacityRemaining: number;
    residueAtEOD: number;
    hourlyDebt: number[];
    peakLoadHour: number;
}
export interface CategoryBreakdown {
    productive: number;
    entertainment: number;
    social: number;
    passiveWaste: number;
}
export interface DesktopCategoryBreakdown extends CategoryBreakdown {
    tools: number;
}
export interface PhoneSyncPayload {
    date: string;
    deviceId: string;
    agentType: 'phone';
    platform: 'android' | 'ios';
    cognitiveDebt: number;
    cognitiveLoadPct: number;
    wmCapacityRemaining: number;
    residueAtEOD: number;
    totalScreenTime: number;
    totalSwitches: number;
    totalPickups: number;
    switchVelocityPeak: number;
    categoryBreakdown: CategoryBreakdown;
    peakLoadHour: number;
    hourlyLoad: number[];
    lastUpdated: string;
}
export interface DesktopSyncPayload {
    deviceId: string;
    agentType: 'desktop';
    platform: 'darwin' | 'win32';
    cognitiveDebt: number;
    cognitiveLoadPct: number;
    wmCapacityRemaining: number;
    residueAtEOD: number;
    totalSwitches: number;
    totalFocusedTime: number;
    switchVelocityPeak: number;
    categoryBreakdown: DesktopCategoryBreakdown;
    peakLoadHour: number;
    hourlyLoad: number[];
    lastUpdated: string;
}
export interface SessionDocument {
    date: string;
    phoneMetrics?: PhoneSyncPayload;
    desktopSessions?: Record<string, DesktopSyncPayload>;
    combinedLoad?: number;
    dualFragmentation?: number;
    phoneInterruptsDuringWork?: number;
    lastMergeRun?: string;
}
//# sourceMappingURL=types.d.ts.map
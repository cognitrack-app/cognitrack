import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload bridge — exposes ONLY safe, typed channels to the renderer.
 *
 * Security model:
 *  - contextIsolation: true — renderer has NO access to Node.js or Electron
 *    internals directly. It can only call the functions listed here.
 *  - Every channel name is hardcoded — the renderer cannot invoke arbitrary
 *    IPC channels.
 *
 * Auth: Google OAuth is handled entirely by Firebase signInWithPopup() in
 * the renderer, allowed via setWindowOpenHandler in index.ts (no custom
 * deep-link protocol or separate OAuth IPC channel needed).
 *
 * Channels exposed:
 *  — Stats / tracking ——————————————————————————————
 *  tray:getStats       → invoke → TrayStats
 *  tracker:pause       → invoke → { isTracking: false }
 *  tracker:resume      → invoke → { isTracking: true }
 *  tray:statsUpdate    → on     → TrayStats (pushed from main after each batch)
 *
 *  — Auth ——————————————————————————————————————————
 *  auth:signedIn       → send   → void (renderer signals sign-in complete to main)
 *
 *  — Mobile sync —————————————————————————————————
 *  sync:pullMobileData → invoke → MobileData | null
 */

export interface TrayStats {
  isTracking:          boolean;
  cognitiveLoadPct:    number;
  totalSwitches:       number;
  wmCapacityRemaining: number;
  syncStatus: {
    pending: number;
    syncing: number;
    synced:  number;
    failed:  number;
    total:   number;
  };
}

/**
 * Shape of the phoneMetrics field from Firestore.
 * Mirrors PhoneSyncPayload from @cognitrack/shared — typed loosely here
 * so the preload doesn’t need a direct dependency on the shared package at
 * runtime (it runs in a sandboxed context with contextIsolation: true).
 */
export interface MobileData {
  cognitiveLoadPct?:    number;
  totalScreenTimeMin?:  number;
  appSwitches?:         number;
  wmCapacityRemaining?: number;
  lastUpdated?:         string;
  [key: string]: unknown;
}

export interface ElectronAPI {
  getStats:        () => Promise<TrayStats>;
  pauseTracking:   () => Promise<{ isTracking: boolean }>;
  resumeTracking:  () => Promise<{ isTracking: boolean }>;
  onStatsUpdate:   (cb: (stats: TrayStats) => void) => () => void;
  signIn:          (uid: string) => void;
  syncMobileData:  (date?: string) => Promise<MobileData | null>;
}

contextBridge.exposeInMainWorld('electronAPI', {

  getStats:       () => ipcRenderer.invoke('tray:getStats'),
  pauseTracking:  () => ipcRenderer.invoke('tracker:pause'),
  resumeTracking: () => ipcRenderer.invoke('tracker:resume'),

  /**
   * BUG-1 FIX — onStatsUpdate live push handler.
   *
   * ORIGINAL (broken):
   *   const handler = (_event, TrayStats) => cb(data);
   *   - `TrayStats` used as param name (shadows the type declaration)
   *   - `data` never declared in scope → ReferenceError on every IPC push
   *   Result: live tray stats NEVER updated; only 30s poll fallback worked.
   *
   * FIX: rename to ` TrayStats` — typed correctly and in scope.
   */
  onStatsUpdate: (cb: (stats: TrayStats) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, stats: TrayStats): void => cb(stats);
    ipcRenderer.on('tray:statsUpdate', handler);
    return () => ipcRenderer.removeListener('tray:statsUpdate', handler);
  },

  signIn: (uid: string) => ipcRenderer.send('auth:signedIn', uid),

  syncMobileData: (date?: string) => ipcRenderer.invoke('sync:pullMobileData', date),

} satisfies ElectronAPI);

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
 * Channels exposed:
 *  — Stats / tracking ——————————————————————————————
 *  tray:getStats       → invoke → TrayStats
 *  tracker:pause       → invoke → { isTracking: false }
 *  tracker:resume      → invoke → { isTracking: true }
 *  tray:statsUpdate    → on     → TrayStats (pushed from main after each batch)
 *
 *  — Auth ——————————————————————————————————————————
 *  auth:signedIn       → send   → void  (renderer signals sign-in to main)
 *  auth:triggerGoogle  → invoke → Promise<string> uid  (starts OAuth flow)
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

export interface ElectronAPI {
  getStats:            () => Promise<TrayStats>;
  pauseTracking:       () => Promise<{ isTracking: boolean }>;
  resumeTracking:      () => Promise<{ isTracking: boolean }>;
  onStatsUpdate:       (cb: (stats: TrayStats) => void) => () => void;
  signIn:              (uid: string) => void;
  triggerGoogleSignIn: () => Promise<string>;
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
   *   Problem 1: `TrayStats` was used as the parameter NAME, shadowing the
   *              interface declaration and giving the param a useless type.
   *   Problem 2: `data` was referenced inside the arrow body but was NEVER
   *              declared in scope — this is a ReferenceError at runtime.
   *   Result:    The ipcRenderer listener registered successfully but threw
   *              on every invocation. Live stats updates from main (pushed
   *              after each hourly batch) silently crashed and NEVER reached
   *              the renderer. Only the 30-second polling fallback worked.
   *
   * FIX: rename parameter to ` TrayStats` — typed correctly, in scope.
   */
  onStatsUpdate: (cb: (stats: TrayStats) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent,  TrayStats): void => cb(data);
    ipcRenderer.on('tray:statsUpdate', handler);
    return () => ipcRenderer.removeListener('tray:statsUpdate', handler);
  },

  signIn: (uid: string) => ipcRenderer.send('auth:signedIn', uid),

  triggerGoogleSignIn: () => ipcRenderer.invoke('auth:triggerGoogle'),

} satisfies ElectronAPI);

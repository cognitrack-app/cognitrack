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
 *  ─ Stats / tracking ────────────────────────────────────
 *  tray:getStats       → invoke → TrayStats
 *  tracker:pause       → invoke → { isTracking: false }
 *  tracker:resume      → invoke → { isTracking: true }
 *  tray:statsUpdate    → on     → TrayStats (pushed from main after each batch)
 *
 *  ─ Auth ───────────────────────────────────────────
 *  auth:signedIn       → send  → void  (renderer signals sign-in to main)
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
  // ─ Stats / tracking ──────────────────────────────────────
  getStats:       () => Promise<TrayStats>;
  pauseTracking:  () => Promise<{ isTracking: boolean }>;
  resumeTracking: () => Promise<{ isTracking: boolean }>;
  onStatsUpdate:  (cb: (stats: TrayStats) => void) => () => void;

  // ─ Auth: email/password (existing) ────────────────────────
  /** Signals to the main process that the user has signed in. */
  signIn: (uid: string) => void;

  // ─ Auth: Google OAuth via system browser ────────────────────
  /**
   * Triggers Google OAuth via the system browser (shell.openExternal).
   * Returns a Promise that resolves with the Firebase UID once the user
   * completes sign-in and the deep-link callback is processed by main.
   * Rejects with an Error if the user cancels or if a timeout occurs.
   */
  triggerGoogleSignIn: () => Promise<string>;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // ─ Stats / tracking ──────────────────────────────────────
  getStats:       () => ipcRenderer.invoke('tray:getStats'),
  pauseTracking:  () => ipcRenderer.invoke('tracker:pause'),
  resumeTracking: () => ipcRenderer.invoke('tracker:resume'),

  // Real-time stats pushed from main after each batch
  onStatsUpdate: (cb: (stats: TrayStats) => void) => {
    const handler = (_event: Electron.IpcRendererEvent,  TrayStats) => cb(data);
    ipcRenderer.on('tray:statsUpdate', handler);
    // Return cleanup function so React useEffect can unsubscribe on unmount
    return () => ipcRenderer.removeListener('tray:statsUpdate', handler);
  },

  // ─ Auth ─────────────────────────────────────────────────
  // Email/password: renderer signals main that sign-in is complete
  signIn: (uid: string) => ipcRenderer.send('auth:signedIn', uid),

  // Google OAuth: invoke triggers the system-browser flow in main process.
  // The Promise resolves with the Firebase UID after the deep-link callback.
  triggerGoogleSignIn: () => ipcRenderer.invoke('auth:triggerGoogle'),

} satisfies ElectronAPI);

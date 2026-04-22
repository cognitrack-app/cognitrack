import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload bridge — exposes ONLY tray-popover channels to the renderer.
 *
 * The desktop agent has no dashboard. The renderer is a tiny 240×180 popover
 * showing 3 metrics + pause/resume. All heavy UI lives in the mobile app.
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
  getStats:       () => Promise<TrayStats>;
  pauseTracking:  () => Promise<{ isTracking: boolean }>;
  resumeTracking: () => Promise<{ isTracking: boolean }>;
  onStatsUpdate:  (cb: (stats: TrayStats) => void) => () => void;
  signIn:         (uid: string) => void;
}

contextBridge.exposeInMainWorld('electronAPI', {
  getStats:       () => ipcRenderer.invoke('tray:getStats'),
  pauseTracking:  () => ipcRenderer.invoke('tracker:pause'),
  resumeTracking: () => ipcRenderer.invoke('tracker:resume'),

  // Real-time stats pushed from main after each batch
  onStatsUpdate: (cb: (stats: TrayStats) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: TrayStats) => cb(data);
    ipcRenderer.on('tray:statsUpdate', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('tray:statsUpdate', handler);
  },

  // Auth: renderer can signal sign-in complete
  signIn: (uid: string) => ipcRenderer.send('auth:signedIn', uid),
} satisfies ElectronAPI);
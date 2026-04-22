"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    getStats: () => electron_1.ipcRenderer.invoke('tray:getStats'),
    pauseTracking: () => electron_1.ipcRenderer.invoke('tracker:pause'),
    resumeTracking: () => electron_1.ipcRenderer.invoke('tracker:resume'),
    // Real-time stats pushed from main after each batch
    onStatsUpdate: (cb) => {
        const handler = (_event, data) => cb(data);
        electron_1.ipcRenderer.on('tray:statsUpdate', handler);
        // Return cleanup function
        return () => electron_1.ipcRenderer.removeListener('tray:statsUpdate', handler);
    },
    // Auth: renderer can signal sign-in complete
    signIn: (uid) => electron_1.ipcRenderer.send('auth:signedIn', uid),
});
//# sourceMappingURL=index.js.map
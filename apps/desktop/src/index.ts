// Load environment variables BEFORE any Firebase-dependent imports
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from 'electron';
import { registerIpcHandlers } from './electron/main/ipcHandlers';
import { SQLiteStore } from './electron/main/sqliteStore';
import { ActiveWindowTracker } from './electron/main/activeWindowTracker';
import { waitForAuth, getTodayDateString } from './electron/main/utils';
import { getDeviceId } from './electron/main/deviceId';
import { processBatch } from './electron/main/batchProcessor';
import { SyncEngine } from '@cognitrack/sync-engine';
import { registerDevice, onAuthChange } from '@cognitrack/api-client';
import { ensureAccessibilityPermission } from './electron/main/macPermissions';

// ── Module-level singletons (set once in whenReady) ─────────────────────────────

let store:      SQLiteStore;
let syncEngine: SyncEngine;
let tracker:    ActiveWindowTracker;
let mainWindow: BrowserWindow | null = null;
let tray:       Tray | null = null;
let userId:     string;
let deviceId:   string;

// ── Single-instance lock ───────────────────────────────────────────────────────────
//
// Multiple instances fight for the SQLite WAL lock and corrupt the database.
// requestSingleInstanceLock() must be called BEFORE app.whenReady().

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.error('[startup] Another instance is already running. Exiting.');
  app.quit();
}

// ── App lifecycle ──────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {

  // 1. Auto-launch on login
  // FIX: openAsHidden is macOS-only. On Windows, pass --hidden as a launch arg
  // and guard it in step 14. electron-builder's auto-launcher handles this arg.
  app.setLoginItemSettings({
    openAtLogin: true,
    args:        ['--hidden'],
    name:        'CogniTrack',
  });

  // 1b. macOS: hide Dock icon — CogniTrack is a tray-only agent.
  // app.dock is undefined on Windows so the optional chain is safe.
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  // 2. SQLite — must be first; tracker writes events immediately
  store = new SQLiteStore();

  // 3. Sync queue db in the same userData directory.
  // FIX: Ensure the 'db' subdirectory exists before SyncEngine tries to open
  // its file inside it. Without this, SyncEngine crashes on fresh installs
  // because SQLiteStore only creates cognitrack.db's directory, not the parent.
  const dbDir = path.join(app.getPath('userData'), 'db');
  fs.mkdirSync(dbDir, { recursive: true });
  const queueDbPath = path.join(dbDir, 'sync-queue.db');
  syncEngine = new SyncEngine(queueDbPath);

  // 4. Active window tracker (no start yet — needs auth + permission first)
  tracker = new ActiveWindowTracker(store);

  // 5. Tray popover window (hidden by default)
  //    280px: fits TrayPopover (stats + mobile section + footer) without scrollbar.
  //    320px was needed for the sign-in form; TrayPopover is shorter.
  mainWindow = createPopoverWindow();

  // 6. System tray
  tray = createTray();

  // 7. IPC handlers
  // FIX: pass refreshTray callback so pause/resume handlers can update the
  // tray context menu label immediately (without waiting for the next batch).
  // FIX: pass getUserId getter so sync:pullMobileData reads the post-auth UID
  // (registerIpcHandlers is called before sign-in completes).
  registerIpcHandlers(
    store,
    tracker,
    syncEngine,
    () => tray?.setContextMenu(buildTrayMenu()),
    () => userId,
  );

  // 8. Load the renderer
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  // 9. Keep userId in sync for any post-auth token refreshes
  onAuthChange(user => {
    if (user) userId = user.uid;
  });

  // 10. Wait for Firebase auth before doing anything network-related.
  //     waitForAuth() resolves immediately if a cached token exists (< 1 s).
  //     If not, show the popover and wait for the renderer to signal sign-in.
  try {
    userId = await waitForAuth();
  } catch (err) {
    console.warn('[startup] Not authenticated, showing popover:', err);
    showPopover();

    // FIX: Retry loop — waitForAuthFromRenderer() uses ipcMain.on (not .once)
    // so renderer reloads can re-signal. On failure, reload the renderer and
    // wait again instead of crashing or hanging.
    let authSuccess = false;
    while (!authSuccess) {
      try {
        userId = await waitForAuthFromRenderer();
        authSuccess = true;
      } catch (authErr) {
        console.error('[startup] Auth from renderer failed, reloading:', authErr);
        mainWindow?.reload();
      }
    }
  }

  // 11. Register/update this device in Firestore
  deviceId = getDeviceId();
  await registerDevice(
    userId, deviceId, process.platform as 'win32' | 'darwin', 'CogniTrack Desktop', app.getVersion(),
  ).catch(err => console.warn('[startup] Device registration failed (non-fatal):', err));

  // 12. Mark sync engine online and flush any queued items
  syncEngine.setOnline(true);

  // 13. Check macOS Accessibility permission before starting tracker.
  //     active-win requires this to read the frontmost app name.
  //     Returns true immediately on Windows/Linux (permission not needed).
  //     If denied on macOS, shows a branded dialog and returns false.
  const hasPermission = await ensureAccessibilityPermission();
  if (hasPermission) {
    tracker.start();
    // Refresh tray menu now that tracker is running — buildTrayMenu() was
    // called during createTray() before tracker.start(), so the initial label
    // incorrectly showed "○ Tracking Paused" on every cold launch.
    tray?.setContextMenu(buildTrayMenu());
  } else {
    console.warn('[startup] Accessibility permission not granted — tracker not started');
  }

  // 14. Hourly batch: compute cognitive metrics and sync to Firestore
  scheduleHourlyBatch();

  // 15. If launched with --hidden (OS startup item), ensure popover stays closed
  if (process.argv.includes('--hidden')) {
    mainWindow?.hide();
  }

  console.log(`[startup] CogniTrack ready — userId=${userId} deviceId=${deviceId}`);
});

// ── Shutdown ─────────────────────────────────────────────────────────────────────────────

// Flush final batch and clean up before quitting.
//
// FIX: Electron does NOT await async before-quit handlers — the process would
// exit immediately after the handler function returns, before any awaited work
// runs. The final batch (the most important one) was silently skipped on every
// quit. Fix: e.preventDefault() blocks the OS quit, we run cleanup in an IIFE,
// then call app.exit(0) which bypasses before-quit to avoid re-emission.
app.on('before-quit', (e) => {
  e.preventDefault();
  (async () => {
    console.log('[shutdown] Running final batch before quit…');
    if (store && syncEngine && userId && deviceId) {
      await processBatch(store, syncEngine, userId, deviceId, mainWindow, tracker).catch(console.error);
    }
    tracker?.stop();
    store?.close();
    app.exit(0); // bypasses before-quit to avoid recursion
  })();
});

// Keep running in tray when all windows are closed
app.on('window-all-closed', () => {
  // Do nothing — prevents Electron's default app.quit() on window close
});

// ── Popover window factory ───────────────────────────────────────────────────────────

function createPopoverWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width:          260,
    height:         280,
    frame:          false,
    resizable:      false,
    skipTaskbar:    true,
    alwaysOnTop:    true,
    show:           false,
    transparent:    true,
    hasShadow:      true,
    webPreferences: {
      preload:          path.join(__dirname, 'electron/preload/index.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false, // sandbox:true breaks CommonJS preload on Electron 30
    },
  });

  // Click-away dismissal
  win.on('blur', () => win.hide());

  // Never truly close — just hide
  win.on('close', (e) => {
    e.preventDefault();
    win.hide();
  });

  // FIX: Allow Firebase signInWithPopup to open a popup window.
  // Electron v30+ denies all window.open() calls by default (no handler = deny).
  // Firebase Auth SDK uses window.open() to launch the Google OAuth consent page.
  // Without this handler the popup is silently blocked and Google sign-in hangs.
  // Allow only Firebase/Google auth URLs; all other links go to system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const isAuthUrl =
      url.startsWith('https://accounts.google.com') ||
      url.includes('.firebaseapp.com/__/auth')     ||
      url.startsWith('https://apis.google.com');

    if (isAuthUrl) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width:       500,
          height:      620,
          resizable:   false,
          alwaysOnTop: true,
        },
      };
    }

    shell.openExternal(url).catch(console.error);
    return { action: 'deny' };
  });

  return win;
}

// ── Show popover anchored to tray icon ─────────────────────────────────────────────

function showPopover(): void {
  if (!mainWindow || !tray) return;

  const trayBounds = tray.getBounds();
  const winBounds  = mainWindow.getBounds();

  const x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);

  // FIX: macOS menu bar is at the TOP of the screen — the popover must open
  // BELOW the tray icon. The original code always placed it ABOVE, which put
  // the window off-screen on macOS. Windows taskbar is at the BOTTOM —
  // popover goes ABOVE.
  const y = process.platform === 'darwin'
    ? Math.round(trayBounds.y + trayBounds.height + 4)   // macOS: below icon
    : Math.round(trayBounds.y - winBounds.height  - 4);  // Windows: above icon

  mainWindow.setPosition(x, y);
  mainWindow.show();
  mainWindow.focus();
}

// ── System tray ───────────────────────────────────────────────────────────────────────

function createTray(): Tray {
  // macOS menu bar icons must be named *Template.png so Electron auto-inverts
  // them for dark/light mode. Windows uses the full-colour PNG.
  const isMac     = process.platform === 'darwin';
  const iconName  = isMac ? 'tray-iconTemplate.png' : 'tray-icon.png';
  const iconPath  = app.isPackaged
    ? path.join(process.resourcesPath, 'assets', iconName)
    : path.join(__dirname, '../assets', iconName);

  const icon = nativeImage.createFromPath(iconPath);
  const t    = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

  t.setToolTip('CogniTrack — Cognitive Load Tracker');

  t.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      showPopover();
    }
  });

  t.setContextMenu(buildTrayMenu());
  return t;
}

function buildTrayMenu(): Menu {
  const isTracking = tracker?.isRunning() ?? false;
  return Menu.buildFromTemplate([
    {
      label:   isTracking ? '● Tracking Active' : '○ Tracking Paused',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: isTracking ? 'Pause Tracking' : 'Resume Tracking',
      click: () => {
        if (tracker?.isRunning()) {
          tracker.stop();
        } else {
          tracker?.start();
        }
        tray?.setContextMenu(buildTrayMenu());
      },
    },
    { type: 'separator' },
    {
      label: 'Quit CogniTrack',
      click: () => {
        mainWindow?.destroy();
        mainWindow = null;
        app.quit();
      },
    },
  ]);
}

// ── Hourly batch scheduler ─────────────────────────────────────────────────────────────

function scheduleHourlyBatch(): void {
  const ONE_HOUR = 60 * 60 * 1000;

  // Run immediately so today's partial data is available on startup
  processBatch(store, syncEngine, userId, deviceId, mainWindow, tracker).catch(console.error);

  // Then every hour with ±5-min jitter to avoid thundering-herd on shared Firestore
  const jitter = Math.floor(Math.random() * 5 * 60 * 1000);
  setInterval(() => {
    processBatch(store, syncEngine, userId, deviceId, mainWindow, tracker).catch(console.error);
    tray?.setContextMenu(buildTrayMenu());
  }, ONE_HOUR + jitter);
}

// ── Helper: wait for sign-in signal from renderer ──────────────────────────────────────

/**
 * Resolves with the Firebase UID when the renderer emits 'auth:signedIn'.
 *
 * FIX (CRIT-5): Uses ipcMain.on (not .once) so renderer reloads can re-signal.
 * With ipcMain.once, if the renderer reloads during sign-in (e.g. after a
 * failed attempt), the second auth:signedIn message is silently dropped and
 * startup hangs forever.
 *
 * On an invalid UID, logs a warning and keeps listening — the renderer may
 * reload and send a valid UID. Only resolves/cleans-up on a valid UID.
 * Rejects after 5 minutes if the event never fires.
 */
function waitForAuthFromRenderer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener('auth:signedIn', handler);
      reject(new Error('[auth] Sign-in timeout: renderer did not emit auth:signedIn within 5 minutes'));
    }, 5 * 60 * 1000);

    function handler(_event: Electron.IpcMainEvent, uid: string): void {
      if (typeof uid !== 'string' || uid.trim().length < 20) {
        console.warn(`[auth] Invalid UID from renderer: "${uid}" — waiting for retry`);
        return; // keep listener alive
      }
      clearTimeout(timeout);
      ipcMain.removeListener('auth:signedIn', handler);
      resolve(uid.trim());
    }

    ipcMain.on('auth:signedIn', handler);
  });
}

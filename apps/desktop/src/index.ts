// Load environment variables BEFORE any Firebase-dependent imports
import 'dotenv/config';
import path from 'path';
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron';
import { registerIpcHandlers } from './electron/main/ipcHandlers';
import { SQLiteStore } from './electron/main/sqliteStore';
import { ActiveWindowTracker } from './electron/main/activeWindowTracker';
import { waitForAuth, getTodayDateString } from './electron/main/utils';
import { getWindowsDeviceId } from './electron/main/deviceId';
import { processBatch } from './electron/main/batchProcessor';
import { SyncEngine } from '@cognitrack/sync-engine';
import { registerDevice } from '@cognitrack/api-client';

// ── Module-level singletons (set once in whenReady) ─────────────────────────

let store:      SQLiteStore;
let syncEngine: SyncEngine;
let tracker:    ActiveWindowTracker;
let mainWindow: BrowserWindow | null = null;
let tray:       Tray | null = null;
let userId:     string;
let deviceId:   string;

// ── App lifecycle ───────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // 1. Auto-launch on login (registry on Windows, LaunchAgents on macOS)
  app.setLoginItemSettings({
    openAtLogin:  true,
    openAsHidden: true,   // start silently in tray, no window
    name:         'CogniTrack',
  });

  // 2. SQLite — must be first, tracker writes events immediately
  store = new SQLiteStore();

  // 3. Sync queue db in the same userData directory
  const queueDbPath = path.join(app.getPath('userData'), 'db', 'sync-queue.db');
  syncEngine = new SyncEngine(queueDbPath);

  // 4. Active window tracker (no start yet — needs auth first)
  tracker = new ActiveWindowTracker(store);

  // 5. Tray popover window (hidden by default)
  mainWindow = createPopoverWindow();

  // 6. System tray
  tray = createTray();

  // 7. IPC handlers — now takes tracker + syncEngine for tray controls
  registerIpcHandlers(store, tracker, syncEngine);

  // 8. Load the renderer so it can display the sign-in form if needed
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  } else {
    // Dev: Vite dev server
    mainWindow.loadURL('http://localhost:5173');
  }

  // 9. Wait for Firebase auth before doing anything network-related
  try {
    userId = await waitForAuth();
  } catch (err) {
    // Not signed in yet — show the popover so user sees the status
    console.warn('[startup] Not authenticated, showing popover:', err);
    showPopover();
    // Wait for sign-in signal from renderer
    userId = await waitForAuthFromRenderer();
  }

  // 9. Register/update this device in Firestore
  deviceId = getWindowsDeviceId();
  await registerDevice(userId, deviceId, process.platform as any, 'CogniTrack Desktop', app.getVersion())
    .catch(err => console.warn('[startup] Device registration failed (non-fatal):', err));

  // 10. Mark sync engine online and flush any queued items
  syncEngine.setOnline(true);

  // 11. Start the active window tracker
  tracker.start();

  // 13. Hourly batch: compute cognitive metrics and sync to Firestore
  scheduleHourlyBatch();



  console.log(`[startup] CogniTrack ready — userId=${userId} deviceId=${deviceId}`);
});

// Flush final batch and clean up before quitting
app.on('before-quit', async () => {
  console.log('[shutdown] Running final batch before quit...');
  if (store && syncEngine && userId && deviceId) {
    await processBatch(store, syncEngine, userId, deviceId, mainWindow).catch(console.error);
  }
  tracker?.stop();
  store?.close();
});

// Prevent full quit when all windows are closed (keep running in tray)
app.on('window-all-closed', (e: Event) => {
  e.preventDefault();
});

// ── Popover window factory ──────────────────────────────────────────────────

function createPopoverWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width:  260,
    height: 200,
    frame:          false,      // no OS chrome — custom titlebar via CSS
    resizable:      false,
    skipTaskbar:    true,       // don't appear in taskbar / dock
    alwaysOnTop:    true,       // floats above everything
    show:           false,      // hidden until tray click
    transparent:    true,       // enables rounded corners via CSS
    hasShadow:      true,
    webPreferences: {
      preload:          path.join(__dirname, 'electron/preload/index.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  // Hide when losing focus (click-away dismissal)
  win.on('blur', () => {
    win.hide();
  });

  // Never truly close — just hide to tray
  win.on('close', (e) => {
    e.preventDefault();
    win.hide();
  });

  return win;
}

// ── Show popover anchored above tray icon ────────────────────────────────────

function showPopover(): void {
  if (!mainWindow || !tray) return;

  const trayBounds = tray.getBounds();
  const windowBounds = mainWindow.getBounds();

  // Position centered above the tray icon
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  const y = Math.round(trayBounds.y - windowBounds.height - 4);

  mainWindow.setPosition(x, y);
  mainWindow.show();
  mainWindow.focus();
}

// ── System tray ────────────────────────────────────────────────────────────

function createTray(): Tray {
  // Use a 16x16 template image for the tray icon
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'tray-icon.png')
    : path.join(__dirname, '../assets/tray-icon.png');

  const icon = nativeImage.createFromPath(iconPath);
  const t = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

  t.setToolTip('CogniTrack — Cognitive Load Tracker');

  // Left-click: show/hide the popover
  t.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      showPopover();
    }
  });

  // Right-click: context menu
  t.setContextMenu(buildTrayMenu());

  return t;
}

function buildTrayMenu(): Menu {
  const isTracking = tracker?.isRunning() ?? false;
  return Menu.buildFromTemplate([
    {
      label: isTracking ? '● Tracking Active' : '○ Tracking Paused',
      enabled: false, // informational only
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
        tray?.setContextMenu(buildTrayMenu()); // refresh label
      },
    },
    { type: 'separator' },
    {
      label: 'Quit CogniTrack',
      click: () => {
        // Allow the before-quit handler to run the final batch
        mainWindow?.destroy();
        mainWindow = null;
        app.quit();
      },
    },
  ]);
}

// ── Hourly batch scheduler ───────────────────────────────────────────────────

function scheduleHourlyBatch(): void {
  const ONE_HOUR = 60 * 60 * 1000;

  // Run once immediately on startup so today's partial data is available fast
  processBatch(store, syncEngine, userId, deviceId, mainWindow).catch(console.error);

  // Then schedule every hour
  const jitter = Math.floor(Math.random() * 5 * 60 * 1000);
  setInterval(() => {
    processBatch(store, syncEngine, userId, deviceId, mainWindow).catch(console.error);

    // Refresh tray menu to update tracking state label
    tray?.setContextMenu(buildTrayMenu());
  }, ONE_HOUR + jitter);
}

// ── Helper: wait for sign-in signal from renderer ────────────────────────

function waitForAuthFromRenderer(): Promise<string> {
  return new Promise((resolve) => {
    ipcMain.once('auth:signedIn', (_event, uid: string) => {
      if (typeof uid !== 'string' || !/^[a-zA-Z0-9]{20,128}$/.test(uid)) {
        console.error('[auth] Invalid UID received from renderer');
        return;
      }
      resolve(uid);
    });
  });
}

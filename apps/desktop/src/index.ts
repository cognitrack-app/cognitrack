// Load environment variables BEFORE any Firebase-dependent imports
import 'dotenv/config';
import path from 'path';
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron';
import { registerIpcHandlers } from './electron/main/ipcHandlers';
import { SQLiteStore } from './electron/main/sqliteStore';
import { ActiveWindowTracker } from './electron/main/activeWindowTracker';
import { waitForAuth, getTodayDateString } from './electron/main/utils';
import { getDeviceId } from './electron/main/deviceId';
import { processBatch } from './electron/main/batchProcessor';
import { SyncEngine } from '@cognitrack/sync-engine';
import { registerDevice } from '@cognitrack/api-client';
import { registerGoogleOAuthHandler, handleOAuthCallback } from './electron/main/googleOAuth';

// ── Module-level singletons (set once in whenReady) ─────────────────────────

let store:      SQLiteStore;
let syncEngine: SyncEngine;
let tracker:    ActiveWindowTracker;
let mainWindow: BrowserWindow | null = null;
let tray:       Tray | null = null;
let userId:     string;
let deviceId:   string;

// ── Single-instance lock + Windows deep-link (cognitrack://) ──────────────────
//
// On Windows, when the OS handles a cognitrack:// URI the registered handler
// launches a NEW instance of the app with the URI as the last argv argument.
// We use requestSingleInstanceLock() so the second instance immediately quits
// and the FIRST (already-running) instance receives the URI via second-instance.
//
// This MUST be called before app.whenReady().

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  // We are the second instance — quit immediately.
  // The first instance handles everything via the second-instance event below.
  app.quit();
} else {
  // First (real) instance: listen for subsequent launch attempts.
  app.on('second-instance', (_event, argv) => {
    // On Windows, deep-link URL is injected as the last argv element.
    // e.g. argv = ['...electron.exe', '--', 'cognitrack://auth?code=abc123']
    const deepLinkUrl = argv.find(arg => arg.startsWith('cognitrack://'));
    if (deepLinkUrl) {
      console.log('[deeplink] second-instance received URL:', deepLinkUrl);
      handleOAuthCallback(deepLinkUrl).catch(err =>
        console.error('[deeplink] handleOAuthCallback error:', err)
      );
    }
    // Bring the popover window to front so the user sees the result.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── macOS deep-link handler (open-url event, same instance) ─────────────────
//
// On macOS the OS calls open-url on the SAME running instance — no second
// instance is spawned. Also register cognitrack:// via setAsDefaultProtocolClient
// here; on Windows this is handled by electron-builder's `protocols` key in
// electron-builder.yml which writes the registry during install. We call it
// here anyway as a fallback for unsigned/dev builds.

app.on('open-url', (_event, url) => {
  console.log('[deeplink] open-url received:', url);
  handleOAuthCallback(url).catch(err =>
    console.error('[deeplink] handleOAuthCallback error:', err)
  );
});

// Register as default handler for cognitrack:// scheme.
// On Windows this sets HKCU\Software\Classes\cognitrack in the registry.
// electron-builder's protocols config does this for installed builds;
// this call ensures it also works in dev/unpackaged mode on both platforms.
if (!app.isDefaultProtocolClient('cognitrack')) {
  app.setAsDefaultProtocolClient('cognitrack');
}

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
  //    Height is 320 to accommodate the sign-in form (Google button +
  //    email/password) without clipping. The TrayPopover (post-auth) is
  //    smaller but the window does not resize — CSS handles the layout.
  mainWindow = createPopoverWindow();

  // 6. Register Google OAuth IPC handler BEFORE renderer loads,
  //    so the 'auth:triggerGoogle' invoke is ready when the sign-in form appears.
  registerGoogleOAuthHandler(mainWindow);

  // 7. System tray
  tray = createTray();

  // 8. IPC handlers — tracker + syncEngine for tray controls
  registerIpcHandlers(store, tracker, syncEngine);

  // 9. Load the renderer so it can display the sign-in form if needed
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  } else {
    // Dev: Vite dev server
    mainWindow.loadURL('http://localhost:5173');
  }

  // 10. Wait for Firebase auth before doing anything network-related.
  //     waitForAuth() checks the persisted Firebase auth state immediately;
  //     if the user is already signed in (token cached) it resolves in < 1 s.
  //     If not, we show the popover and wait for the renderer to signal sign-in.
  try {
    userId = await waitForAuth();
  } catch (err) {
    // Not signed in yet — show the popover so user sees the sign-in form.
    console.warn('[startup] Not authenticated, showing popover:', err);
    showPopover();
    // Wait for sign-in signal from renderer (either email/password or Google OAuth).
    userId = await waitForAuthFromRenderer();
  }

  // 11. Register/update this device in Firestore
  deviceId = getDeviceId();
  await registerDevice(userId, deviceId, process.platform as any, 'CogniTrack Desktop', app.getVersion())
    .catch(err => console.warn('[startup] Device registration failed (non-fatal):', err));

  // 12. Mark sync engine online and flush any queued items
  syncEngine.setOnline(true);

  // 13. Start the active window tracker
  tracker.start();

  // DESK-06 FIX: Refresh tray menu now that tracker is running — buildTrayMenu()
  // was called during createTray() at step 7, before tracker.start(), so the
  // initial menu incorrectly showed "○ Tracking Paused" on every cold launch.
  tray?.setContextMenu(buildTrayMenu());

  // 14. Hourly batch: compute cognitive metrics and sync to Firestore
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
    width:   260,
    // 320px: tall enough for the sign-in form (Google btn + divider +
    // email/password + error msg) without scrollbar. TrayPopover (post-auth)
    // fits comfortably in this height too.
    height:  320,
    frame:          false,      // no OS chrome — custom titlebar via CSS
    resizable:      false,
    skipTaskbar:    true,       // don’t appear in taskbar / dock
    alwaysOnTop:    true,       // floats above everything
    show:           false,      // hidden until tray click
    transparent:    true,       // enables rounded corners via CSS
    hasShadow:      true,
    webPreferences: {
      preload:          path.join(__dirname, 'electron/preload/index.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      // Disable remote module (deprecated, security best practice)
      sandbox:          false,  // sandbox:true breaks CommonJS preload on Electron 30
    },
  });

  // Hide when losing focus (click-away dismissal).
  // Exception: while the system browser is open for Google OAuth, we do NOT
  // want the popover to hide — but since the window is already hidden at that
  // point (user clicked the button which closes the popover first), this is fine.
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

  const trayBounds   = tray.getBounds();
  const windowBounds = mainWindow.getBounds();

  // Position centered above the tray icon
  const x = Math.round(trayBounds.x + trayBounds.width  / 2 - windowBounds.width  / 2);
  const y = Math.round(trayBounds.y - windowBounds.height - 4);

  mainWindow.setPosition(x, y);
  mainWindow.show();
  mainWindow.focus();
}

// ── System tray ────────────────────────────────────────────────────────────

function createTray(): Tray {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'tray-icon.png')
    : path.join(__dirname, '../assets/tray-icon.png');

  const icon = nativeImage.createFromPath(iconPath);
  const t    = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

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
      label:   isTracking ? '● Tracking Active' : '○ Tracking Paused',
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

  // Run once immediately so today’s partial data is available fast
  processBatch(store, syncEngine, userId, deviceId, mainWindow).catch(console.error);

  // Then schedule every hour with +-5 min jitter to avoid thundering-herd
  const jitter = Math.floor(Math.random() * 5 * 60 * 1000);
  setInterval(() => {
    processBatch(store, syncEngine, userId, deviceId, mainWindow).catch(console.error);
    tray?.setContextMenu(buildTrayMenu());
  }, ONE_HOUR + jitter);
}

// ── Helper: wait for sign-in signal from renderer ────────────────────────────

/**
 * DESK-04 FIX: Returns a Promise that:
 *  - Resolves with the UID when the renderer emits 'auth:signedIn' with a
 *    valid Firebase UID (>= 20 chars).
 *  - Rejects immediately with a descriptive error if the UID is malformed.
 *  - Rejects after 5 minutes if the renderer never fires the event.
 *
 * Works for BOTH email/password sign-in (renderer calls signIn(uid) directly)
 * AND Google OAuth (googleOAuth.ts calls signInWithCredential in main, then
 * the renderer's onAuthStateChanged fires and calls signIn(uid)).
 */
function waitForAuthFromRenderer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ipcMain.removeAllListeners('auth:signedIn');
      reject(new Error('[auth] Timeout: renderer did not emit auth:signedIn within 5 minutes'));
    }, 5 * 60 * 1000);

    ipcMain.once('auth:signedIn', (_event, uid: string) => {
      clearTimeout(timeout);
      if (typeof uid !== 'string' || uid.trim().length < 20) {
        reject(new Error(`[auth] Invalid UID from renderer: "${uid}"`));
        return;
      }
      resolve(uid.trim());
    });
  });
}

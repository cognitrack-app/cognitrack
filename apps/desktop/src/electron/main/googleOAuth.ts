/**
 * googleOAuth.ts — Desktop Google Sign-In via system browser + deep-link.
 *
 * WHY THIS APPROACH:
 * Electron's sandboxed renderer (contextIsolation: true) cannot use Firebase
 * signInWithPopup() — Electron blocks popup auth flows. The correct pattern
 * for Electron desktop OAuth is:
 *
 *   1. Main process opens system browser (Chrome/Edge/Firefox) via
 *      shell.openExternal() to the Google OAuth consent screen.
 *   2. Google redirects to cognitrack://auth?code=... (custom URI scheme).
 *   3. On Windows: OS launches a second instance of the app with the URL as
 *      an argv argument — the first instance receives it via second-instance.
 *   4. On macOS: same instance receives it via the open-url event.
 *   5. Main process exchanges the auth code for tokens via Google's token
 *      endpoint, signs in to Firebase with the Google ID token using
 *      signInWithCredential(), and notifies the renderer via IPC.
 *
 * SETUP REQUIRED (one-time, in Google Cloud Console):
 *   - Create OAuth 2.0 credentials → Application type: "Desktop app"
 *   - Add cognitrack://auth to Authorised redirect URIs
 *   - Copy Client ID + Secret into .env
 */

import { shell, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_OAUTH_CLIENT_ID     ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';
const REDIRECT_URI         = 'cognitrack://auth';

// Single pending OAuth promise — only one flow can be in-flight at a time.
let pendingResolve: ((uid: string) => void) | null = null;
let pendingReject:  ((err: Error)  => void) | null = null;
let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Registers the IPC handler that the renderer calls to start Google OAuth.
 * Must be called ONCE from src/index.ts inside app.whenReady(), after
 * mainWindow is created.
 *
 * @param mainWindow - the tray popover BrowserWindow (used to focus it after
 *                     the OAuth callback arrives).
 */
export function registerGoogleOAuthHandler(mainWindow: BrowserWindow): void {
  // Renderer → main: "start Google OAuth"
  // Returns a Promise<string> (uid) that resolves when the callback completes.
  ipcMain.handle('auth:triggerGoogle', async (): Promise<string> => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      throw new Error(
        '[googleOAuth] GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET ' +
        'is missing from .env. Add them before using Google Sign-In.'
      );
    }

    // If there's already a pending flow, reject it and start fresh.
    cancelPendingFlow(new Error('[googleOAuth] New sign-in request superseded the previous one.'));

    // Open the system browser to Google's consent page.
    const authUrl = buildAuthUrl();
    await shell.openExternal(authUrl);

    console.log('[googleOAuth] Opened system browser for Google OAuth:', authUrl);

    // Return a Promise that resolves when handleOAuthCallback() is called.
    return new Promise<string>((resolve, reject) => {
      pendingResolve = resolve;
      pendingReject  = reject;

      // Reject after 5 min if the user abandons the browser tab.
      pendingTimeout = setTimeout(() => {
        cancelPendingFlow(
          new Error('[googleOAuth] Timeout: user did not complete Google sign-in within 5 minutes.')
        );
      }, 5 * 60 * 1000);
    });
  });

  console.log('[googleOAuth] IPC handler registered for auth:triggerGoogle');
}

/**
 * Called from src/index.ts whenever a cognitrack:// deep-link URL is received
 * (second-instance on Windows, open-url on macOS).
 *
 * Parses the auth code, exchanges it for Google tokens, signs in to Firebase,
 * and resolves the pending IPC promise with the Firebase UID.
 */
export async function handleOAuthCallback(url: string): Promise<void> {
  console.log('[googleOAuth] Received deep-link callback:', url);

  if (!pendingResolve || !pendingReject) {
    // No active flow — could be a stale deep-link or a replay attack. Ignore.
    console.warn('[googleOAuth] Deep-link received but no OAuth flow is pending. Ignoring.');
    return;
  }

  // Clear the 5-minute timeout — we got a response.
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingTimeout = null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    const err = new Error(`[googleOAuth] Malformed callback URL: ${url}`);
    pendingReject(err);
    pendingResolve = null;
    pendingReject  = null;
    return;
  }

  const code  = parsed.searchParams.get('code');
  const error = parsed.searchParams.get('error');

  if (error || !code) {
    const msg = error === 'access_denied'
      ? '[googleOAuth] User cancelled Google sign-in.'
      : `[googleOAuth] OAuth error from Google: ${error ?? 'missing code'}`;
    pendingReject(new Error(msg));
    pendingResolve = null;
    pendingReject  = null;
    return;
  }

  // Capture resolve/reject locally then clear module-level refs immediately
  // so no second callback can interfere while we await async operations.
  const resolve = pendingResolve;
  const reject  = pendingReject;
  pendingResolve = null;
  pendingReject  = null;

  try {
    // ── Step 1: Exchange auth code for Google tokens ─────────────────────
    console.log('[googleOAuth] Exchanging auth code for tokens...');

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
      }).toString(),
    });

    const tokenData = await tokenResponse.json() as {
      id_token?:     string;
      access_token?: string;
      error?:        string;
      error_description?: string;
    };

    if (tokenData.error || !tokenData.id_token) {
      throw new Error(
        `[googleOAuth] Token exchange failed: ${tokenData.error} — ${tokenData.error_description ?? ''}`
      );
    }

    console.log('[googleOAuth] Token exchange successful. Signing in to Firebase...');

    // ── Step 2: Sign in to Firebase with Google ID token ─────────────────
    // Dynamic imports keep startup fast — these only load when OAuth is used.
    const { GoogleAuthProvider, signInWithCredential } = await import('firebase/auth');
    const { auth } = await import('@cognitrack/api-client');

    const credential = GoogleAuthProvider.credential(tokenData.id_token);
    const userCred   = await signInWithCredential(auth, credential);
    const uid        = userCred.user.uid;

    console.log(`[googleOAuth] Firebase sign-in successful. uid=${uid}`);
    resolve(uid);

  } catch (err: any) {
    console.error('[googleOAuth] Auth flow failed:', err);
    reject(err instanceof Error ? err : new Error(String(err)));
  }
}

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Builds the Google OAuth 2.0 authorisation URL.
 * Uses the "online" access_type — we only need the ID token for Firebase.
 * prompt=select_account lets users switch Google accounts easily.
 */
function buildAuthUrl(): string {
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'online',
    prompt:        'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Rejects and clears any in-flight pending OAuth promise.
 * Called when a new request supersedes the old one or a timeout fires.
 */
function cancelPendingFlow(err: Error): void {
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingTimeout = null;
  }
  if (pendingReject) {
    pendingReject(err);
    pendingResolve = null;
    pendingReject  = null;
  }
}

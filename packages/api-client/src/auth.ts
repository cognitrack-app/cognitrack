import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

export interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

/**
 * Sign in with email + password.
 * Returns the Firebase User with a stable UID that persists across devices.
 * NOTE: anonymous auth was removed — it produces unstable UIDs that orphan
 * historical data when the user reinstalls or clears app storage.
 */
export async function signIn(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/**
 * Sign in with Google (OAuth) — WEB / MOBILE ONLY.
 *
 * BUG-3 FIX: The original had no environment guard. If any code path on
 * desktop accidentally imported and called this function, it would fail with
 * a cryptic error deep inside the Firebase SDK because:
 *
 *   1. signInWithPopup() tries to open a browser popup window.
 *   2. Electron’s sandboxed renderer blocks popups (no window.open access).
 *   3. Even if the popup opened, the OAuth redirect would land in a new
 *      Electron window with no way to exchange the auth code — the flow
 *      hangs indefinitely.
 *
 * Desktop uses a completely different flow (system browser + deep-link):
 *   renderer → window.electronAPI.triggerGoogleSignIn()
 *            → ipcRenderer.invoke('auth:triggerGoogle')
 *            → main: shell.openExternal(Google OAuth URL)
 *            → deep-link: cognitrack://auth?code=...
 *            → main: googleOAuth.ts → signInWithCredential()
 *
 * This guard throws immediately with a clear message if called from
 * Electron’s renderer process, so the mistake surfaces at dev time
 * rather than silently hanging in production.
 */
export async function signInWithGoogle(): Promise<User> {
  // Detect Electron renderer: `process` is defined in the preload context
  // and `window.electronAPI` is exposed by the preload bridge.
  const isElectronRenderer =
    typeof window !== 'undefined' &&
    typeof (window as any).electronAPI !== 'undefined';

  if (isElectronRenderer) {
    throw new Error(
      '[api-client] signInWithGoogle() cannot be called from Electron.\n' +
      'Use window.electronAPI.triggerGoogleSignIn() instead, which opens\n' +
      'the system browser and handles the OAuth deep-link callback in main.'
    );
  }

  // Web / mobile: standard popup flow is fine.
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

/**
 * Create a new account. Used on first launch / onboarding.
 */
export async function signUp(email: string, password: string): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}

/** Subscribe to auth state changes. Returns the unsubscribe function. */
export function onAuthChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

/** Returns the current user or null — synchronous. */
export function getCurrentUser(): User | null {
  return auth.currentUser;
}

/**
 * Returns current user UID.
 * Throws if called before sign-in — deliberate fail-fast.
 */
export function getCurrentUserId(): string {
  const user = auth.currentUser;
  if (!user) throw new Error('[api-client] getCurrentUserId() called with no authenticated user');
  return user.uid;
}

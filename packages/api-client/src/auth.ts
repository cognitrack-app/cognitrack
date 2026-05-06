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
 * Sign in with Google (OAuth).
 * This aligns with the mobile application's authentication method.
 */
export async function signInWithGoogle(): Promise<User> {
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

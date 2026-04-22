import { type User } from 'firebase/auth';
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
export declare function signIn(email: string, password: string): Promise<User>;
/**
 * Create a new account. Used on first launch / onboarding.
 */
export declare function signUp(email: string, password: string): Promise<User>;
export declare function signOut(): Promise<void>;
/** Subscribe to auth state changes. Returns the unsubscribe function. */
export declare function onAuthChange(callback: (user: User | null) => void): () => void;
/** Returns the current user or null — synchronous. */
export declare function getCurrentUser(): User | null;
/**
 * Returns current user UID.
 * Throws if called before sign-in — deliberate fail-fast.
 */
export declare function getCurrentUserId(): string;

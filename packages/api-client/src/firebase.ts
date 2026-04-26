import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';

// ─── Singleton guard: safe to import multiple times or in hot-reload ──────────
const firebaseConfig = {
  apiKey:            process.env.FIREBASE_API_KEY!,
  authDomain:        process.env.FIREBASE_AUTH_DOMAIN!,
  projectId:         process.env.FIREBASE_PROJECT_ID!,
  storageBucket:     process.env.FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID!,
  appId:             process.env.FIREBASE_APP_ID!,
};

// ─── Dev-time guard: fail immediately with a helpful message ─────────────────
// Vite bakes .env values into the bundle at build-time.  If the .env file
// is still unfilled (placeholder strings or empty), the Firebase SDK will throw
// the cryptic `auth/invalid-api-key` error deep inside an async callstack.
// This guard converts that into a readable build-time failure.
const PLACEHOLDER_PATTERNS = [
  'your-', 'REPLACE_WITH', '123456789', 'abcdef', '',
] as const;

for (const [key, value] of Object.entries(firebaseConfig)) {
  if (!value || PLACEHOLDER_PATTERNS.some((p) => value.includes(p))) {
    throw new Error(
      `[CogniTrack] Firebase config key "${key}" is missing or still a placeholder.\n` +
      `Fill in cognitrack-desktop/.env with real values from the Firebase console.\n` +
      `Run: flutterfire configure --project=cognitrack-dcede  (or copy from Firebase Console → Project Settings → Web app)`,
    );
  }
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db: Firestore = getFirestore(app);
export const auth: Auth    = getAuth(app);

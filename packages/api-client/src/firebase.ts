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

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db: Firestore = getFirestore(app);
export const auth: Auth    = getAuth(app);

<div align="center">

# 🧠 CogniTrack

**Neuroscience-grounded cognitive load tracking across your devices.**

Measure how your attention fragments across apps, screens, and contexts — without ever sending raw data to the cloud.

[![Android](https://img.shields.io/badge/Android-Ready-3DDC84?style=flat-square&logo=android&logoColor=white)](./apps/mobile)
[![Windows](https://img.shields.io/badge/Windows-Ready-0078D4?style=flat-square&logo=windows&logoColor=white)](./apps/desktop)
[![macOS](https://img.shields.io/badge/macOS-Ready-000000?style=flat-square&logo=apple&logoColor=white)](./apps/desktop)
[![iOS](https://img.shields.io/badge/iOS-Planned-lightgrey?style=flat-square&logo=apple)](./apps/mobile)
[![Firebase](https://img.shields.io/badge/Firebase-Firestore-FFCA28?style=flat-square&logo=firebase&logoColor=black)](https://firebase.google.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](./LICENSE)

</div>

---

## What is CogniTrack?

CogniTrack is a **multi-agent personal informatics system** that measures cognitive load and attention fragmentation across all your devices using a neuroscience-grounded engine. It runs silently in the background on your phone and desktop, computes 11 cognitive metrics locally, and syncs only those computed scalars to Firestore — never raw app usage data.

The system is built around Dr. Sophie Leroy's **attention residue theory**: not all context switches cost the same, phone interruptions during focused work cost **2.2×** more than desktop switches, and switching from passive entertainment back to deep work is the single most expensive cognitive transition.

> **Privacy first:** Raw event data (app names, window titles, usage sequences) never leaves your device. Only 11 computed daily metric fields are synced to the cloud.

---

## Platform Status

| Platform | Status | Build output | Notes |
|---|---|---|---|
| 🤖 Android | ✅ **Ready** | APK + AAB | Flutter foreground service, 15-min sync |
| 🪟 Windows | ✅ **Ready** | NSIS installer + portable `.exe` | x64 + ARM64 (Snapdragon X), system tray |
| 🍎 macOS | ✅ **Ready** | `.dmg` / `.app` | Electron agent, same architecture as Windows |
| 📱 iOS | 🗓️ **Planned** | — | DeviceActivity API, background-aware design |

> **macOS note:** The desktop agent runs on macOS with full feature parity to Windows. On first launch it requests Accessibility permission (required by `active-win` to read the frontmost app name). The app hides from the Dock automatically — it lives entirely in the menu bar.

---

## Monorepo Structure

This is a **pnpm monorepo** — all apps share packages from `/packages/`. Clone the root repo; do not clone individual subdirectories.

```
CogniTrack/
├── apps/
│   ├── desktop/                  # Electron tray agent — Windows ✅ · macOS ✅
│   │   ├── src/
│   │   │   ├── index.ts                    # App entry — lifecycle, tray, auth, scheduler
│   │   │   ├── electron/
│   │   │   │   ├── main/
│   │   │   │   │   ├── activeWindowTracker.ts  # 5-sec poll via active-win
│   │   │   │   │   ├── batchProcessor.ts       # Hourly metrics computation
│   │   │   │   │   ├── breakExtractor.ts       # Idle-event break detection
│   │   │   │   │   ├── deviceId.ts             # SHA-256 stable device ID
│   │   │   │   │   ├── ipcHandlers.ts          # IPC bridge (tray ↔ renderer)
│   │   │   │   │   ├── macPermissions.ts       # macOS Accessibility check
│   │   │   │   │   ├── sqliteStore.ts          # Local event + metrics storage
│   │   │   │   │   ├── syncEngine.ts           # Offline queue → Firestore
│   │   │   │   │   └── utils.ts
│   │   │   │   └── preload/
│   │   │   │       └── index.ts                # contextBridge API surface
│   │   │   └── renderer/
│   │   │       ├── App.tsx                     # Auth gate + tray popover logic
│   │   │       ├── SignInPopover.tsx            # Email + Google sign-in UI
│   │   │       └── TrayPopover.tsx             # Stats + phone section UI
│   │   ├── assets/                   # Tray icons (Template.png for macOS)
│   │   ├── electron-builder.yml      # Build config (NSIS, portable, dmg)
│   │   ├── vite.config.ts            # Renderer bundler config
│   │   └── .env                      # Firebase credentials (gitignored)
│   │
│   ├── mobile/                   # Flutter agent — Android ✅ · iOS 🗓️
│   │   ├── lib/
│   │   │   ├── main.dart
│   │   │   ├── services/
│   │   │   │   ├── usage_stats_service.dart    # Android UsageStats API
│   │   │   │   ├── sync_service.dart           # 15-min Firestore push
│   │   │   │   └── cognitive_engine.dart       # Local metrics calculation
│   │   │   └── screens/
│   │   │       └── dashboard_screen.dart       # Main analytics UI
│   │   ├── android/
│   │   │   └── app/google-services.json        # Firebase config (gitignored)
│   │   └── pubspec.yaml
│   │
│   └── web/                      # React analytics dashboard (in development)
│
├── packages/
│   ├── shared/                   # Shared TypeScript types + constants
│   │   └── src/
│   │       ├── types.ts          # SessionDocument, DesktopSyncPayload, PhoneSyncPayload
│   │       └── constants.ts      # App category maps, canonical bundle IDs
│   │
│   ├── cognitive-engine/         # Unified calculateCognitiveDebt() algorithm
│   │   └── src/
│   │       ├── engine.ts         # State machine, decay, context matrix
│   │       └── normalizer.ts     # normalizeAppId() — cross-platform app ID unification
│   │
│   ├── sync-engine/              # Offline queue + retry + Firestore push (shared)
│   │   └── src/
│   │       └── SyncEngine.ts     # SQLite queue, backoff, setOnline()
│   │
│   └── api-client/               # Firebase Auth + Firestore wrapper
│       └── src/
│           ├── auth.ts           # signIn, signUp, signOut, signInWithGoogle, onAuthChange
│           ├── firebase.ts       # initializeApp singleton + env guard
│           ├── sessions.ts       # writeDesktopSession, writePhoneSession, fetchSessionByDate
│           └── device.ts         # registerDevice, updateDeviceLastSeen
│
├── functions/                    # Firebase Cloud Functions (Node 20)
│   ├── src/
│   │   ├── mergeAgentData.ts     # Triggers on session write → computes combined metrics
│   │   └── cleanupOldSessions.ts # Monthly TTL — deletes sessions older than 90 days
│   └── package.json
│
├── firestore.rules               # Security rules — uid-scoped read/write
├── firestore.indexes.json        # Composite indexes for session queries
├── firebase.json
├── pnpm-workspace.yaml
└── CogniTrack-Architecture-v6.md # Full system spec
```

---

## How the Two Agents Connect

Both agents sign in with the **same Firebase account** (email/password or Google). The shared `uid` is the only link between them — no pairing code, QR scan, or Bluetooth required.

```
Android (phone agent)
   └── /users/{uid}/sessions/{date}/phoneMetrics
          │  11 fields written every 15 min
          │
          ▼
   mergeAgentData Cloud Function fires on every write
          │
          ▼
   /users/{uid}/sessions/{date}/derived/
     combinedLoad       — weighted average of phone + desktop load
     dualFragmentation  — penalty when both devices active simultaneously
     crossDeviceEvents  — count of phone pickups during desktop focus sessions
     overlapHours       — hours where both devices were actively used

Windows / macOS (desktop agent)
   └── /users/{uid}/sessions/{date}/desktopSessions/{deviceId}
          11 fields written hourly + on quit
```

> **Install order:** Android first (creates the account) → then desktop (sign in with the same credentials). The desktop app has no registration UI — it is sign-in only.

---

## Getting Started

### Prerequisites

| Tool | Version | Required for |
|---|---|---|
| Flutter SDK | ≥ 3.3.0 | Android / iOS mobile agent |
| Node.js | 20 LTS | Desktop agent + Cloud Functions |
| pnpm | 9.x | Monorepo dependency management |
| Java | 17 | Android builds |
| Git | any | Cloning the monorepo |

---

## 🤖 Android Setup

### Step 1 — Clone and install

```bash
git clone https://github.com/cognitrack-app/cognitrack.git
cd cognitrack/apps/mobile
flutter pub get
```

### Step 2 — Add Firebase config

1. Go to [Firebase Console](https://console.firebase.google.com/project/cognitrack-dcede/settings/general)
2. Click **Your apps** → Android app → **Download `google-services.json`**
3. Place it at:

```
apps/mobile/android/app/google-services.json
```

### Step 3 — Grant Usage Stats permission

On first launch, Android will prompt for **Usage Access** permission. This is required to read which app is in the foreground. Without it, the agent cannot track anything.

> Settings → Apps → Special app access → Usage access → CogniTrack → Allow

### Step 4 — Run or build

```bash
# Development (USB-connected device or emulator)
flutter run

# Production APK (sideload / share directly)
flutter build apk --release

# Production AAB (Google Play Store upload)
flutter build appbundle --release
```

### Step 5 — Create your account

On first launch, use **Sign up** to create an account with your email and password. This account will be used on the desktop agent too — use the exact same credentials.

---

## 🖥️ Desktop Setup (Windows + macOS)

### Step 1 — Clone the monorepo (skip if already done)

```bash
git clone https://github.com/cognitrack-app/cognitrack.git
cd cognitrack
pnpm install
```

### Step 2 — Configure Firebase credentials

Create `apps/desktop/.env` with your Firebase project values:

```bash
cd apps/desktop
```

```env
FIREBASE_API_KEY=AIzaSyBwa9uCbsYvo_OZIdcmNHnnbw8AVlynbbE
FIREBASE_AUTH_DOMAIN=cognitrack-dcede.firebaseapp.com
FIREBASE_PROJECT_ID=cognitrack-dcede
FIREBASE_STORAGE_BUCKET=cognitrack-dcede.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=618151348931
FIREBASE_APP_ID=1:618151348931:web:c451f2c5cda94d82e8b076
```

> These values come from Firebase Console → Project Settings → Your apps → Web app → SDK setup.

### Step 3 — Run in development

```bash
cd apps/desktop
pnpm dev
```

This starts three processes in parallel:
- **Vite** — bundles the renderer on `:5173`
- **tsc --watch** — compiles the main process TypeScript
- **Electron** — launches the app (tray only, no window)

### Step 4 — Sign in

Click the **CogniTrack tray icon** (bottom-right on Windows, top menu bar on macOS). A small popover appears with two options:

- **Continue with Google** — opens a Firebase OAuth popup window (recommended)
- **Sign In with Email** — use the same email/password as your Android account

> Sign in with the **same account** you created on Android. The `uid` links both devices.

### Step 5 — macOS only: grant Accessibility permission

On first launch, macOS will show a dialog asking for **Accessibility access**. This is required for `active-win` to read the frontmost application name. Click **Open System Settings** and toggle CogniTrack on.

> System Settings → Privacy & Security → Accessibility → CogniTrack → On

After granting, **relaunch the app**. The tray icon will show `● Tracking Active` once the tracker starts.

### Step 6 — Build for production

```bash
# Windows x64 — NSIS installer + portable .exe
pnpm dist

# Windows ARM64 — for Snapdragon X laptops
pnpm dist:arm64

# Both architectures in one pass
pnpm dist:all

# macOS — .dmg + .app
pnpm dist:mac
```

Output goes to `apps/desktop/dist/`.

---

## Using the Desktop Tray Popover

The desktop agent has **no main window** — all dashboard UI is in the Android app. The tray popover shows a compact at-a-glance view:

### Tray Icon
| Icon state | Meaning |
|---|---|
| `● Tracking Active` (context menu) | Tracker is running, events are being recorded |
| `○ Tracking Paused` (context menu) | Manually paused — no events recorded |

### Popover Sections

**Desktop Today** — your desktop cognitive metrics for today:
- Cognitive load % (0–100)
- Total context switches
- Focus sessions (20+ min uninterrupted productive blocks)
- Peak load hour

**Phone Today** — pulled live from Firestore whenever the popover opens:
- Battery-style cognitive load bar from your Android device
- Screen time
- App switch count

**Footer actions:**
- Pause / Resume tracking
- Quit (runs final batch sync before exit)

### Context Menu (right-click tray icon)
- `● Tracking Active` / `○ Tracking Paused` — live status
- Pause Tracking / Resume Tracking
- Quit CogniTrack

---

## How Data Flows End-to-End

```
┌─────────────────────────────────────────────────────────────────┐
│                   CAPTURE (every 5 seconds)                      │
│                                                                  │
│  activeWindowTracker.ts polls active-win → app_events in SQLite  │
│  Android UsageStats API → events in local SQLite / Room DB       │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│               COMPUTE (hourly on desktop, 15-min on mobile)      │
│                                                                  │
│  batchProcessor.ts / cognitive_engine.dart:                      │
│    · normalizeAppId()       — unified cross-platform app IDs     │
│    · calculateCognitiveDebt() — state machine + decay            │
│    · breakExtractor.ts      — idle gap detection                 │
│  Output: 11 daily metric fields                                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SYNC (SyncEngine offline queue)                │
│                                                                  │
│  SQLite queue → exponential backoff → Firestore write            │
│  /users/{uid}/sessions/{YYYY-MM-DD}/                             │
│    desktopSessions/{deviceId}   ← desktop payload               │
│    phoneMetrics                 ← mobile payload                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              MERGE (mergeAgentData Cloud Function)               │
│                                                                  │
│  Triggers on every session write.                                │
│  Combines phone + desktop into /derived/:                        │
│    combinedLoad · dualFragmentation · crossDeviceEvents          │
│    overlapHours                                                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│               DISPLAY (Android dashboard)                        │
│                                                                  │
│  Real-time Firestore listener → Flutter charts + insights        │
│  Desktop tray popover also pulls phoneMetrics on open            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Cognitive Load Engine

The `@cognitrack/cognitive-engine` package runs identically on all platforms. It processes local events into 11 daily metrics without exposing raw data.

### State Machine

```typescript
interface CognitiveState {
  wm_capacity:           number;  // Working memory tank [0–100]
  residue:               number;  // Attention residue [0–1], decays exponentially
  focus_depth:           number;  // Accumulated focus [0–30], resets on switch
  last_switch_ts:        number;
  last_residue_decay_ts: number;
}
```

### Attention Residue Decay

When you switch away from a task, residue decays exponentially (τ = 7.67 min, fitted to Dr. Sophie Leroy's 23-minute recovery window):

```
R(Δt) = e^(−Δt / τ),   τ = 7.67 min
```

At 23 minutes: R ≈ 0.05 (fully recovered). Each new switch stacks on undecayed prior residue.

### Asymmetric Context Distance Matrix

```
FROM \ TO     productive  tools  social  entertainment  passiveWaste
productive        1.0      1.5     6.0       5.0            7.0
tools             2.0      1.5     5.0       4.0            6.0
social            8.0 ⚠️   5.0     2.0       2.5            1.5
entertainment     7.0      4.5     2.0       1.5            1.0
passiveWaste      9.0 ⚠️   6.0     1.5       1.0            1.0
```

`passiveWaste → productive` (e.g. TikTok → VS Code) = **9×** baseline cost. Models dopamine downregulation + goal reconfiguration + working memory re-population.

### Cross-Device Multiplier

Phone pickups during desktop work carry a **2.2× multiplier** — physical context switch + UI paradigm change + dopamine-optimised content feed. Even phone *visibility* reduces working memory capacity (Ward et al., 2017).

### The 11 Synced Metrics

| Field | Description |
|---|---|
| `cognitiveDebt` | Total weighted switch cost for the day |
| `cognitiveLoadPct` | 0–100 normalised daily score |
| `wmCapacityRemaining` | Working memory % at end of day |
| `residueAtEOD` | Attention residue still present at day end (0–1) |
| `hourlyLoad[24]` | Per-hour cognitive load array |
| `peakLoadHour` | Hour with highest load (0–23) |
| `totalSwitches` | Raw context switch count |
| `totalPickups` | Phone pickup count (Android only) |
| `switchVelocityPeak` | Max switches/min in any 5-min sliding window |
| `categoryBreakdown` | `{ productive, tools, social, entertainment, passiveWaste }` — always sums to 100 |
| `focusSessionCount` | 20+ min uninterrupted productive sessions |

---

## Firestore Data Model

```
/users/{uid}/
  devices/{deviceId}
    platform:     "win32" | "darwin" | "android"
    appVersion:   "1.0.0"
    lastSeen:     Timestamp
    displayName:  "CogniTrack Desktop"

  sessions/{YYYY-MM-DD}
    userId:       string
    date:         "2026-05-07"
    updatedAt:    Timestamp
    deletedAt:    null | Timestamp          ← soft delete

    phoneMetrics: PhoneSyncPayload          ← written by Android
    desktopSessions:
      {deviceId}: DesktopSyncPayload        ← written by Windows/macOS

    derived:                                ← written by mergeAgentData CF
      combinedLoad:       number
      dualFragmentation:  number
      crossDeviceEvents:  number
      overlapHours:       number
```

---

## Privacy & Security

| Data | Where it stays | Why |
|---|---|---|
| App names, bundle IDs, window titles | Local SQLite only, 7-day TTL | Never synced |
| Usage sequences, per-app categories | Local SQLite only | Never synced |
| Device identifiers | SHA-256 hashed (irreversible) | Cannot reconstruct device |
| Computed daily metrics (11 fields) | Firestore | Aggregated scalars only |
| Firebase credentials | `.env` file, gitignored | Never committed |

Firestore security rules enforce that each user can only read/write their own `uid` path. No admin SDK or service account is used client-side.

---

## Development Workflow

```bash
# 1. Install all workspace dependencies from root
pnpm install

# 2. Build shared packages (required before first desktop run)
pnpm --filter @cognitrack/shared build
pnpm --filter @cognitrack/cognitive-engine build
pnpm --filter @cognitrack/sync-engine build
pnpm --filter @cognitrack/api-client build

# 3. Run desktop agent (Vite + TSC watch + Electron, hot reload)
cd apps/desktop && pnpm dev

# 4. Run Android agent (USB device or emulator)
cd apps/mobile && flutter run

# 5. Deploy Cloud Functions
cd functions && firebase deploy --only functions

# 6. Deploy Firestore rules + indexes
firebase deploy --only firestore
```

### Desktop Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Dev mode — Vite + TSC watch + Electron |
| `pnpm build` | Compile TypeScript + bundle renderer |
| `pnpm dist` | Windows x64 — NSIS installer + portable |
| `pnpm dist:arm64` | Windows ARM64 — Snapdragon X |
| `pnpm dist:all` | Both Windows architectures |
| `pnpm dist:mac` | macOS — `.dmg` + `.app` |

---

## Troubleshooting

### Desktop agent not tracking (macOS)

> `[startup] Accessibility permission not granted — tracker not started`

Go to **System Settings → Privacy & Security → Accessibility**, find CogniTrack, toggle it on, then **quit and relaunch**.

### Google sign-in popup doesn't appear

Make sure **Google** is enabled as a sign-in provider in Firebase Console:
> [Firebase Console → Authentication → Sign-in methods → Google → Enable](https://console.firebase.google.com/project/cognitrack-dcede/authentication/providers)

### Tray shows `○ Tracking Paused` after sign-in

This is normal on macOS if Accessibility permission was not yet granted. Grant it and relaunch.

### Desktop and phone metrics not merging

The `mergeAgentData` Cloud Function triggers automatically on every Firestore write. If `/derived/` is missing:
1. Check Cloud Functions logs: `firebase functions:log`
2. Ensure both agents are signed in with the **same Firebase account (same uid)**
3. Verify Firestore indexes are deployed: `firebase deploy --only firestore:indexes`

### `auth/operation-not-allowed` on Google sign-in

Google sign-in is not enabled in your Firebase project. Enable it at:
> Firebase Console → Authentication → Sign-in methods → Google

---

## Roadmap

- [x] Cognitive engine v6 — state machine, asymmetric context matrix, 2.2× cross-device multiplier
- [x] Windows desktop agent — Electron tray, hourly sync, x64 + ARM64 builds
- [x] macOS desktop agent — menu bar icon, Accessibility permission flow, dock hidden
- [x] Android agent — Flutter foreground service, 15-min sync, APK + AAB
- [x] Google sign-in via `signInWithPopup` + `setWindowOpenHandler` (Electron v30+ compatible)
- [x] Firebase Cloud Functions — `mergeAgentData`, `cleanupOldSessions`
- [x] Device registration system — multi-desktop support per account
- [x] Desktop tray popover — phone metrics section (live Firestore pull)
- [x] Offline sync queue — SQLite-backed, exponential backoff, survives network loss
- [ ] iOS agent — DeviceActivity API + background foreground trigger
- [ ] Web analytics dashboard — React/TypeScript, combined cross-device view
- [ ] Wearable support (future)

---

## Academic Context

CogniTrack was built as part of **02808 Personal Data Interaction for Mobile and Wearables** at DTU (Technical University of Denmark). The cognitive engine is grounded in peer-reviewed research:

- **Attention Residue:** Leroy, S. (2009) — *"Why is it so hard to do my work?"*, Organizational Behavior and Human Decision Processes
- **Asymmetric Switch Costs:** Pettigrew & Martin (2016) — context distance asymmetry in multitasking
- **Phone Presence Effect:** Ward et al. (2017) — working memory reduction from phone visibility alone
- **Cross-Device Multiplier:** Validated against task completion delay studies (400% delay from phone interruptions)

Full research references and architecture decisions: [`CogniTrack-Architecture-v6.md`](./CogniTrack-Architecture-v6.md)

---

## License

MIT — see [LICENSE](./LICENSE)

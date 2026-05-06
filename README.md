<div align="center">

# 🧠 CogniTrack

**Neuroscience-grounded cognitive load tracking across your devices.**

Measure how your attention fragments across apps, screens, and contexts — without ever sending raw data to the cloud.

[![Android](https://img.shields.io/badge/Android-Build%20Ready-3DDC84?style=flat-square&logo=android&logoColor=white)](./apps/mobile)
[![Windows](https://img.shields.io/badge/Windows%20Agent-Ready-0078D4?style=flat-square&logo=windows&logoColor=white)](./apps/desktop)
[![macOS](https://img.shields.io/badge/macOS%20Agent-Planned-lightgrey?style=flat-square&logo=apple)](./apps/desktop)
[![iOS](https://img.shields.io/badge/iOS-Planned-lightgrey?style=flat-square&logo=apple)](./apps/mobile)
[![Firebase](https://img.shields.io/badge/Firebase-Firestore-FFCA28?style=flat-square&logo=firebase&logoColor=black)](https://firebase.google.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](./LICENSE)

</div>

---

## What is CogniTrack?

CogniTrack is a **multi-agent personal informatics system** that measures cognitive load and attention fragmentation across all your devices using a neuroscience-grounded engine. It runs silently in the background on your phone and desktop, computes 11 cognitive metrics locally, and syncs only those computed scalars to Firestore — never raw app usage data.

The system is built around Dr. Sophie Leroy's **attention residue theory** and cognitive science research: not all context switches cost the same, phone interruptions during focused work cost **2.2×** more than desktop switches, and switching from TikTok back to deep work is the single most expensive cognitive transition possible.

> **Privacy first:** Raw event data (app names, window titles, usage sequences) never leaves your device. Only 11 computed daily metric fields are synced.

---

## Platform Status

| Platform | Status | Build | Notes |
|---|---|---|---|
| 🤖 Android | ✅ **Ready** | APK + AAB | Flutter foreground service, 15-min sync |
| 🪟 Windows | ✅ **Agent Ready** | NSIS installer + portable `.exe` | x64 + ARM64 (Snapdragon), system tray |
| 🍎 macOS | 🗓️ **Planned** | — | Electron agent, same architecture as Windows |
| 📱 iOS | 🗓️ **Planned** | — | DeviceActivity API, background-aware design |

---

## Monorepo Structure

This is a **pnpm monorepo** — all apps share packages from `/packages/`. Do not clone individual app subdirectories.

```
CogniTrack/
├── apps/
│   ├── desktop/                  # Electron tray agent — Windows ✅ · macOS 🗓️
│   ├── mobile/                   # Flutter agent — Android ✅ · iOS 🗓️
│   └── web/                      # React analytics dashboard (in development)
│
├── packages/
│   ├── shared/                   # Shared types, constants, canonical app IDs
│   ├── cognitive-engine/         # Unified calculateCognitiveDebt() algorithm
│   ├── sync-engine/              # Offline queue + Firestore sync (shared)
│   └── api-client/               # Firebase Auth + Firestore wrapper
│
├── functions/                    # Firebase Cloud Functions
│   ├── mergeAgentData            # Combines phone + desktop metrics on write
│   └── cleanupOldSessions        # Monthly TTL cleanup
│
├── firestore.rules               # Security rules
├── firestore.indexes.json        # Composite indexes
├── firebase.json
├── pnpm-workspace.yaml
└── CogniTrack-Architecture-v6.md # Full system spec (v6.0)
```

---

## How the Two Agents Connect

Both agents sign in with the **same Firebase email and password**. The shared `uid` is the only link between them — no pairing code, QR scan, or Bluetooth.

```
Android (phone agent)
   └── /users/{uid}/sessions/{date}/phoneMetrics  ← 11 computed fields
                                                         │
                                              mergeAgentData CF fires
                                                         │
Windows (desktop agent)                                  ▼
   └── /users/{uid}/sessions/{date}/             /derived/{date}
         desktopSessions/{deviceId}          combinedLoad, dualFragmentation,
                                             crossDeviceEvents, overlapHours
```

> **Install order:** Android first (creates the account) → then Windows (sign in with the same credentials). Installing Windows first will show a sign-in form with no way to register.

---

## Quick Start

### Prerequisites

| Tool | Version | Required for |
|---|---|---|
| Flutter SDK | ≥ 3.3.0 | Android / iOS agent |
| Node.js | 20 LTS | Desktop agent + Cloud Functions |
| pnpm | 9.x | Monorepo dependency management |
| Java | 17 | Android builds |

---

### Android Agent

```bash
git clone https://github.com/CogniTrack-Org/cognitrack-mobile.git
cd cognitrack-mobile
flutter pub get

# Place google-services.json at android/app/google-services.json
# (Download from Firebase Console → Project Settings → Your apps)

flutter run                          # Development
flutter build apk --release          # Production APK (sideload)
flutter build appbundle --release    # Production AAB (Play Store)
```

→ Full setup guide: [cognitrack-mobile](https://github.com/CogniTrack-Org/cognitrack-mobile)

---

### Windows Desktop Agent

```bash
git clone https://github.com/CogniTrack-Org/CogniTrack.git
cd CogniTrack
pnpm install

cd apps/desktop

# Create .env (copy values from Firebase Console → Project Settings → Your apps)
cat > .env << 'EOF'
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
EOF

pnpm dev                  # Development (Electron tray, live reload)
pnpm dist                 # Production — Windows x64 NSIS installer + portable
pnpm dist:arm64           # Production — Windows ARM64 (Snapdragon X)
pnpm dist:all             # Both architectures in one pass
```

The app launches silently into the **system tray** (`CT` icon, bottom-right). There is no main window — all dashboard UI lives in the Android app.

→ Full setup guide: [cognitrack-desktop](https://github.com/CogniTrack-Org/cognitrack-desktop)

---

## Cognitive Load Engine

The engine runs identically on all platforms via `@cognitrack/cognitive-engine`. It processes local SQLite events into 11 daily metrics without ever exposing raw data.

### State Machine Model

```typescript
interface CognitiveState {
  wm_capacity:           number;  // Working memory tank [0–100]
  residue:               number;  // Attention residue [0–1], decays exponentially
  focus_depth:           number;  // Accumulated deep focus [0–30], resets on switch
  last_switch_ts:        number;
  last_residue_decay_ts: number;
}
```

### Attention Residue Decay

When you switch away from a task, attention residue on the prior task decays exponentially with τ = 7.67 minutes (fitted to Dr. Sophie Leroy's 23-minute recovery window):

```
R(Δt) = e^(−Δt / τ),   τ = 7.67 min
```

At 23 minutes: R ≈ 0.05 (fully recovered). Each new switch stacks on top of undecayed prior residue.

### Asymmetric Context Distance Matrix

Not all switches cost the same. The **from** category matters. Returning to deep work from passive entertainment is the most expensive transition:

```
FROM \ TO     productive  tools  social  entertainment  passiveWaste
productive        1.0      1.5     6.0       5.0            7.0
tools             2.0      1.5     5.0       4.0            6.0
social            8.0 ⚠️  5.0     2.0       2.5            1.5
entertainment     7.0      4.5     2.0       1.5            1.0
passiveWaste      9.0 ⚠️  6.0     1.5       1.0            1.0
```

> `passiveWaste → productive` (e.g. TikTok → VS Code) = **9×** harder than baseline. This models dopamine downregulation + goal reconfiguration + working memory re-population.

### Cross-Device Multiplier

Phone pickups during desktop work carry a **2.2× multiplier** — physical context switch + UI paradigm swap + dopamine-optimised content. Even the mere presence of a phone on your desk reduces working memory capacity.

### The 11 Synced Metrics

```
cognitiveDebt              – total weighted switch cost for the day
cognitiveLoadPct           – 0–100, normalized score
wmCapacityRemaining        – working memory % at end of day
residueAtEOD               – attention still split at day end (0–1)
hourlyLoad[24]             – per-hour cognitive load array
peakLoadHour               – hour with highest load (0–23)
totalSwitches              – raw context switch count
totalPickups               – phone pickup count (Android only)
switchVelocityPeak         – max switches/min in any 5-min window
categoryBreakdown          – { productive, tools, social, entertainment, passiveWaste }
focusSessionCount          – number of 20+ min uninterrupted productive sessions
```

---

## System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                     AGENT LAYER (per device)                     │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────┐  │
│  │   WINDOWS   │  │    macOS    │  │ ANDROID  │  │   iOS    │  │
│  │   AGENT     │  │   AGENT     │  │  AGENT   │  │  AGENT   │  │
│  │ (Electron)  │  │ (Electron)  │  │(Flutter) │  │(Flutter) │  │
│  │             │  │             │  │          │  │          │  │
│  │  active-win │  │  active-win │  │UseStats  │  │DeviceAct │  │
│  │  + idle det │  │  + idle det │  │+ ScreenON│  │ivity API │  │
│  │  ✅ READY   │  │  🗓️ PLANNED │  │✅ READY  │  │🗓️ PLANNED│  │
│  └──────┬──────┘  └──────┬──────┘  └────┬─────┘  └────┬─────┘  │
└─────────┼────────────────┼──────────────┼──────────────┼────────┘
          │                │              │              │
          ▼                ▼              ▼              ▼
┌──────────────────────────────────────────────────────────────────┐
│            @cognitrack/cognitive-engine (shared)                 │
│  normalizeAppId() · calculateCognitiveDebt() · decayResidue()    │
│  CONTEXT_DISTANCE matrix · CROSS_DEVICE_MULTIPLIER (2.2×)       │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│              LOCAL SQLite (never leaves device)                  │
│  app_events · daily_metrics · pending_sync · 7-day TTL · WAL    │
└──────────────────────────┬───────────────────────────────────────┘
                           │ 15-min batches · offline queue · backoff
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                  FIRESTORE (computed metrics only)               │
│                                                                  │
│  /users/{uid}/                                                   │
│    devices/{deviceId}     ← device registry (platform, lastSeen)│
│    sessions/{YYYY-MM-DD}/                                        │
│      phoneMetrics         ← 11 fields from Android              │
│      desktopSessions/                                            │
│        {deviceId}         ← 11 fields per Windows/macOS device  │
│      derived/             ← mergeAgentData CF output            │
│        combinedLoad · dualFragmentation · overlapHours           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Privacy & Security

| What | Where it stays | Why |
|---|---|---|
| App names, bundle IDs, window titles | Local SQLite only, 7-day TTL | Never synced |
| Usage sequences, categories per app | Local SQLite only | Never synced |
| Device identifiers | SHA-256 hash (irreversible) | Cannot reconstruct device ID |
| Computed daily metrics (11 fields) | Firestore | Aggregated, no raw events |
| Firebase credentials | `.env` file, gitignored | Never committed |

Firestore security rules enforce that users can only read/write their own `uid` path.

---

## Development Workflow

```bash
# Install all workspace dependencies from monorepo root
pnpm install

# Run desktop agent in dev mode (Vite + TSC watch + Electron)
cd apps/desktop && pnpm dev

# Run Android agent
cd apps/mobile && flutter run

# Build shared packages (required before first desktop run)
pnpm --filter @cognitrack/shared build
pnpm --filter @cognitrack/cognitive-engine build

# Deploy Cloud Functions
cd functions && firebase deploy --only functions

# Deploy Firestore rules + indexes
firebase deploy --only firestore
```

---

## Roadmap

- [x] Cognitive engine v6 — state machine, asymmetric context matrix, cross-device multiplier
- [x] Windows desktop agent — Electron tray, hourly sync, x64 + ARM64 builds
- [x] Android agent — Flutter foreground service, 15-min sync, APK + AAB builds
- [x] Firebase Cloud Functions — `mergeAgentData`, `cleanupOldSessions`
- [x] Device registration system — multi-desktop support
- [ ] macOS desktop agent — Electron, same architecture as Windows
- [ ] iOS agent — DeviceActivity API + background foreground trigger
- [ ] Web analytics dashboard — React/TypeScript, combined cross-device view
- [ ] Wearable support (future consideration)

---

## Related Repositories

| Repo | Description |
|---|---|
| [`cognitrack-mobile`](https://github.com/CogniTrack-Org/cognitrack-mobile) | Flutter Android agent (standalone clone for Android contributors) |
| [`cognitrack-desktop`](https://github.com/CogniTrack-Org/cognitrack-desktop) | Electron Windows agent (standalone clone for desktop contributors) |
| [`cognitrack-docs`](https://github.com/CogniTrack-Org/cognitrack-docs) | Architecture diagrams, research references, design decisions |

---

## Academic Context

CogniTrack was built as part of **02808 Personal Data Interaction for Mobile and Wearables** at DTU (Technical University of Denmark). The cognitive engine is grounded in peer-reviewed research:

- **Attention Residue:** Dr. Sophie Leroy (2009) — *"Why is it so hard to do my work?"*
- **Asymmetric Switch Costs:** Pettigrew & Martin (2016) — context distance asymmetry
- **Phone Presence Effect:** Ward et al. (2017) — WM reduction from phone visibility
- **Cross-Device Multiplier:** Validated against task completion delay studies (400% delay from phone interruptions)

Full research references: [`CogniTrack-Architecture-v6.md`](./CogniTrack-Architecture-v6.md)

---

## License

MIT — see [LICENSE](./LICENSE)

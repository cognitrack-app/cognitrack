# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a monorepo for CogniTrack, a neuroscience-grounded personal informatics system that measures cognitive load and dual-device fragmentation.

### Key Directories
- `apps/` - Main applications (web, mobile, desktop)
- `packages/` - Shared libraries
- `functions/` - Firebase Cloud Functions
- `docs/` - Documentation

### Stack
TypeScript, React, Expo, Node.js, PostgreSQL, Firebase, Docker

## Key Components

### Shared Package (@cognitrack/shared)
The core cognitive engine is in the shared package, which provides:
- Cognitive load engine (`cognitiveEngine.ts`)
- Fragmentation algorithm (`fragmentation.ts`)
- App normalization (`appNormalizer.ts`)
- Residue decay calculations (`residueDecay.ts`)
- Velocity multipliers (`velocityMultiplier.ts`)
- Date utilities (`dateUtils.ts`)
- Constants and types

### Applications
- `apps/web` - React/TypeScript frontend
- `apps/mobile` - Expo React Native app
- `apps/desktop` - Cross-platform desktop application (macOS, Windows)

### Backend
- `functions/` - Firebase Cloud Functions for:
  - Device registration (`registerDevice.ts`)
  - Data cleanup (`cleanup.ts`)
  - Data merging (`merge.ts`)
  - Weekly rollups (`weeklyRollup.ts`)

## Development Commands

- `npm run dev:mobile` - Start mobile app
- `npm run dev:desktop` - Start desktop app  
- `npm run dev:functions` - Watch and build functions
- `npm run build:shared` - Build shared package
- `npm run build:functions` - Build functions
- `npm run build:all` - Build everything
- `npm run emulators` - Start Firebase emulators
- `npm run deploy:functions` - Deploy functions
- `npm run deploy:firestore` - Deploy Firestore rules
- `npm run deploy:all` - Deploy everything

## Architecture Overview

The system uses a multi-agent architecture where each device runs an agent that:
1. Collects raw events locally (app switches, pickups, idle periods)
2. Processes them through the shared cognitive engine
3. Stores events in local SQLite (7-day TTL)
4. Syncs computed daily metrics to Firestore

### Cognitive Engine Implementation

The cognitive engine in `cognitiveEngine.ts` implements a state machine model with:
- Working memory that depletes on context switches and recovers during breaks
- Attention residue that accumulates from context switches and decays over time
- Focus depth that builds during sustained focus periods
- Asymmetric context distance matrix that weights different app category switches differently
- Velocity multipliers that adjust switch costs based on switch frequency
- Daily debt calculation that normalizes to 0-100 scale

### Data Flow

1. Raw events are collected locally on each device
2. Events are processed through the cognitive engine to compute:
   - Cognitive debt and load percentage
   - Working memory capacity remaining
   - Residue at end of day
   - Hourly debt distribution
   - Peak load hour
3. Computed metrics are stored locally and synced to Firestore
4. Fragmentation score is computed by combining phone and desktop hourly debt data
5. Weekly rollups aggregate daily metrics for long-term analysis

### Fragmentation Algorithm

The fragmentation algorithm in `fragmentation.ts` computes dual-device fragmentation by:
- Identifying hours where both devices were simultaneously active above thresholds (phone > 20%, desktop > 30%)
- Counting dual-active hours to produce a fragmentation score (0-24)
- Tracking peak overlap hour for detailed analysis

## Sync Engine

The sync engine (`packages/sync-engine`) handles local queuing and synchronization of cognitive metrics:
- Uses SQLite database for local storage
- Implements SyncEngine class with methods for pushing items to queue and flushing the queue
- Implements SyncQueue class for database operations
- Manages queue status tracking (pending, syncing, synced, failed)
- Handles sync failures gracefully with error tracking

## Permissions & Safety Rules

- NEVER run `rm -rf` without explicit confirmation
- NEVER run `firebase deploy` without specifying `--only` flag
- NEVER modify `firestore.rules` or `firebase.json` without showing the diff first
- NEVER commit with `git commit -a` — always show staged files first
- Always run `pnpm build:shared` before building any app package
- Always run the emulators locally before any deploy

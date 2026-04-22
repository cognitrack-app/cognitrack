# CogniTrack Desktop Application

Cross-platform desktop application for CogniTrack, a neuroscience-grounded personal informatics system that measures cognitive load and dual-device fragmentation.

## Features

- Local data storage using SQLite database
- Real-time synchronization with Firestore
- Cognitive load tracking and visualization
- Dual-device fragmentation analysis
- Session history and analytics

## Architecture

### Core Components

1. **Electron Application** - Main process that manages the application lifecycle and IPC
2. **SQLite Store** - Local database for session data persistence
3. **IPC Bridge** - Communication layer between main and renderer processes
4. **React Hooks** - Data access patterns for the UI

### Data Flow

1. Raw events are collected locally on each device
2. Events are processed through the shared cognitive engine
3. Computed metrics are stored locally in SQLite (7-day TTL)
4. Metrics are synced to Firestore for cross-device analysis
5. Fragmentation score is computed by combining phone and desktop hourly debt data

## Database Schema

The application uses SQLite to store cognitive session data with the following tables:

### Sessions Table
Stores cognitive session data including:
- Session metadata (start/end time, duration)
- Cognitive metrics (cognitive debt, working memory capacity, residue)
- Hourly debt distribution
- Peak load hour
- Sync status

### App Usage Table
Stores detailed application usage data for each session:
- App ID and name
- Usage duration
- Timestamp

## Key Files

- `src/index.ts` - Main application entry point
- `src/electron/main/sqliteStore.ts` - SQLite database implementation
- `src/electron/preload/index.ts` - IPC bridge for renderer process
- `src/hooks/` - React hooks for data access
- `src/types/electron.d.ts` - TypeScript declarations

## Development

### Prerequisites

- Node.js (v16 or later)
- npm or yarn

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev:desktop
```

### Building

```bash
# Build for production
npm run build:desktop
```

## API Endpoints

The desktop app exposes the following IPC endpoints:

### Session Data
- `sessions:getToday` - Get today's sessions
- `sessions:getHourly` - Get hourly breakdown for chart
- `sessions:getTopApps` - Get top used apps
- `sessions:getRange` - Get sessions in date range

### Sync Operations
- `sync:hydrate` - Hydrate from Firestore

## License

MIT
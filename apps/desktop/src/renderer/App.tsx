import React, { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
// BUG-2 FIX: was `import { auth } from '../../../../packages/api-client/src/firebase'`
// That is a raw relative cross-package path — it bypasses the workspace package
// boundary and breaks in production builds where packages/ is NOT at ../../../../
// relative to dist-renderer/. Use the workspace package name instead, which
// resolves correctly at both dev and build time via pnpm workspace aliasing.
import { auth } from '@cognitrack/api-client';
import { TrayPopover } from './TrayPopover';
import { SignInPopover } from './SignInPopover';

interface TrayStats {
  isTracking:          boolean;
  cognitiveLoadPct:    number;
  totalSwitches:       number;
  wmCapacityRemaining: number;
  syncStatus: {
    pending: number;
    syncing: number;
    synced:  number;
    failed:  number;
    total:   number;
  };
}

const EMPTY_STATS: TrayStats = {
  isTracking:          false,
  cognitiveLoadPct:    0,
  totalSwitches:       0,
  wmCapacityRemaining: 100,
  syncStatus: { pending: 0, syncing: 0, synced: 0, failed: 0, total: 0 },
};

/**
 * Root component for the CogniTrack tray popover.
 *
 * Auth flow:
 *   - onAuthStateChanged fires immediately with the persisted Firebase auth
 *     state (fast path: < 1 s if token is cached).
 *   - If the user is not signed in, renders <SignInPopover /> which offers
 *     both Google OAuth and email/password.
 *   - After sign-in (either path), Firebase fires onAuthStateChanged →
 *     setIsAuthenticated(true) → renders <TrayPopover /> and signals main
 *     via window.electronAPI.signIn(uid) to unblock startup.
 *
 * Stats flow:
 *   - Polls tray:getStats every 30 s as a heartbeat fallback.
 *   - Listens for real-time tray:statsUpdate pushed by main after each
 *     hourly batch — this is the primary update path (now fixed, see BUG-1).
 */
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked,     setAuthChecked]     = useState(false);
  const [stats,           setStats]           = useState<TrayStats>(EMPTY_STATS);
  const [loaded,          setLoaded]          = useState(false);

  // ── Fetch stats from main process ──────────────────────────────────────

  const fetchStats = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const data = await window.electronAPI.getStats();
      setStats(data);
      setLoaded(true);
    } catch (err) {
      console.error('[popover] Failed to fetch stats:', err);
    }
  }, [isAuthenticated]);

  // ── Auth state listener ──────────────────────────────────────────

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
      setAuthChecked(true);
      if (user) {
        // Signal main process to unblock waitForAuthFromRenderer().
        // This fires for BOTH email/password AND Google OAuth — in the Google
        // path, googleOAuth.ts already calls signIn() after the deep-link, but
        // a second call is harmless (ipcMain.once deduplicates it).
        window.electronAPI.signIn(user.uid);
      }
    });
    return unsubscribe;
  }, []);

  // ── Stats polling + live push subscription ────────────────────────

  useEffect(() => {
    if (!isAuthenticated) return;

    // Initial fetch on mount
    fetchStats();

    // Heartbeat poll every 30 s (covers cases where main doesn't push updates)
    const interval = setInterval(fetchStats, 30_000);

    // Real-time push from main after each hourly batch (primary update path).
    // Requires BUG-1 fix in preload — without it, this callback never fired.
    const cleanup = window.electronAPI.onStatsUpdate((data) => {
      setStats(data);
      setLoaded(true);
    });

    return () => {
      clearInterval(interval);
      cleanup(); // remove ipcRenderer listener — prevents memory leak
    };
  }, [fetchStats, isAuthenticated]);

  // ── Pause / resume handlers ──────────────────────────────────

  const handlePause = useCallback(async () => {
    const result = await window.electronAPI.pauseTracking();
    setStats(prev => ({ ...prev, isTracking: result.isTracking }));
  }, []);

  const handleResume = useCallback(async () => {
    const result = await window.electronAPI.resumeTracking();
    setStats(prev => ({ ...prev, isTracking: result.isTracking }));
  }, []);

  // ── Render ───────────────────────────────────────────────────

  // While Firebase resolves the persisted auth state (< 1 s normally)
  if (!authChecked) {
    return (
      <div className="popover">
        <div className="popover__loading">Loading…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <SignInPopover />;
  }

  return (
    <TrayPopover
      stats={stats}
      loaded={loaded}
      onPause={handlePause}
      onResume={handleResume}
    />
  );
}

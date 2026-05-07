import React, { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@cognitrack/api-client';
import { TrayPopover } from './TrayPopover';
import { SignInPopover } from './SignInPopover';
import type { MobileData } from '../electron/preload/index';

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
 *     Google OAuth (signInWithPopup via setWindowOpenHandler) and email/password.
 *   - After sign-in, Firebase fires onAuthStateChanged → setIsAuthenticated(true)
 *     → renders <TrayPopover /> and signals main via window.electronAPI.signIn(uid).
 *
 * Stats flow:
 *   - Polls tray:getStats every 30 s as a heartbeat fallback.
 *   - Listens for real-time tray:statsUpdate pushed by main after each hourly
 *     batch — primary update path (BUG-1 fixed in preload).
 *
 * Mobile sync flow:
 *   - On auth, fetches today's phone metrics from Firestore via IPC once.
 *   - User can manually refresh via the ↻ button in TrayPopover.
 */
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked,     setAuthChecked]     = useState(false);
  const [stats,           setStats]           = useState<TrayStats>(EMPTY_STATS);
  const [loaded,          setLoaded]          = useState(false);
  const [mobileData,      setMobileData]      = useState<MobileData | null>(null);
  const [mobileSyncing,   setMobileSyncing]   = useState(false);

  // ── Fetch desktop stats from main process ───────────────────────────────────

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

  // ── Fetch phone metrics from Firestore ──────────────────────────────────────

  const fetchMobileData = useCallback(async () => {
    setMobileSyncing(true);
    try {
      const data = await window.electronAPI.syncMobileData();
      setMobileData(data);
    } catch (err) {
      console.error('[popover] Failed to fetch mobile ', err);
    } finally {
      setMobileSyncing(false);
    }
  }, []);

  // ── Auth state listener ────────────────────────────────────────────────────

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
      setAuthChecked(true);
      if (user) {
        // Signal main process to unblock waitForAuthFromRenderer().
        // Fires for BOTH email/password AND Google OAuth paths.
        window.electronAPI.signIn(user.uid);
      }
    });
    return unsubscribe;
  }, []);

  // ── Stats polling + live push subscription ───────────────────────────────

  useEffect(() => {
    if (!isAuthenticated) return;

    fetchStats();
    fetchMobileData(); // non-blocking: fetch phone data once on sign-in

    const interval = setInterval(fetchStats, 30_000);

    // Real-time push from main after each hourly batch (primary update path).
    const cleanup = window.electronAPI.onStatsUpdate((data) => {
      setStats(data);
      setLoaded(true);
    });

    return () => {
      clearInterval(interval);
      cleanup();
    };
  }, [fetchStats, fetchMobileData, isAuthenticated]);

  // ── Pause / resume handlers ────────────────────────────────────────────

  const handlePause = useCallback(async () => {
    const result = await window.electronAPI.pauseTracking();
    setStats(prev => ({ ...prev, isTracking: result.isTracking }));
  }, []);

  const handleResume = useCallback(async () => {
    const result = await window.electronAPI.resumeTracking();
    setStats(prev => ({ ...prev, isTracking: result.isTracking }));
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────────

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
      mobileData={mobileData}
      mobileSyncing={mobileSyncing}
      onSyncMobile={fetchMobileData}
    />
  );
}

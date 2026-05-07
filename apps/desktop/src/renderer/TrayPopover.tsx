import React from 'react';
import type { MobileData } from '../electron/preload/index';

// ── Types ────────────────────────────────────────────────────────────────────────

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

interface TrayPopoverProps {
  stats:         TrayStats;
  loaded:        boolean;
  onPause:       () => void;
  onResume:      () => void;
  mobileData:    MobileData | null;
  mobileSyncing: boolean;
  onSyncMobile:  () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function loadColor(pct: number): string {
  if (pct <= 40) return 'var(--color-good)';
  if (pct <= 70) return 'var(--color-warn)';
  return 'var(--color-danger)';
}

function wmColor(pct: number): string {
  if (pct >= 60) return 'var(--color-good)';
  if (pct >= 30) return 'var(--color-warn)';
  return 'var(--color-danger)';
}

function syncLabel(sync: TrayStats['syncStatus']): string {
  if (sync.pending > 0 || sync.syncing > 0) return `${sync.pending + sync.syncing} pending`;
  if (sync.failed > 0)                      return `${sync.failed} failed`;
  if (sync.total === 0)                     return 'No data yet';
  return 'Synced';
}

function syncDotClass(sync: TrayStats['syncStatus']): string {
  if (sync.failed > 0)                          return 'dot dot--danger';
  if (sync.pending > 0 || sync.syncing > 0)     return 'dot dot--warn';
  return 'dot dot--good';
}

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * TrayPopover — the main screen in the desktop client.
 *
 * 260×280px frameless window. Shows desktop metrics, a Firestore sync
 * indicator, mobile data snapshot, and pause/resume controls.
 * All detailed history UI lives on the mobile app.
 */
export function TrayPopover({
  stats,
  loaded,
  onPause,
  onResume,
  mobileData,
  mobileSyncing,
  onSyncMobile,
}: TrayPopoverProps) {
  const hasMobileData = mobileData !== null && typeof mobileData === 'object';

  return (
    <div className="popover" id="tray-popover">

      {/* ── Header ────────────────────────────────────────────── */}
      <header className="popover__header">
        <div className="popover__brand">
          <svg className="popover__logo" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="url(#grad)" strokeWidth="2" />
            <circle cx="8" cy="8" r="3" fill="url(#grad)" />
            <defs>
              <linearGradient id="grad" x1="0" y1="0" x2="16" y2="16">
                <stop offset="0%" stopColor="#6C5CE7" />
                <stop offset="100%" stopColor="#00CEC9" />
              </linearGradient>
            </defs>
          </svg>
          <span className="popover__title">CogniTrack</span>
        </div>
        <span
          className={`dot ${stats.isTracking ? 'dot--good' : 'dot--off'}`}
          title={stats.isTracking ? 'Tracking active' : 'Tracking paused'}
        />
      </header>

      <div className="popover__divider" />

      {/* ── Desktop stats ────────────────────────────────────────── */}
      {!loaded ? (
        <div className="popover__loading">Loading…</div>
      ) : (
        <div className="popover__stats">
          <StatRow
            label="Load today"
            value={`${Math.round(stats.cognitiveLoadPct)}%`}
            color={loadColor(stats.cognitiveLoadPct)}
          />
          <StatRow
            label="Switches"
            value={String(stats.totalSwitches)}
          />
          <StatRow
            label="WM left"
            value={`${Math.round(stats.wmCapacityRemaining)}%`}
            color={wmColor(stats.wmCapacityRemaining)}
          />
        </div>
      )}

      {/* ── Mobile data ──────────────────────────────────────────── */}
      <div className="popover__divider" />
      <div
        className="popover__mobile"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="popover__mobile-header">
          <span className="popover__mobile-label">📱 Phone today</span>
          <button
            id="btn-sync-mobile"
            className="popover__btn popover__btn--ghost"
            onClick={onSyncMobile}
            disabled={mobileSyncing}
            title="Refresh phone data"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {mobileSyncing ? '⟳' : '↻'}
          </button>
        </div>

        {mobileSyncing ? (
          <div className="popover__mobile-value" style={{ color: 'var(--text-muted)' }}>Syncing…</div>
        ) : hasMobileData ? (
          <div style={{ display: 'flex', gap: '12px' }}>
            {typeof mobileData!.cognitiveLoadPct === 'number' && (
              <div className="popover__mobile-stat">
                <span
                  className="popover__mobile-val"
                  style={{ color: loadColor(mobileData!.cognitiveLoadPct as number) }}
                >
                  {Math.round(mobileData!.cognitiveLoadPct as number)}%
                </span>
                <span className="popover__mobile-key">load</span>
              </div>
            )}
            {typeof mobileData!.totalScreenTimeMin === 'number' && (
              <div className="popover__mobile-stat">
                <span className="popover__mobile-val">
                  {Math.round((mobileData!.totalScreenTimeMin as number) / 60 * 10) / 10}h
                </span>
                <span className="popover__mobile-key">screen</span>
              </div>
            )}
            {typeof mobileData!.appSwitches === 'number' && (
              <div className="popover__mobile-stat">
                <span className="popover__mobile-val">{mobileData!.appSwitches as number}</span>
                <span className="popover__mobile-key">switches</span>
              </div>
            )}
          </div>
        ) : (
          <div className="popover__mobile-value" style={{ color: 'var(--text-muted)' }}>No phone data today</div>
        )}
      </div>

      <div className="popover__divider" />

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="popover__footer">
        <div className="popover__sync" title="Firestore sync status">
          <span className={syncDotClass(stats.syncStatus)} />
          <span className="popover__sync-text">{syncLabel(stats.syncStatus)}</span>
        </div>
        <div className="popover__actions">
          {stats.isTracking ? (
            <button
              id="btn-pause"
              className="popover__btn popover__btn--secondary"
              onClick={onPause}
            >
              Pause
            </button>
          ) : (
            <button
              id="btn-resume"
              className="popover__btn popover__btn--primary"
              onClick={onResume}
            >
              Resume
            </button>
          )}
        </div>
      </footer>

    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="stat-row">
      <span className="stat-row__label">{label}</span>
      <span className="stat-row__value" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

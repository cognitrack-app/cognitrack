import React from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

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
  stats:    TrayStats;
  loaded:   boolean;
  onPause:  () => void;
  onResume: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a color from green → amber → red based on a 0-100 percentage. */
function loadColor(pct: number): string {
  if (pct <= 40) return 'var(--color-good)';
  if (pct <= 70) return 'var(--color-warn)';
  return 'var(--color-danger)';
}

/** Returns a color for WM capacity (inverse — high is good). */
function wmColor(pct: number): string {
  if (pct >= 60) return 'var(--color-good)';
  if (pct >= 30) return 'var(--color-warn)';
  return 'var(--color-danger)';
}

/** Format sync status into a terse label. */
function syncLabel(sync: TrayStats['syncStatus']): string {
  if (sync.pending > 0 || sync.syncing > 0) return `${sync.pending + sync.syncing} pending`;
  if (sync.failed > 0) return `${sync.failed} failed`;
  if (sync.total === 0) return 'No data yet';
  return 'Synced';
}

function syncDotClass(sync: TrayStats['syncStatus']): string {
  if (sync.failed > 0) return 'dot dot--danger';
  if (sync.pending > 0 || sync.syncing > 0) return 'dot dot--warn';
  return 'dot dot--good';
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * TrayPopover — the ONLY screen in the desktop client.
 *
 * 260×200px frameless window. Shows 3 key metrics at a glance,
 * a sync indicator, and pause/resume + quit controls.
 * All dashboard and history UI lives on the mobile app.
 */
export function TrayPopover({ stats, loaded, onPause, onResume }: TrayPopoverProps) {
  return (
    <div className="popover" id="tray-popover">
      {/* ── Header ──────────────────────────────────────────────────── */}
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

      {/* ── Divider ─────────────────────────────────────────────────── */}
      <div className="popover__divider" />

      {/* ── Stats ───────────────────────────────────────────────────── */}
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

      {/* ── Divider ─────────────────────────────────────────────────── */}
      <div className="popover__divider" />

      {/* ── Footer ──────────────────────────────────────────────────── */}
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

// ── Sub-components ───────────────────────────────────────────────────────────

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

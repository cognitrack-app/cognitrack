import React, { useState } from 'react';
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@cognitrack/api-client';

/**
 * SignInPopover — shown when the user is not authenticated.
 *
 * Two sign-in paths:
 *
 * 1. Google OAuth:
 *    Calls signInWithPopup() directly in the renderer. Electron v30+
 *    blocks window.open() by default, but index.ts registers a
 *    setWindowOpenHandler that allows Firebase/Google auth URLs
 *    (accounts.google.com, *.firebaseapp.com/__/auth, apis.google.com).
 *    Firebase SDK opens a 500x620 child BrowserWindow for the consent
 *    screen, completes the OAuth flow, and resolves with the User.
 *    onAuthStateChanged in App.tsx then fires and signals main via
 *    window.electronAPI.signIn(uid).
 *
 * 2. Email / Password:
 *    Standard Firebase signInWithEmailAndPassword in the renderer.
 *    onAuthStateChanged in App.tsx signals main via signIn(uid).
 */
export function SignInPopover() {
  const [email,         setEmail]         = useState('');
  const [password,      setPassword]      = useState('');
  const [error,         setError]         = useState('');
  const [loading,       setLoading]       = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // ── Google OAuth ─────────────────────────────────────────────────────

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setError('');
    try {
      // signInWithPopup works in Electron because setWindowOpenHandler in
      // index.ts whitelists Google/Firebase auth URLs. Firebase opens a
      // child BrowserWindow (500x620) for the consent screen, completes
      // the OAuth exchange, and resolves with the signed-in User.
      // App.tsx's onAuthStateChanged then fires and calls signIn(uid).
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      // No need to call window.electronAPI.signIn() here —
      // onAuthStateChanged in App.tsx handles it.
    } catch (err: any) {
      // user_cancelled: user closed the popup without signing in — not an error
      if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
        setError(err?.message ?? 'Google sign-in failed. Please try again.');
      }
      setGoogleLoading(false);
    }
  };

  // ── Email / Password ─────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      window.electronAPI.signIn(cred.user.uid);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const isAnyLoading = loading || googleLoading;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="popover" id="sign-in-popover">

      {/* ── Header ────────────────────────────────────────────── */}
      <header className="popover__header">
        <div className="popover__brand">
          <svg className="popover__logo" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="url(#grad)" strokeWidth="2" />
            <circle cx="8" cy="8" r="3" fill="url(#grad)" />
            <defs>
              <linearGradient id="grad" x1="0" y1="0" x2="16" y2="16">
                <stop offset="0%"   stopColor="#6C5CE7" />
                <stop offset="100%" stopColor="#00CEC9" />
              </linearGradient>
            </defs>
          </svg>
          <span className="popover__title">CogniTrack</span>
        </div>
      </header>

      <div className="popover__divider" />

      {/* ── Google Sign-In Button ──────────────────────────────────── */}
      <div style={{ padding: '0 16px' }}>
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isAnyLoading}
          className="popover__btn"
          style={{
            width:           '100%',
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'center',
            gap:             '8px',
            background:      'rgba(255,255,255,0.07)',
            border:          '1px solid rgba(255,255,255,0.15)',
            color:           'var(--text-primary)',
            padding:         '8px 14px',
            fontSize:        '12px',
            opacity:         isAnyLoading ? 0.6 : 1,
            cursor:          isAnyLoading ? 'not-allowed' : 'pointer',
            WebkitAppRegion: 'no-drag' as any,
          }}
        >
          {!googleLoading && (
            <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
          )}
          {googleLoading ? 'Signing in with Google…' : 'Continue with Google'}
        </button>
      </div>

      {/* ── Divider ─────────────────────────────────────────────── */}
      <div style={{
        display:    'flex',
        alignItems: 'center',
        gap:        '8px',
        padding:    '10px 16px 0',
      }}>
        <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', userSelect: 'none' }}>or</span>
        <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
      </div>

      {/* ── Email / Password form ────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding:         '10px 16px 14px',
          display:         'flex',
          flexDirection:   'column',
          gap:             '8px',
          WebkitAppRegion: 'no-drag' as any,
        }}
      >
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          disabled={isAnyLoading}
          style={{
            padding:      '7px 10px',
            borderRadius: '5px',
            border:       '1px solid var(--border)',
            background:   'rgba(255,255,255,0.05)',
            color:        'var(--text-primary)',
            fontSize:     '12px',
            outline:      'none',
          }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          disabled={isAnyLoading}
          style={{
            padding:      '7px 10px',
            borderRadius: '5px',
            border:       '1px solid var(--border)',
            background:   'rgba(255,255,255,0.05)',
            color:        'var(--text-primary)',
            fontSize:     '12px',
            outline:      'none',
          }}
        />

        {error && (
          <div style={{
            color:      'var(--color-danger)',
            fontSize:   '11px',
            lineHeight: 1.3,
            wordBreak:  'break-word',
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isAnyLoading}
          className="popover__btn popover__btn--primary"
          style={{
            marginTop:      '2px',
            width:          '100%',
            justifyContent: 'center',
            opacity:        isAnyLoading ? 0.6 : 1,
            cursor:         isAnyLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Signing in…' : 'Sign In with Email'}
        </button>
      </form>

    </div>
  );
}

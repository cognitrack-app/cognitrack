import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../../../packages/api-client/src/firebase';

export function SignInPopover() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      // Let main process know we signed in
      window.electronAPI.signIn(cred.user.uid);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="popover" id="sign-in-popover">
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
          <span className="popover__title">CogniTrack Sign In</span>
        </div>
      </header>

      <div className="popover__divider" />

      <form onSubmit={handleSubmit} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <input 
          type="email" 
          placeholder="Email" 
          value={email} 
          onChange={e => setEmail(e.target.value)}
          required
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--color-border)', background: 'transparent', color: 'inherit' }}
        />
        <input 
          type="password" 
          placeholder="Password" 
          value={password} 
          onChange={e => setPassword(e.target.value)}
          required
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--color-border)', background: 'transparent', color: 'inherit' }}
        />
        {error && <div style={{ color: 'var(--color-danger)', fontSize: '12px' }}>{error}</div>}
        <button 
          type="submit" 
          disabled={loading}
          className="popover__btn popover__btn--primary"
          style={{ marginTop: '8px', width: '100%', justifyContent: 'center' }}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

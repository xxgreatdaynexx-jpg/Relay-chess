import { useEffect, useState } from 'react';
import { useAccount } from '@/lib/auth';
import { authCall, logout } from '@/lib/net';
import { loadName } from '@/lib/playerName';

/** Sign in to a claimed name, or claim a free one with a password. */
export function AccountBox({ compact = false }: { compact?: boolean }) {
  const account = useAccount();
  const [name, setName] = useState(() => loadName());
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [status, setStatus] = useState<'unknown' | 'free' | 'taken' | 'reserved'>('unknown');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (account) return;
    const n = name.trim();
    setStatus('unknown');
    if (!n) return;
    const id = window.setTimeout(() => {
      void authCall('auth_status', { name: n }).then((r) => {
        if (!r.ok) return setError(r.error ?? '');
        setError('');
        setStatus(r.reserved ? 'reserved' : r.claimed ? 'taken' : 'free');
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [name, account]);

  if (account) {
    return (
      <div className={`account-box account-in${compact ? ' account-compact' : ''}`} data-testid="account-box">
        Signed in as <b>{account}</b> · <button type="button" className="account-link" onClick={logout}>Log out</button>
      </div>
    );
  }

  const claiming = status === 'free';
  const submit = async () => {
    setError('');
    if (!name.trim()) return setError('Enter a name.');
    if (status === 'reserved') return setError('Names starting with "Guest" are reserved. Pick another.');
    if (claiming) {
      if (pw.length < 4) return setError('Password must be at least 4 characters.');
      if (pw !== pw2) return setError('The two passwords don’t match.');
    } else if (!pw) return setError('Enter the password for this name.');
    setBusy(true);
    const r = await authCall(claiming ? 'auth_claim' : 'auth_login', { name: name.trim(), password: pw });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? 'Sign-in failed.');
    setPw('');
    setPw2('');
  };

  return (
    // Not a <form>: this sits inside other forms (Create a table), and nested forms submit the page.
    <div
      className={`account-box${compact ? ' account-compact' : ''}`}
      data-testid="account-box"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          void submit();
        }
      }}
    >
      <div className="account-row">
        <input aria-label="Your name" placeholder="Your name" maxLength={18} value={name} autoComplete="username" onChange={(e) => setName(e.target.value)} data-testid="auth-name" />
        <input aria-label="Password" placeholder={claiming ? 'New password' : 'Password'} type="password" value={pw} autoComplete={claiming ? 'new-password' : 'current-password'} onChange={(e) => setPw(e.target.value)} data-testid="auth-password" />
        {claiming && <input aria-label="Confirm password" placeholder="Confirm password" type="password" value={pw2} autoComplete="new-password" onChange={(e) => setPw2(e.target.value)} data-testid="auth-password2" />}
        <button type="button" onClick={() => void submit()} disabled={busy} data-testid="auth-submit">{claiming ? 'Claim name' : 'Sign in'}</button>
      </div>
      <div className="account-hint">
        {error ? <span className="account-error">{error}</span>
          : status === 'taken' ? 'This name is taken. Enter its password to sign in.'
          : status === 'free' ? 'This name is free. Set a password to make it yours.'
          : status === 'reserved' ? 'Guest names are for the Arena only. Pick another.'
          : 'Sign in to play. Your name keeps your stats and chips.'}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useAccount } from '@/lib/auth';
import { logout, socket } from '@/lib/net';
import { AccountBox } from '@/components/AccountBox';
import { ACCOUNT_EVT, openAccount, resetSettings, resetWindowPositions, updateSettings, useSettings } from '@/lib/settings';
import { ACCENTS, BOARD_PRESETS, THEMES, type Theme } from '../../../shared/settings';

const THEME_LABEL: Record<Theme, string> = { dark: 'Dark', light: 'Light', contrast: 'High contrast' };

/** Header avatar: initials when signed in, a person glyph otherwise. Opens the Account panel. */
export function AccountButton() {
  const account = useAccount();
  const initials = account ? account.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '';
  return (
    <button type="button" className="acct-btn" onClick={() => openAccount('account')} data-testid="account-button" aria-label={account ? `Account: ${account}` : 'Sign in'}>
      <span className="acct-avatar" aria-hidden="true">{initials || '👤'}</span>
      <span className="acct-btn-name">{account || 'Sign in'}</span>
    </button>
  );
}

/** Lobby line: who you'll play as, with a link to the Account panel. */
export function PlayingAs() {
  const account = useAccount();
  return (
    <div className="acct-playing" data-testid="playing-as">
      {account ? <>Playing as <b>{account}</b> · <button type="button" className="account-link" onClick={() => openAccount()}>Account</button></>
        : <>Not signed in. <button type="button" className="account-link" onClick={() => openAccount()} data-testid="open-account">Sign in or claim a name</button> to play.</>}
    </div>
  );
}

export function AccountPanel() {
  const [open, setOpen] = useState<null | 'account' | 'settings'>(null);
  useEffect(() => {
    const on = (e: Event) => setOpen(((e as CustomEvent).detail as 'account' | 'settings') ?? 'account');
    window.addEventListener(ACCOUNT_EVT, on);
    return () => window.removeEventListener(ACCOUNT_EVT, on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  if (!open) return null;
  return (
    <div className="acct-scrim" onPointerDown={(e) => e.target === e.currentTarget && setOpen(null)}>
      <div className="acct-panel" role="dialog" aria-label="Account and settings" data-testid="account-panel">
        <div className="acct-head">
          <div className="acct-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={open === 'account'} onClick={() => setOpen('account')} data-testid="tab-account">Account</button>
            <button type="button" role="tab" aria-selected={open === 'settings'} onClick={() => setOpen('settings')} data-testid="tab-settings">Settings</button>
          </div>
          <button type="button" className="acct-close" aria-label="Close" onClick={() => setOpen(null)}>✕</button>
        </div>
        <div className="acct-body">{open === 'account' ? <AccountTab /> : <SettingsTab />}</div>
      </div>
    </div>
  );
}

function AccountTab() {
  const account = useAccount();
  if (!account) {
    return (
      <div className="acct-section">
        <h3>Sign in</h3>
        <p className="acct-note">Type a name. If it’s free, set a password to claim it. If it’s yours, enter your password. Your name keeps your stats, chips and settings. Arena and Solitaire work as a guest without signing in.</p>
        <AccountBox />
      </div>
    );
  }
  return (
    <>
      <div className="acct-section acct-me">
        <span className="acct-avatar acct-avatar-lg" aria-hidden="true">{account.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
        <div>
          <div className="acct-label">Signed in as</div>
          <div className="acct-name" data-testid="account-name">{account}</div>
        </div>
        <button type="button" className="acct-secondary" onClick={logout} data-testid="sign-out">Sign out</button>
      </div>
      <ChangePassword />
    </>
  );
}

function ChangePassword() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = () => {
    setMsg(null);
    if (!cur) return setMsg({ ok: false, text: 'Enter your current password.' });
    if (next.length < 4) return setMsg({ ok: false, text: 'New password must be at least 4 characters.' });
    if (next !== next2) return setMsg({ ok: false, text: 'The new passwords don’t match.' });
    setBusy(true);
    socket.timeout(10000).emit('auth_change_password', { current: cur, next }, (err: Error | null, res?: { ok: boolean; error?: string }) => {
      setBusy(false);
      if (err || !res) return setMsg({ ok: false, text: 'No response from the server.' });
      if (!res.ok) return setMsg({ ok: false, text: res.error ?? 'Could not change the password.' });
      setCur(''); setNext(''); setNext2('');
      setMsg({ ok: true, text: 'Password changed.' });
    });
  };
  return (
    <form className="acct-section" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h3>Change password</h3>
      <input type="text" name="username" autoComplete="username" hidden readOnly />
      <input className="acct-input" type="password" placeholder="Current password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} data-testid="pw-current" />
      <input className="acct-input" type="password" placeholder="New password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} data-testid="pw-new" />
      <input className="acct-input" type="password" placeholder="Confirm new password" autoComplete="new-password" value={next2} onChange={(e) => setNext2(e.target.value)} data-testid="pw-new2" />
      <button type="submit" className="acct-primary" disabled={busy} data-testid="pw-submit">{busy ? 'Saving…' : 'Change password'}</button>
      {msg && <div className={msg.ok ? 'acct-ok' : 'account-error'} data-testid="pw-msg">{msg.text}</div>}
    </form>
  );
}

function Toggle({ label, checked, onChange, id }: { label: string; checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <label className="acct-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={id} />
      <span className="acct-switch" aria-hidden="true" />
    </label>
  );
}

function SettingsTab() {
  const s = useSettings();
  const account = useAccount();
  const preset = BOARD_PRESETS.find((p) => p.light === s.boardLight && p.dark === s.boardDark)?.id ?? 'custom';
  return (
    <>
      <div className="acct-section">
        <h3>Theme</h3>
        <div className="acct-seg">
          {THEMES.map((t) => <button key={t} type="button" aria-pressed={s.theme === t} onClick={() => updateSettings({ theme: t })} data-testid={`theme-${t}`}>{THEME_LABEL[t]}</button>)}
        </div>
        <div className="acct-label mt">Accent colour</div>
        <div className="acct-swatches">
          {ACCENTS.map((c) => <button key={c} type="button" className="acct-swatch" style={{ background: c }} aria-label={`Accent ${c}`} aria-pressed={s.accent === c} onClick={() => updateSettings({ accent: c })} />)}
          <label className="acct-swatch acct-custom" title="Custom accent"><input type="color" value={s.accent} onChange={(e) => updateSettings({ accent: e.target.value })} aria-label="Custom accent colour" />+</label>
        </div>
      </div>
      <div className="acct-section">
        <h3>Board</h3>
        <div className="acct-boards">
          {BOARD_PRESETS.map((p) => (
            <button key={p.id} type="button" className="acct-board" aria-pressed={preset === p.id} onClick={() => updateSettings({ boardLight: p.light, boardDark: p.dark })} data-testid={`board-${p.id}`}>
              <span className="acct-mini" style={{ ['--l' as string]: p.light, ['--d' as string]: p.dark }} />
              {p.label}
            </button>
          ))}
        </div>
        <div className="acct-row">
          <label className="acct-color">Light squares <input type="color" value={s.boardLight} onChange={(e) => updateSettings({ boardLight: e.target.value })} data-testid="board-light" /></label>
          <label className="acct-color">Dark squares <input type="color" value={s.boardDark} onChange={(e) => updateSettings({ boardDark: e.target.value })} data-testid="board-dark" /></label>
        </div>
        <Toggle label="Show coordinates" checked={s.coords} onChange={(v) => updateSettings({ coords: v })} id="set-coords" />
        <p className="acct-note">One piece set (Cburnett) is available for now.</p>
      </div>
      <div className="acct-section">
        <h3>Sound & motion</h3>
        <div className="acct-row">
          <label className="acct-range">Volume <input type="range" min={0} max={1} step={0.01} value={s.volume} onChange={(e) => updateSettings({ volume: Number(e.target.value), muted: false })} data-testid="set-volume" /> <span>{Math.round(s.volume * 100)}%</span></label>
        </div>
        <Toggle label="Mute all sounds" checked={s.muted} onChange={(v) => updateSettings({ muted: v })} id="set-muted" />
        <Toggle label="Flash the screen on your turn" checked={s.turnFlash} onChange={(v) => updateSettings({ turnFlash: v })} id="set-flash" />
        <Toggle label="Confirm each chess move before sending" checked={s.confirmMoves} onChange={(v) => updateSettings({ confirmMoves: v })} id="set-confirm-moves" />
        <Toggle label="Reduce motion" checked={s.reducedMotion} onChange={(v) => updateSettings({ reducedMotion: v })} id="set-motion" />
      </div>
      <div className="acct-section">
        <h3>Windows</h3>
        <div className="acct-row">
          <button type="button" className="acct-secondary" onClick={resetWindowPositions} data-testid="reset-windows">Reset window positions & sizes</button>
          <button type="button" className="acct-secondary" onClick={resetSettings}>Restore default settings</button>
        </div>
        <p className="acct-note">{account ? 'Saved to your account and this device.' : 'Saved on this device. Sign in to keep them on every device.'}</p>
      </div>
    </>
  );
}

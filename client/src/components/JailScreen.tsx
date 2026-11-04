import { useEffect, useRef, useState } from 'react';
import { socket, request } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { JAIL_PHRASE, JAIL_MIN_GAP_MS, type JailInfo } from '../../../shared/jail';

const fmt = (n: number) => n.toLocaleString('en-US');
const left = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`; };

/** Admin jail (pt1478u): a banner while jailed, and the lines screen. The server counts every line; pastes never count. */
export function JailScreen() {
  const me = useAccount();
  const [jail, setJail] = useState<JailInfo | null>(null);
  const [open, setOpen] = useState(true);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [, tick] = useState(0);
  const last = useRef(0); const pasted = useRef(false);
  useEffect(() => {
    const load = () => { void request('jail_status').then((r) => setJail((r as { jail?: JailInfo | null }).jail ?? null)); };
    const onBlocked = (r: { error?: string }) => { setMsg(r?.error ?? ''); load(); };
    load(); socket.on('connect', load); socket.on('jail_changed', load); socket.on('jail_blocked', onBlocked);
    const t = window.setInterval(() => tick((x) => x + 1), 1000);
    return () => { socket.off('connect', load); socket.off('jail_changed', load); socket.off('jail_blocked', onBlocked); window.clearInterval(t); };
  }, [me]);
  if (!jail) return null;
  if (jail.until != null && jail.until <= Date.now()) { void request('jail_status').then((r) => setJail((r as { jail?: JailInfo | null }).jail ?? null)); }
  const submit = async () => {
    if (pasted.current) { pasted.current = false; setText(''); setMsg('Pasting doesn\'t count. Type it out.'); return; }
    if (Date.now() - last.current < JAIL_MIN_GAP_MS) { setMsg('Slow down. One line at a time.'); return; }
    last.current = Date.now(); const line = text; setText('');
    const r = await request('jail_type', { text: line }) as { typed?: number; needed?: number; released?: boolean; error?: string };
    if (r.released) { setJail(null); return; }
    if (typeof r.typed === 'number') setJail((j) => (j ? { ...j, typed: r.typed!, needed: r.needed ?? j.needed } : j));
    setMsg(r.error ?? '');
  };
  const until = jail.until == null ? 'you finish your lines' : `${new Date(jail.until).toLocaleString('en-CA', { timeZone: 'America/Edmonton', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} CST (${left(jail.until - Date.now())} left)`;
  return (
    <>
      <button type="button" className="jail-banner" onClick={() => setOpen(true)} style={{ position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)', zIndex: 9000, background: '#7a1410', color: '#fff', border: '2px solid #ff6a5a', borderTop: 0, borderRadius: '0 0 12px 12px', padding: '6px 16px', fontWeight: 700, cursor: 'pointer' }}>
        🔒 You're in jail until {until} · {fmt(jail.typed)} / {fmt(jail.needed)} · Reason: {jail.reason}
      </button>
      {open && (
        <div role="alertdialog" aria-modal="true" aria-label="Jail" className="jail-screen" style={{ position: 'fixed', inset: 0, zIndex: 9001, background: 'rgba(10,4,4,0.86)', display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 'min(520px, 92vw)', background: '#1c0f0e', border: '2px solid #ff6a5a', borderRadius: 16, padding: 22, color: '#fff', textAlign: 'center', backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 6px, transparent 6px 40px)' }}>
            <h2 style={{ margin: '0 0 6px' }}>🔒 You're in jail</h2>
            <p style={{ margin: '0 0 4px' }}>Until {until}</p>
            <p style={{ margin: '0 0 12px', opacity: 0.85 }}>Reason: {jail.reason}</p>
            <p style={{ margin: '0 0 8px' }}>No trading or earning while you're locked up. Type this exactly, one line at a time, to get out early:</p>
            <p style={{ fontSize: 22, fontWeight: 800, margin: '0 0 10px', userSelect: 'none' }}>{JAIL_PHRASE}</p>
            <div style={{ fontSize: 30, fontWeight: 800, color: '#ffb3a8' }}>{fmt(jail.typed)} / {fmt(jail.needed)}</div>
            <input value={text} autoFocus autoComplete="off" spellCheck={false} aria-label="Type the line"
              onPaste={(e) => { e.preventDefault(); pasted.current = true; setMsg('Pasting doesn\'t count. Type it out.'); }}
              onDrop={(e) => e.preventDefault()}
              onChange={(e) => { const v = e.target.value; if (v.length - text.length > 3) pasted.current = true; setText(v.replace(/[\r\n]/g, '')); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
              style={{ width: '100%', marginTop: 12, padding: '10px 12px', fontSize: 18, borderRadius: 10, border: '1px solid #ff6a5a', background: '#2a1412', color: '#fff' }} />
            <div style={{ minHeight: 22, marginTop: 8, color: '#ffcf8a' }}>{msg}</div>
            <button type="button" onClick={() => setOpen(false)} style={{ marginTop: 6, background: 'transparent', color: '#ffd0c8', border: '1px solid #ff6a5a', borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}>Look around (still jailed)</button>
          </div>
        </div>
      )}
    </>
  );
}

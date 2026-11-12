import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { request, socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { usePanelDrag } from '@/lib/panelDrag';
import { closeButton } from '@/lib/backdrop';
import { PLAY_BEAT_MS, PLAY_IDLE_MS } from '../../../shared/playtime';

/** Total-play-time heartbeat: active = tab visible and input within PLAY_IDLE_MS. */
export function PlayTimeBeat() {
  const account = useAccount();
  useEffect(() => {
    if (!account) return;
    let lastInput = Date.now();
    const mark = () => { lastInput = Date.now(); };
    const evs = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const beat = () => { if (socket.connected) socket.emit('play_beat', { active: document.visibilityState === 'visible' && Date.now() - lastInput < PLAY_IDLE_MS }); };
    const t = window.setInterval(beat, PLAY_BEAT_MS); beat();
    return () => { window.clearInterval(t); evs.forEach((e) => window.removeEventListener(e, mark)); };
  }, [account]);
  return null;
}

export interface PopupMsg { id: string; from: string; text: string; at: number; title?: string | null; audio?: string | null; confirmText?: string | null }

/** Shows admin direct messages as a modal; OK / typed confirm acknowledges (marks delivered) on the server. */
export function AdminPopup() {
  const dragAdmin = usePanelDrag('admin');
  const account = useAccount();
  const [queue, setQueue] = useState<PopupMsg[]>([]);
  useEffect(() => {
    if (!account) { setQueue([]); return; }
    const add = (list: PopupMsg[]) => setQueue((q) => { const seen = new Set(q.map((p) => p.id)); return [...q, ...list.filter((p) => !seen.has(p.id))]; });
    const pull = () => { if (socket.connected) void request('popup_pending', {}).then((r) => { const res = r as unknown as { popups?: PopupMsg[] }; if (res.popups) add(res.popups); }); };
    const t = window.setTimeout(pull, 900);
    const onConnect = () => window.setTimeout(pull, 900);
    const onPush = (p: PopupMsg) => add([p]);
    const onDone = (p: { id: string }) => setQueue((q) => q.filter((x) => x.id !== p.id));
    socket.on('connect', onConnect); socket.on('admin_popup', onPush); socket.on('admin_popup_done', onDone);
    return () => { window.clearTimeout(t); socket.off('connect', onConnect); socket.off('admin_popup', onPush); socket.off('admin_popup_done', onDone); };
  }, [account]);
  const cur = queue[0];
  if (!cur) return null;
  const ok = async (typed?: string) => {
    const id = cur.id;
    const res = await request('popup_ack', cur.confirmText ? { id, typed: typed ?? '' } : { id }) as { ok?: boolean; error?: string };
    if (!res?.ok) return res?.error || 'Could not dismiss.';
    setQueue((q) => q.filter((x) => x.id !== id));
    return null;
  };
  return <PopupCard msg={cur} onOk={ok} drag={dragAdmin} />;
}

/** Pure render of one popup (also used by the ?popup-preview test page). */
export function PopupCard({ msg: cur, onOk: ok, drag: dragAdmin }: { msg: PopupMsg; onOk: (typed?: string) => void | Promise<string | null | undefined>; drag: ReturnType<typeof usePanelDrag<HTMLDivElement>> }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const needConfirm = !!(cur.confirmText && cur.confirmText.length > 0);
  const matches = needConfirm && typed === cur.confirmText;
  useEffect(() => { setTyped(''); setErr(''); setBusy(false); }, [cur.id]);
  const close = () => {
    if (busy) return;
    if (needConfirm && !matches) { setErr('Type the apology exactly.'); return; }
    audioRef.current?.pause();
    setBusy(true);
    void Promise.resolve(ok(needConfirm ? typed : undefined)).then((e) => {
      if (e) { setErr(e); setBusy(false); }
    });
  };
  const toggle = () => { const a = audioRef.current; if (!a) return; if (a.paused) void a.play().catch(() => {}); else a.pause(); };
  return createPortal(
    <div className="admin-popup-backdrop" role="dialog" aria-modal="true" aria-labelledby="admin-popup-from"
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="admin-popup-card" style={dragAdmin.style({ background: '#16181d', color: '#f2f2f2', border: '1px solid #3a3f4b', borderRadius: 12, maxWidth: 480, width: '100%', padding: '20px 22px', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' })} data-drag-panel="admin" onPointerDown={dragAdmin.onPointerDown} ref={dragAdmin.ref}>{dragAdmin.handle}
        <div className="admin-popup-head">
        {cur.title
          ? <div id="admin-popup-from" style={{ fontSize: 17, fontWeight: 700, marginBottom: 0, flex: 1 }}>{cur.title}</div>
          : <div id="admin-popup-from" style={{ fontSize: 13, opacity: 0.75, marginBottom: 0, flex: 1 }}>Message from <b>{cur.from}</b></div>}
        <button type="button" className="modal-shell-x" aria-label="Close" data-testid="admin-popup-close" disabled={busy} {...(busy ? {} : closeButton(close))}>✕</button>
        </div>
        {cur.audio && <div style={{ marginBottom: 12 }}>
          <audio ref={audioRef} src={cur.audio} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
          <button type="button" onClick={toggle} style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: '#e0473c', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{playing ? '⏸ Pause' : '▶ Play voice message'}</button>
        </div>}
        <div className="admin-popup-text" style={{ fontSize: cur.audio ? 14 : 15, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: needConfirm ? '42vh' : '50vh', overflowY: 'auto' }}>{cur.text}</div>
        {needConfirm && (
          <div style={{ marginTop: 14 }}>
            <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Type the apology exactly to dismiss</label>
            <textarea
              value={typed}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              aria-label="Type the apology exactly"
              rows={3}
              onChange={(e) => { setTyped(e.target.value); setErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); close(); } }}
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14, borderRadius: 8, border: matches ? '1px solid #4f7cff' : '1px solid #3a3f4b', background: '#0f1115', color: '#f2f2f2', resize: 'vertical' }}
            />
            <div style={{ minHeight: 18, marginTop: 6, fontSize: 12, color: '#ffcf8a' }}>{err}</div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: needConfirm ? 8 : 18 }}>
          <button type="button" autoFocus={!needConfirm} disabled={busy || (needConfirm && !matches)} onClick={close} style={{ padding: '8px 22px', borderRadius: 8, border: 0, background: (busy || (needConfirm && !matches)) ? '#3a3f4b' : '#4f7cff', color: '#fff', fontWeight: 600, cursor: (busy || (needConfirm && !matches)) ? 'not-allowed' : 'pointer', opacity: (busy || (needConfirm && !matches)) ? 0.55 : 1 }}>{needConfirm ? 'Submit apology' : (cur.audio ? 'Got it' : 'OK')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

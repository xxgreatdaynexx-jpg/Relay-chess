import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { request, socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { usePanelDrag } from '@/lib/panelDrag';
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

export interface PopupMsg { id: string; from: string; text: string; at: number; title?: string | null; audio?: string | null }

/** Shows admin direct messages as a modal; OK acknowledges (marks delivered) on the server. */
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
  const ok = () => { setQueue((q) => q.slice(1)); void request('popup_ack', { id: cur.id }); };
  return <PopupCard msg={cur} onOk={ok} drag={dragAdmin} />;
}

/** Pure render of one popup (also used by the ?popup-preview test page). */
export function PopupCard({ msg: cur, onOk: ok, drag: dragAdmin }: { msg: PopupMsg; onOk: () => void; drag: ReturnType<typeof usePanelDrag<HTMLDivElement>> }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const close = () => { audioRef.current?.pause(); ok(); };
  const toggle = () => { const a = audioRef.current; if (!a) return; if (a.paused) void a.play().catch(() => {}); else a.pause(); };
  return createPortal(
    <div className="admin-popup-backdrop" role="dialog" aria-modal="true" aria-labelledby="admin-popup-from"
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={dragAdmin.style({ background: '#16181d', color: '#f2f2f2', border: '1px solid #3a3f4b', borderRadius: 12, maxWidth: 440, width: '100%', padding: '20px 22px', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' })} data-drag-panel="admin" onPointerDown={dragAdmin.onPointerDown} ref={dragAdmin.ref}>{dragAdmin.handle}
        {cur.title
          ? <div id="admin-popup-from" style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>{cur.title}</div>
          : <div id="admin-popup-from" style={{ fontSize: 13, opacity: 0.75, marginBottom: 8 }}>Message from <b>{cur.from}</b></div>}
        {cur.audio && <div style={{ marginBottom: 12 }}>
          <audio ref={audioRef} src={cur.audio} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
          <button type="button" onClick={toggle} style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: '#e0473c', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{playing ? '⏸ Pause' : '▶ Play voice message'}</button>
        </div>}
        <div style={{ fontSize: cur.audio ? 14 : 16, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '50vh', overflowY: 'auto' }}>{cur.text}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" autoFocus onClick={close} style={{ padding: '8px 22px', borderRadius: 8, border: 0, background: '#4f7cff', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>{cur.audio ? 'Got it' : 'OK'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

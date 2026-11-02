import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { request, socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';

interface PopupMsg { id: string; from: string; text: string; at: number }

/** Shows admin direct messages as a modal; OK acknowledges (marks delivered) on the server. */
export function AdminPopup() {
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
  return createPortal(
    <div className="admin-popup-backdrop" role="dialog" aria-modal="true" aria-labelledby="admin-popup-from"
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#16181d', color: '#f2f2f2', border: '1px solid #3a3f4b', borderRadius: 12, maxWidth: 440, width: '100%', padding: '20px 22px', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
        <div id="admin-popup-from" style={{ fontSize: 13, opacity: 0.75, marginBottom: 8 }}>Message from <b>{cur.from}</b></div>
        <div style={{ fontSize: 16, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{cur.text}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" autoFocus onClick={ok} style={{ padding: '8px 22px', borderRadius: 8, border: 0, background: '#4f7cff', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>OK</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { request, socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import type { LaunchPopup as Launch } from '../../../shared/launchPopup';

/** One-time "The Millionaire Update" popup: shown once per player (server stores the seen flag), contents from shared/launchPopup.ts. */
export function LaunchPopup() {
  const account = useAccount(); const [l, setL] = useState<Launch | null>(null);
  useEffect(() => {
    if (!account) { setL(null); return; }
    const pull = () => { if (socket.connected) void request('launch_pending', {}).then((r) => { const x = (r as unknown as { launch?: Launch | null }).launch; if (x) setL(x); }); };
    const t = window.setTimeout(pull, 1500); const on = () => window.setTimeout(pull, 1500); socket.on('connect', on);
    return () => { window.clearTimeout(t); socket.off('connect', on); };
  }, [account]);
  if (!l) return null;
  const done = () => { setL(null); void request('launch_ack', { id: l.id }); };
  return createPortal(
    <div className="launch-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="launch-title" data-testid="launch-popup">
      <div className="launch-card">
        <div className="launch-burst">💸</div>
        <h2 id="launch-title" className="launch-title">{l.title}</h2>
        <p className="launch-sub">{l.subtitle}</p>
        <ul className="launch-list">{l.items.map((it) => <li key={it.title}><span className="launch-ico">{it.icon}</span><div><b>{it.title}</b><span>{it.text}</span></div></li>)}</ul>
        <button type="button" autoFocus className="launch-ok" onClick={done} data-testid="launch-ok">Let's get rich 🪙</button>
      </div>
    </div>, document.body);
}

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { request, socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { LAUNCH, launchPages, type LaunchPopup as Launch } from '../../../shared/launchPopup';
import { LAUNCH_AT, LAUNCH_DATE_LABEL, fmtCountdown } from '../../../shared/launchCountdown';
import { useNow } from '@/lib/useNow';

/** Live header: launch date + countdown; after launch it just says Live now. */
function LaunchHeader() {
  const left = fmtCountdown(LAUNCH_AT - useNow());
  return <div className="launch-when" data-testid="launch-when">{left ? <><span>Coming {LAUNCH_DATE_LABEL}</span><b data-testid="launch-countdown">⏳ {left}</b></> : <b>🟢 Live now</b>}</div>;
}

/** One-time "The Billionaire Update" popup: shown once per player (server stores the seen flag), contents from shared/launchPopup.ts. */
export function LaunchPopup() {
  const account = useAccount(); const [l, setL] = useState<Launch | null>(null); const [pg, setPg] = useState(0);
  useEffect(() => {
    if (!account) { setL(null); return; }
    const pull = () => { if (socket.connected) void request('launch_pending', {}).then((r) => { const x = (r as unknown as { launch?: Launch | null }).launch; if (x) setL(x); }); };
    const t = window.setTimeout(pull, 1500); const on = () => window.setTimeout(pull, 1500); socket.on('connect', on);
    return () => { window.clearTimeout(t); socket.off('connect', on); };
  }, [account]);
  useEffect(() => { const open = () => { setPg(0); setL(LAUNCH); }; window.addEventListener('open-launch-popup', open); return () => window.removeEventListener('open-launch-popup', open); }, []);
  useEffect(() => { document.querySelector('.launch-tabs .on')?.scrollIntoView?.({ block: 'nearest', inline: 'center' }); }, [pg, l]);
  if (!l) return null;
  const done = () => { setL(null); void request('launch_ack', { id: l.id }); };
  const pages = launchPages(l); const p = Math.min(pg, pages.length - 1); const last = p === pages.length - 1; const page = pages[p]!;
  const go = (i: number) => { setPg(Math.max(0, Math.min(pages.length - 1, i))); document.querySelector('.launch-list')?.scrollTo?.({ top: 0 }); };
  return createPortal(
    <div className="launch-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="launch-title" data-testid="launch-popup">
      <div className="launch-card">
        <div className="launch-burst">💸</div>
        <h2 id="launch-title" className="launch-title">{l.title}</h2>
        <LaunchHeader />
        <p className="launch-sub">{Date.now() < LAUNCH_AT ? 'A big one. Here\'s what\'s coming:' : l.subtitle} <span className="launch-count">{l.items.length} new things across {pages.length} pages</span></p>
        <div className="launch-tabs" role="tablist">{pages.map((pp, i) => <button key={pp.section} type="button" role="tab" aria-selected={i === p} className={i === p ? 'on' : ''} onClick={() => go(i)} data-testid={`launch-tab-${i}`}>{pp.section}</button>)}</div>
        <ul className="launch-list" data-testid="launch-page">{page.items.map((it) => <li key={it.title}><span className="launch-ico">{it.icon}</span><div><b>{it.title}</b><span>{it.text}</span></div></li>)}</ul>
        <div className="launch-nav">
          <button type="button" className="launch-back" onClick={() => go(p - 1)} disabled={p === 0} data-testid="launch-back">‹ Back</button>
          <span className="launch-dots" aria-label={`Page ${p + 1} of ${pages.length}`}>{p + 1} / {pages.length}</span>
          {last
            ? <button type="button" autoFocus className="launch-ok" onClick={done} data-testid="launch-ok">Let's get rich 🪙</button>
            : <button type="button" autoFocus className="launch-ok" onClick={() => go(p + 1)} data-testid="launch-next">Next ›</button>}
        </div>
        <div className="launch-extra"><button type="button" className="launch-skip" onClick={() => { done(); window.dispatchEvent(new CustomEvent('open-launch-trailer')); }} data-testid="launch-trailer">▶ Watch the Launch Trailer</button>{!last && <button type="button" className="launch-skip" onClick={done} data-testid="launch-skip">Skip</button>}</div>
      </div>
    </div>, document.body);
}

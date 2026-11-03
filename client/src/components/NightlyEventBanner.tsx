import { useEffect, useState } from 'react';
import { NIGHTLY_LABEL, type NightlyGame } from '../../../shared/nightlyEvent';

interface View { game: NightlyGame; startsAt: number; endsAt: number; active: boolean; mult: number; capPerWin: number; serverNow: number }
const fmt = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

/** Nightly 10x event strip (#35): live countdown during the hour, a heads-up in the 3 hours before. */
export function NightlyEventBanner() {
  const [v, setV] = useState<View | null>(null);
  const [skew, setSkew] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    let dead = false;
    const load = () => fetch('/api/nightly-event').then((r) => r.json()).then((j: View) => { if (!dead) { setV(j); setSkew(j.serverNow - Date.now()); } }).catch(() => {});
    load(); const a = setInterval(load, 60_000), b = setInterval(() => tick((n) => n + 1), 15_000);
    return () => { dead = true; clearInterval(a); clearInterval(b); };
  }, []);
  if (!v) return null;
  const now = Date.now() + skew;
  if (!v.active && v.startsAt - now > 3 * 3600_000) return null;
  return (
    <div className={`nightly-banner${v.active ? ' live' : ''}`} data-testid="nightly-banner">
      <span className="nightly-x">{v.mult}x</span>
      {v.active
        ? <span><b>NIGHTLY {v.mult}x LIVE:</b> win at {NIGHTLY_LABEL[v.game]} for {v.mult}x payouts · {fmt(v.endsAt - now)} left</span>
        : <span>Tonight's {v.mult}x game: <b>{NIGHTLY_LABEL[v.game]}</b> · starts in {fmt(v.startsAt - now)} (8 PM)</span>}
    </div>
  );
}

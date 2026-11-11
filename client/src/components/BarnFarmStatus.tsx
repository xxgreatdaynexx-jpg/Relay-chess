import { useEffect, useState } from 'react';
import { socket } from '@/lib/net';
import { barnFarmStatus, barnTimeLeft, type BarnFarmOverview, type BarnFarmPlot } from '../../../shared/barnFarmStatus';
export function FarmStatusSummary({ plot, now }: { plot: BarnFarmPlot; now: number }) {
  const s = barnFarmStatus(plot, now); const c = s.count;
  return <small className="barn-farm-status" data-testid={`farm-status-${plot.id}`}>
    <span>{c.empty} empty · {c.growing} growing · {c.ready} ready · {c.failed ? `${c.failed} failed · ` : ''}{c.withered} withered</span>
    {s.crops && <span>{s.crops}</span>}
    {s.nextReady !== null && <span>Next ready in {barnTimeLeft(s.nextReady - now)}{s.lastReady !== s.nextReady && <> · Last growing crop in {barnTimeLeft(s.lastReady! - now)}</>}</span>}
    {s.nextWither !== null && <span>Next ripe crop withers in {barnTimeLeft(s.nextWither - now)}</span>}
  </small>;
}
/** Event-driven snapshot refresh; the one-second timer only advances the display, never polls the server. */
export function useBarnFarmStatus(me: string | null, unlocked: boolean, ids: string[]) {
  const [data, setData] = useState<{ owner: string; view: BarnFarmOverview; received: number } | null>(null);
  const [error, setError] = useState<string | null>(null); const [clock, setClock] = useState(0);
  const key = ids.slice().sort().join('|');
  useEffect(() => {
    setData(null); setError(null); if (!unlocked || !me) return;
    let dead = false, busy = false, dirty = false, revision = 0; let pending: ReturnType<typeof setTimeout> | undefined;
    const owned = new Set(key.split('|'));
    const load = () => {
      if (dead) return; if (busy) { dirty = true; return; } busy = true; const rev = revision;
      socket.timeout(10000).emit('farm_overview', {}, (err: Error | null, r?: { ok: boolean; error?: string; overview?: BarnFarmOverview }) => {
        busy = false; if (dead) return;
        if (rev === revision) {
          if (err || !r?.ok || !r.overview) { setData(null); setError(r?.error ?? 'Farm status unavailable. Reopen the menu or reconnect to retry.'); }
          else { setData({ owner: me, view: r.overview, received: performance.now() }); setClock(performance.now()); setError(null); }
        }
        if (dirty) { dirty = false; load(); }
      });
    };
    const refresh = () => { revision++; setData(null); if (pending) clearTimeout(pending); pending = setTimeout(load, 80); };
    const changed = (e: { id?: string }) => { if (!e?.id || owned.has(e.id)) refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    load(); socket.on('farm_changed', changed); socket.on('re_changed', refresh); socket.on('connect', refresh); document.addEventListener('visibilitychange', visible);
    const timer = setInterval(() => setClock(performance.now()), 1000);
    return () => { dead = true; if (pending) clearTimeout(pending); clearInterval(timer); socket.off('farm_changed', changed); socket.off('re_changed', refresh); socket.off('connect', refresh); document.removeEventListener('visibilitychange', visible); };
  }, [me, unlocked, key]);
  const valid = data?.owner === me && unlocked ? data : null;
  return { plots: new Map(valid?.view.plots.map((p) => [p.id, p]) ?? []), now: valid ? valid.view.now + Math.max(0, clock - valid.received) : 0, error, index: valid?.view.index && valid.view.index > 0 ? valid.view.index : 1 };
}

import { useEffect, useState } from 'react';
import { socket } from '@/lib/net';
import { FACTORY_LEVELS, RECIPES, nameOf, priceOf, stackKey, type Job, type Stack } from '../../../shared/mines';

type FView = { level: number; jobs: Array<Job & { done: boolean }>; now: number } | null;
export type Ack = { ok: boolean; error?: string; factory?: FView; storage?: Stack[]; quote?: unknown; inMine?: boolean; guest?: boolean; result?: unknown };

/** 2D factory: furnace (ore + coal -> bars) and workbench (bars -> goods). Jobs run on the server clock, even offline. */
export function MinesFactory({ pack, guest, onPack, flash }: { pack: Stack[]; guest: boolean; onPack: (r: Ack) => void; flash: (t: string) => void }) {
  const [f, setF] = useState<FView>(null);
  const [skew, setSkew] = useState(0);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [, tick] = useState(0);
  const apply = (r?: Ack) => { if (!r) return; if (r.factory !== undefined) { setF(r.factory); if (r.factory) setSkew(r.factory.now - Date.now()); } if (r.storage) onPack(r); };
  const call = (ev: string, body: object, ok?: (r: Ack) => void) => socket.timeout(5000).emit(ev, body, (err: Error | null, r?: Ack) => {
    if (err || !r) return flash('Factory busy, try again.');
    if (!r.ok) return flash(r.error ?? 'Failed.');
    apply(r); ok?.(r);
  });
  useEffect(() => { if (!guest) call('mines_factory', {}); const t = window.setInterval(() => tick((n) => n + 1), 500); return () => window.clearInterval(t); }, [guest]); // eslint-disable-line react-hooks/exhaustive-deps
  if (guest) return <p className="mines-note">Sign in to build a factory and smelt ore into bars and goods.</p>;
  if (!f) return <p className="mines-note">Loading factory…</p>;
  const now = Date.now() + skew;
  const next = FACTORY_LEVELS[f.level];
  const lv = FACTORY_LEVELS[f.level - 1];
  const have = (s: { type: string; id: string }) => pack.find((p) => stackKey(p) === stackKey(s as Stack))?.qty ?? 0;
  if (f.level === 0) return (
    <div className="mines-factory" data-testid="mines-factory">
      <p className="mines-note">A factory smelts ore into bars and crafts goods worth 1.5–3× their inputs. Jobs keep running while you're away.</p>
      <button type="button" className="mines-sell" onClick={() => call('mines_factory_upgrade', {}, () => flash('Factory built!'))} data-testid="mines-build">Build factory · 🪙 {FACTORY_LEVELS[0].cost}</button>
    </div>
  );
  const anyDone = f.jobs.some((j) => now >= j.doneAt);
  return (
    <div className="mines-factory" data-testid="mines-factory">
      <div className="mines-fhead">🏭 Level {f.level} · {lv.slots} slot{lv.slots > 1 ? 's' : ''}/machine · batch ≤{lv.batch}
        {next && <button type="button" onClick={() => call('mines_factory_upgrade', {}, () => flash(`Upgraded to level ${next.level}`))}>Upgrade · 🪙 {next.cost}</button>}
      </div>
      {f.jobs.length > 0 && <ul className="mines-jobs">{f.jobs.map((j) => { const r = RECIPES.find((x) => x.id === j.recipe); const left = Math.max(0, j.doneAt - now); const pct = Math.min(100, ((now - j.startAt) / (j.doneAt - j.startAt)) * 100); return (
        <li key={j.id}>{j.machine === 'furnace' ? '🔥' : '🔨'} {j.qty}× {r ? nameOf(r.out) : j.recipe}<span>{left > 0 ? `${Math.ceil(left / 1000)}s` : 'done'}</span><div className="mines-bar"><i style={{ width: `${pct}%` }} /></div></li>
      ); })}</ul>}
      <button type="button" className="mines-sell" disabled={!anyDone} onClick={() => call('mines_collect', {}, (r) => flash(`Collected ${(r.result as Stack[]).map((s) => `${s.qty} ${nameOf(s)}`).join(', ')}`))} data-testid="mines-collect">Collect finished</button>
      {(['furnace', 'workbench'] as const).map((mc) => { const busy = f.jobs.filter((j) => j.machine === mc).length >= lv.slots; return (
        <div key={mc} className="mines-machine"><b>{mc === 'furnace' ? '🔥 Furnace' : '🔨 Workbench'}</b>{busy && <span className="opacity-60"> · busy</span>}
          {RECIPES.filter((r) => r.machine === mc).map((r) => { const n = Math.min(lv.batch, Math.max(1, qty[r.id] ?? 1)); const can = r.in.every((i) => have(i) >= i.qty * n); return (
            <div key={r.id} className="mines-recipe" title={`${r.in.map((i) => `${i.qty} ${nameOf(i)}`).join(' + ')} → ${nameOf(r.out)} (${priceOf(r.out)} chips)`}>
              <span>{nameOf(r.out)} <small>{r.in.map((i) => `${i.qty} ${nameOf(i)}`).join('+')} · {r.ms / 1000}s · 🪙{priceOf(r.out)}</small></span>
              <input type="number" min={1} max={lv.batch} value={n} onChange={(e) => setQty((q) => ({ ...q, [r.id]: Number(e.target.value) }))} aria-label={`${r.name} batch`} />
              <button type="button" disabled={!can || busy} onClick={() => call('mines_craft', { recipe: r.id, qty: n }, () => flash(`Started ${n}× ${nameOf(r.out)}`))}>Make</button>
            </div>
          ); })}
        </div>
      ); })}
    </div>
  );
}

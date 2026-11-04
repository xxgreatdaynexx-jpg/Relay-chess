import { useDoing } from '@/lib/doing';
import { BuildingInventory } from './BuildingInventory';
import { useCallback, useEffect, useState } from 'react';
import { socket } from '@/lib/net';
import { indexed } from '../../../shared/priceIndex';
import { TROPICAL_CROPS } from '../../../shared/resort';
import { FARM_UPGRADES, MAX_UPGRADE_LEVEL, NO_UPGRADES, upgradePrice } from '../../../shared/farmUpgrades';
import { CROPS as CITY_CROPS, cropById, cropOutlook, FARM_TIERS, type FarmView } from '../../../shared/farm';
import { usePanelDrag } from '@/lib/panelDrag';
import { FERTILIZERS, fertCost, HAND_BATCH, MACHINES, passLimit, type FarmStep } from '../../../shared/farmWork';

const chips = (n: number) => n.toLocaleString('en-US');
/** Compact countdown on ripe tiles, e.g. "11h" or "40m" (full text is in the tooltip). */
const witherHint = (ms: number) => { const m = Math.max(0, Math.ceil(ms / 60_000)); return m >= 60 ? `${Math.floor(m / 60)}h` : `${m}m`; };
const dur = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${x}s` : `${x}s`; };
type Ack = { ok: boolean; error?: string; [k: string]: unknown };

/** Farming Simulator-style plot: plough, seed, fertilize and harvest yourself (or with machinery), a tile grid sized to the plot, a seed shop and real-time (server-clocked) crops. */
export function FarmGame({ id, label, onClose }: { id: string; label: string; onClose: () => void }) {
  useDoing('farming', label);
  const dragFarm = usePanelDrag('farm');
  const [view, setView] = useState<FarmView | null>(null);
  const [skew, setSkew] = useState(0); // server now - client now
  const [now, setNow] = useState(Date.now());
  const CROPS = id.startsWith('rf:') ? TROPICAL_CROPS : CITY_CROPS; // resort plantation plots grow tropical crops only
  const [seed, setSeed] = useState(CROPS[0]!.id);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<FarmStep>('plow');
  const [fert, setFert] = useState(FERTILIZERS[0]!.id);
  const load = useCallback(() => {
    socket.timeout(10_000).emit('farm_view', { id }, (err: Error | null, r?: Ack) => {
      if (err || !r?.ok) { setMsg(err ? 'No answer from the server.' : r?.error ?? 'Could not load the farm.'); return; }
      const v = r.farm as FarmView; setView(v); setSkew(v.now - Date.now());
    });
  }, [id]);
  useEffect(() => { load(); const h = (e: { id?: string }) => { if (e?.id === id) load(); }; socket.on('farm_changed', h); return () => { socket.off('farm_changed', h); }; }, [id, load]);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  // QA r8: live growth. Re-sync with the server right after the next crop ripens or withers, on tab focus, and every 30 s.
  useEffect(() => {
    if (!view) return; const tn = Date.now() + skew;
    const next = Math.min(...view.tiles.flatMap((x) => [x.readyAt, x.witherAt]).filter((v) => v > tn), tn + 30_000);
    const tm = window.setTimeout(load, Math.max(500, next - tn + 400));
    const vis = () => { if (document.visibilityState === 'visible') load(); }; document.addEventListener('visibilitychange', vis);
    return () => { window.clearTimeout(tm); document.removeEventListener('visibilitychange', vis); };
  }, [view, skew, load]);
  const t = now + skew; const idx = view?.index ?? 1;
  const plowedSet = new Set(view?.plowed ?? []);
  const byTile = new Map((view?.tiles ?? []).map((x) => [x.tile, x]));
  const stage = (tile: number) => { const x = byTile.get(tile); if (!x) return plowedSet.has(tile) ? 'plowed' : 'empty'; return t >= x.witherAt ? 'withered' : t >= x.readyAt ? 'ready' : 'growing'; };
  const n = view ? view.cols * view.rows : 0;
  const all = Array.from({ length: n }, (_, i) => i);
  const empties = all.filter((i) => stage(i) === 'empty');
  const plowed = all.filter((i) => stage(i) === 'plowed');
  const ready = all.filter((i) => stage(i) === 'ready');
  const withered = all.filter((i) => stage(i) === 'withered');
  const unfed = all.filter((i) => stage(i) === 'growing' && !byTile.get(i)?.fert);
  const machines = view?.machines ?? {};
  const limit = (step: FarmStep) => passLimit(step, machines, n);
  const eligible: Record<FarmStep, number[]> = { plow: empties, seed: plowed, fertilize: unfed, harvest: ready };
  const act = (ev: string, body: Record<string, unknown>, ok: (r: Ack) => string) => {
    setBusy(true); setMsg(null);
    socket.timeout(10_000).emit(ev, { id, ...body }, (err: Error | null, r?: Ack) => { setBusy(false); setMsg(err ? 'No answer from the server.' : r?.ok ? ok(r) : r?.error ?? 'Something went wrong.'); setSel(new Set()); load(); });
  };
  const crop = cropById(seed)!; const fd = FERTILIZERS.find((f) => f.id === fert)!;
  const fertPrice = (tiles: number[]) => tiles.reduce((a, i) => { const c = cropById(byTile.get(i)?.crop); return a + (c ? indexed(fertCost(fd, c.sell, !!machines.loader), idx) : 0); }, 0);
  const run = (step: FarmStep, tiles: number[]) => {
    if (!tiles.length) return;
    if (step === 'plow') act('farm_plow', { tiles }, (r) => `🚜 Ploughed ${r.plowed} tile${r.plowed === 1 ? '' : 's'}.`);
    else if (step === 'seed') act('farm_plant', { crop: seed, tiles }, (r) => `🌱 Seeded ${r.planted} × ${crop.label} for 🪙 ${chips(Number(r.cost))}.`);
    else if (step === 'fertilize') act('farm_fertilize', { kind: fert, tiles }, (r) => `${fd.emoji} ${fd.label} on ${r.fertilized} tiles for 🪙 ${chips(Number(r.cost))}.`);
    else act('farm_harvest', { tiles }, (r) => `Harvested ${r.harvested}${Number(r.bonus) ? ` (+${r.bonus} bonus crops)` : ''} for 🪙 ${chips(Number(r.paid))}.`);
  };
  const click = (i: number) => {
    if (!view?.mine || busy) return;
    if (!eligible[tool].includes(i)) { const s = stage(i); const hint = s === 'empty' ? 'plow' : s === 'plowed' ? 'seed' : s === 'ready' ? 'harvest' : s === 'growing' && !byTile.get(i)?.fert ? 'fertilize' : null; if (hint) { setTool(hint); setSel(new Set([i])); } return; }
    setSel((p) => { const q = new Set(p); if (q.has(i)) q.delete(i); else if (q.size < limit(tool)) q.add(i); return q; });
  };
  const selList = [...sel].filter((i) => eligible[tool].includes(i));
  const pass = eligible[tool].slice(0, limit(tool));
  const machineFor = MACHINES.find((m) => m.step === tool)!; const hasMachine = !!machines[machineFor.id];
  const cap = FARM_TIERS.reduce((a, x, i) => a + (Math.min(x.upTo, 1e12) - (i ? FARM_TIERS[i - 1].upTo : 0)) * x.rate, 0);
  const TOOLS: Array<[FarmStep, string, number]> = [['plow', '🚜 Plough', empties.length], ['seed', '🌱 Seed', plowed.length], ['fertilize', '🧪 Fertilize', unfed.length], ['harvest', '🌾 Harvest', ready.length]];
  return (
    <div className="world-deed world-farm" data-testid="farm-game" data-drag-panel="farm" onPointerDown={dragFarm.onPointerDown} style={dragFarm.style()} ref={dragFarm.ref}>{dragFarm.handle}
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <h3>🌾 {label}</h3>
      {!view ? <small>{msg ?? 'Loading the farm…'}</small> : <>
        <small>{view.mine ? `Your farm. Plough the stubble, seed it, spread fertilizer for a bigger yield, then harvest. By hand each pass covers ${HAND_BATCH} tiles; machinery does the whole field.` : `${view.owner ?? 'Nobody'}'s farm (visiting, read-only).`}</small>
        {view.mine && <div className="farm-tools" data-testid="farm-tools">
          {TOOLS.map(([k, l, c]) => <button key={k} type="button" className={tool === k ? 'on' : ''} onClick={() => { setTool(k); setSel(new Set()); }} data-testid={`farm-tool-${k}`}>{l}<span>{c}</span></button>)}
        </div>}
        <div className="farm-grid" style={{ gridTemplateColumns: `repeat(${view.cols}, 1fr)` }} data-testid="farm-grid">
          {all.map((i) => { const x = byTile.get(i); const s = stage(i); const c = x && cropById(x.crop); const fz = x?.fert && FERTILIZERS.find((f) => f.id === x.fert);
            const title = s === 'empty' ? 'Stubble: plough it first' : s === 'plowed' ? 'Ploughed: ready for seed' : !x ? '' : s === 'growing' ? `${c?.label}: ready in ${dur(x.readyAt - t)}${fz ? ` · ${fz.label} +${Math.round(fz.yield * 100)}% yield` : ' · not fertilized'}` : s === 'ready' ? `${c?.label}: ready! withers in ${dur(x.witherAt - t)}` : `${c?.label}: withered`;
            return <button key={i} type="button" title={title} className={`farm-tile farm-${s}${sel.has(i) ? ' farm-sel' : ''}${view.mine && eligible[tool].includes(i) ? ' farm-can' : ''}`} onClick={() => click(i)} data-testid={`farm-tile-${i}`}>
              {s === 'empty' || s === 'plowed' ? '' : s === 'withered' ? '🥀' : s === 'ready' ? c?.emoji : x && (t - x.plantedAt) / (x.readyAt - x.plantedAt) >= 0.5 ? '🌿' : '🌱'}
              {fz && s !== 'withered' && <em className="farm-fert" title={fz.label}>{fz.emoji}</em>}
              {s === 'ready' && x && <b className="farm-wither" data-testid={`farm-wither-${i}`}>{witherHint(x.witherAt - t)}</b>}
              {s === 'growing' && x && <i style={{ width: `${Math.min(100, (100 * (t - x.plantedAt)) / (x.readyAt - x.plantedAt))}%` }} />}
            </button>; })}
        </div>
        {view.mine && <>
          {tool === 'seed' && <>
            <h4>Seed</h4>
            <small className="farm-outlook-note" data-testid="farm-outlook-note">With your boosts: Farming lv {view.farmingLevel ?? 1}{view.growMul !== undefined && view.growMul < 1 ? ` · ${Math.round((1 - view.growMul) * 100)}% faster` : ''}{view.yieldBonus ? ` · +${(view.yieldBonus * 100).toFixed(1)}% bonus crops` : ''} (level and machinery add yield, never a better price; profit counts toward the daily farm cap)</small>
            <div className="farm-seeds" data-testid="farm-seeds">
              {CROPS.map((c) => <button key={c.id} type="button" className={seed === c.id ? 'on' : ''} onClick={() => setSeed(c.id)} data-testid={`farm-seed-${c.id}`}>
                <b>{c.emoji} {c.label}</b><span>🪙{chips(indexed(c.seed, idx))} → {chips(indexed(c.sell, idx))} · {dur(c.grow)}</span>
                {(() => { const o = cropOutlook(c, view.growMul, 1, view.yieldBonus); return <span className="farm-outlook" data-testid={`farm-outlook-${c.id}`}>⏱ {dur(o.grow)} · <b>+🪙{chips(indexed(o.profit, idx))}</b> profit/tile</span>; })()}
              </button>)}
            </div>
          </>}
          {tool === 'fertilize' && <>
            <h4>Fertilizer (raises yield)</h4>
            <div className="farm-seeds" data-testid="farm-ferts">
              {FERTILIZERS.map((f) => <button key={f.id} type="button" className={fert === f.id ? 'on' : ''} onClick={() => setFert(f.id)} data-testid={`farm-fert-${f.id}`}>
                <b>{f.emoji} {f.label}</b><span>+{Math.round(f.yield * 100)}% crops · costs {Math.round(f.costFrac * (machines.loader ? 0.8 : 1) * 100)}% of the crop’s price</span>
              </button>)}
            </div>
          </>}
          {(() => { const cost = (ts: number[]) => tool === 'seed' ? ` · 🪙 ${chips(indexed(crop.seed, idx) * ts.length)}` : tool === 'fertilize' ? ` · 🪙 ${chips(fertPrice(ts))}` : '';
            const verb = TOOLS.find((x) => x[0] === tool)![1];
            return <>
              <button type="button" disabled={busy || !selList.length} onClick={() => run(tool, selList)} data-testid="farm-do-sel">{verb} {selList.length || ''} selected<span>{cost(selList)}</span></button>
              <button type="button" disabled={busy || !pass.length} onClick={() => run(tool, pass)} data-testid="farm-do-pass">{hasMachine ? `${machineFor.emoji} Whole field (${pass.length})` : `✋ Next ${pass.length} by hand`}<span>{cost(pass)}</span></button>
            </>; })()}
          {tool === 'harvest' && <button type="button" disabled={busy || !ready.length} onClick={() => act('farm_harvest', { pantry: true, tiles: ready.slice(0, limit('harvest')) }, (r) => `🧺 ${r.harvested} crop${r.harvested === 1 ? '' : 's'} into your kitchen pantry.`)} title="Keep the crops for cooking instead of selling them" data-testid="farm-harvest-pantry">🧺 To pantry</button>}
          <BuildingInventory building={id.startsWith('rf:') ? 'resort_farm' : 'farm'} compact />
          <h4>Machinery</h4>
          <div className="farm-upgrades farm-machines" data-testid="farm-machines">
            {MACHINES.map((m) => { const own = !!machines[m.id]; const cost = indexed(m.price, idx);
              return <button key={m.id} type="button" disabled={busy || own} title={m.blurb} className={own ? 'owned' : ''} data-testid={`farm-machine-${m.id}`}
                onClick={() => !own && window.confirm(`Buy a ${m.label} for 🪙 ${chips(cost)}? It works on every farm you own.`) && act('farm_machine', { kind: m.id }, (r) => `${m.emoji} ${m.label} bought (🪙 ${chips(Number(r.cost))}).`)}>
                <b>{m.emoji} {m.label}</b><span>{m.blurb}</span><span>{own ? '✔ Owned' : `🪙 ${chips(cost)}`}</span>
              </button>; })}
          </div>
          <h4>Upgrades</h4>
          <div className="farm-upgrades" data-testid="farm-upgrades">
            {FARM_UPGRADES.map((u) => { const lvl = (view.upgrades ?? NO_UPGRADES)[u.id]; const base = upgradePrice(u.id, lvl, n); const cost = base === null ? null : indexed(base, idx);
              return <button key={u.id} type="button" disabled={busy || cost === null} title={u.blurb} data-testid={`farm-upgrade-${u.id}`}
                onClick={() => cost !== null && window.confirm(`Buy ${u.label} level ${lvl + 1} for 🪙 ${chips(cost)}?`) && act('farm_upgrade', { kind: u.id }, (r) => `${u.label} is now level ${r.level} (🪙 ${chips(Number(r.cost))}).`)}>
                <b>{u.emoji} {u.label} {lvl}/{MAX_UPGRADE_LEVEL}</b>
                <span>{lvl ? u.effect(lvl) : u.blurb}</span>
                <span>{cost === null ? 'Maxed out' : `Next: ${u.effect(lvl + 1)} · 🪙 ${chips(cost)}`}</span>
              </button>; })}
          </div>
          {withered.length > 0 && <button type="button" disabled={busy} onClick={() => act('farm_clear', {}, (r) => `Cleared ${r.cleared} withered.`)} data-testid="farm-clear">Clear {withered.length} withered</button>}
          <small data-testid="farm-today">Today’s farm profit: 🪙 {chips(view.today.gross)} (paid 🪙 {chips(view.today.paid)}). Profit pays in full up to {chips(indexed(FARM_TIERS[0].upTo, idx))}/day; daily cap ≈ 🪙 {chips(indexed(cap, idx))}. Seeds are always refunded on harvest.</small>
        </>}
        {msg && <small data-testid="farm-msg">{msg}</small>}
      </>}
    </div>
  );
}

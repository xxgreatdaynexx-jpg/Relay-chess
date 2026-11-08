import { MapSheet } from './MapSheet';
import { useDoing } from '@/lib/doing';
import { useCallback, useEffect, useState } from 'react';
import { socket } from '@/lib/net';
import { indexed } from '../../../shared/priceIndex';
import { TROPICAL_CROPS } from '../../../shared/resort';
import { FARM_UPGRADES, MAX_UPGRADE_LEVEL, NO_UPGRADES, upgradePrice } from '../../../shared/farmUpgrades';
import { CROPS as CITY_CROPS, cropById, cropSellValue, FARM_TIERS, type FarmView } from '../../../shared/farm';
import { usePanelDrag } from '@/lib/panelDrag';

const chips = (n: number) => n.toLocaleString('en-US');
/** Compact countdown on ripe tiles, e.g. "11h" or "40m" (full text is in the tooltip). */
const witherHint = (ms: number) => { const m = Math.max(0, Math.ceil(ms / 60_000)); return m >= 60 ? `${Math.floor(m / 60)}h` : `${m}m`; };
const dur = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${x}s` : `${x}s`; };
type Ack = { ok: boolean; error?: string; [k: string]: unknown };

/** FarmVille-style plot: a tile grid sized to the plot, a seed shop and real-time (server-clocked) crops. */
export function FarmGame({ id, label, onClose, onAllFarms }: { id: string; label: string; onClose: () => void; onAllFarms?: () => void }) {
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
  const load = useCallback(() => {
    socket.timeout(10_000).emit('farm_view', { id }, (err: Error | null, r?: Ack) => {
      if (err || !r?.ok) { setMsg(err ? 'No answer from the server.' : r?.error ?? 'Could not load the farm.'); return; }
      const v = r.farm as FarmView; setView(v); setSkew(v.now - Date.now()); if (v.auto?.crop && CROPS.some((c) => c.id === v.auto!.crop)) setSeed(v.auto.crop);
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
  const byTile = new Map((view?.tiles ?? []).map((x) => [x.tile, x]));
  const stage = (tile: number) => { const x = byTile.get(tile); if (!x) return 'empty'; return t >= x.witherAt ? 'withered' : t >= x.readyAt ? 'ready' : 'growing'; };
  const n = view ? view.cols * view.rows : 0;
  const empties = Array.from({ length: n }, (_, i) => i).filter((i) => stage(i) === 'empty');
  const ready = Array.from({ length: n }, (_, i) => i).filter((i) => stage(i) === 'ready');
  const withered = Array.from({ length: n }, (_, i) => i).filter((i) => stage(i) === 'withered');
  const act = (ev: string, body: Record<string, unknown>, ok: (r: Ack) => string) => {
    setBusy(true); setMsg(null);
    socket.timeout(10_000).emit(ev, { id, ...body }, (err: Error | null, r?: Ack) => { setBusy(false); setMsg(err ? 'No answer from the server.' : r?.ok ? ok(r) : r?.error ?? 'Something went wrong.'); setSel(new Set()); load(); });
  };
  const crop = cropById(seed)!;
  const plant = (tiles: number[]) => tiles.length && act('farm_plant', { crop: seed, tiles }, (r) => `Planted ${r.planted} × ${crop.label} for 🪙 ${chips(Number(r.cost))}.`);
  const click = (i: number) => {
    if (!view?.mine || busy) return; const s = stage(i);
    if (s === 'ready') act('farm_harvest', { tiles: [i] }, (r) => `Harvested for 🪙 ${chips(Number(r.paid))}.`);
    else if (s === 'empty') setSel((p) => { const q = new Set(p); if (q.has(i)) q.delete(i); else q.add(i); return q; });
  };
  const cap = FARM_TIERS.reduce((a, x, i) => a + (Math.min(x.upTo, 1e12) - (i ? FARM_TIERS[i - 1].upTo : 0)) * x.rate, 0);
  return (
    <MapSheet className="world-deed world-farm" data-testid="farm-game" data-drag-panel="farm" onPointerDown={dragFarm.onPointerDown} style={dragFarm.style()} ref={dragFarm.ref}>{dragFarm.handle}
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <h3>🌾 {label}</h3>
      {onAllFarms && <button type="button" onClick={onAllFarms} data-testid="farm-all-farms">🏡 Barn · All my farms</button>}
      {!view ? <small>{msg ?? 'Loading the farm…'}</small> : <>
        <small>{view.mine ? 'Your farm. Pick a seed, select empty tiles (or plant them all), come back when it’s ready. Ripe crops wait at least 12 hours before they wither.' : `${view.owner ?? 'Nobody'}'s farm (visiting, read-only).`}</small>
        <div className="farm-grid" style={{ gridTemplateColumns: `repeat(${view.cols}, 1fr)` }} data-testid="farm-grid">
          {Array.from({ length: n }, (_, i) => { const x = byTile.get(i); const s = stage(i); const c = x && cropById(x.crop);
            const title = !x ? 'Empty' : s === 'growing' ? `${c?.label}: ready in ${dur(x.readyAt - t)}` : s === 'ready' ? `${c?.label}: ready! withers in ${dur(x.witherAt - t)}` : `${c?.label}: withered`;
            return <button key={i} type="button" title={title} className={`farm-tile farm-${s}${sel.has(i) ? ' farm-sel' : ''}`} onClick={() => click(i)} data-testid={`farm-tile-${i}`}>
              {s === 'empty' ? '' : s === 'withered' ? '🥀' : s === 'ready' ? c?.emoji : x && (t - x.plantedAt) / (x.readyAt - x.plantedAt) >= 0.5 ? '🌿' : '🌱'}
              {s === 'ready' && x && <b className="farm-wither" data-testid={`farm-wither-${i}`}>{witherHint(x.witherAt - t)}</b>}
              {s === 'growing' && x && <i style={{ width: `${Math.min(100, (100 * (t - x.plantedAt)) / (x.readyAt - x.plantedAt))}%` }} />}
            </button>; })}
        </div>
        {view.mine && <>
          <h4>Seed shop</h4>
          <div className="farm-seeds" data-testid="farm-seeds">
            {CROPS.map((c) => <button key={c.id} type="button" className={seed === c.id ? 'on' : ''} onClick={() => { setSeed(c.id); if (view.auto?.plant) act('farm_auto', { harvest: view.auto?.harvest ?? false, plant: true, crop: c.id }, () => `Auto-plant seed set to ${c.label}.`); }} data-testid={`farm-seed-${c.id}`}>
              <b>{c.emoji} {c.label}</b><span>🪙{chips(indexed(c.seed, idx))} → {chips(indexed(cropSellValue(c), idx))} · {dur(c.grow)}</span></button>)}
          </div>
          <button type="button" disabled={busy || !sel.size} onClick={() => plant([...sel])} data-testid="farm-plant-sel">Plant {sel.size || ''} selected<span>🪙 {chips(indexed(crop.seed, idx) * sel.size)}</span></button>
          <button type="button" disabled={busy || !empties.length} onClick={() => plant(empties)} data-testid="farm-plant-all">Plant all {empties.length} empty<span>🪙 {chips(indexed(crop.seed, idx) * empties.length)}</span></button>
          <button type="button" disabled={busy || !ready.length} onClick={() => act('farm_harvest', {}, (r) => `Harvested ${r.harvested} for 🪙 ${chips(Number(r.paid))}.`)} data-testid="farm-harvest">Harvest {ready.length} ready</button>
          <button type="button" disabled={busy || !ready.length} onClick={() => act('farm_harvest', { pantry: true }, (r) => `🧺 ${r.harvested} crop${r.harvested === 1 ? '' : 's'} into your kitchen pantry.`)} title="Keep the crops for cooking instead of selling them" data-testid="farm-harvest-pantry">🧺 To pantry</button>
          <div className="farm-auto" data-testid="farm-auto">
            <h4>Auto</h4>
            <label className="farm-auto-row"><input type="checkbox" checked={!!view.auto?.harvest} disabled={busy}
              onChange={(e) => act('farm_auto', { harvest: e.target.checked, plant: view.auto?.plant ?? false, crop: view.auto?.crop ?? seed }, () => e.target.checked ? 'Auto-harvest on for this farm.' : 'Auto-harvest off.')}
              data-testid="farm-auto-harvest" /> Auto-harvest ready crops (sells for chips)</label>
            <label className="farm-auto-row"><input type="checkbox" checked={!!view.auto?.plant} disabled={busy}
              onChange={(e) => act('farm_auto', { harvest: view.auto?.harvest ?? false, plant: e.target.checked, crop: seed }, () => e.target.checked ? `Auto-plant on with ${crop.label}.` : 'Auto-plant off.')}
              data-testid="farm-auto-plant" /> Auto-plant empty tiles with selected seed</label>
            <small>Runs on the server about every 30 minutes even while you are logged out. Respects overnight sleep and farm rate limits. Changing seed updates auto-plant crop when auto-plant is on.</small>
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
    </MapSheet>
  );
}

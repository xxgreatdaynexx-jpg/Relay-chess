import { useDoing } from '@/lib/doing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { turbineStatus, FORT_SPOTS, MINE_LEVELS, PIPES, PRODUCTS, PRODUCT_ORDER, PUMPJACK_COST, SELL_TIERS, SURVEY_COST, TRACTS, UNITS, UNIT_ORDER, WELLS_PER_TRACT, WELL_COST, ORE_VALUE_PER_UNIT, tractInfo, whole, type FortState, type Product } from '../../../shared/fortmc';
import { ORES, type OreId } from '../../../shared/mines';
import { indexed } from '../../../shared/priceIndex';
import type { FortWorld } from '@/lib/fortmc3d';
import { importWithReload } from '@/lib/chunkReload';
import { request, socket } from '@/lib/net';
import { flyHome } from '@/lib/travel';
import { usePanelDrag } from '@/lib/panelDrag';
import { BuildingInventory } from './BuildingInventory';
import { MODES, MODE_IDS, type Mode } from '../../../shared/logistics';

const chips = (n: number) => Math.floor(n).toLocaleString('en-US');
type View = { fort: FortState; index: number; today: { gross: number; paid: number }; cap: number; demand: number; value: number };
type Panel = 'tracts' | 'plant' | 'exchange' | 'mine' | 'airport' | null;
const pct = (n: number) => `${Math.round(n)}%`;
const condCls = (c: number) => (c < 15 ? 'bad' : c < 60 ? 'warn' : 'ok');

/** Fort McChud: oil-sands boomtown map (server/fortmc.ts runs the sim; every op is location-gated server-side). */
export function FortMcMap() {
  useDoing('fortmc');
  const drag = usePanelDrag('fortmc');
  const canvasRef = useRef<HTMLCanvasElement>(null); const worldRef = useRef<FortWorld | null>(null);
  const [loading, setLoading] = useState(true); const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [view, setView] = useState<View | null>(null); const [panel, setPanel] = useState<Panel>(null); const [tract, setTract] = useState(1);
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false); useEffect(() => setMsg(null), [panel, tract]); // Tess QA #5: a status line belongs to the panel that produced it
  const px = (base: number) => indexed(base, view?.index ?? 1);

  const apply = useCallback((r: { ok: boolean } & Partial<View>) => { if (r.fort) { setView(r as View); worldRef.current?.setFort(r.fort); } }, []);
  const load = useCallback(() => { void request('fort_state').then((r) => apply(r as { ok: boolean } & Partial<View>)); }, [apply]);
  const [fMode, setFMode] = useState<Mode>('truck');
  const act = async (body: Record<string, unknown>, ok?: string) => {
    setBusy(true); setMsg(null);
    const r = await request('fort_act', body) as { ok: boolean; error?: string; result?: { paid?: number; shipped?: Array<[string, number]>; loads?: number; fee?: number; arriveAt?: number; partial?: string | null } } & Partial<View>;
    setBusy(false); apply(r);
    if (!r.ok) setMsg(r.error ?? 'Failed.');
    else if (r.result?.paid !== undefined) setMsg(`Sold for 🪙 ${chips(r.result.paid)}.`);
    else if (r.result?.shipped) { const x = r.result; const mins = x.arriveAt ? Math.max(1, Math.round((x.arriveAt - Date.now()) / 60_000)) : 0; setMsg(`🚚 ${x.loads ?? 1} load${(x.loads ?? 1) === 1 ? '' : 's'} on the road to your factory: ${x.shipped!.map(([i, n]) => `${chips(n)} ${i}`).join(', ')}${x.fee ? ` (freight 🪙 ${chips(x.fee)})` : ' (your truck, free)'}${mins ? `, arriving in about ${mins} min` : ''}. It lands in factory storage on arrival.${x.partial ? ` Rest stays here: ${x.partial}` : ''}`); }
    else if (ok) setMsg(ok);
  };

  useEffect(() => {
    let dead = false; let freight: { dispose: () => void } | null = null;
    void importWithReload(() => import('@/lib/fortmc3d')).then(({ createFortMc }) => {
      if (dead || !canvasRef.current) return;
      worldRef.current = createFortMc(canvasRef.current, {
        onHover: (id, x, y) => setTip(id ? { id, x, y } : null),
        onPick: (id) => {
          if (id.startsWith('t:')) { setTract(Number(id.slice(2))); setPanel('tracts'); return; }
          setPanel(({ 'f-plant': 'plant', 'f-exchange': 'exchange', 'f-mine': 'mine', 'f-airport': 'airport' } as Record<string, Panel>)[id] ?? null);
        },
      });
      const w = worldRef.current;
      void importWithReload(() => import('@/lib/worldFreight')).then(({ createFreight }) => { if (dead || worldRef.current !== w || !w) return; freight = createFreight(w, 'fortmc'); });
      setLoading(false); load();
    });
    return () => { dead = true; freight?.dispose(); worldRef.current?.dispose(); worldRef.current = null; };
  }, [load]);
  useEffect(() => { const t = window.setInterval(load, 30_000); socket.on('connect', load); return () => { window.clearInterval(t); socket.off('connect', load); }; }, [load]);

  const s = view?.fort; const home = async () => { const r = await flyHome(); if (!r.ok) setMsg(r.error ?? 'Could not fly.'); };
  const spot = tip && FORT_SPOTS.find((x) => x.id === tip.id); const tipTract = tip?.id.startsWith('t:') ? tractInfo(Number(tip.id.slice(2))) : null;
  const ti = tractInfo(tract); const ts = s?.tracts[String(tract)]; const surveyed = !!s?.surveyed.includes(tract);
  const supply = s?.power.supply ?? 0, demand = view?.demand ?? 0;

  return (
    <div className="world fortmc" data-testid="fortmc-map">
      <canvas ref={canvasRef} className="world-canvas" data-testid="fortmc-canvas" />
      <div className="world-title"><span>FORT</span> McCHUD<small>oil sands · tap a site</small></div>
      {loading && <div className="world-loading">Landing at Fort McChud…</div>}
      {spot && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#f2b630' }} data-testid="world-tip"><b>{spot.icon} {spot.label}</b><span>{spot.blurb}</span><em>Click to open</em></div>}
      {tipTract && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#c8a060' }} data-testid="world-tip"><b>🛢 {tipTract.name}</b><span>{s?.tracts[String(tipTract.n)]?.leased ? `Your lease · ${s.tracts[String(tipTract.n)]!.wells.length} wells` : s?.surveyed.includes(tipTract.n) ? `Lease 🪙 ${chips(px(tipTract.lease))}` : 'Unsurveyed'}</span><em>Click for the tract</em></div>}
      {s && <div className="fort-hud" data-testid="fort-hud">
        <span className={supply + 1e-9 < demand ? 'bad' : ''}>⚡ {demand.toFixed(1)}/{supply.toFixed(1)} MW</span>{s && turbineStatus(s).idle && <span className="bad" title="Your gas turbines are switched on but there is no natural gas in the tank, so only the 4 MW grid tie is supplying power." data-testid="fort-turbine-idle">⚡ turbine idle · no gas</span>}
        <span>🛢 {chips(whole(s.stock.crude))} crude</span><span>⛽ {chips(whole(s.stock.diesel) + whole(s.stock.gasoline))} fuel</span>
        <span>📦 tank {chips(view!.cap)}</span><span>🏗 {chips(view!.value)} built</span>
      </div>}
      <div className="world-corner">
        <button type="button" onClick={() => setPanel('tracts')} data-testid="fort-tracts-btn">🛢 Tracts</button>
        <button type="button" onClick={() => setPanel('plant')} data-testid="fort-plant-btn">🏭 Plant</button>
        <button type="button" onClick={() => setPanel('exchange')} data-testid="fort-exchange-btn">💹 Exchange</button>
        <button type="button" onClick={() => setPanel('mine')} data-testid="fort-mine-btn">⛏ Mine</button>
        <button type="button" onClick={() => void home()} data-testid="fortmc-fly-home">✈️ Fly home (free)</button>
      </div>
      {panel && s && (
        <div className="world-deed world-venue fort-panel" data-testid={`fort-${panel}`} data-drag-panel="fortmc" onPointerDown={drag.onPointerDown} style={drag.style()} ref={drag.ref}>{drag.handle}
          <button type="button" className="world-deed-x" onClick={() => setPanel(null)} aria-label="Close">✕</button>
          {panel === 'tracts' && <>
            <h3>🛢 Lease tracts</h3>
            <div className="fort-tabs">{[...Array(TRACTS).keys()].map((i) => <button key={i} type="button" className={tract === i + 1 ? 'on' : ''} onClick={() => setTract(i + 1)} data-testid={`fort-tract-${i + 1}`}>{i + 1}{s.tracts[String(i + 1)]?.leased ? '★' : ''}</button>)}</div>
            <h4>{ti.name}</h4>
            {surveyed ? <small>Richness ×{ti.richness.toFixed(2)} · gas {pct(ti.gas * 100)} · sour {pct(ti.sour * 100)} (sulfur)</small> : <small>Unsurveyed. A seismic survey reveals richness, gas ratio and sourness.</small>}
            {!surveyed && <button type="button" disabled={busy} onClick={() => void act({ op: 'survey', tract })} data-testid="fort-survey">📡 Seismic survey · 🪙 {chips(px(SURVEY_COST))}</button>}
            {surveyed && !ts?.leased && <button type="button" disabled={busy} onClick={() => void act({ op: 'lease', tract }, 'Lease signed.')} data-testid="fort-lease">📝 Buy mineral lease · 🪙 {chips(px(ti.lease))}</button>}
            {ts?.leased && <>
              <small>Wells: {ts.wells.map((w, i) => <b key={i} className={condCls(w.cond)}> #{i + 1}{w.jack ? '⚙' : ''} {pct(w.cond)}</b>)}{!ts.wells.length && ' none'} · Pipeline: {ts.pipe ? `tier ${ts.pipe} (${PIPES[ts.pipe]!.cap}/h)` : 'none — nothing flows to the plant!'}</small>
              {ts.wells.length < WELLS_PER_TRACT && <button type="button" disabled={busy} onClick={() => void act({ op: 'drill', tract })} data-testid="fort-drill">⛏ Drill a well · 🪙 {chips(px(WELL_COST))}</button>}
              {ts.wells.some((w) => !w.jack) && <button type="button" disabled={busy} onClick={() => void act({ op: 'pumpjack', tract })} data-testid="fort-pumpjack">⚙ Pumpjack (×1.8 flow) · 🪙 {chips(px(PUMPJACK_COST))}</button>}
              {ts.pipe < PIPES.length - 1 && <button type="button" disabled={busy} onClick={() => void act({ op: 'pipe', tract })} data-testid="fort-pipe">🔧 Pipeline tier {ts.pipe + 1} ({PIPES[ts.pipe + 1]!.cap}/h) · 🪙 {chips(px(PIPES[ts.pipe + 1]!.cost))}</button>}
            </>}
            <small>Wells → pipeline → separator → crude + raw gas. Power and maintenance matter: worn wells slow down below 60% and stop below 15%.</small>
          </>}
          {panel === 'plant' && <>
            <h3>🏭 Upgrader & Refinery</h3>
            <small>Power {demand.toFixed(1)} MW used of {supply.toFixed(1)} MW (4 MW grid tie + turbines{s && turbineStatus(s).idle ? ' — turbines idle, no natural gas' : ''}). Short on power, everything slows.</small>
            <div className="fort-stock">{PRODUCT_ORDER.map((p) => <span key={p} title={PRODUCTS[p].name}>{PRODUCTS[p].icon} {PRODUCTS[p].name}: <b>{chips(whole(s.stock[p]))}</b></span>)}</div>
            <h4>Your units</h4>
            {s.units.length ? s.units.map((u) => <div key={u.id} className="fort-unit"><span>{UNITS[u.k].icon} {UNITS[u.k].name} <b className={condCls(u.cond)}>{pct(u.cond)}</b></span>
              {u.k !== 'tank' && <button type="button" disabled={busy} onClick={() => void act({ op: 'toggle', id: u.id })}>{u.on ? '⏸ Stop' : '▶ Run'}</button>}</div>) : <small>Nothing built yet. Start with a Separator.</small>}
            <button type="button" disabled={busy} onClick={() => void act({ op: 'repair', what: 'all' }, 'Maintenance done.')} data-testid="fort-repair">🔧 Repair everything (wells, units, mine)</button>
            <h4>Build</h4>
            {UNIT_ORDER.map((k) => { const d = UNITS[k]; const n = s.units.filter((u) => u.k === k).length; return <button key={k} type="button" disabled={busy || n >= d.max} onClick={() => void act({ op: 'build', kind: k }, `${d.name} built.`)} data-testid={`fort-build-${k}`}>{d.icon} {d.name} ({n}/{d.max}) · 🪙 {chips(px(d.cost))}<span>{d.desc}{d.mw ? ` · ${d.mw} MW` : ''}</span></button>; })}
          </>}
          {panel === 'exchange' && <>
            <h3>💹 Ship to market</h3>
            <small>Fort McChud has no market: ship to the Chud City Warehouse and it sells there on arrival.</small>
            <small>Today sold 🪙 {chips(px(view!.today.gross))} gross, paid 🪙 {chips(view!.today.paid)}. Daily tiers: {SELL_TIERS.map((t, i) => `${pct(t.rate * 100)}${t.upTo === Infinity ? ' after' : ` to ${chips(px(t.upTo))}`}`).join(' · ')}.</small>
            <BuildingInventory building="fortmc" />
            <div className="bldg-modes">To my factory by: {MODE_IDS.map((m) => <button key={m} type="button" className={fMode === m ? 'on' : ''} onClick={() => setFMode(m)} data-testid={`fort-ship-mode-${m}`}>{MODES[m].icon} {MODES[m].label}</button>)}</div>
            <button type="button" disabled={busy} onClick={() => void act({ op: 'ship', mode: fMode })} data-testid="fort-ship">🚚 Ship ore + petcoke (as coal) to my factory{fMode === 'truck' ? ' · your truck, free' : ' · freight fee'}</button>
          </>}
          {panel === 'mine' && <>
            <h3>⛏ Deep Ore Mine</h3>
            {s.mine ? <small>Level {s.mine.level} · {MINE_LEVELS[s.mine.level - 1]!.rate} ore/h · {MINE_LEVELS[s.mine.level - 1]!.mw} MW · condition <b className={condCls(s.mine.cond)}>{pct(s.mine.cond)}</b> · {s.mine.on ? 'running' : 'stopped'}</small>
              : <small>An open-pit mine producing a mix of stone, coal, copper, iron, silver, gold, gems and diamonds (~🪙 {ORE_VALUE_PER_UNIT.toFixed(1)} per ore). Needs a lot of power: build turbines first.</small>}
            {(s.mine?.level ?? 0) < MINE_LEVELS.length && <button type="button" disabled={busy} onClick={() => void act({ op: 'mine' }, 'Mine construction complete.')} data-testid="fort-mine-build">{s.mine ? `⬆ Expand to level ${s.mine.level + 1}` : '⛏ Build the Deep Ore Mine'} · 🪙 {chips(px(MINE_LEVELS[s.mine?.level ?? 0]!.cost))}</button>}
            {s.mine && <button type="button" disabled={busy} onClick={() => void act({ op: 'mine_toggle' })}>{s.mine.on ? '⏸ Stop' : '▶ Run'}</button>}
            {s.mine && <button type="button" disabled={busy} onClick={() => void act({ op: 'repair', what: 'mine' }, 'Mine repaired.')}>🔧 Repair the mine</button>}
          </>}
          {panel === 'airport' && <>
            <h3>✈️ Fort McChud Airport (YMC)</h3>
            <small>Your ticket included the flight home.</small>
            <button type="button" onClick={() => void home()} data-testid="fortmc-fly-home-2">🛫 Fly home to Chud Hub</button>
          </>}
          {msg && <small data-testid="fort-msg">{msg}</small>}
        </div>
      )}
    </div>
  );
}

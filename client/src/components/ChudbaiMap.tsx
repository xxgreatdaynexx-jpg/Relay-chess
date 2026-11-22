import { MapSheet } from './MapSheet';
import { useDoing } from '@/lib/doing';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ESP_COST, ESP_MULT, EXPORT_LEVY, G_GRID_MW, G_PIPES, G_PRODUCTS, G_PRODUCT_ORDER, G_SURVEY_COST, G_TRACTS, G_UNITS, G_UNIT_ORDER, G_WELLS_PER_TRACT,
  GULF_SPOTS, GULF_X0, GULF_X1, GULF_Z0, GULF_Z1, GULF_SHORE_Z, SELL_TIERS, exchangeGross, gSupply, gTractInfo, gWhole, wellCost, wellRate,
  type GProduct, type GulfSite, type GulfState,
} from '../../../shared/chudbai';
import { ownerColor } from '../../../shared/fortmc';
import { indexed } from '../../../shared/priceIndex';
import type { GulfWorld } from '@/lib/chudbai3d';
import { importWithReload } from '@/lib/chunkReload';
import { fullScreenGameOpen } from '@/lib/pauseWorld';
import { request, socket } from '@/lib/net';
import { flyHome, useTrip } from '@/lib/travel';
import { usePanelDrag } from '@/lib/panelDrag';

const chips = (n: number) => Math.floor(n).toLocaleString('en-US');
type View = { gulf: GulfState; index: number; today: { gross: number; paid: number }; cap: number; demand: number; value: number; site?: GulfSite; meKey?: string | null };
type Panel = 'tracts' | 'plant' | 'exchange' | 'airport' | 'info' | null;
const pct = (n: number) => `${Math.round(n)}%`;
const condCls = (c: number) => (c < 15 ? 'bad' : c < 60 ? 'warn' : 'ok');

/** 2D fallback: real coordinates, no WebGL. */
function GulfFlatMap({ site, onPick }: { site: GulfSite | null; onPick: (id: string) => void }) {
  const place = (x: number, z: number) => ({ left: `${((x - GULF_X0) / (GULF_X1 - GULF_X0)) * 100}%`, top: `${((z - GULF_Z0) / (GULF_Z1 - GULF_Z0)) * 100}%` });
  return <div className="fort-flat-map gulf-flat-map" data-testid="chudbai-flat-map" aria-label="Chudbai 2D map" tabIndex={0}><div className="fort-flat-board">
    <svg viewBox={`${GULF_X0} ${GULF_Z0} ${GULF_X1 - GULF_X0} ${GULF_Z1 - GULF_Z0}`} aria-hidden="true" preserveAspectRatio="none">
      <rect x={GULF_X0} y={GULF_Z0} width={GULF_X1 - GULF_X0} height={GULF_Z1 - GULF_Z0} fill="#d9b77a" />
      <rect x={GULF_X0} y={GULF_SHORE_Z} width={GULF_X1 - GULF_X0} height={GULF_Z1 - GULF_SHORE_Z} fill="#2a8fb0" />
      <path d="M -190 -60 H 190 M -190 -20 H 190 M 60 -150 V 55" stroke="#8d8270" strokeWidth="5" fill="none" />
    </svg>
    {Array.from({ length: G_TRACTS }, (_, i) => gTractInfo(i + 1)).map((t) => { const L = site?.leases[String(t.n)];
      return <button key={t.n} type="button" className={`fort-flat-tract${L?.mine ? ' owned' : ''}`} style={{ ...place(t.x, t.z), ...(L ? { '--lessor': ownerColor(L.key) } : {}) }} data-lessor={L?.name || undefined} onClick={() => onPick(`t:${t.n}`)} data-testid={`chudbai-flat-tract-${t.n}`}><b>{t.offshore ? '🌊' : '🏜'} Block {t.n}</b><small>{t.name}</small>{L && <span className="fort-flat-lessor">{L.mine ? 'Your concession' : L.name}</span>}</button>; })}
    {GULF_SPOTS.map((s) => <button key={s.id} type="button" className="fort-flat-spot" style={place(s.x, s.z)} onClick={() => onPick(s.id)} data-testid={`chudbai-flat-${s.id}`}><b>{s.icon} {s.label}</b></button>)}
  </div></div>;
}

/** Chudbai: Gulf oil-boom city map (server/chudbai.ts runs the sim; every op is location-gated server-side). */
export function ChudbaiMap() {
  useDoing('chudbai');
  const drag = usePanelDrag('chudbai');
  const canvasRef = useRef<HTMLCanvasElement>(null); const worldRef = useRef<GulfWorld | null>(null);
  const [mode, setMode] = useState<'3d' | '2d'>(() => { try { return localStorage.getItem('chud-world-mode') === '2d' ? '2d' : '3d'; } catch { return '3d'; } });
  const [mapError, setMapError] = useState(false);
  const [loading, setLoading] = useState(mode === '3d'); const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [view, setView] = useState<View | null>(null); const [panel, setPanel] = useState<Panel>(null); const [tract, setTract] = useState(1);
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false); useEffect(() => setMsg(null), [panel, tract]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const px = (base: number) => indexed(base, view?.index ?? 1);
  const trip = useTrip();
  const latest = useRef<View | null>(null);
  const pickSite = useCallback((id: string) => {
    if (id.startsWith('t:')) { setTract(Number(id.slice(2))); setPanel('tracts'); return; }
    setPanel(({ 'g-plant': 'plant', 'g-exchange': 'exchange', 'g-airport': 'airport', 'g-burj': 'info', 'g-marina': 'info', 'g-palm': 'info', 'g-souk': 'info' } as Record<string, Panel>)[id] ?? null);
    setInfo(id);
  }, []);
  const [info, setInfo] = useState<string>('');
  const apply = useCallback((r: { ok: boolean } & Partial<View>) => {
    if (r.gulf || r.site) {
      const next = { ...(latest.current ?? {}), ...r } as View; latest.current = next; setView(next);
      if (r.gulf) worldRef.current?.setGulf(r.gulf); if (next.site) worldRef.current?.setSite(next.site);
    }
  }, []);
  const load = useCallback(() => { void request('chudbai_state').then((r) => apply(r as { ok: boolean } & Partial<View>)); }, [apply]);
  const act = async (body: Record<string, unknown>, ok?: string) => {
    setBusy(true); setMsg(null);
    const r = await request('chudbai_act', body) as { ok: boolean; error?: string; result?: { paid?: number; gross?: number } | null } & Partial<View>;
    setBusy(false); apply(r);
    if (!r.ok) setMsg(r.error ?? 'Failed.');
    else if (r.result?.paid !== undefined) setMsg(`Sold: 🪙 ${chips(r.result.paid)} paid${r.result.gross && r.result.gross > r.result.paid ? ` (of 🪙 ${chips(r.result.gross)} gross; today’s tiers took the rest)` : ''}.`);
    else if (ok) setMsg(ok);
  };
  useEffect(() => {
    if (mode !== '3d') { setLoading(false); return; }
    let dead = false; setLoading(true); const canvas = canvasRef.current;
    const fallback = () => { if (dead) return; setMapError(true); setLoading(false); setTip(null); setMode('2d'); };
    const lost = (e: Event) => { e.preventDefault(); fallback(); }; canvas?.addEventListener('webglcontextlost', lost);
    void importWithReload(() => import('@/lib/chudbai3d')).then(({ createChudbai }) => {
      if (dead || !canvas) return;
      const w = createChudbai(canvas, { onHover: (id, x, y) => setTip(id ? { id, x, y } : null), onPick: pickSite }); worldRef.current = w;
      if (latest.current) { w.setGulf(latest.current.gulf); if (latest.current.site) w.setSite(latest.current.site); }
      setLoading(false);
    }).catch(fallback);
    return () => { dead = true; canvas?.removeEventListener('webglcontextlost', lost); worldRef.current?.dispose(); worldRef.current = null; };
  }, [mode, pickSite]);
  useEffect(() => { load(); const t = window.setInterval(load, 30_000); socket.on('connect', load); return () => { window.clearInterval(t); socket.off('connect', load); }; }, [load]);
  useEffect(() => { const on = (site: GulfSite) => { const me = latest.current?.meKey; for (const L of Object.values(site.leases)) L.mine = !!me && L.key === me; for (const t of site.tracts) if (t.lease) t.lease.mine = !!me && t.lease.key === me; apply({ ok: true, site }); }; socket.on('chudbai_site', on); return () => { socket.off('chudbai_site', on); }; }, [apply]);
  useEffect(() => { let last: boolean | null = null; const t = window.setInterval(() => { const run = !fullScreenGameOpen(); if (run !== last) { last = run; worldRef.current?.setRunning(run); } }, 400); return () => window.clearInterval(t); }, []);

  const s = view?.gulf; const home = async () => { const r = await flyHome(); if (!r.ok) setMsg(r.error ?? 'Could not fly.'); };
  const spot = tip && GULF_SPOTS.find((x) => x.id === tip.id); const tipTract = tip?.id.startsWith('t:') ? gTractInfo(Number(tip.id.slice(2))) : null;
  const ti = gTractInfo(tract); const ts = s?.tracts[String(tract)]; const surveyed = !!s?.surveyed.includes(tract); const L = view?.site?.leases[String(tract)];
  const supply = s ? gSupply(s) : G_GRID_MW, demand = view?.demand ?? 0;
  const sellable = G_PRODUCT_ORDER.filter((p) => G_PRODUCTS[p].sellable);
  const infoSpot = GULF_SPOTS.find((x) => x.id === info);

  return (
    <div className="world chudbai" data-testid="chudbai-map">
      {mode === '3d' ? <canvas ref={canvasRef} className="world-canvas" data-testid="chudbai-canvas" /> : <GulfFlatMap site={view?.site ?? null} onPick={pickSite} />}
      <div className="world-title"><span>CHUD</span>BAI<small>desert oil · gold everything · tap a site</small></div>
      {mode === '2d' && <div className="fort-map-notice" role="status">{mapError ? '3D graphics unavailable. Showing the 2D map.' : '2D map'} · Swipe to explore.</div>}
      {loading && <div className="world-loading">Landing in Chudbai…</div>}
      {spot && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#e8c46a' }} data-testid="world-tip"><b>{spot.icon} {spot.label}</b><span>{spot.blurb}</span><em>Click to open</em></div>}
      {tipTract && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: view?.site?.leases[String(tipTract.n)] ? ownerColor(view.site.leases[String(tipTract.n)]!.key) : '#e8c46a' }} data-testid="world-tip"><b>{tipTract.offshore ? '🌊' : '🏜'} {tipTract.name}</b><span>{(() => { const l = view?.site?.leases[String(tipTract.n)]; if (l?.mine) return `Your concession · ${s?.tracts[String(tipTract.n)]?.wells.length ?? 0} wells`; if (l) return `Held by ${l.name}`; return s?.surveyed.includes(tipTract.n) ? `Concession 🪙 ${chips(px(tipTract.lease))}` : `${tipTract.offshore ? 'Offshore' : 'Onshore'} block · unsurveyed`; })()}</span><em>Click for the block</em></div>}
      {s && <div className="fort-hud gulf-hud" data-testid="chudbai-hud">
        <span className={supply + 1e-9 < demand ? 'bad' : ''}>⚡ {demand.toFixed(1)}/{supply.toFixed(1)} MW</span>
        <span>🛢 {chips(gWhole(s.stock.crude))} light sweet</span><span>✈️ {chips(gWhole(s.stock.jetfuel) + gWhole(s.stock.gasoline))} fuel</span>
        <span>📦 tank {chips(view!.cap)}</span><span>🏗 {chips(view!.value)} built</span>
      </div>}
      <div className="world-corner fort-map-controls">
        <button type="button" data-testid="chudbai-map-mode" onClick={() => { setTip(null); setMapError(false); setMode(mode === '3d' ? '2d' : '3d'); }}>{mode === '3d' ? '▦ 2D map' : '🏙 Try 3D map'}</button>
        <button type="button" onClick={() => setPanel('tracts')} data-testid="chudbai-tracts-btn">🏜 Concessions</button>
        <button type="button" onClick={() => setPanel('plant')} data-testid="chudbai-plant-btn">🏭 Plant</button>
        <button type="button" onClick={() => setPanel('exchange')} data-testid="chudbai-exchange-btn">💹 Exchange</button>
        <button type="button" onClick={() => void home()} data-testid="chudbai-fly-home">{trip.jet ? <>🛩 Fly my jet home (free)</> : <>✈️ Fly home (free)</>}</button>
      </div>
      {panel && s && (
        <MapSheet className="world-deed world-venue fort-panel gulf-panel" data-testid={`chudbai-${panel}`} data-drag-panel="chudbai" onPointerDown={drag.onPointerDown} style={drag.style()} ref={drag.ref}>{drag.handle}
          <button type="button" className="world-deed-x" onClick={() => setPanel(null)} aria-label="Close">✕</button>
          {panel === 'tracts' && <>
            <h3>🏜 Oil concessions</h3>
            <div className="fort-tabs">{[...Array(G_TRACTS).keys()].map((i) => <button key={i} type="button" className={tract === i + 1 ? 'on' : ''} onClick={() => setTract(i + 1)} data-testid={`chudbai-tract-${i + 1}`}>{gTractInfo(i + 1).offshore ? '🌊' : ''}{i + 1}{view?.site?.leases[String(i + 1)]?.mine ? '★' : view?.site?.leases[String(i + 1)] ? '·' : ''}</button>)}</div>
            <h4>{ti.offshore ? '🌊 Offshore' : '🏜 Onshore'} · {ti.name}</h4>
            {surveyed ? <small>Richness ×{ti.richness.toFixed(2)} · associated gas {pct(ti.gas * 100)} · sweet (no sulfur) · {wellRate(tract)} wellstream/h per well at ×1</small> : <small>Unsurveyed. A seismic survey reveals richness and the gas ratio. Chudbai crude is light and sweet: no sulfur anywhere.</small>}
            {!surveyed && <button type="button" disabled={busy} onClick={() => void act({ op: 'survey', tract })} data-testid="chudbai-survey">📡 Seismic survey · 🪙 {chips(px(G_SURVEY_COST))}</button>}
            {surveyed && !L && <button type="button" disabled={busy} onClick={() => void act({ op: 'lease', tract }, 'Concession signed.')} data-testid="chudbai-lease">📝 Sign the concession · 🪙 {chips(px(ti.lease))}</button>}
            {L && !L.mine && <small data-testid="chudbai-lease-held">Concession held by {L.name}. Only they can drill or lay pipe here.</small>}
            {L?.mine && <>
              <small>Wells: {ts?.wells.length ? ts.wells.map((w, i) => <b key={i} className={condCls(w.cond)}> #{i + 1}{w.esp ? '⚡' : ''} {pct(w.cond)}</b>) : ' none'} · Pipeline: {ts?.pipe ? `tier ${ts.pipe} (${G_PIPES[ts.pipe]!.cap}/h)` : 'none — nothing flows to the plant!'}</small>
              {(ts?.wells.length ?? 0) < G_WELLS_PER_TRACT && <button type="button" disabled={busy} onClick={() => void act({ op: 'drill', tract })} data-testid="chudbai-drill">{ti.offshore ? '🛢 Install an offshore platform well' : '⛏ Drill a desert well'} · 🪙 {chips(px(wellCost(tract)))}</button>}
              {!!ts?.wells.some((w) => !w.esp) && <button type="button" disabled={busy} onClick={() => void act({ op: 'esp', tract })} data-testid="chudbai-esp">⚡ ESP pump (×{ESP_MULT} flow) · 🪙 {chips(px(ESP_COST))}</button>}
              {(ts?.pipe ?? 0) < G_PIPES.length - 1 && <button type="button" disabled={busy} onClick={() => void act({ op: 'pipe', tract })} data-testid="chudbai-pipe">🔧 Pipeline tier {(ts?.pipe ?? 0) + 1} ({G_PIPES[(ts?.pipe ?? 0) + 1]!.cap}/h) · 🪙 {chips(px(G_PIPES[(ts?.pipe ?? 0) + 1]!.cost))}</button>}
            </>}
            <small>Wells → pipeline → stabilizer → light sweet crude + associated gas. Worn wells slow below 60% and stop below 15%.</small>
          </>}
          {panel === 'plant' && <>
            <h3>🏭 Desert Refining & LNG Complex</h3>
            <small>Power {demand.toFixed(1)} MW used of {supply.toFixed(1)} MW ({G_GRID_MW} MW grid tie + solar). Short on power, everything slows.</small>
            <div className="fort-stock">{G_PRODUCT_ORDER.map((p) => <span key={p} title={G_PRODUCTS[p].name}>{G_PRODUCTS[p].icon} {G_PRODUCTS[p].name}: <b>{chips(gWhole(s.stock[p]))}</b></span>)}</div>
            <h4>Your units</h4>
            {s.units.length ? s.units.map((u) => <div key={u.id} className="fort-unit"><span>{G_UNITS[u.k].icon} {G_UNITS[u.k].name} <b className={condCls(u.cond)}>{pct(u.cond)}</b></span>
              {u.k !== 'tank' && <button type="button" disabled={busy} onClick={() => void act({ op: 'toggle', id: u.id })}>{u.on ? '⏸ Stop' : '▶ Run'}</button>}</div>) : <small>Nothing built yet. Start with a Crude stabilizer.</small>}
            <button type="button" disabled={busy} onClick={() => void act({ op: 'repair', what: 'all' }, 'Maintenance done.')} data-testid="chudbai-repair">🔧 Repair everything (wells and units)</button>
            <h4>Build</h4>
            {G_UNIT_ORDER.map((k) => { const d = G_UNITS[k]; const n = s.units.filter((u) => u.k === k).length; return <button key={k} type="button" disabled={busy || n >= d.max} onClick={() => void act({ op: 'build', kind: k }, `${d.name} built.`)} data-testid={`chudbai-build-${k}`}>{d.icon} {d.name} ({n}/{d.max}) · 🪙 {chips(px(d.cost))}<span>{d.desc}{d.mw ? ` · ${d.mw} MW` : ''}</span></button>; })}
          </>}
          {panel === 'exchange' && <>
            <h3>💹 Chudbai Mercantile Exchange</h3>
            <small>Sells in person only: you have to be in Chudbai. {Math.round(EXPORT_LEVY * 100)}% export levy on every sale.</small>
            <small>Today sold 🪙 {chips(px(view!.today.gross))} gross, paid 🪙 {chips(view!.today.paid)}. Daily tiers (same as Fort McChud): {SELL_TIERS.map((t) => `${pct(t.rate * 100)}${t.upTo === Infinity ? ' after' : ` to ${chips(px(t.upTo))}`}`).join(' · ')}.</small>
            <div className="gulf-sell" data-testid="chudbai-sell-list">{sellable.map((p: GProduct) => { const have = gWhole(s.stock[p]); const q = qty[p] ?? ''; return <div key={p} className="fort-unit">
              <span>{G_PRODUCTS[p].icon} {G_PRODUCTS[p].name} <b>{chips(have)}</b> <small>· 🪙 {px(G_PRODUCTS[p].price).toFixed(1)} each</small></span>
              <span><input type="number" min={1} max={have} value={q} placeholder="qty" onChange={(e) => setQty({ ...qty, [p]: e.target.value })} style={{ width: 70 }} aria-label={`Quantity of ${G_PRODUCTS[p].name}`} />
                <button type="button" disabled={busy || have < 1} onClick={() => void act({ op: 'sell', id: p, qty: q ? Number(q) : 'all' })} data-testid={`chudbai-sell-${p}`}>{q ? 'Sell' : 'Sell all'}</button></span></div>; })}</div>
            <button type="button" disabled={busy || !sellable.some((p) => gWhole(s.stock[p]) > 0)} onClick={() => void act({ op: 'sell', id: 'all' })} data-testid="chudbai-sell-all">💰 Sell everything in my tanks · ≈ 🪙 {chips(px(sellable.reduce((a, p) => a + exchangeGross(p, gWhole(s.stock[p])), 0)))} before tiers</button>
          </>}
          {panel === 'airport' && <>
            <h3>✈️ Chudbai International (CBI)</h3>
            <small>{trip.jet ? <>Your {trip.jet} is fuelled for the trip home. No ticket (normal jet upkeep still applies).</> : <>Your ticket included the flight home.</>}</small>
            <button type="button" onClick={() => void home()} data-testid="chudbai-fly-home-2">{trip.jet ? <>🛩 Fly my jet home to Chud Hub</> : <>🛫 Fly home to Chud Hub</>}</button>
          </>}
          {panel === 'info' && infoSpot && <>
            <h3>{infoSpot.icon} {infoSpot.label}</h3>
            <small>{infoSpot.blurb}</small>
          </>}
          {msg && <small data-testid="chudbai-msg">{msg}</small>}
        </MapSheet>
      )}
    </div>
  );
}

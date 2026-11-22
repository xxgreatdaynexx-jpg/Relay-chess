import { MapSheet } from './MapSheet';
import { useDoing } from '@/lib/doing';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ESP_COST, ESP_MULT, EXPORT_LEVY, G_GRID_MW, G_PIPES, G_PRODUCTS, G_PRODUCT_ORDER, G_SURVEY_COST, G_TRACTS, G_UNITS, G_UNIT_ORDER, G_WELLS_PER_TRACT,
  DECK_FLOOR, GOLD_SPREAD, GULF_SPOTS, GULF_X0, GULF_X1, GULF_Z0, GULF_Z1, GULF_SHORE_Z, SELL_TIERS, exchangeGross, gSupply, gTractInfo, gWhole, wellCost, wellRate,
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
import { useAccount } from '@/lib/auth';
import { enterHome } from './Homes';
import { TimedSuspense } from './ModalShell';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { CHUDBAI_DEEDS, DISTRICTS, DISTRICT_LABELS, GULF_BLOCKS, GULF_LOTS, METRO_STATIONS, carriage, medianRect, GULF_ROADS } from '../../../shared/chudbaiCity';
import { fetchRealEstateList } from '@/lib/realEstateApi';
const FishingPanel = lazyWithReload(() => import('./FishingPanel').then((m) => ({ default: m.FishingPanel })));

/** Owners of the Chudbai deeds (cb:*), from the public real-estate feed. */
function useChudbaiOwners(): [Map<string, string>, () => void] {
  const [owners, setOwners] = useState<Map<string, string>>(new Map());
  const load = useCallback(() => {
    void fetchRealEstateList().then((d) => {
      if (!d) return;
      setOwners(new Map(d.owned!.filter((o) => o.id.startsWith('cb:')).map((o) => [o.id, o.owner])));
    });
  }, []);
  useEffect(() => { load(); const t = window.setInterval(load, 30_000); return () => window.clearInterval(t); }, [load]);
  return [owners, load];
}

function ChudbaiDeed({ id, owner, me, onChanged, onBack }: { id: string; owner: string | null; me: string | null; onChanged: () => void; onBack: () => void }) {
  const [price, setPrice] = useState<number | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const load = () => void request('re_quote', { id }).then((a) => { const r = a as { ok: boolean; price?: number; error?: string }; if (!r.ok) { setMsg(r.error ?? 'Could not load this home.'); return; } setPrice(typeof r.price === 'number' ? r.price : null); });
  useEffect(() => { setMsg(null); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const buy = async () => { const r = await request('re_buy', { id }) as { ok: boolean; error?: string }; setMsg(r.ok ? 'Purchased. The keys are yours.' : r.error ?? 'Could not buy.'); load(); onChanged(); };
  const d = CHUDBAI_DEEDS.find((x) => x.id === id); const mine = !!owner && !!me && owner.toLowerCase() === me.toLowerCase();
  if (!d) return null;
  return <>
    <h3>{d.type === 'penthouse' ? '🏙' : '🏡'} {d.label}</h3>
    <small>{d.blurb}</small>
    <p data-testid="chudbai-deed">{owner ? (mine ? 'You own this home.' : `Owned by ${owner}.`) : `For sale · 🪙 ${chips(price ?? d.price)}.`}</p>
    {owner && <button type="button" onClick={() => enterHome(id)} data-testid="chudbai-deed-enter">{mine ? '🛋️ Enter & decorate' : `🚪 Visit ${owner}'s home`}</button>}
    {!owner && <button type="button" onClick={() => void buy()} data-testid="chudbai-deed-buy">Buy · 🪙 {chips(price ?? d.price)}</button>}
    <small>Normal deed rules: property tax, 70% sell-back from the Homes menu, full interiors. No rent or passive income.</small>
    <button type="button" onClick={onBack}>All homes</button>
    {msg && <small data-testid="chudbai-deed-msg">{msg}</small>}
  </>;
}


const chips = (n: number) => Math.floor(n).toLocaleString('en-US');
type GoldView = { f: number; ask: number; bid: number; bars: number; soldToday: number; max: number; perDay: number };
type View = { gold?: GoldView; deck?: { ticket: number; visits: number }; gulf: GulfState; index: number; today: { gross: number; paid: number }; cap: number; demand: number; value: number; site?: GulfSite; meKey?: string | null };
type Panel = 'tracts' | 'plant' | 'exchange' | 'airport' | 'info' | 'souk' | 'deck' | 'homes' | null;
const pct = (n: number) => `${Math.round(n)}%`;
const condCls = (c: number) => (c < 15 ? 'bad' : c < 60 ? 'warn' : 'ok');

/** 2D fallback: real coordinates, no WebGL. */
function GulfFlatMap({ site, onPick }: { site: GulfSite | null; onPick: (id: string) => void }) {
  const place = (x: number, z: number) => ({ left: `${((x - GULF_X0) / (GULF_X1 - GULF_X0)) * 100}%`, top: `${((z - GULF_Z0) / (GULF_Z1 - GULF_Z0)) * 100}%` });
  return <div className="fort-flat-map gulf-flat-map" data-testid="chudbai-flat-map" aria-label="Chudbai 2D map" tabIndex={0}><div className="fort-flat-board">
    <svg viewBox={`${GULF_X0} ${GULF_Z0} ${GULF_X1 - GULF_X0} ${GULF_Z1 - GULF_Z0}`} aria-hidden="true" preserveAspectRatio="none">
      <rect x={GULF_X0} y={GULF_Z0} width={GULF_X1 - GULF_X0} height={GULF_Z1 - GULF_Z0} fill="#d9b77a" />
      <rect x={GULF_X0} y={GULF_SHORE_Z} width={GULF_X1 - GULF_X0} height={GULF_Z1 - GULF_SHORE_Z} fill="#2a8fb0" />
      {GULF_BLOCKS.map((b) => <rect key={b.id} x={b.r.x0} y={b.r.z0} width={b.r.x1 - b.r.x0} height={b.r.z1 - b.r.z0} fill={DISTRICTS[b.district].color} opacity={0.35} />)}
      {GULF_ROADS.flatMap((r) => [{ k: 'c', z: carriage(r) }, { k: 'm', z: medianRect(r) }]).map(({ k, z }, i) => z && <rect key={i} x={z.x0} y={z.z0} width={z.x1 - z.x0} height={z.z1 - z.z0} fill={k === 'm' ? '#6f8f4e' : '#5d5a58'} />)}
      {GULF_LOTS.map((l) => <rect key={l.id} x={l.r.x0} y={l.r.z0} width={l.r.x1 - l.r.x0} height={l.r.z1 - l.r.z0} fill={l.kind === 'tower' ? '#7fa6c4' : l.kind === 'mosque' ? '#f2ead8' : l.kind === 'park' || l.kind === 'plaza' ? '#8fb46a' : '#d9c7a4'} stroke="#00000033" strokeWidth="0.4" />)}
      <path d={`M ${GULF_X0 + 20} -50 H ${GULF_X1 - 20}`} stroke="#c0392b" strokeWidth="1.4" strokeDasharray="4 2" fill="none" />
    </svg>
    {Array.from({ length: G_TRACTS }, (_, i) => gTractInfo(i + 1)).map((t) => { const L = site?.leases[String(t.n)];
      return <button key={t.n} type="button" className={`fort-flat-tract${L?.mine ? ' owned' : ''}`} style={{ ...place(t.x, t.z), ...(L ? { '--lessor': ownerColor(L.key) } : {}) }} data-lessor={L?.name || undefined} onClick={() => onPick(`t:${t.n}`)} data-testid={`chudbai-flat-tract-${t.n}`}><b>{t.offshore ? '🌊' : '🏜'} Block {t.n}</b><small>{t.name}</small>{L && <span className="fort-flat-lessor">{L.mine ? 'Your concession' : L.name}</span>}</button>; })}
    {GULF_SPOTS.map((s) => <button key={s.id} type="button" className="fort-flat-spot" style={place(s.x, s.z)} onClick={() => onPick(s.id)} data-testid={`chudbai-flat-${s.id}`}><b>{s.icon} {s.label}</b></button>)}
    {CHUDBAI_DEEDS.map((d) => <button key={d.id} type="button" className="fort-flat-spot gulf-flat-deed" style={place((d.r.x0 + d.r.x1) / 2, (d.r.z0 + d.r.z1) / 2)} onClick={() => onPick(d.id)} data-testid={`chudbai-flat-${d.id}`}><b>{d.type === 'penthouse' ? '🏙' : '🏡'} {d.label}</b></button>)}
    {METRO_STATIONS.map((m) => <span key={m.name} className="gulf-flat-metro" style={place(m.x, -50)}>Ⓜ {m.name}</span>)}
    {DISTRICT_LABELS.map((k, i) => <span key={i} className="gulf-flat-district" style={place(k.x, k.z)}>{DISTRICTS[k.d].label}</span>)}
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
    if (id.startsWith('cb:')) { setDeed(id); setPanel('homes'); return; }
    if (id === 'g-dhow') { setPanel(null); setFishing(true); return; }
    if (id === 'g-palm') setDeed(null);
    setPanel(({ 'g-plant': 'plant', 'g-exchange': 'exchange', 'g-airport': 'airport', 'g-burj': 'deck', 'g-marina': 'info', 'g-palm': 'homes', 'g-souk': 'souk', 'g-mall': 'info', 'g-fountain': 'info', 'g-port': 'info', 'g-sail': 'info' } as Record<string, Panel>)[id] ?? null);
    setInfo(id);
  }, []);
  const [info, setInfo] = useState<string>('');
  const [deed, setDeed] = useState<string | null>(null); const [fishing, setFishing] = useState(false); const [bars, setBars] = useState('1');
  const me = useAccount(); const [owners, reloadOwners] = useChudbaiOwners();
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
    else if (ok) setMsg(ok.replace('{paid}', chips((r.result as { paid?: number } | null)?.paid ?? 0)));
    else if (r.result?.paid !== undefined) setMsg(`Sold: 🪙 ${chips(r.result.paid)} paid${r.result.gross && r.result.gross > r.result.paid ? ` (of 🪙 ${chips(r.result.gross)} gross; today’s tiers took the rest)` : ''}.`);
    return r.ok;
  };
  const deckVisit = async () => { if (await act({ op: 'deck' }, 'Welcome to At the Top. Ticket 🪙 {paid}.')) worldRef.current?.deck?.(); };
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
        <button type="button" onClick={() => setPanel('souk')} data-testid="chudbai-souk-btn">🪙 Gold Souk</button>
        <button type="button" onClick={() => { setDeed(null); setPanel('homes'); }} data-testid="chudbai-homes-btn">🏙 Homes</button>
        <button type="button" onClick={() => setPanel('deck')} data-testid="chudbai-deck-btn">🔭 At the Top</button>
        <button type="button" onClick={() => { setPanel(null); setFishing(true); }} data-testid="chudbai-dhow-btn">⛵ Dhow fishing</button>
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
          {panel === 'souk' && view?.gold && (() => { const g = view.gold; const n = Math.max(1, Math.floor(Number(bars) || 1)); return <>
            <h3>🪙 Gold Souk</h3>
            <small>Gold traders in the old town buy and sell 10-tola bars at the day’s price. The price moves once a day (00:00 UTC), a random step of up to ±3% plus a 15% pull toward base, bounded between 85% and 115% of the base. You buy {Math.round(GOLD_SPREAD * 100)}% over the day's price and sell {Math.round(GOLD_SPREAD * 100)}% under it. It is a place to park chips, not an income.</small>
            <div className="gulf-gold" data-testid="chudbai-gold" style={{ display: "grid", gap: 2, margin: "6px 0" }}>
              <span>Today: <b>{Math.round(g.f * 100)}%</b> of base</span>
              <span>Buy <b data-testid="chudbai-gold-ask">🪙 {chips(g.ask)}</b> / bar</span><span>Sell <b data-testid="chudbai-gold-bid">🪙 {chips(g.bid)}</b> / bar</span>
              <span>You hold <b data-testid="chudbai-gold-bars">{g.bars}</b> / {g.max} bars · worth 🪙 {chips(g.bars * g.bid)}</span>
              <span>Sold today {g.soldToday} / {g.perDay}</span>
            </div>
            <label>Bars <input type="number" min={1} max={g.max} value={bars} onChange={(e) => setBars(e.target.value)} data-testid="chudbai-gold-qty" /></label>
            <button type="button" disabled={busy || g.bars + n > g.max} onClick={() => void act({ op: 'gold_buy', qty: n }, `Bought ${n} bar${n === 1 ? '' : 's'} for 🪙 {paid}.`)} data-testid="chudbai-gold-buy">Buy {n} · 🪙 {chips(n * g.ask)}</button>
            <button type="button" disabled={busy || n > g.bars || g.soldToday + n > g.perDay} onClick={() => void act({ op: 'gold_sell', qty: n }, `Sold ${n} bar${n === 1 ? '' : 's'} for 🪙 {paid}.`)} data-testid="chudbai-gold-sell">Sell {n} · 🪙 {chips(n * g.bid)}</button>
          </>; })()}
          {panel === 'deck' && view?.deck && <>
            <h3>🔭 At the Top · Burj Chudifa</h3>
            <small>The observation deck on floor {DECK_FLOOR}: the whole Gulf coast, the Palm and the oilfields in one view. A sightseeing ticket (no reward beyond the view).</small>
            <p data-testid="chudbai-deck-visits">{view.deck.visits ? `You have been up ${view.deck.visits} time${view.deck.visits === 1 ? '' : 's'}.` : 'You have not been up yet.'}</p>
            <button type="button" disabled={busy} onClick={() => void deckVisit()} data-testid="chudbai-deck-go">🛗 Ride to the top · 🪙 {chips(view.deck.ticket)}</button>
            {mode === '3d' && <button type="button" onClick={() => worldRef.current?.deck?.(false)} data-testid="chudbai-deck-down">⬇ Back to street level</button>}
          </>}
          {panel === 'homes' && (deed ? <ChudbaiDeed id={deed} owner={owners.get(deed) ?? null} me={me} onChanged={reloadOwners} onBack={() => setDeed(null)} /> : <>
            <h3>🏙 Chudbai homes</h3>
            <small>Marina and Downtown penthouses, a Creekside heritage house and villas on the Palm and in the Hills. Bought only while you are in Chudbai. Normal deed rules: tax, 70% sell-back, interiors.</small>
            <div className="fort-list" data-testid="chudbai-homes">{CHUDBAI_DEEDS.map((d) => { const o = owners.get(d.id); return <button key={d.id} type="button" onClick={() => setDeed(d.id)} data-testid={`chudbai-home-${d.id}`}>{d.type === 'penthouse' ? '🏙' : '🏡'} {d.label}<span>{o ? (me && o.toLowerCase() === me.toLowerCase() ? 'Yours' : o) : `🪙 ${chips(px(d.price))}`}</span></button>; })}</div>
          </>)}
          {panel === 'info' && infoSpot && <>
            <h3>{infoSpot.icon} {infoSpot.label}</h3>
            <small>{infoSpot.blurb}</small>
          </>}
          {msg && <small data-testid="chudbai-msg">{msg}</small>}
        </MapSheet>
      )}
      {fishing && <TimedSuspense label="Heading to the dhow wharf…" onClose={() => setFishing(false)}><FishingPanel me={me} spot="dhow" onClose={() => setFishing(false)} /></TimedSuspense>}
    </div>
  );
}

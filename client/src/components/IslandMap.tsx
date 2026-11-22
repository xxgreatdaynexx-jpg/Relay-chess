import { MapSheet } from './MapSheet';
import { useDoing } from '@/lib/doing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { importWithReload } from '@/lib/chunkReload';
import { flyHome, useTrip } from '@/lib/travel';
import { request } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { ISLAND_DOCK, ISLAND_LAGOON, ISLAND_LOTS, ISLAND_LOUNGE, ISLAND_RETREAT_RATE, islandSpots } from '../../../shared/island';
import { FISH_SPOT_CAP, fishPool } from '../../../shared/fishing';
import { TimedSuspense } from './ModalShell';
import { lazyWithReload } from '@/lib/lazyWithReload';
const FishingPanel = lazyWithReload(() => import('./FishingPanel').then((m) => ({ default: m.FishingPanel })));
import { enterHome } from './Homes';
import { IslandFlatMap, useIslandOwners } from './IslandFlatMap';
import type { IslandWorld } from '@/lib/island3d';

const fmt = (n: number) => n.toLocaleString('en-US');
const MODE_KEY = 'chud-world-mode'; // shared with the city and Fort McChud maps
type Panel = { k: 'estates' } | { k: 'deed'; id: string } | { k: 'dock' } | { k: 'lagoon' } | { k: 'lounge' } | null;

/** Private Island: a 3D view or a 2D map of the estates and the dock, and a free return to Chud Hub. */
export function IslandMap() {
  useDoing('resort');
  const me = useAccount();
  const canvasRef = useRef<HTMLCanvasElement>(null); const worldRef = useRef<IslandWorld | null>(null);
  const [mode, setMode] = useState<'3d' | '2d'>(() => { try { return localStorage.getItem(MODE_KEY) === '2d' ? '2d' : '3d'; } catch { return '3d'; } });
  const [mapError, setMapError] = useState(false);
  const [loading, setLoading] = useState(mode === '3d'); const [msg, setMsg] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(() => (typeof window !== 'undefined' && window.innerWidth > 640 && window.innerHeight > 500 ? { k: 'estates' } : null));
  const [owners, reloadOwners] = useIslandOwners();
  const trip = useTrip();
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [fishing, setFishing] = useState(false);
  const pick = useCallback((id: string) => {
    if (id === ISLAND_DOCK.id) setPanel({ k: 'dock' });
    else if (id === ISLAND_LAGOON.id) setPanel({ k: 'lagoon' });
    else if (id === ISLAND_LOUNGE.id) setPanel({ k: 'lounge' });
    else if (id.startsWith('isl:')) setPanel({ k: 'deed', id });
  }, []);
  useEffect(() => { worldRef.current?.setOwners(owners, me); }, [owners, me, loading]);
  useEffect(() => { worldRef.current?.setRunning(!fishing); }, [fishing]);
  useEffect(() => { if (!import.meta.env.DEV) return; (window as unknown as { __islandQA?: unknown }).__islandQA = { pick, view: (x: number, z: number, dx?: number, dy?: number, dz?: number) => worldRef.current?.view(x, z, dx, dy, dz), close: () => setPanel(null), fish: () => setFishing(true) }; }); // dev-only QA hook (like __resortQA)
  useEffect(() => { try { localStorage.setItem(MODE_KEY, mode); } catch { /* private mode */ } }, [mode]);
  useEffect(() => {
    if (mode !== '3d') { setLoading(false); return; }
    let dead = false; setLoading(true);
    const fallback = () => { if (dead) return; setMapError(true); setLoading(false); setMode('2d'); };
    void importWithReload(() => import('@/lib/island3d')).then(({ createIsland }) => {
      if (dead || !canvasRef.current) return;
      try { worldRef.current = createIsland(canvasRef.current, { onHover: (id, x, y) => setTip(id ? { id, x, y } : null), onPick: pick }); } catch { fallback(); return; }
      setLoading(false);
    }).catch(fallback);
    return () => { dead = true; worldRef.current?.dispose(); worldRef.current = null; };
  }, [mode, pick]);
  const home = async () => { const r = await flyHome(); if (!r.ok) setMsg(r.error ?? 'Could not leave the island.'); };
  const homeLabel = trip.jet ? '🛩 Fly home (free)' : '⚓ Sail home (free)';
  const selected = panel?.k === 'deed' ? panel.id : panel?.k === 'dock' ? ISLAND_DOCK.id : panel?.k === 'lagoon' ? ISLAND_LAGOON.id : panel?.k === 'lounge' ? ISLAND_LOUNGE.id : null;
  const tipSpot = tip ? islandSpots().find((s) => s.id === tip.id) : undefined; const tipOwner = tipSpot ? owners.get(tipSpot.id) : undefined;
  return (
    <div className="world island" data-testid="island-map">
      {mode === '3d' ? <canvas ref={canvasRef} className="world-canvas" data-testid="island-canvas" /> : <IslandFlatMap owners={owners} me={me} selected={selected} onPick={pick} />}
      <div className="world-title"><span>PRIVATE</span> ISLAND<small>tap an estate, the dock, the lagoon or the lounge</small></div>
      {tipSpot && tip && mode === '3d' && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#f2d48a' }} data-testid="island-tip"><b>{tipSpot.icon} {tipSpot.label}</b><span>{tipSpot.kind === 'estate' ? (tipOwner ? `Owned by ${tipOwner}` : `For sale · 🪙 ${fmt(tipSpot.price ?? 0)}`) : tipSpot.kind === 'dock' ? ISLAND_DOCK.blurb : tipSpot.kind === 'lagoon' ? ISLAND_LAGOON.blurb : ISLAND_LOUNGE.blurb}</span><em>Click to open</em></div>}
      {mode === '2d' && mapError && <div className="island-map-notice" role="status">3D graphics unavailable. Showing the 2D map.</div>}
      {loading && <div className="world-loading">Landing on the Private Island…</div>}
      <div className="world-corner island-map-controls">
        <button type="button" data-testid="island-map-mode" onClick={() => { setMapError(false); setMode(mode === '3d' ? '2d' : '3d'); }}>{mode === '3d' ? '▦ 2D map' : '🏝️ 3D island'}</button>
        <button type="button" data-testid="island-estates-btn" onClick={() => setPanel({ k: 'estates' })}>🏝️ Estates</button>
        <button type="button" data-testid="island-dock-btn" onClick={() => setPanel({ k: 'dock' })}>⚓ Dock</button>
        <button type="button" data-testid="island-lagoon-btn" onClick={() => { setPanel({ k: 'lagoon' }); worldRef.current?.focusXZ(ISLAND_LAGOON.x, ISLAND_LAGOON.z); }}>🎣 Lagoon</button>
        <button type="button" data-testid="island-lounge-btn" onClick={() => { setPanel({ k: 'lounge' }); worldRef.current?.focusXZ(ISLAND_LOUNGE.x, ISLAND_LOUNGE.z); }}>🍹 Lounge</button>
        <button type="button" onClick={() => void home()} data-testid="island-fly-home">{homeLabel}</button>
      </div>
      {msg && !panel && <small className="island-map-msg" role="status">{msg}</small>}
      {panel && (
        <MapSheet className="world-deed island-panel" data-testid="island-sheet">
          <h3>{panel.k === 'dock' ? `${ISLAND_DOCK.icon} ${ISLAND_DOCK.label}` : panel.k === 'lagoon' ? `${ISLAND_LAGOON.icon} ${ISLAND_LAGOON.label}` : panel.k === 'lounge' ? `${ISLAND_LOUNGE.icon} ${ISLAND_LOUNGE.label}` : panel.k === 'deed' ? `🏝️ ${ISLAND_LOTS.find((l) => l.id === panel.id)?.label ?? 'Estate'}` : '🏝️ Private Island'}</h3>
          <button type="button" className="world-deed-x" onClick={() => setPanel(null)} aria-label="Close" data-testid="island-sheet-x">✕</button>
          {panel.k === 'estates' && <>
            <p>Reached by Sovereign Megayacht or a private jet. Four estates sit on the ridge; the dock sails you home for free. Island-only: fish the Pearl Lagoon, and estate owners collect a daily retreat at the Sunset Lounge.</p>
            {ISLAND_LOTS.map((l) => {
              const o = owners.get(l.id);
              return <button key={l.id} type="button" data-testid={`island-lot-${l.id}`} onClick={() => { pick(l.id); worldRef.current?.focusXZ(l.x, l.z); }}>{l.label}<span>{o ? (me && o.toLowerCase() === me.toLowerCase() ? 'Yours' : o) : `🪙 ${fmt(l.price)}`}</span></button>;
            })}
          </>}
          {panel.k === 'deed' && <IslandDeed id={panel.id} owner={owners.get(panel.id) ?? null} me={me} onHome={(id) => enterHome(id)} onChanged={reloadOwners} onBack={() => setPanel({ k: 'estates' })} />}
          {panel.k === 'dock' && <>
            <p>{ISLAND_DOCK.blurb}</p>
            <button type="button" onClick={() => void home()} data-testid="island-dock-home">{homeLabel}</button>
          </>}
          {panel.k === 'lagoon' && <LagoonInfo onFish={() => setFishing(true)} />}
          {panel.k === 'lounge' && <LoungePanel me={me} onEstates={() => setPanel({ k: 'estates' })} />}
          {msg && <small role="status">{msg}</small>}
        </MapSheet>
      )}
      {fishing && <TimedSuspense label="Loading Pearl Lagoon…" onClose={() => setFishing(false)}><FishingPanel me={me} spot="lagoon" onClose={() => setFishing(false)} /></TimedSuspense>}
    </div>
  );
}

function LagoonInfo({ onFish }: { onFish: () => void }) {
  const pool = fishPool('lagoon'); const legend = pool.filter((f) => f.rarity === 'legendary' || f.rarity === 'epic');
  return (
    <div className="island-act" data-testid="island-lagoon">
      <p>{ISLAND_LAGOON.blurb} Same Fishing skill, gear and reel as every dock; values run about 1.5× the Reef Pier.</p>
      <p><small>Pearl Lagoon has its own daily fishmonger cap of 🪙 {fmt(FISH_SPOT_CAP.lagoon)} (scales with the house-sell cap index), separate from the lake, reef and deep sea. Sell at the Resort Warehouse, ship it home, or cook it.</small></p>
      <p><small>Top catches: {legend.map((f) => `${f.emoji} ${f.label}`).join(' · ')}</small></p>
      <button type="button" onClick={onFish} data-testid="island-lagoon-fish">🎣 Fish the lagoon</button>
    </div>
  );
}

type RetreatRow = { id: string; label: string; amount: number; owner: string | null; mine: boolean; claimed: boolean };
function LoungePanel({ me, onEstates }: { me: string | null; onEstates: () => void }) {
  const [rows, setRows] = useState<RetreatRow[] | null>(null); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => void request('isl_retreat_state').then((a) => { const r = a as { ok: boolean; rows?: RetreatRow[]; error?: string }; if (r.ok && r.rows) setRows(r.rows); else setMsg(r.error ?? 'The lounge is closed right now.'); }), []);
  useEffect(() => { load(); }, [load, me]);
  const mine = (rows ?? []).filter((r) => r.mine); const ready = mine.filter((r) => !r.claimed); const due = ready.reduce((a, r) => a + r.amount, 0);
  const claim = async () => { setBusy(true); const r = await request('isl_retreat_claim') as { ok: boolean; paid?: number; error?: string }; setBusy(false); setMsg(r.ok ? `🍹 Collected 🪙 ${fmt(r.paid ?? 0)}. Enjoy the sunset.` : r.error ?? 'Could not collect.'); load(); };
  return (
    <div className="island-act" data-testid="island-lounge">
      <p>{ISLAND_LOUNGE.blurb} Each island estate pays {(ISLAND_RETREAT_RATE * 100).toFixed(2)}% of its list price once per day (00:00 UTC reset), only while you are here.</p>
      {rows && <ul className="island-retreat-list">{rows.map((r) => <li key={r.id} className={r.mine ? 'mine' : ''}><span>{r.label}</span><b>🪙 {fmt(r.amount)}/day</b><small>{r.mine ? (r.claimed ? 'Collected today ✓' : 'Ready') : r.owner ? `Owned by ${r.owner}` : 'For sale'}</small></li>)}</ul>}
      {mine.length ? <button type="button" disabled={busy || !ready.length} onClick={() => void claim()} data-testid="island-retreat-claim">{ready.length ? `🍹 Collect today's retreat · 🪙 ${fmt(due)}` : 'Collected today ✓'}</button>
        : <><p><small>Own an island estate to collect here.</small></p><button type="button" onClick={onEstates}>🏝️ See the estates</button></>}
      {msg && <small role="status">{msg}</small>}
    </div>
  );
}

function IslandDeed({ id, owner, me, onHome, onChanged, onBack }: { id: string; owner: string | null; me: string | null; onHome: (id: string) => void; onChanged: () => void; onBack: () => void }) {
  const [price, setPrice] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => void request('re_quote', { id }).then((a) => {
    const r = a as { ok: boolean; price?: number; error?: string };
    if (!r.ok) { setMsg(r.error ?? 'Could not load this estate.'); return; }
    setPrice(typeof r.price === 'number' ? r.price : null);
  });
  useEffect(() => { setMsg(null); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const buy = async () => {
    const r = await request('re_buy', { id }) as { ok: boolean; error?: string };
    setMsg(r.ok ? 'Purchased.' : r.error ?? 'Could not buy.'); load(); onChanged();
  };
  const lot = ISLAND_LOTS.find((l) => l.id === id);
  const mine = !!owner && !!me && owner.toLowerCase() === me.toLowerCase();
  return (
    <>
      <p data-testid="island-deed">{owner ? (mine ? 'You own this estate.' : `Owned by ${owner}.`) : `For sale${price != null ? ` · 🪙 ${fmt(price)}` : lot ? ` · 🪙 ${fmt(lot.price)}` : ''}.`}</p>
      {owner && <button type="button" onClick={() => onHome(id)} data-testid="island-enter">{mine ? '🛋️ Enter & decorate' : `🚪 Visit ${owner}'s home`}</button>}
      {!owner && <button type="button" onClick={() => void buy()} data-testid="island-buy">Buy</button>}
      <button type="button" onClick={onBack}>All estates</button>
      {msg && <small>{msg}</small>}
    </>
  );
}

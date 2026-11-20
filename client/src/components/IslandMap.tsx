import { MapSheet } from './MapSheet';
import { useDoing } from '@/lib/doing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { importWithReload } from '@/lib/chunkReload';
import { flyHome, useTrip } from '@/lib/travel';
import { request } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { ISLAND_DOCK, ISLAND_LOTS } from '../../../shared/island';
import { enterHome } from './Homes';
import { IslandFlatMap, useIslandOwners } from './IslandFlatMap';
import type { IslandWorld } from '@/lib/island3d';

const fmt = (n: number) => n.toLocaleString('en-US');
const MODE_KEY = 'chud-world-mode'; // shared with the city and Fort McChud maps
type Panel = { k: 'estates' } | { k: 'deed'; id: string } | { k: 'dock' } | null;

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
  const pick = useCallback((id: string) => {
    if (id === ISLAND_DOCK.id) setPanel({ k: 'dock' });
    else if (id.startsWith('isl:')) setPanel({ k: 'deed', id });
  }, []);
  useEffect(() => { try { localStorage.setItem(MODE_KEY, mode); } catch { /* private mode */ } }, [mode]);
  useEffect(() => {
    if (mode !== '3d') { setLoading(false); return; }
    let dead = false; setLoading(true);
    const fallback = () => { if (dead) return; setMapError(true); setLoading(false); setMode('2d'); };
    void importWithReload(() => import('@/lib/island3d')).then(({ createIsland }) => {
      if (dead || !canvasRef.current) return;
      try { worldRef.current = createIsland(canvasRef.current, { onHover: () => {}, onPick: pick }); } catch { fallback(); return; }
      setLoading(false);
    }).catch(fallback);
    return () => { dead = true; worldRef.current?.dispose(); worldRef.current = null; };
  }, [mode, pick]);
  const home = async () => { const r = await flyHome(); if (!r.ok) setMsg(r.error ?? 'Could not leave the island.'); };
  const homeLabel = trip.jet ? '🛩 Fly home (free)' : '⚓ Sail home (free)';
  const selected = panel?.k === 'deed' ? panel.id : panel?.k === 'dock' ? ISLAND_DOCK.id : null;
  return (
    <div className="world island" data-testid="island-map">
      {mode === '3d' ? <canvas ref={canvasRef} className="world-canvas" data-testid="island-canvas" /> : <IslandFlatMap owners={owners} me={me} selected={selected} onPick={pick} />}
      <div className="world-title"><span>PRIVATE</span> ISLAND<small>tap an estate or the dock</small></div>
      {mode === '2d' && mapError && <div className="island-map-notice" role="status">3D graphics unavailable. Showing the 2D map.</div>}
      {loading && <div className="world-loading">Landing on the Private Island…</div>}
      <div className="world-corner island-map-controls">
        <button type="button" data-testid="island-map-mode" onClick={() => { setMapError(false); setMode(mode === '3d' ? '2d' : '3d'); }}>{mode === '3d' ? '▦ 2D map' : '🏝️ 3D island'}</button>
        <button type="button" data-testid="island-estates-btn" onClick={() => setPanel({ k: 'estates' })}>🏝️ Estates</button>
        <button type="button" data-testid="island-dock-btn" onClick={() => setPanel({ k: 'dock' })}>⚓ Dock</button>
        <button type="button" onClick={() => void home()} data-testid="island-fly-home">{homeLabel}</button>
      </div>
      {msg && !panel && <small className="island-map-msg" role="status">{msg}</small>}
      {panel && (
        <MapSheet className="world-deed island-panel" data-testid="island-sheet">
          <h3>{panel.k === 'dock' ? `${ISLAND_DOCK.icon} ${ISLAND_DOCK.label}` : panel.k === 'deed' ? `🏝️ ${ISLAND_LOTS.find((l) => l.id === panel.id)?.label ?? 'Estate'}` : '🏝️ Private Island'}</h3>
          <button type="button" className="world-deed-x" onClick={() => setPanel(null)} aria-label="Close" data-testid="island-sheet-x">✕</button>
          {panel.k === 'estates' && <>
            <p>Reached by Sovereign Megayacht or a private jet. Four estates sit on the ridge; the dock sails you home for free.</p>
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
          {msg && <small role="status">{msg}</small>}
        </MapSheet>
      )}
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

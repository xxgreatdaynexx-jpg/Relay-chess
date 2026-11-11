import { MapSheet } from './MapSheet';
import { useDoing } from '@/lib/doing';
import { useEffect, useRef, useState } from 'react';
import { importWithReload } from '@/lib/chunkReload';
import { flyHome, useTrip } from '@/lib/travel';
import { request } from '@/lib/net';
import { ISLAND_DOCK, ISLAND_LOTS } from '../../../shared/island';
import { enterHome } from './Homes';
import type { IslandWorld } from '@/lib/island3d';

const fmt = (n: number) => n.toLocaleString('en-US');

/** Private Island: estates, a dock, and a free return to Chud Hub. */
export function IslandMap() {
  useDoing('resort');
  const canvasRef = useRef<HTMLCanvasElement>(null); const worldRef = useRef<IslandWorld | null>(null);
  const [loading, setLoading] = useState(true); const [msg, setMsg] = useState<string | null>(null);
  const [deed, setDeed] = useState<string | null>(null);
  const trip = useTrip();
  useEffect(() => {
    let dead = false;
    void importWithReload(() => import('@/lib/island3d')).then(({ createIsland }) => {
      if (dead || !canvasRef.current) return;
      worldRef.current = createIsland(canvasRef.current, {
        onHover: () => {},
        onPick: (id) => { if (id === ISLAND_DOCK.id) void home(); else if (id.startsWith('isl:')) setDeed(id); },
      });
      setLoading(false);
    });
    return () => { dead = true; worldRef.current?.dispose(); worldRef.current = null; };
  }, []);
  const home = async () => { const r = await flyHome(); if (!r.ok) setMsg(r.error ?? 'Could not leave the island.'); };
  return (
    <div className="world" data-testid="island-map">
      <canvas ref={canvasRef} className="world-canvas" />
      {loading && <div className="world-loading">Landing on the Private Island…</div>}
      <MapSheet className="world-deed" data-testid="island-sheet">
        <h3>🏝️ Private Island</h3>
        <p>Reached by Sovereign Megayacht or a private jet. Four estates sit on the ridge; the dock sails you home for free.</p>
        <ul>
          {ISLAND_LOTS.map((l) => (
            <li key={l.id}><button type="button" data-testid={`island-lot-${l.id}`} onClick={() => { setDeed(l.id); worldRef.current?.focusXZ(l.x, l.z); }}>{l.label} · 🪙 {fmt(l.price)}</button></li>
          ))}
        </ul>
        {deed && <IslandDeed id={deed} onHome={(id) => enterHome(id)} onClose={() => setDeed(null)} />}
        <button type="button" onClick={() => void home()} data-testid="island-fly-home">{trip.jet ? '🛩 Fly home (free)' : '⚓ Sail home (free)'}</button>
        {msg && <small role="status">{msg}</small>}
      </MapSheet>
    </div>
  );
}

function IslandDeed({ id, onHome, onClose }: { id: string; onHome: (id: string) => void; onClose: () => void }) {
  const [price, setPrice] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => void request('re_quote', { id }).then((a) => {
    const r = a as { ok: boolean; price?: number; error?: string };
    if (!r.ok) { setMsg(r.error ?? 'Could not load this estate.'); return; }
    setPrice(typeof r.price === 'number' ? r.price : null);
  });
  useEffect(load, [id]);
  const buy = async () => {
    const r = await request('re_buy', { id }) as { ok: boolean; error?: string };
    setMsg(r.ok ? 'Purchased.' : r.error ?? 'Could not buy.'); load();
  };
  const lot = ISLAND_LOTS.find((l) => l.id === id);
  return (
    <div data-testid="island-deed">
      <h4>{lot?.label ?? id}</h4>
      <p>List price{price != null ? ` · 🪙 ${fmt(price)}` : ''}.</p>
      <button type="button" onClick={() => onHome(id)}>Enter home</button>
      <button type="button" onClick={() => void buy()} data-testid="island-buy">Buy</button>
      <button type="button" onClick={onClose}>Close</button>
      {msg && <small>{msg}</small>}
    </div>
  );
}

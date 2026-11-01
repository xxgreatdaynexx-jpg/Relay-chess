import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { WORLD_SPOTS } from '@/lib/worldSpots';
import type { World } from '@/lib/world3d';
import { FarmGame } from './FarmGame';
import { useAccount } from '@/lib/auth';
import { socket } from '@/lib/net';
import { indexed } from '../../../shared/priceIndex';
import { propertyById as baseProperty, properties as baseProperties, taxOf, sellBackOf, TAX_RATE, GRACE_DAYS, type OwnedProperty } from '../../../shared/realEstate';

/** Today's price index from /api/real-estate; list prices and tax scale with it. */
let IDX = 1;
const priced = <T extends { price: number }>(p: T): T => ({ ...p, price: indexed(p.price, IDX) });
const propertyById = (id: string) => { const p = baseProperty(id); return p ? priced(p) : undefined; };
const properties = () => baseProperties().map(priced);

const chips = (n: number) => n.toLocaleString('en-US');
type Ack = { ok: boolean; error?: string };

/** Deed panel: list price, owner, daily tax, Buy / Sell back. */
function DeedPanel({ id, owned, me, onClose, onFarm }: { id: string; owned: Map<string, OwnedProperty>; me: string | null; onClose: () => void; onFarm?: () => void }) {
  const p = propertyById(id); const o = owned.get(id); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  if (!p) return null;
  const mine = !!(o && me && o.owner.toLowerCase() === me.toLowerCase());
  const act = (ev: 're_buy' | 're_sell') => { setBusy(true); setMsg(null); socket.timeout(10_000).emit(ev, { id }, (err: Error | null, r?: Ack) => { setBusy(false); setMsg(err ? 'No answer from the server. Try again.' : r?.ok ? (ev === 're_buy' ? 'It’s yours.' : 'Sold back to the city.') : r?.error ?? 'Something went wrong.'); }); };
  return (
    <div className="world-deed" data-testid="world-deed">
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <h3>{p.kind === 'landmark' ? '🏛' : p.kind === 'patch' ? '🌳' : p.kind === 'farm' ? '🌾' : '🏠'} {p.label}</h3>
      {p.kind === 'landmark' && <small>Trophy property: stays open to every player. Ownership is prestige only.</small>}
      <dl>
        <dt>Price</dt><dd data-testid="deed-price">🪙 {chips(p.price)}</dd>
        <dt>Owner</dt><dd data-testid="deed-owner">{o ? (mine ? 'You' : o.owner) : 'City of Chud Hub (for sale)'}</dd>
        <dt>Property tax</dt><dd data-testid="deed-tax">🪙 {chips(taxOf(p.price))}/day ({(TAX_RATE * 100).toFixed(1)}%)</dd>
        {o && o.arrears > 0 && <><dt>Arrears</dt><dd className="text-rose-300">{o.arrears} unpaid day{o.arrears > 1 ? 's' : ''} (repossessed at {GRACE_DAYS})</dd></>}
      </dl>
      {!o && (me ? <button type="button" disabled={busy} onClick={() => act('re_buy')} data-testid="deed-buy">Buy for 🪙 {chips(p.price)}</button> : <small>Sign in to buy.</small>)}
      {mine && <button type="button" disabled={busy} onClick={() => act('re_sell')} data-testid="deed-sell">Sell to the city for 🪙 {chips(sellBackOf(p.price))} (70%)</button>}
      {p.kind === 'farm' && o && onFarm && <button type="button" onClick={onFarm} data-testid="deed-farm">{mine ? '🌾 Open farm' : '👀 Visit farm'}</button>}
      {p.kind === 'farm' && !o && <small>Farmland: buy it to plant crops (FarmVille-style, real-time).</small>}
      {msg && <small data-testid="deed-msg">{msg}</small>}
      <small className="opacity-60">Tax is charged once per UTC day and burned. {GRACE_DAYS} unpaid days in a row and the city takes it back (no refund).</small>
    </div>
  );
}

/** Landmark deeds + the signed-in player's properties. */
function DeedList({ owned, me, onOpen, onClose }: { owned: Map<string, OwnedProperty>; me: string | null; onOpen: (id: string) => void; onClose: () => void }) {
  const mine = me ? [...owned.values()].filter((o) => o.owner.toLowerCase() === me.toLowerCase()) : [];
  const lms = properties().filter((p) => p.kind === 'landmark').sort((a, b) => b.price - a.price);
  const value = mine.reduce((a, o) => a + (propertyById(o.id)?.price ?? o.price), 0);
  return (
    <div className="world-deed world-deeds" data-testid="world-deeds">
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <h3>🏛 Real estate</h3>
      <small>Click any building, lot, park or plaza on the map to see its deed. The Trailer Park stays free.</small>
      <h4>My properties{mine.length ? ` · 🪙 ${chips(value)} · tax 🪙 ${chips(mine.reduce((a, o) => a + taxOf(propertyById(o.id)?.price ?? o.price), 0))}/day` : ''}</h4>
      {mine.length ? mine.map((o) => <button type="button" key={o.id} onClick={() => onOpen(o.id)}>{propertyById(o.id)?.label ?? o.id}<span>🪙 {chips(propertyById(o.id)?.price ?? o.price)}</span></button>) : <small>{me ? 'None yet.' : 'Sign in to buy property.'}</small>}
      <h4>🌾 Farmland (east of the city)</h4>
      {properties().filter((p) => p.kind === 'farm').map((p) => <button type="button" key={p.id} onClick={() => onOpen(p.id)} data-testid={`deed-${p.id}`}>{p.label}<span>{owned.get(p.id) ? owned.get(p.id)!.owner : `🪙 ${chips(p.price)}`}</span></button>)}
      <h4>Landmarks (trophy deeds)</h4>
      {lms.map((p) => <button type="button" key={p.id} onClick={() => onOpen(p.id)} data-testid={`deed-${p.id}`}>{p.label}<span>{owned.get(p.id) ? owned.get(p.id)!.owner : `🪙 ${chips(p.price)}`}</span></button>)}
    </div>
  );
}

import { request } from '@/lib/net';
import type { Drive, DriveInput } from '@/lib/worldDrive';
const Dealership = lazy(() => import('./Dealership').then((m) => ({ default: m.Dealership })));

const CASINO_GAMES = [
  { tab: 'blackjack-tab', label: '🂡 Blackjack' }, { tab: 'roulette-tab', label: '🎡 Roulette' }, { tab: 'poker-tab', label: '🃏 Poker' },
  { tab: 'slots-tab', label: '🎰 Slots' }, { tab: 'solitaire-tab', label: '♠ Solitaire' },
];
const MODE_KEY = 'chud-world-mode';

/** Press a top-bar tab (opens its panel) unless it's already open. */
function openTab(testId: string) {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (el && el.getAttribute('aria-expanded') !== 'true') el.click();
  return !!el;
}

function weakDevice() {
  try {
    const c = document.createElement('canvas');
    if (!(c.getContext('webgl2') || c.getContext('webgl'))) return true;
  } catch { return true; }
  const n = navigator as Navigator & { deviceMemory?: number };
  return (n.hardwareConcurrency ?? 4) <= 2 || (n.deviceMemory ?? 4) <= 1;
}

/** Home "world": a night city where each landmark opens a part of Chud Hub. */
export function WorldMap({ onClose, onLeaderboard }: { onClose: () => void; onLeaderboard: () => void }) {
  const me = useAccount();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const [mode, setMode] = useState<'3d' | '2d'>(() => (localStorage.getItem(MODE_KEY) as '3d' | '2d' | null) ?? (weakDevice() ? '2d' : '3d'));
  const [loading, setLoading] = useState(mode === '3d');
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [casino, setCasino] = useState(false);
  const [owned, setOwned] = useState<Map<string, OwnedProperty>>(new Map());
  const [deed, setDeed] = useState<string | null>(null);
  const [deeds, setDeeds] = useState(false);
  const [farm, setFarm] = useState<string | null>(null);
  const ownedRef = useRef(owned); ownedRef.current = owned;
  useEffect(() => {
    let dead = false;
    const load = () => { void fetch('/api/farm').then((r) => r.json()).then((d: { tiles?: Array<[string, number, string, string]> }) => { if (!dead && Array.isArray(d?.tiles)) worldRef.current?.setFarm(d.tiles); }).catch(() => {}); };
    if (!loading) load(); socket.on('farm_changed', load); const t = window.setInterval(load, 60_000);
    return () => { dead = true; socket.off('farm_changed', load); window.clearInterval(t); };
  }, [loading]);
  useEffect(() => {
    let dead = false;
    const load = () => { void fetch('/api/real-estate').then((r) => r.json()).then((d: { owned?: OwnedProperty[]; index?: number }) => { if (typeof d.index === 'number' && d.index > 0) IDX = d.index; if (!dead) setOwned(new Map((d.owned ?? []).map((o) => [o.id, o]))); }).catch(() => {}); };
    load(); socket.on('re_changed', load);
    return () => { dead = true; socket.off('re_changed', load); };
  }, []);
  useEffect(() => { worldRef.current?.setOwned([...owned.keys()]); }, [owned, loading]);
  const [dealer, setDealer] = useState(false);
  const driveRef = useRef<Drive | null>(null);
  const [driving, setDriving] = useState(false); const [near, setNear] = useState<string | null>(null); const [kmh, setKmh] = useState(0);
  const meRef = useRef(me); meRef.current = me;
  const startDrive = (carId: string, color: number) => { setDealer(false); driveRef.current?.start(carId, color); setDriving(!!driveRef.current?.driving); };
  const stopDrive = () => { driveRef.current?.stop(); setDriving(false); setNear(null); };
  const toggleDrive = async () => {
    if (driving) { stopDrive(); return; }
    const a = await request('car_garage') as { ok: boolean; cars?: { carId: string; color: number; active: boolean }[] };
    const c = a.ok ? a.cars?.find((x) => x.active) : undefined; if (c) startDrive(c.carId, c.color); else setDealer(true);
  };
  useEffect(() => { localStorage.setItem(MODE_KEY, mode); }, [mode]);

  const go = (id: string) => {
    switch (id) {
      case 'casino': setCasino(true); return;
      case 'chess': onClose(); return;
      case 'mine': openTab('mines-tab'); break;
      case 'arena': openTab('arena-tab'); break;
      case 'factory': openTab('factory-tab') || openTab('mines-tab'); break;
      case 'warehouse': window.dispatchEvent(new CustomEvent('open-inventory', { detail: { tab: 'inv' } })); break;
      case 'market': if (openTab('market-tab')) break; window.dispatchEvent(new CustomEvent('open-inventory', { detail: { tab: 'market' } })); break;
      case 'bank': openTab('wallet-button'); break;
      case 'stocks': openTab('stocks-tab'); break;
      case 'chat': openTab('chat-tab'); break;
      case 'leaderboard': onLeaderboard(); break;
      case 'dealer': setDealer(true); return;
    }
    // Every other building opens as a panel on top of the city; closing it reveals the city again.
  };
  const goRef = useRef(go); goRef.current = go;

  useEffect(() => {
    if (mode !== '3d') return;
    let dead = false;
    void import('@/lib/world3d').then(({ createWorld }) => {
      if (dead || !canvasRef.current) return;
      try {
        worldRef.current = createWorld(canvasRef.current, {
          onHover: (id, x, y) => setTip(id ? { id, x, y } : null),
          onPick: (id) => goRef.current(id),
          onProperty: (id) => { setDeeds(false); const o = ownedRef.current.get(id); const m = meRef.current;
            if (id.startsWith('f:') && o && m && o.owner.toLowerCase() === m.toLowerCase()) { setDeed(null); setFarm(id); } else { setFarm(null); setDeed(id); } },
        });
        const w = worldRef.current;
        void import('@/lib/worldDrive').then(({ createDrive }) => { if (dead || worldRef.current !== w) return;
          driveRef.current = createDrive(w, { me: () => meRef.current ?? null, onNear: setNear, onSpeed: setKmh }); });
      } catch { setMode('2d'); }
      setLoading(false);
    }).catch(() => setMode('2d'));
    return () => { dead = true; driveRef.current?.dispose(); driveRef.current = null; setDriving(false); worldRef.current?.dispose(); worldRef.current = null; };
  }, [mode]);
  // Pause the city while a building's panel is open over it (saves GPU for Arena/Mines).
  useEffect(() => {
    let last = true;
    const t = window.setInterval(() => {
      // Only full-screen 3D games pause the city. Side drawers (chat, wallet, inventory) keep it live — pausing for
      // them froze the map whenever chat was open.
      const run = !casino && !document.querySelector('[aria-expanded="true"]:is([data-testid="arena-tab"],[data-testid="mines-tab"],[data-testid="factory-tab"])');
      if (run !== last) { last = run; worldRef.current?.setRunning(run); }
    }, 400);
    return () => window.clearInterval(t);
  }, [casino]);
  useEffect(() => { worldRef.current?.setRunning(!casino); if (!casino && !driveRef.current?.driving) worldRef.current?.reset(); }, [casino]);
  useEffect(() => { if (!driving) return; const k = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.closest?.('input,textarea')) return; if (e.code === 'KeyE' && near) goRef.current(near); if (e.code === 'Escape') stopDrive(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [driving, near]);
  const pad = (k: keyof DriveInput, label: string) => <button type="button" className={`world-pad-${k}`} onPointerDown={(e) => { e.preventDefault(); driveRef.current?.touch(k, true); }} onPointerUp={() => driveRef.current?.touch(k, false)} onPointerLeave={() => driveRef.current?.touch(k, false)} onPointerCancel={() => driveRef.current?.touch(k, false)} data-testid={`world-pad-${k}`}>{label}</button>;
  const nearSpot = near && WORLD_SPOTS.find((s) => s.id === near);

  const spot = tip && WORLD_SPOTS.find((s) => s.id === tip.id);
  const trailer = tip?.id.startsWith('trailer:') ? tip.id.slice(8) : null;
  const tipProp = tip ? propertyById(spot ? `lm:${tip.id}` : tip.id) : undefined;
  const tipOwner = tipProp ? owned.get(tipProp.id)?.owner : undefined;
  const ownerLine = tipProp ? (tipOwner ? `Owned by ${tipOwner}` : `For sale · 🪙 ${chips(tipProp.price)}`) : null;
  return (
    <div className="world" data-testid="world-map">
      {mode === '3d' ? <canvas ref={canvasRef} className="world-canvas" data-testid="world-canvas" /> : (
        <div className="world-grid" data-testid="world-grid">
          {WORLD_SPOTS.map((s) => (
            <button key={s.id} type="button" className="world-tile" style={{ ['--c' as string]: '#' + s.color.toString(16).padStart(6, '0') }} onClick={() => go(s.id)} data-testid={`world-tile-${s.id}`}>
              <span className="world-tile-icon">{s.icon}</span><b>{s.label}</b><small>{s.blurb}</small>
            </button>
          ))}
        </div>
      )}
      <div className="world-title"><span>CHUD</span> HUB<small>pick a spot on the map</small></div>
      {loading && mode === '3d' && <div className="world-loading">Building the city…</div>}
      {spot && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#' + spot.color.toString(16).padStart(6, '0') }} data-testid="world-tip"><b>{spot.icon} {spot.label}</b><span>{spot.blurb}</span>{ownerLine && <span className="world-tip-owner">🏛 {ownerLine}</span>}<em>Click to enter</em></div>}
      {!spot && tipProp && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#c9a24a' }} data-testid="world-tip"><b>{tipProp.label}</b><span>{ownerLine}</span><em>Click for the deed</em></div>}
      {trailer && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#ffb36b' }} data-testid="world-tip">{me && trailer.toLowerCase() === me.toLowerCase() ? <b>🏠 Your trailer</b> : <><b>🏠 {trailer}'s trailer</b><span>Chud Acres Trailer Park</span></>}</div>}
      <div className="world-corner">
        <button type="button" onClick={() => { setDeed(null); setFarm(null); setDeeds(!deeds); }} data-testid="world-deeds-btn">🏛 Real estate</button>
        {mode === '3d' && !loading && <button type="button" onClick={() => void toggleDrive()} data-testid="world-drive">{driving ? '🅿 Park' : '🚗 Drive'}</button>}
        <button type="button" onClick={() => setMode(mode === '3d' ? '2d' : '3d')} data-testid="world-mode">{mode === '3d' ? '▦ 2D map' : '🌃 3D city'}</button>
      </div>
      {deed && <DeedPanel id={deed} owned={owned} me={me} onClose={() => setDeed(null)} onFarm={() => { setFarm(deed); setDeed(null); }} />}
      {farm && <FarmGame id={farm} label={propertyById(farm)?.label ?? 'Farm'} onClose={() => setFarm(null)} />}
      {deeds && !deed && <DeedList owned={owned} me={me} onOpen={(id) => setDeed(id)} onClose={() => setDeeds(false)} />}
      {driving && <>
        <div className="world-speedo" data-testid="world-speedo">{kmh} <small>km/h</small><em>WASD / arrows · E enter · Esc park</em></div>
        {nearSpot && <button type="button" className="world-enter" onClick={() => go(nearSpot.id)} data-testid="world-enter">{nearSpot.icon} Enter {nearSpot.label} <kbd>E</kbd></button>}
        <div className="world-pad" data-testid="world-pad"><div>{pad('left', '◀')}{pad('right', '▶')}</div><div>{pad('down', '▼')}{pad('up', '▲')}</div></div>
      </>}
      {dealer && <Suspense fallback={<div className="world-loading">Opening the dealership…</div>}><Dealership onClose={() => setDealer(false)} onDrive={startDrive} /></Suspense>}
      {casino && (
        <div className="world-casino" onMouseDown={(e) => { if (e.target === e.currentTarget) setCasino(false); }} data-testid="world-casino">
          <div><h3>🎰 Chud Casino</h3>
            {CASINO_GAMES.map((g) => <button key={g.tab} type="button" onClick={() => { setCasino(false); openTab(g.tab); }} data-testid={`world-casino-${g.tab}`}>{g.label}</button>)}
            <button type="button" className="world-casino-x" onClick={() => setCasino(false)}>Back to the city</button>
          </div>
        </div>
      )}
    </div>
  );
}

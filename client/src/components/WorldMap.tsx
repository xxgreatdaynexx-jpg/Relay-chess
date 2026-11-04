import { useNow } from '@/lib/useNow';
import { mapCountdownLabel } from '../../../shared/launchCountdown';
import { useDoing } from '@/lib/doing';
import { backdropDismiss } from '@/lib/backdrop';
import { CookingHost, OPEN_GROCERY, openKitchen } from './CookingPanels';
import { EmploymentHost, OPEN_EMPLOY } from './EmploymentPanel';
import { CityHallHost, OPEN_CITYHALL } from './CityHallPanel';
import { Suspense, useEffect, useRef, useState } from 'react';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { importWithReload } from '@/lib/chunkReload';
import { WORLD_SPOTS } from '@/lib/worldSpots';
import { useWalletChips } from '@/lib/wallet';
import { CLOSE_WORLD_PANELS, WALLET_CLOSE, NONE, closePanel, panelId, togglePanel, type WorldPanel } from '@/lib/worldPanels';
import { MINE_CAVE_EVENT } from '../../../shared/mines';
import { MINE_SITES } from '@/lib/worldLayout';
import type { World } from '@/lib/world3d';
import { FarmGame } from './FarmGame';
import { useAccount } from '@/lib/auth';
import { useTrip } from '@/lib/travel';
import { socket } from '@/lib/net';
import { indexed } from '../../../shared/priceIndex';
import { skyNow, parseTod, fmtClock, hex } from '../../../shared/daynight';
import { fmtLap } from '../../../shared/venues';
import { propertyById as baseProperty, properties as baseProperties, taxOf, sellBackOf, TAX_RATE, GRACE_DAYS, workerBonusOf, WORKER_BONUS_MAX, landPrice, landMultiplierNote, landSurchargePct, SURCHARGE_PCT_PER_1K, type OwnedProperty } from '../../../shared/realEstate';

/** Today's price index from /api/real-estate; list prices and tax scale with it. */
let IDX = 1;
const priced = <T extends { price: number }>(p: T): T => ({ ...p, price: indexed(p.price, IDX) });
const propertyById = (id: string) => { const p = baseProperty(id); return p ? priced(p) : undefined; };
const properties = () => baseProperties().map(priced);

const chips = (n: number) => n.toLocaleString('en-US');
type Ack = { ok: boolean; error?: string };

/** Deed panel: list price, owner, daily tax, Buy / Sell back. */
export function DeedPanel({ id, owned, me, onClose, onFarm, onDone, onKitchen }: { id: string; owned: Map<string, OwnedProperty>; me: string | null; onClose: () => void; onFarm?: () => void; onKitchen?: () => void; onDone?: (ev: 're_buy' | 're_sell', text: string, paid?: number) => void }) {
  useDoing('realestate', propertyById(id)?.label);
  const dragDeed = usePanelDrag('deed');
  const p = propertyById(id); const o = owned.get(id); const [busy, setBusy] = useState<null | 're_buy' | 're_sell'>(null); const [msg, setMsg] = useState<string | null>(null); const wallet = useWalletChips();
  if (!p) return null;
  const mine = !!(o && me && o.owner.toLowerCase() === me.toLowerCase());
  // pt1388u: you pay list × (1 + 2% per 1,000 of property you own, uncapped); sell-back is 70% of what you paid; tax stays on list.
  const ownedValue = me ? [...owned.entries()].filter(([, x]) => x.owner.toLowerCase() === me.toLowerCase()).reduce((a, [k, x]) => a + (propertyById(k)?.price ?? x.price ?? 0), 0) : 0;
  const surcharge = +landSurchargePct(ownedValue).toFixed(1);
  const cost = o ? (o.price || p.price) : landPrice(p.price, ownedValue); const note = !o ? landMultiplierNote(ownedValue) : '';
  const short = wallet != null && wallet < cost ? cost - wallet : 0;
  // QA r8: pending state on the button, and on success a toast + immediate (optimistic) ownership update via onDone.
  const act = (ev: 're_buy' | 're_sell') => { setBusy(ev); setMsg(null); socket.timeout(15_000).emit(ev, ev === 're_buy' ? { id, max: cost } : { id }, (err: Error | null, r?: Ack & { price?: number; chips?: number }) => { setBusy(null); if (!err && r?.ok) { const paid = ev === 're_buy' ? (r.price ?? cost) : cost; const text = ev === 're_buy' ? `🏛 ${p.label} is yours! Paid 🪙 ${chips(paid)}.` : `Sold ${p.label} back to the city for 🪙 ${chips(r.chips ?? sellBackOf(cost))}.`; setMsg(text); onDone?.(ev, text, paid); return; } setMsg(err ? 'No answer from the server. Try again.' : (ev === 're_buy' && (r?.error === 'Not enough chips.' || r?.error === 'Something went wrong.') && short ? `Not enough chips: ${p.label} costs 🪙 ${chips(cost)}; you need 🪙 ${chips(short)} more.` : r?.error ?? 'Something went wrong.')); }); };
  return (
    <div className="world-deed" data-testid="world-deed" data-drag-panel="deed" onPointerDown={dragDeed.onPointerDown} style={dragDeed.style()} ref={dragDeed.ref}>{dragDeed.handle}
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <h3>{p.kind === 'landmark' ? '🏛' : p.kind === 'patch' ? '🌳' : p.kind === 'farm' ? '🌾' : '🏠'} {p.label}</h3>
      {p.kind === 'landmark' && <small>Trophy property: stays open to every player. Ownership is prestige only.</small>}
      <dl>
        {o ? <><dt>{mine ? 'You paid' : 'Paid'}</dt><dd data-testid="deed-price">🪙 {chips(cost)}</dd></> : <><dt>Your surcharge</dt><dd data-testid="deed-surcharge">+{surcharge}%</dd><dt>Your price</dt><dd data-testid="deed-price">🪙 {chips(cost)}{note && <small className="block text-amber-300" data-testid="deed-multiplier">List 🪙 {chips(p.price)} · {note}</small>}</dd></>}
        <dt>Owner</dt><dd data-testid="deed-owner">{o ? (mine ? 'You' : o.owner) : 'City of Chud Hub (for sale)'}</dd>
        <dt>Sell-back</dt><dd data-testid="deed-sellback">🪙 {chips(sellBackOf(cost))} (70% of {o ? 'what was paid' : 'your price'})</dd>
        {workerBonusOf(p.id) > 0 && <><dt>Worker cap</dt><dd data-testid="deed-workers">+{workerBonusOf(p.id)} Employment Office worker{workerBonusOf(p.id) > 1 ? 's' : ''} (property bonus max +{WORKER_BONUS_MAX})</dd></>}
        <dt>Property tax</dt><dd data-testid="deed-tax">🪙 {chips(taxOf(p.price))}/day ({(TAX_RATE * 100).toFixed(1)}%)</dd>
        {o && o.arrears > 0 && <><dt>Arrears</dt><dd className="text-rose-300">{o.arrears} unpaid day{o.arrears > 1 ? 's' : ''} (repossessed at {GRACE_DAYS})</dd></>}
      </dl>
      {!o && (me ? <button type="button" disabled={!!busy} aria-busy={busy === 're_buy'} onClick={() => (short ? setMsg(`Not enough chips: ${p.label} costs 🪙 ${chips(cost)}; you have 🪙 ${chips(wallet ?? 0)} (need 🪙 ${chips(short)} more).`) : act('re_buy'))} aria-describedby={short ? 'deed-short' : undefined} data-testid="deed-buy">{busy === 're_buy' ? <><span className="world-spin" aria-hidden /> Buying…</> : <>Buy for 🪙 {chips(cost)}{me ? ` (+${surcharge}% surcharge)` : ''}</>}</button> : <small>Sign in to buy.</small>)}
      {mine && <button type="button" disabled={!!busy} aria-busy={busy === 're_sell'} onClick={() => act('re_sell')} data-testid="deed-sell">{busy === 're_sell' ? <><span className="world-spin" aria-hidden /> Selling…</> : <>Sell to the city for 🪙 {chips(sellBackOf(cost))} (70%)</>}</button>}
      {mine && onKitchen && p.kind !== 'landmark' && <button type="button" onClick={onKitchen} data-testid="deed-kitchen">🍳 Kitchen</button>}
      {p.kind === 'farm' && o && onFarm && <button type="button" onClick={onFarm} data-testid="deed-farm">{mine ? '🌾 Open farm' : '👀 Visit farm'}</button>}
      {p.kind === 'farm' && !o && <small>Farmland: buy it to plant crops (FarmVille-style, real-time).</small>}
      {!o && me && short > 0 && !msg && <small id="deed-short" className="text-amber-300" data-testid="deed-short">You need 🪙 {chips(short)} more chips to buy this.</small>}
      {msg && <small role="status" data-testid="deed-msg">{msg}</small>}
      <small className="opacity-60">You can sell any property back to the city at any time for 70% of what you paid. Surcharge: +{SURCHARGE_PCT_PER_1K}% on your next purchase for every 🪙 1,000 of property you already own, no cap (Trailer Park lots don't count). Tax is on the list price, charged once per UTC day and burned. {GRACE_DAYS} unpaid days in a row and the city takes it back (no refund).</small>
    </div>
  );
}

/** Landmark deeds + the signed-in player's properties. */
function DeedList({ owned, me, onOpen, onClose }: { owned: Map<string, OwnedProperty>; me: string | null; onOpen: (id: string) => void; onClose: () => void }) {
  useDoing('realestate');
  const dragDeeds = usePanelDrag('deeds');
  const mine = me ? [...owned.values()].filter((o) => o.owner.toLowerCase() === me.toLowerCase()) : [];
  const lms = properties().filter((p) => p.kind === 'landmark').sort((a, b) => b.price - a.price);
  const value = mine.reduce((a, o) => a + (propertyById(o.id)?.price ?? o.price), 0);
  return (
    <div className="world-deed world-deeds" data-testid="world-deeds" data-drag-panel="deeds" onPointerDown={dragDeeds.onPointerDown} style={dragDeeds.style()} ref={dragDeeds.ref}>{dragDeeds.handle}
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <h3>🏛 Real estate</h3>
      <small>Click any building, lot, park or plaza on the map to see its deed. The Trailer Park stays free.</small>
      <h4>My properties{mine.length ? ` · 🪙 ${chips(value)} · tax 🪙 ${chips(mine.reduce((a, o) => a + taxOf(propertyById(o.id)?.price ?? o.price), 0))}/day` : ''}</h4>
      {mine.length ? mine.map((o) => <button type="button" key={o.id} onClick={() => onOpen(o.id)}>{propertyById(o.id)?.label ?? o.id}<span>🪙 {chips(propertyById(o.id)?.price ?? o.price)}</span></button>) : <small>{me ? 'None yet.' : 'Sign in to buy property.'}</small>}
      <h4>🌾 Farmland (east of the city)</h4>
      {properties().filter((p) => p.kind === 'farm' && p.map !== 'resort').map((p) => <button type="button" key={p.id} onClick={() => onOpen(p.id)} data-testid={`deed-${p.id}`}>{p.label}<span>{owned.get(p.id) ? owned.get(p.id)!.owner : `🪙 ${chips(p.price)}`}</span></button>)}
      <h4>Landmarks (trophy deeds)</h4>
      {lms.map((p) => <button type="button" key={p.id} onClick={() => onOpen(p.id)} data-testid={`deed-${p.id}`}>{p.label}<span>{owned.get(p.id) ? owned.get(p.id)!.owner : `🪙 ${chips(p.price)}`}</span></button>)}
    </div>
  );
}

import { request } from '@/lib/net';
import type { Drive, DriveInput } from '@/lib/worldDrive';
import { usePanelDrag } from '@/lib/panelDrag';
const Venues = lazyWithReload(() => import('./Venues').then((m) => ({ default: m.Venues })));
const FishingPanel = lazyWithReload(() => import('./FishingPanel').then((m) => ({ default: m.FishingPanel })));
const Dealership = lazyWithReload(() => import('./Dealership').then((m) => ({ default: m.Dealership })));
const MechanicShop = lazyWithReload(() => import('./MechanicShop').then((m) => ({ default: m.MechanicShop })));
const ResortMap = lazyWithReload(() => import('./ResortMap').then((m) => ({ default: m.ResortMap })));

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
function CityMap({ onClose, onLeaderboard }: { onClose: () => void; onLeaderboard: () => void }) {
  const dragHome = usePanelDrag('home');
  const me = useAccount();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const [mode, setMode] = useState<'3d' | '2d'>(() => (localStorage.getItem(MODE_KEY) as '3d' | '2d' | null) ?? (weakDevice() ? '2d' : '3d'));
  const [loading, setLoading] = useState(mode === '3d');
  // Real-time Alberta time sky (pt1246u); ?tod=HH:MM pins it for QA screenshots.
  const [sky, setSky] = useState(() => skyNow(new Date(), parseTod(new URLSearchParams(location.search).get('tod'))));
  useEffect(() => { const o = parseTod(new URLSearchParams(location.search).get('tod')); const t = setInterval(() => setSky(skyNow(new Date(), o)), 20000); return () => clearInterval(t); }, []);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  // One main panel at a time (QA r8): deed / real estate list / farm / venue / dealer / casino share one slot.
  const [panel, setPanel] = useState<WorldPanel>(NONE);
  const casino = panel.k === 'casino'; const setCasino = (v: boolean) => setPanel((c) => (v ? { k: 'casino' } : closePanel(c, 'casino')));
  useEffect(() => { if (panel.k !== 'none') window.dispatchEvent(new Event(WALLET_CLOSE)); }, [panel.k]);
  const firstMode = useRef(true); useEffect(() => { if (firstMode.current) { firstMode.current = false; return; } setPanel(NONE); }, [mode]); // QA r9: switching 2D/3D closes map panels (Airport stayed up)
  useEffect(() => { const close = () => setPanel(NONE); window.addEventListener(CLOSE_WORLD_PANELS, close); return () => window.removeEventListener(CLOSE_WORLD_PANELS, close); }, []);
  const [owned, setOwned] = useState<Map<string, OwnedProperty>>(new Map());
  const [toast, setToast] = useState<string | null>(null); const toastT = useRef(0);
  const deed = panelId(panel, 'deed'); const setDeed = (id: string | null) => setPanel((c) => (id ? { k: 'deed', id } : closePanel(c, 'deed')));
  const home = panel.k === 'home';
  const deeds = panel.k === 'deeds'; const setDeeds = (v: boolean) => setPanel((c) => (v ? { k: 'deeds' } : closePanel(c, 'deeds')));
  const farm = panelId(panel, 'farm'); const setFarm = (id: string | null) => setPanel((c) => (id ? { k: 'farm', id } : closePanel(c, 'farm')));
  const ownedRef = useRef(owned); ownedRef.current = owned;
  useEffect(() => {
    let dead = false;
    const load = () => { void fetch('/api/farm').then((r) => r.json()).then((d: { tiles?: Array<[string, number, string, string]> }) => { if (!dead && Array.isArray(d?.tiles)) worldRef.current?.setFarm(d.tiles); }).catch(() => {}); };
    if (!loading) load(); socket.on('farm_changed', load); const t = window.setInterval(load, 15_000); // QA r8: crops on the map grow live (was 60 s)
    return () => { dead = true; socket.off('farm_changed', load); window.clearInterval(t); };
  }, [loading]);
  useEffect(() => {
    let dead = false;
    const load = () => { void fetch('/api/real-estate').then((r) => r.json()).then((d: { owned?: OwnedProperty[]; index?: number }) => { if (typeof d.index === 'number' && d.index > 0) IDX = d.index; if (!dead) setOwned(new Map((d.owned ?? []).map((o) => [o.id, o]))); }).catch(() => {}); };
    load(); socket.on('re_changed', load);
    return () => { dead = true; socket.off('re_changed', load); };
  }, []);
  useEffect(() => { worldRef.current?.setOwned([...owned.keys()]); }, [owned, loading]);
  const dealer = panel.k === 'dealer'; const setDealer = (v: boolean) => setPanel((c) => (v ? { k: 'dealer' } : closePanel(c, 'dealer')));
  const mechanic = panel.k === 'mechanic'; const setMechanic = (v: boolean) => setPanel((c) => (v ? { k: 'mechanic' } : closePanel(c, 'mechanic')));
  const [nitro, setNitro] = useState<{ have: number; full: number; on: boolean } | null>(null);
  const dock = panel.k === 'dock'; const setDock = (v: boolean) => setPanel((c) => (v ? { k: 'dock' } : closePanel(c, 'dock')));
  const driveRef = useRef<Drive | null>(null);
  const pendingDrive = useRef<{ carId: string; color: number; from?: string } | null>(null); const startDriveRef = useRef<(carId: string, color: number, from?: string) => void>(() => {});
  const [driving, setDriving] = useState(false); const [near, setNear] = useState<string | null>(null); const [kmh, setKmh] = useState(0);
  useDoing('city'); useDoing('driving', null, driving);
  const meRef = useRef(me); meRef.current = me;
  const venue = panelId(panel, 'venue') as 'airport' | 'racetrack' | null; const setVenue = (id: 'airport' | 'racetrack' | null) => setPanel((c) => (id ? { k: 'venue', id } : closePanel(c, 'venue')));
  const [lap, setLap] = useState<{ t0: number | null; text: string | null; gate: number }>({ t0: null, text: null, gate: 0 }); const [, setNow] = useState(0);
  useEffect(() => { if (!driving || lap.t0 == null) return; const t = window.setInterval(() => setNow(Date.now()), 100); return () => window.clearInterval(t); }, [driving, lap.t0]);
  const onRace = (ev: Array<{ kind: string; ms?: number; gate?: number; text?: string; why?: string }>) => setLap((l) => {
    let n = { ...l };
    for (const e of ev) {
      if (e.kind === 'start') n = { t0: Date.now(), text: n.text, gate: 0 };
      else if (e.kind === 'gate') n.gate = e.gate ?? n.gate;
      else if (e.kind === 'lap') n = { t0: Date.now(), text: e.text ?? null, gate: 0 };
      else if (e.kind === 'void') n = { t0: null, text: `Lap void: ${e.why ?? 'off track'}`, gate: 0 };
    }
    return n;
  });
  const startDrive = (carId: string, color: number, from?: string) => { setDealer(false); driveRef.current?.start(carId, color, from); setDriving(!!driveRef.current?.driving); setLap({ t0: null, text: null, gate: 0 }); };
  const driveFrom = async (from: string) => {
    const a = await request('car_garage') as { ok: boolean; cars?: { carId: string; color: number; active: boolean }[] };
    const c = a.ok ? a.cars?.find((x) => x.active) ?? a.cars?.[0] : undefined; if (!c) return false;
    // 2D map has no driving: switch to the 3D city and start there once the drive module is ready (QA r7: these buttons did nothing in 2D).
    if (!driveRef.current) { pendingDrive.current = { carId: c.carId, color: c.color, from }; if (mode !== '3d') setMode('3d'); return true; }
    startDrive(c.carId, c.color, from); return true;
  };
  startDriveRef.current = startDrive;
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
      case 'mine': case 'mine-frost': case 'mine-magma': window.dispatchEvent(new CustomEvent(MINE_CAVE_EVENT, { detail: MINE_SITES[id].cave })); break;
      case 'arena': openTab('arena-tab'); break;
      case 'factory': openTab('factory-tab') || openTab('mines-tab'); break;
      case 'warehouse': window.dispatchEvent(new CustomEvent('open-inventory', { detail: { tab: 'inv' } })); break;
      case 'market': if (openTab('market-tab')) break; window.dispatchEvent(new CustomEvent('open-inventory', { detail: { tab: 'market' } })); break;
      case 'bank': openTab('wallet-button'); break;
      case 'stocks': openTab('stocks-tab'); break;
      case 'chat': openTab('chat-tab'); break;
      case 'leaderboard': onLeaderboard(); break;
      case 'dealer': setDealer(true); return;
      case 'mechanic': setMechanic(true); return;
      case 'dock': setDock(true); return;
      case 'grocery': window.dispatchEvent(new Event(OPEN_GROCERY)); return;
      case 'employ': window.dispatchEvent(new Event(OPEN_EMPLOY)); return;
      case 'cityhall': window.dispatchEvent(new Event(OPEN_CITYHALL)); return;
      case 'airport': case 'racetrack': setVenue(id); return;
    }
    // Every other building opens as a panel on top of the city; closing it reveals the city again.
  };
  const goRef = useRef(go); goRef.current = go;
  // Player profile "Show on map": land/farm coordinates from /api/player.
  useEffect(() => { const on = (e: Event) => { const d = (e as CustomEvent<{ x: number; z: number }>).detail; if (d && Number.isFinite(d.x) && Number.isFinite(d.z)) worldRef.current?.focusXZ(d.x, d.z); }; window.addEventListener('world-focus', on); return () => window.removeEventListener('world-focus', on); }, []);
  useEffect(() => { if (!dock || driving || loading) return; const t = setTimeout(() => worldRef.current?.flyTo('dock'), 600); return () => clearTimeout(t); }, [dock, loading, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== '3d') return;
    let dead = false;
    void importWithReload(() => import('@/lib/world3d')).then(({ createWorld }) => {
      if (dead || !canvasRef.current) return;
      try {
        worldRef.current = createWorld(canvasRef.current, {
          onHover: (id, x, y) => setTip(id ? { id, x, y } : null),
          onPick: (id) => { if (id) goRef.current(id); }, // '' = a profile "Show on map" glide, not a building
          onProperty: (id) => { const o = ownedRef.current.get(id); const m = meRef.current;
            if ((id.startsWith('f:') || id.startsWith('cf:')) && o && m && o.owner.toLowerCase() === m.toLowerCase()) setFarm(id); else setDeed(id); },
          onTrailer: (n) => { const m = meRef.current; if (m && n.toLowerCase() === m.toLowerCase()) { setPanel({ k: 'home' }); return true; } return false; },
        });
        const w = worldRef.current;
        void importWithReload(() => import('@/lib/worldDrive')).then(({ createDrive }) => { if (dead || worldRef.current !== w) return;
          driveRef.current = createDrive(w, { me: () => meRef.current ?? null, onNear: setNear, onSpeed: setKmh, onRace, onNitro: setNitro });
          const pd = pendingDrive.current; pendingDrive.current = null; if (pd) startDriveRef.current(pd.carId, pd.color, pd.from); });
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
    <div className="world" data-testid="world-map" data-tod={sky.phase} style={{ background: `radial-gradient(120% 90% at 50% 0%, ${hex(sky.horizon)}, ${hex(sky.sky)} 70%)`, ['--glow' as string]: String(0.25 + 0.75 * sky.lights) }}>
      {mode === '3d' ? <canvas ref={canvasRef} className="world-canvas" data-testid="world-canvas" /> : (
        <div className="world-grid" data-testid="world-grid">
          {WORLD_SPOTS.map((s) => (
            <button key={s.id} type="button" className="world-tile" style={{ ['--c' as string]: '#' + s.color.toString(16).padStart(6, '0') }} onClick={() => go(s.id)} data-testid={`world-tile-${s.id}`}>
              <span className="world-tile-icon">{s.icon}</span><b>{s.label}</b><small>{s.blurb}</small>
            </button>
          ))}
        </div>
      )}
      <div className="world-clock" data-testid="world-clock" title={`Alberta time · sunrise ${fmtClock(sky.sunrise)} · sunset ${fmtClock(sky.sunset)}`}><span>{sky.icon}</span><b>{fmtClock(sky.minutes)}</b><small>AB · {sky.label}</small></div>
      <MuCountdown />
      <div className="world-title"><span>CHUD</span> HUB</div>
      {loading && mode === '3d' && <div className="world-loading">Building the city…</div>}
      {spot && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#' + spot.color.toString(16).padStart(6, '0') }} data-testid="world-tip"><b>{spot.icon} {spot.label}</b><span>{spot.blurb}</span>{ownerLine && <span className="world-tip-owner">🏛 {ownerLine}</span>}<em>Click to enter</em></div>}
      {!spot && tipProp && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#c9a24a' }} data-testid="world-tip"><b>{tipProp.label}</b><span>{ownerLine}</span><em>Click for the deed</em></div>}
      {trailer && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#ffb36b' }} data-testid="world-tip">{me && trailer.toLowerCase() === me.toLowerCase() ? <b>🏠 Your trailer</b> : <><b>🏠 {trailer}'s trailer</b><span>Chud Acres Trailer Park</span></>}</div>}
      <div className="world-corner">
        <button type="button" onClick={() => setPanel((c) => togglePanel(c, { k: 'deeds' }))} data-testid="world-deeds-btn">🏛 Real estate</button>
        {me && <button type="button" onClick={() => setPanel((c) => togglePanel(c, { k: 'home' }))} data-testid="world-home-btn">🏠 My home</button>}
        {mode === '3d' && !loading && <button type="button" onClick={() => void toggleDrive()} data-testid="world-drive">{driving ? '🅿 Park' : '🚗 Drive'}</button>}
        <button type="button" onClick={() => setMode(mode === '3d' ? '2d' : '3d')} data-testid="world-mode">{mode === '3d' ? '▦ 2D map' : '🌃 3D city'}</button>
      </div>
      {home && me && <div className="world-deed world-deeds" data-testid="world-home" data-drag-panel="home" onPointerDown={dragHome.onPointerDown} style={dragHome.style()} ref={dragHome.ref}>{dragHome.handle}
        <button type="button" className="world-deed-x" onClick={() => setPanel(NONE)} aria-label="Close">✕</button>
        <h3>🏠 My home</h3>
        <small>Your trailer at Chud Acres Trailer Park, plus any property you own. Every home has a kitchen.</small>
        <button type="button" onClick={() => { setPanel(NONE); openKitchen('Your trailer · Chud Acres'); }} data-testid="home-kitchen-trailer">🚐 Your trailer<span>🍳 Kitchen</span></button>
        {[...owned.values()].filter((o) => o.owner.toLowerCase() === me.toLowerCase() && propertyById(o.id)?.kind !== 'landmark').map((o) => <button type="button" key={o.id} onClick={() => { setPanel(NONE); openKitchen(propertyById(o.id)?.label ?? o.id); }} data-testid={`home-kitchen-${o.id}`}>{propertyById(o.id)?.label ?? o.id}<span>🍳 Kitchen</span></button>)}
      </div>}
      {deed && <DeedPanel id={deed} owned={owned} me={me} onKitchen={() => { openKitchen(propertyById(deed)?.label ?? deed); setDeed(null); }} onClose={() => setDeed(null)} onFarm={() => setFarm(deed)} onDone={(ev, text, paid) => {
        setToast(text); window.clearTimeout(toastT.current); toastT.current = window.setTimeout(() => setToast(null), 4000);
        setOwned((m) => { const n = new Map(m); if (ev === 're_buy' && me) n.set(deed, { id: deed, owner: me, price: paid ?? propertyById(deed)?.price ?? 0, arrears: 0, boughtAt: Date.now() }); else n.delete(deed); return n; });
      }} />}
      <CookingHost me={me} />
      <EmploymentHost />
      <CityHallHost />
      {toast && <div className="world-toast" role="status" data-testid="world-toast">{toast}</div>}
      {farm && <FarmGame id={farm} label={propertyById(farm)?.label ?? 'Farm'} onClose={() => setFarm(null)} />}
      {deeds && <DeedList owned={owned} me={me} onOpen={(id) => setDeed(id)} onClose={() => setDeeds(false)} />}
      {driving && <>
        <div className="world-speedo" data-testid="world-speedo">{kmh} <small>km/h</small><em>WASD / arrows · E enter · Esc park{nitro ? ' · Shift/N nitro' : ''}</em>{nitro && <span className={`world-nitro${nitro.on ? ' on' : ''}`} data-testid="world-nitro"><i style={{ width: `${Math.round((nitro.have / nitro.full) * 100)}%` }} /></span>}</div>
        {(lap.t0 != null || lap.text) && <div className="world-lap" data-testid="world-lap">{lap.t0 != null && <b>⏱ {fmtLap(Date.now() - lap.t0)} <small>gate {lap.gate}/3</small></b>}{lap.text && <span>{lap.text}</span>}</div>}
        {nearSpot && <button type="button" className="world-enter" onClick={() => go(nearSpot.id)} data-testid="world-enter">{nearSpot.id === 'airport' ? <>🛫 Fly from the Airport</> : <>{nearSpot.icon} Enter {nearSpot.label}</>} <kbd>E</kbd></button>}
        <div className="world-pad" data-testid="world-pad"><div>{pad('left', '◀')}{pad('right', '▶')}</div><div>{pad('down', '▼')}{nitro && pad('boost', '🔥')}{pad('up', '▲')}</div></div>
      </>}
      {venue && <Suspense fallback={<div className="world-loading">Opening…</div>}><Venues kind={venue} me={me} driving={driving} onClose={() => setVenue(null)} onFly={async (to) => driveRef.current ? driveRef.current.fly(to) : { ok: false, error: 'Switch to the 3D city to fly.' }} onDriveFrom={driveFrom} /></Suspense>}
      {dock && <Suspense fallback={<div className="world-loading">Opening the dock…</div>}><FishingPanel me={me} onClose={() => setDock(false)} /></Suspense>}
      {mechanic && <Suspense fallback={<div className="world-loading">Opening the garage…</div>}><MechanicShop onClose={() => setMechanic(false)} onDrive={(carId, color) => { setMechanic(false); startDrive(carId, color, 'mechanic'); }} /></Suspense>}
      {dealer && <Suspense fallback={<div className="world-loading">Opening the dealership…</div>}><Dealership onClose={() => setDealer(false)} onDrive={startDrive} /></Suspense>}
      {casino && (
        <div className="world-casino" {...backdropDismiss(() => setCasino(false))} data-testid="world-casino">
          <div><h3>🎰 Chud Casino</h3>
            {CASINO_GAMES.map((g) => <button key={g.tab} type="button" onClick={() => { setCasino(false); openTab(g.tab); }} data-testid={`world-casino-${g.tab}`}>{g.label}</button>)}
            <button type="button" className="world-casino-x" onClick={() => setCasino(false)}>Back to the city</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The map the player is on: Chud Hub (city) or Chud Resort (only reachable by plane from the airport). */
function MuCountdown() {
  const now = useNow();
  return <button type="button" className="world-mu-count" data-testid="mu-countdown" onClick={() => window.dispatchEvent(new CustomEvent('open-launch-popup'))}>💰 {mapCountdownLabel(now)}</button>;
}

export function WorldMap(props: { onClose: () => void; onLeaderboard: () => void }) {
  const { loc } = useTrip(); const [flying, setFlying] = useState(false); const prev = useRef(loc);
  useEffect(() => { if (prev.current === loc) return; prev.current = loc; setFlying(true); const t = window.setTimeout(() => setFlying(false), 1600); return () => window.clearTimeout(t); }, [loc]);
  return <>
    {loc === 'resort' ? <Suspense fallback={<div className="world"><div className="world-loading">Landing at Chud Resort…</div></div>}><ResortMap /></Suspense> : <CityMap {...props} />}
    {flying && <div className="resort-flight" data-testid="resort-flight"><div><span>✈️</span><br />{loc === 'resort' ? 'Flying to Chud Resort…' : 'Flying home to Chud Hub…'}</div></div>}
  </>;
}

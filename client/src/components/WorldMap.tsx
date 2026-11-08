import { PropertyIncomeDetails } from './PropertyIncomeDetails';
import { incomeEligible } from '../../../shared/propertyIncome';
import { MapSheet } from './MapSheet';
import { STADIUM_SITE } from '../../../shared/coop';
import { useDoing } from '@/lib/doing';
import { ROYALTY_VENUE, royaltyPct, buyoutPrice, BUYOUT_PROTECT_MS } from '../../../shared/royalty';
import { backdropDismiss } from '@/lib/backdrop';
import { CookingHost, OPEN_GROCERY, openKitchen } from './CookingPanels';
import { openFurnitureStore, enterHome } from './Homes';
import { isHomeProperty } from '../../../shared/homes';
import { myHomeRows } from '../lib/myHome';
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
import { FarmOverview, FarmOverviewButton } from './FarmOverview';
import { barnFarms, isBarnProperty } from '../../../shared/barnFarms';
import { useAccount } from '@/lib/auth';
import { useTrip } from '@/lib/travel';
import { socket } from '@/lib/net';
import { indexed } from '../../../shared/priceIndex';
import { skyNow, parseTod, fmtClock, hex } from '../../../shared/daynight';
import { fmtLap } from '../../../shared/venues';
import { optimisticOwn, taxBasisOf, propertyValue, propertyById as baseProperty, properties as baseProperties, taxOf, sellBackOf, TAX_RATE, GRACE_DAYS, workerBonusOf, WORKER_BONUS_MAX, landPrice, landMultiplierNote, landSurchargePct, SURCHARGE_PCT_PER_1K, type OwnedProperty } from '../../../shared/realEstate';

/** Today's price index from /api/real-estate; list prices and tax scale with it. */
let IDX = 1;
/** Monument royalties earned by each landmark's current owner (from /api/real-estate). */
let ROY: Record<string, number> = {};
const priced = <T extends { price: number }>(p: T): T => ({ ...p, price: indexed(p.price, IDX) });
const propertyById = (id: string) => { const p = baseProperty(id); return p ? priced(p) : undefined; };
const properties = () => baseProperties().map(priced);

const chips = (n: number) => n.toLocaleString('en-US');
type Ack = { ok: boolean; error?: string };

/** Deed panel: list price, owner, daily tax, Buy / Sell back. */
/** 2D map: owned houses as small owner-name tags (Millionaire Update). Collapsed to 6 on phones. */
function OwnedHomes2D({ owned, onPick }: { owned: Map<string, OwnedProperty>; onPick: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const homes = [...owned.values()].filter((o) => isHomeProperty(propertyById(o.id))).sort((a, b) => a.owner.localeCompare(b.owner));
  if (!homes.length) return null;
  const cap = typeof window !== 'undefined' && window.innerWidth < 640 && !all ? 6 : homes.length;
  return <section className="world-owned2d" data-testid="world-owned2d"><h4>🏠 Owned homes</h4>
    <div>{homes.slice(0, cap).map((o) => <button key={o.id} type="button" className="owner-tag" onClick={() => onPick(o.id)} data-testid={`owner-tag-${o.id}`}><b>{o.owner}</b><small>{propertyById(o.id)?.label ?? o.id}</small></button>)}
      {cap < homes.length && <button type="button" className="owner-tag more" onClick={() => setAll(true)}>+{homes.length - cap} more</button>}</div></section>;
}

export function DeedPanel({ id, owned, me, onClose, onFarm, onDone, onKitchen, onAllFarms }: { id: string; owned: Map<string, OwnedProperty>; me: string | null; onClose: () => void; onFarm?: () => void; onAllFarms?: () => void; onKitchen?: () => void; onDone?: (ev: 're_buy' | 're_sell' | 're_buyout', text: string, paid?: number) => void }) {
  useDoing('realestate', propertyById(id)?.label);
  const dragDeed = usePanelDrag('deed');
  const p = propertyById(id); const o = owned.get(id); const [busy, setBusy] = useState<null | 're_buy' | 're_sell' | 're_buyout'>(null); const [msg, setMsg] = useState<string | null>(null); const wallet = useWalletChips(); useEffect(() => setMsg(null), [id]); // Tess QA #5: switching deeds clears the last deed's status
  // Purchase wealth tax: server quote, refreshed per deed. Historical back-tax is canceled.
  const [wtax, setWtax] = useState<{ tax: number; recipients: number; line: string } | null>(null); const [srvOwned, setSrvOwned] = useState<number | null>(null);
  const forSale = !owned.get(id);
  useEffect(() => { setWtax(null); setSrvOwned(null); if (!me || !forSale) return; socket.timeout(10_000).emit('re_quote', { id }, (err: Error | null, r?: Ack & { ownedValue?: number; wealthTax?: { tax: number; recipients: number; line: string } }) => { if (!err && r?.ok && typeof r.ownedValue === 'number') setSrvOwned(r.ownedValue); if (!err && r?.ok && r.wealthTax) setWtax(r.wealthTax); }); }, [id, me, forSale]);
  if (!p) return null;
  const mine = !!(o && me && o.owner.toLowerCase() === me.toLowerCase());
  // pt1388u: you pay list × (1 + 1% per 1,000 of property you own, uncapped); sell-back is 70% of what you paid; tax is on what you paid (Tess QA #8).
  const ownedValue = srvOwned ?? (me ? [...owned.entries()].filter(([, x]) => x.owner.toLowerCase() === me.toLowerCase()).reduce((a, [k, x]) => a + (propertyById(k)?.price ?? x.price ?? 0), 0) : 0);
  const surcharge = +landSurchargePct(ownedValue).toFixed(1);
  const cost = o ? (o.price || p.price) : landPrice(p.price, ownedValue); const note = !o ? landMultiplierNote(ownedValue) : '';
  const tax = !o ? (wtax?.tax ?? 0) : 0; const total = cost + tax;
  const short = wallet != null && wallet < total ? total - wallet : 0;
  // Hostile buyout (monuments): 2x what the owner paid, all to them; protected for 24h after each purchase.
  const bo = o && !mine && p.kind === 'landmark' ? buyoutPrice(o.price || p.price) : 0;
  const protLeft = o ? o.boughtAt + BUYOUT_PROTECT_MS - Date.now() : 0;
  const buyout = () => { if (wallet != null && wallet < bo) { setMsg(`Not enough chips: the buyout costs 🪙 ${chips(bo)}; you have 🪙 ${chips(wallet)}.`); return; } setBusy('re_buyout'); setMsg(null); socket.timeout(15_000).emit('re_buyout', { id, max: bo }, (err: Error | null, r?: Ack & { price?: number }) => { setBusy(null); if (!err && r?.ok) { const text = `🏛 Hostile buyout! ${p.label} is yours. Paid 🪙 ${chips(r.price ?? bo)} to ${o?.owner}.`; setMsg(text); onDone?.('re_buyout', text, r.price ?? bo); return; } setMsg(err ? 'No answer from the server. Try again.' : r?.error ?? 'Something went wrong.'); }); };
  // QA r8: pending state on the button, and on success a toast + immediate (optimistic) ownership update via onDone.
  const act = (ev: 're_buy' | 're_sell') => { setBusy(ev); setMsg(null); socket.timeout(15_000).emit(ev, ev === 're_buy' ? { id, max: cost } : { id }, (err: Error | null, r?: Ack & { price?: number; chips?: number }) => { setBusy(null); if (!err && r?.ok) { const paid = ev === 're_buy' ? (r.price ?? cost) : cost; const wt = Number((r as { wealthTax?: number }).wealthTax ?? 0); const text = ev === 're_buy' ? `🏛 ${p.label} is yours! Paid 🪙 ${chips(paid)}${wt ? ` + 🪙 ${chips(wt)} wealth tax` : ''}.` : `Sold ${p.label} back to the city for 🪙 ${chips(r.chips ?? sellBackOf(cost))}.`; setMsg(text); onDone?.(ev, text, paid); return; } setMsg(err ? 'No answer from the server. Try again.' : (ev === 're_buy' && (r?.error === 'Not enough chips.' || r?.error === 'Something went wrong.') && short ? `Not enough chips: ${p.label} costs 🪙 ${chips(cost)}; you need 🪙 ${chips(short)} more.` : r?.error ?? 'Something went wrong.')); }); };
  return (
    <MapSheet className="world-deed" data-testid="world-deed" data-drag-panel="deed" onPointerDown={dragDeed.onPointerDown} style={dragDeed.style()} ref={dragDeed.ref}>{dragDeed.handle}
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <h3>{p.kind === 'landmark' ? '🏛' : p.kind === 'patch' ? '🌳' : p.kind === 'farm' ? '🌾' : '🏠'} {p.label}</h3>
      {p.kind === 'landmark' && !incomeEligible(p.id) && <small>{ROYALTY_VENUE[p.type] ? 'Monument: stays open to every player, and the owner earns a royalty on what others earn here.' : 'Trophy property: stays open to every player. Ownership is prestige only.'}</small>}
      <dl>
        {o ? <><dt>{mine ? 'You paid' : 'Paid'}</dt><dd data-testid="deed-price">🪙 {chips(cost)}</dd></> : <><dt>Your surcharge</dt><dd data-testid="deed-surcharge">+{surcharge}%</dd><dt>Your price</dt><dd data-testid="deed-price">🪙 {chips(cost)}{note && <small className="block text-amber-300" data-testid="deed-multiplier">List 🪙 {chips(p.price)} · {note}</small>}</dd></>}
        {!o && tax > 0 && <><dt>Wealth tax</dt><dd data-testid="deed-wealth-tax" className="text-amber-300">{wtax!.line}<small className="block">You hold over 🪙 100,000 in property, so 5% is added on top. Total 🪙 {chips(total)}.</small></dd></>}
        <dt>Owner</dt><dd data-testid="deed-owner">{o ? (mine ? 'You' : o.owner) : 'City of Chud Hub (for sale)'}</dd>
        <dt>Sell-back</dt><dd data-testid="deed-sellback">🪙 {chips(sellBackOf(Math.min(cost, o?.basis ?? cost)))} (70% of {o?.basis ? 'what the city was paid' : o ? 'what was paid' : 'your price'})</dd>
        {workerBonusOf(p.id) > 0 && <><dt>Worker cap</dt><dd data-testid="deed-workers">+{workerBonusOf(p.id)} Employment Office worker{workerBonusOf(p.id) > 1 ? 's' : ''} (property bonus max +{WORKER_BONUS_MAX})</dd></>}
        {p.kind === 'landmark' && ROYALTY_VENUE[p.type] && <><dt>Royalty</dt><dd data-testid="deed-royalty">{royaltyPct(p.type)} of {ROYALTY_VENUE[p.type]}, minted to the owner on top (the player keeps 100%). Not paid on the owner's own earnings.{o && <small className="block text-amber-300" data-testid="deed-royalty-income">Royalty income{mine ? '' : ` (${o.owner})`}: 🪙 {chips(ROY[p.id] ?? 0)} since bought</small>}</dd></>}
        <PropertyIncomeDetails id={p.id} cost={cost} cityBasis={o?.basis} />
        {(p.type === 'jail' || p.type === 'harbour') && <><dt>Public service</dt><dd data-testid="deed-public-service">Ownership never restricts jail/law enforcement, harbour travel, shipping or public access. No owner-controlled fees and no passive income.</dd></>}
        <dt>Property tax</dt><dd data-testid="deed-tax">🪙 {chips(taxOf(taxBasisOf(cost, p.price)))}/day ({(TAX_RATE * 100).toFixed(1)}%)</dd>
        {o && o.arrears > 0 && <><dt>Arrears</dt><dd className="text-rose-300">{o.arrears} unpaid day{o.arrears > 1 ? 's' : ''} (repossessed at {GRACE_DAYS})</dd></>}
      </dl>
      {!o && p.retired && <small data-testid="deed-retired">Not for sale: a civic building stands here.</small>}
      {!o && !p.retired && (me ? <button type="button" disabled={!!busy} aria-busy={busy === 're_buy'} onClick={() => (short ? setMsg(`Not enough chips: ${p.label} costs 🪙 ${chips(total)}; you have 🪙 ${chips(wallet ?? 0)} (need 🪙 ${chips(short)} more).`) : act('re_buy'))} aria-describedby={short ? 'deed-short' : undefined} data-testid="deed-buy">{busy === 're_buy' ? <><span className="world-spin" aria-hidden /> Buying…</> : <>Buy for 🪙 {chips(total)}{me ? ` (+${surcharge}% surcharge${tax ? ' + 5% wealth tax' : ''})` : ''}</>}</button> : <small>Sign in to buy.</small>)}
      {mine && <button type="button" disabled={!!busy} aria-busy={busy === 're_sell'} onClick={() => act('re_sell')} data-testid="deed-sell">{busy === 're_sell' ? <><span className="world-spin" aria-hidden /> Selling…</> : <>Sell to the city for 🪙 {chips(sellBackOf(Math.min(cost, o?.basis ?? cost)))} (70%)</>}</button>}
      {bo > 0 && me && <button type="button" disabled={!!busy || protLeft > 0} aria-busy={busy === 're_buyout'} onClick={buyout} data-testid="deed-buyout" title={protLeft > 0 ? 'Protected after a purchase' : `Pays ${o?.owner} 2x what they paid`}>{busy === 're_buyout' ? <><span className="world-spin" aria-hidden /> Buying out…</> : protLeft > 0 ? <>🛡 Hostile buyout: 🪙 {chips(bo)} (protected {Math.ceil(protLeft / 3_600_000)}h)</> : <>⚔️ Hostile buyout: 🪙 {chips(bo)}</>}</button>}
      {mine && onKitchen && p.kind !== 'landmark' && p.type !== 'barn' && <button type="button" onClick={onKitchen} data-testid="deed-kitchen">🍳 Kitchen</button>}
      {o && isHomeProperty(p) && <button type="button" onClick={() => { enterHome(p.id); onClose(); }} data-testid="deed-enter">{mine ? '🛋️ Enter & decorate' : `🚪 Visit ${o.owner}'s home`}</button>}
      {p.kind === 'farm' && o && onFarm && <button type="button" onClick={onFarm} data-testid="deed-farm">{mine ? '🌾 Open farm' : '👀 Visit farm'}</button>}
      {isBarnProperty(id) && <small>This barn is sold separately from every farm. Owning this barn unlocks All my farms; it does not buy or transfer nearby farmland.</small>}
      {mine && isBarnProperty(id) && onAllFarms && <button type="button" onClick={onAllFarms} data-testid="deed-barn">🏡 Barn · All my farms</button>}
      {p.kind === 'farm' && !o && <small>Farmland: buy it to plant crops (FarmVille-style, real-time).</small>}
      {!o && me && short > 0 && !msg && <small id="deed-short" className="text-amber-300" data-testid="deed-short">You need 🪙 {chips(short)} more chips to buy this.</small>}
      {msg && <small role="status" data-testid="deed-msg">{msg}</small>}
      <small className="opacity-60">You can sell any property back to the city at any time for 70% of what you paid. Surcharge: +{SURCHARGE_PCT_PER_1K}% on your next purchase for every 🪙 1,000 of property you already own, no cap (Trailer Park lots don't count). Tax is on the list price, charged once per UTC day and burned. {GRACE_DAYS} unpaid days in a row and the city takes it back (no refund).</small>
    </MapSheet>
  );
}

/** Landmark deeds + the signed-in player's properties. */
function DeedList({ owned, me, onOpen, onClose }: { owned: Map<string, OwnedProperty>; me: string | null; onOpen: (id: string) => void; onClose: () => void }) {
  useDoing('realestate');
  const dragDeeds = usePanelDrag('deeds');
  const mine = me ? [...owned.values()].filter((o) => o.owner.toLowerCase() === me.toLowerCase()) : [];
  const lms = properties().filter((p) => p.kind === 'landmark').sort((a, b) => b.price - a.price);
  const value = mine.reduce((a, o) => a + propertyValue(o.price, propertyById(o.id)?.price ?? 0), 0); // price paid, same helper as the server
  return (
    <MapSheet className="world-deed world-deeds" data-testid="world-deeds" data-drag-panel="deeds" onPointerDown={dragDeeds.onPointerDown} style={dragDeeds.style()} ref={dragDeeds.ref}>{dragDeeds.handle}
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <h3>🏛 Real estate</h3>
      <small>Click any building, lot, park or plaza on the map to see its deed. The Trailer Park stays free.</small>
      <h4>My properties{mine.length ? ` · 🪙 ${chips(value)} · tax 🪙 ${chips(mine.reduce((a, o) => a + taxOf(taxBasisOf(o.price, propertyById(o.id)?.price ?? 0)), 0))}/day` : ''}</h4>
      {mine.length ? mine.map((o) => <button type="button" key={o.id} onClick={() => onOpen(o.id)}>{propertyById(o.id)?.label ?? o.id}<span title="What you paid (property tax is on this)" data-testid={`myprop-paid-${o.id}`}>🪙 {chips(o.price || (propertyById(o.id)?.price ?? 0))}</span></button>) : <small>{me ? 'None yet.' : 'Sign in to buy property.'}</small>}
      <h4>🏡 Barns (sold separately from farms)</h4>
      {properties().filter((p) => p.type === 'barn').map((p) => <button type="button" key={p.id} onClick={() => onOpen(p.id)} data-testid={`deed-${p.id}`}>{p.label}<span>{owned.get(p.id) ? owned.get(p.id)!.owner : `🪙 ${chips(p.price)}`}</span></button>)}
      <h4>🌾 Farmland (east of the city)</h4>
      {properties().filter((p) => p.kind === 'farm' && p.map !== 'resort').map((p) => <button type="button" key={p.id} onClick={() => onOpen(p.id)} data-testid={`deed-${p.id}`}>{p.label}<span>{owned.get(p.id) ? owned.get(p.id)!.owner : `🪙 ${chips(p.price)}`}</span></button>)}
      <h4>Landmarks (trophy deeds)</h4>
      {lms.map((p) => <button type="button" key={p.id} onClick={() => onOpen(p.id)} data-testid={`deed-${p.id}`}>{p.label}<span>{owned.get(p.id) ? owned.get(p.id)!.owner : `🪙 ${chips(p.price)}`}</span></button>)}
    </MapSheet>
  );
}

import { request } from '@/lib/net';
import type { Drive, DriveInput } from '@/lib/worldDrive';
import { usePanelDrag } from '@/lib/panelDrag';
const Venues = lazyWithReload(() => import('./Venues').then((m) => ({ default: m.Venues })));
const FishingPanel = lazyWithReload(() => import('./FishingPanel').then((m) => ({ default: m.FishingPanel })));
const Dealership = lazyWithReload(() => import('./Dealership').then((m) => ({ default: m.Dealership })));
const MechanicShop = lazyWithReload(() => import('./MechanicShop').then((m) => ({ default: m.MechanicShop })));
import { WeeklyEventBar } from './WeeklyEventBar';
const CoopPanel = lazyWithReload(() => import('./CoopPanel').then((m) => ({ default: m.CoopPanel })));
const FreightYard = lazyWithReload(() => import('./FreightYard').then((m) => ({ default: m.FreightYard })));
const ResortMap = lazyWithReload(() => import('./ResortMap').then((m) => ({ default: m.ResortMap })));
const FortMcMap = lazyWithReload(() => import('./FortMcMap').then((m) => ({ default: m.FortMcMap })));

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
  // #32: farm plots are tiny 3D tiles and don't exist on the 2D map, so on phones there was no reliable way in. Owned farms get a direct button.
  const myFarms = me ? [...owned.values()].filter((o) => (o.id.startsWith('f:') || o.id.startsWith('cf:')) && o.owner.toLowerCase() === me.toLowerCase()).map((o) => o.id) : [];
  const hasBarn = barnFarms(me, owned.values()).unlocked;
  const openAllFarms = () => setPanel({ k: 'farms' });
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
    const load = () => { void fetch('/api/real-estate').then((r) => r.json()).then((d: { owned?: OwnedProperty[]; index?: number; royalties?: Record<string, number> }) => { if (typeof d.index === 'number' && d.index > 0) IDX = d.index; ROY = d.royalties ?? {}; if (!dead) setOwned(new Map((d.owned ?? []).map((o) => [o.id, o]))); }).catch(() => {}); };
    load(); socket.on('re_changed', load);
    return () => { dead = true; socket.off('re_changed', load); };
  }, []);
  useEffect(() => { worldRef.current?.setOwned([...owned.keys()]); worldRef.current?.setOwnerLabels([...owned.values()].filter((o) => isHomeProperty(propertyById(o.id))).map((o) => ({ id: o.id, owner: o.owner }))); }, [owned, loading]);
  const freight = panel.k === 'freight'; const setFreight = (v: boolean) => setPanel((c) => (v ? { k: 'freight' } : closePanel(c, 'freight')));
  const dealer = panel.k === 'dealer'; const setDealer = (v: boolean) => setPanel((c) => (v ? { k: 'dealer' } : closePanel(c, 'dealer')));
  const mechanic = panel.k === 'mechanic'; const setMechanic = (v: boolean) => setPanel((c) => (v ? { k: 'mechanic' } : closePanel(c, 'mechanic')));
  const [nitro, setNitro] = useState<{ have: number; full: number; on: boolean } | null>(null);
  const dock = panel.k === 'dock'; const setDock = (v: boolean) => setPanel((c) => (v ? { k: 'dock' } : closePanel(c, 'dock')));
  const driveRef = useRef<Drive | null>(null); const freightRef = useRef<{ dispose: () => void } | null>(null); const stadiumRef = useRef<{ dispose: () => void; refresh: () => void } | null>(null);
  const pendingDrive = useRef<{ carId: string; color: number; from?: string } | null>(null); const startDriveRef = useRef<(carId: string, color: number, from?: string) => void>(() => {});
  const [driving, setDriving] = useState(false); const [near, setNear] = useState<string | null>(null); const [drift, setDrift] = useState(false);
  const [kmh, setKmh] = useState(0);
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
  // Dev-only QA hook (screenshots / manual testing); stripped from production builds.
  if (import.meta.env.DEV) (window as unknown as { __driveQA?: unknown }).__driveQA = { start: (c: string, col = 0xd8202a) => startDrive(c, col, 'grid'), key: (k: keyof DriveInput, on: boolean) => driveRef.current?.touch(k, on) };
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
      case 'warehouse': window.dispatchEvent(new Event('open-resource-inventory')); break; // Chud City Warehouse: stored goods, Sell to house / Sell on Market (skins: 🎒 button there)
      case 'market': if (openTab('market-tab')) break; window.dispatchEvent(new CustomEvent('open-inventory', { detail: { tab: 'market' } })); break;
      case 'bank': openTab('wallet-button'); break;
      case 'stocks': openTab('stocks-tab'); break;
      case 'chat': openTab('chat-tab'); break;
      case 'leaderboard': onLeaderboard(); break;
      case 'dealer': setDealer(true); return;
      case 'mechanic': setMechanic(true); return;
      case 'dock': setDock(true); return;
      case 'grocery': window.dispatchEvent(new Event(OPEN_GROCERY)); return;
      case 'furniture': openFurnitureStore(); return;
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
          onBarn: (id) => { const o = ownedRef.current.get(id); const m = meRef.current; if (o && m && o.owner.toLowerCase() === m.toLowerCase()) setPanel({ k: 'farms' }); else setDeed(id); },
          onProperty: (id) => { const o = ownedRef.current.get(id); const m = meRef.current;
            if ((id.startsWith('f:') || id.startsWith('cf:')) && o && m && o.owner.toLowerCase() === m.toLowerCase()) setFarm(id); else setDeed(id); },
          onTrailer: (n) => { const m = meRef.current; if (m && n.toLowerCase() === m.toLowerCase()) { setPanel({ k: 'home' }); return true; } return false; },
        });
        const w = worldRef.current;
        void importWithReload(() => import('@/lib/worldFreight')).then(({ createFreight }) => { if (dead || worldRef.current !== w) return; freightRef.current = createFreight(w); });
        void importWithReload(() => import('@/lib/worldStadium')).then(({ createStadium }) => { if (dead || worldRef.current !== w) return; stadiumRef.current = createStadium(w); });
        void importWithReload(() => import('@/lib/worldDrive')).then(({ createDrive }) => { if (dead || worldRef.current !== w) return;
          driveRef.current = createDrive(w, { me: () => meRef.current ?? null, onNear: setNear, onSpeed: setKmh, onRace, onNitro: setNitro, onDrift: setDrift });
          const pd = pendingDrive.current; pendingDrive.current = null; if (pd) startDriveRef.current(pd.carId, pd.color, pd.from); });
      } catch { setMode('2d'); }
      setLoading(false);
    }).catch(() => setMode('2d'));
    return () => { dead = true; stadiumRef.current?.dispose(); stadiumRef.current = null; freightRef.current?.dispose(); freightRef.current = null; driveRef.current?.dispose(); driveRef.current = null; setDriving(false); worldRef.current?.dispose(); worldRef.current = null; };
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
    <div className={panel.k !== 'none' ? 'world world-modal-open' : 'world'} data-testid="world-map" data-tod={sky.phase} style={{ background: `radial-gradient(120% 90% at 50% 0%, ${hex(sky.horizon)}, ${hex(sky.sky)} 70%)`, ['--glow' as string]: String(0.25 + 0.75 * sky.lights) }}>
      {mode === '3d' ? <canvas ref={canvasRef} className="world-canvas" data-testid="world-canvas" /> : (
        <div className="world-grid" data-testid="world-grid">
          {WORLD_SPOTS.map((s) => (
            <button key={s.id} type="button" className="world-tile" style={{ ['--c' as string]: '#' + s.color.toString(16).padStart(6, '0') }} onClick={() => go(s.id)} data-testid={`world-tile-${s.id}`}>
              <span className="world-tile-icon">{s.icon}</span><b>{s.label}</b><small>{s.blurb}</small>
            </button>
          ))}
          <button type="button" className="world-tile" style={{ ['--c' as string]: '#c9a24a' }} onClick={() => setDeeds(true)} data-testid="world-tile-bigfarms">
            <span className="world-tile-icon">🚜</span><b>Big Farms</b><small>8 big farms east of the east road (20×20 to 30×30)</small>
          </button>
          <OwnedHomes2D owned={owned} onPick={(id) => setDeed(id)} />
        </div>
      )}
      <div className="world-clock" data-testid="world-clock" title={`Alberta time · sunrise ${fmtClock(sky.sunrise)} · sunset ${fmtClock(sky.sunset)}`}><span>{sky.icon}</span><b>{fmtClock(sky.minutes)}</b><small>AB · {sky.label}</small></div>
      <div className="world-title"><span>CHUD</span> HUB</div>
      {loading && mode === '3d' && <div className="world-loading">Building the city…</div>}
      {spot && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#' + spot.color.toString(16).padStart(6, '0') }} data-testid="world-tip"><b>{spot.icon} {spot.label}</b><span>{spot.blurb}</span>{ownerLine && <span className="world-tip-owner">🏛 {ownerLine}</span>}<em>Click to enter</em></div>}
      {!spot && tipProp && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#c9a24a' }} data-testid="world-tip"><b>{tipProp.label}</b><span>{ownerLine}</span><em>Click for the deed</em></div>}
      {trailer && tip && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#ffb36b' }} data-testid="world-tip">{me && trailer.toLowerCase() === me.toLowerCase() ? <b>🏠 Your trailer</b> : <><b>🏠 {trailer}'s trailer</b><span>Chud Acres Trailer Park</span></>}</div>}
      <div className="world-corner">
        <button type="button" onClick={() => setPanel((c) => togglePanel(c, { k: 'deeds' }))} data-testid="world-deeds-btn">🏛 Real estate</button>
        {me && <button type="button" onClick={() => setPanel((c) => togglePanel(c, { k: 'home' }))} data-testid="world-home-btn">🏠 My home</button>}
        <FarmOverviewButton me={me} owned={owned} onOpen={openAllFarms} />
        {myFarms.length > 0 && <button type="button" onClick={() => setFarm(myFarms[0])} data-testid="world-farm-btn">🌾 My farm{myFarms.length > 1 ? 's' : ''}</button>}
        {mode === '3d' && !loading && <button type="button" onClick={() => void toggleDrive()} data-testid="world-drive">{driving ? '🅿 Park' : '🚗 Drive'}</button>}
        <button type="button" onClick={() => setPanel((c) => togglePanel(c, { k: 'freight' }))} data-testid="world-freight-btn">📦 Logistics</button>
        <button type="button" onClick={() => setPanel((c) => togglePanel(c, { k: 'coop' }))} data-testid="world-coop-btn">🏟️ Co-op</button>
        <button type="button" onClick={() => setMode(mode === '3d' ? '2d' : '3d')} data-testid="world-mode">{mode === '3d' ? '▦ 2D map' : '🌃 3D city'}</button>
      </div>
      {home && me && <MapSheet className="world-deed world-deeds" data-testid="world-home" data-drag-panel="home" onPointerDown={dragHome.onPointerDown} style={dragHome.style()} ref={dragHome.ref}>{dragHome.handle}
        <button type="button" className="world-deed-x" onClick={() => setPanel(NONE)} aria-label="Close">✕</button>
        <h3>🏠 My home</h3>
        <small>Your trailer at Chud Acres Trailer Park, plus any property you own. Every home has a kitchen.</small>
        <button type="button" onClick={() => { setPanel(NONE); openKitchen('Your trailer · Chud Acres', 'trailer'); }} data-testid="home-kitchen-trailer">🚐 Your trailer<span>🍳 Kitchen</span></button>
        {(() => { const r = myHomeRows(owned.values(), me, propertyById); const L = (id: string) => propertyById(id)?.label ?? id; return <>
          {r.homes.map((id) => <button type="button" key={'in-' + id} onClick={() => { setPanel(NONE); enterHome(id); }} data-testid={`home-enter-${id}`}>{L(id)}<span>🛋️ Enter & decorate</span></button>)}
          {r.homes.map((id) => <button type="button" key={id} onClick={() => { setPanel(NONE); openKitchen(L(id), id); }} data-testid={`home-kitchen-${id}`}>{L(id)}<span>🍳 Kitchen</span></button>)}
          {r.homes.length === 0 && <small data-testid="home-none">You don't own a house yet, so there's nothing to enter. Buy one on the map to enter and decorate it.</small>}
          {r.kitchens.map((id) => <button type="button" key={id} onClick={() => { setPanel(NONE); openKitchen(L(id), id); }} data-testid={`home-kitchen-${id}`}>{L(id)}<span>🍳 Kitchen</span></button>)}
          {r.farms.map((id) => <button type="button" key={'farm-' + id} onClick={() => setFarm(id)} data-testid={`home-farm-${id}`}>{L(id)}<span>🌾 Open farm</span></button>)}
          {r.businesses.map((id) => <button type="button" key={'biz-' + id} onClick={() => { setPanel(NONE); setDeed(id); }} data-testid={`home-biz-${id}`}>{L(id)}<span>🏢 Your business</span></button>)}
          <h4>Shops</h4>
          <button type="button" onClick={() => { setPanel(NONE); openFurnitureStore(); }} data-testid="home-furniture-store">🛋️ Furniture Store<span>Shop</span></button>
        </>; })()}
      </MapSheet>}
      {panel.k === 'farms' && <FarmOverview me={me} owned={owned} map="city" onOpenFarm={setFarm} onClose={() => setPanel((c) => closePanel(c, 'farms'))} />}
      {deed && <DeedPanel onAllFarms={hasBarn ? openAllFarms : undefined} id={deed} owned={owned} me={me} onKitchen={() => { openKitchen(propertyById(deed)?.label ?? deed, deed); setDeed(null); }} onClose={() => setDeed(null)} onFarm={() => setFarm(deed)} onDone={(ev, text, paid) => {
        setToast(text); window.clearTimeout(toastT.current); toastT.current = window.setTimeout(() => setToast(null), 4000);
        setOwned((m) => { const n = new Map(m); if ((ev === 're_buy' || ev === 're_buyout') && me) n.set(deed, optimisticOwn(m.get(deed), ev, deed, me, paid ?? propertyById(deed)?.price ?? 0, Date.now())); else n.delete(deed); return n; });
      }} />}
      <CookingHost me={me} />
      <EmploymentHost />
      <CityHallHost />
      {toast && <div className="world-toast" role="status" data-testid="world-toast">{toast}</div>}
      {farm && <FarmGame onAllFarms={hasBarn ? openAllFarms : undefined} id={farm} label={propertyById(farm)?.label ?? 'Farm'} onClose={() => setFarm(null)} />}
      {deeds && <DeedList owned={owned} me={me} onOpen={(id) => setDeed(id)} onClose={() => setDeeds(false)} />}
      {driving && <>
        <div className="world-speedo" data-testid="world-speedo">{kmh} <small>km/h</small><em>WASD / arrows · E enter · Esc park · Space handbrake{nitro ? ' · Shift/N nitro' : ''}</em>{drift && <b className="world-drift" data-testid="world-drift">DRIFT</b>}{nitro && <span className={`world-nitro${nitro.on ? ' on' : ''}`} data-testid="world-nitro"><i style={{ width: `${Math.round((nitro.have / nitro.full) * 100)}%` }} /></span>}</div>
        {(lap.t0 != null || lap.text) && <div className="world-lap" data-testid="world-lap">{lap.t0 != null && <b>⏱ {fmtLap(Date.now() - lap.t0)} <small>gate {lap.gate}/3</small></b>}{lap.text && <span>{lap.text}</span>}</div>}
        {nearSpot && <button type="button" className="world-enter" onClick={() => go(nearSpot.id)} data-testid="world-enter">{nearSpot.id === 'airport' ? <>🛫 Fly from the Airport</> : <>{nearSpot.icon} Enter {nearSpot.label}</>} <kbd>E</kbd></button>}
        <div className="world-pad" data-testid="world-pad"><div>{pad('left', '◀')}{pad('right', '▶')}</div><div>{pad('down', '▼')}{pad('handbrake', 'HB')}{nitro && pad('boost', '🔥')}{pad('up', '▲')}</div></div>
      </>}
      {venue && <Suspense fallback={<div className="world-loading">Opening…</div>}><Venues kind={venue} me={me} driving={driving} onClose={() => setVenue(null)} onFly={async (to) => driveRef.current ? driveRef.current.fly(to) : { ok: false, error: 'Switch to the 3D city to fly.' }} onDriveFrom={driveFrom} /></Suspense>}
      {dock && <Suspense fallback={<div className="world-loading">Opening the dock…</div>}><FishingPanel me={me} onClose={() => setDock(false)} /></Suspense>}
      {mechanic && <Suspense fallback={<div className="world-loading">Opening the garage…</div>}><MechanicShop onClose={() => setMechanic(false)} onDrive={(carId, color) => { setMechanic(false); startDrive(carId, color, 'mechanic'); }} /></Suspense>}
      {panel.k !== 'coop' && <WeeklyEventBar onOpen={() => setPanel((c) => togglePanel(c, { k: 'coop', tab: 'event' }))} />}
      {panel.k === 'coop' && <Suspense fallback={<div className="world-loading">Opening the co-op board…</div>}><CoopPanel me={me} tab0={panel.tab} onClose={() => setPanel((c) => closePanel(c, 'coop'))} onChanged={() => stadiumRef.current?.refresh()} onViewSite={() => { setPanel((c) => closePanel(c, 'coop')); worldRef.current?.focusXZ(STADIUM_SITE.x, STADIUM_SITE.z, 46, 38); }} /></Suspense>}
      {freight && <Suspense fallback={<div className="world-loading">Opening the freight yard…</div>}><FreightYard me={me} onClose={() => setFreight(false)} /></Suspense>}
      {dealer && <Suspense fallback={<div className="world-loading">Opening the dealership…</div>}><Dealership onClose={() => setDealer(false)} onDrive={startDrive} /></Suspense>}
      {casino && (
        <div className="world-casino" {...backdropDismiss(() => setCasino(false))} data-testid="world-casino">
          <MapSheet><h3>🎰 Chud Casino</h3>
            {CASINO_GAMES.map((g) => <button key={g.tab} type="button" onClick={() => { setCasino(false); openTab(g.tab); }} data-testid={`world-casino-${g.tab}`}>{g.label}</button>)}
            <button type="button" className="world-casino-x" onClick={() => setCasino(false)}>Back to the city</button>
          </MapSheet>
        </div>
      )}
    </div>
  );
}

/** The map the player is on: Chud Hub (city) or Chud Resort (only reachable by plane from the airport). */
export function WorldMap(props: { onClose: () => void; onLeaderboard: () => void }) {
  const { loc } = useTrip(); const [flying, setFlying] = useState(false); const prev = useRef(loc);
  useEffect(() => { if (prev.current === loc) return; prev.current = loc; setFlying(true); const t = window.setTimeout(() => setFlying(false), 1600); return () => window.clearTimeout(t); }, [loc]);
  return <>
    {loc === 'resort' ? <Suspense fallback={<div className="world"><div className="world-loading">Landing at Chud Resort…</div></div>}><ResortMap /></Suspense>
      : loc === 'fortmc' ? <Suspense fallback={<div className="world"><div className="world-loading">Landing at Fort McChud…</div></div>}><FortMcMap /></Suspense>
      : <CityMap {...props} />}
    {flying && <div className="resort-flight" data-testid="resort-flight"><div><span>✈️</span><br />{loc === 'resort' ? 'Flying to Chud Resort…' : loc === 'fortmc' ? 'Flying to Fort McChud…' : 'Flying home to Chud Hub…'}</div></div>}
  </>;
}

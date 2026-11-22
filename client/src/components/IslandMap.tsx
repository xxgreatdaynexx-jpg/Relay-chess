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
import { CHEST_PAY, DIG_PER_DAY, DIVE_FINDS, DIVE_PER_DAY, ISLAND_HELI, ISLAND_HUNT, ISLAND_SNORKEL, TOUR_MS, TOUR_PAY, TREASURE_SPOTS, TRINKET_PAY } from '../../../shared/islandActivities';

const fmt = (n: number) => n.toLocaleString('en-US');
const MODE_KEY = 'chud-world-mode'; // shared with the city and Fort McChud maps
type Panel = { k: 'estates' } | { k: 'deed'; id: string } | { k: 'dock' } | { k: 'lagoon' } | { k: 'lounge' } | { k: 'reef' } | { k: 'hunt'; spot?: number } | { k: 'heli' } | null;
const ACTS = { reef: ISLAND_SNORKEL, hunt: ISLAND_HUNT, heli: ISLAND_HELI } as const;
export type IslandActState = { here: boolean; dives: { used: number; max: number; finds: Array<{ id: string; label: string; emoji: string; pay: number }>; readyIn: number }; hunt: { used: number; max: number; dug: number[]; found: number | null }; tour: { claimed: boolean; pay: number; running: boolean }; pay: { chest: number; trinket: number } };

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
  const [acts, setActs] = useState<IslandActState | null>(null);
  const reloadActs = useCallback(() => void request('isl_act_state').then((a) => { const r = a as { ok: boolean } & Partial<IslandActState>; if (r.ok && r.dives) setActs(r as IslandActState); }), []);
  useEffect(() => { reloadActs(); }, [reloadActs, me]);
  useEffect(() => { if (acts) worldRef.current?.setHunt(acts.hunt.dug, acts.hunt.found); }, [acts, loading]);
  const [flying, setFlying] = useState<number | null>(null);
  const takeOff = async () => {
    const r = await request('isl_tour_start') as { ok: boolean; ms?: number; bonus?: boolean; error?: string };
    if (!r.ok) { setMsg(r.error ?? 'The helicopter is grounded.'); return; }
    const ms = r.ms ?? TOUR_MS; setPanel(null); setMsg(null); const t0 = Date.now(); setFlying(ms);
    const tick = setInterval(() => setFlying(Math.max(0, ms - (Date.now() - t0))), 500);
    const w = worldRef.current; await (w ? w.tour(ms) : new Promise((res) => setTimeout(res, ms)));
    await new Promise((res) => setTimeout(res, Math.max(0, ms - (Date.now() - t0)) + 300));
    clearInterval(tick); setFlying(null);
    const c = await request('isl_tour_claim') as { ok: boolean; paid?: number; error?: string };
    setPanel({ k: 'heli' }); setMsg(!c.ok ? c.error ?? 'Landed.' : c.paid ? `🚁 Landed. Postcard bonus 🪙 ${fmt(c.paid)}.` : '🚁 Landed. Today\'s postcard bonus is already collected; tours are free.'); reloadActs();
  };
  const pick = useCallback((id: string) => {
    if (id === ISLAND_DOCK.id) setPanel({ k: 'dock' });
    else if (id === ISLAND_LAGOON.id) setPanel({ k: 'lagoon' });
    else if (id === ISLAND_LOUNGE.id) setPanel({ k: 'lounge' });
    else if (id === ISLAND_SNORKEL.id) setPanel({ k: 'reef' });
    else if (id === ISLAND_HELI.id) setPanel({ k: 'heli' });
    else if (id === ISLAND_HUNT.id) setPanel({ k: 'hunt' });
    else if (id.startsWith(`${ISLAND_HUNT.id}:`)) setPanel({ k: 'hunt', spot: Number(id.slice(ISLAND_HUNT.id.length + 1)) || undefined });
    else if (id.startsWith('isl:')) setPanel({ k: 'deed', id });
  }, []);
  useEffect(() => { worldRef.current?.setOwners(owners, me); }, [owners, me, loading]);
  useEffect(() => { worldRef.current?.setRunning(!fishing); }, [fishing]);
  useEffect(() => { if (!import.meta.env.DEV) return; (window as unknown as { __islandQA?: unknown }).__islandQA = { pick, view: (x: number, z: number, dx?: number, dy?: number, dz?: number) => worldRef.current?.view(x, z, dx, dy, dz), close: () => setPanel(null), fish: () => setFishing(true), tour: () => void takeOff() }; }); // dev-only QA hook (like __resortQA)
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
  const selected = panel?.k === 'deed' ? panel.id : panel?.k === 'dock' ? ISLAND_DOCK.id : panel?.k === 'lagoon' ? ISLAND_LAGOON.id : panel?.k === 'lounge' ? ISLAND_LOUNGE.id : panel && (panel.k === 'reef' || panel.k === 'hunt' || panel.k === 'heli') ? ACTS[panel.k].id : null;
  const tipSpot = tip ? islandSpots().find((s) => s.id === tip.id) : undefined; const tipOwner = tipSpot ? owners.get(tipSpot.id) : undefined;
  const tipAct = tip && !tipSpot ? Object.values(ACTS).find((a) => a.id === tip.id) ?? (tip.id.startsWith(`${ISLAND_HUNT.id}:`) ? { ...ISLAND_HUNT, label: `X mark ${tip.id.slice(ISLAND_HUNT.id.length + 1)}`, blurb: acts?.hunt.dug.includes(Number(tip.id.slice(ISLAND_HUNT.id.length + 1))) ? 'Already dug today.' : 'Dig here for today\'s chest.' } : undefined) : undefined;
  return (
    <div className="world island" data-testid="island-map">
      {mode === '3d' ? <canvas ref={canvasRef} className="world-canvas" data-testid="island-canvas" /> : <IslandFlatMap owners={owners} me={me} selected={selected} onPick={pick} dug={acts?.hunt.dug} />}
      <div className="world-title"><span>PRIVATE</span> ISLAND<small>tap an estate, the dock, the lagoon, the lounge or an activity</small></div>
      {tipSpot && tip && mode === '3d' && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#f2d48a' }} data-testid="island-tip"><b>{tipSpot.icon} {tipSpot.label}</b><span>{tipSpot.kind === 'estate' ? (tipOwner ? `Owned by ${tipOwner}` : `For sale · 🪙 ${fmt(tipSpot.price ?? 0)}`) : tipSpot.kind === 'dock' ? ISLAND_DOCK.blurb : tipSpot.kind === 'lagoon' ? ISLAND_LAGOON.blurb : ISLAND_LOUNGE.blurb}</span><em>Click to open</em></div>}
      {tipAct && tip && mode === '3d' && <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 14, ['--c' as string]: '#7fe8ff' }} data-testid="island-tip"><b>{tipAct.icon} {tipAct.label}</b><span>{tipAct.blurb}</span><em>Click to open</em></div>}
      {flying != null && <div className="island-flying" role="status" data-testid="island-flying">🚁 Island tour · landing in {Math.ceil(flying / 1000)}s</div>}
      {mode === '2d' && mapError && <div className="island-map-notice" role="status">3D graphics unavailable. Showing the 2D map.</div>}
      {loading && <div className="world-loading">Landing on the Private Island…</div>}
      <div className="world-corner island-map-controls">
        <button type="button" data-testid="island-map-mode" onClick={() => { setMapError(false); setMode(mode === '3d' ? '2d' : '3d'); }}>{mode === '3d' ? '▦ 2D map' : '🏝️ 3D island'}</button>
        <button type="button" data-testid="island-estates-btn" onClick={() => setPanel({ k: 'estates' })}>🏝️ Estates</button>
        <button type="button" data-testid="island-dock-btn" onClick={() => setPanel({ k: 'dock' })}>⚓ Dock</button>
        <button type="button" data-testid="island-lagoon-btn" onClick={() => { setPanel({ k: 'lagoon' }); worldRef.current?.focusXZ(ISLAND_LAGOON.x, ISLAND_LAGOON.z); }}>🎣 Lagoon</button>
        <button type="button" data-testid="island-lounge-btn" onClick={() => { setPanel({ k: 'lounge' }); worldRef.current?.focusXZ(ISLAND_LOUNGE.x, ISLAND_LOUNGE.z); }}>🍹 Lounge</button>
        <button type="button" data-testid="island-reef-btn" onClick={() => { setPanel({ k: 'reef' }); worldRef.current?.focusXZ(ISLAND_SNORKEL.x, ISLAND_SNORKEL.z); }}>🤿 Reef</button>
        <button type="button" data-testid="island-hunt-btn" onClick={() => { setPanel({ k: 'hunt' }); worldRef.current?.focusXZ(ISLAND_HUNT.x, ISLAND_HUNT.z); }}>🗺️ Treasure</button>
        <button type="button" data-testid="island-heli-btn" onClick={() => { setPanel({ k: 'heli' }); worldRef.current?.focusXZ(ISLAND_HELI.x, ISLAND_HELI.z); }}>🚁 Heli tour</button>
        <button type="button" onClick={() => void home()} data-testid="island-fly-home">{homeLabel}</button>
      </div>
      {msg && !panel && <small className="island-map-msg" role="status">{msg}</small>}
      {panel && (
        <MapSheet className="world-deed island-panel" data-testid="island-sheet">
          <h3>{panel.k === 'dock' ? `${ISLAND_DOCK.icon} ${ISLAND_DOCK.label}` : panel.k === 'lagoon' ? `${ISLAND_LAGOON.icon} ${ISLAND_LAGOON.label}` : panel.k === 'lounge' ? `${ISLAND_LOUNGE.icon} ${ISLAND_LOUNGE.label}` : panel.k === 'reef' || panel.k === 'hunt' || panel.k === 'heli' ? `${ACTS[panel.k].icon} ${ACTS[panel.k].label}` : panel.k === 'deed' ? `🏝️ ${ISLAND_LOTS.find((l) => l.id === panel.id)?.label ?? 'Estate'}` : '🏝️ Private Island'}</h3>
          <button type="button" className="world-deed-x" onClick={() => setPanel(null)} aria-label="Close" data-testid="island-sheet-x">✕</button>
          {panel.k === 'estates' && <>
            <p>Reached by Sovereign Megayacht or a private jet. Four estates sit on the ridge; the dock sails you home for free. Island-only: fish the Pearl Lagoon, snorkel the reef, dig for buried treasure, take a helicopter tour, and estate owners collect a daily retreat at the Sunset Lounge.</p>
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
          {panel.k === 'reef' && <ReefPanel acts={acts} onChanged={reloadActs} />}
          {panel.k === 'hunt' && <HuntPanel acts={acts} spot={panel.spot} onChanged={reloadActs} onFocus={(n) => setPanel({ k: 'hunt', spot: n })} />}
          {panel.k === 'heli' && <HeliPanel acts={acts} flying={flying != null} onTakeOff={() => void takeOff()} />}
          {msg && <small role="status">{msg}</small>}
        </MapSheet>
      )}
      {fishing && <TimedSuspense label="Loading Pearl Lagoon…" onClose={() => setFishing(false)}><FishingPanel me={me} spot="lagoon" onClose={() => setFishing(false)} /></TimedSuspense>}
    </div>
  );
}

const away = (a: IslandActState | null) => a && !a.here ? <p><small>Fly to the Private Island to take part.</small></p> : null;
function ReefPanel({ acts, onChanged }: { acts: IslandActState | null; onChanged: () => void }) {
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [wait, setWait] = useState(0);
  useEffect(() => { const ms = acts?.dives.readyIn ?? 0; const end = Date.now() + ms; setWait(ms); if (!ms) return; const t = setInterval(() => { const w = Math.max(0, end - Date.now()); setWait(w); if (!w) clearInterval(t); }, 500); return () => clearInterval(t); }, [acts]);
  const d = acts?.dives; const left = d ? d.max - d.used : DIVE_PER_DAY;
  const go = async () => { setBusy(true); const r = await request('isl_dive') as { ok: boolean; find?: { emoji: string; label: string; paid: number }; left?: number; error?: string }; setBusy(false);
    setMsg(r.ok && r.find ? `${r.find.emoji} You surface with a ${r.find.label}: 🪙 ${fmt(r.find.paid)}. ${r.left ? `${r.left} dive${r.left === 1 ? '' : 's'} left today.` : 'That was your last dive today.'}` : r.error ?? 'Could not dive.'); onChanged(); };
  return (
    <div className="island-act" data-testid="island-reef">
      <p>{ISLAND_SNORKEL.blurb} One minute between dives; resets 00:00 UTC.</p>
      <ul className="island-retreat-list">{DIVE_FINDS.map((f) => <li key={f.id}><span>{f.emoji} {f.label}</span><b>🪙 {fmt(f.pay)}</b><small>{f.odds}%</small></li>)}</ul>
      {d && d.finds.length > 0 && <p><small>Today: {d.finds.map((f) => f.emoji).join(' ')} · 🪙 {fmt(d.finds.reduce((a, f) => a + f.pay, 0))}</small></p>}
      {away(acts)}
      <button type="button" disabled={busy || left <= 0 || wait > 0 || !!(acts && !acts.here)} onClick={() => void go()} data-testid="island-dive">{left <= 0 ? 'All dives done today ✓' : wait > 0 ? `Catching breath… ${Math.ceil(wait / 1000)}s` : `🤿 Dive (${left}/${d?.max ?? DIVE_PER_DAY} left)`}</button>
      {msg && <small role="status">{msg}</small>}
    </div>
  );
}

function HuntPanel({ acts, spot, onChanged, onFocus }: { acts: IslandActState | null; spot?: number; onChanged: () => void; onFocus: (n: number) => void }) {
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const h = acts?.hunt; const dug = new Set(h?.dug ?? []); const left = h ? (h.found ? 0 : h.max - h.used) : DIG_PER_DAY;
  const go = async (n: number) => { setBusy(true); const r = await request('isl_dig', { spot: n }) as { ok: boolean; chest?: boolean; paid?: number; left?: number; error?: string }; setBusy(false);
    setMsg(r.ok ? (r.chest ? `💰 X${n} holds the chest! 🪙 ${fmt(r.paid ?? 0)}.` : `🐚 Just a trinket under X${n}: 🪙 ${fmt(r.paid ?? 0)}. ${r.left ? `${r.left} dig${r.left === 1 ? '' : 's'} left.` : 'Out of digs today.'}`) : r.error ?? 'Could not dig.'); onChanged(); };
  return (
    <div className="island-act" data-testid="island-hunt">
      <p>{ISLAND_HUNT.blurb} The chest pays 🪙 {fmt(acts?.pay.chest ?? CHEST_PAY)}; an empty X still turns up a 🪙 {fmt(acts?.pay.trinket ?? TRINKET_PAY)} trinket. A new map every day (00:00 UTC).</p>
      <div className="island-hunt-grid">{Array.from({ length: TREASURE_SPOTS }, (_, i) => i + 1).map((n) => <button key={n} type="button" className={`${dug.has(n) ? 'dug' : ''} ${h?.found === n ? 'found' : ''} ${spot === n ? 'sel' : ''}`} disabled={busy || dug.has(n) || left <= 0 || !!(acts && !acts.here)} onClick={() => (spot === n ? void go(n) : onFocus(n))} data-testid={`island-dig-${n}`}>{h?.found === n ? '💰' : dug.has(n) ? '🕳️' : '❌'}<small>X{n}</small></button>)}</div>
      {away(acts)}
      {spot && !dug.has(spot) && left > 0 && <button type="button" disabled={busy || !!(acts && !acts.here)} onClick={() => void go(spot)} data-testid="island-dig">⛏️ Dig X{spot}</button>}
      <p><small>{h?.found ? 'Chest found today ✓' : `${left}/${DIG_PER_DAY} digs left today.`} Tap an X, then dig.</small></p>
      {msg && <small role="status">{msg}</small>}
    </div>
  );
}

function HeliPanel({ acts, flying, onTakeOff }: { acts: IslandActState | null; flying: boolean; onTakeOff: () => void }) {
  const claimed = !!acts?.tour.claimed;
  return (
    <div className="island-act" data-testid="island-heli">
      <p>{ISLAND_HELI.blurb} About {Math.round(TOUR_MS / 1000)} seconds over the lagoon, the estates, the falls and the reef.</p>
      <p><small>{claimed ? 'Postcard bonus collected today ✓ · tours are free.' : `First tour today pays a postcard bonus of 🪙 ${fmt(acts?.tour.pay ?? TOUR_PAY)}.`}</small></p>
      {away(acts)}
      <button type="button" disabled={flying || !!(acts && !acts.here)} onClick={onTakeOff} data-testid="island-tour">🚁 Take off</button>
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

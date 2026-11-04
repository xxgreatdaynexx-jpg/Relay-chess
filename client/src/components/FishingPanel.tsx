import { useDoing } from '@/lib/doing';
import { SellQtyPicker } from './SellQtyPicker';
import { pickForQty } from '../../../shared/sellQty';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { request } from '@/lib/net';
import { fishSellValue, FISH_SPOT_CAP, fishById, fishPayout, spotOf, fmtKg, RARITY_COLOR, Reel, REEL_DT, type FishCatch, type FishSpot, type FishView } from '../../../shared/fishing';
import { FishGlyph } from './FishGlyph';
import { usePanelDrag } from '@/lib/panelDrag';
import { canBuyGear, FISH_BAITS, FISH_FLIES, type FishGearDef, type FishGearView } from '../../../shared/fishGear';
import { parseToken } from '../../../shared/skins';
import { boostXp } from '../../../shared/skills'; // recheck #8: show the +20% XP actually awarded

/** Tackle shop (request #28): bait tiers (rarer fish) and fly tiers (faster bites, harder fight), plus the equipped rod skin from Chud Cases. */
export function TackleShop({ me }: { me: string | null }) {
  const [gear, setGear] = useState<FishGearView | null>(null); const [msg, setMsg] = useState<string | null>(null); const [rod, setRod] = useState<string | null>(null);
  useEffect(() => { void request('fish_gear_view').then((r) => { if (r.ok) setGear((r as unknown as { gear: FishGearView }).gear); });
    void request('inv_loadout').then((r) => setRod(((r as { loadout?: Record<string, string> }).loadout?.rod) ?? null)); }, [me]);
  const act = async (ev: 'fish_gear_buy' | 'fish_gear_equip', id: string) => { setMsg(null); const r = await request(ev, { gear: id }) as { ok: boolean; error?: string; gear?: FishGearView; cost?: number };
    if (r.ok && r.gear) { setGear(r.gear); if (ev === 'fish_gear_buy') setMsg(`Bought for 🪙 ${chips(r.cost ?? 0)}.`); } else setMsg(r.error ?? 'Could not do that.'); };
  const rodSkin = parseToken(rod);
  const row = (g: FishGearDef) => { const owned = !!gear?.owned.includes(g.id); const on = gear ? (g.kind === 'bait' ? gear.bait : gear.fly) === g.id : g.tier === 0; const price = gear?.prices[g.id] ?? g.price;
    return <li key={g.id} className={`tackle-row${on ? ' on' : ''}`} data-testid={`tackle-${g.id}`}><span>{g.emoji} <b>{g.name}</b><br /><small>{g.blurb}</small></span>
      {on ? <em>Equipped</em> : owned ? <button type="button" disabled={!me} onClick={() => void act('fish_gear_equip', g.id)}>Equip</button>
        : <button type="button" disabled={!me || !gear || !canBuyGear(gear.owned, g.id)} onClick={() => void act('fish_gear_buy', g.id)}>🪙 {chips(price)}</button>}</li>; };
  return <div className="tackle-shop" data-testid="tackle-shop">
    <h4>🧰 Tackle Shop</h4>
    <small>Bait pulls rarer fish (stacks with your Fishing level, capped). Flies make fish bite faster but fight harder. Buy tiers in order.</small>
    <div className="tackle-cols"><div><h5>Bait</h5><ul>{FISH_BAITS.map(row)}</ul></div><div><h5>Flies</h5><ul>{FISH_FLIES.map(row)}</ul></div></div>
    <small data-testid="tackle-rod">🎣 Rod skin: {rodSkin ? <><span className="tackle-swatch" style={{ background: `linear-gradient(90deg, ${rodSkin.skin.colors.join(',')})` }} /> <b>{rodSkin.skin.name}</b></> : 'Stock'} · Rod skins drop from Chud Cases. Equip them in your Inventory.</small>
    {msg && <small className="fish-msg" data-testid="tackle-msg">{msg}</small>}
  </div>;
}

// The 3D game is its own lazy chunk; a stale chunk after a deploy reloads the tab once (same as the arena and mines).
const Fishing3DGame = lazyWithReload(() => import('./Fishing3DGame').then((m) => ({ default: m.Fishing3DGame })));
const chips = (n: number) => n.toLocaleString('en-US');
type Phase = { k: 'idle' } | { k: 'wait'; until: number } | { k: 'bite'; until: number } | { k: 'reel' } | { k: 'busy' };
type BoardRow = { name: string; fish: string; grams: number; value: number };

/** Fishing Dock: cast, wait for the bite, strike, then reel (hold to reel up, release to let it run) keeping the
 *  hook in the fish's zone until the catch bar fills. The server rolls the fish and replays the reel. */
export function FishingPanel({ me, onClose, spot = 'lake' }: { me: string | null; onClose: () => void; spot?: FishSpot }) {
  useDoing('fishing', spot === 'deep' ? 'Deep sea' : spot === 'reef' ? 'Resort reef' : 'Lake');
  const dragFishing = usePanelDrag('fishing');
  const reef = spot === 'reef' || spot === 'deep'; const deep = spot === 'deep';
  const [view, setView] = useState<FishView | null>(null); const [board, setBoard] = useState<BoardRow[]>([]);
  const [phase, setPhase] = useState<Phase>({ k: 'idle' }); const [play3d, setPlay3d] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const [reelUi, setReelUi] = useState<{ x: number; c: number; h: number; prog: number } | null>(null);
  const holdRef = useRef(false); const phaseRef = useRef(phase); phaseRef.current = phase;
  const reelRef = useRef<{ reel: Reel; inputs: string; t0: number; raf: number } | null>(null);
  const load = useCallback(() => { if (me) void request('fish_state').then((r) => { if (r.ok) setView((r as unknown as { state: FishView }).state); }); void request('fish_board').then((r) => { if (r.ok) setBoard((r as unknown as { board: BoardRow[] }).board); }); }, [me]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (reelRef.current) cancelAnimationFrame(reelRef.current.raf); if (phaseRef.current.k !== 'idle') void request('fish_reel_in'); }, []);

  const cast = async () => {
    setMsg(null); setPhase({ k: 'busy' });
    const r = await request('fish_cast', { spot }) as { ok: boolean; error?: string; biteIn?: number };
    if (!r.ok) { setMsg(r.error ?? 'Could not cast.'); setPhase({ k: 'idle' }); return; }
    const bite = Date.now() + (r.biteIn ?? 3000); setPhase({ k: 'wait', until: bite });
  };
  // waiting → bite → missed
  useEffect(() => {
    if (phase.k === 'wait') { const t = window.setTimeout(() => setPhase({ k: 'bite', until: Date.now() + 1400 }), Math.max(0, phase.until - Date.now())); return () => window.clearTimeout(t); }
    if (phase.k === 'bite') { const t = window.setTimeout(() => { void request('fish_reel_in'); setMsg('Too slow — it stole your bait.'); setPhase({ k: 'idle' }); }, Math.max(0, phase.until - Date.now())); return () => window.clearTimeout(t); }
  }, [phase]);
  const finish = async (inputs: string, won: boolean) => {
    setPhase({ k: 'busy' }); const r = await request('fish_land', { inputs }) as { ok: boolean; error?: string; caught?: boolean; fish?: FishCatch; xp?: number };
    setReelUi(null); reelRef.current = null; holdRef.current = false;
    if (!r.ok) setMsg(r.error ?? 'The line snapped.');
    else if (r.caught && r.fish) { const f = fishById(r.fish.fish)!; setMsg(`${f.emoji} Caught a ${f.label}! ${fmtKg(r.fish.grams)} · worth ~🪙 ${chips(Math.floor(fishSellValue(r.fish.value) * (view?.index ?? 1)))} · +${boostXp(r.xp ?? 0)} Fishing XP`); }
    else setMsg(won ? 'The line snapped.' : 'It got away… cast again!');
    setPhase({ k: 'idle' }); load();
  };
  const hook = async () => {
    if (phaseRef.current.k === 'wait') { void request('fish_reel_in'); setMsg('Too early — you spooked it.'); setPhase({ k: 'idle' }); return; }
    if (phaseRef.current.k !== 'bite') return;
    setPhase({ k: 'busy' }); const r = await request('fish_hook') as { ok: boolean; error?: string; seed?: number; diff?: number };
    if (!r.ok) { setMsg(r.error ?? 'Missed.'); setPhase({ k: 'idle' }); return; }
    const reel = new Reel(r.seed!, r.diff!); const st = { reel, inputs: '', t0: performance.now(), raf: 0 }; reelRef.current = st; setPhase({ k: 'reel' });
    const step = () => {
      const due = Math.floor((performance.now() - st.t0) / (REEL_DT * 1000)); // never faster than real time
      while (st.inputs.length < due && !reel.s.done) { const h = holdRef.current; st.inputs += h ? '1' : '0'; reel.tick(h); }
      setReelUi({ x: reel.s.x, c: reel.s.c, h: reel.s.h, prog: reel.s.prog });
      if (reel.s.done) { void finish(st.inputs, reel.s.done === 'caught'); return; }
      st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
  };
  // Space / mouse: cast, strike, hold to reel.
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code !== 'Space' || (e.target as HTMLElement)?.tagName === 'INPUT') return; e.preventDefault(); if (e.repeat) return;
      const k = phaseRef.current.k; if (k === 'reel') holdRef.current = true; else if (k === 'wait' || k === 'bite') void hook(); else if (k === 'idle') void cast(); };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') holdRef.current = false; };
    const mup = () => { holdRef.current = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('pointerup', mup);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('pointerup', mup); };
  });

  const sell = async (ids?: string[], qty?: number) => { setPhase({ k: 'busy' }); setMsg(null); const r = await request('fish_sell', { ...(ids ? { ids } : {}), ...(qty ? { qty } : {}) }) as { ok: boolean; error?: string; sold?: number; paid?: number };
    setMsg(r.ok ? `Sold ${r.sold} for 🪙 ${chips(r.paid ?? 0)}.` : r.error ?? 'Could not sell.'); setPhase({ k: 'idle' }); load(); };
  const release = async (id: string) => { await request('fish_release', { ids: [id] }); load(); };

  const cooler = view?.cooler ?? []; const idx = view?.index ?? 1; const gross = fishSellValue(cooler.reduce((a, c) => a + c.value, 0));
  const spotToday = (sp: FishSpot) => (view?.todayBySpot?.[sp] ?? (sp === 'lake' ? view?.today : undefined) ?? { gross: 0, paid: 0 });
  const estFor = (list: FishCatch[]) => Math.floor((['lake', 'reef', 'deep'] as FishSpot[]).reduce((a, sp) => a + fishPayout(list.filter((c) => { const f = fishById(c.fish); return (f ? spotOf(f) : 'lake') === sp; }).reduce((x, c) => x + fishSellValue(c.value), 0), spotToday(sp).gross, sp), 0) * idx);
  const est = view ? estFor(cooler) : 0; const capMax = FISH_SPOT_CAP[spot]; const capLeft = Math.max(0, capMax - spotToday(spot).gross);
  return (
    <div className={`world-deed world-venue fish-panel${reef ? ' fish-reef' : ''}`} data-testid={deep ? 'venue-deep' : reef ? 'venue-reef' : 'venue-dock'} data-drag-panel="fishing" onPointerDown={dragFishing.onPointerDown} style={dragFishing.style()} ref={dragFishing.ref}>{dragFishing.handle}
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <h3>{deep ? '🌊 Deep-Sea Charter' : reef ? '🌴 Reef Pier' : '🎣 Fishing Dock'}</h3>
      {deep && <small data-testid="deep-blurb">Out past the reef on your own boat. Better boats reach farther: the Outer Banks (bonito, wahoo, Black Marlin), Blue Water (swordfish, mako, Giant Squid) and the Abyss (oarfish, anglerfish, Coelacanth).</small>}
      {reef && !deep && <small data-testid="reef-blurb">Sunset over the reef: clownfish and tang in the shallows, mahi-mahi and tuna off the drop-off, and the odd Blue Marlin or Sunset Manta.</small>}
      {!me ? <small>Sign in to fish.</small> : <>
        <button type="button" className="fish-play3d" data-testid="fish-3d" disabled={phase.k !== 'idle'} onClick={() => setPlay3d(true)}>🎮 Play 3D fishing</button>
        {play3d && createPortal(<Suspense fallback={<div className="fish3d"><div className="fish3d-msg">{deep ? 'Heading out to sea…' : reef ? 'Loading the reef…' : 'Loading the lake…'}</div></div>}><Fishing3DGame me={me} spot={spot} onClose={() => { setPlay3d(false); load(); }} onChange={load} /></Suspense>, document.body)}
        <small>Quick cast (2D): cast, wait for the bite, strike, then <b>hold</b> (Space or mouse) to reel — keep the hook inside the fish’s green zone until the catch bar fills. Rarer and bigger fish fight harder.</small>
        <div className="fish-water" data-testid="fish-stage" onPointerDown={(e) => { e.preventDefault(); const k = phaseRef.current.k; if (k === 'reel') holdRef.current = true; else if (k === 'wait' || k === 'bite') void hook(); }}>
          {phase.k === 'reel' && reelUi ? <div className="fish-reel" data-testid="fish-reel">
            <div className="fish-meter"><div className="fish-zone" style={{ bottom: `${(reelUi.c - reelUi.h) * 100}%`, height: `${reelUi.h * 200}%` }} /><div className={`fish-hook${Math.abs(reelUi.x - reelUi.c) <= reelUi.h ? ' in' : ''}`} style={{ bottom: `calc(${reelUi.x * 100}% - 6px)` }}>🪝</div></div>
            <div className="fish-prog"><div style={{ height: `${reelUi.prog * 100}%` }} /></div>
            <div className="fish-tip">Hold to reel ↑<br />Let go to give line ↓</div>
          </div>
          : phase.k === 'bite' ? <div className="fish-bite" data-testid="fish-bite">❗ <b>BITE!</b><br /><small>Strike now (Space / click)</small></div>
          : phase.k === 'wait' ? <div className="fish-wait">🎣 <i>The float bobs…</i><br /><small>wait for the bite</small></div>
          : <button type="button" className="fish-cast" disabled={phase.k === 'busy'} onClick={() => void cast()} data-testid="fish-cast">🎣 Cast line <kbd>Space</kbd></button>}
        </div>
        {msg && <small data-testid="fish-msg" className="fish-msg">{msg}</small>}
        <TackleShop me={me} />
        <h4>🧊 Cooler · {cooler.length}/40</h4>
        {cooler.length ? <ul className="fish-cooler" data-testid="fish-cooler">{cooler.map((c) => { const f = fishById(c.fish); return (
          <li key={c.id}><span style={{ color: f ? RARITY_COLOR[f.rarity] : undefined }}><FishGlyph id={c.fish} /> {f?.label ?? c.fish}</span> <small>{fmtKg(c.grams)}</small> <b>🪙 {chips(Math.floor(fishSellValue(c.value) * idx))}</b> <button type="button" title="Release" onClick={() => void release(c.id)}>↩</button></li>); })}</ul>
          : <small>Empty. Go catch something!</small>}
        {cooler.length > 1 && view && <SellQtyPicker owned={cooler.length} unit="fish" testid="fish-qty" disabled={phase.k !== 'idle'} preview={(n) => estFor(pickForQty(cooler, n))} onSell={(n) => sell(undefined, n)} />}
        {cooler.length > 0 && <button type="button" disabled={phase.k !== 'idle' || est <= 0} onClick={() => void sell()} data-testid="fish-sell">💰 Sell all to the fishmonger <span>🪙 {chips(est)}</span></button>}
        {view && <small data-testid="fish-cap">{spot === 'deep' ? 'Deep sea' : spot === 'reef' ? 'Reef' : 'Lake'} today: 🪙 {chips(spotToday(spot).paid)} sold. Full price up to {chips(capMax)} a day here; lake, reef and deep sea each have their own cap (resets 00:00 UTC). {capLeft > 0 ? '' : 'The fishmonger is full for today.'}</small>}
      </>}
      {board.length > 0 && <><h4>🏆 Biggest catches</h4><ol className="venue-board" data-testid="fish-board">{board.map((b, i) => { const f = fishById(b.fish); return <li key={b.name + i}><b><FishGlyph id={b.fish} /> {fmtKg(b.grams)}</b> <span className="player-link" data-player={b.name}>{b.name}</span> <small>{f?.label}</small></li>; })}</ol></>}
    </div>
  );
}

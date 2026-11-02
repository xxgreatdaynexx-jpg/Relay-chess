import { useDoing } from '@/lib/doing';
import { SellQtyPicker } from './SellQtyPicker';
import { pickForQty } from '../../../shared/sellQty';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ItemIcon } from './ItemIcon';
import { request } from '@/lib/net';
import { FishPanPanel } from './FishPanPanel';
import { COOK_DAILY_MAX, FILLET_CAP, cookPayout, FISH_ING, RECIPES, STAPLES, STEPS, dishValue, ingInfo, needleAt, qualityLabel, type GroceryKind, type KitchenView, type Recipe, type StepSpec } from '../../../shared/cooking';
import { usePanelDrag } from '@/lib/panelDrag';

const chips = (n: number) => n.toLocaleString('en-US');
export const OPEN_KITCHEN = 'open-kitchen';
export const OPEN_GROCERY = 'open-grocery';
type State = { state: KitchenView; prices: Record<string, number> };
const nonce = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, '');
const SHELVES: Array<[GroceryKind, string]> = [['staple', '🧺 Pantry staples'], ['dairy', '🥛 Dairy & eggs'], ['protein', '🥩 Butcher & seafood'], ['veg', '🥬 Fresh produce'], ['spice', '🌶️ Spices'], ['sauce', '🍯 Sauces']];

function useKitchen() {
  const [s, setS] = useState<State | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { void request('cook_state').then((r) => { if (r.ok) setS(r as unknown as State); else setErr(r.error ?? 'Kitchen is offline.'); }); }, []);
  useEffect(() => { load(); }, [load]);
  return { s, err, load };
}
const have = (v: KitchenView, id: string) => (id === 'fish' ? v.fish.fish : id === 'fish_fine' ? v.fish.fish_fine : v.pantry[id] ?? 0);

/** Grocery Store (city): shelves of cooking ingredients at px() prices. Each buy carries a nonce (server dedupes); the
 *  button locks while in flight and a retry after a network error reuses the same nonce. */
export function GroceryPanel({ onClose, onKitchen }: { onClose: () => void; onKitchen?: () => void }) {
  useDoing('grocery');
  const dragGrocery = usePanelDrag('grocery');
  const { s, err, load } = useKitchen(); const [qty, setQty] = useState(5); const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const pending = useRef(new Map<string, string>());
  const buy = async (item: string) => {
    if (busy) return; setBusy(item); setMsg(null);
    const k = `${item}:${qty}`; const n = pending.current.get(k) ?? nonce(); pending.current.set(k, n);
    const r = await request('grocery_buy', { item, qty, nonce: n }) as { ok: boolean; error?: string; cost?: number; bought?: number };
    setBusy(null);
    if (r.ok || /Already/.test(r.error ?? '')) pending.current.delete(k);
    if (r.ok) { setMsg(`🛒 Bought ${r.bought}× ${STAPLES.find((x) => x.id === item)?.label} for 🪙 ${chips(r.cost ?? 0)}.`); load(); }
    else setMsg(r.error ?? 'Could not buy that.');
  };
  return (
    <div className="world-deed world-venue grocery-panel" data-testid="venue-grocery" data-drag-panel="grocery" onPointerDown={dragGrocery.onPointerDown} style={dragGrocery.style()} ref={dragGrocery.ref}>{dragGrocery.handle}
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <div className="grocery-front"><span>🛒 CHUD FRESH</span><small>Grocery Store · open daily</small></div>
      <div className="grocery-qty">Buy <select value={qty} onChange={(e) => setQty(+e.target.value)} data-testid="grocery-qty">{[1, 5, 10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select> at a time
        {onKitchen && <button type="button" onClick={onKitchen} data-testid="grocery-kitchen">🍳 My kitchen</button>}</div>
      {err && <small className="text-rose-300">{err}</small>}
      <div className="grocery-aisles">
        {SHELVES.map(([kind, title]) => <section key={kind} className="grocery-shelf"><h4>{title}</h4><ul>
          {STAPLES.filter((x) => x.kind === kind).map((x) => { const p = s?.prices[x.id] ?? x.base; return (
            <li key={x.id}><span className="grocery-item"><ItemIcon type="food" id={x.id} size={28} /></span><b>{x.label}</b><small>🪙 {chips(p)} · have {s ? s.state.pantry[x.id] ?? 0 : '–'}</small>
              <button type="button" disabled={!!busy || !s} aria-busy={busy === x.id} onClick={() => void buy(x.id)} data-testid={`grocery-buy-${x.id}`}>{busy === x.id ? '…' : `🪙 ${chips(p * qty)}`}</button></li>); })}
        </ul></section>)}
      </div>
      {msg && <small role="status" data-testid="grocery-msg">{msg}</small>}
      <small className="opacity-60">Groceries also trade player-to-player on the Market. Cooked dishes sell from your kitchen fridge.</small>
    </div>
  );
}

type Cook = { id: string; recipe: string; seed: number; diff: number; steps: StepSpec[] };
/** The cooking minigame: four timed presses (heat, flip, stir, plate). Hit the needle inside the green zone. */
function Stove({ cook, onDone }: { cook: Cook; onDone: (presses: number[]) => void }) {
  const [i, setI] = useState(0); const [t, setT] = useState(0); const t0 = useRef(performance.now()); const presses = useRef<number[]>([]);
  useEffect(() => { let raf = 0; const tick = () => { setT(performance.now() - t0.current); raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); }, [i]);
  const press = useCallback(() => {
    const dt = Math.round(performance.now() - t0.current); if (dt < 260) return;
    presses.current.push(dt); t0.current = performance.now();
    if (presses.current.length >= 4) onDone(presses.current); else setI((x) => x + 1);
  }, [onDone]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); press(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [press]);
  const s = cook.steps[i]!; const x = needleAt(s, t); const step = STEPS[i]!;
  return (
    <div className="stove" data-testid="cook-stove">
      <div className="stove-steps">{STEPS.map((st, k) => <span key={st.id} className={k < i ? 'done' : k === i ? 'on' : ''}>{st.emoji} {st.label}</span>)}</div>
      <div className="stove-pan"><span className={`stove-food s${i}`}>{RECIPES.find((r) => r.id === cook.recipe)?.emoji}</span>{i === 0 && <span className="stove-flame">🔥</span>}</div>
      <div className="stove-bar"><i style={{ left: `${(s.center - s.half) * 100}%`, width: `${s.half * 200}%` }} /><b style={{ left: `${x * 100}%` }} /></div>
      <button type="button" className="stove-press" onPointerDown={press} data-testid="cook-press">{step.emoji} {step.label}! <kbd>Space</kbd></button>
    </div>
  );
}

/** Kitchen: open from any home you own. Pantry, recipe book (unlocks by Cooking level), the stove minigame and the fridge. */
export function KitchenPanel({ me, home, onClose, onGrocery }: { me: string | null; home: string; onClose: () => void; onGrocery: () => void }) {
  useDoing('cooking', home);
  const dragKitchen = usePanelDrag('kitchen');
  const { s, err, load } = useKitchen(); const [cook, setCook] = useState<Cook | null>(null); const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<'book' | 'fridge' | 'fish'>('book');
  const v = s?.state; const idx = v?.index ?? 1;
  const start = async (r: Recipe) => {
    if (busy) return; setBusy(r.id); setMsg(null);
    const res = await request('cook_start', { recipe: r.id }) as { ok: boolean; error?: string; cook?: Cook };
    setBusy(null); if (!res.ok || !res.cook) { setMsg(res.error ?? 'Could not start cooking.'); return; }
    setCook(res.cook); load();
  };
  const finish = useCallback(async (presses: number[]) => {
    const c = cook; if (!c) return; setBusy('finish');
    const r = await request('cook_finish', { id: c.id, presses }) as { ok: boolean; error?: string; burnt?: boolean; quality?: number; xp?: number; dish?: { value: number } | null };
    setBusy(null); setCook(null);
    const rec = RECIPES.find((x) => x.id === c.recipe)!;
    if (!r.ok) setMsg(r.error ?? 'The stove went cold.');
    else if (r.burnt) setMsg(`💨 Burnt the ${rec.label}! +${r.xp} Cooking XP. It goes in the bin.`);
    else setMsg(`${rec.emoji} ${qualityLabel(r.quality ?? 0)} ${rec.label}! Worth ~🪙 ${chips(Math.floor((r.dish?.value ?? 0) * idx))} · +${r.xp} Cooking XP`);
    load();
  }, [cook, idx, load]);
  const sell = async (qty?: number) => {
    if (busy) return; setBusy('sell'); setMsg(null);
    const r = await request('cook_sell', qty ? { qty } : {}) as { ok: boolean; error?: string; sold?: number; paid?: number };
    setBusy(null); setMsg(r.ok ? `🍽️ Sold ${r.sold} dish${r.sold === 1 ? '' : 'es'} for 🪙 ${chips(r.paid ?? 0)}.` : r.error ?? 'Could not sell.'); load();
  };
  const left = v ? Math.max(0, Math.floor(COOK_DAILY_MAX * idx) - v.today.paid) : 0;
  if (tab === 'fish') return <FishPanPanel me={me} home={home} onClose={() => { setTab('book'); load(); }} />;
  return (
    <div className="world-deed world-venue kitchen-panel" data-testid="venue-kitchen" data-drag-panel="kitchen" onPointerDown={dragKitchen.onPointerDown} style={dragKitchen.style()} ref={dragKitchen.ref}>{dragKitchen.handle}
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <div className="kitchen-scene" aria-hidden>
        <div className="k-window"><span>🌙</span></div><div className="k-shelf">🫙🧂🍯🌿</div><div className="k-fridge">🧊</div>
        <div className="k-counter"><span>🔪</span><span>🥖</span><span className="k-pot">🍲<i>♨</i></span><span>🪴</span></div>
      </div>
      <h3>🍳 Kitchen {v && <small>Cooking lvl {v.level}</small>}</h3>
      <small className="opacity-70" data-testid="kitchen-home">{home}</small>
      {err && <small className="text-rose-300">{err}</small>}
      {v && !v.hasHome && <small className="text-amber-300" data-testid="kitchen-nohome">You need a home to cook: any property, farmhouse or your Trailer Park trailer.</small>}
      {cook ? <Stove cook={cook} onDone={(p) => void finish(p)} /> : <>
        <div className="kitchen-tabs"><button type="button" aria-pressed={tab === 'book'} onClick={() => setTab('book')}>📖 Recipes</button><button type="button" aria-pressed={tab === 'fridge'} onClick={() => setTab('fridge')} data-testid="kitchen-fridge-tab">🧊 Fridge ({v?.dishes.length ?? 0})</button><button type="button" onClick={() => setTab('fish')} data-testid="kitchen-fishpan-tab">🐟 Pan-fry a fish</button><button type="button" onClick={onGrocery} data-testid="kitchen-grocery">🛒 Grocery Store</button></div>
        {tab === 'book' && <small className="opacity-70 block" data-testid="kitchen-fillets">🔪 Fish are cut into fillets: 1 per {FISH_ING.fish.base} chips of value (fine fish: 1 per {FISH_ING.fish_fine.base}), up to {FILLET_CAP} per fish. Each fish recipe uses one fillet. You have 🐟 {v?.fish.fish ?? 0} fillets ({v?.fillets?.fish ?? 0} already cut) · 🍣 {v?.fish.fish_fine ?? 0} fine.</small>}
        {tab === 'book' ? <ul className="kitchen-book" data-testid="kitchen-book">{RECIPES.map((r) => {
          const locked = !v || v.level < r.level; const ok = !!v && Object.entries(r.ings).every(([id, n]) => have(v, id) >= n);
          return <li key={r.id} className={locked ? 'locked' : ''}><span className="k-emoji">{locked ? '🔒' : <ItemIcon type="food" id={r.id} size={28} />}</span><div><b>{r.label}</b> <small>lvl {r.level} · ~🪙 {chips(Math.floor(dishValue(r, 0.8) * idx))}</small>
            <div className="k-ings">{Object.entries(r.ings).map(([id, n]) => { const inf = ingInfo(id); const h = v ? have(v, id) : 0; return <span key={id} className={h >= n ? 'ok' : 'miss'} title={id === 'fish' || id === 'fish_fine' ? `${inf?.label}: fillets you have` : inf?.label}>{id === 'fish' || id === 'fish_fine' ? inf?.emoji : <ItemIcon type="food" id={id} size={16} />}{n > 1 ? `×${n}` : ''} <em>{h}</em></span>; })}</div></div>
            {!locked && <button type="button" disabled={!!busy || !ok || !v?.hasHome} aria-busy={busy === r.id} onClick={() => void start(r)} data-testid={`cook-${r.id}`}>{busy === r.id ? '…' : 'Cook'}</button>}</li>; })}</ul>
          : <div className="kitchen-fridge" data-testid="kitchen-fridge">{v?.dishes.length ? <ul>{v.dishes.map((d) => { const r = RECIPES.find((x) => x.id === d.recipe); return <li key={d.id}><ItemIcon type="food" id={d.recipe} size={20} /> {r?.label} <small>{qualityLabel(d.quality)} · 🪙 {chips(Math.floor(d.value * idx))}</small></li>; })}</ul> : <small>Nothing in the fridge yet — cook something!</small>}
            {v && v.dishes.length > 1 && <SellQtyPicker owned={v.dishes.length} unit="dishes" testid="kitchen-qty" disabled={!!busy} preview={(n) => Math.floor(cookPayout(pickForQty(v.dishes, n).reduce((a, d) => a + d.value, 0), v.today.gross ?? 0) * idx)} onSell={(n) => sell(n)} />}
            <button type="button" disabled={!!busy || !v?.dishes.length} aria-busy={busy === 'sell'} onClick={() => void sell()} data-testid="kitchen-sell">{busy === 'sell' ? 'Selling…' : 'Sell all dishes'}</button>
            <small className="opacity-70">Today: 🪙 {chips(v?.today.paid ?? 0)} earned · daily cap ~🪙 {chips(Math.floor(COOK_DAILY_MAX * idx))} (shared by recipe and pan-fried fish dishes: full price up to 100,000 a day){left === 0 && v?.today.paid ? ' · cap reached' : ''}</small></div>}
      </>}
      {msg && <small role="status" data-testid="kitchen-msg">{msg}</small>}
      <small className="opacity-60">Fish come from your cooler, crops from your farm (harvest “to pantry”), staples from the Grocery Store. Low Cooking level = more burnt dishes.</small>
    </div>
  );
}

/** Mounted once per map: opens the Kitchen / Grocery Store when anything fires OPEN_KITCHEN / OPEN_GROCERY. */
export function CookingHost({ me }: { me: string | null }) {
  const [open, setOpen] = useState<null | 'kitchen' | 'grocery'>(null); const [home, setHome] = useState('Your home');
  useEffect(() => {
    const k = (e: Event) => { const d = (e as CustomEvent<string | undefined>).detail; if (typeof d === 'string' && d) setHome(d); setOpen('kitchen'); }, g = () => setOpen('grocery');
    window.addEventListener(OPEN_KITCHEN, k); window.addEventListener(OPEN_GROCERY, g); return () => { window.removeEventListener(OPEN_KITCHEN, k); window.removeEventListener(OPEN_GROCERY, g); };
  }, []);
  if (open === 'kitchen') return <KitchenPanel me={me} home={home} onClose={() => setOpen(null)} onGrocery={() => setOpen('grocery')} />;
  if (open === 'grocery') return <GroceryPanel onClose={() => setOpen(null)} onKitchen={() => setOpen('kitchen')} />;
  return null;
}
/** Open the recipe kitchen (with the fish pan tab) for one of your homes. */
export const openKitchen = (home: string) => window.dispatchEvent(new CustomEvent(OPEN_KITCHEN, { detail: home }));

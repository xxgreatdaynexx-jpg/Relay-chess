/** Resource selling UI: storage grid → sell card → my listings, plus the Resource Inventory top-bar window. UI only: lists via mkt_list_stack / cancels via mkt_cancel_stack. */
import { houseSellPrice } from '../../../shared/sellBuff';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ItemIcon } from './ItemIcon';
import { useBuildingWindow } from '@/lib/useBuildingWindow';
import { focusBuildingWindow } from '@/lib/buildingWindows';
import { TopTab } from '@/components/TopTabs';
import { request } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import type { CatEntry } from '@/lib/marketCatalog';
import { openMarket } from './MarketPage';
import { HouseSell } from './HouseSell';
import { usePriceIndex } from '@/lib/priceIndex';
import { priceOf, type ItemType } from '../../../shared/mines';
import { listFee, pctQty, receiveFor, requestSellLabel, suggestUnit } from '../../../shared/marketSell';
import { FillRequestCard, useMatchingRequests } from './MarketRequests';

export interface PackItem { type: string; id: string; qty: number; name: string }
export interface MyStackRow { id: string; type: string; itemId: string; name: string; qty: number; total: number; unit: number; mine: boolean }
type Ack = { ok: boolean; error?: string; [k: string]: unknown };
/** Chip coin drawn as SVG: the 🪙 emoji is missing from some system fonts (e.g. older Windows) and showed as ▯. */
export function ChipCoin() {
  return <svg className="chip-coin" viewBox="0 0 16 16" width="1em" height="1em" aria-label="chips" role="img"><circle cx="8" cy="8" r="7.2" fill="#e7b33c" stroke="#9a6b12" strokeWidth="1.2" /><circle cx="8" cy="8" r="4.3" fill="none" stroke="#fff3c4" strokeWidth="1" strokeDasharray="2 1.6" /></svg>;
}
const fmt = (n: number) => <span className="chip-amt">{n.toLocaleString()} <ChipCoin /></span>;
const house = (p: { type: string; id: string }) => { try { return houseSellPrice({ type: p.type, id: p.id }); } catch { return 0; } };
const TYPE_LABEL: Record<string, string> = { ore: 'Ore', bar: 'Bars', good: 'Goods', food: 'Food', fish: 'Fish', crop: 'Crops', dish: 'Dishes' };

/** "Your storage" grid with a sell card and your active listings (Market → Resources). */
export function StorageSellPanel({ pack, rows, cat, sell, setSell, act, reload }: {
  pack: PackItem[]; rows: MyStackRow[]; cat: CatEntry[]; sell: string; setSell: (k: string) => void; reload?: () => void;
  act: (ev: string, body: object, ok: string) => Promise<void>;
}) {
  const info = (k: string) => cat.find((e) => e.what === `stack:${k}`);
  const mine = rows.filter((r) => r.mine);
  return (
    <div className="msell" data-testid="msell">
      <h3 className="msell-h">📦 Your storage <small>{pack.length ? 'tap an item to sell it' : ''}</small></h3>
      <div className="msell-grid" data-testid="msell-grid">
        {pack.map((p) => { const k = `${p.type}:${p.id}`; const e = info(k); return (
          <button type="button" key={k} className={`msell-tile${sell === k ? ' on' : ''}`} onClick={() => setSell(sell === k ? '' : k)} data-testid="msell-tile" aria-pressed={sell === k}>
            <ItemIcon type={p.type} id={p.id} size={30} />
            <b className="msell-qty">×{p.qty.toLocaleString()}</b>
            <span className="msell-name">{p.name}</span>
            <small>Low {e?.lowest != null ? fmt(e.lowest) : '—'}</small>
            <small>Last {e?.last != null ? fmt(e.last) : '—'}</small>
          </button>); })}
        {!pack.length && <p className="inv-note">Your storage is empty. Mine, farm, fish or craft to get resources.</p>}
      </div>
      {(() => { const p = pack.find((x) => `${x.type}:${x.id}` === sell); return p ? <SellCard key={sell} p={p} e={info(sell)} act={act} onDone={() => setSell('')} reload={reload} /> : null; })()}
      <h3 className="msell-h">🏷️ My listings <small>{mine.length || ''}</small></h3>
      <div className="msell-mine" data-testid="msell-mine">
        {mine.map((r) => (
          <div key={r.id} className="msell-row"><ItemIcon type={r.type} id={r.itemId} size={20} /><span>{r.name}</span><span>{r.qty}/{r.total} left</span><span>{fmt(r.unit)} each</span>
            <button type="button" onClick={() => void act('mkt_cancel_stack', { id: r.id }, 'Cancelled; items back in storage.')} data-testid="msell-cancel">Cancel</button></div>
        ))}
        {!mine.length && <p className="inv-note">No active listings.</p>}
      </div>
    </div>
  );
}

function SellCard({ p, e, act, onDone, reload }: { p: PackItem; e?: CatEntry; act: (ev: string, body: object, ok: string) => Promise<void>; onDone: () => void; reload?: () => void }) {
  const idx = usePriceIndex(); const hp = Math.floor(house(p) * idx); // house price at today's price index (what Sell to house pays before the daily cap)
  const [n, setN] = useState(p.qty);
  const [u, setU] = useState(() => suggestUnit(e?.lowest, e?.last, hp));
  const [busy, setBusy] = useState(false);
  const q = Math.max(1, Math.min(p.qty, Math.floor(n) || 1)); const unit = Math.max(1, Math.floor(u) || 1);
  const get = receiveFor(q, unit); const fee = listFee(q, unit);
  return (
    <div className="msell-card" data-testid="msell-card">
      <div className="msell-card-h"><ItemIcon type={p.type} id={p.id} size={36} /><div><b>{p.name}</b><small>{TYPE_LABEL[p.type] ?? p.type} · you have {p.qty.toLocaleString()}</small></div>
        <button type="button" className="msell-x" aria-label="Close sell card" onClick={onDone}>✕</button></div>
      <HouseSell type={p.type} id={p.id} qty={p.qty} name={p.name} testid="msell-house-sell" onSold={() => reload?.()} />
      <label className="msell-l">Or list it on the player market · Quantity</label>
      <div className="msell-qrow">
        <input type="range" min={1} max={p.qty} value={q} onChange={(ev) => setN(Number(ev.target.value))} data-testid="msell-slider" />
        <input type="number" min={1} max={p.qty} value={n} onChange={(ev) => setN(Number(ev.target.value))} data-testid="msell-qty" />
      </div>
      <div className="msell-btns">{([['25%', 0.25], ['50%', 0.5], ['Max', 1]] as const).map(([t, f]) => <button type="button" key={t} onClick={() => setN(pctQty(p.qty, f))}>{t}</button>)}</div>
      <label className="msell-l">Unit price (<ChipCoin /> each)</label>
      <input className="msell-unit" type="number" min={1} value={u} onChange={(ev) => setU(Number(ev.target.value))} data-testid="msell-unit" />
      <div className="msell-btns">
        <button type="button" disabled={e?.lowest == null} onClick={() => e?.lowest != null && setU(e.lowest)}>Match lowest{e?.lowest != null ? ` (${e.lowest})` : ''}</button>
        <button type="button" disabled={e?.lowest == null} onClick={() => e?.lowest != null && setU(Math.max(1, e.lowest - 1))}>Undercut −1</button>
        <button type="button" disabled={e?.last == null} onClick={() => e?.last != null && setU(e.last)}>Last sale{e?.last != null ? ` (${e.last})` : ''}</button>
      </div>
      <p className="msell-get" data-testid="msell-get">You receive <b>{fmt(get)}</b> after the 5% fee ({fmt(fee)})</p>
      {hp > 0 && <p className="msell-cmp" data-testid="msell-house">House pays up to {fmt(hp * q)} ({hp} each, daily cap applies): listing is {unit > hp ? <span className="up">{Math.round((unit / hp - 1) * 100)}% above</span> : unit < hp ? <span className="down">{Math.round((1 - unit / hp) * 100)}% below</span> : 'equal to'} the house.</p>}
      <button type="button" className="msell-list" disabled={busy} onClick={() => { setBusy(true); void act('mkt_list_stack', { type: p.type, id: p.id, qty: q, unit }, `Listed ${q} ${p.name} at ${unit} each.`).then(() => { setBusy(false); onDone(); }); }} data-testid="msell-list">List {q.toLocaleString()} for {fmt(q * unit)}</button>
    </div>
  );
}

/** Top-bar "Resource Inventory": everything in your storage with quick Sell on Market. */
export function ResourceInventory() {
  const [open, setOpen] = useState(false);
  useEffect(() => { const o = () => { setOpen(true); queueMicrotask(() => focusBuildingWindow('warehouse')); }; window.addEventListener('open-resource-inventory', o); return () => window.removeEventListener('open-resource-inventory', o); }, []);
  return (
    <>
      <TopTab id="resinv"><button type="button" className="sol-tab inv-tab" aria-label="Resource Inventory" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="res-inv-tab">📦<span className="inv-tab-label"> Resource Inventory</span></button></TopTab>
      {open && <ResWindow onClose={() => setOpen(false)} />}
    </>
  );
}

function ResWindow({ onClose }: { onClose: () => void }) {
  const account = useAccount();
  const wrapRef = useRef<HTMLDivElement>(null);
  const win = useBuildingWindow('warehouse', wrapRef, onClose);
  const [pack, setPack] = useState<PackItem[] | null>(null); const [f, setF] = useState('all'); const [q, setQ] = useState(''); const [house, setHouse] = useState(''); const [reqPick, setReqPick] = useState('');
  const { items: reqMatches, reload: reloadReqs } = useMatchingRequests(!!account);
  const load = useCallback(() => void request('mkt_my_stacks', {}).then((r) => { const a = r as Ack; setPack(a.ok ? (a.stacks as PackItem[]) : []); }), []);
  useEffect(() => { load(); }, [load, account]);
  const types = useMemo(() => [...new Set((pack ?? []).map((p) => p.type))], [pack]);
  const shown = (pack ?? []).filter((p) => (f === 'all' || p.type === f) && p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const total = (pack ?? []).reduce((s, p) => s + p.qty, 0);
  return (
    <div ref={wrapRef} className={`sol-panel hub-win hub-win-warehouse res-win${win.className}`} style={win.style} onPointerDownCapture={win.front} onPointerMove={win.onPanelMove} role="dialog" aria-label="Resource Inventory" data-testid="res-inv" data-drag-panel="warehouse">
      {win.grips}
      <div {...win.bar} className="sol-bar hub-win-bar">
        <span className="font-semibold">📦 Chud City Warehouse</span>
        <span className="inv-count">{(pack ?? []).length} kinds · {total.toLocaleString()} items</span>
        {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" onClick={win.reset}>⟲</button>}
        <button type="button" className="ml-auto" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <div className="hub-win-body res-win-body">
        <header className="inv-head">
          <button type="button" onClick={() => openMarket({ from: 'resources', tab: 'resources' })}>🏪 Market</button>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('open-inventory', { detail: { tab: 'inv' } }))} data-testid="res-skins">🎒 Skins</button>
        </header>
        <p className="res-where" data-testid="res-where">Stored at the Chud City Warehouse. 🏦 Sell to house = instant sale to the game at the house price (price index + daily cap). Sell on Market = list for other players.</p>
        <div className="res-filters"><input type="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          {['all', ...types].map((t) => <button type="button" key={t} className={f === t ? 'on' : ''} onClick={() => setF(t)}>{t === 'all' ? 'All' : TYPE_LABEL[t] ?? t}</button>)}</div>
        <div className="res-grid">
          {!account && <p className="inv-note">Sign in to see your resources.</p>}
          {account && pack === null && <p className="inv-note">Loading…</p>}
          {shown.map((p) => (
            <div key={`${p.type}:${p.id}`} className="res-tile" data-testid="res-tile"><ItemIcon type={p.type} id={p.id} size={34} /><b>×{p.qty.toLocaleString()}</b><span>{p.name}</span>
              <button type="button" className="res-house" onClick={() => setHouse(house === `${p.type}:${p.id}` ? '' : `${p.type}:${p.id}`)} aria-expanded={house === `${p.type}:${p.id}`} data-testid="res-house">🏦 Sell to house</button>
              <button type="button" onClick={() => openMarket({ from: 'resources', tab: 'resources', stack: `${p.type}:${p.id}` })} data-testid="res-sell">Sell on Market</button>
              {requestSellLabel(reqMatches.find((x) => x.type === p.type && x.id === p.id)?.requests ?? [], p.qty) && <button type="button" className="res-req" onClick={() => setReqPick(reqPick === `${p.type}:${p.id}` ? '' : `${p.type}:${p.id}`)} aria-expanded={reqPick === `${p.type}:${p.id}`} data-testid="res-req-sell">{requestSellLabel(reqMatches.find((x) => x.type === p.type && x.id === p.id)?.requests ?? [], p.qty)}</button>}
              {house === `${p.type}:${p.id}` && <div className="res-house-wrap"><HouseSell type={p.type} id={p.id} qty={p.qty} name={p.name} testid="res-house" onSold={() => load()} /></div>}
              {reqPick === `${p.type}:${p.id}` && reqMatches.some((x) => x.type === p.type && x.id === p.id) && <FillRequestCard item={{ ...reqMatches.find((x) => x.type === p.type && x.id === p.id)!, qty: p.qty, name: p.name }} testid="res-req" onReload={() => { reloadReqs(); load(); }} />}</div>
          ))}
          {account && pack && !shown.length && <p className="inv-note">Nothing here yet. Mine, farm, fish or cook, then bank it.</p>}
        </div>
      </div>
    </div>
  );
}

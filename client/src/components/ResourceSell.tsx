/** Resource selling UI: storage grid → sell card → my listings, plus the Resource Inventory top-bar window. UI only: lists via mkt_list_stack / cancels via mkt_cancel_stack. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ItemIcon } from './ItemIcon';
import { usePanelDrag } from '@/lib/panelDrag';
import { TopTab } from '@/components/TopTabs';
import { request } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import type { CatEntry } from '@/lib/marketCatalog';
import { openMarket } from './MarketPage';
import { priceOf, type ItemType } from '../../../shared/mines';
import { listFee, pctQty, receiveFor, suggestUnit } from '../../../shared/marketSell';

export interface PackItem { type: string; id: string; qty: number; name: string }
export interface MyStackRow { id: string; type: string; itemId: string; name: string; qty: number; total: number; unit: number; mine: boolean }
type Ack = { ok: boolean; error?: string; [k: string]: unknown };
const fmt = (n: number) => `${n.toLocaleString()} 🪙`;
const house = (p: { type: string; id: string }) => { try { return priceOf({ type: p.type as ItemType, id: p.id }); } catch { return 0; } };
const TYPE_LABEL: Record<string, string> = { ore: 'Ore', bar: 'Bars', good: 'Goods', food: 'Food', fish: 'Fish', crop: 'Crops', dish: 'Dishes' };

/** "Your storage" grid with a sell card and your active listings (Market → Resources). */
export function StorageSellPanel({ pack, rows, cat, sell, setSell, act }: {
  pack: PackItem[]; rows: MyStackRow[]; cat: CatEntry[]; sell: string; setSell: (k: string) => void;
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
      {(() => { const p = pack.find((x) => `${x.type}:${x.id}` === sell); return p ? <SellCard key={sell} p={p} e={info(sell)} act={act} onDone={() => setSell('')} /> : null; })()}
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

function SellCard({ p, e, act, onDone }: { p: PackItem; e?: CatEntry; act: (ev: string, body: object, ok: string) => Promise<void>; onDone: () => void }) {
  const hp = house(p);
  const [n, setN] = useState(p.qty);
  const [u, setU] = useState(() => suggestUnit(e?.lowest, e?.last, hp));
  const [busy, setBusy] = useState(false);
  const q = Math.max(1, Math.min(p.qty, Math.floor(n) || 1)); const unit = Math.max(1, Math.floor(u) || 1);
  const get = receiveFor(q, unit); const fee = listFee(q, unit);
  return (
    <div className="msell-card" data-testid="msell-card">
      <div className="msell-card-h"><ItemIcon type={p.type} id={p.id} size={36} /><div><b>{p.name}</b><small>{TYPE_LABEL[p.type] ?? p.type} · you have {p.qty.toLocaleString()}</small></div>
        <button type="button" className="msell-x" aria-label="Close sell card" onClick={onDone}>✕</button></div>
      <label className="msell-l">Quantity</label>
      <div className="msell-qrow">
        <input type="range" min={1} max={p.qty} value={q} onChange={(ev) => setN(Number(ev.target.value))} data-testid="msell-slider" />
        <input type="number" min={1} max={p.qty} value={n} onChange={(ev) => setN(Number(ev.target.value))} data-testid="msell-qty" />
      </div>
      <div className="msell-btns">{([['25%', 0.25], ['50%', 0.5], ['Max', 1]] as const).map(([t, f]) => <button type="button" key={t} onClick={() => setN(pctQty(p.qty, f))}>{t}</button>)}</div>
      <label className="msell-l">Unit price (🪙 each)</label>
      <input className="msell-unit" type="number" min={1} value={u} onChange={(ev) => setU(Number(ev.target.value))} data-testid="msell-unit" />
      <div className="msell-btns">
        <button type="button" disabled={e?.lowest == null} onClick={() => e?.lowest != null && setU(e.lowest)}>Match lowest{e?.lowest != null ? ` (${e.lowest})` : ''}</button>
        <button type="button" disabled={e?.lowest == null} onClick={() => e?.lowest != null && setU(Math.max(1, e.lowest - 1))}>Undercut −1</button>
        <button type="button" disabled={e?.last == null} onClick={() => e?.last != null && setU(e.last)}>Last sale{e?.last != null ? ` (${e.last})` : ''}</button>
      </div>
      <p className="msell-get" data-testid="msell-get">You receive <b>{fmt(get)}</b> after the 5% fee ({fee.toLocaleString()} 🪙)</p>
      {hp > 0 && <p className="msell-cmp" data-testid="msell-house">House pays up to {fmt(hp * q)} ({hp} each, daily cap applies): listing is {unit > hp ? <span className="up">{Math.round((unit / hp - 1) * 100)}% above</span> : unit < hp ? <span className="down">{Math.round((1 - unit / hp) * 100)}% below</span> : 'equal to'} the house.</p>}
      <button type="button" className="msell-list" disabled={busy} onClick={() => { setBusy(true); void act('mkt_list_stack', { type: p.type, id: p.id, qty: q, unit }, `Listed ${q} ${p.name} at ${unit} each.`).then(() => { setBusy(false); onDone(); }); }} data-testid="msell-list">List {q.toLocaleString()} for {fmt(q * unit)}</button>
    </div>
  );
}

/** Top-bar "Resource Inventory": everything in your storage with quick Sell on Market. */
export function ResourceInventory() {
  const [open, setOpen] = useState(false);
  useEffect(() => { const o = () => setOpen(true); window.addEventListener('open-resource-inventory', o); return () => window.removeEventListener('open-resource-inventory', o); }, []);
  return (
    <>
      <TopTab id="resinv"><button type="button" className="sol-tab inv-tab" aria-label="Resource Inventory" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="res-inv-tab">📦<span className="inv-tab-label"> Resource Inventory</span></button></TopTab>
      {open && createPortal(<ResWindow onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function ResWindow({ onClose }: { onClose: () => void }) {
  const account = useAccount();
  const drag = usePanelDrag('resource-inventory');
  const [pack, setPack] = useState<PackItem[] | null>(null); const [f, setF] = useState('all'); const [q, setQ] = useState('');
  const load = useCallback(() => void request('mkt_my_stacks', {}).then((r) => { const a = r as Ack; setPack(a.ok ? (a.stacks as PackItem[]) : []); }), []);
  useEffect(() => { load(); }, [load, account]);
  const types = useMemo(() => [...new Set((pack ?? []).map((p) => p.type))], [pack]);
  const shown = (pack ?? []).filter((p) => (f === 'all' || p.type === f) && p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const total = (pack ?? []).reduce((s, p) => s + p.qty, 0);
  return (
    <div className="inv-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="res-inv">
      <div className="inv-win res-win" role="dialog" aria-label="Resource Inventory" data-drag-panel="resource-inventory" onPointerDown={drag.onPointerDown} style={drag.style()} ref={drag.ref}>{drag.handle}
        <header className="inv-head"><b>📦 Resource Inventory</b><span className="inv-count">{(pack ?? []).length} kinds · {total.toLocaleString()} items</span>
          <button type="button" onClick={() => { onClose(); openMarket({ from: 'resources', tab: 'resources' }); }}>🏪 Market</button><button type="button" aria-label="Close" onClick={onClose}>✕</button></header>
        <div className="res-filters"><input type="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          {['all', ...types].map((t) => <button type="button" key={t} className={f === t ? 'on' : ''} onClick={() => setF(t)}>{t === 'all' ? 'All' : TYPE_LABEL[t] ?? t}</button>)}</div>
        <div className="res-grid">
          {!account && <p className="inv-note">Sign in to see your resources.</p>}
          {account && pack === null && <p className="inv-note">Loading…</p>}
          {shown.map((p) => (
            <div key={`${p.type}:${p.id}`} className="res-tile" data-testid="res-tile"><ItemIcon type={p.type} id={p.id} size={34} /><b>×{p.qty.toLocaleString()}</b><span>{p.name}</span>
              <button type="button" onClick={() => { onClose(); openMarket({ from: 'resources', tab: 'resources', stack: `${p.type}:${p.id}` }); }} data-testid="res-sell">Sell on Market</button></div>
          ))}
          {account && pack && !shown.length && <p className="inv-note">Nothing here yet. Mine, farm, fish or cook, then bank it.</p>}
        </div>
      </div>
    </div>
  );
}

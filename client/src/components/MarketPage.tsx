import { useDoing } from '@/lib/doing';
import { backdropDismiss } from '@/lib/backdrop';
/** Market: its own top-nav tab (/market, #market). Sub-tabs: Skins (listings, sell, trades) and Resources (ore, bars, goods from banked storage).
 *  Other panels open it with openMarket({...}); the 3D hub's Market building routes to /market. */
import { useCallback, useEffect, useState } from 'react';
import { TopTab } from '@/components/TopTabs';
import { request, socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { MarketView, MaterialsView, SellForm, TradesView } from './MarketPanel';
import { Swatch, label } from './SkinsPanel';
import { MyHistoryView } from './MarketCharts';
import type { SkinItem } from '../../../shared/skins';
import { usePanelDrag } from '@/lib/panelDrag';

export type MarketTab = 'skins' | 'resources';
export type SkinsSub = 'listings' | 'sell' | 'trades';
export interface OpenMarket { tab?: MarketTab; sub?: SkinsSub; item?: string; stack?: string; /** Inventory the player came from; ← Back returns there (else to the city). */ from?: 'skins' | 'resources' }
const EV = 'chud:open-market';
/** Open the Market tab from anywhere (Inventory "Sell on Market", Factory "Sell on Market", the hub). */
export function openMarket(o: OpenMarket = {}) { window.dispatchEvent(new CustomEvent<OpenMarket>(EV, { detail: o })); }
const atMarket = () => window.location.pathname === '/market' || window.location.hash === '#market';

export function MarketPage() {
  const dragMarket = usePanelDrag('market');
  const [open, setOpen] = useState(atMarket);
  useDoing('market', null, open);
  const [hist, setHist] = useState(false);
  const [tab, setTab] = useState<MarketTab>(() => (window.location.hash === '#market-resources' ? 'resources' : 'skins'));
  const [sub, setSub] = useState<SkinsSub>('listings'); const [item, setItem] = useState<string | null>(null); const [stack, setStack] = useState<string | null>(null); const [from, setFrom] = useState<'skins' | 'resources' | null>(null);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<OpenMarket>).detail ?? {}; setOpen(true); setHist(false); if (d.tab) setTab(d.tab); if (d.sub) setSub(d.sub); setItem(d.item ?? null); setStack(d.stack ?? null); setFrom(d.from ?? null); };
    const pop = () => { if (atMarket()) setOpen(true); };
    window.addEventListener(EV, on); window.addEventListener('popstate', pop); window.addEventListener('hashchange', pop);
    return () => { window.removeEventListener(EV, on); window.removeEventListener('popstate', pop); window.removeEventListener('hashchange', pop); };
  }, []);
  const close = () => { setOpen(false); if (window.location.pathname === '/market' || window.location.hash.startsWith('#market')) history.replaceState(history.state, '', '/'); };
  const back = () => { const f = from; close(); setFrom(null); if (f === 'skins') window.dispatchEvent(new CustomEvent('open-inventory', { detail: { tab: 'inv' } })); else if (f === 'resources') window.dispatchEvent(new Event('open-resource-inventory')); };
  return (
    <div data-testid="market-page">
      <TopTab id="market"><button type="button" className="sol-tab" aria-expanded={open} id="market-tab" onClick={() => (open ? close() : setOpen(true))} data-testid="market-tab">{open ? '▴ Market' : '🏪 Market'}</button></TopTab>
      {open && (
        <div className="inv-backdrop" {...backdropDismiss(() => close())}>
          <div className="inv-win mkt-win" role="dialog" aria-label="Market" data-drag-panel="market" onPointerDown={dragMarket.onPointerDown} style={dragMarket.style()} ref={dragMarket.ref}>{dragMarket.handle}
            <header className="inv-head">
              <button type="button" className="mkt-back" onClick={back} aria-label={from === 'skins' ? 'Back to Skin Inventory' : from === 'resources' ? 'Back to Resource Inventory' : 'Back to the city'} data-testid="mkt-back">← Back<span className="mkt-back-to">{from === 'skins' ? ' to Skin Inventory' : from === 'resources' ? ' to Resource Inventory' : ' to city'}</span></button>
              <h2>🏪 Market</h2>
              <nav className="inv-tabs" role="tablist">
                {([['skins', '🎨 Skins'], ['resources', '⛏ Resources']] as const).map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setHist(false); }} data-testid={`mkt-tab-${k}`}>{t}</button>)}
                <button type="button" role="tab" aria-selected={hist} className={hist ? 'on' : ''} onClick={() => setHist(true)} data-testid="mkt-tab-hist">📈 My history</button>
              </nav>
              {!hist && tab === 'skins' && <nav className="inv-tabs mkt-subtabs">{([['listings', 'Listings'], ['sell', 'Sell'], ['trades', '🤝 Trades']] as const).map(([k, t]) => <button key={k} type="button" className={sub === k ? 'on' : ''} onClick={() => setSub(k)} data-testid={`mkt-sub-${k}`}>{t}</button>)}</nav>}
              <button type="button" className="ml-auto" aria-label="Close market" onClick={close}>✕</button>
            </header>
            {!hist && tab === 'skins' && sub === 'listings' && <MarketView onListYours={(id) => { setItem(id); setSub('sell'); }} />}
            {!hist && tab === 'skins' && sub === 'sell' && <SellSkins initial={item} onListed={() => setSub('listings')} />}
            {!hist && tab === 'skins' && sub === 'trades' && <TradesView seed={item} />}
            {!hist && tab === 'resources' && <MaterialsView initialSell={stack} />}
            {hist && <MyHistoryView />}
          </div>
        </div>
      )}
    </div>
  );
}

/** Pick one of your own skins / cases / keys and list it, or tick several (checkboxes, select all cases / keys, quantity) and list them all at one price each in one confirm. */
function SellSkins({ initial, onListed }: { initial: string | null; onListed: () => void }) {
  const account = useAccount();
  const [items, setItems] = useState<SkinItem[]>([]); const [sel, setSel] = useState<string | null>(initial);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const load = useCallback(() => { void request('inv_get', {}).then((r) => { const a = r as { ok: boolean; items?: SkinItem[] }; if (a.ok) setItems((a.items ?? []).filter((i) => !i.locked)); }); }, []);
  useEffect(() => { load(); socket.on('inv_changed', load); return () => { socket.off('inv_changed', load); }; }, [load, account]);
  useEffect(() => { setPicked((p) => { const live = new Set(items.map((i) => i.id)); const n = new Set([...p].filter((id) => live.has(id))); return n.size === p.size ? p : n; }); }, [items]);
  if (!account) return <p className="inv-note">Sign in to sell.</p>;
  const cur = items.find((i) => i.id === sel) ?? null;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const cases = items.filter((i) => i.kind === 'case'); const keys = items.filter((i) => i.kind === 'key');
  const allOf = (xs: SkinItem[]) => xs.length > 0 && xs.every((i) => picked.has(i.id));
  const setGroup = (xs: SkinItem[], on: boolean) => setPicked((p) => { const n = new Set(p); for (const i of xs) { if (on) n.add(i.id); else n.delete(i.id); } return n; });
  const chosen = items.filter((i) => picked.has(i.id));
  return (
    <>
      {(cases.length > 0 || keys.length > 0 || picked.size > 0) && <div className="mkt-bulkbar" data-testid="mkt-bulkbar">
        <span>Sell several at once:</span>
        {cases.length > 0 && <label><input type="checkbox" checked={allOf(cases)} onChange={(e) => setGroup(cases, e.target.checked)} data-testid="mkt-all-cases" /> All cases ({cases.length})</label>}
        {keys.length > 0 && <label><input type="checkbox" checked={allOf(keys)} onChange={(e) => setGroup(keys, e.target.checked)} data-testid="mkt-all-keys" /> All keys ({keys.length})</label>}
        {picked.size > 0 && <button type="button" onClick={() => setPicked(new Set())} data-testid="mkt-clear">Clear ({picked.size})</button>}
      </div>}
      <div className="inv-body" data-testid="mkt-sell-skins">
        <div className="inv-grid">{items.map((i) => <div key={i.id} className={`inv-cell mkt-pickcell ${sel === i.id ? 'sel' : ''} ${picked.has(i.id) ? 'picked' : ''}`}>
          <input type="checkbox" className="mkt-pickbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Select ${label(i)}`} data-testid="mkt-pick" />
          <button type="button" onClick={() => setSel(i.id)} title={label(i)}><Swatch item={i} size={72} /><span className="inv-name">{label(i)}</span></button></div>)}
          {!items.length && <p className="inv-note">Nothing to sell yet. Arena matches drop cases and keys.</p>}</div>
        <aside className="inv-detail">{chosen.length > 0 ? <BulkSellForm items={chosen} pool={{ case: cases, key: keys }} setGroupQty={(kind, n) => setPicked((p) => { const pool = kind === 'case' ? cases : keys; const nn = new Set([...p].filter((id) => !pool.some((x) => x.id === id))); for (const x of pool.slice(0, n)) nn.add(x.id); return nn; })} onDone={() => { setPicked(new Set()); onListed(); }} />
          : cur ? <><div className="inv-preview"><Swatch item={cur} size={160} /></div><h3>{label(cur)}</h3><SellForm item={cur} onDone={onListed} /></> : <p className="inv-note">Pick an item to list, or tick several to list them together.</p>}</aside>
      </div>
    </>
  );
}

/** One price per item for every ticked item; one confirm lists them all (server checks all first, then one transaction). */
function BulkSellForm({ items, pool, setGroupQty, onDone }: { items: SkinItem[]; pool: { case: SkinItem[]; key: SkinItem[] }; setGroupQty: (kind: 'case' | 'key', n: number) => void; onDone: () => void }) {
  const [price, setPrice] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false);
  const p = Math.floor(Number(price)); const n = items.length;
  const fee = p > 0 ? Math.max(1, Math.ceil(p * 0.05)) : 0;
  const counts = { case: items.filter((i) => i.kind === 'case').length, key: items.filter((i) => i.kind === 'key').length, skin: items.filter((i) => i.kind === 'skin').length };
  const fmt = (x: number) => x.toLocaleString();
  useEffect(() => { setConfirm(false); }, [n, p]);
  const go = () => { setBusy(true); setErr(''); void request('mkt_list_many', { ids: items.map((i) => i.id), price: p }).then((r) => { const a = r as { ok: boolean; error?: string }; setBusy(false); if (a.ok) onDone(); else { setErr(a.error ?? 'Failed'); setConfirm(false); } }); };
  return (
    <div className="mkt-sell mkt-bulk" data-testid="mkt-bulk">
      <h3>{n} selected</h3>
      {(['case', 'key'] as const).map((k) => pool[k].length > 0 && <label key={k} className="mkt-bulk-qty">{k === 'case' ? 'Cases' : 'Keys'} <input type="number" min={0} max={pool[k].length} value={counts[k]} onChange={(e) => setGroupQty(k, Math.max(0, Math.min(pool[k].length, Math.floor(Number(e.target.value)) || 0)))} data-testid={`mkt-qty-${k}`} /> <small>of {pool[k].length}</small></label>)}
      {counts.skin > 0 && <p className="inv-note">+ {counts.skin} skin{counts.skin > 1 ? 's' : ''}</p>}
      <label>Price each <input type="number" min={1} step={1} value={price} onChange={(e) => setPrice(e.target.value)} data-testid="mkt-bulk-price" /></label>
      {p > 0 && <span>Each lists separately at {fmt(p)}. If all sell you get {fmt(n * (p - fee))} (fee {fee} each)</span>}
      {!confirm ? <button type="button" disabled={!(p > 0) || busy} onClick={() => setConfirm(true)} data-testid="mkt-bulk-list">List {n} for {p > 0 ? fmt(p) : '…'} each</button>
        : <span className="mkt-confirm">List all {n} now? <button type="button" disabled={busy} onClick={go} data-testid="mkt-bulk-confirm">Confirm</button> <button type="button" onClick={() => setConfirm(false)}>Back</button></span>}
      {err && <p className="inv-err">{err}</p>}
    </div>
  );
}

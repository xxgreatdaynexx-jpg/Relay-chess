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

export type MarketTab = 'skins' | 'resources';
export type SkinsSub = 'listings' | 'sell' | 'trades';
export interface OpenMarket { tab?: MarketTab; sub?: SkinsSub; item?: string; stack?: string }
const EV = 'chud:open-market';
/** Open the Market tab from anywhere (Inventory "Sell on Market", Factory "Sell on Market", the hub). */
export function openMarket(o: OpenMarket = {}) { window.dispatchEvent(new CustomEvent<OpenMarket>(EV, { detail: o })); }
const atMarket = () => window.location.pathname === '/market' || window.location.hash === '#market';

export function MarketPage() {
  const [open, setOpen] = useState(atMarket);
  const [hist, setHist] = useState(false);
  const [tab, setTab] = useState<MarketTab>(() => (window.location.hash === '#market-resources' ? 'resources' : 'skins'));
  const [sub, setSub] = useState<SkinsSub>('listings'); const [item, setItem] = useState<string | null>(null); const [stack, setStack] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<OpenMarket>).detail ?? {}; setOpen(true); setHist(false); if (d.tab) setTab(d.tab); if (d.sub) setSub(d.sub); setItem(d.item ?? null); setStack(d.stack ?? null); };
    const pop = () => { if (atMarket()) setOpen(true); };
    window.addEventListener(EV, on); window.addEventListener('popstate', pop); window.addEventListener('hashchange', pop);
    return () => { window.removeEventListener(EV, on); window.removeEventListener('popstate', pop); window.removeEventListener('hashchange', pop); };
  }, []);
  const close = () => { setOpen(false); if (window.location.pathname === '/market' || window.location.hash.startsWith('#market')) history.replaceState(history.state, '', '/'); };
  return (
    <div data-testid="market-page">
      <TopTab id="market"><button type="button" className="sol-tab" aria-expanded={open} id="market-tab" onClick={() => (open ? close() : setOpen(true))} data-testid="market-tab">{open ? '▴ Market' : '🏪 Market'}</button></TopTab>
      {open && (
        <div className="inv-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="inv-win mkt-win" role="dialog" aria-label="Market">
            <header className="inv-head">
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

/** Pick one of your own skins / cases / keys and list it. */
function SellSkins({ initial, onListed }: { initial: string | null; onListed: () => void }) {
  const account = useAccount();
  const [items, setItems] = useState<SkinItem[]>([]); const [sel, setSel] = useState<string | null>(initial);
  const load = useCallback(() => { void request('inv_get', {}).then((r) => { const a = r as { ok: boolean; items?: SkinItem[] }; if (a.ok) setItems((a.items ?? []).filter((i) => !i.locked)); }); }, []);
  useEffect(() => { load(); socket.on('inv_changed', load); return () => { socket.off('inv_changed', load); }; }, [load, account]);
  if (!account) return <p className="inv-note">Sign in to sell.</p>;
  const cur = items.find((i) => i.id === sel) ?? null;
  return (
    <div className="inv-body" data-testid="mkt-sell-skins">
      <div className="inv-grid">{items.map((i) => <button type="button" key={i.id} className={`inv-cell ${sel === i.id ? 'sel' : ''}`} onClick={() => setSel(i.id)} title={label(i)}><Swatch item={i} size={72} /><span className="inv-name">{label(i)}</span></button>)}
        {!items.length && <p className="inv-note">Nothing to sell yet. Arena matches drop cases and keys.</p>}</div>
      <aside className="inv-detail">{cur ? <><div className="inv-preview"><Swatch item={cur} size={160} /></div><h3>{label(cur)}</h3><SellForm item={cur} onDone={onListed} /></> : <p className="inv-note">Pick an item to list.</p>}</aside>
    </div>
  );
}

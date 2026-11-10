import { sellBonusPct } from '../../../shared/coop';
import { houseSellPrice } from '../../../shared/sellBuff';
import { useDoing } from '@/lib/doing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ItemIcon } from './ItemIcon';
import { TopTab } from '@/components/TopTabs';
import { useWalletChips } from '@/lib/wallet';
import { useWindowDrag } from '@/lib/windowDrag';
import { socket } from '@/lib/net';
import { FactoryBuilder } from '@/components/FactoryBuilder';
import { openFactoryView } from '@/components/FactoryViewer';
type Ack = { ok: boolean; error?: string; storage?: Stack[]; quote?: unknown; inMine?: boolean; guest?: boolean };
import { openMarket } from '@/components/MarketPage';
import { SellQtyPicker } from './SellQtyPicker';
import { SellAllConfirm } from './SellAllConfirm';
import { sellAllSummary, sellAllText } from '../../../shared/sellConfirm';
import { usePriceIndex } from '@/lib/priceIndex';
import { ORES, SELL_TIERS, houseCapChips, HOUSE_DAILY_BASE, payoutFor, isOre, nameOf, priceOf, sellable, stackKey, type Stack } from '../../../shared/mines';
import { STORAGE_FILTER_KEY, STORAGE_FILTERS, STORAGE_SORT_KEY, STORAGE_SORTS, arrangeStorageStacks, isStorageFilter, isStorageSort, type StorageFilter, type StorageSort } from '../../../shared/storageList';

const OPEN_KEY = 'relay-factory-open';
type Quote = { gross: number; paid: number; already: number; lost?: number; effAlready?: number; index?: number; capBase?: number; capIndex?: number; sellBonus?: number } | null;

/** Factory tab: banked storage from the Mines, the house Sell desk (daily cap) and the furnace/workbench. */
export function FactoryPanel() {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1' || window.location.pathname === '/factory' || window.location.hash === '#factory');
  useEffect(() => localStorage.setItem(OPEN_KEY, open ? '1' : '0'), [open]);
  return (
    <div className={`mines-wrap factory-wrap ${open ? 'mines-open' : ''}`} data-testid="factory">
      <TopTab id="factory"><button type="button" className="sol-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="factory-tab">{open ? '▴ Factory' : '🏭 Factory'}</button></TopTab>
      {open && <FactoryWindow onClose={() => setOpen(false)} />}
    </div>
  );
}

function FactoryWindow({ onClose }: { onClose: () => void }) {
  useDoing('factory');
  const wrapRef = useRef<HTMLDivElement>(null);
  const win = useWindowDrag('factory', wrapRef);
  const wallet = useWalletChips();
  const [st, setSt] = useState<{ storage: Stack[]; quote: Quote; inMine: boolean; guest: boolean }>({ storage: [], quote: null, inMine: false, guest: true });
  const [toast, setToast] = useState('');
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => { fetch('/api/leaderboard').then((r) => r.json()).then((j: unknown) => { const rows = Array.isArray(j) ? j : (j as { rows?: unknown[] })?.rows; if (Array.isArray(rows)) setNames(rows.map((x) => (x as { name?: string }).name).filter((x): x is string => typeof x === 'string').slice(0, 200)); }).catch(() => {}); }, []);
  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast((c) => (c === t ? '' : c)), 2600); };
  const apply = (r: Ack) => setSt((c) => ({ storage: r.storage ?? c.storage, quote: (r.quote as Quote) ?? null, inMine: r.inMine ?? c.inMine, guest: r.guest ?? c.guest }));
  const refresh = () => socket.timeout(5000).emit('mines_storage', {}, (err: Error | null, r?: Ack) => { if (!err && r?.ok) apply(r); });
  useEffect(() => { refresh(); const t = window.setInterval(refresh, 4000); socket.on('connect', refresh); return () => { window.clearInterval(t); socket.off('connect', refresh); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [sort, setSort] = useState<StorageSort>(() => { try { const v = localStorage.getItem(STORAGE_SORT_KEY); return isStorageSort(v) ? v : 'name'; } catch { return 'name'; } });
  const [filter, setFilter] = useState<StorageFilter>(() => { try { const v = localStorage.getItem(STORAGE_FILTER_KEY); return isStorageFilter(v) ? v : 'all'; } catch { return 'all'; } });
  useEffect(() => { try { localStorage.setItem(STORAGE_SORT_KEY, sort); } catch { /* ignore */ } }, [sort]);
  useEffect(() => { try { localStorage.setItem(STORAGE_FILTER_KEY, filter); } catch { /* ignore */ } }, [filter]);
  function sell(only?: string, qty?: number) {
    return new Promise<void>((done) => socket.timeout(5000).emit('mines_sell', only ? { ore: only, ...(qty ? { qty } : {}) } : {}, (err: Error | null, r?: Ack & { paid: number }) => {
      done();
      if (err || !r) return flash('Sell failed, try again.');
      if (!r.ok) return flash(r.error ?? 'Sell failed.');
      apply(r); flash(`Sold for 🪙 ${r.paid}`);
    }));
  }
  const q = st.quote;
  const pxIdx = usePriceIndex();
  const sellIdx = q?.index ?? pxIdx;
  const capBase = q?.capBase ?? HOUSE_DAILY_BASE; const capIdx = q?.capIndex ?? pxIdx;
  const tier = q && (q.effAlready ?? q.already) >= capBase ? SELL_TIERS[SELL_TIERS.length - 1] : SELL_TIERS[0];
  const canSell = !st.guest && !st.inMine;
  const shown = useMemo(
    () => arrangeStorageStacks(st.storage, sort, filter, (s) => houseSellPrice(s) * sellIdx),
    [st.storage, sort, filter, sellIdx],
  );
  return (
    <div ref={wrapRef} className={`sol-panel factory-panel${win.className}`} style={win.style} onPointerDownCapture={win.front} onPointerMove={win.onPanelMove} role="dialog" aria-label="Factory">
      {win.grips}
      <div {...win.bar}>
        <span className="font-semibold">🏭 Factory</span>
        <span className="opacity-70">build, automate, sell</span>
        {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" onClick={win.reset}>⟲</button>}
        {wallet !== null && <span className="ml-auto text-xs font-semibold">🪙 {wallet.toLocaleString()}</span>}
        <button type="button" className={wallet === null ? 'ml-auto' : ''} aria-label="Close factory" onClick={onClose}>✕</button>
      </div>
      {confirmAll && q && <SellAllConfirm text={sellAllText(sellAllSummary(st.storage, q.paid))} onCancel={() => setConfirmAll(false)} onConfirm={() => { setConfirmAll(false); void sell(); }} />}
      {toast && <div className="factory-toast" data-testid="factory-toast">{toast}</div>}
      <div className="factory-body">
        <section className="factory-col factory-storage" data-testid="factory-storage">
          <h3>📦 Storage <button type="button" className="mkt-link" onClick={() => openMarket({ tab: 'resources' })} data-testid="factory-goto-market">Sell on Market →</button></h3>
          <div className="factory-storage-tools" data-testid="factory-storage-tools">
            <label className="factory-storage-sort">Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as StorageSort)} data-testid="factory-storage-sort" aria-label="Sort storage">
                {STORAGE_SORTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            <div className="factory-storage-filters" role="group" aria-label="Filter storage">
              {STORAGE_FILTERS.map((o) => (
                <button key={o.id} type="button" className={filter === o.id ? 'on' : ''} aria-pressed={filter === o.id} onClick={() => setFilter(o.id)} data-testid={`factory-storage-filter-${o.id}`}>{o.label}</button>
              ))}
            </div>
          </div>
          <ul className="factory-list">
            {shown.map((s) => (
              <li key={stackKey(s)}><ItemIcon type={s.type} id={s.id} />{nameOf(s)}<b>×{s.qty}</b><small data-testid="sell-unit">🪙{+(houseSellPrice(s) * sellIdx).toFixed(2)}</small>
                {canSell && sellable(s) && <button type="button" aria-expanded={pick === stackKey(s)} onClick={() => setPick((c) => (c === stackKey(s) ? null : stackKey(s)))} data-testid="factory-sell-pick">Sell…</button>}{!sellable(s) && (s.type === 'food' ? <small title="Pantry food: never sold to the house. Cook it, sell it on the Market, or feed it to a factory Input Chest (crops)">pantry</small> : <small title="Imported input: craft it in the factory to sell">craft</small>)}
                {canSell && sellable(s) && pick === stackKey(s) && <SellQtyPicker owned={s.qty} unit={nameOf(s)} testid="factory-qty" preview={(n) => Math.floor(payoutFor(n * houseSellPrice(s), q?.effAlready ?? q?.already ?? 0, capBase) * sellIdx)} onSell={(n) => sell(stackKey(s), n)} />}</li>
            ))}
            {!st.storage.length && <li className="opacity-60">Empty. Mine ore and walk out through the EXIT lift to bank it here.</li>}
            {!!st.storage.length && !shown.length && <li className="opacity-60">Nothing in this filter.</li>}
          </ul>
          <h3>🏦 Sell to the house</h3>
          {st.guest ? <p className="mines-note">Sign in to sell for chips.</p> : st.inMine ? <p className="mines-note" data-testid="factory-inmine">You're still in the mine. Leave the mine to sell.</p> : (
            <button type="button" className="mines-sell" disabled={!q || q.paid < 1} onClick={() => setConfirmAll(true)} data-testid="factory-sell">Sell all{q ? ` · 🪙 ${q.paid}` : ''}</button>
          )}
          <p className="mines-note">Sold today: {Math.floor(q?.already ?? 0)} · paying {Math.round(tier.rate * 100)}%. Daily cap today: full price up to 🪙 {Math.floor(houseCapChips(capIdx) * (1 + (q?.sellBonus ?? 0))).toLocaleString('en-US')} (100,000 × {capIdx.toFixed(4)}{(q?.sellBonus ?? 0) > 0 && <span data-testid="factory-sell-bonus"> × {(1 + q!.sellBonus!).toFixed(3)} 🏟️ Stadium donor bonus +{sellBonusPct(q!.sellBonus!)}%</span>}; moves each day by the % change in total player assets, never below 100,000), then nothing (resets 00:00 UTC).{(q?.lost ?? 0) > 0 && <> Room refunded today: +🪙 {Math.floor(q!.lost!).toLocaleString('en-US')} from chips you lost to the house (casino net losses, cars and car mods, property tax, resort tickets, race entries, mayor filing, Market seller fees, wealth tax, admin removals). Room left: 🪙 {Math.max(0, Math.floor((capBase - (q!.effAlready ?? q!.already)) * pxIdx)).toLocaleString('en-US')}.</>}</p>
        </section>
        <section className="factory-col factory-machines">
          <form className="factory-viewpick" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('who') ?? '').trim(); if (v) openFactoryView(v); }} data-testid="factory-view-picker">
            <input name="who" list="factory-view-names" placeholder="View a player's factory…" maxLength={40} className="rounded bg-black/30 px-2 py-0.5 text-xs" aria-label="Player name" />
            <datalist id="factory-view-names">{names.map((x) => <option key={x} value={x} />)}</datalist>
            <button type="submit" className="ml-1 rounded bg-white/10 px-2 py-0.5 text-xs">🏭 View</button>
          </form>
          <FactoryBuilder guest={st.guest} flash={flash} onStorage={(storage) => setSt((c) => ({ ...c, storage }))} />
        </section>
      </div>
    </div>
  );
}

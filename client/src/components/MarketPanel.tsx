/** Public skin Market (escrowed listings, 5% fee burned, cheapest first, price history) and player Trades. Server-authoritative: every action is a socket request validated server-side. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { request, socket } from '@/lib/net';
import { PriceChart, RecentSales } from './MarketCharts';
import { PAGE, sortCatalog, type CatEntry, type SortKey } from '@/lib/marketCatalog';
import { useAccount } from '@/lib/auth';
import { RARITY_COLOR, RARITY_NAME, SKIN_BY_ID, WEAPON_NAME, isKnife, wearOf, type SkinItem } from '../../../shared/skins';
import { Swatch, label, rarityOf } from './SkinsPanel';

type Ack = { ok: boolean; error?: string; [k: string]: unknown };
interface ListingView { id: string; price: number; seller: string; at: number; item: SkinItem }
interface History { what: string; sales: Array<{ price: number; at: number }>; count: number; avg: number | null; last: number | null }
interface TradeView { id: string; fromName: string; toName: string; giveChips: number; wantChips: number; giveItems: SkinItem[]; wantItems: SkinItem[]; at: number; counterOf?: string }
const whatOf = (i: SkinItem) => (i.kind === 'skin' ? i.skin : i.kind);
const chipsFmt = (n: number) => `${n.toLocaleString()} 🪙`;

function Cell({ item, sel, onClick, children }: { item: SkinItem; sel?: boolean; onClick?: () => void; children?: React.ReactNode }) {
  const r = rarityOf(item);
  return (
    <button type="button" className={`inv-cell ${sel ? 'sel' : ''} ${r ? `r-${r}` : 'r-item'} ${isKnife(SKIN_BY_ID.get(item.skin)) ? 'knife' : ''}`} style={{ '--rc': r ? RARITY_COLOR[r] : '#8a8f98' } as React.CSSProperties} onClick={onClick} title={label(item)}>
      <Swatch item={item} size={72} /><span className="inv-name">{label(item)}</span>{children}
    </button>
  );
}

const SORTS: Array<[SortKey, string]> = [['low', 'Lowest price'], ['high', 'Highest price'], ['name', 'Name'], ['rarity', 'Rarity'], ['most', 'Most listings'], ['recent', 'Recently sold']];
function Pager({ page, pages, set }: { page: number; pages: number; set: (n: number) => void }) {
  if (pages <= 1) return null;
  return <div className="mkt-pager" data-testid="mkt-pager"><button type="button" disabled={page <= 0} onClick={() => set(page - 1)}>‹</button><span>{page + 1} / {pages}</span><button type="button" disabled={page >= pages - 1} onClick={() => set(page + 1)}>›</button></div>;
}
const fakeItem = (e: CatEntry): SkinItem => ({ id: 'cat:' + e.what, kind: (e.kind ?? 'skin') as SkinItem['kind'], skin: e.kind === 'skin' ? e.what : '', float: 0.15, seed: 1, at: 0, source: 'catalog', equipped: false });
function useCatalog(side: 'skins' | 'resources', tick: number) {
  const [rows, setRows] = useState<CatEntry[]>([]);
  useEffect(() => { void request('mkt_catalog', { side }).then((r) => { const a = r as Ack; if (a.ok) setRows(a.items as CatEntry[]); }); }, [side, tick]);
  return rows;
}
function Controls({ q, setQ, sort, setSort, listed, setListed, children }: { q: string; setQ: (s: string) => void; sort: SortKey; setSort: (s: SortKey) => void; listed: boolean; setListed: (b: boolean) => void; children?: React.ReactNode }) {
  return (
    <div className="inv-filters">
      {children}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" data-testid="mkt-search" />
      <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} data-testid="mkt-sort">{SORTS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
      <label className="mkt-toggle"><input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} data-testid="mkt-listed-only" /> Listed only</label>
    </div>
  );
}

/** Skins sub-tab: the full catalog (every skin incl. pickaxe, case, key), listed or not. */
export function MarketView({ onListYours }: { onListYours?: (itemId: string) => void } = {}) {
  const account = useAccount();
  const [tick, setTick] = useState(0); const cat = useCatalog('skins', tick);
  const [rows, setRows] = useState<ListingView[]>([]); const [mine, setMine] = useState<ListingView[]>([]); const [owned, setOwned] = useState<SkinItem[]>([]);
  const [kind, setKind] = useState('all'); const [weapon, setWeapon] = useState('all'); const [rarity, setRarity] = useState('all'); const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('low'); const [listed, setListed] = useState(false); const [page, setPage] = useState(0);
  const [sel, setSel] = useState<string | null>(null); const [hist, setHist] = useState<History | null>(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = useCallback(() => {
    setTick((t) => t + 1);
    void request('mkt_browse', { limit: 10000 }).then((r) => { const a = r as Ack; if (a.ok) { setRows(a.listings as ListingView[]); setMine(a.mine as ListingView[]); } });
    void request('inv_get', {}).then((r) => { const a = r as Ack; if (a.ok) setOwned(((a.items as SkinItem[]) ?? []).filter((i) => !i.locked)); });
  }, []);
  useEffect(() => { load(); socket.on('inv_changed', load); return () => { socket.off('inv_changed', load); }; }, [load, account]);
  const view = useMemo(() => sortCatalog(cat, { q, listedOnly: listed, sort, match: (e) => (kind === 'all' || e.kind === kind) && (weapon === 'all' || e.weapon === weapon) && (rarity === 'all' || e.rarity === rarity) }), [cat, q, listed, sort, kind, weapon, rarity]);
  useEffect(() => setPage(0), [q, listed, sort, kind, weapon, rarity]);
  const pages = Math.max(1, Math.ceil(view.length / PAGE)); const shown = view.slice(page * PAGE, page * PAGE + PAGE);
  const cur = cat.find((e) => e.what === sel) ?? shown[0] ?? null;
  const what = cur?.what ?? '';
  useEffect(() => { if (!what) { setHist(null); return; } void request('mkt_history', { what }).then((r) => { if ((r as Ack).ok) setHist(r as unknown as History); }); }, [what]);
  const here = rows.filter((l) => whatOf(l.item) === what); const mineIds = new Set(mine.map((m) => m.id));
  const yours = owned.filter((i) => whatOf(i) === what);
  const act = async (ev: string, body: object, ok: string) => { setErr(''); setMsg(''); const r = (await request(ev, body)) as Ack; if (!r.ok) setErr(r.error ?? 'Failed'); else { setMsg(ok); load(); } };
  return (
    <>
      <Controls q={q} setQ={setQ} sort={sort} setSort={setSort} listed={listed} setListed={setListed}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="mkt-kind"><option value="all">Everything</option><option value="skin">Skins</option><option value="case">Cases</option><option value="key">Keys</option></select>
        <select value={weapon} onChange={(e) => setWeapon(e.target.value)} data-testid="mkt-weapon"><option value="all">All weapons</option>{['pistol', 'smg', 'shotgun', 'sniper', 'rocket', 'ar15', 'knife', 'pickaxe'].map((w) => <option key={w} value={w}>{WEAPON_NAME[w] ?? w}</option>)}</select>
        <select value={rarity} onChange={(e) => setRarity(e.target.value)}><option value="all">All rarities</option>{(['common', 'rare', 'ultra'] as const).map((r) => <option key={r} value={r}>{RARITY_NAME[r]}</option>)}</select>
      </Controls>
      <div className="inv-body">
        <div className="inv-grid" data-testid="mkt-grid">
          <p className="mkt-sub">{view.length} items · {view.filter((e) => e.listings).length} listed</p>
          {shown.map((e) => <Cell key={e.what} item={fakeItem(e)} sel={cur?.what === e.what} onClick={() => setSel(e.what)}>
            <span className="mkt-price">{e.lowest != null ? chipsFmt(e.lowest) : <span className="mkt-none">No listings{e.last != null ? ` · last ${e.last.toLocaleString()}` : ''}</span>}</span>{e.listings > 0 && <span className="mkt-count">{e.listings}</span>}</Cell>)}
          {!shown.length && <p className="inv-note">Nothing matches.</p>}
          <Pager page={page} pages={pages} set={setPage} />
        </div>
        <aside className="inv-detail" data-testid="mkt-detail">
          {cur ? <>
            <div className="inv-preview" style={{ '--rc': cur.rarity ? RARITY_COLOR[cur.rarity] : '#8a8f98' } as React.CSSProperties}><Swatch item={fakeItem(cur)} size={180} /></div>
            <h3>{cur.name}</h3>
            <p className="mkt-stats">Lowest now: {cur.lowest != null ? chipsFmt(cur.lowest) : '—'} · Last sale: {cur.last != null ? chipsFmt(cur.last) : '—'} · Avg: {hist?.avg != null ? chipsFmt(hist.avg) : '—'} · {cur.listings} listed</p>
            {!here.length && <p className="inv-note">No listings.</p>}
            <ul className="mkt-listings">{here.slice(0, 20).map((l) => <li key={l.id}>{l.item.kind === 'skin' && <small>{wearOf(l.item.float).name} · {l.item.float.toFixed(4)} </small>}<b>{chipsFmt(l.price)}</b> <small>{l.seller}</small>
              {mineIds.has(l.id) ? <button type="button" onClick={() => void act('mkt_cancel', { id: l.id }, 'Listing cancelled; item back in your inventory.')} data-testid="mkt-cancel">Cancel</button>
                : <button type="button" disabled={!account} onClick={() => void act('mkt_buy', { id: l.id }, `Bought ${label(l.item)}!`)} data-testid="mkt-buy">{account ? 'Buy' : 'Sign in'}</button>}</li>)}</ul>
            {account && yours.length > 0 && <button type="button" onClick={() => onListYours?.(yours[0]!.id)} data-testid="mkt-list-yours">List yours ({yours.length})</button>}
            {what && <PriceChart what={what} />}
            {what && <RecentSales what={what} />}
            <p className="inv-note">Sellers get the price minus a 5% fee (burned).</p>
          </> : <p className="inv-note">Select an item.</p>}
          {msg && <p className="mkt-ok">{msg}</p>}{err && <p className="inv-err">{err}</p>}
        </aside>
      </div>
    </>
  );
}

interface StackRow { id: string; type: string; itemId: string; name: string; color?: string; qty: number; total: number; unit: number; seller: string; mine: boolean }
const ORE_COLOR: Record<string, string> = { stone: '#8a8580', coal: '#2e2e33', copper: '#d9793d', iron: '#b0a090', silver: '#e8edf2', gold: '#ffcf3a', crystal: '#c070ff', diamond: '#9ff6ff' };
const Chip = ({ r }: { r: { type?: string; itemId?: string; id?: string; color?: string } }) => <span className="mkt-mat" style={{ background: r.color ?? ORE_COLOR[(r.itemId ?? r.id)!] ?? '#888' }} aria-hidden>{r.type === 'ore' ? '⛏' : r.type === 'bar' ? '▬' : '⚙'}</span>;

/** Resources sub-tab: every ore / bar / good, listed or not; unit-price listings, partial buys, 5% fee. */
export function MaterialsView({ initialSell }: { initialSell?: string | null } = {}) {
  const account = useAccount();
  const [tick, setTick] = useState(0); const cat = useCatalog('resources', tick);
  const [rows, setRows] = useState<StackRow[]>([]); const [pack, setPack] = useState<Array<{ type: string; id: string; qty: number; name: string }>>([]);
  const [type, setType] = useState('all'); const [q, setQ] = useState(''); const [sort, setSort] = useState<SortKey>('name'); const [listed, setListed] = useState(false); const [page, setPage] = useState(0);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<string | null>(initialSell ? `stack:${initialSell}` : null); const [sell, setSell] = useState(initialSell ?? ''); const [sq, setSq] = useState(''); const [su, setSu] = useState('');
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = useCallback(() => {
    setTick((t) => t + 1);
    void request('mkt_stacks', {}).then((r) => { const a = r as Ack; if (a.ok) setRows(a.listings as StackRow[]); });
    void request('mkt_my_stacks', {}).then((r) => { const a = r as Ack; if (a.ok) setPack(a.stacks as typeof pack); });
  }, []);
  useEffect(() => { load(); }, [load, account]);
  const view = useMemo(() => sortCatalog(cat, { q, listedOnly: listed, sort, match: (e) => type === 'all' || e.type === type }), [cat, q, listed, sort, type]);
  useEffect(() => setPage(0), [q, listed, sort, type]);
  const pages = Math.max(1, Math.ceil(view.length / PAGE)); const shown = view.slice(page * PAGE, page * PAGE + PAGE);
  const cur = cat.find((e) => e.what === pick) ?? shown[0] ?? null;
  const here = cur ? rows.filter((r) => `stack:${r.type}:${r.itemId}` === cur.what) : [];
  const act = async (ev: string, body: object, ok: string) => { setErr(''); setMsg(''); const r = (await request(ev, body)) as Ack; if (!r.ok) setErr(r.error ?? 'Failed'); else { setMsg(ok); load(); } };
  const s = pack.find((p) => `${p.type}:${p.id}` === sell); const n = Math.floor(Number(sq)), u = Math.floor(Number(su));
  const fee = n > 0 && u > 0 ? Math.max(1, Math.ceil(n * u * 0.05)) : 0;
  const owns = cur ? pack.find((p) => `stack:${p.type}:${p.id}` === cur.what) : undefined;
  return (
    <div className="mkt-mats" data-testid="mkt-mats">
      <Controls q={q} setQ={setQ} sort={sort} setSort={setSort} listed={listed} setListed={setListed}>
        <select value={type} onChange={(e) => setType(e.target.value)} data-testid="mkt-type"><option value="all">All resources</option><option value="ore">Ore</option><option value="bar">Bars</option><option value="good">Goods</option></select>
      </Controls>
      {msg && <p className="mkt-ok">{msg}</p>}{err && <p className="inv-err">{err}</p>}
      <table className="mkt-table" data-testid="mkt-res-catalog"><thead><tr><th>Item</th><th>Lowest</th><th>Listings</th><th>Last sale</th></tr></thead><tbody>
        {shown.map((e) => <tr key={e.what} className={cur?.what === e.what ? 'sel' : ''} onClick={() => setPick(e.what)} style={{ cursor: 'pointer' }}><td><Chip r={e} /> {e.name}</td><td>{e.lowest != null ? chipsFmt(e.lowest) : <span className="mkt-none">No listings</span>}</td><td>{e.listings}</td><td>{e.last != null ? chipsFmt(e.last) : '—'}</td></tr>)}
        {!shown.length && <tr><td colSpan={4} className="inv-note">Nothing matches.</td></tr>}
      </tbody></table>
      <Pager page={page} pages={pages} set={setPage} />
      {cur && <div className="mkt-mat-detail" data-testid="mkt-mat-detail">
        <h3><Chip r={cur} /> {cur.name}</h3>
        <table className="mkt-table"><thead><tr><th>Unit</th><th>Left</th><th>Seller</th><th /></tr></thead><tbody>
          {here.map((r) => { const k = Math.max(1, Math.min(r.qty, Math.floor(Number(qty[r.id] ?? 1)) || 1)); return (
            <tr key={r.id}><td>{chipsFmt(r.unit)}</td><td>{r.qty}/{r.total}</td><td>{r.seller}</td><td>
              {r.mine ? <button type="button" onClick={() => void act('mkt_cancel_stack', { id: r.id }, 'Cancelled; items back in storage.')}>Cancel</button>
                : <><input type="number" min={1} max={r.qty} value={qty[r.id] ?? '1'} onChange={(e) => setQty({ ...qty, [r.id]: e.target.value })} style={{ width: 64 }} />
                  <button type="button" disabled={!account} onClick={() => void act('mkt_buy_stack', { id: r.id, qty: k }, `Bought ${k} ${r.name}.`)}>Buy {chipsFmt(k * r.unit)}</button></>}
            </td></tr>); })}
          {!here.length && <tr><td colSpan={4} className="inv-note">No listings{cur.last != null ? ` · last sale ${chipsFmt(cur.last)}` : ''}.</td></tr>}
        </tbody></table>
        {account && owns && <button type="button" onClick={() => setSell(`${owns.type}:${owns.id}`)} data-testid="mkt-list-yours">List yours (×{owns.qty})</button>}
        <PriceChart what={cur.what} /><RecentSales what={cur.what} />
      </div>}
      {account && <div className="mkt-sell">
        <select value={sell} onChange={(e) => setSell(e.target.value)} data-testid="mkt-mat-pick"><option value="">Sell from storage…</option>{pack.map((p) => <option key={`${p.type}:${p.id}`} value={`${p.type}:${p.id}`}>{p.name} ×{p.qty}</option>)}</select>
        <label>Qty <input type="number" min={1} max={s?.qty} value={sq} onChange={(e) => setSq(e.target.value)} style={{ width: 70 }} /></label>
        <label>Unit price <input type="number" min={1} value={su} onChange={(e) => setSu(e.target.value)} style={{ width: 80 }} /></label>
        {fee > 0 && <span>You get up to {chipsFmt(n * u - fee)} (fee {fee})</span>}
        <button type="button" disabled={!s || !(n > 0) || !(u > 0)} onClick={() => s && void act('mkt_list_stack', { type: s.type, id: s.id, qty: n, unit: u }, `Listed ${n} ${s.name}.`)}>List</button>
      </div>}
      <p className="inv-note">Ore, bars and goods from the Mines. Buy any amount; sellers pay a 5% fee (burned). Listed items leave your storage until sold or cancelled.</p>
    </div>
  );
}

/** Small inline form used by Sell in the inventory detail pane. */
export function SellForm({ item, onDone }: { item: SkinItem; onDone: () => void }) {
  const [price, setPrice] = useState(''); const [err, setErr] = useState(''); const [hist, setHist] = useState<History | null>(null);
  useEffect(() => { void request('mkt_history', { what: whatOf(item) }).then((r) => { if ((r as Ack).ok) setHist(r as unknown as History); }); }, [item]);
  const p = Math.floor(Number(price));
  const fee = p > 0 ? Math.max(1, Math.ceil(p * 0.05)) : 0;
  return (
    <div className="mkt-sell" data-testid="mkt-sell">
      <label>Price <input type="number" min={1} step={1} value={price} onChange={(e) => setPrice(e.target.value)} data-testid="mkt-price" /></label>
      {p > 0 && <span>You get {chipsFmt(p - fee)} (fee {fee})</span>}
      {hist?.last != null && <span className="mkt-stats">Last sale {chipsFmt(hist.last)}</span>}
      <button type="button" disabled={!(p > 0)} onClick={() => void request('mkt_list', { id: item.id, price: p }).then((r) => { const a = r as Ack; if (a.ok) onDone(); else setErr(a.error ?? 'Failed'); })} data-testid="mkt-list">List</button>
      {err && <p className="inv-err">{err}</p>}
    </div>
  );
}

function Pick({ items, chosen, toggle }: { items: SkinItem[]; chosen: Set<string>; toggle: (id: string) => void }) {
  return <div className="trade-pick">{items.map((i) => <Cell key={i.id} item={i} sel={chosen.has(i.id)} onClick={() => toggle(i.id)}>{chosen.has(i.id) && <span className="inv-badge">✓</span>}</Cell>)}{!items.length && <p className="inv-note">No tradable items.</p>}</div>;
}

export function TradesView({ seed }: { seed?: string | null }) {
  const account = useAccount();
  const [inc, setInc] = useState<TradeView[]>([]); const [out, setOut] = useState<TradeView[]>([]);
  const [mineItems, setMineItems] = useState<SkinItem[]>([]); const [theirItems, setTheirItems] = useState<SkinItem[]>([]);
  const [to, setTo] = useState(''); const [give, setGive] = useState<Set<string>>(new Set(seed ? [seed] : [])); const [want, setWant] = useState<Set<string>>(new Set());
  const [gc, setGc] = useState(''); const [wc, setWc] = useState(''); const [counterOf, setCounterOf] = useState<string | null>(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [composing, setComposing] = useState(!!seed);
  const load = useCallback(() => {
    void request('trade_list', {}).then((r) => { const a = r as Ack; if (a.ok) { setInc(a.incoming as TradeView[]); setOut(a.outgoing as TradeView[]); } });
    void request('inv_get', {}).then((r) => { const a = r as Ack; if (a.ok) setMineItems(((a.items as SkinItem[]) ?? []).filter((i) => !i.locked)); });
  }, []);
  useEffect(() => { load(); socket.on('trade_changed', load); socket.on('inv_changed', load); return () => { socket.off('trade_changed', load); socket.off('inv_changed', load); }; }, [load, account]);
  const peek = (name: string) => { setTheirItems([]); if (name.trim()) void request('trade_peek', { name }).then((r) => { const a = r as Ack; if (a.ok) setTheirItems(a.items as SkinItem[]); else setErr(a.error ?? ''); }); };
  const tog = (s: Set<string>, set: (x: Set<string>) => void) => (id: string) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); set(n); };
  const reset = () => { setComposing(false); setCounterOf(null); setGive(new Set()); setWant(new Set()); setGc(''); setWc(''); setTo(''); setTheirItems([]); };
  const act = async (ev: string, body: object, ok: string) => { setErr(''); setMsg(''); const r = (await request(ev, body)) as Ack; if (!r.ok) { setErr(r.error ?? 'Failed'); return false; } setMsg(ok); load(); return true; };
  const send = async () => {
    const body = { give: [...give], want: [...want], giveChips: Number(gc) || 0, wantChips: Number(wc) || 0 };
    if (await (counterOf ? act('trade_counter', { id: counterOf, ...body }, 'Counter-offer sent.') : act('trade_offer', { to, ...body }, `Offer sent to ${to}.`))) reset();
  };
  const startCounter = (t: TradeView) => { setComposing(true); setCounterOf(t.id); setTo(t.fromName); peek(t.fromName); setGive(new Set(t.wantItems.map((i) => i.id))); setWant(new Set(t.giveItems.map((i) => i.id))); setGc(String(t.wantChips || '')); setWc(String(t.giveChips || '')); };
  if (!account) return <p className="inv-note">Sign in to trade.</p>;
  const side = (items: SkinItem[], chips: number) => <div className="trade-side">{items.map((i) => <Cell key={i.id} item={i} />)}{chips > 0 && <span className="mkt-price">+ {chipsFmt(chips)}</span>}{!items.length && !chips && <span className="inv-note">nothing</span>}</div>;
  return (
    <div className="trades" data-testid="trades">
      {msg && <p className="mkt-ok">{msg}</p>}{err && <p className="inv-err">{err}</p>}
      {!composing && <button type="button" onClick={() => setComposing(true)} data-testid="trade-new">New trade offer</button>}
      {composing && <section className="trade-compose" data-testid="trade-compose">
        <h4>{counterOf ? `Counter-offer to ${to}` : 'New trade offer'}</h4>
        {!counterOf && <label>To player <input value={to} onChange={(e) => setTo(e.target.value)} onBlur={() => peek(to)} placeholder="Exact player name" data-testid="trade-to" /></label>}
        <div className="trade-cols">
          <div><h5>You give</h5><Pick items={mineItems.filter((i) => !i.locked || give.has(i.id))} chosen={give} toggle={tog(give, setGive)} /><label>+ chips <input type="number" min={0} value={gc} onChange={(e) => setGc(e.target.value)} data-testid="trade-gc" /></label></div>
          <div><h5>You get{to ? ` from ${to}` : ''}</h5><Pick items={theirItems} chosen={want} toggle={tog(want, setWant)} /><label>+ chips <input type="number" min={0} value={wc} onChange={(e) => setWc(e.target.value)} data-testid="trade-wc" /></label></div>
        </div>
        <div className="inv-actions"><button type="button" onClick={() => void send()} disabled={!to.trim()} data-testid="trade-send">Send offer</button><button type="button" onClick={reset}>Discard</button></div>
        <p className="inv-note">Your items and chips are held until the offer is accepted, declined or cancelled. The swap happens all at once.</p>
      </section>}
      <h4>Incoming ({inc.length})</h4>
      {inc.map((t) => <div key={t.id} className="trade-row" data-testid="trade-in"><div><b>{t.fromName}</b> gives {side(t.giveItems, t.giveChips)}</div><div>for your {side(t.wantItems, t.wantChips)}</div>
        <div className="inv-actions"><button type="button" onClick={() => void act('trade_accept', { id: t.id }, 'Trade complete!')} data-testid="trade-accept">Accept</button><button type="button" onClick={() => startCounter(t)}>Counter</button><button type="button" onClick={() => void act('trade_decline', { id: t.id }, 'Declined.')}>Decline</button></div></div>)}
      <h4>Outgoing ({out.length})</h4>
      {out.map((t) => <div key={t.id} className="trade-row" data-testid="trade-out"><div>To <b>{t.toName}</b>: you give {side(t.giveItems, t.giveChips)}</div><div>for {side(t.wantItems, t.wantChips)}</div>
        <div className="inv-actions"><button type="button" onClick={() => void act('trade_cancel', { id: t.id }, 'Offer cancelled; items and chips returned.')}>Cancel</button></div></div>)}
    </div>
  );
}

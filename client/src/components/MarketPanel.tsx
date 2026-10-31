/** Public skin Market (escrowed listings, 5% fee burned, cheapest first, price history) and player Trades. Server-authoritative: every action is a socket request validated server-side. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { request, socket } from '@/lib/net';
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

function Spark({ h }: { h: History }) {
  if (h.sales.length < 2) return null;
  const ps = h.sales.map((s) => s.price); const lo = Math.min(...ps), hi = Math.max(...ps), W = 220, H = 50;
  const pts = ps.map((p, i) => `${(i / (ps.length - 1)) * W},${H - ((p - lo) / (hi - lo || 1)) * (H - 6) - 3}`).join(' ');
  return <svg className="mkt-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} data-testid="mkt-spark"><polyline points={pts} fill="none" stroke="#7cf" strokeWidth="2" /></svg>;
}

export function MarketView() {
  const account = useAccount();
  const [rows, setRows] = useState<ListingView[]>([]);
  const [mine, setMine] = useState<ListingView[]>([]);
  const [kind, setKind] = useState('all'); const [weapon, setWeapon] = useState('all'); const [rarity, setRarity] = useState('all'); const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null); const [hist, setHist] = useState<History | null>(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = useCallback(() => { void request('mkt_browse', { kind, weapon, rarity, q }).then((r) => { const a = r as Ack; if (a.ok) { setRows(a.listings as ListingView[]); setMine(a.mine as ListingView[]); } }); }, [kind, weapon, rarity, q]);
  useEffect(() => { load(); socket.on('inv_changed', load); return () => { socket.off('inv_changed', load); }; }, [load, account]);
  const cur = rows.find((r) => r.id === sel) ?? mine.find((r) => r.id === sel) ?? rows[0] ?? null;
  const what = cur ? whatOf(cur.item) : '';
  useEffect(() => { if (!what) { setHist(null); return; } void request('mkt_history', { what }).then((r) => { if ((r as Ack).ok) setHist(r as unknown as History); }); }, [what]);
  const lowest = useMemo(() => (cur ? rows.filter((r) => whatOf(r.item) === what)[0]?.price ?? null : null), [rows, cur, what]);
  const act = async (ev: string, body: object, ok: string) => { setErr(''); setMsg(''); const r = (await request(ev, body)) as Ack; if (!r.ok) setErr(r.error ?? 'Failed'); else { setMsg(ok); load(); } };
  const isMine = cur && mine.some((m) => m.id === cur.id);
  return (
    <>
      <div className="inv-filters">
        <select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="mkt-kind"><option value="all">Everything</option><option value="skin">Skins</option><option value="case">Cases</option><option value="key">Keys</option></select>
        <select value={weapon} onChange={(e) => setWeapon(e.target.value)}><option value="all">All weapons</option>{['pistol', 'smg', 'shotgun', 'sniper', 'rocket', 'ar15', 'knife'].map((w) => <option key={w} value={w}>{WEAPON_NAME[w]}</option>)}</select>
        <select value={rarity} onChange={(e) => setRarity(e.target.value)}><option value="all">All rarities</option>{(['common', 'rare', 'ultra'] as const).map((r) => <option key={r} value={r}>{RARITY_NAME[r]}</option>)}</select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search listings" />
      </div>
      <div className="inv-body">
        <div className="inv-grid" data-testid="mkt-grid">
          {mine.length > 0 && <p className="mkt-sub">Your listings</p>}
          {mine.map((l) => <Cell key={'m' + l.id} item={l.item} sel={cur?.id === l.id} onClick={() => setSel(l.id)}><span className="mkt-price">{chipsFmt(l.price)}</span></Cell>)}
          {mine.length > 0 && <p className="mkt-sub">All listings · cheapest first</p>}
          {rows.map((l) => <Cell key={l.id} item={l.item} sel={cur?.id === l.id} onClick={() => setSel(l.id)}><span className="mkt-price">{chipsFmt(l.price)}</span></Cell>)}
          {!rows.length && <p className="inv-note">No listings match. List something from your inventory with Sell.</p>}
        </div>
        <aside className="inv-detail" data-testid="mkt-detail">
          {cur ? <>
            <div className="inv-preview" style={{ '--rc': rarityOf(cur.item) ? RARITY_COLOR[rarityOf(cur.item)!] : '#8a8f98' } as React.CSSProperties}><Swatch item={cur.item} size={180} /></div>
            <h3>{label(cur.item)}</h3>
            {cur.item.kind === 'skin' && <p>{wearOf(cur.item.float).name} · float {cur.item.float.toFixed(5)} · #{cur.item.seed}</p>}
            <p><strong className="mkt-big">{chipsFmt(cur.price)}</strong> · seller {cur.seller}</p>
            <p className="mkt-stats">Lowest now: {lowest != null ? chipsFmt(lowest) : '—'} · Last sale: {hist?.last != null ? chipsFmt(hist.last) : '—'} · Avg: {hist?.avg != null ? chipsFmt(hist.avg) : '—'} · {hist?.count ?? 0} sold</p>
            {hist && <Spark h={hist} />}
            <div className="inv-actions">
              {isMine ? <button type="button" onClick={() => void act('mkt_cancel', { id: cur.id }, 'Listing cancelled; item back in your inventory.')} data-testid="mkt-cancel">Cancel listing</button>
                : <button type="button" disabled={!account} onClick={() => void act('mkt_buy', { id: cur.id }, `Bought ${label(cur.item)}!`)} data-testid="mkt-buy">{account ? `Buy for ${chipsFmt(cur.price)}` : 'Sign in to buy'}</button>}
            </div>
            <p className="inv-note">Sellers get the price minus a 5% fee (burned).</p>
          </> : <p className="inv-note">Select a listing.</p>}
          {msg && <p className="mkt-ok">{msg}</p>}{err && <p className="inv-err">{err}</p>}
        </aside>
      </div>
    </>
  );
}

interface StackRow { id: string; type: string; itemId: string; name: string; color?: string; qty: number; total: number; unit: number; seller: string; mine: boolean }
const ORE_COLOR: Record<string, string> = { stone: '#8a8580', coal: '#2e2e33', copper: '#d9793d', iron: '#b0a090', silver: '#e8edf2', gold: '#ffcf3a', crystal: '#c070ff', diamond: '#9ff6ff' };
const Chip = ({ r }: { r: { type: string; itemId?: string; id?: string; color?: string } }) => <span className="mkt-mat" style={{ background: r.color ?? ORE_COLOR[(r.itemId ?? r.id)!] ?? '#888' }} aria-hidden>{r.type === 'ore' ? '⛏' : r.type === 'bar' ? '▬' : '⚙'}</span>;

/** Mines materials (ore / bars / goods): unit-price listings, partial buys, same 5% fee. */
export function MaterialsView() {
  const account = useAccount();
  const [rows, setRows] = useState<StackRow[]>([]); const [pack, setPack] = useState<Array<{ type: string; id: string; qty: number; name: string }>>([]);
  const [type, setType] = useState('all'); const [qty, setQty] = useState<Record<string, string>>({});
  const [sell, setSell] = useState(''); const [sq, setSq] = useState(''); const [su, setSu] = useState('');
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = useCallback(() => {
    void request('mkt_stacks', { type }).then((r) => { const a = r as Ack; if (a.ok) setRows(a.listings as StackRow[]); });
    void request('mkt_my_stacks', {}).then((r) => { const a = r as Ack; if (a.ok) setPack(a.stacks as typeof pack); });
  }, [type]);
  useEffect(() => { load(); }, [load, account]);
  const act = async (ev: string, body: object, ok: string) => { setErr(''); setMsg(''); const r = (await request(ev, body)) as Ack; if (!r.ok) setErr(r.error ?? 'Failed'); else { setMsg(ok); load(); } };
  const s = pack.find((p) => `${p.type}:${p.id}` === sell); const n = Math.floor(Number(sq)), u = Math.floor(Number(su));
  const fee = n > 0 && u > 0 ? Math.max(1, Math.ceil(n * u * 0.05)) : 0;
  return (
    <div className="mkt-mats" data-testid="mkt-mats">
      <div className="inv-filters">
        <select value={type} onChange={(e) => setType(e.target.value)}><option value="all">All materials</option><option value="ore">Ore</option><option value="bar">Bars</option><option value="good">Goods</option></select>
        {msg && <span className="mkt-ok">{msg}</span>}{err && <span className="inv-err">{err}</span>}
      </div>
      <table className="mkt-table"><thead><tr><th>Item</th><th>Unit</th><th>Left</th><th>Seller</th><th /></tr></thead><tbody>
        {rows.map((r) => { const q = Math.max(1, Math.min(r.qty, Math.floor(Number(qty[r.id] ?? 1)) || 1)); return (
          <tr key={r.id}><td><Chip r={r} /> {r.name}</td><td>{chipsFmt(r.unit)}</td><td>{r.qty}/{r.total}</td><td>{r.seller}</td><td>
            {r.mine ? <button type="button" onClick={() => void act('mkt_cancel_stack', { id: r.id }, 'Cancelled; items back in your backpack.')}>Cancel</button>
              : <><input type="number" min={1} max={r.qty} value={qty[r.id] ?? '1'} onChange={(e) => setQty({ ...qty, [r.id]: e.target.value })} style={{ width: 64 }} />
                <button type="button" disabled={!account} onClick={() => void act('mkt_buy_stack', { id: r.id, qty: q }, `Bought ${q} ${r.name}.`)}>Buy {chipsFmt(q * r.unit)}</button></>}
          </td></tr>); })}
        {!rows.length && <tr><td colSpan={5} className="inv-note">No material listings yet.</td></tr>}
      </tbody></table>
      {account && <div className="mkt-sell">
        <select value={sell} onChange={(e) => setSell(e.target.value)} data-testid="mkt-mat-pick"><option value="">Sell from backpack…</option>{pack.map((p) => <option key={`${p.type}:${p.id}`} value={`${p.type}:${p.id}`}>{p.name} ×{p.qty}</option>)}</select>
        <label>Qty <input type="number" min={1} max={s?.qty} value={sq} onChange={(e) => setSq(e.target.value)} style={{ width: 70 }} /></label>
        <label>Unit price <input type="number" min={1} value={su} onChange={(e) => setSu(e.target.value)} style={{ width: 80 }} /></label>
        {fee > 0 && <span>You get up to {chipsFmt(n * u - fee)} (fee {fee})</span>}
        <button type="button" disabled={!s || !(n > 0) || !(u > 0)} onClick={() => s && void act('mkt_list_stack', { type: s.type, id: s.id, qty: n, unit: u }, `Listed ${n} ${s.name}.`)}>List</button>
      </div>}
      <p className="inv-note">Ore, bars and goods from the Mines. Buy any amount; sellers pay a 5% fee (burned). Listed items leave your backpack until sold or cancelled.</p>
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

/** Skin market (escrowed listings, 5% fee burned) and player-to-player trade offers. Chips move only through the wallet ledger. */
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { getBank } from './casino-store.js';
import { getAccounts } from './accounts.js';
import { getVault, playerKey, RuleError, type ItemVault, type Stmt, type StoredItem } from './skins.js';
import { getMines } from './mines.js';
import { GOODS, isOre, nameOf as stackName, type ItemType } from '../shared/mines.js';
import { CASE_NAME, KEY_NAME, SKIN_BY_ID, type SkinItem } from '../shared/skins.js';

export const MARKET_FEE = 0.05;
export const MIN_PRICE = 1;
export const MAX_PRICE = 1_000_000;
export const MAX_LISTINGS = 50;
export const MAX_TRADES = 20;
export const MAX_TRADE_ITEMS = 20;
export const feeOf = (price: number) => Math.max(1, Math.ceil(price * MARKET_FEE));

export interface Listing { id: string; seller: string; sellerName: string; itemId: string; price: number; status: 'active' | 'sold' | 'cancelled'; at: number; closedAt?: number; buyer?: string }
export interface Sale { id: string; listingId: string; itemId: string; what: string; price: number; fee: number; seller: string; buyer: string; at: number }
export interface Trade { id: string; from: string; fromName: string; to: string; toName: string; give: string[]; want: string[]; giveChips: number; wantChips: number; status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'countered'; at: number; closedAt?: number; counterOf?: string }

export const MAX_STACK_QTY = 100_000;
/** Stackable listing (Mines ore / bars / goods from mine_items): unit price, partial buys. Escrowed qty leaves the seller's pack. */
export interface StackListing { id: string; seller: string; sellerName: string; type: ItemType; itemId: string; qty: number; total: number; unit: number; status: 'active' | 'sold' | 'cancelled'; at: number; closedAt?: number; sold: number }
export const stackWhat = (type: string, id: string) => `stack:${type}:${id}`;
export const isStackable = (type: unknown, id: unknown): type is ItemType => typeof id === 'string' && ((type === 'ore' && isOre(id)) || ((type === 'bar' || type === 'good') && GOODS[id]?.type === type));
export const MARKET_MIGRATION = [
  `CREATE TABLE IF NOT EXISTS market_listings (id TEXT PRIMARY KEY, seller_key TEXT NOT NULL, seller_name TEXT NOT NULL, item_id TEXT NOT NULL, price INTEGER NOT NULL, status TEXT NOT NULL, buyer_key TEXT, created_at BIGINT NOT NULL, closed_at BIGINT)`,
  `CREATE TABLE IF NOT EXISTS market_sales (id TEXT PRIMARY KEY, listing_id TEXT NOT NULL UNIQUE, item_id TEXT NOT NULL, what TEXT NOT NULL, price INTEGER NOT NULL, fee INTEGER NOT NULL, seller_key TEXT NOT NULL, buyer_key TEXT NOT NULL, at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS trade_offers (id TEXT PRIMARY KEY, from_key TEXT NOT NULL, from_name TEXT NOT NULL, to_key TEXT NOT NULL, to_name TEXT NOT NULL, give_items TEXT NOT NULL, want_items TEXT NOT NULL, give_chips INTEGER NOT NULL, want_chips INTEGER NOT NULL, status TEXT NOT NULL, created_at BIGINT NOT NULL, closed_at BIGINT)`,
  `CREATE TABLE IF NOT EXISTS market_stack_listings (id TEXT PRIMARY KEY, seller_key TEXT NOT NULL, seller_name TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, qty_left INTEGER NOT NULL, qty_total INTEGER NOT NULL, unit_price INTEGER NOT NULL, sold INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, created_at BIGINT NOT NULL, closed_at BIGINT)`,
];
const stackStmt = (l: StackListing): Stmt => ({
  sql: `INSERT INTO market_stack_listings (id, seller_key, seller_name, item_type, item_id, qty_left, qty_total, unit_price, sold, status, created_at, closed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (id) DO UPDATE SET qty_left = EXCLUDED.qty_left, sold = EXCLUDED.sold, status = EXCLUDED.status, closed_at = EXCLUDED.closed_at`,
  args: [l.id, l.seller, l.sellerName, l.type, l.itemId, l.qty, l.total, l.unit, l.sold, l.status, l.at, l.closedAt ?? null],
});

/** What a listing/sale is, for price history: skin id, or 'case' / 'key'. */
export const whatOf = (i: Pick<SkinItem, 'kind' | 'skin'>) => (i.kind === 'skin' ? i.skin : i.kind);
const intIn = (v: unknown, lo: number, hi: number, what: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new RuleError(`${what} must be a whole number from ${lo.toLocaleString()} to ${hi.toLocaleString()}.`);
  return n;
};

const listingStmt = (l: Listing): Stmt => ({
  sql: `INSERT INTO market_listings (id, seller_key, seller_name, item_id, price, status, buyer_key, created_at, closed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, buyer_key = EXCLUDED.buyer_key, closed_at = EXCLUDED.closed_at`,
  args: [l.id, l.seller, l.sellerName, l.itemId, l.price, l.status, l.buyer ?? null, l.at, l.closedAt ?? null],
});
const saleStmt = (s: Sale): Stmt => ({ sql: 'INSERT INTO market_sales (id, listing_id, item_id, what, price, fee, seller_key, buyer_key, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING', args: [s.id, s.listingId, s.itemId, s.what, s.price, s.fee, s.seller, s.buyer, s.at] });
const tradeStmt = (t: Trade): Stmt => ({
  sql: `INSERT INTO trade_offers (id, from_key, from_name, to_key, to_name, give_items, want_items, give_chips, want_chips, status, created_at, closed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, closed_at = EXCLUDED.closed_at`,
  args: [t.id, t.from, t.fromName, t.to, t.toName, JSON.stringify(t.give), JSON.stringify(t.want), t.giveChips, t.wantChips, t.status, t.at, t.closedAt ?? null],
});

export class Market {
  listings = new Map<string, Listing>();
  sales: Sale[] = [];
  trades = new Map<string, Trade>();
  stacks = new Map<string, StackListing>();
  onTrade?: (keys: string[]) => void;
  constructor(readonly vault: ItemVault = getVault()) {}

  /** Load persisted market state (after the vault has attached). */
  async load(): Promise<void> {
    const st = this.vault.storage;
    if (!st?.query) return;
    for (const q of MARKET_MIGRATION) await st.query(q);
    for (const r of (await st.query("SELECT * FROM market_listings WHERE status = 'active'")).rows) {
      this.listings.set(String(r.id), { id: String(r.id), seller: String(r.seller_key), sellerName: String(r.seller_name), itemId: String(r.item_id), price: Number(r.price), status: 'active', at: Number(r.created_at) });
    }
    for (const r of (await st.query("SELECT * FROM market_stack_listings WHERE status = 'active'")).rows) {
      this.stacks.set(String(r.id), { id: String(r.id), seller: String(r.seller_key), sellerName: String(r.seller_name), type: r.item_type as ItemType, itemId: String(r.item_id), qty: Number(r.qty_left), total: Number(r.qty_total), unit: Number(r.unit_price), sold: Number(r.sold), status: 'active', at: Number(r.created_at) });
    }
    for (const r of (await st.query('SELECT * FROM market_sales ORDER BY at DESC LIMIT 5000')).rows) {
      this.sales.push({ id: String(r.id), listingId: String(r.listing_id), itemId: String(r.item_id), what: String(r.what), price: Number(r.price), fee: Number(r.fee), seller: String(r.seller_key), buyer: String(r.buyer_key), at: Number(r.at) });
    }
    this.sales.reverse();
    for (const r of (await st.query("SELECT * FROM trade_offers WHERE status = 'pending'")).rows) {
      this.trades.set(String(r.id), { id: String(r.id), from: String(r.from_key), fromName: String(r.from_name), to: String(r.to_key), toName: String(r.to_name), give: JSON.parse(String(r.give_items)), want: JSON.parse(String(r.want_items)), giveChips: Number(r.give_chips), wantChips: Number(r.want_chips), status: 'pending', at: Number(r.created_at) });
    }
  }

  private mine(name: string, id: unknown): StoredItem {
    const i = typeof id === 'string' ? this.vault.items.get(id) : undefined;
    if (!i || i.gone || i.owner !== playerKey(name)) throw new RuleError('That item is not in your inventory.');
    return i;
  }
  private bank() { return getBank(); }

  // ---------- market ----------
  list(name: string, itemId: unknown, price: unknown): Listing {
    const i = this.mine(name, itemId);
    if (i.locked) throw new RuleError('That item is already listed or in a trade.');
    const p = intIn(price, MIN_PRICE, MAX_PRICE, 'Price');
    const k = playerKey(name);
    if ([...this.listings.values()].filter((l) => l.status === 'active' && l.seller === k).length >= MAX_LISTINGS) throw new RuleError(`You can have at most ${MAX_LISTINGS} listings.`);
    const l: Listing = { id: randomUUID(), seller: k, sellerName: name.trim(), itemId: i.id, price: p, status: 'active', at: Date.now() };
    i.equipped = false; i.locked = `listing:${l.id}`;
    this.listings.set(l.id, l);
    this.vault.commit([i], [{ item: i.id, kind: 'list', from: k, to: null, memo: `listed ${l.id} for ${p}`, at: l.at }], [listingStmt(l)]);
    return l;
  }

  cancel(name: string, listingId: unknown): void {
    const l = typeof listingId === 'string' ? this.listings.get(listingId) : undefined;
    if (!l || l.status !== 'active' || l.seller !== playerKey(name)) throw new RuleError('That listing is not active.');
    const i = this.vault.items.get(l.itemId)!;
    l.status = 'cancelled'; l.closedAt = Date.now(); i.locked = undefined;
    this.listings.delete(l.id);
    this.vault.commit([i], [{ item: i.id, kind: 'unlist', from: null, to: l.seller, memo: `cancelled ${l.id}`, at: l.closedAt }], [listingStmt(l)]);
  }

  /** Buy a listing. All checks run before any state changes; the whole move is one synchronous step (no interleaving) and one DB transaction. Idempotent per listing. */
  buy(name: string, listingId: unknown): { item: SkinItem; price: number } {
    const l = typeof listingId === 'string' ? this.listings.get(listingId) : undefined;
    if (!l || l.status !== 'active') throw new RuleError('That listing is gone (sold or cancelled).');
    const k = playerKey(name);
    if (l.seller === k) throw new RuleError("You can't buy your own listing. Cancel it instead.");
    const i = this.vault.items.get(l.itemId);
    if (!i || i.gone || i.owner !== l.seller || i.locked !== `listing:${l.id}`) throw new RuleError('That listing is no longer valid.');
    const bank = this.bank();
    if (!bank.canAfford(name, l.price)) throw new RuleError('Not enough chips.');
    const fee = feeOf(l.price);
    bank.transfer(name, -l.price, { key: `mkt:buy:${l.id}`, game: 'market', memo: `Bought ${this.label(i)}` });
    bank.transfer(l.sellerName, l.price - fee, { key: `mkt:sell:${l.id}`, game: 'market', memo: `Sold ${this.label(i)} (${fee} fee)` });
    const now = Date.now();
    l.status = 'sold'; l.closedAt = now; l.buyer = k;
    this.listings.delete(l.id);
    i.owner = k; i.ownerName = name.trim(); i.locked = undefined; i.equipped = false;
    const sale: Sale = { id: randomUUID(), listingId: l.id, itemId: i.id, what: whatOf(i), price: l.price, fee, seller: l.seller, buyer: k, at: now };
    this.sales.push(sale); if (this.sales.length > 5000) this.sales.shift();
    this.vault.commit([i], [{ item: i.id, kind: 'sale', from: l.seller, to: k, memo: `listing ${l.id} for ${l.price}, fee ${fee} burned`, at: now }], [listingStmt(l), saleStmt(sale)]);
    this.vault.onChange?.(l.seller); for (const f of this.vault.listeners) f(l.seller);
    return { item: this.vault.view(i), price: l.price };
  }

  // ---------- stackable (Mines) listings ----------
  /** Rows go in the same transaction as the pack change (via Mines' save); with no Mines store they go through the vault. */
  private stackRows(rows: Stmt[]) { if (rows.length) this.vault.commit([], [], rows); }
  listStack(name: string, type: unknown, itemId: unknown, qty: unknown, unit: unknown): StackListing {
    if (!isStackable(type, itemId)) throw new RuleError('That item cannot be listed.');
    const sid = itemId as string;
    const n = intIn(qty, 1, MAX_STACK_QTY, 'Quantity');
    const u = intIn(unit, MIN_PRICE, MAX_PRICE, 'Unit price');
    if (n * u > MAX_PRICE * 100) throw new RuleError('That listing is too large.');
    const k = playerKey(name);
    const active = [...this.listings.values()].filter((l) => l.seller === k).length + [...this.stacks.values()].filter((l) => l.seller === k).length;
    if (active >= MAX_LISTINGS) throw new RuleError(`You can have at most ${MAX_LISTINGS} listings.`);
    const mines = getMines();
    if (mines.stackQty(name, type, sid) < n) throw new RuleError(`You only have ${mines.stackQty(name, type, sid)} ${stackName({ type, id: sid })}.`);
    const l: StackListing = { id: randomUUID(), seller: k, sellerName: name.trim(), type, itemId: sid, qty: n, total: n, unit: u, status: 'active', at: Date.now(), sold: 0 };
    if (!mines.adjustStack(name, type, sid, -n, [stackStmt(l)], (r) => this.stackRows(r))) throw new RuleError('Not enough items.');
    this.stacks.set(l.id, l);
    return l;
  }
  cancelStack(name: string, id: unknown): void {
    const l = typeof id === 'string' ? this.stacks.get(id) : undefined;
    if (!l || l.status !== 'active' || l.seller !== playerKey(name)) throw new RuleError('That listing is not active.');
    l.status = 'cancelled'; l.closedAt = Date.now(); this.stacks.delete(l.id);
    getMines().adjustStack(l.sellerName, l.type, l.itemId, l.qty, [stackStmt(l)], (r) => this.stackRows(r));
  }
  /** Buy qty units (partial OK). Checks first, then one synchronous step; buyer pack + listing row + sale row in one transaction. */
  buyStack(name: string, id: unknown, qty: unknown): { type: ItemType; id: string; qty: number; price: number; fee: number } {
    const l = typeof id === 'string' ? this.stacks.get(id) : undefined;
    if (!l || l.status !== 'active' || l.qty < 1) throw new RuleError('That listing is gone (sold or cancelled).');
    const k = playerKey(name);
    if (l.seller === k) throw new RuleError("You can't buy your own listing. Cancel it instead.");
    const n = intIn(qty, 1, l.qty, 'Quantity');
    const price = n * l.unit; const fee = feeOf(price);
    const bank = this.bank();
    if (!bank.canAfford(name, price)) throw new RuleError('Not enough chips.');
    const seq = l.sold + 1; const what = stackName({ type: l.type, id: l.itemId });
    bank.transfer(name, -price, { key: `mkt:buy:${l.id}:${seq}`, game: 'market', memo: `Bought ${n} ${what}` });
    bank.transfer(l.sellerName, price - fee, { key: `mkt:sell:${l.id}:${seq}`, game: 'market', memo: `Sold ${n} ${what} (${fee} fee)` });
    const now = Date.now();
    l.qty -= n; l.sold = seq;
    if (l.qty === 0) { l.status = 'sold'; l.closedAt = now; this.stacks.delete(l.id); }
    const sale: Sale = { id: randomUUID(), listingId: `${l.id}#${seq}`, itemId: `qty:${n}`, what: stackWhat(l.type, l.itemId), price: l.unit, fee, seller: l.seller, buyer: k, at: now };
    this.sales.push(sale); if (this.sales.length > 5000) this.sales.shift();
    getMines().adjustStack(name, l.type, l.itemId, n, [stackStmt(l), saleStmt(sale)], (r) => this.stackRows(r));
    return { type: l.type, id: l.itemId, qty: n, price, fee };
  }
  browseStacks(f: { type?: unknown; q?: unknown } = {}) {
    const q = typeof f.q === 'string' ? f.q.trim().toLowerCase() : '';
    return [...this.stacks.values()]
      .filter((l) => (!f.type || f.type === 'all' || l.type === f.type) && (!q || stackName({ type: l.type, id: l.itemId }).toLowerCase().includes(q)))
      .map((l) => ({ id: l.id, type: l.type, itemId: l.itemId, name: stackName({ type: l.type, id: l.itemId }), color: l.type === 'ore' ? undefined : GOODS[l.itemId]?.color, qty: l.qty, total: l.total, unit: l.unit, seller: l.sellerName, at: l.at, mine: false }))
      .sort((a, b) => a.unit - b.unit || a.at - b.at);
  }

  label(i: Pick<SkinItem, 'kind' | 'skin'>) { return i.kind === 'case' ? CASE_NAME : i.kind === 'key' ? KEY_NAME : SKIN_BY_ID.get(i.skin)?.name ?? i.skin; }

  /** Active listings, cheapest first. */
  browse(f: { weapon?: unknown; rarity?: unknown; kind?: unknown; q?: unknown; seller?: unknown } = {}, limit = 200) {
    const q = typeof f.q === 'string' ? f.q.trim().toLowerCase() : '';
    const out = [];
    for (const l of this.listings.values()) {
      const i = this.vault.items.get(l.itemId); if (!i) continue;
      const def = SKIN_BY_ID.get(i.skin);
      if (f.kind && f.kind !== 'all' && i.kind !== f.kind) continue;
      if (f.weapon && f.weapon !== 'all' && def?.weapon !== f.weapon) continue;
      if (f.rarity && f.rarity !== 'all' && def?.rarity !== f.rarity) continue;
      if (f.seller === 'me' ? false : typeof f.seller === 'string' && f.seller && l.seller !== playerKey(f.seller)) continue;
      if (q && !this.label(i).toLowerCase().includes(q)) continue;
      out.push({ id: l.id, price: l.price, seller: l.sellerName, at: l.at, item: this.vault.view(i) });
    }
    return out.sort((a, b) => a.price - b.price || a.at - b.at).slice(0, limit);
  }
  myListings(name: string) { const k = playerKey(name); return this.browse({}, 10_000).filter((l) => this.listings.get(l.id)?.seller === k); }
  history(what: string, limit = 50) {
    const s = this.sales.filter((x) => x.what === what);
    const prices = s.map((x) => x.price);
    return { what, sales: s.slice(-limit).map((x) => ({ price: x.price, at: x.at })), count: s.length, avg: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null, last: prices.at(-1) ?? null };
  }

  // ---------- trades ----------
  offer(name: string, to: unknown, give: unknown, want: unknown, giveChips: unknown, wantChips: unknown): Trade {
    const k = playerKey(name);
    if (typeof to !== 'string' || !to.trim()) throw new RuleError('Who is the trade for?');
    const tk = playerKey(to);
    if (tk === k) throw new RuleError("You can't trade with yourself.");
    const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : []);
    const g = ids(give), w = ids(want);
    const gc = intIn(giveChips ?? 0, 0, MAX_PRICE, 'Chips'), wc = intIn(wantChips ?? 0, 0, MAX_PRICE, 'Chips');
    if (!g.length && !w.length && !gc && !wc) throw new RuleError('Add something to the trade.');
    if (g.length > MAX_TRADE_ITEMS || w.length > MAX_TRADE_ITEMS) throw new RuleError(`At most ${MAX_TRADE_ITEMS} items per side.`);
    if ([...this.trades.values()].filter((t) => t.status === 'pending' && t.from === k).length >= MAX_TRADES) throw new RuleError(`You can have at most ${MAX_TRADES} open offers.`);
    const gi = g.map((id) => { const i = this.mine(name, id); if (i.locked) throw new RuleError(`${this.label(i)} is listed or already in a trade.`); return i; });
    const toName = [...this.vault.items.values()].find((i) => i.owner === tk)?.ownerName ?? to.trim();
    for (const id of w) { const i = this.vault.items.get(id); if (!i || i.gone || i.owner !== tk) throw new RuleError('One of the items you asked for is not theirs.'); }
    const bank = this.bank();
    if (gc && !bank.canAfford(name, gc)) throw new RuleError('Not enough chips.');
    const t: Trade = { id: randomUUID(), from: k, fromName: name.trim(), to: tk, toName, give: g, want: w, giveChips: gc, wantChips: wc, status: 'pending', at: Date.now() };
    if (gc) bank.transfer(name, -gc, { key: `trade:${t.id}:escrow`, game: 'trade', memo: `Chips held for trade to ${toName}` });
    for (const i of gi) { i.locked = `trade:${t.id}`; i.equipped = false; }
    this.trades.set(t.id, t);
    this.vault.commit(gi, gi.map((i) => ({ item: i.id, kind: 'trade-lock', from: k, to: null, memo: `offer ${t.id}`, at: t.at })), [tradeStmt(t)]);
    this.onTrade?.([k, tk]);
    return t;
  }

  private close(t: Trade, status: Trade['status']) {
    t.status = status; t.closedAt = Date.now(); this.trades.delete(t.id);
  }
  private release(t: Trade, why: string) {
    if (t.giveChips) this.bank().transfer(t.fromName, t.giveChips, { key: `trade:${t.id}:refund`, game: 'trade', memo: `Trade ${why}: chips returned` });
    const its = t.give.map((id) => this.vault.items.get(id)!).filter((i) => i && i.locked === `trade:${t.id}`);
    for (const i of its) i.locked = undefined;
    this.vault.commit(its, its.map((i) => ({ item: i.id, kind: 'trade-unlock', from: null, to: i.owner, memo: `${why} ${t.id}`, at: Date.now() })), [tradeStmt(t)]);
    this.onTrade?.([t.from, t.to]);
  }
  private pending(id: unknown) { const t = typeof id === 'string' ? this.trades.get(id) : undefined; if (!t || t.status !== 'pending') throw new RuleError('That offer is no longer open.'); return t; }

  cancelTrade(name: string, id: unknown) { const t = this.pending(id); if (t.from !== playerKey(name)) throw new RuleError('Only the sender can cancel.'); this.close(t, 'cancelled'); this.release(t, 'cancelled'); }
  decline(name: string, id: unknown) { const t = this.pending(id); if (t.to !== playerKey(name)) throw new RuleError('That offer is not for you.'); this.close(t, 'declined'); this.release(t, 'declined'); }

  /** Accept: validate everything first, then swap items and chips in one step / one DB transaction. */
  accept(name: string, id: unknown) {
    const t = this.pending(id);
    if (t.to !== playerKey(name)) throw new RuleError('That offer is not for you.');
    const gi = t.give.map((x) => this.vault.items.get(x));
    if (gi.some((i) => !i || i.gone || i.owner !== t.from || i.locked !== `trade:${t.id}`)) { this.close(t, 'cancelled'); this.release(t, 'invalid'); throw new RuleError('That offer is no longer valid.'); }
    const wi = t.want.map((x) => this.vault.items.get(x));
    if (wi.some((i) => !i || i.gone || i.owner !== t.to)) throw new RuleError("You no longer have every item they asked for.");
    if (wi.some((i) => i!.locked)) throw new RuleError('Some items they asked for are listed or in another trade. Free them first.');
    const bank = this.bank();
    if (t.wantChips && !bank.canAfford(name, t.wantChips)) throw new RuleError('Not enough chips.');
    if (t.wantChips) { bank.transfer(name, -t.wantChips, { key: `trade:${t.id}:pay`, game: 'trade', memo: `Trade with ${t.fromName}` }); bank.transfer(t.fromName, t.wantChips, { key: `trade:${t.id}:recv`, game: 'trade', memo: `Trade with ${t.toName}` }); }
    if (t.giveChips) bank.transfer(name, t.giveChips, { key: `trade:${t.id}:release`, game: 'trade', memo: `Trade with ${t.fromName}` });
    const now = Date.now();
    for (const i of gi as StoredItem[]) { i.owner = t.to; i.ownerName = t.toName; i.locked = undefined; i.equipped = false; }
    for (const i of wi as StoredItem[]) { i.owner = t.from; i.ownerName = t.fromName; i.equipped = false; }
    this.close(t, 'accepted');
    const all = [...gi, ...wi] as StoredItem[];
    this.vault.commit(all, [...(gi as StoredItem[]).map((i) => ({ item: i.id, kind: 'trade', from: t.from, to: t.to, memo: t.id, at: now })), ...(wi as StoredItem[]).map((i) => ({ item: i.id, kind: 'trade', from: t.to, to: t.from, memo: t.id, at: now }))], [tradeStmt(t)]);
    for (const k of [t.from, t.to]) { this.vault.onChange?.(k); for (const f of this.vault.listeners) f(k); }
    this.onTrade?.([t.from, t.to]);
  }

  /** Counter an incoming offer: the new offer (from me back to the sender) is validated and created first, then the original closes as 'countered' and releases its escrow. */
  counter(name: string, id: unknown, give: unknown, want: unknown, giveChips: unknown, wantChips: unknown): Trade {
    const t = this.pending(id);
    if (t.to !== playerKey(name)) throw new RuleError('That offer is not for you.');
    const n = this.offer(name, t.fromName, give, want, giveChips, wantChips);
    n.counterOf = t.id;
    this.close(t, 'countered'); this.release(t, 'countered');
    return n;
  }

  tradesFor(name: string) {
    const k = playerKey(name);
    const view = (t: Trade) => ({ ...t, giveItems: t.give.map((x) => this.vault.items.get(x)).filter(Boolean).map((i) => this.vault.view(i!)), wantItems: t.want.map((x) => this.vault.items.get(x)).filter(Boolean).map((i) => this.vault.view(i!)) });
    const all = [...this.trades.values()];
    return { incoming: all.filter((t) => t.to === k).map(view), outgoing: all.filter((t) => t.from === k).map(view) };
  }
}

let market = new Market();
export const getMarket = () => market;
export function resetMarket(vault?: ItemVault): Market { market = new Market(vault ?? getVault()); return market; }
export async function initMarketStorage() { try { await market.load(); } catch (e) { console.error('[market] load failed:', (e as Error).message); } }

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
let wired: Server | null = null;
export function registerMarket(io: Server, socket: Socket): void {
  if (wired !== io) { wired = io; market.onTrade = (keys) => { for (const k of keys) io.to(`inv:${k}`).emit('trade_changed'); }; }
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf(); if (!n) throw new RuleError('Sign in to buy, sell or trade. Guests can browse.'); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b)) ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof RuleError || (e as Error).message === 'Not enough chips.' ? (e as Error).message : 'Something went wrong.' }); }
  });
  on('mkt_browse', (b) => ({ listings: market.browse(b), mine: nameOf() ? market.myListings(nameOf()!) : [], fee: MARKET_FEE, min: MIN_PRICE, max: MAX_PRICE }));
  on('mkt_history', (b) => market.history(String(b.what ?? '')));
  on('mkt_list', (b) => ({ listing: market.list(need(), b.id, b.price) }));
  on('mkt_cancel', (b) => { market.cancel(need(), b.id); });
  on('mkt_buy', (b) => market.buy(need(), b.id));
  on('mkt_stacks', (b) => { const me = nameOf() ? playerKey(nameOf()!) : null; return { listings: market.browseStacks(b).map((l) => ({ ...l, mine: !!me && market.stacks.get(l.id)?.seller === me })) }; });
  on('mkt_my_stacks', () => { const n = nameOf(); const p = n ? getMines().packs.get(playerKey(n)) : undefined; return { stacks: p ? [...p.values()].filter((x) => x.qty > 0 && isStackable(x.type, x.id)).map((x) => ({ ...x, name: stackName(x) })) : [] }; });
  on('mkt_list_stack', (b) => ({ listing: market.listStack(need(), b.type, b.id, b.qty, b.unit) }));
  on('mkt_cancel_stack', (b) => { market.cancelStack(need(), b.id); });
  on('mkt_buy_stack', (b) => market.buyStack(need(), b.id, b.qty));
  on('trade_list', () => (nameOf() ? market.tradesFor(nameOf()!) : { incoming: [], outgoing: [] }));
  on('trade_offer', async (b) => {
    const me = need();
    if (typeof b.to !== 'string' || !(await getAccounts().status(b.to)).claimed) throw new RuleError('No registered player by that name.');
    return { trade: market.offer(me, b.to, b.give, b.want, b.giveChips, b.wantChips) };
  });
  on('trade_counter', (b) => ({ trade: market.counter(need(), b.id, b.give, b.want, b.giveChips, b.wantChips) }));
  on('trade_accept', (b) => { market.accept(need(), b.id); });
  on('trade_decline', (b) => { market.decline(need(), b.id); });
  on('trade_cancel', (b) => { market.cancelTrade(need(), b.id); });
  on('trade_peek', (b) => {
    if (typeof b.name !== 'string' || !b.name.trim()) throw new RuleError('Whose inventory?');
    return { items: getVault().inventory(b.name).filter((i) => !i.locked) };
  });
}

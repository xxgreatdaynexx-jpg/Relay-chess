import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { getVault, ItemVault, PgItemStore, resetVault, type StoredItem } from '../server/skins';
import { feeOf, Market, MAX_BANKED_STACK, resetMarket } from '../server/market';
import { getBank, PgCasinoStore, resetBank } from '../server/casino-store';

let v: ItemVault; let m: Market;
const skin = (name: string, id = 'c-pistol-0') => { const i = v.make(name, 'skin', `t:${Math.random()}`, 'test', { id } as never)! ; v.commit([i], []); return i; };
const chips = (n: string) => getBank().account(n).chips;

beforeEach(() => { resetBank(); v = resetVault(); m = resetMarket(v); });

describe('market', () => {
  it('lists with escrow, buys once, burns a 5% fee, records history', () => {
    const it0 = skin('QA-Seller');
    const l = m.list('QA-Seller', it0.id, 200);
    expect(it0.locked).toBe(`listing:${l.id}`);
    expect(() => v.equip('QA-Seller', it0.id)).toThrow();
    expect(() => m.list('QA-Seller', it0.id, 5)).toThrow(/already listed/);
    const total0 = chips('QA-Seller') + chips('QA-Buyer');
    m.buy('QA-Buyer', l.id);
    expect(() => m.buy('QA-Other', l.id)).toThrow(/gone/);
    expect(it0.owner).toBe('qa-buyer'); expect(it0.locked).toBeUndefined();
    expect(chips('QA-Seller') + chips('QA-Buyer')).toBe(total0 - feeOf(200));
    expect(feeOf(200)).toBe(10);
    expect(m.history('c-pistol-0')).toMatchObject({ count: 1, last: 200 });
  });
  it('cheapest first, cancel unlocks, cannot buy own or unaffordable, limits', () => {
    const a = skin('QA-A'), b = skin('QA-A'), c = skin('QA-A');
    m.list('QA-A', a.id, 50); const lb = m.list('QA-A', b.id, 10); m.list('QA-A', c.id, 30);
    expect(m.browse().map((x) => x.price)).toEqual([10, 30, 50]);
    expect(() => m.buy('QA-A', lb.id)).toThrow(/own/);
    m.cancel('QA-A', lb.id); expect(b.locked).toBeUndefined();
    expect(() => m.cancel('QA-A', lb.id)).toThrow();
    const d = skin('QA-A'); const ld = m.list('QA-A', d.id, 999_999);
    expect(() => m.buy('QA-Poor', ld.id)).toThrow(/Not enough chips/);
    expect(d.owner).toBe('qa-a');
    expect(() => m.list('QA-A', skin('QA-A').id, 0)).toThrow(/Price/);
    expect(() => m.list('QA-A', skin('QA-A').id, 1.5)).toThrow(/Price/);
  });
  it('cases and keys are listable', () => {
    const cs = v.make('QA-A', 'case', 'x:1', 'test')!; const k = v.make('QA-A', 'key', 'x:2', 'test')!;
    m.list('QA-A', cs.id, 5); m.list('QA-A', k.id, 7);
    expect(m.browse({ kind: 'case' }).length).toBe(1);
    m.buy('QA-B', m.browse({ kind: 'key' })[0]!.id);
    expect(k.owner).toBe('qa-b');
  });
});

describe('trades', () => {
  it('escrows, swaps items + chips both ways atomically', () => {
    const a = skin('QA-A'), b = skin('QA-B', 'r-smg-0');
    const a0 = chips('QA-A'), b0 = chips('QA-B');
    const t = m.offer('QA-A', 'QA-B', [a.id], [b.id], 100, 30);
    expect(a.locked).toBe(`trade:${t.id}`); expect(chips('QA-A')).toBe(a0 - 100);
    expect(() => m.list('QA-A', a.id, 5)).toThrow();
    expect(() => m.accept('QA-A', t.id)).toThrow(/not for you/);
    m.accept('QA-B', t.id);
    expect([a.owner, b.owner]).toEqual(['qa-b', 'qa-a']);
    expect(chips('QA-A')).toBe(a0 - 100 + 30); expect(chips('QA-B')).toBe(b0 + 100 - 30);
    expect(() => m.accept('QA-B', t.id)).toThrow(/no longer open/);
  });
  it('decline / cancel refund escrow; counter replaces offer', () => {
    const a = skin('QA-A'), b = skin('QA-B');
    const a0 = chips('QA-A');
    const t = m.offer('QA-A', 'QA-B', [a.id], [], 50, 0);
    m.decline('QA-B', t.id); expect(chips('QA-A')).toBe(a0); expect(a.locked).toBeUndefined();
    const t2 = m.offer('QA-A', 'QA-B', [a.id], [b.id], 0, 0);
    const c = m.counter('QA-B', t2.id, [b.id], [a.id], 0, 25);
    expect(c.counterOf).toBe(t2.id); expect(a.locked).toBeUndefined(); expect(b.locked).toBe(`trade:${c.id}`);
    expect(m.tradesFor('QA-A').incoming.map((x) => x.id)).toEqual([c.id]);
    m.accept('QA-A', c.id);
    expect([a.owner, b.owner]).toEqual(['qa-b', 'qa-a']);
    const t3 = m.offer('QA-A', 'QA-B', [b.id], [], 0, 0); m.cancelTrade('QA-A', t3.id); expect(b.locked).toBeUndefined();
  });
  it('no dupes: item cannot be both listed and traded; stale accept is rejected', () => {
    const a = skin('QA-A'), b = skin('QA-B');
    const l = m.list('QA-A', a.id, 10);
    expect(() => m.offer('QA-A', 'QA-B', [a.id], [], 0, 0)).toThrow(/listed/);
    const t = m.offer('QA-C', 'QA-B', [], [b.id], 5, 0);
    m.list('QA-B', b.id, 10);
    expect(() => m.accept('QA-B', t.id)).toThrow(/listed/);
    m.buy('QA-D', l.id);
    expect(() => m.offer('QA-A', 'QA-B', [a.id], [], 0, 0)).toThrow(/not in your inventory/);
    expect(() => m.offer('QA-A', 'QA-A', [], [], 1, 0)).toThrow(/yourself/);
  });
  it('persists listings, sales and trades in the same transaction as items (pg-mem)', async () => {
    const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg();
    const pool = new Pool();
    const vv = new ItemVault(); await vv.attach(new PgItemStore(pool as never));
    const mm = new Market(vv); await mm.load();
    const i = vv.make('QA-A', 'skin', 's:1', 'test', { id: 'c-pistol-0' } as never)!; vv.commit([i], []);
    const l = mm.list('QA-A', i.id, 40);
    const j = vv.make('QA-A', 'skin', 's:2', 'test', { id: 'c-pistol-1' } as never)!; vv.commit([j], []);
    const t = mm.offer('QA-A', 'QA-B', [j.id], [], 0, 0);
    await vv.flush();
    const v2 = new ItemVault(); await v2.attach(new PgItemStore(pool as never)); const m2 = new Market(v2); await m2.load();
    expect(m2.listings.get(l.id)?.price).toBe(40); expect(m2.trades.has(t.id)).toBe(true);
    expect(v2.items.get(i.id)!.locked).toBe(`listing:${l.id}`);
    m2.buy('QA-B', l.id); await v2.flush();
    const { rows } = await pool.query('SELECT kind FROM item_events WHERE item_id = $1 ORDER BY id', [i.id]);
    expect(rows.map((r: { kind: string }) => r.kind)).toEqual(expect.arrayContaining(['list', 'sale']));
    void getVault;
  });
});

import { getMines, MinesWorld, PgMineStore, resetMines } from '../server/mines';
describe('stackable (Mines) listings', () => {
  beforeEach(() => { resetMines(); });
  it('escrows qty, partial buys at unit price, 5% fee burned, cancel returns the rest', () => {
    const w = getMines();
    w.adjustStack('QA-Miner', 'bar', 'iron_bar', 10);
    expect(() => m.listStack('QA-Miner', 'bar', 'iron_bar', 11, 30)).toThrow(/only have 10/);
    expect(() => m.listStack('QA-Miner', 'bar', 'nope', 1, 30)).toThrow(/cannot be listed/);
    expect(() => m.listStack('QA-Miner', 'good', 'iron_bar', 1, 30)).toThrow(/cannot be listed/);
    const l = m.listStack('QA-Miner', 'bar', 'iron_bar', 8, 30);
    expect(w.stackQty('QA-Miner', 'bar', 'iron_bar')).toBe(2);
    expect(() => m.buyStack('QA-Miner', l.id, 1)).toThrow(/own/);
    expect(() => m.buyStack('QA-Buyer', l.id, 9)).toThrow(/Quantity/);
    const total0 = chips('QA-Miner') + chips('QA-Buyer');
    const r = m.buyStack('QA-Buyer', l.id, 3);
    expect(r).toMatchObject({ qty: 3, price: 90, fee: feeOf(90) });
    expect(w.stackQty('QA-Buyer', 'bar', 'iron_bar')).toBe(3);
    expect(chips('QA-Miner') + chips('QA-Buyer')).toBe(total0 - feeOf(90));
    expect(m.browseStacks()[0]).toMatchObject({ qty: 5, unit: 30, name: 'Iron Bar' });
    expect(m.history('stack:bar:iron_bar')).toMatchObject({ count: 1, last: 30 });
    m.cancelStack('QA-Miner', l.id);
    expect(w.stackQty('QA-Miner', 'bar', 'iron_bar')).toBe(7);
    expect(() => m.buyStack('QA-Buyer', l.id, 1)).toThrow(/gone/);
  });
  it('buying the last unit closes the listing; no double-spend of escrow', () => {
    const w = getMines(); w.adjustStack('QA-Miner', 'good', 'gear', 2);
    const l = m.listStack('QA-Miner', 'good', 'gear', 2, 85);
    expect(() => m.listStack('QA-Miner', 'good', 'gear', 1, 85)).toThrow(/only have 0/);
    m.buyStack('QA-Buyer', l.id, 2);
    expect(m.stacks.has(l.id)).toBe(false);
    expect(() => m.buyStack('QA-Other', l.id, 1)).toThrow(/gone/);
    expect(w.stackQty('QA-Buyer', 'good', 'gear')).toBe(2);
  });
  it('pack + listing rows persist in one Mines transaction (pg-mem)', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const vv = resetVault(); await vv.attach(new PgItemStore(pool)); const mm = resetMarket(vv); await mm.load();
    const w = resetMines(); await w.attach(new PgMineStore(pool));
    w.adjustStack('QA-Miner', 'bar', 'gold_bar', 5);
    const l = mm.listStack('QA-Miner', 'bar', 'gold_bar', 4, 100);
    mm.buyStack('QA-Buyer', l.id, 1);
    await w.flush();
    const w2 = new MinesWorld(); await w2.attach(new PgMineStore(pool));
    expect(w2.stackQty('QA-Miner', 'bar', 'gold_bar')).toBe(1);
    expect(w2.stackQty('QA-Buyer', 'bar', 'gold_bar')).toBe(1);
    const m2 = resetMarket(vv); await m2.load();
    expect(m2.stacks.get(l.id)).toMatchObject({ qty: 3, unit: 100, sold: 1 });
    expect(m2.history('stack:bar:gold_bar').count).toBe(1);
  });
  it('chip ledger + balances + items commit in ONE transaction; a failed commit writes none of them', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = resetBank(); await bank.attach(new PgCasinoStore(pool));
    const vv = resetVault(); await vv.attach(new PgItemStore(pool)); const mm = resetMarket(vv); await mm.load();
    const w = resetMines(); const store = new PgMineStore(pool); await w.attach(store);
    w.adjustStack('QA-Miner', 'bar', 'gold_bar', 5);
    const l = mm.listStack('QA-Miner', 'bar', 'gold_bar', 4, 100);
    mm.buyStack('QA-Buyer', l.id, 1); await w.flush(); await bank.flush();
    const q = async (sql: string) => (await pool.query(sql)).rows;
    expect((await q("SELECT tx_key FROM wallet_transactions WHERE tx_key LIKE 'mkt:%' ORDER BY tx_key")).map((r: { tx_key: string }) => r.tx_key)).toEqual([`mkt:buy:${l.id}:1`, `mkt:sell:${l.id}:1`]);
    expect(Number((await q("SELECT chips FROM casino_players WHERE player_key = 'qa-buyer'"))[0].chips)).toBe(chips('QA-Buyer'));
    // Now make the item transaction fail every time: no ledger row, no balance change, no sale may land.
    const orig = store.save.bind(store); store.save = async () => { throw new Error('db down'); };
    const before = Number((await q("SELECT chips FROM casino_players WHERE player_key = 'qa-buyer'"))[0].chips);
    mm.buyStack('QA-Buyer', l.id, 1); await w.flush(); await bank.flush();
    expect((await q("SELECT tx_key FROM wallet_transactions WHERE tx_key LIKE 'mkt:%:2'")).length).toBe(0);
    expect(Number((await q("SELECT chips FROM casino_players WHERE player_key = 'qa-buyer'"))[0].chips)).toBe(before);
    expect((await q('SELECT * FROM market_sales')).length).toBe(1);
    store.save = orig;
  }, 20000);
  it('buys land in uncapped banked storage (big stashes are not blocked by the 120 carry cap), with a per-stack sanity limit', () => {
    const w = getMines(); w.adjustStack('QA-Miner', 'bar', 'iron_bar', 50); w.adjustStack('QA-Buyer', 'ore', 'stone', 5000);
    const l = m.listStack('QA-Miner', 'bar', 'iron_bar', 50, 1);
    m.buyStack('QA-Buyer', l.id, 30);
    expect(w.stackQty('QA-Buyer', 'bar', 'iron_bar')).toBe(30);
    w.adjustStack('QA-Buyer', 'bar', 'iron_bar', MAX_BANKED_STACK - 30);
    expect(() => m.buyStack('QA-Buyer', l.id, 1)).toThrow(/can't hold/);
  });
});

describe('market history + charts', () => {
  beforeEach(() => { resetMines(); });
  it('buckets avg/median/volume per range, excludes QA- from public stats, and lists my buys/sells/fees', () => {
    const now = Date.now(); const H = 3_600_000;
    const sale = (what: string, price: number, seller: string, buyer: string, at: number, qty = 1) =>
      m.sales.push({ id: `${what}${at}${seller}`, listingId: `${at}${seller}`, itemId: qty > 1 ? `qty:${qty}` : 'x', what, price, fee: feeOf(price * qty), seller, buyer, at });
    sale('stack:bar:iron_bar', 30, 'carol', 'alice', now - 3 * 86_400_000);
    sale('stack:bar:iron_bar', 10, 'alice', 'bob', now - 2 * H, 5);
    sale('stack:bar:iron_bar', 20, 'alice', 'bob', now - 2 * H + 1000);
    sale('stack:bar:iron_bar', 999, 'qa-x', 'bob', now - H);
    const c = m.chart('stack:bar:iron_bar', '24h', now);
    expect(c.points).toHaveLength(24); expect(c.volume).toBe(6);
    const b = c.points.find((p) => p.vol)!; expect(b).toMatchObject({ vol: 6, median: 10, avg: 12 });
    expect(m.chart('stack:bar:iron_bar', '7d', now).volume).toBe(7);
    expect(m.recentSales('stack:bar:iron_bar').map((r) => r.unit)).toEqual([20, 10, 30]);
    expect(m.recentSales()[1]).toMatchObject({ name: 'Iron Bar', qty: 5, total: 50 });
    const h = m.myHistory('Alice');
    expect(h.rows.map((r) => r.side)).toEqual(['sell', 'sell', 'buy']);
    expect(h.totals).toEqual({ bought: 30, sold: 70, fees: feeOf(50) + feeOf(20) });
    expect(m.myHistory('QA-X').rows).toHaveLength(1);
  });
  it('real buys appear in history with qty', () => {
    getMines().adjustStack('Seller', 'bar', 'iron_bar', 10);
    const l = m.listStack('Seller', 'bar', 'iron_bar', 10, 7); m.buyStack('Buyer', l.id, 4);
    expect(m.myHistory('Buyer').rows[0]).toMatchObject({ side: 'buy', qty: 4, unit: 7, total: 28, net: -28 });
    expect(m.chart('stack:bar:iron_bar', '24h').volume).toBe(4);
  });
});

describe('market catalog', () => {
  beforeEach(() => { resetMines(); });
  it('lists every skin (incl. pickaxe), case and key, and every resource, even with zero listings', async () => {
    const { SKINS } = await import('../shared/skins');
    const sk = m.catalog('skins').items;
    expect(sk).toHaveLength(SKINS.length + 2);
    expect(sk.some((e) => 'weapon' in e && e.weapon === 'pickaxe')).toBe(true);
    expect(sk.every((e) => e.listings >= 0)).toBe(true);
    const res = m.catalog('resources').items;
    expect(res.some((e) => e.what === 'stack:ore:iron')).toBe(true);
    expect(res.some((e) => 'type' in e && e.type === 'bar')).toBe(true);
    m.sales.push({ id: 'z1', listingId: 'z1', itemId: 'qty:2', what: 'stack:ore:iron', price: 7, fee: 1, seller: 'carol', buyer: 'dave', at: Date.now() });
    m.sales.push({ id: 'z2', listingId: 'z2', itemId: 'qty:2', what: 'stack:ore:iron', price: 99, fee: 1, seller: 'qa-x', buyer: 'dave', at: Date.now() + 1 });
    expect(m.catalog('resources').items.find((e) => e.what === 'stack:ore:iron')).toMatchObject({ listings: 0, lowest: null, last: 7 });
  });
  it('sorts and filters the catalog client-side', async () => {
    const { sortCatalog } = await import('../client/src/lib/marketCatalog');
    const rows = [
      { what: 'a', name: 'Alpha', rarity: 'common' as const, listings: 0, lowest: null, last: null, lastAt: null },
      { what: 'b', name: 'Beta', rarity: 'ultra' as const, listings: 3, lowest: 50, last: 40, lastAt: 5 },
      { what: 'c', name: 'Gamma', rarity: 'rare' as const, listings: 1, lowest: 10, last: null, lastAt: null },
    ];
    expect(sortCatalog(rows, { sort: 'low' }).map((e) => e.what)).toEqual(['c', 'b', 'a']);
    expect(sortCatalog(rows, { sort: 'high' }).map((e) => e.what)).toEqual(['b', 'c', 'a']);
    expect(sortCatalog(rows, { sort: 'rarity' }).map((e) => e.what)).toEqual(['b', 'c', 'a']);
    expect(sortCatalog(rows, { sort: 'most' }).map((e) => e.what)).toEqual(['b', 'c', 'a']);
    expect(sortCatalog(rows, { sort: 'recent' })[0]!.what).toBe('b');
    expect(sortCatalog(rows, { sort: 'name', listedOnly: true }).map((e) => e.what)).toEqual(['b', 'c']);
    expect(sortCatalog(rows, { sort: 'name', q: 'gam' }).map((e) => e.what)).toEqual(['c']);
  });
});

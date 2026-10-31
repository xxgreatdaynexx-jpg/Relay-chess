import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { getVault, ItemVault, PgItemStore, resetVault, type StoredItem } from '../server/skins';
import { feeOf, Market, resetMarket } from '../server/market';
import { getBank, resetBank } from '../server/casino-store';

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

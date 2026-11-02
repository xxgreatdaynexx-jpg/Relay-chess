import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore, resetBank } from '../server/casino-store';
import { Fishing } from '../server/fishing';
import { MinesWorld, resetMines } from '../server/mines';
import { setPriceIndexForTest } from '../server/price-index';
import { RequestBoard } from '../server/requests';
import { fishPayout } from '../shared/fishing';
import { payoutFor } from '../shared/mines';
import { parseSellQty, pickForQty, quickQty } from '../shared/sellQty';

const T0 = Date.parse('2026-11-01T12:00:00Z');

describe('sell quantity rules (request #11)', () => {
  it('accepts integers 1..owned, undefined = all, rejects everything else', () => {
    expect(parseSellQty(undefined, 5)).toEqual({ ok: true, qty: 5 });
    expect(parseSellQty(3, 5)).toEqual({ ok: true, qty: 3 });
    expect(parseSellQty(5, 5)).toEqual({ ok: true, qty: 5 });
    for (const bad of [0, -1, 6, 2.5, NaN, Infinity, '3', true, {}]) expect(parseSellQty(bad, 5).ok).toBe(false);
    expect(parseSellQty(1, 0).ok).toBe(false);
  });
  it('quick buttons clamp to what you own', () => {
    expect([quickQty('1', 7), quickQty('10', 7), quickQty('half', 7), quickQty('all', 7)]).toEqual([1, 7, 4, 7]);
    expect([quickQty('10', 40), quickQty('half', 40)]).toEqual([10, 20]);
    expect(quickQty('half', 1)).toBe(1);
  });
  it('picks the most valuable items first, deterministically', () => {
    expect(pickForQty([{ id: 'b', value: 5 }, { id: 'a', value: 9 }, { id: 'c', value: 5 }], 2).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('mines/factory partial sell', () => {
  let w: MinesWorld;
  beforeEach(() => { resetBank(); w = resetMines(); setPriceIndexForTest(1); });
  const give = (qty: number) => { w.join('a', 'QA-Part', 0); w.add(w.miners.get('a')!, [{ type: 'ore', id: 'gold', qty }]); w.leave('a', 10); };
  it('sells exactly qty of one stack and keeps the rest', () => {
    give(10);
    const r = w.sell('QA-Part', 1000, 'ore:gold', 4);
    expect(r.sold).toEqual([{ type: 'ore', id: 'gold', qty: 4 }]);
    expect(r.paid).toBe(4 * 15);
    expect(w.storage('QA-Part')).toEqual([{ type: 'ore', id: 'gold', qty: 6 }]);
    expect(w.sell('QA-Part', 1001, 'ore:gold', 6).paid).toBe(90);
    expect(w.storage('QA-Part')).toEqual([]);
  });
  it('validates qty and needs a single stack', () => {
    give(3);
    for (const bad of [0, 4, 1.5, -2, '2']) expect(() => w.sell('QA-Part', 1000, 'ore:gold', bad)).toThrow();
    expect(() => w.sell('QA-Part', 1000, undefined, 2)).toThrow(/Pick one item/);
    expect(w.storage('QA-Part')).toEqual([{ type: 'ore', id: 'gold', qty: 3 }]);
  });
  it('a double click cannot sell more than you own', () => {
    give(5);
    expect(w.sell('QA-Part', 1000, 'ore:gold', 5).paid).toBe(75);
    expect(() => w.sell('QA-Part', 1000, 'ore:gold', 5)).toThrow();
  });
  it('respects the daily tier cap on the chosen slice', () => {
    expect(payoutFor(10 * 15, 100_000 - 30)).toBe(30);
  });
});

describe('fishing partial sell', () => {
  it('sells exactly qty fish (most valuable first) through the wallet ledger, once', async () => {
    setPriceIndexForTest(1);
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    const f = new Fishing(pool, () => bank, () => T0); await f.init();
    for (const [id, v] of [['x1', 10], ['x2', 30], ['x3', 20], ['x4', 5]] as const) await pool.query("INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at) VALUES ($1,'pat','Pat','perch',300,$2,0)", [id, v]);
    await expect(f.sell('Pat', undefined, 0)).rejects.toThrow(/1 to 4/);
    await expect(f.sell('Pat', undefined, 9)).rejects.toThrow(/1 to 4/);
    const [a, b] = await Promise.allSettled([f.sell('Pat', undefined, 2), f.sell('Pat', undefined, 2)]);
    expect(a.status).toBe('fulfilled');
    expect((a as PromiseFulfilledResult<{ paid: number; sold: number }>).value).toMatchObject({ sold: 2, paid: fishPayout(50, 0) });
    // the second click sells the next two (it was queued behind the lock), never the same fish twice
    if (b.status === 'fulfilled') expect(b.value).toMatchObject({ sold: 2, paid: fishPayout(15, 50) });
    await bank.flush();
    const sold = db.public.many("SELECT id FROM fish_catches WHERE player_key = 'pat' AND sold_at IS NOT NULL").map((r) => r.id).sort();
    expect(sold.slice(0, 2)).toEqual(b.status === 'fulfilled' ? ['x1', 'x2'] : ['x2', 'x3']);
  });
});

describe('request board sorting (request #12)', () => {
  it('newest, oldest and most votes, ties broken by date', () => {
    const rb = new RequestBoard();
    const a = rb.submit('alice', { title: 'alpha request', details: '', category: 'Other' }, 1000);
    const b = rb.submit('bob', { title: 'bravo request', details: '', category: 'Other' }, 2000);
    const c = rb.submit('cara', { title: 'charlie request', details: '', category: 'Other' }, 3000);
    if (!a.ok || !b.ok || !c.ok) throw new Error('submit failed');
    rb.vote(a.request.id, 'dan');
    expect(rb.list({ sort: 'new' }).map((r) => r.id)).toEqual([c.request.id, b.request.id, a.request.id]);
    expect(rb.list({ sort: 'old' }).map((r) => r.id)).toEqual([a.request.id, b.request.id, c.request.id]);
    expect(rb.list({ sort: 'top' }).map((r) => r.id)).toEqual([a.request.id, c.request.id, b.request.id]);
  });
});

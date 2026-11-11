import { beforeEach, describe, expect, it } from 'vitest';
import { feeOf, MAX_REQUESTS, resetMarket } from '../server/market';
import { getBank, resetBank } from '../server/casino-store';
import { getMines, resetMines } from '../server/mines';
import { resetVault } from '../server/skins';

const chips = (n: string) => getBank().account(n).chips;
const stock = (n: string, type: 'bar' | 'good' | 'ore' | 'food', id: string) => getMines().stackQty(n, type, id);

describe('market buy requests', () => {
  beforeEach(() => { resetBank(); resetVault(); resetMines(); resetMarket(); });

  it('escrows chips on post, refunds the remainder on cancel, and rejects a request you cannot afford', () => {
    const m = resetMarket();
    const b0 = chips('QA-Buyer');
    const r = m.postRequest('QA-Buyer', 'bar', 'iron_bar', 8, 30);
    expect(r).toMatchObject({ qty: 8, total: 8, unit: 30, escrow: 240, filled: 0, status: 'active' });
    expect(chips('QA-Buyer')).toBe(b0 - 240);
    expect(m.browseRequests()).toHaveLength(1);
    expect(m.browseRequests()[0]!.name).toBe('Iron Bar');
    m.cancelRequest('QA-Buyer', r.id);
    expect(chips('QA-Buyer')).toBe(b0);
    expect(m.requests.has(r.id)).toBe(false);
    expect(() => m.cancelRequest('QA-Buyer', r.id)).toThrow(/not active/);
    expect(() => m.postRequest('QA-Poor', 'bar', 'iron_bar', 1, 999_999)).toThrow(/Not enough chips/);
    expect(() => m.postRequest('QA-Buyer', 'bar', 'nope', 1, 10)).toThrow(/cannot be requested/);
  });

  it('fills in part at the request price, burns the 5% seller fee, and delivers stock to the buyer', () => {
    const m = resetMarket();
    getMines().adjustStack('QA-Miner', 'bar', 'iron_bar', 10);
    const r = m.postRequest('QA-Buyer', 'bar', 'iron_bar', 8, 30);
    const b0 = chips('QA-Buyer'); const s0 = chips('QA-Miner');
    expect(() => m.fillRequest('QA-Buyer', r.id, 1)).toThrow(/own/);
    expect(() => m.fillRequest('QA-Miner', r.id, 9)).toThrow(/Quantity/);
    expect(() => m.fillRequest('QA-Other', r.id, 1)).toThrow(/only have 0/);
    const out = m.fillRequest('QA-Miner', r.id, 3);
    expect(out).toMatchObject({ qty: 3, price: 90, fee: feeOf(90) });
    expect(stock('QA-Miner', 'bar', 'iron_bar')).toBe(7);
    expect(stock('QA-Buyer', 'bar', 'iron_bar')).toBe(3);
    expect(chips('QA-Buyer')).toBe(b0); // already escrowed
    expect(chips('QA-Miner')).toBe(s0 + 90 - feeOf(90));
    expect(m.requests.get(r.id)).toMatchObject({ qty: 5, escrow: 150, filled: 1, status: 'active' });
    expect(m.history('stack:bar:iron_bar')).toMatchObject({ count: 1, last: 30 });
    const left = m.matchingRequests('QA-Miner').items.find((x) => x.id === 'iron_bar');
    expect(left?.qty).toBe(7);
    expect(left?.requests).toHaveLength(1);
  });

  it('a full fill closes the request; cancel after a partial fill refunds leftover escrow only', () => {
    const m = resetMarket();
    getMines().adjustStack('QA-Miner', 'good', 'gear', 5);
    const r = m.postRequest('QA-Buyer', 'good', 'gear', 4, 50);
    const b0 = chips('QA-Buyer'); // already down 200
    m.fillRequest('QA-Miner', r.id, 4);
    expect(m.requests.has(r.id)).toBe(false);
    expect(stock('QA-Buyer', 'good', 'gear')).toBe(4);
    expect(stock('QA-Miner', 'good', 'gear')).toBe(1);
    expect(() => m.fillRequest('QA-Other', r.id, 1)).toThrow(/gone/);
    const r2 = m.postRequest('QA-Buyer', 'good', 'gear', 2, 40);
    m.fillRequest('QA-Miner', r2.id, 1);
    const mid = chips('QA-Buyer');
    m.cancelRequest('QA-Buyer', r2.id);
    expect(chips('QA-Buyer')).toBe(mid + 40);
    expect(stock('QA-Buyer', 'good', 'gear')).toBe(5);
  });

  it('matchingRequests only includes items the seller actually has, and sorts higher bids first', () => {
    const m = resetMarket();
    getMines().adjustStack('QA-Miner', 'bar', 'iron_bar', 2);
    m.postRequest('QA-A', 'bar', 'iron_bar', 1, 10);
    m.postRequest('QA-B', 'bar', 'iron_bar', 1, 25);
    m.postRequest('QA-C', 'good', 'gear', 1, 100);
    const { items } = m.matchingRequests('QA-Miner');
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe('iron_bar');
    expect(items[0]!.requests.map((x) => x.unit)).toEqual([25, 10]);
    expect(m.matchingRequests('QA-Stranger').items).toEqual([]);
  });

  it('caps open requests per player', () => {
    const m = resetMarket();
    getBank().transfer('QA-Buyer', 50_000, { key: 'fund:reqcap', game: 'admin' });
    for (let i = 0; i < MAX_REQUESTS; i++) m.postRequest('QA-Buyer', 'bar', 'iron_bar', 1, 1);
    expect(() => m.postRequest('QA-Buyer', 'bar', 'iron_bar', 1, 1)).toThrow(/at most/);
  });

  it('raises the unit price, escrows the difference on remaining qty, and rejects a lower or equal bid', () => {
    const m = resetMarket();
    const r = m.postRequest('QA-Buyer', 'bar', 'iron_bar', 8, 30);
    const b0 = chips('QA-Buyer');
    const up = m.raiseRequest('QA-Buyer', r.id, 40);
    expect(up).toMatchObject({ qty: 8, total: 8, unit: 40, escrow: 320, filled: 0, status: 'active' });
    expect(chips('QA-Buyer')).toBe(b0 - 80);
    expect(m.browseRequests()[0]).toMatchObject({ id: r.id, unit: 40, qty: 8, escrow: 320 });
    expect(() => m.raiseRequest('QA-Buyer', r.id, 40)).toThrow(/higher/);
    expect(() => m.raiseRequest('QA-Buyer', r.id, 39)).toThrow(/higher/);
    expect(() => m.raiseRequest('QA-Buyer', r.id, 40.5)).toThrow(/whole number/);
    expect(() => m.raiseRequest('QA-Miner', r.id, 50)).toThrow(/not active/);
    expect(m.requests.get(r.id)).toMatchObject({ unit: 40, escrow: 320 });
    expect(chips('QA-Buyer')).toBe(b0 - 80);
  });

  it('fails cleanly when the buyer cannot afford the raise, leaving the request and chips unchanged', () => {
    const m = resetMarket();
    const r = m.postRequest('QA-Buyer', 'bar', 'iron_bar', 2, 10);
    const b0 = chips('QA-Buyer');
    expect(() => m.raiseRequest('QA-Buyer', r.id, 1_000_000)).toThrow(/Not enough chips/);
    expect(m.requests.get(r.id)).toMatchObject({ unit: 10, qty: 2, escrow: 20, status: 'active' });
    expect(chips('QA-Buyer')).toBe(b0);
  });

  it('after a partial fill, a raise escrows only the remaining quantity and later fills pay the new price', () => {
    const m = resetMarket();
    getMines().adjustStack('QA-Miner', 'bar', 'iron_bar', 10);
    const r = m.postRequest('QA-Buyer', 'bar', 'iron_bar', 8, 30);
    m.fillRequest('QA-Miner', r.id, 3);
    const b0 = chips('QA-Buyer'); const s0 = chips('QA-Miner');
    expect(m.requests.get(r.id)).toMatchObject({ qty: 5, total: 8, unit: 30, escrow: 150, filled: 1, status: 'active' });
    m.raiseRequest('QA-Buyer', r.id, 50);
    expect(m.requests.get(r.id)).toMatchObject({ qty: 5, total: 8, unit: 50, escrow: 250, filled: 1, status: 'active' });
    expect(chips('QA-Buyer')).toBe(b0 - 100); // (50-30)×5
    const out = m.fillRequest('QA-Miner', r.id, 2);
    expect(out).toMatchObject({ qty: 2, price: 100, fee: feeOf(100) });
    expect(chips('QA-Buyer')).toBe(b0 - 100);
    expect(chips('QA-Miner')).toBe(s0 + 100 - feeOf(100));
    expect(m.requests.get(r.id)).toMatchObject({ qty: 3, total: 8, unit: 50, escrow: 150, filled: 2, status: 'active' });
    const mid = chips('QA-Buyer');
    m.cancelRequest('QA-Buyer', r.id);
    expect(chips('QA-Buyer')).toBe(mid + 150);
    expect(m.requests.has(r.id)).toBe(false);
  });

  it('matching and browse lists show the raised price immediately, with higher bids first', () => {
    const m = resetMarket();
    getMines().adjustStack('QA-Miner', 'bar', 'iron_bar', 2);
    const low = m.postRequest('QA-A', 'bar', 'iron_bar', 1, 10);
    m.postRequest('QA-B', 'bar', 'iron_bar', 1, 25);
    m.raiseRequest('QA-A', low.id, 40);
    const { items } = m.matchingRequests('QA-Miner');
    expect(items[0]!.requests.map((x) => x.unit)).toEqual([40, 25]);
    expect(m.browseRequests().map((x) => x.unit)).toEqual([40, 25]);
  });

  it('cannot raise a cancelled or fully filled request', () => {
    const m = resetMarket();
    getMines().adjustStack('QA-Miner', 'good', 'gear', 5);
    const r = m.postRequest('QA-Buyer', 'good', 'gear', 2, 40);
    m.cancelRequest('QA-Buyer', r.id);
    expect(() => m.raiseRequest('QA-Buyer', r.id, 50)).toThrow(/not active/);
    const r2 = m.postRequest('QA-Buyer', 'good', 'gear', 1, 40);
    m.fillRequest('QA-Miner', r2.id, 1);
    expect(() => m.raiseRequest('QA-Buyer', r2.id, 50)).toThrow(/not active|gone/);
  });
});

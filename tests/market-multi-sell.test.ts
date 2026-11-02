import { beforeEach, describe, expect, it } from 'vitest';
import { ItemVault, resetVault } from '../server/skins';
import { Market, MAX_LISTINGS, resetMarket } from '../server/market';
import { getBank, resetBank } from '../server/casino-store';

let v: ItemVault; let m: Market;
const mk = (name: string, kind: 'case' | 'key') => { const i = v.make(name, kind, `t:${Math.random()}`, 'test')!; v.commit([i], []); return i; };

beforeEach(() => { resetBank(); v = resetVault(); m = resetMarket(v); getBank().account('QA-A'); getBank().account('QA-B'); });

describe('bulk listing cases and keys', () => {
  it('lists several at one unit price, each buyable on its own; no chips move on listing', () => {
    const before = getBank().account('QA-A').chips;
    const ids = [mk('QA-A', 'case').id, mk('QA-A', 'case').id, mk('QA-A', 'key').id];
    const ls = m.listMany('QA-A', ids, 40);
    expect(ls).toHaveLength(3); expect(ls.every((l) => l.price === 40)).toBe(true);
    expect(ids.every((id) => v.items.get(id)!.locked?.startsWith('listing:'))).toBe(true);
    expect(getBank().account('QA-A').chips).toBe(before);
    getBank().transfer('QA-B', 1000, { key: 't', game: 'test', memo: 't' });
    m.buy('QA-B', ls[0]!.id);
    expect(m.myListings('QA-A')).toHaveLength(2);
  });
  it('is all or nothing: one bad item lists none', () => {
    const a = mk('QA-A', 'case'); const b = mk('QA-B', 'key'); const c = mk('QA-A', 'key');
    expect(() => m.listMany('QA-A', [a.id, b.id], 10)).toThrow(/not in your inventory/);
    m.list('QA-A', c.id, 5);
    expect(() => m.listMany('QA-A', [a.id, c.id], 10)).toThrow(/already listed/);
    expect(() => m.listMany('QA-A', [a.id, a.id], 10)).toThrow(/twice/);
    expect(() => m.listMany('QA-A', [a.id], 0)).toThrow(/Price/);
    expect(() => m.listMany('QA-A', [], 10)).toThrow(/at least one/);
    expect(a.locked).toBeUndefined(); expect(m.myListings('QA-A')).toHaveLength(1);
  });
  it('respects the listing cap across the whole batch', () => {
    const ids = Array.from({ length: MAX_LISTINGS + 1 }, () => mk('QA-A', 'case').id);
    expect(() => m.listMany('QA-A', ids, 10)).toThrow(/at most/);
    m.listMany('QA-A', ids.slice(0, MAX_LISTINGS - 1), 10);
    expect(() => m.listMany('QA-A', ids.slice(MAX_LISTINGS - 1), 10)).toThrow(/1 slots left/);
    expect(m.myListings('QA-A')).toHaveLength(MAX_LISTINGS - 1);
  });
});

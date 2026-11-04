import { describe, it, expect } from 'vitest';
import { Royalties } from '../server/royalty';
import { royaltyRate, ROYALTY_VENUE, HOUSE_GAMES, CAVE_LANDMARK } from '../shared/royalty';
import { LANDMARK_PRICE } from '../shared/realEstate';
import { LAUNCH } from '../shared/launchPopup';

type T = { name: string; amount: number; opts: { key?: string; game: string; memo?: string } };
const mk = (owners: Record<string, string>) => {
  const txs: T[] = [];
  const bank = { transfer: (name: string, amount: number, opts: T['opts']) => { txs.push({ name, amount, opts }); return true; } };
  const r = new Royalties(async (id) => (owners[id] ? { key: owners[id].toLowerCase(), name: owners[id] } : null), () => bank as never, () => 0);
  return { r, txs };
};

describe('monument royalties', () => {
  it('default 1%, every royalty venue is a buyable landmark', () => {
    expect(royaltyRate('mine')).toBe(0.01);
    for (const lm of Object.keys(ROYALTY_VENUE)) expect(LANDMARK_PRICE[lm]).toBeGreaterThan(0);
    expect(Object.values(CAVE_LANDMARK)).toEqual(['mine', 'mine-frost', 'mine-magma']);
    expect(HOUSE_GAMES.has('holdem')).toBe(false);
  });
  it('100 hauled out of the mine pays the owner 1, minted with a monument_royalty ledger row', async () => {
    const { r, txs } = mk({ 'lm:mine': 'Owner' });
    expect(await r.earn('mine', 'Miner', 100)).toBe(1);
    expect(txs).toHaveLength(1); expect(txs[0]).toMatchObject({ name: 'Owner', amount: 1, opts: { game: 'monument_royalty' } });
    expect(txs[0].opts.key).toMatch(/^royalty:mine:/);
  });
  it('fractions carry over; no owner or own earnings pay nothing', async () => {
    const { r, txs } = mk({ 'lm:dock': 'Owner' });
    expect(await r.earn('dock', 'A', 60)).toBe(0); expect(await r.earn('dock', 'A', 60)).toBe(1);
    expect(await r.earn('dock', 'owner', 1000)).toBe(0);
    expect(await r.earn('mine', 'A', 1000)).toBe(0);
    expect(await r.earn('bank', 'A', 1000)).toBe(0); // not a royalty venue
    expect(txs.map((t) => t.amount)).toEqual([1]);
  });
  it('casino royalty follows the house net win (player losses minus payouts)', async () => {
    const { r, txs } = mk({ 'lm:casino': 'Owner' });
    await r.house('P', -100); // player stakes 100: house +100 -> 1
    expect(txs.map((t) => t.amount)).toEqual([1]);
    await r.house('P', 200); // player wins 200 net: house -200, no pay
    await r.house('P', -250); // back to +50 net since -> nothing yet
    expect(txs).toHaveLength(1);
    await r.house('P', -50); expect(txs.map((t) => t.amount)).toEqual([1, 1]);
    await r.house('Owner', -10000); expect(txs).toHaveLength(2); // owner's own play doesn't count
  });
  it('popup lists it', () => { expect(LAUNCH.items.some((i) => /royalt/i.test(i.title))).toBe(true); });
});

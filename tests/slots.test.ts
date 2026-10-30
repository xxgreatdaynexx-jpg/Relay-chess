import { describe, expect, it } from 'vitest';
import { pickSymbol, slotMultiplier, slotsRtp } from '../shared/casino-games.js';
import { CasinoBank } from '../server/casino-store.js';
import { spinSlots } from '../server/slots.js';

describe('slots', () => {
  it('pays triples, two cherries, and nothing else', () => {
    expect(slotMultiplier(['gem', 'gem', 'gem'])).toBe(1000);
    expect(slotMultiplier(['seven', 'seven', 'seven'])).toBe(120);
    expect(slotMultiplier(['cherry', 'cherry', 'bell'])).toBe(1);
    expect(slotMultiplier(['cherry', 'bell', 'lemon'])).toBe(0);
    expect(slotMultiplier(['bell', 'bell', 'star'])).toBe(0);
  });
  it('has a house edge: RTP between 90% and 99%', () => {
    const r = slotsRtp();
    expect(r).toBeGreaterThan(0.9);
    expect(r).toBeLessThan(0.99);
  });
  it('maps random numbers onto weighted symbols', () => {
    expect(pickSymbol(0)).toBe('cherry');
    expect(pickSymbol(0.9999)).toBe('gem');
  });
  it('rejects bad bets and settles wins', () => {
    const bank = new CasinoBank();
    const start = bank.account('Ann').chips;
    for (const bet of [0, -5, 201, 1.5, NaN]) expect(() => spinSlots(bank, 'Ann', bet)).toThrow();
    expect(bank.account('Ann').chips).toBe(start);
    const res = spinSlots(bank, 'Ann', 10, () => 0.9999); // gem gem gem
    expect(res.multiplier).toBe(1000);
    expect(res.chips).toBe(start + 9990);
    const lose = spinSlots(bank, 'Ann', 10, () => 0.5);
    expect(lose.chips).toBe(res.chips + lose.net);
  });
});

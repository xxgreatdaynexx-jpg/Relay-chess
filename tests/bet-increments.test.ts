import { describe, expect, it } from 'vitest';
import { BlackjackTable, MIN_BET, MAX_BET } from '../server/blackjack.js';
import { CasinoBank } from '../server/casino-store.js';
import { BLACKJACK_BETS, CHIP_VALUES, MAX_ROULETTE_STAKE, validateRouletteBet } from '../shared/casino.js';

describe('bet increments (1, 50, 1000)', () => {
  it('offers 1, 50 and 1000 alongside the old chips', () => {
    for (const list of [CHIP_VALUES, BLACKJACK_BETS]) for (const v of [1, 5, 25, 50, 100, 500, 1000]) expect(list).toContain(v);
  });
  it('every blackjack chip is within the server limits', () => {
    for (const b of BLACKJACK_BETS) { expect(b).toBeGreaterThanOrEqual(MIN_BET); expect(b).toBeLessThanOrEqual(MAX_BET); }
  });
  it('blackjack server accepts 1/50/1000 and still rejects out-of-range bets', () => {
    for (const amt of [1, 50, 1000]) {
      const t = new BlackjackTable('X', new CasinoBank());
      t.sit('Ada', 0); t.sit('Bo', 1);
      expect(() => t.bet('Ada', amt, 1)).not.toThrow();
    }
    const t = new BlackjackTable('X', new CasinoBank());
    t.sit('Ada', 0);
    expect(() => t.bet('Ada', 0, 1)).toThrow();
    expect(() => t.bet('Ada', MAX_BET + 1, 1)).toThrow();
    expect(() => t.bet('Ada', 2.5, 1)).toThrow();
  });
  it('roulette validation accepts every chip and still caps the stake', () => {
    for (const amount of CHIP_VALUES) expect(validateRouletteBet({ kind: 'red', numbers: [], amount })).not.toBeNull();
    expect(validateRouletteBet({ kind: 'red', numbers: [], amount: 0 })).toBeNull();
    expect(validateRouletteBet({ kind: 'red', numbers: [], amount: MAX_ROULETTE_STAKE + 1 })).toBeNull();
  });
});

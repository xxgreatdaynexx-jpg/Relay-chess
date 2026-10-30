import { describe, expect, it } from 'vitest';
import { betReturn, payoutOdds, validateRouletteBet as v, type RouletteBet } from '../shared/casino.js';
import { CasinoBank } from '../server/casino-store.js';
import { RouletteWheel, ROULETTE_BET_MS, ROULETTE_SPIN_MS, ROULETTE_RESULT_MS } from '../server/roulette.js';

const b = (kind: RouletteBet['kind'], numbers: number[], amount = 10) => ({ kind, numbers, amount });

describe('roulette bet validation', () => {
  it('accepts valid inside bets', () => {
    for (const ok of [b('straight', [0]), b('straight', [36]), b('split', [1, 2]), b('split', [2, 5]), b('split', [0, 3]),
      b('street', [4, 5, 6]), b('street', [0, 1, 2]), b('corner', [1, 2, 4, 5]), b('corner', [0, 1, 2, 3]), b('line', [31, 32, 33, 34, 35, 36])]) {
      expect(v(ok), JSON.stringify(ok)).not.toBeNull();
    }
  });
  it('rejects bad geometry and amounts', () => {
    for (const bad of [b('straight', [37]), b('split', [3, 4]), b('split', [1, 5]), b('split', [0, 4]), b('street', [2, 3, 4]),
      b('corner', [3, 4, 6, 7]), b('line', [34, 35, 36, 37, 38, 39]), b('line', [2, 3, 4, 5, 6, 7]), b('dozen', [4]), b('red', [1]),
      b('straight', [5], 0), b('straight', [5], 2.5), b('straight', [5], -5), { kind: 'nope', numbers: [], amount: 5 }, null]) {
      expect(v(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('roulette payouts', () => {
  it('pays the standard odds', () => {
    expect(['straight', 'split', 'street', 'corner', 'line', 'dozen', 'column', 'red'].map((k) => payoutOdds(k as RouletteBet['kind']))).toEqual([35, 17, 11, 8, 5, 2, 2, 1]);
    expect(betReturn(b('straight', [17]), 17)).toBe(360);
    expect(betReturn(b('split', [17, 20]), 20)).toBe(180);
    expect(betReturn(b('street', [16, 17, 18]), 16)).toBe(120);
    expect(betReturn(b('corner', [17, 18, 20, 21]), 21)).toBe(90);
    expect(betReturn(b('line', [16, 17, 18, 19, 20, 21]), 19)).toBe(60);
    expect(betReturn(b('dozen', [2]), 24)).toBe(30);
    expect(betReturn(b('column', [3]), 36)).toBe(30);
    expect(betReturn(b('red', []), 1)).toBe(20);
    expect(betReturn(b('black', []), 1)).toBe(0);
    expect(betReturn(b('even', []), 0)).toBe(0);
    expect(betReturn(b('low', []), 18)).toBe(20);
    expect(betReturn(b('high', []), 19)).toBe(20);
  });
});

describe('shared wheel', () => {
  it('cycles betting -> spinning -> result and settles chips', () => {
    const bank = new CasinoBank();
    const w = new RouletteWheel(bank, 0, () => 17 / 37 + 0.001);
    w.placeBet('Ada', b('straight', [17], 10));
    w.placeBet('Ada', b('straight', [17], 5));
    w.placeBet('Bo', b('black', [], 100));
    expect(w.view(null, 0).players.find((p) => p.name === 'Ada')!.bets).toEqual([b('straight', [17], 15)]);
    expect(bank.account('Ada').chips).toBe(985);
    w.tick(ROULETTE_BET_MS);
    expect(w.phase).toBe('spinning');
    expect(() => w.placeBet('Ada', b('red', [], 5))).toThrow();
    w.tick(ROULETTE_BET_MS + ROULETTE_SPIN_MS);
    expect(w.history).toEqual([17]);
    expect(bank.account('Ada').chips).toBe(985 + 540);
    expect(bank.account('Bo').chips).toBe(1100);
    w.tick(ROULETTE_BET_MS + ROULETTE_SPIN_MS + ROULETTE_RESULT_MS);
    expect(w.phase).toBe('betting');
    w.rebet('Ada');
    expect(bank.account('Ada').chips).toBe(985 + 540 - 15);
    w.clear('Ada');
    expect(bank.account('Ada').chips).toBe(1525);
  });
});

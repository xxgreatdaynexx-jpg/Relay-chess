import { describe, expect, it } from 'vitest';
import { evaluatePoker } from '../shared/casino-games.js';
import type { CasinoCard, Suit } from '../shared/casino.js';
import { CasinoBank } from '../server/casino-store.js';
import { VideoPoker } from '../server/video-poker.js';

const c = (s: string): CasinoCard => {
  const suit = s.slice(-1) as Suit;
  const r = s.slice(0, -1);
  const rank = ({ A: 1, J: 11, Q: 12, K: 13 } as Record<string, number>)[r] ?? Number(r);
  return { id: s, suit, rank, faceUp: true };
};
const h = (str: string) => str.split(' ').map(c);

describe('video poker hands', () => {
  it.each([
    ['10S JS QS KS AS', 'royal'], ['5H 6H 7H 8H 9H', 'straight-flush'], ['9C 9D 9H 9S 2C', 'four'],
    ['3C 3D 3H 7S 7C', 'full-house'], ['2D 8D JD 4D KD', 'flush'], ['AC 2D 3H 4S 5C', 'straight'],
    ['10C JD QH KS AC', 'straight'], ['7C 7D 7H 2S KC', 'three'], ['4C 4D 9H 9S KC', 'two-pair'],
    ['JC JD 2H 5S 8C', 'jacks'], ['AC AD 2H 5S 8C', 'jacks'], ['10C 10D 2H 5S 8C', 'nothing'], ['JC QD KH AS 3C', 'nothing'],
  ])('%s → %s', (cards, want) => expect(evaluatePoker(h(cards))).toBe(want));
});

describe('VideoPoker', () => {
  it('debits on deal, swaps unheld cards on draw, and pays the table', () => {
    const bank = new CasinoBank();
    const vp = new VideoPoker(bank);
    const deck = h('JC JD 2H 5S 8C JH 3D 4D');
    const dealt = vp.deal('Ann', 10, deck);
    expect(dealt.phase).toBe('dealt');
    expect(bank.account('Ann').chips).toBe(990);
    expect(() => vp.deal('Ann', 10)).toThrow(/Finish this hand/);
    const done = vp.draw('ann', [true, true, false, false, false]);
    expect(done.cards.map((x) => x.id)).toEqual(['JC', 'JD', 'JH', '3D', '4D']);
    expect(done.result).toMatchObject({ hand: 'three', returned: 30, net: 20 });
    expect(bank.account('Ann').chips).toBe(1020);
    expect(() => vp.draw('Ann', [])).toThrow(/Deal a hand/);
  });
  it('validates bets and balance', () => {
    const bank = new CasinoBank();
    const vp = new VideoPoker(bank);
    expect(() => vp.deal('Bo', 0)).toThrow(/Bet/);
    expect(() => vp.deal('Bo', 1.5)).toThrow(/Bet/);
    expect(() => vp.deal('Bo', 501)).toThrow(/Bet/);
    bank.debit('Bo', 999);
    expect(() => vp.deal('Bo', 5)).toThrow(/Not enough/);
  });
});

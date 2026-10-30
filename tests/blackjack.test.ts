import { describe, expect, it } from 'vitest';
import { dealerPlay, deal, double, handValue, hit, makeShoe, newState, payoutFor, settle, stand, type BJState, type Card } from '../client/src/blackjack/logic';

const c = (rank: number, suit: Card['suit'] = 'S'): Card => ({ id: `${suit}${rank}${Math.random()}`, suit, rank, faceUp: true });
/** Shoe pops from the end, so list the cards in draw order. */
const shoeOf = (...ranks: number[]) => [...ranks].reverse().map((r) => c(r)).concat(Array.from({ length: 0 }));
function rigged(ranks: number[], chips = 1000): BJState {
  const s = newState(chips);
  s.shoe = [...makeShoe(Math.random).slice(0, 200), ...shoeOf(...ranks)];
  return s;
}

describe('blackjack hand values', () => {
  it('counts soft and hard aces', () => {
    expect(handValue([c(1), c(6)])).toEqual({ total: 17, soft: true });
    expect(handValue([c(1), c(6), c(10)])).toEqual({ total: 17, soft: false });
    expect(handValue([c(1), c(1), c(9)])).toEqual({ total: 21, soft: true });
    expect(handValue([c(13), c(12), c(5)]).total).toBe(25);
    expect(handValue([c(1), c(13)]).total).toBe(21);
  });
  it('6-deck shoe has 312 cards', () => {
    expect(makeShoe()).toHaveLength(312);
  });
});

describe('dealer play', () => {
  it('stands on soft 17 and hits 16', () => {
    const draws = [c(5), c(3)];
    expect(handValue(dealerPlay([c(1), c(6)], () => draws.shift()!)).total).toBe(17);
    const d2 = [c(5)];
    expect(handValue(dealerPlay([c(10), c(6)], () => d2.shift()!)).total).toBe(21);
  });
});

describe('payouts and flow', () => {
  it('pays 3:2, 1:1, push, loss', () => {
    expect(payoutFor('blackjack', 100)).toBe(150);
    expect(payoutFor('win', 100)).toBe(100);
    expect(payoutFor('push', 100)).toBe(0);
    expect(payoutFor('bust', 100)).toBe(-100);
    expect(settle([c(1), c(13)], [c(10), c(9)])).toBe('blackjack');
    expect(settle([c(1), c(13)], [c(1), c(12)])).toBe('push');
    expect(settle([c(10), c(9)], [c(10), c(8), c(5)])).toBe('win');
  });
  it('natural blackjack settles immediately at 3:2', () => {
    // player A, dealer 9, player K, dealer 7
    const s = deal(rigged([1, 9, 13, 7]), 100)!;
    expect(s.phase).toBe('done');
    expect(s.outcome).toBe('blackjack');
    expect(s.chips).toBe(1150);
    expect(s.dealer.every((x) => x.faceUp)).toBe(true);
  });
  it('hit to bust loses the bet; stand lets dealer play', () => {
    let s = deal(rigged([10, 10, 6, 7, 9]), 50)!;
    expect(s.dealer[1].faceUp).toBe(false);
    s = hit(s)!;
    expect(s.outcome).toBe('bust');
    expect(s.chips).toBe(950);
    // player 10+9=19, dealer 10+6 then draws 5 -> 21
    let t = deal(rigged([10, 10, 9, 6, 5]), 50)!;
    t = stand(t)!;
    expect(t.outcome).toBe('lose');
    expect(t.chips).toBe(950);
  });
  it('double takes one card and doubles the bet', () => {
    // player 5+6, dealer 10+7, double draws 10 -> 21 vs 17
    let s = deal(rigged([5, 10, 6, 7, 10]), 100)!;
    s = double(s)!;
    expect(s.player).toHaveLength(3);
    expect(s.bet).toBe(200);
    expect(s.outcome).toBe('win');
    expect(s.chips).toBe(1200);
  });
  it('rejects bets above chips', () => {
    expect(deal(newState(10), 50)).toBeNull();
  });
});

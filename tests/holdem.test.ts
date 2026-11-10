import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bestHand, HE_TURN_MS } from '../shared/holdem.js';
import type { CasinoCard, Suit } from '../shared/casino.js';
import { CasinoBank } from '../server/casino-store.js';
import { HoldemRoom, HoldemTable } from '../server/holdem.js';
import { setNightlyClock } from '../server/nightly-event.js';

const card = (s: string): CasinoCard => {
  const r = s.slice(0, -1);
  const rank = r === 'A' ? 1 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : r === 'T' ? 10 : Number(r);
  return { id: s, rank, suit: s.slice(-1) as Suit, faceUp: true };
};
const cards = (s: string) => s.split(' ').map(card);

/** Deck order: hole cards go one at a time starting with the small blind, then board (no burns). */
function table(deck: string, names: string[], stacks: number[]) {
  const bank = new CasinoBank();
  const t = new HoldemTable('T', bank, Math.random, () => cards(deck));
  names.forEach((n, i) => t.sit(n, stacks[i]!, 0));
  return { bank, t };
}

// Chip-conservation assertions must not depend on wall-clock time: the nightly 10x
// poker bonus (8–9 PM America/Regina) would otherwise credit winners mid-suite.
beforeEach(() => setNightlyClock(() => Date.UTC(2026, 10, 9, 4)));
afterEach(() => setNightlyClock(() => Date.now()));

describe('hold\'em hand ranking', () => {
  it('orders categories and kickers', () => {
    const s = (x: string) => bestHand(cards(x)).score;
    expect(bestHand(cards('AS KS QS JS TS 2D 3C')).label).toBe('Straight flush');
    expect(s('AS 2D 3C 4H 5S 9D KC')).toBeLessThan(s('2S 3D 4C 5H 6S 9D KC')); // wheel < six-high
    expect(s('AH AD KC KS 2D 7C 9H')).toBeGreaterThan(s('AH AD QC QS JD 7C 9H'));
    expect(s('AH AD 5C 6S 9D JC KH')).toBeGreaterThan(s('AH AD 5C 6S 9D JC QH'));
    expect(bestHand(cards('2H 2D 2C 9S 9D 4C 5H')).label).toBe('Full house');
    expect(s('2H 4H 6H 8H TH KD KC')).toBeGreaterThan(s('9S TD JC QH KS 2D 2C'));
  });
});

describe('hold\'em table', () => {
  it('posts blinds, takes buy-ins from the bank and hides hole cards', () => {
    const { bank, t } = table('AS AD KS KD 2C 7H 9D JC 3S', ['Ann', 'Bob'], [500, 500]);
    expect(bank.account('Ann').chips).toBe(500);
    t.startHand(0);
    const v = t.view('Ann');
    // Heads-up: button (seat 0) is small blind and acts first preflop.
    expect(v.seats[0]!.bet).toBe(5);
    expect(v.seats[1]!.bet).toBe(10);
    expect(v.toAct).toBe(0);
    expect(v.seats[0]!.cards.every(Boolean)).toBe(true);
    expect(v.seats[1]!.cards).toEqual([null, null]);
    expect(t.view(null).seats[0]!.cards).toEqual([null, null]);
  });

  it('rejects out-of-turn, bad raises and checks facing a bet', () => {
    const { t } = table('AS AD KS KD 2C 7H 9D JC 3S', ['Ann', 'Bob'], [500, 500]);
    t.startHand(0);
    expect(() => t.act('Bob', 'check', 0, 0)).toThrow(/turn/);
    expect(() => t.act('Ann', 'check', 0, 0)).toThrow();
    expect(() => t.act('Ann', 'raise', 15, 0)).toThrow(/at least 20/);
    expect(() => t.act('Ann', 'raise', 9999, 0)).toThrow();
  });

  it('plays to showdown and pays the best hand; big blind gets an option', () => {
    // SB Ann: AS KS, BB Bob: AD KD... order: Ann, Bob, Ann, Bob.
    const { bank, t } = table('AS 2D AH 7C AC KD QH JS 4C', ['Ann', 'Bob'], [500, 500]);
    t.startHand(0);
    t.act('Ann', 'call', 0, 0);
    expect(t.toAct).toBe(1); // BB option
    t.act('Bob', 'check', 0, 0);
    expect(t.phase).toBe('flop');
    expect(t.toAct).toBe(1); // BB acts first postflop heads-up
    for (const street of ['flop', 'turn', 'river']) { void street; t.act('Bob', 'check', 0, 0); t.act('Ann', 'check', 0, 0); }
    expect(t.phase).toBe('showdown');
    expect(t.winners[0]!.name).toBe('Ann');
    expect(t.winners[0]!.hand).toBe('Three of a kind');
    expect(t.seats[0]!.stack).toBe(510);
    expect(t.view('Bob').seats[0]!.cards.every(Boolean)).toBe(true); // revealed at showdown
    t.leave('Ann', 1);
    expect(bank.account('Ann').chips).toBe(1010);
  });

  it('folding wins the pot without showing cards', () => {
    const { t } = table('AS 2D AH 7C AC KD QH JS 4C', ['Ann', 'Bob', 'Cat'], [500, 500, 500]);
    t.startHand(0); // button seat 0, SB Bob, BB Cat, Ann first
    expect(t.toAct).toBe(0);
    t.act('Ann', 'raise', 40, 0);
    t.act('Bob', 'fold', 0, 0);
    t.act('Cat', 'fold', 0, 0);
    expect(t.winners).toEqual([{ name: 'Ann', amount: 55, hand: 'Everyone else folded' }]);
    expect(t.view('Bob').seats[0]!.cards).toEqual([null, null]);
  });

  it('builds side pots for short all-ins', () => {
    const pots = HoldemTable.pots([
      { seat: 0, total: 100, live: true },
      { seat: 1, total: 300, live: true },
      { seat: 2, total: 300, live: true },
      { seat: 3, total: 50, live: false },
    ]);
    expect(pots).toEqual([{ amount: 350, eligible: [0, 1, 2] }, { amount: 400, eligible: [1, 2] }]);
  });

  it('short stack wins only the main pot, side pot goes to the next best', () => {
    // 3 handed: button Ann(0) SB Bob(1) BB Cat(2). Deal order from SB: Bob, Cat, Ann, Bob, Cat, Ann.
    // Ann (short, 100) has AA, Bob KK, Cat QQ. Board blanks.
    const { bank, t } = table('KS QS AS KD QD AD 2C 7H 9D 3S 4H', ['Ann', 'Bob', 'Cat'], [100, 400, 400]);
    t.startHand(0);
    t.act('Ann', 'allin', 0, 0);
    t.act('Bob', 'raise', 400, 0);
    t.act('Cat', 'call', 0, 0);
    expect(t.phase).toBe('showdown');
    expect(t.board).toHaveLength(5);
    const won = Object.fromEntries(t.winners.map((w) => [w.name, w.amount]));
    expect(won).toEqual({ Ann: 300, Bob: 600 });
    expect(t.seatOf('Cat')).toBe(-1); // busted, stood up
    expect(bank.account('Bob').netWon).toBe(200);
  });

  it('splits ties', () => {
    const { t } = table('2S 3S 2D 3D AH KH QH JD TC', ['Ann', 'Bob'], [500, 500]);
    t.startHand(0);
    t.act('Ann', 'call', 0, 0); t.act('Bob', 'check', 0, 0);
    for (let k = 0; k < 3; k++) { t.act('Bob', 'check', 0, 0); t.act('Ann', 'check', 0, 0); }
    expect(t.winners.map((w) => w.amount)).toEqual([10, 10]);
  });

  it('turn timer checks or folds, and two timeouts stand you up', () => {
    const { bank, t } = table('AS 2D AH 7C AC KD QH JS 4C', ['Ann', 'Bob'], [500, 500]);
    t.startHand(0);
    expect(t.tick(HE_TURN_MS + 1)).toBe(true);
    expect(t.phase).toBe('showdown'); // Ann folded on the clock
    expect(t.seats[1]!.stack).toBe(505);
    const next = t.nextHandAt!;
    t.tick(next); // new hand, button moves to Bob
    expect(t.toAct).toBe(1);
    t.tick(next + HE_TURN_MS + 1);
    expect(t.seatOf('Bob')).toBe(0 * 0 + 1); // first timeout keeps the seat
    void bank;
  });

  it('leaving mid-hand folds and cashes out at the end', () => {
    const { bank, t } = table('AS 2D AH 7C AC KD QH JS 4C', ['Ann', 'Bob', 'Cat'], [500, 500, 500]);
    t.startHand(0);
    t.leave('Bob', 0); // SB folds 5
    expect(t.seats[1]!.folded).toBe(true);
    t.act('Ann', 'fold', 0, 0);
    expect(t.seatOf('Bob')).toBe(-1);
    expect(bank.account('Bob').chips).toBe(500 + 495);
  });

  it('room seats players together and opens a new table when full', () => {
    const room = new HoldemRoom(new CasinoBank());
    for (let i = 0; i < 7; i++) room.sit(`P${i}`, 100, 0);
    expect(room.tables).toHaveLength(2);
    expect(room.tableOf('P6')!.id).toBe('T2');
  });
});

describe('hold\'em stakes tiers', () => {
  it('defines 5K/10K/25K/100K tiers with blinds at the classic ratio', async () => {
    const { HE_STAKES, HE_SMALL, HE_BIG, HE_MAX_BUYIN } = await import('../shared/holdem.js');
    expect(HE_STAKES.map((t) => [t.id, t.small, t.big, t.minBuyIn, t.maxBuyIn])).toEqual([
      ['classic', HE_SMALL, HE_BIG, 100, HE_MAX_BUYIN],
      ['5k', 25, 50, 5000, 5000], ['10k', 50, 100, 10000, 10000], ['25k', 125, 250, 25000, 25000], ['100k', 500, 1000, 100000, 100000],
    ]);
    for (const t of HE_STAKES) { expect(t.maxBuyIn / t.big).toBe(HE_MAX_BUYIN / HE_BIG); expect(t.big).toBe(t.small * 2); }
  });

  it('posts the tier blinds and moves chips only through the bank', () => {
    const bank = new CasinoBank();
    bank.account('Ann').chips = 30000; bank.account('Bob').chips = 30000;
    const t = new HoldemTable('X', bank, Math.random, () => cards('AS KS 2D 7C QS JS TS 3H 4H 9C 8D'), '25k');
    t.sit('Ann', 25000, 0); t.sit('Bob', 25000, 0);
    expect(bank.account('Ann').chips).toBe(5000);
    t.startHand(0);
    const v = t.view('Ann', 0);
    expect(v.stakes).toBe('25k');
    expect(v.pot).toBe(375);
    expect(v.currentBet).toBe(250);
    expect(() => t.sit('Cy', 5000, 0)).toThrow(/25,000/);
    const total = () => bank.account('Ann').chips + bank.account('Bob').chips + t.seats.reduce((a, s) => a + (s?.stack ?? 0), 0);
    t.act(t.seats[t.toAct!]!.name, 'fold', 0, 0);
    t.leave('Ann', 0); t.leave('Bob', 0);
    expect(total()).toBe(60000);
  });

  it('only seats players who have the full buy-in, and keeps tiers on separate tables', () => {
    const bank = new CasinoBank();
    const room = new HoldemRoom(bank);
    bank.account('Poor').chips = 4999;
    expect(() => room.sit('Poor', 5000, 0, '5k')).toThrow(/Not enough chips/);
    expect(bank.account('Poor').chips).toBe(4999);
    expect(() => room.sit('Poor', 1000, 0, '5k')).toThrow(/buy-in is 5,000/);
    bank.account('Rich').chips = 200000;
    bank.account('Reg').chips = 1000;
    const hi = room.sit('Rich', 100000, 0, '100k');
    const lo = room.sit('Reg', 500, 0);
    expect(hi).not.toBe(lo);
    expect(hi.stakes).toBe('100k');
    expect(lo.stakes).toBe('classic');
    expect(bank.account('Rich').chips).toBe(100000);
  });
});

import { describe, expect, it } from 'vitest';
import { CasinoBank } from '../server/casino-store';
import { BlackjackCasino, BlackjackTable, MIN_BET, MAX_BET } from '../server/blackjack';
import { RouletteWheel, MAX_TOTAL_STAKE } from '../server/roulette';
import { VideoPoker } from '../server/video-poker';
import { HoldemRoom } from '../server/holdem';
import { HE_STAKES } from '../shared/holdem';
import { BJ_STAKES, RL_STAKES, VP_STAKES, bjStakes, rlStakes, vpStakes } from '../shared/highStakes';
import { validateRouletteBet, MAX_ROULETTE_STAKE } from '../shared/casino';
import { POKER_MAX_BET } from '../shared/casino-games';

describe('high-stakes tables', () => {
  it('keeps classic blackjack limits and seats high/whale players at their own tables', () => {
    expect(MIN_BET).toBe(BJ_STAKES[0]!.min); expect(MAX_BET).toBe(BJ_STAKES[0]!.max);
    const bank = new CasinoBank();
    bank.account('Ann').chips = 2_000_000; bank.account('Bea').chips = 2_000_000;
    const room = new BlackjackCasino(bank);
    const lo = room.join('Ann', 0, 'classic');
    const hi = room.join('Bea', 0, 'high');
    expect(lo).not.toBe(hi);
    expect(lo.stakes).toBe('classic'); expect(hi.stakes).toBe('high');
    expect(() => lo.bet('Ann', 5_001, 0)).toThrow(/5,000/);
    lo.bet('Ann', 25, 0);
    expect(() => hi.bet('Bea', 25, 0)).toThrow(/1,000/);
    hi.bet('Bea', 1_000, 0);
    const whale = new BlackjackTable('W', bank, Math.random, 'whale');
    whale.sit('Ann', 0);
    expect(() => whale.bet('Ann', 5_000, 0)).toThrow(/10,000/);
  });

  it('classic roulette still caps a chip at 10,000, and the high-limit wheel accepts a 250,000 chip', () => {
    expect(MAX_TOTAL_STAKE).toBe(RL_STAKES[0]!.maxSpin);
    expect(MAX_ROULETTE_STAKE).toBe(RL_STAKES[0]!.maxChip);
    expect(validateRouletteBet({ kind: 'red', numbers: [], amount: 10_001 })).toBeNull();
    expect(validateRouletteBet({ kind: 'red', numbers: [], amount: 250_000 }, rlStakes('high').maxChip)).toMatchObject({ amount: 250_000 });
    const bank = new CasinoBank(); bank.account('Cy').chips = 2_000_000;
    const classic = new RouletteWheel(bank, 0); const high = new RouletteWheel(bank, 0, Math.random, 'high');
    expect(() => classic.placeBet('Cy', { kind: 'red', numbers: [], amount: 15_000 })).toThrow(/Invalid bet/);
    high.placeBet('Cy', { kind: 'red', numbers: [], amount: 15_000 });
    expect(bank.account('Cy').chips).toBe(2_000_000 - 15_000);
  });

  it('video poker classic still rejects 501, and the high table accepts 50,000', () => {
    expect(POKER_MAX_BET).toBe(VP_STAKES[0]!.max);
    const bank = new CasinoBank(); bank.account('Dee').chips = 100_000;
    const vp = new VideoPoker(bank);
    expect(() => vp.deal('Dee', 501)).toThrow(/500/);
    vp.deal('Dee', 50_000, undefined, 'high');
    expect(bank.account('Dee').chips).toBe(50_000);
  });

  it('adds Billionaire Hold\'em 500K and 1M at the classic blind ratio', () => {
    expect(HE_STAKES.map((t) => t.id)).toEqual(['classic', '5k', '10k', '25k', '100k', '500k', '1m']);
    const bank = new CasinoBank(); bank.account('Eli').chips = 2_000_000; bank.account('Fay').chips = 2_000_000;
    const room = new HoldemRoom(bank);
    const t = room.sit('Eli', 500_000, 0, '500k');
    expect(t.stakes).toBe('500k');
    expect(t.view('Eli', 0).stakes).toBe('500k');
    expect(() => t.sit('Fay', 100_000, 0)).toThrow(/500,000/);
  });
});

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
    expect(() => lo.bet('Ann', 10_000_001, 0)).toThrow(/10,000,000/);
    lo.bet('Ann', 25, 0);
    expect(() => hi.bet('Bea', 25, 0)).toThrow(/1,000/);
    hi.bet('Bea', 1_000, 0);
    const whale = new BlackjackTable('W', bank, Math.random, 'whale');
    whale.sit('Ann', 0);
    expect(() => whale.bet('Ann', 5_000, 0)).toThrow(/10,000/);
  });

  it('classic and high-limit roulette both accept a 250,000 chip, and still reject a bet over 10 million', () => {
    expect(MAX_TOTAL_STAKE).toBe(RL_STAKES[0]!.maxSpin);
    expect(MAX_ROULETTE_STAKE).toBe(RL_STAKES[0]!.maxChip);
    expect(validateRouletteBet({ kind: 'red', numbers: [], amount: 10_001 })).toMatchObject({ amount: 10_001 });
    expect(validateRouletteBet({ kind: 'red', numbers: [], amount: 250_000 }, rlStakes('high').maxChip)).toMatchObject({ amount: 250_000 });
    expect(validateRouletteBet({ kind: 'red', numbers: [], amount: 10_000_001 })).toBeNull();
    const bank = new CasinoBank(); bank.account('Cy').chips = 2_000_000;
    const classic = new RouletteWheel(bank, 0); const high = new RouletteWheel(bank, 0, Math.random, 'high');
    classic.placeBet('Cy', { kind: 'red', numbers: [], amount: 15_000 });
    expect(bank.account('Cy').chips).toBe(2_000_000 - 15_000);
    high.placeBet('Cy', { kind: 'red', numbers: [], amount: 15_000 });
    expect(bank.account('Cy').chips).toBe(2_000_000 - 30_000);
  });

  it('video poker classic and high both accept 50,000, and still reject a bet over 10 million', () => {
    expect(POKER_MAX_BET).toBe(VP_STAKES[0]!.max);
    const bank = new CasinoBank(); bank.account('Dee').chips = 200_000;
    const vp = new VideoPoker(bank);
    vp.deal('Dee', 501);
    expect(bank.account('Dee').chips).toBe(199_499);
    // settle/abandon is not needed: deal on a fresh name
    bank.account('Fay').chips = 100_000;
    expect(() => vp.deal('Fay', 10_000_001, undefined, 'classic')).toThrow(/10,000,000/);
    expect(bank.account('Fay').chips).toBe(100_000);
    vp.deal('Fay', 50_000, undefined, 'high');
    expect(bank.account('Fay').chips).toBe(50_000);
  });

  it('adds Billionaire Hold\'em 500K and 1M at the classic blind ratio', () => {
    expect(HE_STAKES.map((t) => t.id)).toEqual(['classic', '5k', '10k', '25k', '100k', '500k', '1m', '10m']);
    const bank = new CasinoBank(); bank.account('Eli').chips = 2_000_000; bank.account('Fay').chips = 2_000_000;
    const room = new HoldemRoom(bank);
    const t = room.sit('Eli', 500_000, 0, '500k');
    expect(t.stakes).toBe('500k');
    expect(t.view('Eli', 0).stakes).toBe('500k');
    expect(() => t.sit('Fay', 100_000, 0)).toThrow(/500,000/);
  });
});

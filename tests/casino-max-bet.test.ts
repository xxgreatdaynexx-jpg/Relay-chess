import { describe, expect, it } from 'vitest';
import { CASINO_MAX_BET, clampChipAmount, compactChipLabel, formatChip, parseChipAmount, validateCasinoBet } from '../shared/casino-bet.js';
import { evaluateLines, MACHINES, VS_MAX_BET, VS_MIN_BET, mulberry32, type Grid } from '../shared/video-slots.js';
import { POKER_PAYS as VP_PAYS } from '../shared/casino-games.js';
import { BJ_STAKES, RL_STAKES, VP_STAKES } from '../shared/highStakes.js';
import { HE_STAKES, heStakes } from '../shared/holdem.js';
import { betReturn, validateRouletteBet } from '../shared/casino.js';
import { CasinoBank } from '../server/casino-store.js';
import { BlackjackTable } from '../server/blackjack.js';
import { RouletteWheel } from '../server/roulette.js';
import { VideoPoker } from '../server/video-poker.js';
import { spinVideoSlot } from '../server/slots.js';
import { HoldemRoom } from '../server/holdem.js';

const fill = (s: string): Grid => Array.from({ length: 5 }, () => [s, s, s]);

describe('parseChipAmount', () => {
  it('accepts integers and comma/space grouped strings', () => {
    expect(parseChipAmount(0)).toBe(0);
    expect(parseChipAmount(20)).toBe(20);
    expect(parseChipAmount(10_000_000)).toBe(10_000_000);
    expect(parseChipAmount('20')).toBe(20);
    expect(parseChipAmount('10,000,000')).toBe(10_000_000);
    expect(parseChipAmount('10 000 000')).toBe(10_000_000);
    expect(parseChipAmount('10_000_000')).toBe(10_000_000);
    expect(parseChipAmount('  1,000  ')).toBe(1_000);
  });
  it('rejects blanks, decimals, signs and non-numeric text', () => {
    for (const x of ['', '   ', '1.5', '1e7', '-5', '$1000', 'abc', '10,00.0', true, null, undefined, 1.5, NaN, Infinity, -1]) {
      expect(parseChipAmount(x)).toBeNull();
    }
  });
});

describe('validateCasinoBet and clamp', () => {
  it('enforces integer, min, max of 10M, and balance', () => {
    expect(validateCasinoBet(20, { min: 20, max: CASINO_MAX_BET })).toEqual({ ok: true, amount: 20 });
    expect(validateCasinoBet('10,000,000', { min: 20, max: CASINO_MAX_BET })).toEqual({ ok: true, amount: CASINO_MAX_BET });
    expect(validateCasinoBet(19, { min: 20, max: CASINO_MAX_BET }).ok).toBe(false);
    expect(validateCasinoBet(CASINO_MAX_BET + 1, { min: 20, max: CASINO_MAX_BET })).toMatchObject({ ok: false, error: expect.stringMatching(/10,000,000/) });
    expect(validateCasinoBet(500, { min: 20, max: CASINO_MAX_BET, balance: 200 })).toMatchObject({ ok: false, error: expect.stringMatching(/Not enough chips/) });
    expect(validateCasinoBet('nope', { min: 1, max: 5_000 })).toMatchObject({ ok: false, error: expect.stringMatching(/whole number/) });
    // A game max above the hard cap is still capped at 10M.
    expect(validateCasinoBet(10_000_001, { min: 1, max: 99_000_000 })).toMatchObject({ ok: false, error: expect.stringMatching(/10,000,000/) });
  });
  it('clamps into range without inventing chips you do not have', () => {
    expect(clampChipAmount(1, 20, CASINO_MAX_BET)).toBe(20);
    expect(clampChipAmount(99_000_000, 20, CASINO_MAX_BET)).toBe(CASINO_MAX_BET);
    expect(clampChipAmount(5_000, 20, CASINO_MAX_BET, 1_000)).toBe(1_000);
    expect(clampChipAmount(5_000, 20, CASINO_MAX_BET, 10)).toBe(20);
  });
  it('formats large chip labels', () => {
    expect(formatChip(200)).toBe('200');
    expect(formatChip(1_000)).toBe('1,000');
    expect(formatChip(10_000)).toBe('10K');
    expect(formatChip(10_000_000)).toBe('10M');
    expect(compactChipLabel(250_000)).toBe('250k');
    expect(compactChipLabel(10_000_000)).toBe('10M');
    expect(compactChipLabel(1_500_000)).toBe('1.5M');
  });
});

describe('raised casino maxes', () => {
  it('raises classic and top-tier tables, and slots, to 10M', () => {
    expect(CASINO_MAX_BET).toBe(10_000_000);
    expect(BJ_STAKES[0]!.max).toBe(CASINO_MAX_BET);
    expect(BJ_STAKES[0]!.bets).toContain(CASINO_MAX_BET);
    expect(BJ_STAKES.find((s) => s.id === 'whale')!.max).toBe(CASINO_MAX_BET);
    expect(RL_STAKES[0]!.maxChip).toBe(CASINO_MAX_BET);
    expect(RL_STAKES[0]!.maxSpin).toBe(CASINO_MAX_BET);
    expect(RL_STAKES[0]!.chips).toContain(CASINO_MAX_BET);
    expect(RL_STAKES.find((s) => s.id === 'high')!.maxChip).toBe(CASINO_MAX_BET);
    expect(RL_STAKES.find((s) => s.id === 'high')!.maxSpin).toBe(CASINO_MAX_BET);
    expect(VP_STAKES[0]!.max).toBe(CASINO_MAX_BET);
    expect(VP_STAKES[0]!.bets).toContain(CASINO_MAX_BET);
    expect(VP_STAKES.find((s) => s.id === 'high')!.max).toBe(CASINO_MAX_BET);
    expect(VS_MIN_BET).toBe(20);
    expect(VS_MAX_BET).toBe(CASINO_MAX_BET);
    expect(heStakes('classic')).toMatchObject({ minBuyIn: 100, maxBuyIn: CASINO_MAX_BET, small: 5, big: 10 });
    expect(heStakes('10m')).toMatchObject({ minBuyIn: CASINO_MAX_BET, maxBuyIn: CASINO_MAX_BET, small: 50_000, big: 100_000 });
    expect(HE_STAKES.some((t) => t.id === '10m')).toBe(true);
  });
});

describe('server validates every 10M bet and never trusts the client', () => {
  it('slots accept any integer from 20 to 10M and reject the rest without touching chips', () => {
    const bank = new CasinoBank();
    const a = bank.account('Ann');
    a.chips = 30_000_000;
    const start = a.chips;
    for (const bet of [0, 19, 10_000_001, 1.5, NaN]) expect(() => spinVideoSlot(bank, 'Ann', 'dragon', bet)).toThrow();
    expect(a.chips).toBe(start);
    const mid = spinVideoSlot(bank, 'Ann', 'dragon', 21, mulberry32(3));
    expect(mid.cost).toBe(21);
    const max = spinVideoSlot(bank, 'Ann', 'dragon', CASINO_MAX_BET, mulberry32(4));
    expect(max.cost).toBe(CASINO_MAX_BET);
    expect(a.chips).toBe(start + mid.net + max.net);
    a.chips = 50;
    expect(() => spinVideoSlot(bank, 'Ann', 'goldrush', 200)).toThrow(/Not enough/);
    expect(a.chips).toBe(50);
  });

  it('whale blackjack, high-limit roulette and high-stakes video poker accept 10M and reject over-max or short stacks', () => {
    const bank = new CasinoBank();
    bank.account('Bea').chips = 20_000_000;
    const whale = new BlackjackTable('W', bank, Math.random, 'whale');
    whale.sit('Bea', 0);
    expect(() => whale.bet('Bea', 5_000, 0)).toThrow(/10,000/);
    expect(() => whale.bet('Bea', CASINO_MAX_BET + 1, 0)).toThrow(/10,000,000/);
    whale.bet('Bea', CASINO_MAX_BET, 0);
    expect(bank.account('Bea').chips).toBe(10_000_000);

    bank.account('Cy').chips = 20_000_000;
    const high = new RouletteWheel(bank, 0, Math.random, 'high');
    expect(validateRouletteBet({ kind: 'red', numbers: [], amount: CASINO_MAX_BET }, 250_000)).toBeNull();
    expect(validateRouletteBet({ kind: 'red', numbers: [], amount: CASINO_MAX_BET }, RL_STAKES[1]!.maxChip)).toMatchObject({ amount: CASINO_MAX_BET });
    high.placeBet('Cy', { kind: 'straight', numbers: [17], amount: CASINO_MAX_BET });
    expect(bank.account('Cy').chips).toBe(10_000_000);
    expect(() => high.placeBet('Cy', { kind: 'red', numbers: [], amount: 1 })).toThrow(/10,000,000/);

    const vp = new VideoPoker(bank);
    bank.account('Dee').chips = 20_000_000;
    expect(() => vp.deal('Dee', CASINO_MAX_BET + 1, undefined, 'high')).toThrow(/10,000,000/);
    vp.deal('Dee', CASINO_MAX_BET, undefined, 'high');
    expect(bank.account('Dee').chips).toBe(10_000_000);
  });

  it('Hold\'em 10M table takes only a 10M buy-in', () => {
    const bank = new CasinoBank();
    bank.account('Eli').chips = 20_000_000;
    const room = new HoldemRoom(bank);
    expect(() => room.sit('Eli', 1_000_000, 0, '10m')).toThrow(/10,000,000/);
    const t = room.sit('Eli', CASINO_MAX_BET, 0, '10m');
    expect(t.stakes).toBe('10m');
    expect(bank.account('Eli').chips).toBe(10_000_000);
  });

  it('classic blackjack, roulette, video poker and Hold\'em also accept a 10M bet or buy-in', () => {
    const bank = new CasinoBank();
    bank.account('Ann').chips = 40_000_000;
    const bj = new BlackjackTable('C', bank, Math.random, 'classic');
    bj.sit('Ann', 0);
    expect(() => bj.bet('Ann', CASINO_MAX_BET, 0)).not.toThrow();
    // A lone bet starts the hand immediately, so a natural blackjack can settle and pay out in the same call.
    expect(bank.account('Ann').chips).toBeLessThan(40_000_000);
    expect(Number.isSafeInteger(bank.account('Ann').chips)).toBe(true);

    bank.account('Bea').chips = 20_000_000;
    const rl = new RouletteWheel(bank, 0, Math.random, 'classic');
    expect(validateRouletteBet({ kind: 'red', numbers: [], amount: CASINO_MAX_BET })).toMatchObject({ amount: CASINO_MAX_BET });
    rl.placeBet('Bea', { kind: 'straight', numbers: [17], amount: CASINO_MAX_BET });
    expect(bank.account('Bea').chips).toBe(10_000_000);

    const vp = new VideoPoker(bank);
    bank.account('Cy').chips = 20_000_000;
    vp.deal('Cy', CASINO_MAX_BET);
    expect(bank.account('Cy').chips).toBe(10_000_000);

    bank.account('Dee').chips = 20_000_000;
    const room = new HoldemRoom(bank);
    const t = room.sit('Dee', CASINO_MAX_BET, 0, 'classic');
    expect(t.stakes).toBe('classic');
    expect(bank.account('Dee').chips).toBe(10_000_000);
    bank.account('Ed').chips = 20_000_000;
    expect(() => room.sit('Ed', CASINO_MAX_BET + 1, 1, 'classic')).toThrow(/10,?000,?000/);
  });
});

describe('10M payouts stay inside safe integers; odds are unchanged', () => {
  it('video poker royal, roulette straight and slot line/jackpot math stay exact', () => {
    const royal = CASINO_MAX_BET * VP_PAYS.royal;
    expect(royal).toBe(8_000_000_000);
    expect(Number.isSafeInteger(royal)).toBe(true);

    const straight = betReturn({ kind: 'straight', numbers: [17], amount: CASINO_MAX_BET }, 17);
    expect(straight).toBe(CASINO_MAX_BET * 36);
    expect(Number.isSafeInteger(straight)).toBe(true);

    const cfg = MACHINES.dragon;
    const wins = evaluateLines(cfg, fill('queen'), CASINO_MAX_BET);
    expect(wins).toHaveLength(20);
    expect(wins.every((w) => w.amount === 500_000_000 && Number.isInteger(w.amount))).toBe(true);
    const lineTotal = wins.reduce((s, w) => s + w.amount, 0);
    expect(lineTotal).toBe(10_000_000_000);
    expect(Number.isSafeInteger(lineTotal)).toBe(true);

    // Gold Rush grand is 500× the bet; 15 coins at 50× plus grand is 1,250× = 12.5B, still safe.
    const holdCap = Math.floor((15 * 50 + 500) * CASINO_MAX_BET);
    expect(holdCap).toBe(12_500_000_000);
    expect(Number.isSafeInteger(holdCap)).toBe(true);

    // A 21-chip custom bet floors line pays to whole chips.
    const odd = evaluateLines(cfg, fill('queen'), 21);
    expect(odd.every((w) => Number.isInteger(w.amount))).toBe(true);
    expect(odd[0]!.amount).toBe(Math.floor(1000 * (21 / 20)));
  });
});

import { describe, expect, it } from 'vitest';
import {
  evaluateLines, MACHINE_IDS, MACHINES, mulberry32, PAYLINES, playRound, simulate, VS_BETS, type Grid,
} from '../shared/video-slots.js';
import { CasinoBank } from '../server/casino-store.js';
import { spinVideoSlot } from '../server/slots.js';

const fill = (s: string): Grid => Array.from({ length: 5 }, () => [s, s, s]);

describe('video slots engine', () => {
  it('has 20 distinct paylines', () => {
    expect(PAYLINES).toHaveLength(20);
    expect(new Set(PAYLINES.map((l) => l.join())).size).toBe(20);
  });
  it('pays left-to-right with wild substitution', () => {
    const cfg = MACHINES.dragon;
    const g: Grid = [['pawn', 'rook', 'pawn'], ['knight', 'queen', 'knight'], ['bishop', 'rook', 'bishop'], ['king', 'pawn', 'king'], ['pawn', 'pawn', 'pawn']];
    const wins = evaluateLines(cfg, g, 20);
    const mid = wins.find((w) => w.line === 0)!;
    expect(mid).toMatchObject({ sym: 'rook', count: 3, amount: 15 });
    expect(wins.find((w) => w.line === 1)).toBeUndefined();
    expect(evaluateLines(cfg, fill('queen'), 20).every((w) => w.sym === 'queen' && w.count === 5 && w.amount === 1000)).toBe(true);
    // scatters break lines
    expect(evaluateLines(cfg, fill('crown'), 20)).toHaveLength(0);
  });
  it('warzone wilds expand to fill their reel', () => {
    let seed = 1;
    for (;;) {
      const r = playRound('warzone', 20, mulberry32(seed++));
      const s = r.steps[0]!;
      if (!s.expanded?.length || s.airstrike) continue;
      for (const reel of s.expanded) expect(s.final[reel]).toEqual(['star', 'star', 'star']);
      break;
    }
  });
  it('warzone airstrike turns cells into wilds before evaluation', () => {
    let seed = 1;
    for (;;) {
      const s = playRound('warzone', 20, mulberry32(seed++)).steps[0]!;
      if (!s.airstrike) continue;
      expect(s.airstrike.length).toBeGreaterThanOrEqual(3);
      for (const [r, w] of s.airstrike) expect(s.final[r]![w]).toBe('star');
      break;
    }
  });
  it('dragon chest bonus ends on collect, free spins count down with multiplier', () => {
    let chest = false, free = false;
    for (let seed = 1; seed < 20000 && !(chest && free); seed++) {
      const r = playRound('dragon', 20, mulberry32(seed));
      if (r.chest) { chest = true; expect(r.chest.picks.at(-1)).toBe(0); expect(r.chest.total).toBe(r.chest.picks.reduce((a, b) => a + b, 0)); }
      if (r.freeSpins) {
        free = true;
        expect(r.freeSpins.played).toBe(r.freeSpins.awarded);
        expect(r.steps.slice(1).every((s) => s.kind === 'free' && s.multiplier === 2)).toBe(true);
        expect(r.steps.at(-1)!.freeLeft).toBe(0);
      }
    }
    expect(chest && free).toBe(true);
  });
  it('gold rush hold & spin locks coins and resets respins when one lands', () => {
    for (let seed = 1; ; seed++) {
      const r = playRound('goldrush', 20, mulberry32(seed));
      if (!r.hold) continue;
      const f = r.hold.frames;
      expect(f[0]!.left).toBe(3);
      for (let i = 1; i < f.length; i++) {
        const before = f[i - 1]!.coins.flat().filter(Boolean).length;
        const after = f[i]!.coins.flat().filter(Boolean).length;
        expect(after).toBeGreaterThanOrEqual(before);
        expect(f[i]!.left).toBe(after > before ? 3 : f[i - 1]!.left - 1);
      }
      break;
    }
  });
});

describe('video slots server', () => {
  it('rejects bad machines/bets without touching chips, and settles the full round atomically', () => {
    const bank = new CasinoBank();
    const start = bank.account('Ann').chips;
    for (const bet of [0, 1, 19, 21, 1000, 1.5, NaN]) expect(() => spinVideoSlot(bank, 'Ann', 'dragon', bet)).toThrow();
    expect(() => spinVideoSlot(bank, 'Ann', 'nope', 20)).toThrow();
    expect(bank.account('Ann').chips).toBe(start);
    let chips = start;
    for (const m of MACHINE_IDS) for (const bet of VS_BETS.slice(0, 2)) {
      const res = spinVideoSlot(bank, 'Ann', m, bet, mulberry32(bet + m.length));
      expect(res.net).toBe(res.round.totalWin - bet);
      chips += res.net;
      expect(res.chips).toBe(chips);
    }
  });
  it('refuses a spin you cannot afford', () => {
    const bank = new CasinoBank();
    const a = bank.account('Bo');
    a.chips = 10;
    expect(() => spinVideoSlot(bank, 'Bo', 'goldrush', 20)).toThrow(/Not enough/);
    expect(a.chips).toBe(10);
  });
});

// Seeded Monte-Carlo RTP checks (1.5M rounds each). Long-run figures are in README.
describe('video slots RTP (seeded simulation)', () => {
  for (const m of MACHINE_IDS) {
    it(`${m} RTP is within 94%–96%`, () => {
      const s = simulate(m, 1_500_000, mulberry32(SEEDS[m]));
      console.log(`[rtp] ${m}`, JSON.stringify(s));
      expect(s.rtp).toBeGreaterThanOrEqual(0.94);
      expect(s.rtp).toBeLessThanOrEqual(0.96);
    }, 120_000);
  }
});
const SEEDS: Record<string, number> = { dragon: 7, warzone: 7, goldrush: 7 };

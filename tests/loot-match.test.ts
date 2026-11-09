import { describe, expect, it } from 'vitest';
import { findGroups, newLootMatch, trySwap, plausibleScore, LM_MOVES, LM_SCORE_CAP, LM_SIZE, LM_KINDS } from '../shared/lootMatch';
import { readFileSync } from 'node:fs';
import { expectChangelogEntry } from './helpers/changelog';

describe('Loot Match (pt2101u)', () => {
  it('deals an 8×8 board with hub tile kinds and no opening matches', () => {
    for (let seed = 1; seed < 40; seed++) {
      const g = newLootMatch(seed);
      expect(g.board).toHaveLength(LM_SIZE);
      expect(g.board.every((row) => row.length === LM_SIZE && row.every((t) => t && (LM_KINDS as readonly string[]).includes(t.kind)))).toBe(true);
      expect(findGroups(g.board)).toEqual([]);
      expect(g.movesLeft).toBe(LM_MOVES);
    }
  });
  it('rejects non-adjacent swaps and swaps that make no match; legal swaps cascade', () => {
    // Deterministic: search a seed with a known adjacent match-making swap
    let found = false;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const g = newLootMatch(seed);
      for (let r = 0; r < LM_SIZE && !found; r++) for (let c = 0; c < LM_SIZE - 1 && !found; c++) {
        const next = trySwap(g, [r, c], [r, c + 1]);
        if (next) {
          found = true;
          expect(next.movesLeft).toBe(LM_MOVES - 1);
          expect(next.score).toBeGreaterThan(0);
          expect(trySwap(g, [r, c], [r, c + 2])).toBeNull();
        }
      }
    }
    expect(found).toBe(true);
  });
  it('score validation is conservative', () => {
    expect(plausibleScore(0, 0)).toBe(true);
    expect(plausibleScore(LM_SCORE_CAP + 1, 30)).toBe(false);
    expect(plausibleScore(100, 31)).toBe(false);
    expect(plausibleScore(-1, 1)).toBe(false);
    expect(plausibleScore(500, 1)).toBe(true);
  });
  it('is wired into the games bar and announced without copying HuniePop', () => {
    const panel = readFileSync('client/src/components/LootMatchPanel.tsx', 'utf8');
    const logic = readFileSync('shared/lootMatch.ts', 'utf8');
    expect(panel).toMatch(/Loot Match/);
    expect(panel + logic).not.toMatch(/hunie|HuniePop|dating|romance/i);
    expect(readFileSync('client/src/components/TopTabs.tsx', 'utf8')).toMatch(/lootmatch/);
    expect(readFileSync('client/src/App.tsx', 'utf8')).toMatch(/LootMatchPanel/);
    expectChangelogEntry(/Loot Match/i, { from: '2026-11-09T00:00:00-06:00', to: '2026-11-10T00:00:00-06:00' });
  });
});

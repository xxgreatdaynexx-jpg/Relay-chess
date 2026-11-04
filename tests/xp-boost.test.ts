import { describe, expect, it } from 'vitest';
import { XP_MULT, XP_TABLE, boostXp, levelFor } from '../shared/skills';
import { Skills, MemorySkillStore, ledgerXp, combatXp } from '../server/skills';

// Base XP each source passes to awardXp (see server/*.ts call sites); the central Skills.award applies +20%.
const SOURCES: [string, Parameters<Skills['award']>[1], number][] = [
  ['racing best', 'racing', 50], ['racing finish', 'racing', 30], ['mining ore', 'mining', 15], ['mining mob', 'mining', 25],
  ['farming harvest', 'farming', 10 + Math.round(500 / 5)], ['fishing', 'fishing', 37], ['factory', 'engineering', 2 * 7],
  ['cooking', 'cooking', 11], ['chess win', 'chess', 60], ['casino', ledgerXp('slots', -400)!.skill, ledgerXp('slots', -400)!.xp],
  ['trading', ledgerXp('stocks', 900)!.skill, ledgerXp('stocks', 900)!.xp], ['combat', 'combat', combatXp({ kills: 3, participationMs: 60_000 }, true)],
];
describe('global +20% XP', () => {
  it('multiplier is 1.2, rounding is floor(base) then Math.round', () => {
    expect(XP_MULT).toBe(1.2);
    expect([1, 2, 3, 5, 30, 50, 60, 7.9].map(boostXp)).toEqual([1, 2, 4, 6, 36, 60, 72, 8]);
  });
  for (const [label, skill, base] of SOURCES) it(`${label} awards round(base*1.2)`, async () => {
    const s = new Skills(new MemorySkillStore(), () => Date.UTC(2026, 10, 1, 12));
    const e = await s.award('Xp Tester', skill, base);
    expect(e!.gained).toBe(Math.round(base * 1.2)); expect(e!.xp).toBe(Math.round(base * 1.2));
  });
  it('level thresholds unchanged', () => {
    expect(XP_TABLE[2]).toBe(83); expect(XP_TABLE[50]).toBe(101333); expect(XP_TABLE[99]).toBe(13034431); expect(levelFor(82)).toBe(1); expect(levelFor(83)).toBe(2);
  });
});

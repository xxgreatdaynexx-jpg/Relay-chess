import { beforeEach, describe, expect, it } from 'vitest';
import { MinesWorld } from '../server/mines';
import { MINE_NODES, MINE_MAP, SWING_MIN_MS, SWING_MS } from '../shared/mines';
import { canStand } from '../shared/fps';
import * as P from '../shared/skillPerks';
import { SKILLS } from '../shared/skills';
import { recipeTicks, type FRecipe } from '../shared/factory';
import { quote, feeOf as stockFee, COMPANIES } from '../shared/stocks';
import { feeOf as marketFee } from '../server/market';
import { Skills, MemorySkillStore } from '../server/skills';

describe('skill perk curves', () => {
  it('scale 0 at level 1 to max at 99, clamped', () => {
    expect(P.perkT(1)).toBe(0); expect(P.perkT(99)).toBe(1); expect(P.perkT(500)).toBe(1); expect(P.perkT(-3)).toBe(0);
    expect(P.miningSwingMul(1)).toBe(1); expect(P.miningSwingMul(99)).toBeCloseTo(0.65);
    expect(P.miningBonusChance(1)).toBe(0); expect(P.miningBonusChance(99)).toBeCloseTo(0.15);
    expect(P.engineeringTimeMul(99)).toBeCloseTo(0.75); expect(P.farmingGrowMul(99)).toBeCloseTo(0.75);
    expect(P.racingEntryMul(99)).toBeCloseTo(0.8); expect(P.combatDamageMul(99)).toBeCloseTo(0.95);
    expect(P.tradingFeeMul(99)).toBeCloseTo(0.7); expect(P.propertyTaxMul(99)).toBeCloseTo(0.8);
    expect(P.chessDailyBonus(1)).toBe(0); expect(P.chessDailyBonus(99)).toBe(50);
    expect(P.fishingBiteMul(99)).toBeCloseTo(0.75); expect(P.fishingLuckRoll(0, 1)).toBe(0); expect(P.fishingLuckRoll(0.5, 99)).toBeCloseTo(0.54);
    for (let l = 2; l <= 99; l++) expect(P.miningSwingMul(l)).toBeLessThan(P.miningSwingMul(l - 1));
  });
  it('every skill except gambling has perk text; gambling stays cosmetic', () => {
    for (const s of SKILLS) expect(P.perkText(s.id, 50).length).toBeGreaterThan(0);
    expect(P.perkText('gambling', 99)).toMatch(/never change/);
    expect(P.perkText('mining', 99)).toBe('35% faster swings, 15% chance of double ore');
  });
  it('fees never drop below 1 chip and never go negative', () => {
    expect(stockFee(10, 0)).toBe(1); expect(marketFee(10, 0.1)).toBe(1);
    expect(stockFee(100_000, P.tradingFeeMul(99))).toBe(700); expect(stockFee(100_000)).toBe(1000);
    const c = COMPANIES[0]; const b = quote(c, 50, 'buy', 100, 0.7), s = quote(c, 50, 'sell', 100, 0.7);
    expect(b.total).toBeGreaterThan(s.total); // still no round-trip profit
  });
  it('factory craft ticks shrink with engineering but stay >= 1', () => {
    const r = { secs: 10 } as FRecipe;
    expect(recipeTicks(r, 0.75)).toBeLessThan(recipeTicks(r)); expect(recipeTicks({ secs: 0.01 } as FRecipe, 0.75)).toBe(1);
    expect(recipeTicks(r, 0.1)).toBe(recipeTicks(r, 0.5)); // clamped
  });
});

describe('skills level cache', () => {
  it('levelOf reads the store; levelSync is 1 until warm', async () => {
    const s = new Skills(new MemorySkillStore());
    expect(s.levelSync('Perky', 'mining')).toBe(1);
    await s.award('Perky', 'mining', 3000);
    expect(s.levelSync('Perky', 'mining')).toBeGreaterThan(1);
    expect(await s.levelOf('Perky', 'mining')).toBe(s.levelSync('Perky', 'mining'));
  });
});

describe('mining perk in the mine', () => {
  let w: MinesWorld;
  beforeEach(() => { w = new MinesWorld(); });
  function stand(id: string, i: number) {
    const n = MINE_NODES[i]; const m = w.miners.get(id)!;
    for (let r = 1.0; r < 2.6; r += 0.2) for (let k = 0; k < 16; k++) {
      const x = n.x + Math.cos((k / 16) * Math.PI * 2) * r, y = n.y + Math.sin((k / 16) * Math.PI * 2) * r;
      if (canStand(x, y, 0, MINE_MAP)) { m.x = x; m.y = y; m.z = 0; try { w.hit(id, i, -1e9); } catch (e) { if (/far|way/.test((e as Error).message)) continue; } m.lastHit = 0; m.hits = []; return; }
    }
  }
  it('level 99 swings 35% faster; level 1 is unchanged', () => {
    w.miningLevel = () => 99; w.bonusRng = () => 1;
    w.join('a', 'Perk-Miner', 0); stand('a', 0);
    w.hit('a', 0, 10_000);
    const fast = Math.ceil(SWING_MIN_MS * 0.65);
    expect(() => w.hit('a', 0, 10_000 + fast - 5)).toThrow(/fast/);
    expect(() => w.hit('a', 0, 10_000 + fast + 1)).not.toThrow();
    w.miningLevel = () => 1;
    expect(() => w.hit('a', 0, 10_000 + fast + 1 + fast + 1)).toThrow(/fast/);
    expect(Math.round(SWING_MS * P.miningSwingMul(99))).toBeLessThan(SWING_MS);
  });
  it('bonus ore adds exactly one extra ore when the roll hits, never at level 1', () => {
    const run = (lvl: number, roll: number) => {
      const ww = new MinesWorld(); w = ww; ww.miningLevel = () => lvl; ww.bonusRng = () => roll;
      ww.join('b', 'Perk-Miner2', 0); stand('b', 0);
      let t = 50_000, r; do { r = ww.hit('b', 0, t); t += SWING_MIN_MS; } while (!r.broke && !r.full);
      return { r, qty: [...ww.miners.get('b')!.carried.values()].reduce((a, s) => a + s.qty, 0) };
    };
    expect(run(99, 0.01)).toMatchObject({ qty: 2, r: { broke: true, bonus: 1 } });
    expect(run(99, 0.5).qty).toBe(1);
    expect(run(1, 0).qty).toBe(1);
  });
});

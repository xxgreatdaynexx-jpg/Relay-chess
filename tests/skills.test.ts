import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { XP_TABLE, levelFor, progress, totalLevel, SKILLS, titleFor, badgeFor } from '../shared/skills';
import { Skills, MemorySkillStore, PgSkillStore, CAPS, ledgerXp, combatXp } from '../server/skills';

describe('skills XP curve', () => {
  it('matches the RuneScape table', () => {
    expect(XP_TABLE[2]).toBe(83); expect(XP_TABLE[10]).toBe(1154); expect(XP_TABLE[50]).toBe(101333);
    expect(XP_TABLE[92]).toBe(6517253); expect(XP_TABLE[99]).toBe(13034431);
    expect(levelFor(0)).toBe(1); expect(levelFor(82)).toBe(1); expect(levelFor(83)).toBe(2); expect(levelFor(13034431)).toBe(99); expect(levelFor(2e8)).toBe(99);
    expect(progress(83).toNext).toBe(174 - 83);
    expect(totalLevel({})).toBe(SKILLS.length);
    expect(titleFor(9)).toBe('Newcomer'); expect(badgeFor(99)).toBe('👑');
  });
});

describe('Skills awards', () => {
  it('awards, levels up, caps per hour, and hides QA from hiscores', async () => {
    let now = Date.UTC(2026, 10, 1, 12);
    const s = new Skills(new MemorySkillStore(), () => now);
    const evs: unknown[] = []; s.onXp((e) => evs.push(e));
    const e = await s.award('Alice', 'mining', 100);
    expect(e).toMatchObject({ skill: 'mining', gained: 100, xp: 100, level: 2, leveledUp: true });
    const total = (await s.award('alice', 'mining', 10_000_000))!;
    expect(total.gained).toBe(CAPS.mining.hour - 100);
    expect(await s.award('Alice', 'mining', 10)).toBeNull(); // capped this hour
    now += 3_600_000; expect((await s.award('Alice', 'mining', 10))!.gained).toBe(10);
    expect(await s.award('Alice', 'mining', 0)).toBeNull(); expect(await s.award(null, 'mining', 5)).toBeNull();
    await s.award('QA-Bot1', 'mining', 2000); await s.award('Bob', 'chess', 60);
    const hi = await s.hiscores('mining'); expect(hi.map((r) => r.name.toLowerCase())).toEqual(['alice']);
    now += 20_000;
    const all = await s.hiscores('overall'); expect(all.map((r) => r.name.toLowerCase())).toEqual(['alice', 'bob']);
    expect(all.some((r) => /qa-/i.test(r.name))).toBe(false);
    const prof = await s.profile('ALICE'); expect(prof.skills.find((x) => x.id === 'mining')!.xp).toBe(CAPS.mining.hour + 10);
    expect(evs.length).toBe(5);
  });

  it('persists atomically in Postgres (pg-mem)', async () => {
    const { Pool } = newDb().adapters.createPg();
    const store = new PgSkillStore(new Pool()); await store.init();
    const s = new Skills(store);
    await Promise.all([s.award('Carol', 'farming', 50), s.award('Carol', 'farming', 70)]);
    expect((await s.profile('carol')).skills.find((x) => x.id === 'farming')!.xp).toBe(120);
    const s2 = new Skills(store); // a restart / another instance sees the same XP
    expect((await s2.profile('Carol')).total).toBe(SKILLS.length - 1 + levelFor(120));
  });

  it('maps ledger moves and arena results to XP', () => {
    expect(ledgerXp('roulette', -100)).toEqual({ skill: 'gambling', xp: 5 });
    expect(ledgerXp('roulette', 500)).toBeNull(); // wins earn nothing: odds and payouts untouched
    expect(ledgerXp('slots', -1)).toEqual({ skill: 'gambling', xp: 1 });
    expect(ledgerXp('stocks', -1000, 'reverted')).toBeNull();
    expect(ledgerXp('stocks', -1000)).toEqual({ skill: 'trading', xp: 15 });
    expect(ledgerXp('farm_harvest', 50)?.skill).toBe('farming');
    expect(ledgerXp('property_buy', -50_000)?.skill).toBe('property');
    expect(ledgerXp('daily_bonus', 1000)).toBeNull(); expect(ledgerXp('chess', -50)).toBeNull();
    expect(combatXp({ kills: 3, participationMs: 120_000 }, true)).toBe(75 + 50 + 150);
    expect(combatXp({ kills: 999, participationMs: 120_000 }, false)).toBe(1000 + 50);
    expect(combatXp({ kills: 0, participationMs: 5_000 }, false)).toBe(0);
  });
});

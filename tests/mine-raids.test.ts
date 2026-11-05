import { describe, it, expect } from 'vitest';
import { MinesWorld, instKey } from '../server/mines';
import { RaidParties } from '../server/mineRaids';
import { raidHpMul, raidDmgMul, raidBossHpMul, raidPotSize, raidBlockReason, lootRoll, RAID_MAX } from '../shared/mineRaids';
import { mobHp, BOSS_FLOOR } from '../shared/mineCombat';
import { floorKey } from '../shared/mineFloors';
import { LAUNCH } from '../shared/launchPopup';
import { CHANGELOG } from '../shared/changelog';

type Save = { key: string; extra?: Array<{ sql: string; args: unknown[] }> };
function world(party: Record<string, string> = {}) {
  const w = new MinesWorld();
  w.gearOf = () => ({ weapon: 'diamond_saber', armor: 'none' });
  const sizes = () => { const c: Record<string, number> = {}; for (const i of Object.values(party)) c[i] = (c[i] ?? 0) + 1; return c; };
  w.raidOf = (a) => (a ? party[a] : undefined); w.raidSize = (i) => sizes()[i] ?? 1;
  const saves: Save[] = [];
  w.store = { init: async () => {}, load: async () => ({ items: [], daily: [] }), saveCarried: async () => {}, loadCarried: async () => [], save: async (key, _n, _s, _sale, _f, extra) => { saves.push({ key, extra }); } };
  return { w, saves };
}
const ore = (m: { carried: Map<string, { qty: number }> }) => [...m.carried.values()].reduce((t, s) => t + s.qty, 0);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('co-op mine raids: rules', () => {
  it('scaling grows with party size; party bosses get extra', () => {
    expect(raidHpMul(1)).toBe(1); expect(raidHpMul(2)).toBe(1.75); expect(raidHpMul(4)).toBe(3.25); expect(raidHpMul(9)).toBe(raidHpMul(RAID_MAX));
    expect(raidDmgMul(3)).toBeCloseTo(1.3); expect(raidBossHpMul(1)).toBe(1); expect(raidBossHpMul(2)).toBeCloseTo(1.75 * 1.25);
    expect(raidPotSize(3, 40)).toBe(10);
  });
  it('QA, bot, jailed and guest accounts are excluded', () => {
    expect(raidBlockReason(null, { qa: false, jailed: false })).toMatch(/Sign in/);
    expect(raidBlockReason('Rex', { qa: true, jailed: false })).toMatch(/QA/);
    expect(raidBlockReason('qa-bot-7', { qa: false, jailed: false })).toMatch(/bot/);
    expect(raidBlockReason('Rex', { qa: false, jailed: true })).toMatch(/jail/);
    expect(raidBlockReason('Rex', { qa: false, jailed: false })).toBeNull();
    const p = new RaidParties(); p.jailed = (n) => n === 'Jail';
    expect(() => p.create('QA-Cole-Visit')).toThrow(/QA/); expect(() => p.create('Jail')).toThrow(/jail/);
    p.allowQa = true; expect(p.create('QA-Cole-Visit').code).toMatch(/^[A-Z0-9]{5}$/);
  });
  it('loot roll: one d100 each, ties re-rolled, deterministic', () => {
    const seq = [0.5, 0.5, 0.2, 0.9]; let i = 0; const r = lootRoll(['A', 'B'], () => seq[i++]);
    expect(r.winner).toBe('B'); expect(r.rolls.map((x) => x.roll)).toEqual([21, 91]);
    expect(lootRoll([], Math.random).winner).toBeNull();
  });
  it('parties: join by code, full at 4, replay join is a no-op, leave of 2 drops the instance', () => {
    const p = new RaidParties(); const changes: Array<[string[], string[]]> = []; p.onChange = (a, b) => changes.push([a, b]);
    const party = p.create('Ann'); expect(p.inst('Ann')).toBeUndefined(); // party of one plays the public mine
    p.join('Bob', party.code.toLowerCase()); expect(p.inst('Ann')).toBe(`p:${party.id}`); expect(p.size(`p:${party.id}`)).toBe(2);
    p.join('Bob', party.code); expect(party.members.size).toBe(2);
    p.join('Cy', party.code); p.join('Di', party.code); expect(() => p.join('Ed', party.code)).toThrow(/full/);
    expect(() => p.create('Bob')).toThrow(/already/); expect(() => p.join('Ed', 'ZZZZZ')).toThrow(/No raid/);
    expect(() => p.kick('Bob', 'Cy')).toThrow(/leader/); p.kick('Ann', 'Cy'); p.leave('Di');
    p.leave('Ann'); expect(changes.at(-1)![1]).toEqual([`p:${party.id}`]); expect(p.inst('Bob')).toBeUndefined();
    expect(p.view('Bob')!.leader).toBe('Bob');
  });
});

describe('co-op mine raids: instances', () => {
  it('a party gets its own scaled floor; the public floor is untouched', () => {
    const { w } = world({ Ann: 'p:x', Bob: 'p:x' });
    const a = w.join('a', 'Ann', 1000, 'fortmc'); w.join('b', 'Bob', 1000, 'fortmc'); const solo = w.join('s', 'Sol', 1000, 'fortmc');
    expect(a.inst).toBe('p:x'); expect(solo.inst).toBeUndefined();
    const pub = w.mobsOn(BOSS_FLOOR, 'fortmc'); const raid = w.mobsOn(BOSS_FLOOR, 'fortmc', 'p:x');
    expect(pub).not.toBe(raid); expect(w.floorMobs.has(instKey(floorKey('fortmc', BOSS_FLOOR), 'p:x'))).toBe(true);
    const boss = raid.find((b) => b.kind === 'boss')!; const pb = pub.find((b) => b.kind === 'boss')!;
    expect(pb.max).toBe(Math.round(mobHp('boss', BOSS_FLOOR))); expect(boss.max).toBe(Math.round(mobHp('boss', BOSS_FLOOR) * raidBossHpMul(2))); expect(boss.party).toBe(2);
    const n = raid.find((b) => b.kind !== 'boss')!; expect(n.max).toBe(Math.round(mobHp(n.kind, BOSS_FLOOR) * 1.75)); expect(pub[n.id].party).toBeUndefined();
  });
  it('personal veins: each member has their own copy of every rock', () => {
    const { w } = world({ Ann: 'p:x', Bob: 'p:x' });
    const a = w.join('a', 'Ann', 1000, 'fortmc'); const b = w.join('b', 'Bob', 1000, 'fortmc');
    const na = w.nodeStates('fortmc', 5, w.nodeInst(a)); const nb = w.nodeStates('fortmc', 5, w.nodeInst(b));
    expect(na).not.toBe(nb); na[0].hp = 0; expect(nb[0].hp).toBeGreaterThan(0); expect(w.nodeStates('fortmc', 5)[0].hp).toBeGreaterThan(0);
  });
  it('party kills give every member on the floor their own loot; the party boss rolls once and commits in one transaction', async () => {
    const { w, saves } = world({ Ann: 'p:x', Bob: 'p:x', Cy: 'p:x' });
    const a = w.join('a', 'Ann', 1000, 'fortmc'); const b = w.join('b', 'Bob', 1000, 'fortmc'); const c = w.join('c', 'Cy', 1000, 'fortmc');
    for (const m of [a, b]) w.setFloor(m, BOSS_FLOOR, 1000); await flush(); w.setFloor(c, 3, 1000); // Cy is elsewhere: no share
    const boss = w.mobsOn(BOSS_FLOOR, 'fortmc', 'p:x').find((x) => x.kind === 'boss')!; boss.hp = 1;
    Object.assign(a, { x: boss.x - 1.2, y: boss.y, z: 0 }); let rn = 0; w.bonusRng = () => [0.1, 0.9][rn++ % 2] ?? 0.5;
    const r = w.attack('a', boss.id, 9000);
    expect(r.killed).toBe(true); expect(r.raid!.shared.map((s) => s.id)).toEqual(['b']); expect(ore(b)).toBeGreaterThan(0); expect(ore(c)).toBe(0);
    const roll = r.raid!.roll!; expect(roll.rolls.map((x) => x.name).sort()).toEqual(['Ann', 'Bob']); expect(roll.winner).not.toBeNull(); expect(roll.pot.length).toBeGreaterThan(0);
    await flush();
    const tx = saves.filter((s) => s.extra?.some((e) => /mine_raid_rolls/.test(e.sql)));
    expect(tx).toHaveLength(1); const rows = tx[0].extra!;
    expect(rows[0].sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/); expect(rows[0].args[0]).toBe(roll.id);
    expect(rows.filter((e) => /mine_carried/.test(e.sql)).map((e) => e.args[1]).sort()).toEqual(['Ann', 'Bob']);
    // replay of the same kill id: no second roll, no second pot
    const winner = roll.winner === 'Ann' ? a : b; const before = ore(winner);
    boss.deadUntil = 0; boss.hp = 1; boss.lives = (boss.lives ?? 1) - 1; Object.assign(a, { x: boss.x - 1.2, y: boss.y, z: 0 });
    const r2 = w.attack('a', boss.id, 20000); expect(r2.raid!.roll).toBeUndefined(); await flush();
    expect(saves.filter((s) => s.extra?.some((e) => /mine_raid_rolls/.test(e.sql)))).toHaveLength(1);
    expect(ore(winner)).toBeLessThan(before + roll.pot.reduce((t, s) => t + s.qty, 0) + 1);
  });
  it('solo players and the public mine never roll', async () => {
    const { w } = world(); const a = w.join('a', 'Ann', 1000, 'fortmc'); await flush(); w.setFloor(a, BOSS_FLOOR, 1000);
    const boss = w.mobsOn(BOSS_FLOOR, 'fortmc').find((x) => x.kind === 'boss')!; boss.hp = 1; Object.assign(a, { x: boss.x - 1.2, y: boss.y, z: 0 });
    const r = w.attack('a', boss.id, 9000); expect(r.killed).toBe(true); expect(r.raid).toBeUndefined();
  });
  it('raid elevator reaches the deepest floor any member has been; leaving re-seats and drops the instance', () => {
    const party: Record<string, string> = { Ann: 'p:x', Bob: 'p:x' }; const { w } = world(party);
    const a = w.join('a', 'Ann', 1000, 'fortmc'); const b = w.join('b', 'Bob', 1000, 'fortmc'); b.deepest = 30;
    expect(w.raidDeepest(a)).toBe(30);
    w.mobsOn(5, 'fortmc', 'p:x'); delete party.Bob; delete party.Ann;
    expect(w.setInst(a, undefined)).toBe(true); expect(w.setInst(b, undefined)).toBe(true); w.dropInstance('p:x');
    expect([...w.floorMobs.keys()].some((k) => String(k).startsWith('p:x'))).toBe(false); expect(w.raidDeepest(a)).toBe(w.deepestOf(a));
  });
  it('launch popup and changelog announce raids', () => {
    expect(LAUNCH.items.some((i) => i.section === 'Co-op' && /raid/i.test(i.title))).toBe(true);
    expect(CHANGELOG.slice(0, 10).some((e) => /raid/i.test(e.title))).toBe(true);
  });
});

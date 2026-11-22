import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CasinoBank } from '../server/casino-store';
import { buyAnimals, collectRanch, hireHand, loadRanches, ranchView, resetRanchMemory, sellAnimals, type RanchDeps } from '../server/westRanch';
import type { WestMines } from '../server/westActivities';
import { ANIMALS, BARN_HOURS, HAND_BARN_HOURS, RANCH_MIGRATION, RANCH_UNIT_DAY, animalDay, handWagePerDay, newRanch, ranchCapacity, settle, westRanches } from '../shared/westRanch';
import { propertyById, properties, isWestDeed } from '../shared/realEstate';
import { expansionFarmPrice } from '../shared/mapExpansion';
import { WEST_FIELDS } from '../shared/westCity';
import { obbOverlap } from '../shared/worldLayout';
import { zoneOf } from '../shared/zoning';
import type { ItemType } from '../shared/mines';

const T0 = Date.parse('2026-11-22T12:00:00Z'); const H = 3_600_000;
const START = new CasinoBank().account('Nobody').chips;
function memMines(): WestMines & { put(n: string, t: ItemType, id: string, q: number): void } {
  const packs = new Map<string, Map<string, number>>(); const pack = (n: string) => { const k = n.toLowerCase(); let p = packs.get(k); if (!p) { p = new Map(); packs.set(k, p); } return p; };
  return { offline: false, put(n, t, id, q) { pack(n).set(`${t}:${id}`, q); }, stackQty: (n, t, id) => pack(n).get(`${t}:${id}`) ?? 0,
    adjustStacks(n, deltas, extra = [], fallback) { const p = pack(n); for (const d of deltas) if ((p.get(`${d.type}:${d.id}`) ?? 0) + d.delta < 0) return false; for (const d of deltas) p.set(`${d.type}:${d.id}`, (p.get(`${d.type}:${d.id}`) ?? 0) + d.delta); fallback?.(extra); return true; } };
}
function setup(o: { owner?: string | null; here?: boolean; jailed?: boolean } = {}) {
  const bank = new CasinoBank(); bank.retryMs = []; let now = T0; const mines = memMines(); let owner: string | null = o.owner === undefined ? 'ann' : o.owner;
  const d: RanchDeps = { bank: () => bank as never, mines: () => mines, inCity: () => o.here ?? true, jailed: () => o.jailed ?? false, px: (n) => n, clock: () => now,
    ownerOf: async () => (owner ? { key: owner, name: owner } : null) };
  return { bank, mines, d, tick: (ms: number) => { now += ms; }, setOwner: (k: string | null) => { owner = k; } };
}
const seed = async (bank: CasinoBank, n = 100_000) => bank.transferConfirmed('Ann', n, { key: `seed:${n}:${Math.random()}`, game: 'test' });
beforeEach(() => resetRanchMemory());

describe('ranch deeds', () => {
  it('six pastures become ranch deeds priced like West Chud farms of the same size', () => {
    const rs = westRanches(); expect(rs.length).toBe(6); expect(new Set(rs.map((r) => r.id)).size).toBe(6);
    for (const r of rs) {
      const p = propertyById(r.id)!; expect(p.kind).toBe('farm'); expect(p.type).toBe('ranch'); expect(p.price).toBe(expansionFarmPrice({ cols: r.cols, rows: r.rows })); expect(p.tiles).toBe(r.tiles);
      expect(isWestDeed(r.id)).toBe(true); expect(zoneOf(p)).toBe('farmland');
      expect(WEST_FIELDS.some((f) => f.kind === 'pasture' && f.x === r.x && f.z === r.z)).toBe(true);
      expect(properties().filter((o) => o.id !== r.id && !o.map && obbOverlap(o, r, 0))).toEqual([]);
    }
    expect(rs.map((r) => r.price)).toEqual([99_000, 61_000, 70_000, 71_000, 60_000, 60_000]);
  });
  it('every animal makes the same value per unit of pasture; a full ranch is modest next to a tended farm', () => {
    for (const a of ANIMALS) expect(animalDay(a) / a.units).toBe(RANCH_UNIT_DAY);
    for (const r of westRanches()) { const full = ranchCapacity(r) * RANCH_UNIT_DAY; expect(full / r.price).toBeLessThan(0.1); expect(full / r.price).toBeGreaterThan(0.03); }
    expect(RANCH_MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS westchud_ranches/); expect(RANCH_MIGRATION).not.toMatch(/\b(DROP|ALTER|DELETE|TRUNCATE)\b/i);
  });
  it('production fills the barn on timers and stops at the barn cap (longer with a hand)', () => {
    const s = newRanch(T0); s.herd.chicken = 10; s.herd.cow = 2;
    settle(s, T0 + 2 * H); expect(s.barn.chicken).toBe(10); expect(s.barn.cow).toBe(8);
    settle(s, T0 + 48 * H); expect(s.barn.chicken).toBe(10 * BARN_HOURS / 2); expect(s.barn.cow).toBe(2 * BARN_HOURS * 2);
    const t = newRanch(T0); t.herd.chicken = 10; t.handUntil = T0 + 100 * H; settle(t, T0 + 72 * H); expect(t.barn.chicken).toBe(10 * HAND_BARN_HOURS / 2);
  });
});

describe('ranch actions', () => {
  it('owner only, in the city, not jailed', async () => {
    await expect(buyAnimals('Ann', { id: 'ranch:1', animal: 'cow', n: 1 }, setup({ owner: 'bob' }).d)).rejects.toThrow(/deed first/);
    await expect(buyAnimals('Ann', { id: 'ranch:1', animal: 'cow', n: 1 }, setup({ here: false }).d)).rejects.toThrow(/Chud City/);
    await expect(buyAnimals('Ann', { id: 'ranch:1', animal: 'cow', n: 1 }, setup({ jailed: true }).d)).rejects.toThrow(/Not available/);
    await expect(buyAnimals('Ann', { id: 'cf:3001', animal: 'cow', n: 1 }, setup().d)).rejects.toThrow(/Pick a ranch/);
  });
  it('buy animals (chips), collect food to the pantry and wool for chips, sell back at half', async () => {
    const { bank, mines, d, tick } = setup(); await seed(bank); const c0 = bank.account('Ann').chips;
    expect((await buyAnimals('Ann', { id: 'ranch:2', animal: 'chicken', n: 10 }, d)).paid).toBe(600);
    await buyAnimals('Ann', { id: 'ranch:2', animal: 'sheep', n: 5 }, d); await buyAnimals('Ann', { id: 'ranch:2', animal: 'cow', n: 3 }, d); await buyAnimals('Ann', { id: 'ranch:2', animal: 'pig', n: 2 }, d);
    expect(bank.account('Ann').chips).toBe(c0 - 600 - 600 - 720 - 360);
    await expect(collectRanch('Ann', { id: 'ranch:2' }, d)).rejects.toThrow(/barn is empty/);
    tick(4 * H); const c1 = bank.account('Ann').chips; const r = await collectRanch('Ann', { id: 'ranch:2' }, d);
    expect(mines.stackQty('Ann', 'food', 'eggs')).toBe(20); expect(mines.stackQty('Ann', 'food', 'milk')).toBe(24); expect(mines.stackQty('Ann', 'food', 'bacon')).toBe(4);
    expect(r.woolPay).toBe(5 * 12); expect(bank.account('Ann').chips - c1).toBe(60);
    expect((await sellAnimals('Ann', { id: 'ranch:2', animal: 'cow', n: 1 }, d)).paid).toBe(120);
    await expect(sellAnimals('Ann', { id: 'ranch:2', animal: 'cow', n: 5 }, d)).rejects.toThrow(/You have 2/);
    const v = await ranchView('Ann', 'ranch:2', d); expect(v.herd).toEqual({ cow: 2, sheep: 5, pig: 2, chicken: 10 }); expect(v.used).toBe(8 + 10 + 6 + 10);
  });
  it('pasture room caps the herd', async () => {
    const { bank, d } = setup(); await seed(bank, 1_000_000); const cap = ranchCapacity(westRanches()[1]!);
    let left = cap; while (left >= 200) { await buyAnimals('Ann', { id: 'ranch:2', animal: 'cow', n: 50 }, d); left -= 200; }
    await expect(buyAnimals('Ann', { id: 'ranch:2', animal: 'cow', n: Math.floor(left / 4) + 1 }, d)).rejects.toThrow(/Not enough pasture/);
    await expect(buyAnimals('Ann', { id: 'ranch:2', animal: 'cow', n: 51 }, d)).rejects.toThrow(/1 to 50/);
  });
  it('no chips: nothing bought', async () => {
    const { bank, d } = setup(); const c = bank.account('Ann').chips; await bank.transferConfirmed('Ann', -c, { key: 'drain', game: 'test' });
    await expect(buyAnimals('Ann', { id: 'ranch:1', animal: 'cow', n: 1 }, d)).rejects.toThrow(/Not enough chips/);
    expect((await ranchView('Ann', 'ranch:1', d)).herd.cow).toBe(0);
  });
  it('ranch hand: wage from the herd, prepaid days, longer barn', async () => {
    const { bank, d, tick } = setup(); await seed(bank);
    await expect(hireHand('Ann', { id: 'ranch:1', days: 1 }, d)).rejects.toThrow(/Stock some animals/);
    await buyAnimals('Ann', { id: 'ranch:1', animal: 'chicken', n: 40 }, d);
    const wage = handWagePerDay({ cow: 0, sheep: 0, pig: 0, chicken: 40 }); expect(wage).toBe(Math.round(40 * 36 * 0.25));
    const r = await hireHand('Ann', { id: 'ranch:1', days: 3 }, d); expect(r.paid).toBe(wage * 3);
    await expect(hireHand('Ann', { id: 'ranch:1', days: 5 }, d)).rejects.toThrow(/booked up/);
    tick(40 * H); expect((await collectRanch('Ann', { id: 'ranch:1' }, d)).got).toEqual([{ id: 'eggs', qty: 40 * 20 }]);
  });
  it('a new owner starts with an empty pasture; state reloads after a restart', async () => {
    const { bank, d, setOwner } = setup(); await seed(bank); await buyAnimals('Ann', { id: 'ranch:3', animal: 'pig', n: 4 }, d);
    setOwner('bob'); const bob = await ranchView('Bob', 'ranch:3', d); expect(bob.owner).toBe(true); expect(bob.herd.pig).toBe(0);
    const state = JSON.stringify({ ...newRanch(T0), herd: { cow: 1, sheep: 0, pig: 0, chicken: 0 } });
    expect(await loadRanches({ query: async () => ({ rows: [{ ranch_id: 'ranch:4', player_key: 'ann', name: 'Ann', state }] }) }, T0)).toBe(1);
    expect((await ranchView('Ann', 'ranch:4', setup().d)).herd.cow).toBe(1);
  });
});

describe('ranch wiring', () => {
  it('server, map and deed panel', () => {
    expect(readFileSync('server/sockets.ts', 'utf8')).toContain('registerRanches(io, socket)');
    expect(readFileSync('server/index.ts', 'utf8')).toMatch(/initRanches\(/);
    expect(readFileSync('client/src/lib/world3d.ts', 'utf8')).toContain("id.startsWith('ranch:')");
    const map = readFileSync('client/src/components/WorldMap.tsx', 'utf8'); expect(map).toContain('deed-ranch'); expect(map).toContain("k: 'ranch'");
    expect(START).toBeGreaterThanOrEqual(0);
  });
});

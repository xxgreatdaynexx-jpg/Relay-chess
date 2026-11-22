import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CasinoBank } from '../server/casino-store';
import { chestSpot, claimTour, dig, dive, diveFind, islandActivityState, resetIslandActivityMemory, startTour, type ActivityDeps } from '../server/islandActivities';
import { CHEST_PAY, DIG_PER_DAY, DIVE_COOLDOWN_MS, DIVE_FINDS, DIVE_PER_DAY, diveEV, diveFindOf, islandDayKey, ISLAND_HELI, ISLAND_HUNT, ISLAND_SNORKEL, TOUR_MS, TOUR_PAY, TREASURE_SPOTS, treasureSpots, TRINKET_PAY } from '../shared/islandActivities';
import { ISLAND_DOCK, ISLAND_LAGOON, ISLAND_LOTS, ISLAND_LOUNGE, islandSpots } from '../shared/island';

const T0 = Date.parse('2026-11-22T12:00:00Z');
const DAY = 86_400_000;
const START = new CasinoBank().account('Nobody').chips; // new accounts start with a few chips
function setup(o: { here?: boolean; jailed?: boolean; salt?: string } = {}) {
  const bank = new CasinoBank(); bank.retryMs = []; let now = T0;
  const d: ActivityDeps = { bank: () => bank, atIsland: () => o.here ?? true, jailed: () => o.jailed ?? false, px: (n) => n, clock: () => now, salt: o.salt ?? 'test-salt' };
  return { bank, d, tick: (ms: number) => { now += ms; }, at: () => now };
}
beforeEach(() => resetIslandActivityMemory());

describe('island day activity tables', () => {
  it('dive odds sum to 100 with a modest expected value', () => {
    expect(DIVE_FINDS.reduce((a, f) => a + f.odds, 0)).toBe(100);
    expect(Math.round(diveEV())).toBe(1_061);
    expect(DIVE_PER_DAY).toBe(5); expect(DIVE_FINDS.at(-1)!.pay * DIVE_PER_DAY).toBe(75_000);
    expect(diveFindOf(0).id).toBe('conch'); expect(diveFindOf(0.9999).id).toBe('doubloon'); expect(diveFindOf(0.5).id).toBe('seaglass');
  });
  it('the 12 X marks sit on the beach, clear of estates, dock, lagoon and lounge', () => {
    const xs = treasureSpots(); expect(xs.length).toBe(TREASURE_SPOTS);
    for (const s of xs) {
      const r = Math.hypot(s.x, s.z + 8); expect(r).toBeGreaterThan(48); expect(r).toBeLessThan(52);
      for (const l of ISLAND_LOTS) expect(Math.hypot(s.x - l.x, s.z - l.z)).toBeGreaterThan(Math.max(l.w, l.d) * 0.72);
      for (const p of [ISLAND_DOCK, ISLAND_LAGOON, ISLAND_LOUNGE]) expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThan(12);
    }
  });
  it('new spots have unique ids apart from the existing island spots', () => {
    const ids = [...islandSpots().map((s) => s.id), ISLAND_SNORKEL.id, ISLAND_HUNT.id, ISLAND_HELI.id];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Snorkel Reef', () => {
  it('needs the island and a clean record', async () => {
    await expect(dive('Ann', setup({ here: false }).d)).rejects.toThrow(/Private Island/);
    await expect(dive('Ann', setup({ jailed: true }).d)).rejects.toThrow(/Not available/);
  });
  it('5 dives a day, 60s apart, each paying its find once; resets next UTC day', async () => {
    const { bank, d, tick, at } = setup(); let total = 0;
    for (let i = 0; i < DIVE_PER_DAY; i++) {
      const r = await dive('Ann', d); const k = islandDayKey('dive', 'ann', '2026-11-22', i + 1);
      expect(r.find.id).toBe(diveFind(d, k).id); expect(r.find.paid).toBe(r.find.pay); expect(r.left).toBe(DIVE_PER_DAY - i - 1); expect(bank.hasKey(k)).toBe(true);
      total += r.find.paid;
      await expect(dive('Ann', d)).rejects.toThrow(/next dive in/); tick(DIVE_COOLDOWN_MS);
    }
    await expect(dive('Ann', d)).rejects.toThrow(/all 5 dives/);
    expect(bank.account('Ann').chips - START).toBe(total);
    const s = islandActivityState('Ann', d); expect(s.dives.used).toBe(5); expect(s.dives.finds.reduce((a, f) => a + f.pay, 0)).toBe(total);
    tick(DAY - (at() - T0)); expect((await dive('Ann', d)).left).toBe(4);
  });
  it('finds come from the server secret, not something the client can know', () => {
    const a = setup({ salt: 'a' }).d, b = setup({ salt: 'b' }).d;
    const ka = Array.from({ length: 40 }, (_, i) => diveFind(a, `isle_dive:p${i}:2026-11-22:1`).id), kb = Array.from({ length: 40 }, (_, i) => diveFind(b, `isle_dive:p${i}:2026-11-22:1`).id);
    expect(ka).not.toEqual(kb);
  });
});

describe('Treasure Hunt', () => {
  it('3 digs a day; the chest pays 25,000 and ends the hunt, misses pay a 250 trinket', async () => {
    const { bank, d } = setup(); const chest = chestSpot(d, 'Ann', '2026-11-22');
    const misses = Array.from({ length: TREASURE_SPOTS }, (_, i) => i + 1).filter((s) => s !== chest);
    const r1 = await dig('Ann', misses[0], d); expect(r1).toMatchObject({ chest: false, paid: TRINKET_PAY, left: 2 });
    await expect(dig('Ann', misses[0], d)).rejects.toThrow(/already dug there/);
    const r2 = await dig('Ann', chest, d); expect(r2).toMatchObject({ chest: true, paid: CHEST_PAY, left: 0 });
    await expect(dig('Ann', misses[1], d)).rejects.toThrow(/already found/);
    expect(bank.account('Ann').chips - START).toBe(CHEST_PAY + TRINKET_PAY);
    expect(islandActivityState('Ann', d).hunt).toMatchObject({ used: 2, found: chest });
  });
  it('stops after 3 misses and rejects bad spots or being away', async () => {
    const { bank, d } = setup(); const chest = chestSpot(d, 'Bob', '2026-11-22');
    const misses = Array.from({ length: TREASURE_SPOTS }, (_, i) => i + 1).filter((s) => s !== chest);
    for (let i = 0; i < DIG_PER_DAY; i++) await dig('Bob', misses[i], d);
    await expect(dig('Bob', chest, d)).rejects.toThrow(/Out of digs/);
    expect(bank.account('Bob').chips - START).toBe(3 * TRINKET_PAY);
    await expect(dig('Bob', 0, d)).rejects.toThrow(/X marks/); await expect(dig('Bob', 13, d)).rejects.toThrow(/X marks/); await expect(dig('Bob', '1; drop', d)).rejects.toThrow(/X marks/);
    await expect(dig('Bob', 1, setup({ here: false }).d)).rejects.toThrow(/Private Island/);
  });
  it('the chest moves per player and per day', () => {
    const { d } = setup(); const spots = new Set<number>();
    for (let i = 0; i < 60; i++) spots.add(chestSpot(d, `p${i}`, '2026-11-22'));
    for (let i = 0; i < 30; i++) spots.add(chestSpot(d, 'Ann', `2026-12-${String(i + 1).padStart(2, '0')}`));
    expect(spots.size).toBeGreaterThan(8);
  });
});

describe('Helicopter Tour', () => {
  it('pays the 2,000 postcard once a day after a full loop; later tours are free', async () => {
    const { bank, d, tick } = setup();
    await expect(claimTour('Ann', d)).rejects.toThrow(/Take off/);
    expect(startTour('Ann', d)).toEqual({ ms: TOUR_MS, bonus: true });
    tick(5_000); await expect(claimTour('Ann', d)).rejects.toThrow(/Still in the air/);
    tick(TOUR_MS); expect((await claimTour('Ann', d)).paid).toBe(TOUR_PAY);
    await expect(claimTour('Ann', d)).rejects.toThrow(/Take off/);
    expect(startTour('Ann', d).bonus).toBe(false); tick(TOUR_MS); expect((await claimTour('Ann', d)).paid).toBe(0);
    expect(bank.account('Ann').chips - START).toBe(TOUR_PAY);
    expect(() => startTour('Ann', setup({ here: false }).d)).toThrow(/Private Island/);
  });
});

describe('island activities wiring', () => {
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  it('the server registers every activity event behind the island check', () => {
    const re = src('server/realEstate.ts');
    for (const ev of ['isl_act_state', 'isl_dive', 'isl_dig', 'isl_tour_start', 'isl_tour_claim', 'isl_retreat_state', 'isl_retreat_claim']) expect(re).toContain(`on('${ev}'`);
    expect(src('server/islandActivities.ts')).toMatch(/atIsland\(name\)/);
  });
  it('3D island, 2D map and panels expose the new activities without dropping the lagoon and lounge', () => {
    const map = src('client/src/components/IslandMap.tsx'), flat = src('client/src/components/IslandFlatMap.tsx'), w = src('client/src/lib/island3d.ts');
    for (const t of ['island-reef-btn', 'island-hunt-btn', 'island-heli-btn', 'island-dive', 'island-tour', 'island-lagoon-btn', 'island-lounge-btn', 'island-retreat-claim']) expect(map).toContain(t);
    for (const id of ['ISLAND_SNORKEL', 'ISLAND_HUNT', 'ISLAND_HELI']) { expect(flat).toContain(id); expect(w).toContain(id); }
    expect(w).toMatch(/setHunt\(dug, found\)/); expect(w).toMatch(/tour\(ms\)/);
  });
});

import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Fishing, setFishBoatHook } from '../server/fishing';
import { fishById, fishPool, RARITY_ODDS, rollFish, type Rarity } from '../shared/fishing';
import { bestBoat } from '../shared/fleet';

const deep = fishPool('deep');
describe('Deep-sea fishing (#10c)', () => {
  it('16 species, zone 1 covers every rarity, each zone adds a tier', () => {
    expect(deep.length).toBe(19); expect(deep.filter((f) => f.crew).map((f) => f.id)).toEqual(['bigeye', 'opah', 'bluemarlin']); // + 3 crew-only (mu-coop3)
    for (const r of Object.keys(RARITY_ODDS) as Rarity[]) expect(deep.some((f) => f.rarity === r && f.zone === 1)).toBe(true);
    for (const z of [1, 2, 3]) expect(deep.some((f) => f.zone === z)).toBe(true);
  });
  it('the roll never goes past the boat range; rarity odds are unchanged', () => {
    for (let i = 0; i <= 40; i++) for (let j = 0; j <= 10; j++) {
      const u = i / 40.0001, v = j / 10.0001;
      for (const z of [1, 2, 3]) { const f = rollFish(u, v, 'deep', z); expect(f.spot).toBe('deep'); expect(f.zone!).toBeLessThanOrEqual(z); expect(f.rarity).toBe(rollFish(u, v).rarity); }
    }
    expect(rollFish(0.999, 0.99, 'deep', 3).id).toBe('coelacanth');
    expect(rollFish(0.999, 0.99, 'deep', 1).id).toBe('blackmarlin');
  });
  it('casting at deep sea needs the resort AND a boat; boat range is enforced server-side', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    let now = Date.parse('2026-11-01T12:00:00Z'); const f = new Fishing(pool, () => bank, () => now); await f.init();
    let boats: string[] = []; setFishBoatHook(async () => bestBoat(boats));
    await expect(f.cast('Ann', 'deep', () => false)).rejects.toThrow(/Chud Resort Marina/);
    await expect(f.cast('Ann', 'deep', () => true)).rejects.toThrow(/need a boat/);
    boats = ['skiff'];
    for (let i = 0; i < 60; i++) { await f.cast('Ann', 'deep', () => true); const c = (f as unknown as { casts: Map<string, { fish: string }> }).casts.get('ann')!; const fish = fishById(c.fish)!; expect(fish.spot).toBe('deep'); expect(fish.zone).toBe(1); f.reelIn('Ann'); now += 5000; }
    setFishBoatHook(async () => bestBoat([]));
  });
});

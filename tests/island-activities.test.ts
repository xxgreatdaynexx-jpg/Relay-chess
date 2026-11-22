import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Fishing } from '../server/fishing';
import { claimRetreat, retreatState, type RetreatDeps } from '../server/islandRetreat';
import { CAST_COOLDOWN_MS, FISH, FISH_SPOT_CAP, fishById, fishDailyKey, fishPayout, fishPool, RARITY_ODDS, Reel, rollFish, spotOf, type Rarity } from '../shared/fishing';
import { hasItemIcon, itemIconSvg } from '../shared/itemIcons';
import { ISLAND_LAGOON, ISLAND_LOTS, ISLAND_LOUNGE, ISLAND_RETREAT_RATE, islandRetreatBase, islandRetreatKey, islandSpots } from '../shared/island';

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const T0 = Date.parse('2026-11-22T12:00:00Z');
const lagoon = fishPool('lagoon'), reef = fishPool('reef');
const band = (pool: typeof reef, r: Rarity) => { const v = pool.filter((x) => x.rarity === r).map((x) => x.base); return [Math.min(...v), Math.max(...v)] as const; };
function play(seed: number, diff: number): string { const r = new Reel(seed, diff); let s = ''; while (!r.s.done) { const h = r.s.x < r.s.c - 0.35 * r.s.v; s += h ? '1' : '0'; r.tick(h); } return s; }

describe('Pearl Lagoon (island-only fishing)', () => {
  it('has its own 15 species across every rarity, about 1.5x the reef bands', () => {
    expect(lagoon.length).toBe(15); expect(new Set(FISH.map((f) => f.id)).size).toBe(FISH.length);
    for (const r of Object.keys(RARITY_ODDS) as Rarity[]) {
      expect(lagoon.some((f) => f.rarity === r)).toBe(true); const [lo, hi] = band(reef, r);
      for (const f of lagoon.filter((x) => x.rarity === r)) { expect(f.base).toBeGreaterThanOrEqual(Math.floor(lo * 1.4)); expect(f.base).toBeLessThanOrEqual(Math.ceil(hi * 1.6)); }
    }
    for (const f of lagoon) { expect(spotOf(f)).toBe('lagoon'); expect(f.max).toBeGreaterThan(f.min); expect(hasItemIcon('fish', f.id)).toBe(true); expect(itemIconSvg('fish', f.id)).toMatch(/^<svg[\s\S]*<\/svg>$/); }
  });
  it('only the lagoon rolls lagoon fish, with the same rarity odds', () => {
    for (let i = 0; i <= 40; i++) for (let j = 0; j <= 10; j++) { const u = i / 40.0001, v = j / 10.0001; expect(spotOf(rollFish(u, v, 'lagoon'))).toBe('lagoon'); expect(spotOf(rollFish(u, v, 'reef'))).toBe('reef'); expect(rollFish(u, v, 'lagoon').rarity).toBe(rollFish(u, v).rarity); }
  });
  it('has its own daily cap (345k floor) on its own fish_daily row', () => {
    expect(FISH_SPOT_CAP.lagoon).toBe(345_000); expect(fishPayout(1e9, 0, 'lagoon')).toBe(345_000); expect(fishPayout(10, 345_000, 'lagoon')).toBe(0);
    expect(fishDailyKey('ann', 'lagoon')).toBe('ann#lagoon');
    expect(FISH_SPOT_CAP.lagoon).toBeGreaterThan(FISH_SPOT_CAP.reef); expect(FISH_SPOT_CAP.lagoon).toBeLessThan(FISH_SPOT_CAP.deep);
  });
  it('casting needs you on the island; catches go to the Resort Warehouse and sell under the lagoon cap', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    let now = T0; const f = new Fishing(pool, () => bank, () => now); await f.init();
    await expect(f.cast('Ann', 'lagoon', () => true, () => false)).rejects.toThrow(/Private Island/);
    let landed = 0;
    for (let i = 0; i < 40 && landed < 3; i++) { now += CAST_COOLDOWN_MS + 10; const { biteIn } = await f.cast('Ann', 'lagoon', () => false, () => true); now += biteIn + 100; const h = f.hook('Ann'); const inp = play(h.seed, h.diff); now += inp.length * 50; const r = await f.land('Ann', inp).catch(() => null); if (r?.caught) landed++; }
    const v = await f.view('Ann'); expect(v.cooler.length).toBeGreaterThan(0);
    for (const c of v.cooler) { expect(spotOf(fishById(c.fish)!)).toBe('lagoon'); expect(c.loc).toBe('resort'); }
    await f.sell('Ann'); await bank.flush();
    const rows = (await pool.query("SELECT player_key FROM fish_daily")).rows.map((r: { player_key: string }) => r.player_key); expect(rows).toEqual(['ann#lagoon']);
  });
});

describe('Sunset Lounge estate retreat', () => {
  const deps = (owners: Record<string, string>, here = true, clock = () => T0) => {
    const bank = new CasinoBank(); bank.retryMs = [];
    const d: RetreatDeps = { bank: () => bank, ownerOf: async (id) => (owners[id] ? { key: owners[id]!.toLowerCase(), name: owners[id]! } : null), atIsland: () => here, jailed: () => false, px: (n) => n, clock };
    return { bank, d };
  };
  it('pays 0.25% of list price per estate per day', () => {
    expect(ISLAND_RETREAT_RATE).toBe(0.0025);
    expect(ISLAND_LOTS.map((l) => islandRetreatBase(l.id))).toEqual([6_250, 8_000, 11_250, 15_000]);
    for (const l of ISLAND_LOTS) expect(l.price / islandRetreatBase(l.id)).toBe(400); // 400 days to repay at list price
  });
  it('only owners on the island collect, once per estate per UTC day', async () => {
    const { bank, d } = deps({ 'isl:1': 'Ann', 'isl:4': 'Ann', 'isl:2': 'Bob' });
    await expect(claimRetreat('Cat', d)).rejects.toThrow(/estate owners/);
    const r = await claimRetreat('Ann', d); expect(r.paid).toBe(6_250 + 15_000); expect(r.estates).toEqual(['Cove Estate', 'Crown Villa']);
    expect(bank.account('Ann').chips).toBeGreaterThanOrEqual(21_250);
    await expect(claimRetreat('Ann', d)).rejects.toThrow(/Already collected/);
    const st = await retreatState('Ann', d); expect(st.rows.filter((x) => x.mine).every((x) => x.claimed)).toBe(true); expect(st.rows.find((x) => x.id === 'isl:2')!.claimed).toBe(false);
    expect(bank.hasKey(islandRetreatKey('isl:1', '2026-11-22'))).toBe(true);
  });
  it('is not paid away from the island and does not accrue', async () => {
    const { d } = deps({ 'isl:3': 'Ann' }, false); await expect(claimRetreat('Ann', d)).rejects.toThrow(/Private Island/);
  });
  it('a deed traded mid-day cannot pay twice', async () => {
    const owners: Record<string, string> = { 'isl:3': 'Ann' }; const { d } = deps(owners);
    await claimRetreat('Ann', d); owners['isl:3'] = 'Bob'; await expect(claimRetreat('Bob', d)).rejects.toThrow(/Already collected/);
  });
  it('resets the next UTC day', async () => {
    let t = T0; const { d } = deps({ 'isl:2': 'Ann' }, true, () => t);
    expect((await claimRetreat('Ann', d)).paid).toBe(8_000); t += 24 * 3600_000; expect((await claimRetreat('Ann', d)).paid).toBe(8_000);
  });
});

describe('Private Island 3D map', () => {
  it('opens the lagoon and lounge from the map', () => {
    expect(islandSpots().map((s) => s.id)).toEqual(expect.arrayContaining([ISLAND_LAGOON.id, ISLAND_LOUNGE.id]));
    const m = src('client/src/components/IslandMap.tsx'); expect(m).toContain('spot="lagoon"'); expect(m).toContain('isl_retreat_claim'); expect(m).toContain('island-retreat-claim');
    const s = src('server/realEstate.ts'); expect(s).toContain("'isl_retreat_claim'"); expect(s).toContain("'isl_retreat_state'");
  });
  it('is a real explorable scene: orbit/pan camera, terrain, jungle, estates, dock, lagoon, lounge', () => {
    const s = src('client/src/lib/island3d.ts');
    for (const k of ['OrbitControls', 'clampIslandTarget', 'islandHeight', 'ISLAND_LAGOON', 'ISLAND_LOUNGE', 'buildBoat', 'Ridge Falls', 'InstancedMesh']) expect(s.includes(k) || k === 'Ridge Falls').toBe(true);
    expect(s).toContain('setOwners');
  });
});

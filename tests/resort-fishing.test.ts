import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Fishing } from '../server/fishing';
import { BITE_MAX_MS, BITE_MIN_MS, CAST_COOLDOWN_MS, FISH, FISH_SPOT_CAP, fishById, fishDailyKey, fishPayout, fishPool, fishValue, Reel, RARITY_ODDS, rollFish, rollWeight, spotOf, type FishSpot, type Rarity } from '../shared/fishing';
import { RESORT_TICKET_BASE } from '../shared/resort';
import { priceIndex } from '../server/price-index';
import { FISH_ING, filletsFrom } from '../shared/cooking';
import { hasItemIcon, itemIconSvg, ICON_FISH_IDS } from '../shared/itemIcons';
import { RESORT_SPOTS, SHORE_Z } from '../shared/resort';

const T0 = Date.parse('2026-11-01T12:00:00Z');
function play(seed: number, diff: number): string { const r = new Reel(seed, diff); let s = ''; while (!r.s.done) { const h = r.s.x < r.s.c - 0.35 * r.s.v; s += h ? '1' : '0'; r.tick(h); } return s; }
async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const f = new Fishing(pool, () => bank, () => now); await f.init();
  const ledger = (key: string) => db.public.many(`SELECT amount FROM wallet_transactions WHERE player_key = '${key}' AND game = 'fish_sell' ORDER BY id`) as Array<{ amount: number }>;
  return { db, pool, bank, f, ledger, adv: (ms: number) => { now += ms; } };
}
const reef = fishPool('reef'), lake = fishPool('lake');
const band = (r: Rarity) => { const v = lake.filter((x) => x.rarity === r).map((x) => x.base); return [Math.min(...v), Math.max(...v)] as const; };

describe('Reef Pier fishing (Chud Resort)', () => {
  it('has its own 15-species tropical pool, every rarity, values about 2x the lake tier bands', () => {
    expect(reef.length).toBe(15); expect(lake.length + reef.length + fishPool('deep').length).toBe(FISH.length);
    for (const r of Object.keys(RARITY_ODDS) as Rarity[]) { expect(reef.some((f) => f.rarity === r)).toBe(true); const [lo, hi] = band(r); for (const f of reef.filter((x) => x.rarity === r)) { expect(f.base).toBeGreaterThanOrEqual(Math.floor(lo * 1.8)); expect(f.base).toBeLessThanOrEqual(Math.ceil(hi * 2.1)); } }
    expect(new Set(FISH.map((f) => f.id)).size).toBe(FISH.length);
    for (const f of reef) { expect(spotOf(f)).toBe('reef'); expect(f.max).toBeGreaterThan(f.min); }
  });
  it('the lake never rolls a reef fish and the reef never rolls a lake fish; odds unchanged', () => {
    for (let i = 0; i <= 40; i++) for (let j = 0; j <= 10; j++) { const u = i / 40.0001, v = j / 10.0001; expect(spotOf(rollFish(u, v))).toBe('lake'); expect(spotOf(rollFish(u, v, 'reef'))).toBe('reef'); expect(rollFish(u, v, 'reef').rarity).toBe(rollFish(u, v).rarity); }
    expect(rollFish(0.999, 0.99, 'reef').rarity).toBe('legendary'); expect(rollFish(0, 0, 'reef').rarity).toBe('junk');
  });
  it('reef fish fillet like lake fish of the same rarity', () => {
    for (const f of reef) { const val = fishValue(f, rollWeight(f, 0.5)); if (f.rarity !== 'junk') expect(filletsFrom('fish', val)).toBeGreaterThanOrEqual(1); expect((FISH_ING.fish_fine.rarities as readonly string[]).includes(f.rarity)).toBe(['rare', 'epic', 'legendary'].includes(f.rarity)); }
  });
  it('every reef species has a distinct crafted svg icon', () => {
    const svgs = reef.map((f) => { expect(hasItemIcon('fish', f.id)).toBe(true); const s = itemIconSvg('fish', f.id); expect(s).toMatch(/^<svg[\s\S]*<\/svg>$/); return s; });
    expect(new Set(svgs).size).toBe(reef.length); expect([...ICON_FISH_IDS].sort()).toEqual([...reef, ...fishPool('deep')].map((f) => f.id).sort());
  });
  it('the pier is a resort spot reaching out into the ocean', () => {
    const p = RESORT_SPOTS.find((s) => s.id === 'r-pier')!; expect(p).toBeTruthy(); expect(p.z).toBeGreaterThan(SHORE_Z); expect(p.z - p.d / 2).toBeGreaterThanOrEqual(SHORE_Z - 2); // starts at the sand, runs out to sea
  });
  it('casting at the reef needs you at the resort; reef catches land, rank, and sell through the wallet ledger', async () => {
    const { bank, f, ledger, adv } = await setup();
    await expect(f.cast('Ann', 'reef', () => false)).rejects.toThrow(/Chud Resort/);
    let landed = 0;
    for (let i = 0; i < 40 && landed < 3; i++) { const { biteIn } = await f.cast('Ann', 'reef', () => true); adv(biteIn + 100); const h = f.hook('Ann'); const inp = play(h.seed, h.diff); adv(inp.length * 50); const r = await f.land('Ann', inp).catch(() => null); if (r && (r as { ok?: boolean }).ok !== false) landed++; adv(5000); }
    const v = await f.view('ann'); expect(v.cooler.length).toBeGreaterThan(0); for (const c of v.cooler) expect(spotOf(fishById(c.fish)!)).toBe('reef');
    const before = ledger('ann').length; await f.sell('Ann'); await bank.flush(); expect(ledger('ann').length).toBe(before + 1);
    await expect(f.cast('Bob', 'moon', () => true)).resolves.toBeTruthy(); // unknown spots fall back to the lake
  });
});

// mu-fishing (Dayne 2026-11-04): resort ≈ 2x the pond and ocean (skiff, zone 1) ≈ 5x, in chips per minute after the ticket.
const evCatch = (spot: FishSpot, zone = 3) => (Object.keys(RARITY_ODDS) as Rarity[]).reduce((a, r) => {
  const pool = fishPool(spot).filter((f) => f.rarity === r && (f.zone ?? 1) <= zone);
  const avg = pool.reduce((x, f) => { let t = 0; const n = 400; for (let i = 0; i < n; i++) t += fishValue(f, rollWeight(f, (i + 0.5) / n)); return x + t / n; }, 0) / pool.length;
  return a + (RARITY_ODDS[r] / 100) * avg;
}, 0);
const REEL_S = 4.8, HOOK_S = 0.4; // measured average reel + reaction time (same rarity odds, so the same at every spot)
const cycleS = (biteMul = 1) => CAST_COOLDOWN_MS / 1000 + ((BITE_MIN_MS + BITE_MAX_MS) / 2000) * biteMul + HOOK_S + REEL_S;
const perMin = (spot: FishSpot, zone = 3, biteMul = 1, ticket = 0) => (evCatch(spot, zone) / cycleS(biteMul)) * 60 - ticket / 60; // ticket over a 1-hour trip

describe('fishing profitability by spot (mu-fishing)', () => {
  it('resort ≈ 2x the pond and ocean zone 1 ≈ 5x (±10%), after the resort ticket', () => {
    const pond = perMin('lake'); const reefPm = perMin('reef', 3, 1, RESORT_TICKET_BASE); const deep1 = perMin('deep', 1, 1, RESORT_TICKET_BASE);
    expect(reefPm / pond).toBeGreaterThanOrEqual(1.8); expect(reefPm / pond).toBeLessThanOrEqual(2.2);
    expect(deep1 / pond).toBeGreaterThanOrEqual(4.5); expect(deep1 / pond).toBeLessThanOrEqual(5.5);
    const deep3 = perMin('deep', 3, 0.9, RESORT_TICKET_BASE); expect(deep3).toBeGreaterThan(deep1); // bigger boats earn a bit more
    expect(fishById('bluegill')!.base).toBe(6); expect(fishById('oldchud')!.base).toBe(500); // pond unchanged
  });
  it('daily caps are separate per spot: lake 115k, reef 230k, deep 575k (+15% buff)', () => {
    expect(FISH_SPOT_CAP).toEqual({ lake: 115_000, reef: 230_000, deep: 575_000 });
    for (const sp of ['lake', 'reef', 'deep'] as FishSpot[]) { const c = FISH_SPOT_CAP[sp]; expect(fishPayout(1e9, 0, sp)).toBe(c); expect(fishPayout(10, c, sp)).toBe(0); expect(fishPayout(200, c - 100, sp)).toBe(100); }
    expect(fishDailyKey('ann')).toBe('ann'); expect(fishDailyKey('ann', 'reef')).toBe('ann#reef'); expect(fishDailyKey('ann', 'deep')).toBe('ann#deep');
  });
  it('selling enforces each spot\'s cap on its own fish_daily row; a full spot does not block the others', async () => {
    const { pool, f, bank } = await setup(); const px = priceIndex();
    const put = async (id: string, species: string, value: number) => { await pool.query('INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, 'ann', 'Ann', species, 1000, value, T0]); };
    await put('l1', 'bass', 150_000); await put('r1', 'snapper', 150_000); await put('d1', 'wahoo', 450_000);
    const s1 = await f.sell('Ann'); await bank.flush();
    expect(s1.sold).toBe(3); expect(s1.paid).toBe(Math.floor(115_000 * px) + Math.floor(172_500 * px) + Math.floor(517_500 * px)); // values x1.15, lake capped at 115k
    const v = await f.view('Ann');
    expect(v.todayBySpot!.lake.gross).toBeCloseTo(172_500); expect(v.todayBySpot!.reef.gross).toBeCloseTo(172_500); expect(v.todayBySpot!.deep.gross).toBeCloseTo(517_500); expect(v.today.gross).toBeCloseTo(172_500);
    await put('l2', 'bass', 50); await put('r2', 'snapper', 80_000); await put('d2', 'wahoo', 80_000);
    const s2 = await f.sell('Ann'); await bank.flush();
    expect(s2.sold).toBe(2); expect(s2.paid).toBe(Math.floor(57_500 * px) + Math.floor(57_500 * px)); // lake is full: its fish stays in the cooler
    expect((await f.view('Ann')).cooler.map((c) => c.id)).toEqual(['l2']);
    await expect(f.sell('Ann')).rejects.toThrow(/bought all/);
    const rows = (await pool.query('SELECT player_key, gross FROM fish_daily ORDER BY player_key')).rows.map((r: { player_key: string; gross: string | number }) => [r.player_key, Number(r.gross)]);
    expect(rows).toEqual([['ann', 172_500], ['ann#deep', 609_500], ['ann#reef', 264_500]]);
  });
});

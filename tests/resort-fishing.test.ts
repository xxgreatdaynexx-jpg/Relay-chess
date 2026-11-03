import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Fishing } from '../server/fishing';
import { FISH, fishById, fishPool, fishValue, Reel, RARITY_ODDS, rollFish, rollWeight, spotOf, type Rarity } from '../shared/fishing';
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
  return { bank, f, ledger, adv: (ms: number) => { now += ms; } };
}
const reef = fishPool('reef'), lake = fishPool('lake');
const band = (r: Rarity) => { const v = lake.filter((x) => x.rarity === r).map((x) => x.base); return [Math.min(...v), Math.max(...v)] as const; };

describe('Reef Pier fishing (Chud Resort)', () => {
  it('has its own 15-species tropical pool, every rarity, values inside the lake tier bands', () => {
    expect(reef.length).toBe(15); expect(lake.length + reef.length + fishPool('deep').length).toBe(FISH.length);
    for (const r of Object.keys(RARITY_ODDS) as Rarity[]) { expect(reef.some((f) => f.rarity === r)).toBe(true); const [lo, hi] = band(r); for (const f of reef.filter((x) => x.rarity === r)) { expect(f.base).toBeGreaterThanOrEqual(lo); expect(f.base).toBeLessThanOrEqual(hi); } }
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

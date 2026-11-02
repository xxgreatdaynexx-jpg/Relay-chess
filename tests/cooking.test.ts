import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Cooking } from '../server/cooking';
import { getMines } from '../server/mines';
import { setPriceIndexForTest } from '../server/price-index';
import { COOK_DAILY_MAX, RECIPES, STAPLES, burnChance, cookPayout, cookSteps, dishValue, foodInfo, judgeCook, rawValue, recipeById, stepScore } from '../shared/cooking';
import { SKILLS } from '../shared/skills';
import { isStackable } from '../server/market';
import { priceOf } from '../shared/mines';

const T0 = Date.parse('2026-11-01T12:00:00Z');
/** Best press time for each step (what a perfect player does). */
const perfect = (seed: number, diff: number) => cookSteps(seed, diff).map((s) => { let best = 250, b = -1; for (let t = 250; t <= 3000; t += 5) { const v = stepScore(s, t); if (v > b) { b = v; best = t; } } return best; });

describe('cooking rules', () => {
  it('has ~30 groceries, ~20 recipes in unlock order using real ingredients, and a Cooking skill', () => {
    expect(STAPLES.length).toBeGreaterThanOrEqual(25); expect(RECIPES.length).toBeGreaterThanOrEqual(20);
    expect(SKILLS.some((s) => s.id === 'cooking')).toBe(true);
    for (let i = 1; i < RECIPES.length; i++) expect(RECIPES[i]!.level).toBeGreaterThan(RECIPES[i - 1]!.level);
    for (const r of RECIPES) for (const id of Object.keys(r.ings)) expect(id === 'fish' || id === 'fish_fine' || !!foodInfo(id)).toBe(true);
    for (const id of ['pineapple', 'banana', 'mango', 'coconut', 'cacao']) expect(RECIPES.some((r) => id in r.ings)).toBe(true);
  });
  it('dishes beat raw ingredients modestly; daily cap is small', () => {
    for (const r of RECIPES) { expect(dishValue(r, 0.6)).toBeGreaterThan(rawValue(r)); expect(dishValue(r, 1)).toBeLessThanOrEqual(Math.ceil(rawValue(r) * 1.35 * 1.2)); }
    expect(COOK_DAILY_MAX).toBe(100_000); expect(cookPayout(10_000, 0)).toBe(10_000); expect(cookPayout(1e9, 0)).toBe(100_000); expect(cookPayout(10, 100_000)).toBe(0);
  });
  it('burning: likely at low level, gone 30 levels past the recipe', () => {
    const r = recipeById('fried_fish')!; expect(burnChance(1, r, 0.5)).toBeGreaterThan(0.15); expect(burnChance(40, r, 0.9)).toBe(0); expect(burnChance(1, r, 0.1)).toBeGreaterThan(0.6);
  });
  it('judge: perfect timing scores 1; bad timelines are rejected', () => {
    expect(judgeCook(7, 0.3, perfect(7, 0.3))).toBe(1);
    expect(judgeCook(7, 0.3, [1, 2, 3])).toBeNull(); expect(judgeCook(7, 0.3, [100, 500, 500, 500])).toBeNull();
  });
  it('food is Market-stackable but never house-sold', () => { expect(isStackable('food', 'flour')).toBe(true); expect(isStackable('food', 'nope')).toBe(false); expect(priceOf({ type: 'food', id: 'beef' })).toBe(0); });
});

describe('kitchen server', () => {
  async function setup() {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool)); setPriceIndexForTest(1);
    await pool.query('CREATE TABLE fish_catches (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, species TEXT NOT NULL, weight_g INTEGER NOT NULL, value INTEGER NOT NULL, caught_at BIGINT NOT NULL, sold_at BIGINT, dish TEXT, raw_value INTEGER)');
    await pool.query('CREATE TABLE properties (id TEXT PRIMARY KEY, owner_key TEXT NOT NULL)');
    let now = T0; const c = new Cooking(pool, () => bank, () => now); await c.init();
    const ledger = (game: string) => db.public.many(`SELECT amount FROM wallet_transactions WHERE game = '${game}'`) as Array<{ amount: number }>;
    return { db, pool, bank, c, ledger, adv: (ms: number) => { now += ms; } };
  }
  it('needs a home; buys groceries once per nonce; cooks atomically; sells through the ledger', async () => {
    const { pool, bank, c, ledger, adv } = await setup(); const me = 'QA-Cook1';
    bank.account(me);
    await expect(c.start(me, 'fried_fish')).rejects.toThrow(/home/);
    await pool.query("INSERT INTO properties VALUES ('h:1', 'qa-cook1')");
    const before = bank.account(me).chips;
    for (const item of ['oil', 'salt', 'lemon']) await c.buy(me, item, 2, `nonce-${item}-0001`);
    await expect(c.buy(me, 'oil', 2, 'nonce-oil-0001')).rejects.toThrow(/Already/);
    expect(bank.account(me).chips).toBe(before - (2 + 1 + 2) * 2);
    expect(ledger('grocery').length).toBe(3);
    await expect(c.start(me, 'fried_fish')).rejects.toThrow(/fish/i);
    await pool.query("INSERT INTO fish_catches VALUES ('f1','qa-cook1','QA-Cook1','perch',300,8,1,NULL), ('f2','qa-cook1','QA-Cook1','boot',300,2,1,NULL)");
    await expect(c.start(me, 'grape_tart')).rejects.toThrow(/level/);
    const { cook } = await c.start(me, 'fried_fish');
    expect(getMines().stackQty(me, 'food', 'oil')).toBe(1);
    expect((await pool.query("SELECT sold_at FROM fish_catches WHERE id = 'f1'")).rows[0].sold_at).not.toBeNull();
    expect((await pool.query("SELECT sold_at FROM fish_catches WHERE id = 'f2'")).rows[0].sold_at).toBeNull(); // junk is never cooked
    await expect(c.start(me, 'fried_fish')).rejects.toThrow(/stove/);
    const presses = perfect(cook.seed, cook.diff); adv(presses.reduce((a, b) => a + b, 0) + 50);
    const res = await c.finish(me, cook.id, presses);
    expect(res.quality).toBe(1); expect(res.xp).toBeGreaterThan(0);
    await expect(c.finish(me, cook.id, presses)).rejects.toThrow(/stove/);
    if (!res.burnt) {
      const chips = bank.account(me).chips; const s = await c.sell(me);
      expect(s.paid).toBe(dishValue(recipeById('fried_fish')!, 1)); expect(bank.account(me).chips).toBe(chips + s.paid);
      await expect(c.sell(me)).rejects.toThrow(/Nothing/);
    }
  });
  it('walking away mid-cook refunds the ingredients and the fish (never burns)', async () => {
    const { pool, c, bank, adv } = await setup(); const me = 'QA-Cook3'; bank.account(me);
    await pool.query("INSERT INTO properties VALUES ('h:3', 'qa-cook3')"); await pool.query("INSERT INTO fish_catches VALUES ('k1','qa-cook3','QA-Cook3','perch',300,8,1,NULL)");
    for (const item of ['oil', 'salt', 'lemon']) await c.buy(me, item, 1, `nonce3-${item}-01`);
    const { cook } = await c.start(me, 'fried_fish');
    expect(getMines().stackQty(me, 'food', 'oil')).toBe(0);
    adv(10 * 60_000);
    await expect(c.finish(me, cook.id, perfect(cook.seed, cook.diff))).rejects.toThrow(/pantry/);
    for (const item of ['oil', 'salt', 'lemon']) expect(getMines().stackQty(me, 'food', item)).toBe(1);
    expect((await pool.query("SELECT sold_at FROM fish_catches WHERE id = 'k1'")).rows[0].sold_at).toBeNull();
    await expect(c.finish(me, cook.id, perfect(cook.seed, cook.diff))).rejects.toThrow(/stove/);
    expect(await c.refundStale(me)).toBe(0); // only once
    const again = await c.start(me, 'fried_fish'); expect(again.cook.id).not.toBe(cook.id);
  });
  it('a speed-hacked cook burns', async () => {
    const { pool, c, bank } = await setup(); const me = 'QA-Cook2'; bank.account(me);
    await pool.query("INSERT INTO properties VALUES ('h:2', 'qa-cook2')"); await pool.query("INSERT INTO fish_catches VALUES ('g1','qa-cook2','QA-Cook2','perch',300,8,1,NULL)");
    for (const item of ['oil', 'salt', 'lemon']) await c.buy(me, item, 1, `nonce2-${item}-01`);
    const { cook } = await c.start(me, 'fried_fish');
    const r = await c.finish(me, cook.id, perfect(cook.seed, cook.diff)); // no wall time passed
    expect(r.burnt).toBe(true); expect(r.dish).toBeNull();
  });
});

describe('Grocery Store venue', async () => {
  const { landmarks, cityFill, obbOverlap, roadClearance, RESERVED_VENUES, MINE_SITES } = await import('../shared/worldLayout');
  it('sits on a city block, clear of roads, landmarks, houses and reserved venues', () => {
    const all = landmarks(); const g = all.grocery!; expect(g).toBeTruthy();
    expect(Math.abs(g.x)).toBeLessThan(100); expect(Math.abs(g.z)).toBeLessThan(100);
    expect(roadClearance(g.x, g.z)).toBeGreaterThan(6);
    for (const [id, b] of Object.entries(all)) if (id !== 'grocery') expect(obbOverlap(b, g, 2)).toBe(false);
    const { houses, patches } = cityFill(7); for (const h of [...houses, ...patches]) expect(obbOverlap(h, g, 1)).toBe(false);
    for (const r of Object.values(RESERVED_VENUES)) expect(g.x > r.x0 && g.x < r.x1 && g.z > r.z0 && g.z < r.z1).toBe(false);
    for (const m of Object.values(MINE_SITES)) expect(Math.hypot(m.x - g.x, m.z - g.z)).toBeGreaterThan(40);
  });
});

describe('kitchen icons', async () => {
  const { hasItemIcon } = await import('../shared/itemIcons');
  it('every grocery, crop ingredient and dish has a crafted icon', () => {
    for (const s of STAPLES) expect(hasItemIcon('food', s.id)).toBe(true);
    for (const r of RECIPES) { expect(hasItemIcon('food', r.id)).toBe(true); for (const id of Object.keys(r.ings)) if (id !== 'fish' && id !== 'fish_fine') expect(hasItemIcon('food', id)).toBe(true); }
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CasinoBank } from '../server/casino-store';
import { markDisabled } from '../shared/disabled';
import {
  castLine, claimCamp, marketSell, millCollect, millStart, pickBasket, resetWestActivityMemory, rideBull, startCamp, westActState, loadMillJobs,
  WEST_MILL_MIGRATION, type WestDeps, type WestMines,
} from '../server/westActivities';
import {
  CAMP_MS, CAMP_PAY, FISH_CATCHES, FISH_COOLDOWN_MS, FISH_PER_DAY, MARKET_MAX_UNITS, MARKET_SALES_PER_DAY, MILL_DAILY_POURS, MILL_FURNACES, MILL_MAX_BATCH, MILL_RECIPES,
  PICK_COOLDOWN_MS, PICK_FINDS, PICK_PER_DAY, RODEO_COOLDOWN_MS, RODEO_PER_DAY, RODEO_TABLE, WEST_ACTIVITY_SOLIDS, WEST_SPOTS, evOf, marketPay, millBatchMs, millCost, rodeoEV, westDayKey,
} from '../shared/westActivities';
import { GOODS, priceOf, type ItemType } from '../shared/mines';
import { WEST_DECOR_SOLIDS, WEST_FARMS, WEST_WAREHOUSES, westFill, nearWater } from '../shared/westCity';
import { inBridgeSite } from '../shared/coop';
import { obbOverlap } from '../shared/worldLayout';
import { WORLD_SPOTS } from '../client/src/lib/worldSpots';

const T0 = Date.parse('2026-11-22T12:00:00Z');
const DAY = 86_400_000;
const START = new CasinoBank().account('Nobody').chips;
/** Memory-only banked storage (no Mines store): deltas apply at once, all-or-nothing, like server/mines.ts without a DB. */
function memMines(): WestMines & { put(n: string, t: ItemType, id: string, q: number): void; rows: Array<{ sql: string; args: unknown[] }> } {
  const packs = new Map<string, Map<string, number>>(); const rows: Array<{ sql: string; args: unknown[] }> = [];
  const pack = (n: string) => { const k = n.toLowerCase(); let p = packs.get(k); if (!p) { p = new Map(); packs.set(k, p); } return p; };
  return {
    offline: false, rows,
    put(n, t, id, q) { pack(n).set(`${t}:${id}`, q); },
    stackQty: (n, t, id) => pack(n).get(`${t}:${id}`) ?? 0,
    adjustStacks(n, deltas, extra = [], fallback) {
      const p = pack(n); for (const d of deltas) if ((p.get(`${d.type}:${d.id}`) ?? 0) + d.delta < 0) return false;
      for (const d of deltas) p.set(`${d.type}:${d.id}`, (p.get(`${d.type}:${d.id}`) ?? 0) + d.delta);
      rows.push(...extra); fallback?.(extra); return true;
    },
  };
}
function setup(o: { here?: boolean; jailed?: boolean } = {}) {
  const bank = new CasinoBank(); bank.retryMs = []; let now = T0; const mines = memMines();
  const d: WestDeps = { bank: () => bank as never, mines: () => mines, inCity: () => o.here ?? true, jailed: () => o.jailed ?? false, px: (n) => n, clock: () => now, salt: 'test-salt' };
  return { bank, mines, d, tick: (ms: number) => { now += ms; }, at: () => now };
}
beforeEach(() => resetWestActivityMemory());
afterEach(() => markDisabled('Dis', false));

describe('West Chud activity sites', () => {
  it('six sites with unique ids, none clashing with the city spots', () => {
    expect(WEST_SPOTS.length).toBe(6);
    const ids = [...WORLD_SPOTS.map((s) => s.id), ...WEST_SPOTS.map((s) => s.id)]; expect(new Set(ids).size).toBe(ids.length);
    for (const s of WEST_SPOTS) { expect(s.label.length).toBeGreaterThan(2); expect(s.blurb.length).toBeGreaterThan(20); expect(s.x).toBeLessThan(-300); }
  });
  it('the cleared sites sit on open ground: no houses, lots, farms, warehouses or decor under them', () => {
    const { houses, patches } = westFill();
    for (const b of WEST_ACTIVITY_SOLIDS) expect([...houses, ...patches, ...WEST_WAREHOUSES, ...WEST_FARMS, ...WEST_DECOR_SOLIDS].filter((o) => obbOverlap(o, b, 0))).toEqual([]);
    for (const b of WEST_ACTIVITY_SOLIDS) expect(inBridgeSite(b.x, b.z, 4)).toBe(false);
  });
  it('the pier reaches from the shore into Cedar Lake', () => {
    const pier = WEST_SPOTS.find((s) => s.id === 'w-pier')!; expect(nearWater(pier.x + 12, pier.z, 0)).toBe(true);
  });
  it('every site has a 3D model, a 2D tile and a panel', () => {
    const acts = readFileSync('client/src/lib/worldWestActs.ts', 'utf8'); const map = readFileSync('client/src/components/WorldMap.tsx', 'utf8'); const panel = readFileSync('client/src/components/WestChudPanel.tsx', 'utf8');
    for (const s of WEST_SPOTS) { expect(acts).toContain(`site('${s.id}'`); expect(panel).toContain(`id === '${s.id}'`); }
    expect(map).toContain('WEST_SPOTS.map'); expect(map).toContain("isWestSpotId(id)"); expect(readFileSync('client/src/lib/world3d.ts', 'utf8')).toContain('buildWestActs(');
  });
});

describe('payout tables stay modest', () => {
  it('odds sum to 100 and daily expected values are small', () => {
    for (const t of [FISH_CATCHES, PICK_FINDS, RODEO_TABLE]) expect(t.reduce((a, f) => a + f.odds, 0)).toBe(100);
    expect(Math.round(evOf(FISH_CATCHES))).toBe(457); expect(Math.round(evOf(PICK_FINDS))).toBe(535); expect(Math.round(rodeoEV())).toBe(633);
    const day = evOf(FISH_CATCHES) * FISH_PER_DAY + evOf(PICK_FINDS) * PICK_PER_DAY + rodeoEV() * RODEO_PER_DAY + CAMP_PAY;
    expect(day).toBeLessThan(8_000);
  });
  it('the mill adds a little value per pour and is capped per day', () => {
    for (const r of MILL_RECIPES) {
      const inV = r.inputs.reduce((a, it) => a + priceOf({ type: it.type, id: it.id }) * it.qty, 0); const outV = priceOf({ type: r.output.type, id: r.output.id }) * r.output.qty;
      expect(outV - inV - r.fee).toBeGreaterThan(0); expect(outV - inV - r.fee).toBeLessThan(40);
    }
    expect(MILL_DAILY_POURS).toBe(200); expect(MILL_MAX_BATCH).toBe(50); expect(MILL_FURNACES).toBe(2);
    const steel = MILL_RECIPES.find((r) => r.id === 'steel')!; expect(millBatchMs(steel, 10, false)).toBe(80_000); expect(millBatchMs(steel, 10, true)).toBe(40_000);
    expect(millCost(steel, 10, false)).toBe(30); expect(millCost(steel, 10, true)).toBe(90);
  });
  it('the mill table migration is additive only', () => {
    expect(WEST_MILL_MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS westchud_mill_jobs/); expect(WEST_MILL_MIGRATION).not.toMatch(/\b(DROP|ALTER|DELETE|TRUNCATE)\b/i);
  });
});

describe('guards', () => {
  it('needs Chud City, no jail, not disabled', async () => {
    await expect(castLine('Ann', setup({ here: false }).d)).rejects.toThrow(/Chud City/);
    await expect(castLine('Ann', setup({ jailed: true }).d)).rejects.toThrow(/Not available/);
    markDisabled('Dis', true); await expect(rideBull('Dis', setup().d)).rejects.toThrow(/Not available/);
    await expect(millStart('Ann', { recipe: 'steel', qty: 1 }, setup({ jailed: true }).d)).rejects.toThrow(/Not available/);
    await expect(marketSell('Ann', { id: 'crop_wheat', qty: 1 }, setup({ here: false }).d)).rejects.toThrow(/Chud City/);
    expect(() => startCamp('Ann', setup({ jailed: true }).d)).toThrow(/Not available/);
    await expect(pickBasket('Ann', setup({ here: false }).d)).rejects.toThrow(/Chud City/);
  });
});

describe('fishing pier, U-Pick and rodeo', () => {
  it('casts: capped per day, cooldown between, one keyed ledger row each, reset next UTC day', async () => {
    const { bank, d, tick, at } = setup(); let total = 0;
    for (let i = 0; i < FISH_PER_DAY; i++) {
      const r = await castLine('Ann', d); total += r.catch.paid; expect(bank.hasKey(westDayKey('fish', 'ann', '2026-11-22', i + 1))).toBe(true);
      await expect(castLine('Ann', d)).rejects.toThrow(/next cast in/); tick(FISH_COOLDOWN_MS);
    }
    await expect(castLine('Ann', d)).rejects.toThrow(/all 6 casts/);
    expect(bank.account('Ann').chips - START).toBe(total);
    expect(westActState('Ann', d).fish.catches.reduce((a, c) => a + c.pay, 0)).toBe(total);
    tick(DAY - (at() - T0)); expect((await castLine('Ann', d)).left).toBe(FISH_PER_DAY - 1);
  });
  it('baskets and rides follow their caps and cooldowns', async () => {
    const { d, tick } = setup();
    for (let i = 0; i < PICK_PER_DAY; i++) { await pickBasket('Ann', d); await expect(pickBasket('Ann', d)).rejects.toThrow(/next basket/); tick(PICK_COOLDOWN_MS); }
    await expect(pickBasket('Ann', d)).rejects.toThrow(/all 3 baskets/);
    for (let i = 0; i < RODEO_PER_DAY; i++) { const r = await rideBull('Ann', d); expect(RODEO_TABLE.find((t) => t.secs === r.secs)!.pay).toBe(r.paid); tick(RODEO_COOLDOWN_MS); }
    await expect(rideBull('Ann', d)).rejects.toThrow(/all 3 rides/);
    const s = westActState('Ann', d); expect(s.pick.used).toBe(3); expect(s.rodeo.used).toBe(3);
  });
  it('caps survive a restart (they live in the ledger, not memory)', async () => {
    const { d, tick } = setup(); await castLine('Ann', d); resetWestActivityMemory(); tick(1);
    expect(westActState('Ann', d).fish.used).toBe(1); expect((await castLine('Ann', d)).left).toBe(FISH_PER_DAY - 2);
  });
});

describe('campground', () => {
  it('rest first, then the first rest of the day pays once', async () => {
    const { bank, d, tick } = setup();
    await expect(claimCamp('Ann', d)).rejects.toThrow(/campfire first/);
    expect(startCamp('Ann', d).bonus).toBe(true); await expect(claimCamp('Ann', d)).rejects.toThrow(/Still resting/);
    tick(CAMP_MS); expect((await claimCamp('Ann', d)).paid).toBe(CAMP_PAY); expect(bank.account('Ann').chips - START).toBe(CAMP_PAY);
    expect(startCamp('Ann', d).bonus).toBe(false); tick(CAMP_MS); expect((await claimCamp('Ann', d)).paid).toBe(0);
  });
});

describe("farmers' market", () => {
  it('sells field crops from storage at the premium, a few sales a day', async () => {
    const { bank, mines, d } = setup(); mines.put('Ann', 'good', 'crop_apple', 100);
    await expect(marketSell('Ann', { id: 'crop_saffron', qty: 1 }, d)).rejects.toThrow(/field and orchard/);
    await expect(marketSell('Ann', { id: 'crop_apple', qty: MARKET_MAX_UNITS + 1 }, d)).rejects.toThrow(/1 to 10/);
    await expect(marketSell('Ann', { id: 'crop_pear', qty: 1 }, d)).rejects.toThrow(/You have 0/);
    let paid = 0;
    for (let i = 0; i < MARKET_SALES_PER_DAY; i++) { const r = await marketSell('Ann', { id: 'crop_apple', qty: 10 }, d); expect(r.paid).toBe(marketPay(GOODS.crop_apple.price, 10)); paid += r.paid; }
    expect(paid).toBe(5 * Math.floor(270 * 1.1 * 10));
    await expect(marketSell('Ann', { id: 'crop_apple', qty: 1 }, d)).rejects.toThrow(/all 5 market sales/);
    expect(mines.stackQty('Ann', 'good', 'crop_apple')).toBe(50); expect(bank.account('Ann').chips - START).toBe(paid);
  });
});

describe('Ironworks Steel Mill', () => {
  it('a batch takes the ore, pays the fee, runs on a timer and collects the steel', async () => {
    const { bank, mines, d, tick } = setup(); mines.put('Ann', 'ore', 'iron', 100); mines.put('Ann', 'ore', 'coal', 60);
    await bank.transferConfirmed('Ann', 1_000, { key: 'seed:ann', game: 'test' }); const before = bank.account('Ann').chips;
    const r = await millStart('Ann', { recipe: 'steel', qty: 10 }, d);
    expect(r.paid).toBe(30); expect(bank.account('Ann').chips).toBe(before - 30);
    expect(mines.stackQty('Ann', 'ore', 'iron')).toBe(50); expect(mines.stackQty('Ann', 'ore', 'coal')).toBe(30);
    expect(mines.rows.some((q) => /INSERT INTO westchud_mill_jobs/.test(q.sql))).toBe(true);
    await expect(millCollect('Ann', d)).rejects.toThrow(/Nothing is ready/);
    tick(80_000); const c = await millCollect('Ann', d);
    expect(c.collected).toEqual([{ type: 'bar', id: 'steel', qty: 10 }]); expect(mines.stackQty('Ann', 'bar', 'steel')).toBe(10);
    await expect(millCollect('Ann', d)).rejects.toThrow(/Nothing is ready/);
  });
  it('the shift crew halves the time for double the fee', async () => {
    const { bank, mines, d, tick } = setup(); mines.put('Ann', 'bar', 'iron_bar', 10); await bank.transferConfirmed('Ann', 1_000, { key: 'seed:ann', game: 'test' });
    const r = await millStart('Ann', { recipe: 'rebar', qty: 10, crew: true }, d); expect(r.paid).toBe(10 * 2 + 10 * 4); expect(r.job.doneAt - r.job.startAt).toBe(25_000);
    tick(25_000); expect((await millCollect('Ann', d)).collected).toEqual([{ type: 'good', id: 'iron_rod', qty: 30 }]);
  });
  it('two furnaces, batch limits, short inputs and the daily pour cap', async () => {
    const { bank, mines, d, tick, at } = setup(); mines.put('Ann', 'ore', 'iron', 10_000); mines.put('Ann', 'ore', 'coal', 10_000); await bank.transferConfirmed('Ann', 100_000, { key: 'seed:ann', game: 'test' });
    await expect(millStart('Ann', { recipe: 'nope', qty: 1 }, d)).rejects.toThrow(/Pick a recipe/);
    await expect(millStart('Ann', { recipe: 'pig', qty: 0 }, d)).rejects.toThrow(/1 to 50/);
    await expect(millStart('Ann', { recipe: 'pig', qty: 51 }, d)).rejects.toThrow(/1 to 50/);
    await expect(millStart('Ann', { recipe: 'beam', qty: 1 }, d)).rejects.toThrow(/Not enough Steel/);
    await millStart('Ann', { recipe: 'pig', qty: 50 }, d); await millStart('Ann', { recipe: 'pig', qty: 50 }, d);
    await expect(millStart('Ann', { recipe: 'pig', qty: 1 }, d)).rejects.toThrow(/furnaces are busy/);
    tick(200_000); await millCollect('Ann', d);
    await millStart('Ann', { recipe: 'pig', qty: 50 }, d); await millStart('Ann', { recipe: 'pig', qty: 50 }, d); tick(200_000); await millCollect('Ann', d);
    await expect(millStart('Ann', { recipe: 'pig', qty: 1 }, d)).rejects.toThrow(/200 pours a day/);
    expect(westActState('Ann', d).mill.poursToday).toBe(MILL_DAILY_POURS);
    tick(DAY - (at() - T0)); await millStart('Ann', { recipe: 'pig', qty: 1 }, d);
  });
  it('no chips, no batch (and nothing taken)', async () => {
    const { bank, mines, d } = setup(); mines.put('Ann', 'ore', 'iron', 500); mines.put('Ann', 'ore', 'coal', 500);
    const chips = bank.account('Ann').chips; await bank.transferConfirmed('Ann', -chips, { key: 'drain:ann', game: 'test' });
    await expect(millStart('Ann', { recipe: 'steel', qty: 50 }, d)).rejects.toThrow(/Not enough chips/);
    expect(mines.stackQty('Ann', 'ore', 'iron')).toBe(500);
  });
  it('open batches reload after a restart', async () => {
    const rows = [{ id: 'j1', player_key: 'ann', name: 'Ann', recipe: 'beam', qty: 3, crew: false, start_at: T0, done_at: T0 + 30_000, day: '2026-11-22', collected_at: null }];
    const n = await loadMillJobs({ query: async () => ({ rows }) }, T0); expect(n).toBe(1);
    const { mines, d, tick } = setup(); tick(30_000); expect(westActState('Ann', d).mill.jobs.length).toBe(1);
    expect((await millCollect('Ann', d)).collected).toEqual([{ type: 'good', id: 'steel_beam', qty: 3 }]); expect(mines.stackQty('Ann', 'good', 'steel_beam')).toBe(3);
  });
});

describe('wiring', () => {
  it('sockets, boot and changelog', () => {
    expect(readFileSync('server/sockets.ts', 'utf8')).toContain('registerWestActivities(io, socket)');
    expect(readFileSync('server/index.ts', 'utf8')).toMatch(/initWestActivities\(/);
    const log = readFileSync('shared/changelog.ts', 'utf8'); const entry = log.slice(log.indexOf('West Chud: a working Steel Mill'), log.indexOf('] },', log.indexOf('West Chud: a working Steel Mill'))); expect(entry).toMatch(/200 pours per day/); expect(entry).not.toMatch(/dayne|requested|asked/i);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { resetFarmGuardForTest } from '../server/farmGuard';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Farm } from '../server/farm';
import { setPriceIndexForTest } from '../server/price-index';
import { plantCapBonus, plantCapPaid, resetPlantCapForTest } from '../server/plant-cap';
import { cropById, farmPlots } from './farm-helpers';
import { propertyById } from '../shared/realEstate';
import { boxOrigin, boxTiles, FARM_TEMPLATE_MAX, normalizeLayout, normalizeTemplateName, packSelection, stampLayout, tileAtPoint } from '../shared/farmTemplates';

const T0 = Date.parse('2026-11-01T12:00:00Z');
async function setup() {
  resetPlantCapForTest();
  const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const clock = () => now;
  const re = new RealEstate(pool, () => bank, clock); await re.init();
  const farm = new Farm(pool, () => bank, clock); await farm.init();
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  const chips = (key: string) => Number(db.public.one(`SELECT chips FROM casino_players WHERE player_key = '${key}'`).chips);
  const ledger = (key: string, game: string) => db.public.many(`SELECT amount, tx_key FROM wallet_transactions WHERE player_key = '${key}' AND game = '${game}' ORDER BY id`) as Array<{ amount: number; tx_key: string | null }>;
  const small = farmPlots().find((p) => p.cols * p.rows === 16)!; const id = `f:${small.n}`;
  return { db, bank, re, farm, fund, chips, ledger, id, small, setNow: (t: number) => { now = t; } };
}

beforeEach(() => { resetFarmGuardForTest(); setPriceIndexForTest(1); });

describe('farm box select and template layouts', () => {
  it('boxTiles is an inclusive rectangle in row-major order', () => {
    expect(boxTiles(4, 4, 0, 0)).toEqual([0]);
    expect(boxTiles(4, 4, 0, 5)).toEqual([0, 1, 4, 5]);
    expect(boxTiles(4, 4, 5, 0)).toEqual([0, 1, 4, 5]);
    expect(boxTiles(4, 4, 1, 10)).toEqual([1, 2, 5, 6, 9, 10]);
    expect(boxTiles(4, 4, -1, 3)).toEqual([]);
    expect(boxOrigin(4, [5, 10, 1])).toBe(1);
  });

  it('tileAtPoint maps a padded CSS grid, ignoring the gap', () => {
    // 2x2 tiles of 10px, pad 6, gap 3 → width = 6+10+3+10+6 = 35
    const rect = { left: 0, top: 0, width: 35, height: 35 };
    expect(tileAtPoint(2, 2, rect, 6 + 5, 6 + 5)).toBe(0);
    expect(tileAtPoint(2, 2, rect, 6 + 10 + 3 + 5, 6 + 5)).toBe(1);
    expect(tileAtPoint(2, 2, rect, 6 + 5, 6 + 10 + 3 + 5)).toBe(2);
    expect(tileAtPoint(2, 2, rect, 6 + 10 + 1, 6 + 5)).toBe(null); // in the gap
    expect(tileAtPoint(2, 2, rect, 2, 2)).toBe(null); // padding
  });

  it('packSelection shrinks to a tight box and stampLayout places it at an origin, clipping the overflow', () => {
    const packed = packSelection(4, 4, [{ tile: 5, crop: 'wheat' }, { tile: 6, crop: 'carrot' }, { tile: 9, crop: 'wheat' }]);
    expect(packed).toEqual({ cols: 2, rows: 2, cells: [{ tile: 0, crop: 'wheat' }, { tile: 1, crop: 'carrot' }, { tile: 2, crop: 'wheat' }] });
    expect(stampLayout(packed as { cols: number; rows: number; cells: Array<{ tile: number; crop: string }> }, 4, 4, 0)).toEqual([
      { tile: 0, crop: 'wheat' }, { tile: 1, crop: 'carrot' }, { tile: 4, crop: 'wheat' },
    ]);
    expect(stampLayout(packed as { cols: number; rows: number; cells: Array<{ tile: number; crop: string }> }, 4, 4, 5)).toEqual([
      { tile: 5, crop: 'wheat' }, { tile: 6, crop: 'carrot' }, { tile: 9, crop: 'wheat' },
    ]);
    expect(stampLayout({ cols: 2, rows: 2, cells: [{ tile: 0, crop: 'wheat' }, { tile: 1, crop: 'carrot' }, { tile: 3, crop: 'wheat' }] }, 2, 2, 1)).toEqual([
      { tile: 1, crop: 'wheat' }, // (0,0) at origin col 1 — carrot at col 2 is clipped
    ]);
  });

  it('rejects mixed city and tropical crops, bad names, and empty layouts', () => {
    expect(normalizeTemplateName('  Spring mix  ')).toBe('Spring mix');
    expect(normalizeTemplateName('')).toBe(null);
    expect(normalizeTemplateName('x'.repeat(33))).toBe(null);
    expect(typeof normalizeLayout({ cols: 2, rows: 2, cells: [] })).toBe('string');
    expect(typeof normalizeLayout({ cols: 2, rows: 2, cells: [{ tile: 0, crop: 'wheat' }, { tile: 1, crop: 'pineapple' }] })).toBe('string');
    expect(normalizeLayout({ cols: 2, rows: 2, cells: [{ tile: 0, crop: 'wheat' }, { tile: 0, crop: 'wheat' }] })).toEqual({
      cols: 2, rows: 2, cells: [{ tile: 0, crop: 'wheat' }],
    });
  });
});

describe('farm template save / apply and mixed plantLayout', () => {
  it('only the owner can save and apply templates; another player cannot use them', async () => {
    const s = await setup(); const plot = propertyById(s.id)!;
    await s.fund('Gus', plot.price + 5000); await s.fund('Hal', plot.price + 5000);
    await expect(s.farm.saveTemplate('Gus', { name: 'Mix', cols: 2, rows: 1, cells: [{ tile: 0, crop: 'wheat' }] })).resolves.toMatchObject({ template: { name: 'Mix' } });
    await s.re.buy('Gus', s.id);
    await expect(s.farm.applyTemplate('Hal', s.id, (await s.farm.listTemplates('Gus')).templates[0]!.id, 0)).rejects.toThrow(/do not own|Unknown template/);
    const { templates: hal } = await s.farm.listTemplates('Hal');
    expect(hal).toEqual([]);
  });

  it('plantLayout plants mixed crops in one farm_seed charge, skips occupied tiles, and adds the planting house-cap bonus', async () => {
    const s = await setup(); const plot = propertyById(s.id)!;
    const wheat = cropById('wheat')!.seed, carrot = cropById('carrot')!.seed;
    await s.fund('Gus', plot.price + 5000); await s.re.buy('Gus', s.id);
    await s.farm.plant('Gus', s.id, 'wheat', [0]);
    const before = s.chips('gus');
    const r = await s.farm.plantLayout('Gus', s.id, [
      { tile: 0, crop: 'carrot' }, // already planted — skipped, not charged
      { tile: 1, crop: 'wheat' },
      { tile: 2, crop: 'carrot' },
    ]);
    expect(r).toMatchObject({ planted: 2, skipped: 1, cost: wheat + carrot });
    expect(s.chips('gus')).toBe(before - wheat - carrot);
    const seeds = s.ledger('gus', 'farm_seed');
    expect(seeds).toHaveLength(2);
    expect(seeds[1]!.amount).toBe(-(wheat + carrot));
    const v = await s.farm.view(s.id, 'Gus');
    expect(v.tiles.map((t) => [t.tile, t.crop]).sort()).toEqual([[0, 'wheat'], [1, 'wheat'], [2, 'carrot']]);
    expect(plantCapPaid('Gus', T0)).toBe(wheat /* first plant of tile 0 */ + wheat + carrot);
    expect(plantCapBonus('Gus', T0)).toBe(Math.floor(plantCapPaid('Gus', T0) * 0.5));
  });

  it('applying a saved template stamps from the origin and refuses tropical crops in the city', async () => {
    const s = await setup(); const plot = propertyById(s.id)!;
    await s.fund('Gus', plot.price + 5000); await s.re.buy('Gus', s.id);
    const saved = await s.farm.saveTemplate('Gus', { name: 'Strip', cols: 2, rows: 1, cells: [{ tile: 0, crop: 'wheat' }, { tile: 1, crop: 'carrot' }] });
    const r = await s.farm.applyTemplate('Gus', s.id, saved.template.id, 5);
    expect(r.planted).toBe(2);
    const v = await s.farm.view(s.id, 'Gus');
    expect(v.tiles.map((t) => [t.tile, t.crop]).sort()).toEqual([[5, 'wheat'], [6, 'carrot']]);
    await expect(s.farm.saveTemplate('Gus', { name: 'Nope', cols: 1, rows: 1, cells: [{ tile: 0, crop: 'pineapple' }] })).resolves.toBeTruthy();
    const trop = (await s.farm.listTemplates('Gus')).templates.find((t) => t.name === 'Nope')!;
    await expect(s.farm.applyTemplate('Gus', s.id, trop.id, 0)).rejects.toThrow(/Tropical crops only grow/);
  });

  it('refuses a layout the wallet cannot afford, and does not plant a partial field', async () => {
    const s = await setup(); const plot = propertyById(s.id)!;
    const wheat = cropById('wheat')!.seed;
    await s.fund('Ida', plot.price + wheat); await s.re.buy('Ida', s.id);
    await expect(s.farm.plantLayout('Ida', s.id, [{ tile: 0, crop: 'wheat' }, { tile: 1, crop: 'wheat' }])).rejects.toThrow(/Not enough chips/);
    expect((await s.farm.view(s.id, 'Ida')).tiles).toHaveLength(0);
    expect(s.chips('ida')).toBe(wheat);
  });

  it('caps the number of saved templates and lets a player delete one', async () => {
    const s = await setup();
    for (let i = 0; i < FARM_TEMPLATE_MAX; i++) {
      await s.farm.saveTemplate('Gus', { name: `T${i + 1}`, cols: 1, rows: 1, cells: [{ tile: 0, crop: 'wheat' }] });
    }
    await expect(s.farm.saveTemplate('Gus', { name: 'Overflow', cols: 1, rows: 1, cells: [{ tile: 0, crop: 'wheat' }] })).rejects.toThrow(/already have 20/);
    const first = (await s.farm.listTemplates('Gus')).templates.at(-1)!; // oldest
    await s.farm.deleteTemplate('Gus', first.id);
    await expect(s.farm.saveTemplate('Gus', { name: 'Room', cols: 1, rows: 1, cells: [{ tile: 0, crop: 'carrot' }] })).resolves.toMatchObject({ template: { name: 'Room' } });
    await expect(s.farm.deleteTemplate('Hal', first.id)).rejects.toThrow(/Unknown template/);
  });
});

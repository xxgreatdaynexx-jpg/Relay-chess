import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Farm, type ImportSink } from '../server/farm';
import { Fishing, fishImportQty } from '../server/fishing';
import { writeImport } from '../server/factory';
import { CROPS, farmPlots } from '../shared/farm';
import { TROPICAL_CROPS } from '../shared/resort';
import { GOODS, ORES, sellable, isFood } from '../shared/mines';
import { FRECIPES, KINDS, advance, madeBy, newState, recipeIn, recipeOut, tierOf, usedIn, type Storage } from '../shared/factory';

const T0 = Date.parse('2026-11-01T12:00:00Z');
const NEW = ['s_steel', 'a_bearing', 'a_motor', 'f_generator', 'f_robot', 'j_bracelet', 'm_flour', 'm_cornmeal', 'm_sugar', 'm_juice', 'm_tropical', 'm_oil', 'm_cocoa', 'm_coconut', 'k_wine', 'k_bread', 'k_chocolate', 'k_canned', 'k_fish_oil', 'k_pie', 'k_salsa', 'k_soup', 'k_banquet'];
const keyIsRaw = (k: string) => { const [t, id] = k.split(':'); return t === 'ore' ? id in ORES : !!GOODS[id]?.raw; };

describe('factory: more recipes + game resources in (pt1252u)', () => {
  it('adds 15-25 recipes; each pays a modest premium over its inputs (no chip printer)', () => {
    expect(NEW.length).toBeGreaterThanOrEqual(15); expect(NEW.length).toBeLessThanOrEqual(25);
    for (const id of NEW) {
      const r = FRECIPES.find((x) => x.id === id)!; expect(r, id).toBeTruthy();
      if (id === 'k_wine') continue; // Wine is fixed at 700 (crop margins 2026-11-04 exception)
      if (r.in.some(([k]) => !keyIsRaw(k))) { const q = recipeOut(r) / recipeIn(r); expect(q, id).toBeGreaterThanOrEqual(0.99); expect(q, id).toBeLessThan(1.4); continue; } // crop margins: higher-tier crop goods = their crop chain (30%); intermediates already carry it
      const ratio = recipeOut(r) / recipeIn(r);
      expect(ratio, id).toBeGreaterThan(1.05); expect(ratio, id).toBeLessThan(1.4);
      expect(KINDS[r.machine].machine).toBe(true);
    }
  });
  it('every input is either raw (ore / imported crop or fish) or made by another recipe; chains go several tiers deep', () => {
    for (const r of FRECIPES) for (const [k] of r.in) expect(keyIsRaw(k) || !!madeBy(k), `${r.id} needs ${k}`).toBe(true);
    for (const c of [...CROPS, ...TROPICAL_CROPS]) { const g = GOODS[`crop_${c.id}`]; expect(g?.raw, c.id).toBe(true); expect(g!.price).toBeCloseTo(c.seed * 1.2, 2); } // crop margins: reference = seed x 1.2 (raw harvest value)
    for (const c of [...CROPS, ...TROPICAL_CROPS]) expect(usedIn(`good:crop_${c.id}`).length, `${c.id} has a use`).toBeGreaterThan(0);
    expect(usedIn('good:fish_fillet').length).toBeGreaterThan(0); expect(usedIn('good:fish_portion').length).toBeGreaterThan(0);
    expect(tierOf('good:robot')).toBeGreaterThanOrEqual(4); expect(tierOf('good:chocolate')).toBe(2); expect(tierOf('good:banquet')).toBe(3);
  });
  it('raw imports cannot be sold to the house; crafted food gives Cooking XP', () => {
    expect(sellable({ type: 'good', id: 'crop_wheat' })).toBe(false); expect(sellable({ type: 'good', id: 'fish_fillet' })).toBe(false);
    expect(sellable({ type: 'good', id: 'flour' })).toBe(true); expect(sellable({ type: 'ore', id: 'iron' })).toBe(true);
    expect(isFood({ type: 'good', id: 'bread' })).toBe(true); expect(isFood({ type: 'good', id: 'motor' })).toBe(false);
  });
  it('Output Chest "Only accept" filter: other items back up instead of going in', () => {
    const s = newState(3, 0); let id = 0;
    const e = (k: any, x: number, y: number, d: any, extra: object = {}) => s.ents.push({ id: ++id, k, x, y, d, ...extra });
    e('chest_in', 0, 0, 0, { f: 'good:crop_wheat' }); e('belt', 1, 0, 0); e('mill', 2, 0, 0, { r: 'm_flour' }); e('belt', 4, 0, 0); e('chest_out', 5, 0, 0, { f: 'good:sugar' });
    s.seq = id;
    const m: Record<string, number> = { 'good:crop_wheat': 10 }; const st: Storage = { get: (k) => m[k] ?? 0, add: (k, d) => { m[k] = (m[k] ?? 0) + d; } };
    advance(s, st, 120_000); expect(m['good:flour'] ?? 0).toBe(0);
    s.ents.find((x) => x.k === 'chest_out')!.f = 'good:flour'; advance(s, st, 240_000); expect(m['good:flour']).toBe(5);
  });
  it('fish import: fillets per 8 value, portions per 10, junk/small rejected', () => {
    expect(fishImportQty(40, false)).toBe(5); expect(fishImportQty(40, true)).toBe(4); expect(fishImportQty(7, false)).toBe(0);
  });
});

async function db() {
  const d = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(d); const { Pool } = d.adapters.createPg(); const pool = new Pool();
  await pool.query('CREATE TABLE IF NOT EXISTS mine_items (player_key TEXT NOT NULL, owner_name TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (player_key, item_type, item_id))');
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  const after: Array<Array<[string, number]>> = [];
  const sink = (name: string, fail = false): ImportSink => ({ write: async (cl, items) => { await writeImport(cl, name, items); if (fail) throw new Error('boom'); }, after: (items) => { after.push(items); } });
  const qty = (id: string) => Number(d.public.many(`SELECT qty FROM mine_items WHERE item_id = '${id}'`)[0]?.qty ?? 0);
  return { d, pool, bank, sink, qty, after };
}

describe('imports are atomic and server-side', () => {
  it('farm: ready crops move to factory storage with no chips paid; exactly once', async () => {
    const { pool, bank, sink, qty, after } = await db(); let now = T0;
    const re = new RealEstate(pool, () => bank, () => now); await re.init();
    const farm = new Farm(pool, () => bank, () => now); await farm.init();
    bank.transfer('Gus', 100_000, { game: 'admin' }); await bank.flush();
    const p = farmPlots().find((x) => x.cols * x.rows === 16)!; const id = `f:${p.n}`;
    await re.buy('Gus', id); await farm.plant('Gus', id, 'wheat', [0, 1, 2]);
    now += 11 * 60_000; const chips = bank.account('Gus').chips;
    expect(await farm.myPlots('Gus')).toEqual([id]);
    const r = await farm.harvest('Gus', id, undefined, sink('Gus'));
    expect(r.harvested).toBe(3); expect(r.paid).toBe(0); expect(qty('crop_wheat')).toBe(3); expect(after.at(-1)).toEqual([['crop_wheat', 3]]);
    expect(bank.account('Gus').chips).toBe(chips);
    await expect(farm.harvest('Gus', id, undefined, sink('Gus'))).rejects.toThrow(/Nothing is ready/);
  });
  it('fish: cooler fish leave the cooler exactly once; junk stays', async () => {
    const { pool, bank, sink, qty } = await db();
    const f = new Fishing(pool, () => bank, () => T0); await f.init();
    const ins = (id: string, sp: string, v: number, dish: string | null = null) => pool.query('INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at, dish, loc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, 'gus', 'Gus', sp, 1000, v, T0, dish, 'warehouse']); // map pools: city-map fish
    await ins('a', 'bass', 24); await ins('b', 'salmon', 60, 'Seared Salmon'); await ins('c', 'boot', 2);
    const r = await f.toFactory('Gus', undefined, sink('Gus'));
    expect(r.moved).toBe(2); expect(qty('fish_fillet')).toBe(3); expect(qty('fish_portion')).toBe(6);
    await expect(f.toFactory('Gus', undefined, sink('Gus'))).rejects.toThrow(/No fish/);
    expect((await pool.query("SELECT id FROM fish_catches WHERE sold_at IS NULL")).rows.map((x: { id: string }) => x.id)).toEqual(['c']);
  });
});

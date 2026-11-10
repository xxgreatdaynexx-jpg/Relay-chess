import { beforeEach, describe, expect, it } from 'vitest';
import { resetFarmGuardForTest } from '../server/farmGuard';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Farm } from '../server/farm';
import { farmPlots } from './farm-helpers';
import { farmBarns } from '../shared/farmBarns';

const T0 = Date.parse('2026-11-01T12:00:00Z');
const M = 60_000;

async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db);
  const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const clock = () => now;
  const re = new RealEstate(pool, () => bank, clock); await re.init();
  const farm = new Farm(pool, () => bank, clock); await farm.init();
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  const chips = (key: string) => Number(db.public.one(`SELECT chips FROM casino_players WHERE player_key = '${key}'`).chips);
  const plots = farmPlots().filter((p) => p.cols * p.rows >= 16);
  const id1 = `f:${plots[0]!.n}`;
  const id2 = `f:${plots[1]!.n}`;
  const barn = farmBarns()[0]!.id;
  return { db, bank, re, farm, fund, chips, id1, id2, barn, setNow: (t: number) => { now = t; } };
}

beforeEach(() => resetFarmGuardForTest());

describe('farm dashboard batch actions', () => {
  it('requires a separately purchased barn and ownership of every named plot', async () => {
    const s = await setup();
    await s.fund('Gus', 1_000_000);
    await s.re.buy('Gus', s.id1);
    await expect(s.farm.dash('Gus', { action: 'plant', ids: [s.id1], crop: 'wheat' })).rejects.toThrow(/separately purchased barn/);
    await s.re.buy('Gus', s.barn);
    await expect(s.farm.dash('Gus', { action: 'plant', ids: [s.id2], crop: 'wheat' })).rejects.toThrow(/do not own/);
    await expect(s.farm.dash(null as never, { action: 'plant', ids: [s.id1], crop: 'wheat' })).rejects.toThrow(/Sign in/);
  });

  it('harvests every ready tile on several plots with one rate-limit token, and refuses growing or withered tiles', async () => {
    const s = await setup();
    await s.fund('Gus', 1_000_000);
    await s.re.buy('Gus', s.id1); await s.re.buy('Gus', s.id2); await s.re.buy('Gus', s.barn);
    await s.farm.plant('Gus', s.id1, 'wheat', [0, 1, 2, 3]);
    await s.farm.plant('Gus', s.id2, 'wheat', [0, 1]);
    await expect(s.farm.dash('Gus', { action: 'harvest', ids: [s.id1, s.id2] })).rejects.toThrow(/Nothing is ready/);
    s.setNow(T0 + 20 * M);
    const before = s.chips('gus');
    const r = await s.farm.dash('Gus', { action: 'harvest', ids: [s.id1, s.id2] });
    expect(r.harvested).toBe(6);
    expect(r.paid).toBeGreaterThan(0);
    expect(s.chips('gus')).toBe(before + r.paid);
    expect((await s.farm.view(s.id1, 'Gus')).tiles).toHaveLength(0);
    expect((await s.farm.view(s.id2, 'Gus')).tiles).toHaveLength(0);
  });

  it('replants only empty tiles, charges seeds like a normal plant, and leaves growing crops alone', async () => {
    const s = await setup();
    await s.fund('Gus', 1_000_000);
    await s.re.buy('Gus', s.id1); await s.re.buy('Gus', s.barn);
    await s.farm.plant('Gus', s.id1, 'wheat', [0, 1]);
    const before = s.chips('gus');
    const view = await s.farm.view(s.id1, 'Gus');
    const empty = view.cols * view.rows - 2;
    const r = await s.farm.dash('Gus', { action: 'plant', ids: [s.id1], crop: 'carrot' });
    expect(r.planted).toBe(empty);
    expect(s.chips('gus')).toBe(before - r.cost);
    const after = await s.farm.view(s.id1, 'Gus');
    expect(after.tiles).toHaveLength(view.cols * view.rows);
    expect(after.tiles.filter((t) => t.crop === 'wheat').map((t) => t.tile).sort()).toEqual([0, 1]);
    expect(after.tiles.filter((t) => t.crop === 'carrot')).toHaveLength(empty);
  });

  it('harvest-and-replant harvests ready tiles then plants the empties with the chosen seed', async () => {
    const s = await setup();
    await s.fund('Gus', 1_000_000);
    await s.re.buy('Gus', s.id1); await s.re.buy('Gus', s.barn);
    await s.farm.plant('Gus', s.id1, 'wheat', [0, 1]);
    s.setNow(T0 + 20 * M);
    const r = await s.farm.dash('Gus', { action: 'harvest_replant', ids: [s.id1], crop: 'carrot' });
    expect(r.harvested).toBe(2);
    const view = await s.farm.view(s.id1, 'Gus');
    expect(view.tiles).toHaveLength(view.cols * view.rows);
    expect(view.tiles.every((t) => t.crop === 'carrot')).toBe(true);
    expect(r.planted).toBe(view.cols * view.rows);
  });

  it('rejects mixed city and resort ids, and refuses a tropical seed on a city farm', async () => {
    const s = await setup();
    await s.fund('Gus', 1_000_000);
    await s.re.buy('Gus', s.id1); await s.re.buy('Gus', s.barn);
    await expect(s.farm.dash('Gus', { action: 'plant', ids: [s.id1, 'rf:1'], crop: 'wheat' })).rejects.toThrow(/one map/);
    await expect(s.farm.dash('Gus', { action: 'plant', ids: [s.id1], crop: 'pineapple' })).rejects.toThrow(/Tropical crops/);
  });

  it('refuses a plant when there are not enough chips, before changing any tiles', async () => {
    const s = await setup();
    await s.fund('Gus', 1_000_000);
    await s.re.buy('Gus', s.id1); await s.re.buy('Gus', s.barn);
    // drain almost all chips, leave too little for a full replant
    const left = s.chips('gus');
    s.bank.transfer('Gus', -(left - 5), { game: 'admin' }); await s.bank.flush();
    await expect(s.farm.dash('Gus', { action: 'plant', ids: [s.id1], crop: 'wheat' })).rejects.toThrow(/Not enough chips/);
    expect((await s.farm.view(s.id1, 'Gus')).tiles).toHaveLength(0);
    expect(s.chips('gus')).toBe(5);
  });
});

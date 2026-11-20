import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { Estate, setEstate } from '../server/estateProjects';
import { RealEstate, setRealEstateForTest, type RealEstate as RE } from '../server/realEstate';
import { CasinoBank, PgCasinoStore, getBank, resetBank } from '../server/casino-store';
import { resetMines } from '../server/mines';
import { resetFarmGuardForTest } from '../server/farmGuard';
import { resetPlantCapForTest } from '../server/plant-cap';
import { Farm } from '../server/farm';
import { ESTATE_BUILDS, estateStages, partKey } from '../shared/estateProjects';
import { demolishedLine, demolishedPlacement, isDemolishedSite } from '../shared/estateSites';
import { propertyById } from '../shared/realEstate';
import { farmPlots } from './farm-helpers';

function fakeRE(map: Record<string, string>): RE {
  return {
    ownerOf: async (id: string) => { const name = map[id]; return name ? { key: name.toLowerCase(), name } : null; },
    owned: async () => Object.entries(map).map(([id, name]) => ({ id, owner: name })),
  } as unknown as RE;
}
const fund = (name: string, chips: number) => { const b = getBank(); b.transfer(name, chips - b.account(name).chips, { game: 'test' }); };
/** Fund every part of every stage (catalog chips for materials, like the panel's Fill buttons). */
async function finish(e: Estate, name: string, lotId: string) {
  const site = e.siteByLot(lotId)!; const stages = estateStages(ESTATE_BUILDS[site.build!]);
  for (const st of stages) {
    await e.contribute(name, lotId, 'chips', st.chips);
    for (const g of st.goods) await e.contribute(name, lotId, partKey(g), g.qty);
  }
}
const fullDone = (build: keyof typeof ESTATE_BUILDS) => estateStages(ESTATE_BUILDS[build]).map((st) => {
  const d: Record<string, number> = { chips: st.chips }; for (const g of st.goods) d[partKey(g)] = g.qty; return d;
});

describe('demolished farm becomes the finished private building', () => {
  afterEach(() => { setRealEstateForTest(null); resetMines(); setEstate(null); });

  it('a farm demolished for a mansion reports a finished, converted site once all 4 stages are funded', async () => {
    setRealEstateForTest(fakeRE({ 'f:1': 'Jay' }));
    fund('Jay', 50_000_000);
    const e = new Estate(null);
    await e.demolish('Jay', 'f:1', true);
    await e.choose('Jay', 'f:1', 'mansion');
    await finish(e, 'Jay', 'f:1');
    const v = e.siteView(e.siteByLot('f:1')!);
    expect(v).toMatchObject({ kind: 'demolished', build: 'mansion', stage: 4, complete: true });
    expect(v.was?.type).toBe('farmland');
    const map = e.mapSummary(new Map([['f:1', 'jay']])).sites.find((s) => s.lotId === 'f:1')!;
    expect(map).toMatchObject({ build: 'mansion', complete: true, kind: 'demolished' });
    expect(isDemolishedSite(map)).toBe(true);
    expect(e.demolishedSite('Jay', 'f:1')).toBeTruthy();
    expect(e.demolishedSite('Someone', 'f:1')).toBeNull();
    expect(demolishedLine(map)).toMatch(/Mansion: finished/);
  });

  it('places the building on the old farm footprint, shrunk to fit and never larger than the plan', () => {
    for (const p of farmPlots().slice(0, 6)) {
      const id = `f:${p.n}`; const prop = propertyById(id)!;
      const at = demolishedPlacement(id, 'mansion')!;
      expect(at.x).toBe(prop.x); expect(at.z).toBe(prop.z);
      expect(at.scale).toBeGreaterThan(0); expect(at.scale).toBeLessThanOrEqual(1);
      const plan = ESTATE_BUILDS.mansion; const turned = Math.abs(Math.sin(at.rot - prop.rot)) > 0.5;
      const [w, d] = turned ? [plan.d, plan.w] : [plan.w, plan.d];
      if (at.scale > 0.35) { expect(w * at.scale).toBeLessThanOrEqual(prop.w + 1e-6); expect(d * at.scale).toBeLessThanOrEqual(prop.d + 1e-6); }
    }
    expect(demolishedPlacement('nope:1', 'mansion')).toBeNull();
    // East Estates lots and Goldwood homes keep their own map layer
    expect(isDemolishedSite({ kind: 'demolished', lotId: 'lot:estate:3' })).toBe(false);
    expect(isDemolishedSite({ kind: 'open', lotId: 'f:2' })).toBe(true); // project picked straight from the deed card
    expect(isDemolishedSite({ kind: 'turnkey_plant', lotId: 'f:2' })).toBe(false);
    expect(isDemolishedSite({ kind: 'open', lotId: 'nope:1' })).toBe(false);
  });

  it('a site stuck at a stale stage count heals on load and is saved, with no manual edits', async () => {
    const saved: unknown[][] = [];
    const row = { id: 's1', lot_id: 'f:2', owner_key: 'jay', owner_name: 'Jay',
      data: { id: 's1', lotId: 'f:2', owner: 'jay', kind: 'demolished', build: 'mansion', stage: 3, done: fullDone('mansion'), gear: 0, settledAt: 0, was: { type: 'farm', label: 'Farm 2' } } };
    const pool = {
      query: async (sql: string, args?: unknown[]) => {
        if (/SELECT \* FROM estate_sites/.test(sql)) return { rows: [row] };
        if (/INSERT INTO estate_sites/.test(sql)) saved.push(args ?? []);
        return { rows: [] };
      },
      connect: async () => { throw new Error('unused'); },
    };
    const e = new Estate(pool as never);
    await e.init();
    expect(e.siteByLot('f:2')!.stage).toBe(4);
    expect(e.mapSummary().sites[0]).toMatchObject({ complete: true });
    expect(saved).toHaveLength(1);
    expect((saved[0]![4] as { stage: number }).stage).toBe(4);
  });

  it('picking a project straight from a farm deed (no separate Demolish step) converts the farm when finished', async () => {
    setRealEstateForTest(fakeRE({ 'f:5': 'Jay' }));
    fund('Jay', 50_000_000);
    const e = new Estate(null);
    await e.choose('Jay', 'f:5', 'mansion');
    expect(e.siteByLot('f:5')).toMatchObject({ kind: 'demolished', was: { type: 'farmland' } });
    await finish(e, 'Jay', 'f:5');
    const map = e.mapSummary(new Map([['f:5', 'jay']])).sites.find((s) => s.lotId === 'f:5')!;
    expect(map).toMatchObject({ build: 'mansion', complete: true });
    expect(isDemolishedSite(map)).toBe(true);
    expect(e.demolishedSite('Jay', 'f:5')).toBeTruthy();
  });

  it('a finished mansion stored as an "open" site on a farm (the live 4 of 4 case) heals to a demolished lot on load', async () => {
    const saved: Array<Record<string, unknown>> = [];
    const rows = [
      { id: 'a', lot_id: 'f:17', owner_key: 'jay', owner_name: 'Jay', data: { id: 'a', lotId: 'f:17', owner: 'jay', kind: 'open', build: 'mansion', stage: 4, done: fullDone('mansion'), gear: 0, settledAt: 0 } },
      { id: 'b', lot_id: 'lot:estate:1', owner_key: 'ann', owner_name: 'Ann', data: { id: 'b', lotId: 'lot:estate:1', owner: 'ann', kind: 'open', build: 'data_center', stage: 4, done: fullDone('data_center'), gear: 3, settledAt: 0 } },
    ];
    const pool = {
      query: async (sql: string, args?: unknown[]) => {
        if (/SELECT \* FROM estate_sites/.test(sql)) return { rows };
        if (/INSERT INTO estate_sites/.test(sql)) saved.push((args ?? [])[4] as Record<string, unknown>);
        return { rows: [] };
      },
      connect: async () => { throw new Error('unused'); },
    };
    const e = new Estate(pool as never);
    await e.init();
    expect(e.siteByLot('f:17')).toMatchObject({ kind: 'demolished', stage: 4, was: { type: 'farmland' } });
    expect(e.siteByLot('lot:estate:1')!.kind).toBe('open'); // East Estates lots are untouched
    expect(saved.map((d) => d.lotId)).toEqual(['f:17']);
    expect(isDemolishedSite(e.mapSummary(new Map([['f:17', 'jay']])).sites.find((s) => s.lotId === 'f:17'))).toBe(true);
  });

  it('heals on the next interaction too (opening the works panel)', async () => {
    setRealEstateForTest(fakeRE({ 'f:3': 'Jay' }));
    const e = new Estate(null);
    await e.demolish('Jay', 'f:3', true);
    const s = e.siteByLot('f:3')!; s.build = 'mansion'; s.done = fullDone('mansion'); s.stage = 2;
    const v = await e.view('Jay');
    expect((v as { sites: Array<{ lotId: string; complete: boolean }> }).sites.find((x) => x.lotId === 'f:3')!.complete).toBe(true);
    expect(s.stage).toBe(4);
  });

  it('a resold demolished lot is no longer drawn as the old owner\u2019s site', async () => {
    setRealEstateForTest(fakeRE({ 'f:4': 'Jay' }));
    const e = new Estate(null);
    await e.demolish('Jay', 'f:4', true);
    expect(e.mapSummary(new Map([['f:4', 'jay']])).sites.some((s) => s.lotId === 'f:4')).toBe(true);
    expect(e.mapSummary(new Map([['f:4', 'bob']])).sites.some((s) => s.lotId === 'f:4')).toBe(false);
    expect(e.mapSummary(new Map()).sites.some((s) => s.lotId === 'f:4')).toBe(false);
  });

  it('client wiring: the map hides the old farm, draws the build on the lot, and routes clicks to the site', () => {
    const estate = readFileSync('client/src/lib/worldEstate.ts', 'utf8');
    expect(estate).toMatch(/demolishedPlacement\(/);
    expect(estate).toMatch(/setCleared\?\.\(cleared\)/);
    const world = readFileSync('client/src/lib/world3d.ts', 'utf8');
    expect(world).toMatch(/const setCleared = /);
    expect(world).toMatch(/clearedSaved\.has\(pid\)/);
    const map = readFileSync('client/src/components/WorldMap.tsx', 'utf8');
    expect(map).toMatch(/if \(demolishedSiteOf\(id\)\)/);
    expect(map).toMatch(/data-testid="deed-demolished"/);
  });
});

describe('demolished farm plots stop taking new seeds', () => {
  beforeEach(() => { resetBank(); resetPlantCapForTest(); resetFarmGuardForTest(); });
  afterEach(() => { setEstate(null); setRealEstateForTest(null); });

  it('refuses planting on a demolished farm without charging, but the owner still sees the plot as demolished', async () => {
    const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db);
    const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    const now = Date.parse('2026-11-20T15:00:00Z'); const clock = () => now;
    const re = new RealEstate(pool, () => bank, clock); await re.init();
    const farm = new Farm(pool, () => bank, clock); await farm.init();
    bank.transfer('Jay', 5_000_000, { game: 'admin' }); await bank.flush();
    const small = farmPlots().find((p) => p.cols * p.rows === 16)!; const id = `f:${small.n}`;
    await re.buy('Jay', id);
    await farm.plant('Jay', id, 'wheat', [0]);
    const est = new Estate(null); setEstate(est);
    setRealEstateForTest(fakeRE({ [id]: 'Jay' }));
    await est.demolish('Jay', id, true);
    const before = bank.account('Jay').chips;
    await expect(farm.plant('Jay', id, 'wheat', [1])).rejects.toThrow(/demolished/);
    expect(bank.account('Jay').chips).toBe(before);
    const view = await farm.view(id, 'Jay');
    expect(view.demolished).toBe(true);
    expect(view.tiles.map((t) => t.tile)).toEqual([0]); // the crop already growing is kept for harvest
  });
});

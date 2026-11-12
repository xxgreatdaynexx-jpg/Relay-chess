import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { newDb } from 'pg-mem';
import { PgCasinoStore, START_CHIPS, getBank, resetBank } from '../server/casino-store';
import { Homes } from '../server/homes';
import { setPriceIndexForTest } from '../server/price-index';
import { properties } from '../shared/realEstate';
import { FURNITURE, FURN_BY_ID, fits, isHomeProperty, validateLayout } from '../shared/homes';
import { buildFurniture } from '../client/src/lib/homeModels';

const NEW_IDS = [
  'monstera', 'fiddlefig', 'snakeplant', 'pothos', 'cacti', 'parlorpalm',
  'pinksofa', 'pinkchair', 'pinkbed', 'pinkrug', 'pinklamp', 'pinkdresser',
  'eames', 'teaksideboard', 'tuliptable', 'credenza', 'sunburst', 'arclamp', 'mcmsofa',
] as const;

const EXPECTED: Record<(typeof NEW_IDS)[number], { cat: string; price: number; w: number; d: number; shape: string }> = {
  monstera: { cat: 'plants', price: 280, w: 1, d: 1, shape: 'monstera' },
  fiddlefig: { cat: 'plants', price: 350, w: 1, d: 1, shape: 'fiddlefig' },
  snakeplant: { cat: 'plants', price: 180, w: 1, d: 1, shape: 'snakeplant' },
  pothos: { cat: 'plants', price: 220, w: 1, d: 1, shape: 'pothos' },
  cacti: { cat: 'plants', price: 200, w: 1, d: 1, shape: 'cacti' },
  parlorpalm: { cat: 'plants', price: 320, w: 1, d: 1, shape: 'parlorpalm' },
  pinksofa: { cat: 'seating', price: 1600, w: 3, d: 1, shape: 'sofa' },
  pinkchair: { cat: 'seating', price: 700, w: 1, d: 1, shape: 'chair' },
  pinkbed: { cat: 'beds', price: 2200, w: 2, d: 2, shape: 'bed' },
  pinkrug: { cat: 'decor', price: 360, w: 3, d: 2, shape: 'rug' },
  pinklamp: { cat: 'lighting', price: 240, w: 1, d: 1, shape: 'lamp' },
  pinkdresser: { cat: 'storage', price: 750, w: 2, d: 1, shape: 'cabinet' },
  eames: { cat: 'seating', price: 2400, w: 1, d: 2, shape: 'eames' },
  teaksideboard: { cat: 'storage', price: 1800, w: 3, d: 1, shape: 'sideboard' },
  tuliptable: { cat: 'tables', price: 1200, w: 2, d: 2, shape: 'tulip' },
  credenza: { cat: 'storage', price: 2200, w: 3, d: 1, shape: 'sideboard' },
  sunburst: { cat: 'decor', price: 550, w: 1, d: 1, shape: 'sunburst' },
  arclamp: { cat: 'lighting', price: 900, w: 1, d: 2, shape: 'arclamp' },
  mcmsofa: { cat: 'seating', price: 2000, w: 3, d: 1, shape: 'lowsofa' },
};

const fund = (n: string, amt = 80_000) => getBank().transferConfirmed(n, amt, { key: `test_fund:${n}:${Math.random()}`, game: 'admin' });
const [H1] = properties().filter((p) => isHomeProperty(p) && !p.retired).map((p) => p.id);

describe('new furniture batch', () => {
  it('adds the requested plants, pink pieces, and mid-century items with unique ids and index-ready prices', () => {
    expect(new Set(FURNITURE.map((f) => f.id)).size).toBe(FURNITURE.length);
    for (const id of NEW_IDS) {
      const f = FURN_BY_ID.get(id); expect(f, id).toBeTruthy();
      const exp = EXPECTED[id];
      expect(f!.cat).toBe(exp.cat);
      expect(f!.price).toBe(exp.price);
      expect(f!.w).toBe(exp.w);
      expect(f!.d).toBe(exp.d);
      expect(f!.shape).toBe(exp.shape);
      expect(f!.h).toBeGreaterThan(0);
    }
    expect(FURN_BY_ID.get('plant')?.price).toBe(120);
    expect(FURN_BY_ID.get('palm')?.price).toBe(400);
  });

  it('places, rotates, and keeps rugs from blocking other new items', () => {
    const sofa = { uid: 's', f: 'pinksofa', x: 0, z: 0, r: 0 };
    expect(fits([], sofa)).toBe(true);
    expect(fits([sofa], { uid: 'r', f: 'pinkrug', x: 0, z: 0, r: 0 })).toBe(true);
    expect(fits([sofa], { uid: 'c', f: 'pinkchair', x: 1, z: 0, r: 0 })).toBe(false);
    const eames = { uid: 'e', f: 'eames', x: 4, z: 0, r: 0 };
    expect(fits([], eames)).toBe(true);
    expect(fits([], { ...eames, r: 1 })).toBe(true); // 2×1 after a quarter turn
    expect(fits([], { uid: 't', f: 'tuliptable', x: 10, z: 8, r: 0 })).toBe(true);
    expect(fits([], { uid: 't', f: 'tuliptable', x: 11, z: 8, r: 0 })).toBe(false);
    const inv = new Map(NEW_IDS.map((id) => [id, 1]));
    const items = [
      { uid: 'a', f: 'monstera', x: 0, z: 3, r: 0 },
      { uid: 'b', f: 'eames', x: 2, z: 3, r: 1 },
      { uid: 'c', f: 'pinkrug', x: 0, z: 0, r: 0 },
      { uid: 'd', f: 'sunburst', x: 6, z: 0, r: 0 },
      { uid: 'e', f: 'mcmsofa', x: 5, z: 4, r: 0 },
    ];
    const v = validateLayout({ wall: 'plaster', floor: 'laminate', items }, inv, () => false);
    expect(v.ok).toBe(true);
  });

  it('builds a mesh for every new shape that sits on the floor and roughly fills its footprint', () => {
    for (const id of NEW_IDS) {
      const f = FURN_BY_ID.get(id)!;
      const g = buildFurniture(f);
      expect(g.children.length, id).toBeGreaterThan(0);
      const bb = new THREE.Box3().setFromObject(g);
      expect(bb.max.y, id).toBeGreaterThan(0.02);
      expect(bb.min.y, id).toBeGreaterThanOrEqual(-0.05);
      expect(bb.max.x - bb.min.x, id).toBeLessThan(f.w + 0.7);
      expect(bb.max.z - bb.min.z, id).toBeLessThan(f.d + 0.7);
      if (f.h < 0.1) expect(bb.max.y, id).toBeLessThan(0.1);
      else expect(bb.max.y, id).toBeGreaterThan(0.15);
    }
  });
});

describe('new furniture money and persistence', () => {
  let owners: Map<string, string>;
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); owners = new Map([[H1, 'Ann']]); });
  afterEach(() => setPriceIndexForTest(1));
  const mk = (pool: ConstructorParameters<typeof Homes>[0] = null) => new Homes(pool, async (id) => owners.get(id) ?? null);

  it('prices the new catalog through the price index and charges the indexed amount', async () => {
    const h = mk();
    setPriceIndexForTest(2);
    const cat = h.catalog().furniture.find((x: { id: string }) => x.id === 'monstera')!;
    expect(cat.base).toBe(280);
    expect(cat.price).toBe(560);
    await fund('Ann');
    await h.buy('Ann', 'monstera', 1);
    expect(getBank().account('Ann').chips).toBe(START_CHIPS + 80_000 - 560);
  });

  it('buys, places, rotates, and reloads a mix of new items (Postgres)', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    getBank().retryMs = []; await getBank().attach(new PgCasinoStore(pool));
    const h = mk(pool as never); await h.init(); await fund('Ann');
    await h.buy('Ann', 'pinksofa', 1);
    await h.buy('Ann', 'eames', 1);
    await h.buy('Ann', 'pothos', 2);
    const layout = { wall: 'plaster', floor: 'laminate', items: [
      { uid: 'sofa1', f: 'pinksofa', x: 0, z: 0, r: 0 },
      { uid: 'e1', f: 'eames', x: 4, z: 0, r: 1 },
      { uid: 'p1', f: 'pothos', x: 7, z: 2, r: 2 },
    ] };
    await h.save('Ann', H1, layout);
    const loaded = await h.state(H1);
    expect(loaded.layout.items).toEqual(layout.items);
    const locker = await h.locker('Ann');
    const by = Object.fromEntries(locker.items.map((x: { item: string; qty: number; placed: number }) => [x.item, x]));
    expect(by.pinksofa).toEqual({ item: 'pinksofa', qty: 1, placed: 1 });
    expect(by.eames).toEqual({ item: 'eames', qty: 1, placed: 1 });
    expect(by.pothos).toEqual({ item: 'pothos', qty: 2, placed: 1 });
    const buys = db.public.many(`SELECT amount FROM wallet_transactions WHERE game = 'furniture_buy' ORDER BY amount`).map((x) => Number(x.amount));
    expect(buys).toEqual([-2400, -1600, -440]);
  });
});

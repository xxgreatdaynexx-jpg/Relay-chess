import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { PgCasinoStore, START_CHIPS, getBank, resetBank } from '../server/casino-store';
import { Homes } from '../server/homes';
import { setPriceIndexForTest } from '../server/price-index';
import { properties } from '../shared/realEstate';
import { FURNITURE, FURN_BY_ID, canVisit, fits, validateLayout, isHomeProperty, shopItem, GRID_W } from '../shared/homes';
import { SINK_DEBIT_GAMES } from '../shared/sinkRoom';
import { landmarks } from '../shared/worldLayout';

const fund = (n: string, amt = 50_000) => getBank().transferConfirmed(n, amt, { key: `test_fund:${n}:${Math.random()}`, game: 'admin' });
const [H1, H2] = properties().filter(isHomeProperty).map((p) => p.id);

describe('homes rules', () => {
  it('catalog is sane', () => { expect(FURNITURE.length).toBeGreaterThanOrEqual(25); expect(new Set(FURNITURE.map((f) => f.id)).size).toBe(FURNITURE.length); for (const f of FURNITURE) if (!f.auction) expect(f.price).toBeGreaterThan(0); else expect(f.price).toBe(0); });
  it('fits checks bounds and overlap; rugs only clash with rugs', () => {
    const a = { uid: 'a', f: 'sofa', x: 0, z: 0, r: 0 };
    expect(fits([], a)).toBe(true); expect(fits([], { ...a, x: GRID_W - 2 })).toBe(false);
    expect(fits([a], { uid: 'b', f: 'stool', x: 1, z: 0, r: 0 })).toBe(false);
    expect(fits([a], { uid: 'c', f: 'rug', x: 0, z: 0, r: 0 })).toBe(true);
    expect(fits([a], { ...a, r: 1 }, 'a')).toBe(true);
  });
  it('validateLayout enforces inventory and owned styles', () => {
    const inv = new Map([['sofa', 1]]); const it1 = { uid: 'a', f: 'sofa', x: 0, z: 0, r: 0 };
    expect(validateLayout({ wall: 'plaster', floor: 'laminate', items: [it1] }, inv, () => false).ok).toBe(true);
    expect(validateLayout({ wall: 'plaster', floor: 'laminate', items: [it1, { ...it1, uid: 'b', z: 3 }] }, inv, () => false).ok).toBe(false);
    expect(validateLayout({ wall: 'gold', floor: 'laminate', items: [] }, inv, () => false).ok).toBe(false);
    expect(validateLayout({ wall: 'gold', floor: 'laminate', items: [] }, inv, (k) => k === 'wall:gold').ok).toBe(true);
  });
  it('access rules', () => {
    expect(canVisit('locked', ['bob'], 'Ann', 'bob')).toBe(false); expect(canVisit('locked', [], 'Ann', 'ANN')).toBe(true);
    expect(canVisit('invite', ['bob'], 'Ann', 'Bob')).toBe(true); expect(canVisit('invite', [], 'Ann', 'Bob')).toBe(false); expect(canVisit('open', [], 'Ann', 'x')).toBe(true);
  });
  it('furniture counts as house-room sink and the store is a map landmark', () => {
    expect(SINK_DEBIT_GAMES.has('furniture_buy')).toBe(true);
    expect(landmarks().furniture).toBeTruthy(); expect(shopItem('wall:plaster')?.price).toBe(0);
  });
});

describe('Homes service', () => {
  let owners: Map<string, string>;
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); owners = new Map([[H1, 'Ann'], [H2, 'Ann']]); });
  afterEach(() => setPriceIndexForTest(1));
  const mk = (pool: ConstructorParameters<typeof Homes>[0] = null) => new Homes(pool, async (id) => owners.get(id) ?? null);
  it('buys furniture, places it, frees it when the house is sold (memory)', async () => {
    const h = mk(); await expect(h.buy('Ann', 'sofa', 1)).rejects.toThrow(/Not enough chips/);
    await fund('Ann'); await h.buy('Ann', 'sofa', 1);
    expect(getBank().account('Ann').chips).toBe(START_CHIPS + 50_000 - FURN_BY_ID.get('sofa')!.price);
    const lay = { wall: 'plaster', floor: 'laminate', items: [{ uid: 's1', f: 'sofa', x: 0, z: 0, r: 0 }] };
    await h.save('Ann', H1, lay);
    await expect(h.save('Ann', H2, lay)).rejects.toThrow(/another Sofa/);
    await expect(h.save('Bob', H1, lay)).rejects.toThrow(/Only the owner/);
    owners.delete(H1); await h.save('Ann', H2, lay); // sold H1 → its sofa is free again
    owners.set(H1, 'Bob'); expect((await h.state(H1)).layout.items).toEqual([]); // the new owner gets an empty room
  });
  it('styles are one-time buys; access + invites', async () => {
    const h = mk(); await fund('Ann'); await h.buy('Ann', 'wall:navy');
    await expect(h.buy('Ann', 'wall:navy')).rejects.toThrow(/already own/);
    await expect(h.buy('Ann', 'wall:plaster')).rejects.toThrow(/free/);
    await h.save('Ann', H1, { wall: 'navy', floor: 'laminate', items: [] });
    const s = await h.setAccess('Ann', H1, 'invite', ['Bob', 'ann', 'Cy']); expect(s.invites).toEqual(['bob', 'cy']);
    expect((await h.state(H1)).layout.wall).toBe('navy');
  });
  it('writes inventory and a furniture_buy ledger row together (Postgres)', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    getBank().retryMs = []; await getBank().attach(new PgCasinoStore(pool));
    const h = mk(pool as never); await h.init(); await fund('Ann');
    await h.buy('Ann', 'stool', 3);
    expect(db.public.many(`SELECT amount FROM wallet_transactions WHERE game = 'furniture_buy'`).map((x) => Number(x.amount))).toEqual([-450]);
    expect(db.public.many('SELECT item, qty FROM home_inventory')).toEqual([{ item: 'stool', qty: 3 }]);
    await h.save('Ann', H1, { wall: 'plaster', floor: 'laminate', items: [{ uid: 'a', f: 'stool', x: 1, z: 1, r: 0 }] });
    expect((await h.locker('Ann')).items).toEqual([{ item: 'stool', qty: 3, placed: 1 }]);
  });
});

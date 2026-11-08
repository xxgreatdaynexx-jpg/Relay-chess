/** Bill Chud 1 (enacted Nov 8 2026): no purchase surcharge; zoning caps on ADDITIONAL acquisitions; grandfathered holdings kept. */
import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { setEconomyForTest } from '../server/economy';
import { resetPurchaseTaxCache } from '../server/purchase-tax';
import { setJail, type Jail } from '../server/jail';
import { properties, type Property } from '../shared/realEstate';
import { zoneOf, tilesOf, zoneUse, zoneRefusal, FARMLAND_TILE_CAP, ZONE_DEED_CAP } from '../shared/zoning';
import { LEVERS, LEVER_IDS } from '../shared/city';
import { citySurchargePctPer1k } from '../server/city-rates';
import { purchaseTaxOf } from '../shared/purchaseTax';

setJail({ isJailed: () => false, status: () => null } as unknown as Jail);
const all = [...properties()];
const of = (f: (p: Property) => boolean) => all.filter((p) => f(p) && !p.retired);
const houses = of((p) => p.type === 'house'); const commercial = of((p) => ['gas', 'depot', 'barn'].includes(p.type));
const patch = of((p) => p.kind === 'patch')[0]!; const resort = of((p) => p.map === 'resort' && p.kind === 'building')[0]!;
const byId = (id: string) => all.find((p) => p.id === id)!;

describe('classification (every catalog deed)', () => {
  it('matches the bill: residential / commercial / farmland / exempt; tiles = full cols × rows', () => {
    const z = (p: Property) => zoneOf(p);
    for (const p of all) {
      if (['house', 'rowhouse', 'apartment', 'tower'].includes(p.type) && !p.map) expect(z(p)).toBe('residential');
      else if (p.kind === 'landmark' || ['gas', 'depot', 'barn'].includes(p.type)) expect(z(p)).toBe('commercial');
      else if (p.kind === 'farm') { expect(z(p)).toBe('farmland'); const m = /\((\d+)×(\d+)\)/.exec(p.label)!; expect(tilesOf(p)).toBe(Number(m[1]) * Number(m[2])); }
      else { expect(z(p)).toBe('exempt'); expect(p.kind === 'patch' || p.map === 'resort').toBe(true); }
    }
    expect(z(byId('lm:jail'))).toBe('commercial'); expect(z(byId('lm:harbour'))).toBe('commercial');
    expect(zoneOf({ kind: 'farm', type: 'plantation', map: 'resort' })).toBe('farmland'); expect(zoneOf({ kind: 'building', type: 'mystery' })).toBe('commercial'); // fail closed
    expect(Math.max(...all.filter((p) => p.kind === 'farm').map(tilesOf))).toBeLessThanOrEqual(FARMLAND_TILE_CAP); // every single plot is buyable alone
  });
  it('boundaries: 5th deed ok, 6th refused; exactly 1,500 tiles ok, 1,501 refused; zones independent; exempt always ok', () => {
    const f = (tiles: number) => ({ kind: 'farm' as const, type: 'farmland', tiles, label: 'plot' });
    expect(zoneRefusal({ residential: 4, commercial: 5, farmlandTiles: 1500 }, houses[0]!)).toBeNull();
    expect(zoneRefusal({ residential: 5, commercial: 0, farmlandTiles: 0 }, houses[0]!)).toMatch(/already own 5 residential/);
    expect(zoneRefusal({ residential: 9, commercial: 0, farmlandTiles: 0 }, houses[0]!)).toMatch(/You keep what you own/); // grandfathered over cap
    expect(zoneRefusal({ residential: 5, commercial: 4, farmlandTiles: 0 }, commercial[0]!)).toBeNull();
    expect(zoneRefusal({ residential: 0, commercial: 0, farmlandTiles: 1400 }, f(100))).toBeNull();
    expect(zoneRefusal({ residential: 0, commercial: 0, farmlandTiles: 1400 }, f(101))).toMatch(/1,500 tiles/);
    expect(zoneRefusal({ residential: 99, commercial: 99, farmlandTiles: 9999 }, patch)).toBeNull(); expect(zoneRefusal({ residential: 99, commercial: 99, farmlandTiles: 9999 }, resort)).toBeNull();
    expect(zoneUse([houses[0]!, commercial[0]!, patch, resort, byId('cf:1000')])).toEqual({ residential: 1, commercial: 1, farmlandTiles: 900 });
    expect(ZONE_DEED_CAP).toBe(5);
  });
  it('surcharge lever abolished: hidden, no effect (history rows still parse)', () => {
    expect(LEVER_IDS).not.toContain('property_surcharge'); expect(LEVERS.property_surcharge.abolished).toBe(true); expect(citySurchargePctPer1k()).toBe(0);
  });
});

const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const drops: Array<() => Promise<void>> = []; afterAll(async () => { setEconomyForTest(null); for (const d of drops) await d(); });
describe.skipIf(!url)('enforcement on real Postgres', () => {
  async function world(instances = 1) {
    const u = new URL(url!); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('local DB only');
    const name = `zb_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`; const root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${name}`);
    u.pathname = `/${name}`; const conn = u.toString(); const setup = new pg.Pool({ connectionString: conn, max: 3 });
    const pools: pg.Pool[] = []; drops.push(async () => { for (const p of pools) await p.end(); await setup.end(); await root.query(`DROP DATABASE ${name}`); await root.end(); });
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(setup as never));
    const res: RealEstate[] = []; for (let i = 0; i < instances; i++) { const p = new pg.Pool({ connectionString: conn, max: 2, connectionTimeoutMillis: 5_000 }); pools.push(p); const re = new RealEstate(p as never, () => bank); await re.init(); res.push(re); }
    await setup.query(`CREATE TABLE IF NOT EXISTS farm_tiles (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, owner_key TEXT NOT NULL, crop TEXT NOT NULL, planted_at BIGINT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY (plot_id, tile));
      CREATE TABLE IF NOT EXISTS farm_upgrades (plot_id TEXT NOT NULL, kind TEXT NOT NULL, owner_key TEXT NOT NULL, level INTEGER NOT NULL, PRIMARY KEY (plot_id, kind));
      CREATE TABLE IF NOT EXISTS farm_fert (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, nonce TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (plot_id, tile, nonce));`);
    setEconomyForTest({ playerAssets: async () => ({ total: 0 }) } as never); resetPurchaseTaxCache();
    const fund = async (n: string, c: number) => { bank.transfer(n, c - bank.account(n).chips, { game: 'admin' }); await bank.flush(); };
    const own = async (who: string, ids: string[], price?: number) => { for (const id of ids) await setup.query('INSERT INTO properties (id, owner_key, owner_name, price, bought_at) VALUES ($1,$2,$3,$4,0)', [id, who.toLowerCase(), who, price ?? byId(id).price]); };
    const q = async (sql: string, a: unknown[] = []) => (await setup.query(sql, a)).rows;
    const ledger = async (who: string) => Number((await q("SELECT count(*) n FROM wallet_transactions WHERE player_key = $1 AND game <> 'admin'", [who.toLowerCase()]))[0].n);
    return { re: res[0]!, res, bank, fund, own, q, ledger };
  }
  it('residential: 5th buy ok, 6th refused atomically (no charge, no deed, no ledger row); commercial independent', async () => {
    const w = await world(); await w.fund('Ann', 5_000_000); await w.own('Ann', houses.slice(0, 4).map((p) => p.id));
    const r5 = await w.re.buy('Ann', houses[4]!.id); expect(r5.price).toBe(houses[4]!.price); // list price: no surcharge
    const chips = w.bank.account('Ann').chips; const n = await w.ledger('Ann');
    await expect(w.re.buy('Ann', houses[5]!.id)).rejects.toThrow(/already own 5 residential.*Nothing was charged/);
    expect(w.bank.account('Ann').chips).toBe(chips); expect(await w.ledger('Ann')).toBe(n); expect(await w.q('SELECT 1 FROM properties WHERE id=$1', [houses[5]!.id])).toHaveLength(0);
    await w.re.buy('Ann', commercial[0]!.id); // no borrowing across zones
    const qq = await w.re.quote('Ann', houses[6]!.id); expect(qq.zoneRefusal).toMatch(/residential/); expect(qq.surchargePct).toBe(0); expect(qq.price).toBe(houses[6]!.price);
  }, 30_000);
  it('grandfathered over-cap holdings are kept untouched and still block more in that zone only', async () => {
    const w = await world(); await w.fund('Gus', 5_000_000); const ids = houses.slice(0, 8).map((p) => p.id); await w.own('Gus', ids, 12345);
    await expect(w.re.buy('Gus', houses[9]!.id)).rejects.toThrow(/already own 8 residential/);
    expect((await w.q('SELECT id, price FROM properties WHERE owner_key=$1 ORDER BY id', ['gus'])).map((r) => [r.id, Number(r.price)])).toEqual(ids.sort().map((id) => [id, 12345])); // paid basis unchanged
    await w.re.buy('Gus', patch.id); await w.re.buy('Gus', resort.id); // exempt
  }, 30_000);
  it('farmland counts full plot tiles: 1,476 owned + 16 ok, then over 1,500 refused', async () => {
    const w = await world(); await w.fund('Fay', 50_000_000); await w.own('Fay', ['cf:1000', 'cf:1001']); // 900 + 576
    const small = of((p) => p.kind === 'farm' && tilesOf(p) === 16 && p.id.startsWith('f:'))[0]!; await w.re.buy('Fay', small.id);
    expect((await w.re.zoneUse('Fay')).farmlandTiles).toBe(1492);
    const next = of((p) => p.kind === 'farm' && tilesOf(p) > 8 && tilesOf(p) < 100 && p.id !== small.id && !/^cf:10/.test(p.id))[0]!;
    const chips = w.bank.account('Fay').chips; await expect(w.re.buy('Fay', next.id)).rejects.toThrow(/1,500 tiles.*Nothing was charged/); expect(w.bank.account('Fay').chips).toBe(chips);
  }, 30_000);
  it('concurrent buys at the cap (same instance and two instances): exactly one wins, the other is refused with no charge', async () => {
    for (const inst of [1, 2]) {
      const w = await world(inst); await w.fund('Cy', 5_000_000); await w.own('Cy', houses.slice(0, 4).map((p) => p.id));
      const before = w.bank.account('Cy').chips; const [a, b] = [houses[10]!, houses[11]!];
      const r = await Promise.allSettled([w.res[0]!.buy('Cy', a.id), w.res[inst - 1]!.buy('Cy', b.id)]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(String((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason?.message)).toMatch(/residential|another property/);
      expect((await w.re.zoneUse('Cy')).residential).toBe(5);
      const won = r[0]!.status === 'fulfilled' ? a : b; await w.bank.refresh('Cy'); expect(w.bank.account('Cy').chips).toBe(before - won.price);
    }
  }, 60_000);
  it('hostile buyout of a monument respects the commercial cap (refused, nothing charged, owner unchanged)', async () => {
    const w = await world(); await w.fund('Bo', 50_000_000); await w.own('Bo', commercial.slice(0, 5).map((p) => p.id)); await w.own('Old', ['lm:casino'], 1000);
    await expect(w.re.buyout('Bo', 'lm:casino')).rejects.toThrow(/already own 5 commercial/);
    expect((await w.q("SELECT owner_key FROM properties WHERE id='lm:casino'"))[0].owner_key).toBe('old'); expect(await w.ledger('Bo')).toBe(0);
  }, 30_000);
  it('no surcharge and no surcharge treasury share; purchase wealth tax unchanged; no refunds written for past surcharges', async () => {
    const w = await world(); await w.fund('Wes', 5_000_000); await w.own('Wes', ['lm:bank'], 200_000); // 200K property -> taxed buyer, big old surcharge basis
    for (let i = 0; i < 3; i++) await w.fund(`P${i}`, 6000);
    const p = houses[20]!; const r = await w.re.buy('Wes', p.id);
    expect(r.price).toBe(p.price); expect(r.wealthTax).toBe(purchaseTaxOf(200_000, p.price));
    expect(await w.q("SELECT 1 FROM city_treasury_ledger WHERE kind = 'property_surcharge'").catch(() => [])).toHaveLength(0);
    expect(Number((await w.q("SELECT price FROM properties WHERE id='lm:bank'"))[0].price)).toBe(200_000);
    expect(await w.q("SELECT 1 FROM wallet_transactions WHERE memo ILIKE '%refund%'")).toHaveLength(0);
  }, 30_000);
});

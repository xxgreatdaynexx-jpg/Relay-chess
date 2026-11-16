/** Empty land sells at 10% of its base price (price index still applies); sell-back can't beat the new buy price. */
import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { px, setPriceIndexForTest } from '../server/price-index';
import { estateLots } from '../shared/mapExpansion';
import { properties, propertyById, isEmptyLand, cityRefundOf, sellBackOf, EMPTY_LAND_PRICE_MUL, assessedTaxBasis } from '../shared/realEstate';
import { registerPgAdvisoryFunctions } from './pg-advisory';

const T0 = Date.parse('2026-11-01T12:00:00Z');
async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  const re = new RealEstate(pool, () => bank, () => T0); await re.init();
  await pool.query(`CREATE TABLE farm_tiles (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, owner_key TEXT NOT NULL, crop TEXT NOT NULL, planted_at BIGINT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY (plot_id, tile));
  CREATE TABLE farm_upgrades (plot_id TEXT NOT NULL, kind TEXT NOT NULL, owner_key TEXT NOT NULL, level INTEGER NOT NULL, PRIMARY KEY (plot_id, kind));
  CREATE TABLE farm_fert (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, nonce TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (plot_id, tile, nonce));`);
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  const chips = (name: string) => bank.account(name).chips;
  return { pool, bank, re, fund, chips };
}
const lot = properties().find((p) => p.type === 'lot' && !p.retired)!;
const estate = properties().find((p) => p.id === 'lot:estate:7')!;

describe('empty land price', () => {
  it('is 10% of the base for city empty lots and open East Estates lots only', () => {
    expect(EMPTY_LAND_PRICE_MUL).toBe(0.1);
    expect(lot.price).toBe(700); // 7,000 base before the cut
    for (const l of estateLots()) {
      const p = propertyById(`lot:estate:${l.n}`)!;
      if (l.kind === 'open') { expect(isEmptyLand(p)).toBe(true); expect(p.price).toBe(Math.round(l.price * 0.1)); }
      else { expect(isEmptyLand(p)).toBe(false); expect(p.price).toBe(l.price); } // turnkey plants come with a plant
    }
    for (const p of properties()) if (['park', 'plaza'].includes(p.type) || p.kind !== 'patch') expect(isEmptyLand(p)).toBe(false);
  });
  it('estate lot property tax stays on the ordinary land assessment', () => {
    expect(assessedTaxBasis(estate.price, estate.price, estate)).toBe(47_500);
  });
  it('the price index still applies on top of the cut', async () => {
    setPriceIndexForTest(1.4675);
    try {
      const s = await setup();
      const q = await s.re.quote('Ann', lot.id);
      expect(q.price).toBe(px(700)); expect(q.price).toBe(1_027);
    } finally { setPriceIndexForTest(1); }
  });
});

describe('empty land sell-back', () => {
  it('new buyer: 70% of the new price, as before', async () => {
    const s = await setup(); await s.fund('Ann', lot.price); await s.re.buy('Ann', lot.id);
    await s.re.sell('Ann', lot.id); expect(s.chips('Ann')).toBe(sellBackOf(lot.price));
  });
  it('land bought at the old price keeps its paid price but cannot be sold back for more than it costs to rebuy', async () => {
    const s = await setup();
    await s.pool.query('INSERT INTO properties (id, owner_key, owner_name, price, bought_at, city_price) VALUES ($1, $2, $3, $4, $5, $4)', [lot.id, 'old', 'Old', 9_134, T0 - 1]);
    expect((await s.re.mine('Old'))[0]).toMatchObject({ id: lot.id, price: 9_134 }); // past purchase untouched
    const before = s.chips('Old'); const r = await s.re.sell('Old', lot.id);
    expect(r.chips).toBe(lot.price); expect(s.chips('Old') - before).toBe(lot.price); // not 6,393 (70% of 9,134)
    await s.re.buy('Old', lot.id); expect(s.chips('Old')).toBe(before); // rebuying costs exactly what the sale paid: no loop
  });
  it('cityRefundOf: other property is unchanged', () => {
    const house = properties().find((p) => p.type === 'house')!;
    expect(cityRefundOf(10_000, null, house, 100)).toBe(7_000);
    expect(cityRefundOf(10_000, 8_000, house, 100)).toBe(5_600);
    expect(cityRefundOf(9_134, 9_134, lot, 1_027)).toBe(1_027);
    expect(cityRefundOf(700, 700, lot, 1_027)).toBe(sellBackOf(700));
  });
});

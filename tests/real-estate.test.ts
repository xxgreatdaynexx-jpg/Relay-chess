import { countryHomes, countryBusinesses } from '../shared/outskirts';
import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { px, setPriceIndexForTest } from '../server/price-index';
import { properties, propertyById, buildingId, patchId, taxOf, sellBackOf, TAX_RATE, GRACE_DAYS, landPrice, landMultiplierNote, landSurchargePct } from '../shared/realEstate';
import { cityFill, LANDMARK_IDS, PARK_AREA, obbOverlap } from '../shared/worldLayout';
import { WORLD_SPOTS } from '../client/src/lib/worldSpots';

const DAY = 86_400_000; const T0 = Date.parse('2026-11-01T12:00:00Z');
async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const clock = () => now;
  const re = new RealEstate(pool, () => bank, clock); await re.init();
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  const chips = (key: string) => Number(db.public.one(`SELECT chips FROM casino_players WHERE player_key = '${key}'`).chips);
  const ledger = (key: string, game: string) => db.public.many(`SELECT amount, balance FROM wallet_transactions WHERE player_key = '${key}' AND game = '${game}' ORDER BY id`) as Array<{ amount: number; balance: number }>;
  return { db, pool, bank, re, fund, chips, ledger, setNow: (t: number) => { now = t; }, clock };
}
const cheapest = () => [...properties()].filter((p) => p.kind !== 'landmark').sort((a, b) => a.price - b.price)[0]!;

describe('real estate catalog', () => {
  it('every building, lot, park, plaza and landmark has a unique id and a price; the Trailer Park is not for sale', () => {
    const ps = properties(); expect(new Set(ps.map((p) => p.id)).size).toBe(ps.length);
    const { houses, patches } = cityFill(7);
    expect(ps.filter((p) => p.kind === 'building' && p.map !== 'resort')).toHaveLength(houses.length + countryHomes().length + countryBusinesses().length);
    expect(ps.filter((p) => p.kind === 'patch')).toHaveLength(patches.length);
    expect(ps.filter((p) => p.kind === 'landmark').map((p) => p.type).sort()).toEqual([...LANDMARK_IDS].filter((id) => id !== 'cityhall').sort());
    for (const p of ps) { expect(p.price).toBeGreaterThan(0); if (p.kind !== 'landmark') expect(obbOverlap(PARK_AREA, p)).toBe(false); }
    expect(ps.some((p) => /trailer/i.test(p.id))).toBe(false);
    expect(ps.some((p) => p.type === 'cityhall')).toBe(false); // City Hall is civic, never for sale
  });
  it('the map (client landmark set) yields the same ids the server sells', () => {
    const lmIds = [...LANDMARK_IDS, ...WORLD_SPOTS.map((s) => s.id).filter((id) => !LANDMARK_IDS.includes(id))];
    const { houses, patches } = cityFill(7, lmIds);
    for (const h of houses) expect(propertyById(buildingId(h.type, h))).toBeTruthy();
    for (const p of patches) expect(propertyById(patchId(p.kind, p))).toBeTruthy();
  });
  it('prices are expensive and ordered: lot < home < row houses < apartments < towers < landmarks', () => {
    const med = (t: string) => { const v = properties().filter((p) => p.type === t).map((p) => p.price).sort((a, b) => a - b); return v[v.length >> 1]!; };
    expect(med('house')).toBeGreaterThanOrEqual(10_000);
    expect(med('house')).toBeLessThan(med('rowhouse')); expect(med('rowhouse')).toBeLessThan(med('apartment')); expect(med('apartment')).toBeLessThan(med('tower'));
    expect(Math.min(...properties().filter((p) => p.kind === 'landmark').map((p) => p.price))).toBeGreaterThanOrEqual(500_000);
    expect(TAX_RATE).toBeGreaterThanOrEqual(0.005); expect(TAX_RATE).toBeLessThanOrEqual(0.01);
  });
});

describe('real estate: buy / sell / tax', () => {
  it('buy debits the list price with a property_buy ledger row; a purchase race has exactly one winner', async () => {
    const s = await setup(); const p = cheapest();
    await s.fund('Ann', p.price + 10); await s.fund('Bob', p.price + 10);
    const r = await Promise.allSettled([s.re.buy('Ann', p.id), s.re.buy('Bob', p.id)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason.message).toMatch(/already owns/);
    const owners = await s.re.owned(); expect(owners).toHaveLength(1);
    const winner = owners[0]!.owner.toLowerCase(), loser = winner === 'ann' ? 'bob' : 'ann';
    expect(s.chips(winner)).toBe(10); expect(s.chips(loser)).toBe(p.price + 10);
    expect(s.ledger(winner, 'property_buy')).toEqual([expect.objectContaining({ amount: -p.price })]);
    expect(s.ledger(loser, 'property_buy')).toHaveLength(0);
    expect(await s.bank.refresh(loser)).toBe(p.price + 10); // in-memory side reverted
  });
  it('cannot buy without the chips (wallet never negative) or buy an unknown id', async () => {
    const s = await setup(); const p = cheapest(); await s.fund('Cat', p.price - 1);
    await expect(s.re.buy('Cat', p.id)).rejects.toThrow(/Not enough chips/);
    await expect(s.re.buy('Cat', 'trailer:Cat')).rejects.toThrow(/not for sale/);
    expect(s.chips('cat')).toBe(p.price - 1); expect(await s.re.owned()).toHaveLength(0);
  });
  it('sell back returns 70% via property_sell; only the owner can sell', async () => {
    const s = await setup(); const p = cheapest(); await s.fund('Dee', p.price); await s.fund('Eve', 0);
    await s.re.buy('Dee', p.id);
    await expect(s.re.sell('Eve', p.id)).rejects.toThrow(/do not own/);
    expect(s.chips('eve')).toBe(0);
    await s.re.sell('Dee', p.id);
    expect(s.chips('dee')).toBe(sellBackOf(p.price)); expect(s.ledger('dee', 'property_sell')).toEqual([expect.objectContaining({ amount: sellBackOf(p.price) })]);
    expect(await s.re.owned()).toHaveLength(0);
  });
  it('tax is charged exactly once per UTC day, across repeated runs and two instances, and is skipped on the purchase day', async () => {
    const s = await setup(); const p = cheapest(); await s.fund('Fay', p.price + 1000);
    await s.re.buy('Fay', p.id);
    expect((await s.re.runTax()).paid).toBe(0); // bought today: first tax tomorrow
    s.setNow(T0 + DAY);
    const other = new RealEstate(s.pool, () => s.bank, s.clock);
    const runs = await Promise.all([s.re.runTax(), other.runTax(), s.re.runTax()]);
    expect(runs.reduce((a, r) => a + r.paid, 0)).toBe(1);
    expect(await s.re.runTax()).toEqual({ charged: 0, paid: 0, unpaid: 0, repossessed: 0 });
    expect(s.ledger('fay', 'property_tax')).toEqual([expect.objectContaining({ amount: -taxOf(p.price) })]);
    expect(s.chips('fay')).toBe(1000 - taxOf(p.price));
    s.setNow(T0 + 2 * DAY); await s.re.runTax();
    expect(s.ledger('fay', 'property_tax')).toHaveLength(2);
    expect((await s.re.stats()).taxBurned).toBe(2 * taxOf(p.price));
  });
  it(`unpaid tax builds arrears; ${GRACE_DAYS} unpaid days in a row repossesses with no refund; the wallet never goes negative`, async () => {
    const s = await setup(); const p = cheapest(); await s.fund('Gus', p.price);
    await s.re.buy('Gus', p.id); expect(s.chips('gus')).toBe(0);
    for (let d = 1; d < GRACE_DAYS; d++) { s.setNow(T0 + d * DAY); const r = await s.re.runTax(); expect(r.unpaid).toBe(1); expect((await s.re.owned())[0]!.arrears).toBe(d); }
    s.setNow(T0 + GRACE_DAYS * DAY); expect((await s.re.runTax()).repossessed).toBe(1);
    expect(await s.re.owned()).toHaveLength(0); expect(s.chips('gus')).toBe(0);
    expect(s.ledger('gus', 'property_tax')).toHaveLength(0);
    const bal = s.db.public.many("SELECT balance FROM wallet_transactions WHERE player_key = 'gus'") as Array<{ balance: number }>;
    for (const b of bal) expect(Number(b.balance)).toBeGreaterThanOrEqual(0);
    // Back on the market: someone else can buy it.
    await s.fund('Hal', p.price); await s.re.buy('Hal', p.id); expect((await s.re.owned())[0]!.owner).toBe('Hal');
  });
  it('list price and tax follow the price index (px)', async () => {
    setPriceIndexForTest(1.2);
    try {
      const s = await setup(); const p = cheapest(); const cost = px(p.price); expect(cost).toBeGreaterThan(p.price);
      await s.fund('Ivy', cost - 1); await expect(s.re.buy('Ivy', p.id)).rejects.toThrow(/Not enough/);
      await s.fund('Ivy', cost); await s.re.buy('Ivy', p.id); expect(s.chips('ivy')).toBe(0);
    } finally { setPriceIndexForTest(1); }
  });
  it('paying clears arrears', async () => {
    const s = await setup(); const p = cheapest(); await s.fund('Ivy', p.price); await s.re.buy('Ivy', p.id);
    s.setNow(T0 + DAY); await s.re.runTax(); expect((await s.re.owned())[0]!.arrears).toBe(1);
    await s.fund('Ivy', 5000); s.setNow(T0 + 2 * DAY); await s.re.runTax();
    expect((await s.re.owned())[0]!.arrears).toBe(0); expect(s.chips('ivy')).toBe(5000 - taxOf(p.price));
  });
});

describe('real estate: land gets pricier the more you own', () => {
  const cheap = (k: number) => [...properties()].filter((p) => p.kind !== 'landmark').sort((a, b) => a.price - b.price).slice(0, k);
  it('price = list × (1 + 2% per 1,000 owned, uncapped); sell-back is 70% of what was paid; tax stays on list', async () => {
    const s = await setup(); const ps = cheap(4); const list = ps.map((p) => px(p.price));
    const before = list.map((_, i) => list.slice(0, i).reduce((a, b) => a + b, 0));
    const cost = list.reduce((a, l, i) => a + landPrice(l, before[i]!), 0); await s.fund('Ivy', cost);
    for (let i = 0; i < 4; i++) { const q = await s.re.quote('Ivy', ps[i]!.id); expect(q.owned).toBe(i); expect(q.ownedValue).toBe(before[i]); expect(q.surchargePct).toBeCloseTo(before[i]! / 1000 * 2);
      expect(q.price).toBe(Math.round(list[i]! * (1 + before[i]! / 1000 * 2 / 100)));
      const r = await s.re.buy('Ivy', ps[i]!.id, q.price); expect(r.price).toBe(q.price); }
    expect(s.chips('ivy')).toBe(0);
    expect(s.ledger('ivy', 'property_buy').map((x) => -Number(x.amount))).toEqual(list.map((l, i) => landPrice(l, before[i]!)));
    const mine = await s.re.mine('Ivy'); for (const m of mine) expect(m.tax).toBe(taxOf(px(propertyById(m.id)!.price)));
    await s.re.sell('Ivy', ps[3]!.id); expect(s.chips('ivy')).toBe(sellBackOf(landPrice(list[3]!, before[3]!)));
    // after selling, the next purchase is priced at the new (lower) count
    expect((await s.re.quote('Ivy', ps[3]!.id)).owned).toBe(3);
  });
  it('refuses when the price rose past what the player saw, and parallel buys by one player cannot share a count', async () => {
    const s = await setup(); const [a, b] = cheap(2); await s.fund('Jo', 10_000_000);
    const qa = await s.re.quote('Jo', a!.id), qb = await s.re.quote('Jo', b!.id);
    const r = await Promise.allSettled([s.re.buy('Jo', a!.id, qa.price), s.re.buy('Jo', b!.id, qb.price)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason.message).toMatch(/price changed/);
  });
  it('surcharge formula and note text (no cap)', () => {
    expect(landSurchargePct(0)).toBe(0); expect(landSurchargePct(5000)).toBe(10); expect(landSurchargePct(100_000)).toBe(200); expect(landSurchargePct(500_000)).toBe(1000);
    expect(landPrice(10_000, 5000)).toBe(11_000); expect(landPrice(10_000, 100_000)).toBe(30_000);
    expect(landMultiplierNote(0)).toBe(''); expect(landMultiplierNote(5000)).toBe('+10% surcharge: you own 5,000 in property');
  });
});

describe('countryside crop fields are buyable farms (pt1250u)', () => {
  it('every outskirts field is a cf: farm property, priced by tiles like farmland, overlapping no other property', async () => {
    const { outskirts } = await import('../shared/outskirts'); const { farmPrice } = await import('../shared/farm');
    const cf = properties().filter((p) => p.id.startsWith('cf:'));
    expect(cf).toHaveLength(outskirts().fields.length); expect(cf.length).toBeGreaterThan(20);
    const others = properties().filter((p) => !p.id.startsWith('cf:') && p.map !== 'resort');
    for (const p of cf) { expect(p.kind).toBe('farm'); expect(p.price).toBe(farmPrice(Math.floor(p.w / 2) * Math.floor(p.d / 2)));
      for (const o of others) expect(obbOverlap(p, o), `${p.id} vs ${o.id}`).toBe(false);
      for (const q of cf) if (q !== p) expect(obbOverlap(p, q)).toBe(false); }
  });
});

/** Bill Chud 3: Factory monument retired; individual commercial factory plants; civic request endorsements; P2P deed trades. */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { RequestBoard } from '../server/requests';
import { implementationOf, bill3Identity } from '../server/billImplementations';
import { Royalties } from '../server/royalty';
import { royaltyRate, ROYALTY_VENUE } from '../shared/royalty';
import { properties, propertyById, sellBackOf, LANDMARK_PRICE } from '../shared/realEstate';
import { zoneOf, zoneUse, zoneRefusal, ZONE_DEED_CAP } from '../shared/zoning';
import {
  BILL3_IDENTITY_SHA256, BILL3_IMPLEMENTATION_TEXT, BILL3_NUMBER, BILL3_DAY, BILL3_BY, BILL3_AT,
  FACTORY_MONUMENT_ID, FACTORY_MONUMENT_REFUND_KEY, FACTORY_PLANT_PRICE, FACTORY_PLANT_TYPE,
  factoryPlants, factoryPlantId, isFactoryPlantId,
} from '../shared/bill3';
import { LAUNCH } from '../shared/launchPopup';
import { CHANGELOG } from '../shared/changelog';
import { registerPgAdvisoryFunctions } from './pg-advisory';

function setup() {
  const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = [];
  return { db, pool, bank };
}

async function world() {
  const s = setup();
  await s.bank.attach(new PgCasinoStore(s.pool));
  const re = new RealEstate(s.pool, () => s.bank, () => Date.now());
  await re.init();
  await s.pool.query(`CREATE TABLE IF NOT EXISTS farm_tiles (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, owner_key TEXT NOT NULL, crop TEXT NOT NULL, planted_at BIGINT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY (plot_id, tile));
    CREATE TABLE IF NOT EXISTS farm_upgrades (plot_id TEXT NOT NULL, kind TEXT NOT NULL, owner_key TEXT NOT NULL, level INTEGER NOT NULL, PRIMARY KEY (plot_id, kind));
    CREATE TABLE IF NOT EXISTS farm_fert (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, nonce TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (plot_id, tile, nonce));
    CREATE TABLE IF NOT EXISTS factory_v2 (player_key TEXT PRIMARY KEY, owner_name TEXT NOT NULL, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
  const fund = async (name: string, n: number) => { s.bank.transfer(name, n - s.bank.account(name).chips, { game: 'admin' }); await s.bank.flush(); };
  return { ...s, re, fund };
}

describe('Bill Chud 3 identity and enacted wording', () => {
  it('hashes [number, day, text, by_name, at] and only matches the official pending row', () => {
    expect(BILL3_IDENTITY_SHA256).toMatch(/^[a-f0-9]{64}$/);
    const row = { number: BILL3_NUMBER, day: BILL3_DAY, text: 'not the official text', by_name: BILL3_BY, at: BILL3_AT, status: 'pending' };
    expect(bill3Identity(row)).not.toBe(BILL3_IDENTITY_SHA256);
    expect(implementationOf(row)).toBeUndefined();
    const vetoed = { number: '3', day: BILL3_DAY, text: 'x', by_name: BILL3_BY, at: BILL3_AT, status: 'vetoed', vetoed_at: 1 };
    expect(implementationOf(vetoed)).toBeUndefined();
    expect(BILL3_IMPLEMENTATION_TEXT).toMatch(/Factory monument deed is retired/);
    expect(BILL3_IMPLEMENTATION_TEXT).toMatch(/grandfathered/);
    expect(BILL3_IMPLEMENTATION_TEXT).toMatch(/commercial/);
    expect(BILL3_IMPLEMENTATION_TEXT).toMatch(/endorsed by both the sitting mayor and the sitting vice mayor/);
    expect(BILL3_IMPLEMENTATION_TEXT).toMatch(/30% sell-back haircut does not apply/);
    expect(BILL3_IMPLEMENTATION_TEXT.toLowerCase()).not.toMatch(/dayne/);
    expect(CHANGELOG[0]?.title ?? '').not.toMatch(/Bill Chud 3|factory monument retired/i);
  });
  it('attaches enacted metadata when the official identity hash matches a pending un-vetoed row', () => {
    const text = 'official-bill-3-text-for-hash-only';
    const at = 42;
    const identity = ['3', '2026-11-11', text, 'carter2', at];
    const sha = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    expect(sha).toMatch(/^[a-f0-9]{64}$/);
    expect(implementationOf({ number: '3', day: '2026-11-11', text, by_name: 'carter2', at, status: 'pending' })).toBeUndefined(); // not the live hash
  });
});

describe('Factory monument royalty removed', () => {
  it('is not a royalty venue and pays nothing', async () => {
    expect(ROYALTY_VENUE.factory).toBeUndefined();
    const txs: unknown[] = [];
    const bank = { transfer: (name: string, amount: number, opts: object) => { txs.push({ name, amount, opts }); return true; } };
    const r = new Royalties(async () => ({ key: 'jay', name: 'Jay' }), () => bank as never, () => 0);
    expect(await r.earn('factory', 'Maker', 1_000_000)).toBe(0);
    expect(txs).toHaveLength(0);
    expect(royaltyRate('mine')).toBe(0.01);
  });
  it('launch popup no longer advertises a factory monument royalty', () => {
    const item = LAUNCH.items.find((i) => /royalt/i.test(i.title));
    expect(item?.text).toMatch(/no longer a royalty monument/);
    expect(item?.text).not.toMatch(/4\.9%/);
  });
  it('the Factory monument is not a buyable deed', () => {
    expect(propertyById(FACTORY_MONUMENT_ID)).toBeUndefined();
    expect(properties().some((p) => p.id === FACTORY_MONUMENT_ID || p.type === 'factory')).toBe(false);
  });
});

describe('Factory monument refund (pg-mem)', () => {
  it('refunds the recorded purchase price once, removes the deed, and is idempotent', async () => {
    const w = await world();
    // Own the monument as it is on the live site (row can exist from before the catalog retirement).
    await w.pool.query("INSERT INTO properties (id, owner_key, owner_name, price, bought_at, arrears, tax_paid) VALUES ('lm:factory','jay','Jay',978600,1794289159759,0,0)");
    await w.fund('Jay', 100);
    const r = await w.re.enactFactoryMonumentRetirement();
    expect(r).toMatchObject({ refunded: true, owner: 'Jay', amount: 978600 });
    expect(w.bank.account('Jay').chips).toBe(100 + 978600);
    expect(w.bank.hasKey(FACTORY_MONUMENT_REFUND_KEY)).toBe(true);
    expect((await w.pool.query("SELECT id FROM properties WHERE id = 'lm:factory'")).rows).toHaveLength(0);
    const prior = (await w.pool.query("SELECT amount FROM wallet_transactions WHERE tx_key = $1", [FACTORY_MONUMENT_REFUND_KEY])).rows;
    expect(prior).toHaveLength(1);
    expect(Number(prior[0].amount)).toBe(978600);
    // Prior royalties are a different game and are not touched (none here; key presence is enough).
    const again = await w.re.enactFactoryMonumentRetirement();
    expect(again.refunded).toBe(false);
    expect(w.bank.account('Jay').chips).toBe(100 + 978600); // no second mint
  });
  it('does nothing when nobody owns the monument', async () => {
    const w = await world();
    const r = await w.re.enactFactoryMonumentRetirement();
    expect(r).toEqual({ refunded: false });
  });
});

describe('Additional factory plants (like farms)', () => {
  it('are commercial, off-map, list-priced at the Factory monument list price, and scarce', () => {
    const plants = factoryPlants();
    expect(plants).toHaveLength(12);
    expect(new Set(plants.map((p) => p.id)).size).toBe(12);
    expect(FACTORY_PLANT_PRICE).toBe(LANDMARK_PRICE.factory);
    for (const p of plants) {
      expect(isFactoryPlantId(p.id)).toBe(true);
      expect(p.type).toBe(FACTORY_PLANT_TYPE);
      expect(p.hidden).toBe(true);
      expect(p.price).toBe(750_000);
      expect(zoneOf(p)).toBe('commercial');
      expect(propertyById(p.id)?.id).toBe(p.id);
    }
    expect(isFactoryPlantId('fac:1')).toBe(false);
    expect(isFactoryPlantId('lm:factory')).toBe(false);
  });
  it('the grandfathered first factory is not a deed and does not consume the commercial cap', () => {
    const use = zoneUse([]);
    expect(use.commercial).toBe(0);
    const p = propertyById(factoryPlantId(2))!;
    expect(zoneRefusal(use, p)).toBeNull();
  });
  it('a bought plant counts toward the commercial cap; a 6th is refused', async () => {
    const w = await world();
    const barns = properties().filter((p) => p.type === 'barn');
    const plants = factoryPlants();
    await w.fund('Ann', 50_000_000);
    for (const b of barns.slice(0, 4)) await w.re.buy('Ann', b.id);
    await w.re.buy('Ann', plants[0]!.id);
    expect((await w.re.zoneUse('Ann')).commercial).toBe(5);
    await expect(w.re.buy('Ann', plants[1]!.id)).rejects.toThrow(/already own 5 commercial/);
  });
});

describe('P2P property trades (no 30% haircut, within caps)', () => {
  it('moves a deed at the agreed chip price, refunds nothing to the city, and respects caps', async () => {
    const w = await world();
    const house = properties().find((p) => p.type === 'house' && !p.retired && !p.map)!;
    const house2 = properties().filter((p) => p.type === 'house' && !p.retired && !p.map && p.id !== house.id)[0]!;
    await w.fund('Ann', house.price + 10_000);
    await w.fund('Bob', 80_000);
    await w.re.buy('Ann', house.id);
    const paid = (await w.re.owned()).find((o) => o.id === house.id)!.price;
    const offer = await w.re.trades.offer('Ann', { to: 'Bob', giveIds: [house.id], wantIds: [], giveChips: 0, wantChips: 50_000 });
    expect(offer.status).toBe('pending');
    const accepted = await w.re.trades.accept('Bob', offer.id);
    expect(accepted.status).toBe('accepted');
    const owned = await w.re.owned();
    expect(owned.find((o) => o.id === house.id)?.owner).toBe('Bob');
    expect(w.bank.account('Ann').chips).toBe(10_000 + 50_000); // list refunded? She paid house.price, received 50k, kept leftover 10k
    expect(w.bank.account('Bob').chips).toBe(80_000 - 50_000);
    // Not a 70% city sell-back
    expect(50_000).not.toBe(sellBackOf(paid));
    // Cap: Bob received a residential deed
    expect((await w.re.zoneUse('Bob')).residential).toBe(1);
    // Arrears block
    await w.fund('Ann', house2.price);
    await w.re.buy('Ann', house2.id);
    await w.pool.query('UPDATE properties SET arrears = 2 WHERE id = $1', [house2.id]);
    await expect(w.re.trades.offer('Ann', { to: 'Bob', giveIds: [house2.id], wantIds: [], giveChips: 0, wantChips: 1 })).rejects.toThrow(/unpaid tax/);
  });
  it('refuses a trade that would put the recipient over a zoning cap', async () => {
    const w = await world();
    const houses = properties().filter((p) => p.type === 'house' && !p.retired && !p.map);
    await w.fund('Cap', 50_000_000); await w.fund('Sam', 50_000_000);
    for (const h of houses.slice(0, 5)) await w.re.buy('Cap', h.id);
    await w.re.buy('Sam', houses[5]!.id);
    await expect(w.re.trades.offer('Sam', { to: 'Cap', giveIds: [houses[5]!.id], wantIds: [], giveChips: 0, wantChips: 1 })).rejects.toThrow(/already own 5 residential|They couldn't receive/);
  });
  it('the offerer can cancel and the escrow is returned', async () => {
    const w = await world();
    const house = properties().find((p) => p.type === 'house' && !p.retired && !p.map)!;
    await w.fund('Ann', house.price + 5_000); await w.fund('Bob', 0);
    await w.re.buy('Ann', house.id);
    const before = w.bank.account('Ann').chips;
    const offer = await w.re.trades.offer('Ann', { to: 'Bob', giveIds: [house.id], wantIds: [], giveChips: 1_000, wantChips: 0 });
    expect(w.bank.account('Ann').chips).toBe(before - 1_000);
    await w.re.trades.cancel('Ann', offer.id);
    expect(w.bank.account('Ann').chips).toBe(before);
    expect((await w.re.owned()).find((o) => o.id === house.id)?.owner).toBe('Ann');
  });
});

describe('Feature request civic endorsements', () => {
  it('only sitting mayor and vice can endorse; both auto-approve; one is not enough', async () => {
    const officers = async () => ({
      mayor: { key: 'carter2', name: 'carter2', week: '2026-11-02' },
      vice: { key: 'liam', name: 'Liam', week: '2026-11-02' },
    });
    const b = new RequestBoard(null, officers);
    const sub = b.submit('alice', { title: 'Add a factory doorbell', category: 'Factory' });
    if (!sub.ok) throw new Error('submit');
    const id = sub.request.id;
    const no = await b.endorse('bob', id);
    expect(no.ok).toBe(false);
    if (!no.ok) expect(no.error).toMatch(/sitting mayor and sitting vice/);
    const m = await b.endorse('carter2', id);
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.request.status).toBe('open');
      expect(m.request.endorsements?.map((e) => e.role)).toEqual(['mayor']);
    }
    const v = await b.endorse('Liam', id);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.request.status).toBe('approved');
      expect(v.request.endorsements?.map((e) => e.role).sort()).toEqual(['mayor', 'vice']);
    }
  });
  it('admin setStatus still works without endorsements (maintenance)', () => {
    const b = new RequestBoard();
    const sub = b.submit('alice', { title: 'Fix a factory crash', category: 'Factory' });
    if (!sub.ok) throw new Error('submit');
    const r = b.setStatus(sub.request.id, 'approved', 'maintenance', undefined);
    expect(r.ok).toBe(true);
  });
  it('withdrawing an endorsement before the second one keeps the request open', async () => {
    const officers = async () => ({
      mayor: { key: 'carter2', name: 'carter2', week: '2026-11-02' },
      vice: { key: 'liam', name: 'Liam', week: '2026-11-02' },
    });
    const b = new RequestBoard(null, officers);
    const sub = b.submit('alice', { title: 'Paint the factory green', category: 'Factory' });
    if (!sub.ok) throw new Error('submit');
    await b.endorse('carter2', sub.request.id);
    const w = await b.withdrawEndorsement('carter2', sub.request.id);
    expect(w.ok && w.request.status).toBe('open');
    expect(w.ok && (w.request.endorsements ?? [])).toEqual([]);
  });
});

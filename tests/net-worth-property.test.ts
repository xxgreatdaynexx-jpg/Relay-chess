import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Farm } from '../server/farm';
import { farmPlots, cropById } from './farm-helpers';
import { propertyById } from '../shared/realEstate';
import { propertyPaid, propertyWorth, upgradeSpendFromLevels } from '../shared/netWorth';
import { upgradePrice } from '../shared/farmUpgrades';
import { fertCost, fertDef } from '../shared/farmWork';

describe('net worth: property at total spent (shared propertyWorth)', () => {
  it('pure helper: paid (list only if unknown) + upgrades + planted seed, never negative parts', () => {
    expect(propertyPaid(7000, 5000)).toBe(7000); expect(propertyPaid(0, 5000)).toBe(5000); expect(propertyPaid(null, 5000)).toBe(5000);
    expect(propertyWorth({ paid: 7000, list: 5000 })).toBe(7000);
    expect(propertyWorth({ paid: 7000, list: 99_999, upgrades: 650, crops: 40 })).toBe(7690);
    expect(propertyWorth({ paid: 7000, list: 5000, upgrades: -5, crops: -1 })).toBe(7000);
    expect(upgradeSpendFromLevels({ sprinkler: 2, fertilizer: 0 }, (k, l) => upgradePrice(k as 'sprinkler', l, 16))).toBe(upgradePrice('sprinkler', 0, 16)! + upgradePrice('sprinkler', 1, 16)!);
  });
  it('mine() and playerValue() count paid + upgrades bought + planted seeds + fertilizer; a list-price change does not move it', async () => {
    const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db);
    db.public.registerFunction({ name: 'to_timestamp', args: ['float' as never], returns: 'timestamptz' as never, implementation: (n: number) => new Date(n * 1000) }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    const clock = () => Date.parse('2026-11-01T12:00:00Z');
    const re = new RealEstate(pool, () => bank, clock); await re.init();
    const farm = new Farm(pool, () => bank, clock); await farm.init();
    const small = farmPlots().find((p) => p.cols * p.rows === 16)!; const id = `f:${small.n}`; const plot = propertyById(id)!;
    bank.transfer('Gus', plot.price * 3 + 50_000, { game: 'admin' }); await bank.flush();
    await re.buy('Gus', id);
    const paid = (await re.mine('Gus'))[0]!.paid;
    expect((await re.mine('Gus'))[0]!.value).toBe(paid);
    const up = await farm.buyUpgrade('Gus', id, 'sprinkler');
    await farm.plow('Gus', id, [0, 1, 2]); await farm.plant('Gus', id, 'wheat', [0, 1, 2]);
    await farm.fertilize('Gus', id, 'compost', [0]); // fertilizer on the current planting counts too
    const seeds = cropById('wheat')!.seed * 3 + fertCost(fertDef('compost')!, cropById('wheat')!.sell); // price index 1 in tests
    await pool.query("UPDATE wallet_transactions SET created_at = now() WHERE game = 'farm_upgrade'");
    const m = (await re.mine('Gus'))[0]!;
    expect(m.upgradeSpend).toBe(up.cost); expect(m.cropValue).toBe(seeds);
    expect(m.value).toBe(paid + up.cost + seeds);
    expect(await re.playerValue()).toEqual({ n: 1, value: paid + up.cost + seeds });
  });
});

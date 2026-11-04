import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Farm, fertChargeField, layoutRefundCovers } from '../server/farm';

describe('retired Fertilizer upgrade refund (launch migration)', () => {
  it('pays back exactly what each player paid, once, across reboots', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    bank.transfer('Gus', 10_000, { game: 'admin' });
    bank.transfer('Gus', -1_500, { game: 'farm_upgrade', memo: 'Farm f:3: Fertilizer level 1' });
    bank.transfer('Gus', -3_000, { game: 'farm_upgrade', memo: 'Farm f:3: Fertilizer level 2' });
    bank.transfer('Gus', -800, { game: 'farm_upgrade', memo: 'Farm f:3: Sprinklers level 1' });
    await bank.flush();
    const before = bank.account('Gus').chips;
    const farm = new Farm(pool, () => bank); await farm.init(); await bank.flush();
    expect(bank.account('Gus').chips).toBe(before + 4_500);
    expect(await new Farm(pool, () => bank).refundOldFertilizer()).toBe(0);
    await bank.flush();
    expect(bank.account('Gus').chips).toBe(before + 4_500);
    const rows = db.public.many(`SELECT amount FROM wallet_transactions WHERE game = 'farm_fert_refund'`) as Array<{ amount: number }>;
    expect(rows.map((r) => Number(r.amount))).toEqual([4_500]);
  });

  it('skips any field the same player already got a Nov 3 "map layout fix" refund for (chessguy2 cf:28, ledger 11069)', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    bank.transfer('chessguy2', 100_000, { game: 'admin' });
    bank.transfer('Gus', 100_000, { game: 'admin' });
    // chessguy2: cf:28 fertilizer 3,442 + its full-purchase and seed layout refunds; other fields refundable
    bank.transfer('chessguy2', -3_442, { game: 'farm_upgrade', memo: 'Farm cf:28: Fertilizer level 1' });
    bank.transfer('chessguy2', 33_457, { game: 'admin_refund', key: 'admin_refund:cf28-layout-buy', memo: 'Refund cf:28 - map layout fix (full field purchase)' });
    bank.transfer('chessguy2', 7_644, { game: 'admin_refund', key: 'admin_refund:cf28-layout-seeds', memo: 'Refund cf:28 - map layout fix (seed cost of 28 sunflower tiles beyond restored 7x5 field)' });
    bank.transfer('chessguy2', -2_000, { game: 'farm_upgrade', memo: 'Farm cf:2: Fertilizer level 1' });   // cf:2 is not cf:28
    bank.transfer('chessguy2', -1_000, { game: 'farm_upgrade', memo: 'Farm f:8: Fertilizer level 1' });
    bank.transfer('chessguy2', -1_500, { game: 'farm_upgrade', memo: 'Farm f:8: Fertilizer level 2' });
    // a layout refund for cf:28 paid to someone else does not block Gus's own cf:28 fertilizer
    bank.transfer('Gus', -700, { game: 'farm_upgrade', memo: 'Farm cf:28: Fertilizer level 1' });
    // key-only match (memo without the field id) still counts
    bank.transfer('Gus', -900, { game: 'farm_upgrade', memo: 'Farm cf:27: Fertilizer level 1' });
    bank.transfer('Gus', 4_752, { game: 'admin_refund', key: 'admin_refund:cf27-layout-overflow', memo: 'Refund - map layout fix overflow tiles' });
    await bank.flush();
    const cg = bank.account('chessguy2').chips, gus = bank.account('Gus').chips;
    await new Farm(pool, () => bank).init(); await bank.flush();
    expect(bank.account('chessguy2').chips).toBe(cg + 4_500);   // cf:2 2,000 + f:8 2,500; cf:28's 3,442 not paid
    expect(bank.account('Gus').chips).toBe(gus + 700);          // cf:28 700; cf:27 skipped by key
    expect(await new Farm(pool, () => bank).refundOldFertilizer()).toBe(0);
    await bank.flush();
    expect(bank.account('chessguy2').chips).toBe(cg + 4_500);
    const rows = db.public.many(`SELECT name, amount FROM wallet_transactions WHERE game = 'farm_fert_refund' ORDER BY name`) as Array<{ name: string; amount: number }>;
    expect(rows.map((r) => [r.name, Number(r.amount)])).toEqual([['Gus', 700], ['chessguy2', 4_500]]);
  });

  it('field matching is exact', () => {
    expect(fertChargeField('Farm cf:28: Fertilizer level 1')).toBe('cf:28');
    expect(fertChargeField('Farm cf:28: Sprinklers level 1')).toBeNull();
    const r = { memo: 'Refund cf:28 - map layout fix (full field purchase)', tx_key: 'admin_refund:cf28-layout-buy' };
    expect(layoutRefundCovers(r, 'cf:28')).toBe(true);
    expect(layoutRefundCovers(r, 'cf:2')).toBe(false);
    expect(layoutRefundCovers(r, 'f:28')).toBe(false);
    expect(layoutRefundCovers({ memo: 'Refund cf:28 - goodwill', tx_key: 'admin_refund:cf28-goodwill' }, 'cf:28')).toBe(false);
  });
});

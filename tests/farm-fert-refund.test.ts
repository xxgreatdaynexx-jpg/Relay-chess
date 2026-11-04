import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Farm } from '../server/farm';

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
});

import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore, START_CHIPS, getBank, resetBank } from '../server/casino-store';
import { claimDailyBonus, dailyBonusKey, DAILY_BONUS, utcDay } from '../server/daily-bonus';
import { splitFlows } from '../server/economy';

const NOV1 = Date.UTC(2026, 10, 1, 6, 30);

describe('daily login bonus', () => {
  beforeEach(() => resetBank());

  it('uses the UTC day as the boundary', () => {
    expect(utcDay(Date.UTC(2026, 10, 1, 23, 59))).toBe('2026-11-01');
    expect(utcDay(Date.UTC(2026, 10, 2, 0, 0))).toBe('2026-11-02');
    expect(dailyBonusKey('  QA-Tess ', '2026-11-01')).toBe('daily_bonus:qa-tess:2026-11-01');
  });

  it('awards 1,000 once per day (QA accounts included), again the next day', async () => {
    const first = await claimDailyBonus('QA-Tess', NOV1);
    expect(first).toEqual({ amount: DAILY_BONUS, chips: START_CHIPS + 1000, day: '2026-11-01' });
    expect(await claimDailyBonus('qa-tess', NOV1 + 3600_000)).toBeNull();
    expect(getBank().account('QA-Tess').chips).toBe(START_CHIPS + 1000);
    expect(await claimDailyBonus('QA-Tess', NOV1 + 86_400_000)).not.toBeNull();
    expect(getBank().account('QA-Tess').chips).toBe(START_CHIPS + 2000);
  });

  it('skips while the wallet is down', async () => {
    getBank().status = 'down';
    expect(await claimDailyBonus('QA-Tess', NOV1)).toBeNull();
  });

  it('is idempotent across instances and restarts (unique ledger key in Postgres)', async () => {
    const db = newDb({ noAstCoverageCheck: true });
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const a = new CasinoBank(); a.retryMs = []; await a.attach(new PgCasinoStore(pool));
    const b = new CasinoBank(); b.retryMs = []; await b.attach(new PgCasinoStore(pool));
    const key = dailyBonusKey('QA-Tess', '2026-11-01');
    const opts = { key, game: 'daily_bonus' };
    expect(await a.transferConfirmed('QA-Tess', 1000, opts)).toBe(true);
    expect(await b.transferConfirmed('QA-Tess', 1000, opts)).toBe(false); // other instance, same day
    const c = new CasinoBank(); c.retryMs = []; await c.attach(new PgCasinoStore(pool)); // restart
    expect(await c.transferConfirmed('QA-Tess', 1000, opts)).toBe(false);
    const rows = db.public.many(`SELECT amount FROM wallet_transactions WHERE game = 'daily_bonus'`);
    expect(rows).toHaveLength(1);
    expect(Number(db.public.one(`SELECT chips FROM casino_players WHERE player_key = 'qa-tess'`).chips)).toBe(START_CHIPS + 1000);
  });

  it('counts as minted chips (a faucet), not a transfer', () => {
    const { faucets, transfers } = splitFlows([{ game: 'daily_bonus', pos: 1000, neg: 0 }]);
    expect(faucets.map((f) => f.game)).toContain('daily_bonus');
    expect(transfers).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore, START_CHIPS } from '../server/casino-store';

async function twoInstances() {
  const db = newDb({ noAstCoverageCheck: true });
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const a = new CasinoBank(); a.retryMs = [];
  await a.attach(new PgCasinoStore(pool));
  const b = new CasinoBank(); b.retryMs = [];
  await b.attach(new PgCasinoStore(pool)); // booted from the same DB, like an overlapping deploy
  return { db, pool, a, b };
}
const rows = (db: ReturnType<typeof newDb>, key: string) =>
  db.public.many(`SELECT amount, balance, tx_key FROM wallet_transactions WHERE player_key = '${key}' ORDER BY id`) as Array<{ amount: number; balance: number; tx_key: string | null }>;
const dbChips = (db: ReturnType<typeof newDb>, key: string) => Number(db.public.one(`SELECT chips FROM casino_players WHERE player_key = '${key}'`).chips);
const chains = (list: Array<{ amount: number; balance: number }>, start: number) => {
  let bal = start;
  for (const r of list) { bal += Number(r.amount); if (Number(r.balance) !== bal) return false; }
  return true;
};

describe('wallet: Postgres is the source of truth (atomic increments)', () => {
  it('two instances on one DB interleave transfers without losing updates; the ledger chains', async () => {
    const { db, a, b } = await twoInstances();
    const deltas: Array<[CasinoBank, number]> = [[a, -20], [b, -25], [a, 25], [b, -10], [a, -10], [b, 40], [a, -5], [b, -15]];
    for (const [bank, d] of deltas) { bank.transfer('QA-Tess', d, { game: 'slots' }); await new Promise((r) => setTimeout(r, 0)); }
    await Promise.all([a.flush(), b.flush()]);
    const sum = deltas.reduce((s, [, d]) => s + d, 0);
    expect(dbChips(db, 'qa-tess')).toBe(START_CHIPS + sum);
    const list = rows(db, 'qa-tess');
    expect(list).toHaveLength(deltas.length);
    expect(chains(list, START_CHIPS)).toBe(true);
    // Each cache converges to the DB once refreshed.
    expect(await a.refresh('QA-Tess')).toBe(START_CHIPS + sum);
    expect(await b.refresh('QA-Tess')).toBe(START_CHIPS + sum);
  });

  it('a new instance never writes a stale absolute balance back (no boot-time write-back)', async () => {
    const { db, a, b } = await twoInstances();
    a.transfer('QA-Tess', -300, { game: 'blackjack' }); await a.flush();
    // b still caches 1000 but its write is an increment, so a's debit survives.
    b.transfer('QA-Tess', 5, { game: 'admin', key: 'grant:x:1' }); await b.flush();
    expect(dbChips(db, 'qa-tess')).toBe(705);
    expect(b.account('QA-Tess').chips).toBe(705); // refreshed from RETURNING
    expect(chains(rows(db, 'qa-tess'), START_CHIPS)).toBe(true);
  });

  it('rejects in the DB when another instance already spent the chips (negative guard)', async () => {
    const { db, a, b } = await twoInstances();
    a.transfer('QA-Tess', -900, { game: 'slots' }); await a.flush();
    const seen: number[] = []; b.onChange((acc) => seen.push(acc.chips));
    b.transfer('QA-Tess', -500, { game: 'slots' }); // b's stale cache says 1000, so it allows it...
    await b.flush();
    expect(dbChips(db, 'qa-tess')).toBe(100); // ...but the DB refuses: never negative
    expect(b.account('QA-Tess').chips).toBe(100);
    expect(seen.at(-1)).toBe(100);
    expect(rows(db, 'qa-tess')).toHaveLength(1);
    expect(() => b.transfer('QA-Tess', -101, { game: 'slots' })).toThrow('Not enough chips.');
  });

  it('adds a chips >= 0 CHECK constraint when no row is negative', async () => {
    const { db } = await twoInstances();
    db.public.none("INSERT INTO casino_players (player_key, name, chips) VALUES ('z','Z',5)");
    expect(() => db.public.none("UPDATE casino_players SET chips = -1 WHERE player_key = 'z'")).toThrow();
  });

  it('idempotent retries: a key used on another instance is a no-op and does not double-pay', async () => {
    const { db, a, b } = await twoInstances();
    expect(a.transfer('QA-Tess', 50, { game: 'admin', key: 'grant:qa:abc' })).toBe(true);
    await a.flush();
    expect(a.transfer('QA-Tess', 50, { game: 'admin', key: 'grant:qa:abc' })).toBe(false); // same instance
    b.transfer('QA-Tess', 50, { game: 'admin', key: 'grant:qa:abc' }); // b booted before the key existed
    await b.flush();
    expect(dbChips(db, 'qa-tess')).toBe(1050);
    expect(b.account('QA-Tess').chips).toBe(1050);
    expect(rows(db, 'qa-tess')).toHaveLength(1);
  });

  it('settle increments stats atomically too', async () => {
    const { db, a, b } = await twoInstances();
    a.debit('QA-Tess', 10, 'blackjack'); a.settle('QA-Tess', 20, 10, 'hand', 'blackjack');
    b.debit('QA-Tess', 10, 'roulette'); b.settle('QA-Tess', 0, -10, 'spin', 'roulette');
    await Promise.all([a.flush(), b.flush()]);
    const r = db.public.one("SELECT chips, hands, spins, net_won, biggest_win FROM casino_players WHERE player_key = 'qa-tess'");
    expect([Number(r.chips), r.hands, r.spins, Number(r.net_won), Number(r.biggest_win)]).toEqual([1000, 1, 1, 0, 10]);
    expect(chains(rows(db, 'qa-tess'), START_CHIPS)).toBe(true);
  });

  it('transferAtomic: commits as increments in the caller transaction, and a failed transaction rolls back cleanly', async () => {
    const { db, pool, a, b } = await twoInstances();
    const run = async (stmts: Array<{ sql: string; args: unknown[] }>) => {
      const c = await pool.connect();
      try { await c.query('BEGIN'); for (const s of stmts) await c.query(s.sql, s.args); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    };
    // Successful market buy on instance a.
    const ok = a.transferAtomic([{ name: 'QA-Buyer', amount: -100, key: 'mkt:buy:1:1', game: 'market' }, { name: 'QA-Seller', amount: 95, key: 'mkt:sell:1:1', game: 'market' }]);
    await ok.after; const p1 = run(ok.stmts); ok.bind(p1); await p1; await a.flush();
    expect([dbChips(db, 'qa-buyer'), dbChips(db, 'qa-seller')]).toEqual([900, 1095]);
    expect(chains(rows(db, 'qa-buyer'), START_CHIPS) && chains(rows(db, 'qa-seller'), START_CHIPS)).toBe(true);
    // b (stale) spends most of the buyer's chips first; a's next buy must abort in the DB and revert cleanly.
    b.transfer('QA-Buyer', -850, { game: 'slots' }); await b.flush();
    const bad = a.transferAtomic([{ name: 'QA-Buyer', amount: -100, key: 'mkt:buy:1:2', game: 'market' }, { name: 'QA-Seller', amount: 95, key: 'mkt:sell:1:2', game: 'market' }]);
    await bad.after; const p2 = run(bad.stmts); bad.bind(p2);
    await expect(p2).rejects.toBeTruthy();
    bad.revert(); await a.flush();
    expect([dbChips(db, 'qa-buyer'), dbChips(db, 'qa-seller')]).toEqual([50, 1095]);
    expect(rows(db, 'qa-seller')).toHaveLength(1);
    expect(a.hasKey('mkt:buy:1:2')).toBe(false);
    expect(await a.refresh('QA-Buyer')).toBe(50);
    expect(await a.refresh('QA-Seller')).toBe(1095);
  });
});

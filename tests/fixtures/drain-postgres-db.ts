import type pg from 'pg';
/** Pool.end() can resolve before PostgreSQL observes all socket closes. Never FORCE-kill those ending clients:
 * pg may emit a late, unhandled FATAL on a client already removed from the pool. Drain this unique test DB only.
 */
export async function dropDrainedTestDatabase(root: pg.Client, pool: pg.Pool, database: string) {
  if (!/^(lm_test_|lmsf_|tax_refund_)[a-z0-9_]+$/.test(database)) throw new Error('Refusing cleanup of an unrecognized disposable database');
  try {
    await pool.end();
    const deadline = Date.now() + 15_000;
    for (;;) {
      const r = await root.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname = $1', [database]);
      if (r.rows[0].n === 0) break;
      if (Date.now() >= deadline) throw new Error(`Disposable database ${database} still has live fixture clients; refusing FORCE drop`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    // Identifier comes only from our own generated safe name, never user input. No FORCE or swallowed cleanup errors.
    await root.query(`DROP DATABASE ${database}`);
  } finally { await root.end(); }
}

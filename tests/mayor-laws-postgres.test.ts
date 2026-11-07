/** Optional integration test against an explicitly provided disposable LOCAL PostgreSQL database.
 * Never reads production credentials. Example: MAYOR_LAWS_TEST_DATABASE_URL=postgres://...@127.0.0.1/test
 */
import { expect, it } from 'vitest';
import pg from 'pg';
import { MayorLaws } from '../server/mayorLaws';
import { MAYOR_MIGRATION } from '../server/mayor';
const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
it.skipIf(!url)('real PostgreSQL: concurrent submits claim one day and counter; rollback/restart/midnight', async () => {
  const u = new URL(url!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('Only a disposable local test DB is allowed.');
  const schema = `mayor_laws_test_${process.pid}_${Date.now()}`;
  const root = new pg.Pool({ connectionString: url });
  await root.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: url, max: 24, options: `-c search_path=${schema}` });
  let now = Date.parse('2026-11-07T05:59:59.000Z');
  try {
    await pool.query(MAYOR_MIGRATION);
    await pool.query('INSERT INTO mayor_terms (week, player_key, name, votes, starts_at, ends_at) VALUES ($1,$2,$3,1,$4,$5)', ['2026-11-02','alice','Alice', now-10000, now+86400000]);
    const a = new MayorLaws(pool, () => now), b = new MayorLaws(pool, () => now);
    await a.init(); await b.init();
    const outcomes = await Promise.allSettled(Array.from({length:20}, (_,i) => (i%2 ? a : b).submit('Alice', `Bill ${i}`)));
    expect(outcomes.filter((x) => x.status==='fulfilled')).toHaveLength(1);
    expect(Number((await pool.query('SELECT value FROM mayor_bill_counter WHERE id=1')).rows[0].value)).toBe(1);
    await pool.query('UPDATE mayor_terms SET player_key=$1, name=$2', ['bob','Bob']);
    const restart = new MayorLaws(pool, () => now); await restart.init();
    await expect(restart.submit('Bob','term switch')).rejects.toThrow('already submitted');
    now = Date.parse('2026-11-07T06:00:00.000Z');
    expect((await restart.submit('Bob','new day')).bill.number).toBe('2');
    expect((await restart.history()).history.map((x) => x.number)).toEqual(['2','1']);
    expect((await restart.history()).history.every((x) => x.status === 'pending')).toBe(true);
    await expect(pool.query("UPDATE mayor_bills SET status = 'approved'")).rejects.toThrow();
    expect((await pool.query("SELECT count(*) AS n FROM mayor_bills WHERE status <> 'pending'")).rows[0].n).toBe('0');
    await pool.query('UPDATE mayor_terms SET removed_at=$1',[now]);
    now += 86400000;
    await expect(restart.submit('Bob','removed')).rejects.toThrow('Only the sitting mayor');
    expect(Number((await pool.query('SELECT value FROM mayor_bill_counter WHERE id=1')).rows[0].value)).toBe(2);
  } finally {
    await pool.end(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end();
  }
}, 30000);

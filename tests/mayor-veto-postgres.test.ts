/** Real PostgreSQL (disposable LOCAL DB only via MAYOR_LAWS_TEST_DATABASE_URL): veto migration, guards, races. */
import { expect, it } from 'vitest';
import pg from 'pg';
import { MayorLaws } from '../server/mayorLaws';
import { MAYOR_MIGRATION } from '../server/mayor';
const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const OLD_SCHEMA = `CREATE TABLE mayor_bill_counter (id INTEGER PRIMARY KEY CHECK (id = 1), value BIGINT NOT NULL);
INSERT INTO mayor_bill_counter VALUES (1, 1);
CREATE TABLE mayor_bills (number BIGINT PRIMARY KEY, day TEXT NOT NULL UNIQUE, text TEXT NOT NULL, by_name TEXT NOT NULL, mayor_key TEXT NOT NULL, term_week TEXT NOT NULL, at BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status = 'pending'));
INSERT INTO mayor_bills VALUES (1, '2026-10-30', 'old term bill', 'Prev', 'prev', '2026-10-26', 0, 'pending');`;
it.skipIf(!url)('real PostgreSQL: upgrade old pending-only schema; strict day split; races; permanence guards', async () => {
  const u = new URL(url!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('Only a disposable local test DB is allowed.');
  const schema = `mayor_veto_test_${process.pid}_${Date.now()}`;
  const root = new pg.Pool({ connectionString: url });
  await root.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: url, max: 24, options: `-c search_path=${schema}` });
  let now = Date.parse('2026-11-07T05:59:00.000Z'); // 2026-11-06 23:59 Regina
  try {
    await pool.query(MAYOR_MIGRATION); await pool.query(OLD_SCHEMA);
    await pool.query("INSERT INTO mayor_terms (week, player_key, name, votes, starts_at, ends_at, vice_key, vice_name, vice_votes, vice_settled) VALUES ('2026-11-02','alice','Alice',3,$1,$2,'vic','Vic',1,TRUE)", [now - 86400000, now + 2 * 86400000]);
    const inst = Array.from({ length: 4 }, () => new MayorLaws(pool, () => now));
    await Promise.all(inst.map((x) => x.init())); // concurrent boots serialize on advisory lock
    const [a, b] = inst as [MayorLaws, MayorLaws];
    expect((await a.history()).history[0]).toMatchObject({ number: '1', status: 'pending', text: 'old term bill' });
    // Prior-term bill (earlier day) -> sitting mayor; 20 concurrent vetoes -> one transition, one audit event.
    await expect(b.veto('Vic', '1')).rejects.toThrow('sitting mayor');
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).veto('Alice', '1')));
    expect(res.filter((r) => !r.already)).toHaveLength(1);
    expect(res.every((r) => r.bill.status === 'vetoed' && r.bill.vetoedBy === 'Alice' && r.bill.text === 'old term bill')).toBe(true);
    expect((await pool.query('SELECT count(*)::int AS n FROM mayor_bill_events')).rows[0].n).toBe(1);
    // Today's bill: vice only; at Regina midnight it becomes mayor-only.
    const t = (await a.submit('Alice', 'friday bill')).bill; expect(t.day).toBe('2026-11-06');
    await expect(a.veto('Alice', t.number)).rejects.toThrow('vice mayor');
    now = Date.parse('2026-11-07T06:00:00.000Z');
    await expect(a.veto('Vic', t.number)).rejects.toThrow('sitting mayor');
    const n = (await a.submit('Alice', 'saturday bill')).bill;
    const race = await Promise.allSettled([a.veto('Vic', n.number), b.veto('Alice', n.number), a.veto('Vic', n.number)]);
    expect(race.filter((r) => r.status === 'fulfilled' && !r.value.already)).toHaveLength(1);
    expect((await a.history()).history.find((x) => x.number === n.number)).toMatchObject({ status: 'vetoed', vetoedRole: 'vice' });
    // Term rollover: old term ends; next term without vice; prior-term bills vetoable by new mayor.
    await pool.query("INSERT INTO mayor_terms (week, player_key, name, votes, starts_at, ends_at) VALUES ('2026-11-09','bob','Bob',2,$1,$2)", [now + 2 * 86400000, now + 9 * 86400000]);
    now += 2 * 86400000 + 1000;
    await expect(a.veto('Alice', t.number)).rejects.toThrow('Only the sitting mayor or vice mayor');
    expect((await a.veto('Bob', t.number)).bill).toMatchObject({ status: 'vetoed', vetoedBy: 'Bob', vetoedRole: 'mayor', by: 'Alice' });
    await a.submit('Bob', 'pending bill');
    // Permanence guards (even raw SQL).
    for (const q of ["DELETE FROM mayor_bills", "TRUNCATE mayor_bills CASCADE", "UPDATE mayor_bills SET text = 'x'", "UPDATE mayor_bills SET number = number + 100",
      "UPDATE mayor_bills SET status = 'pending', vetoed_at = NULL, vetoed_by_name = NULL, vetoed_by_key = NULL, vetoed_term_week = NULL, vetoed_role = NULL WHERE status = 'vetoed'",
      "UPDATE mayor_bills SET status = 'approved'", "DELETE FROM mayor_bill_events", "UPDATE mayor_bill_events SET by_name = 'x'", "TRUNCATE mayor_bill_events"])
      await expect(pool.query(q), q).rejects.toThrow();
    await expect(pool.query("UPDATE mayor_bills SET status = 'vetoed' WHERE status = 'pending'"), 'veto without audit fields').rejects.toThrow();
    const all = (await a.history()).history;
    expect(all.map((x) => [x.number, x.status, x.text])).toEqual([['4','pending','pending bill'],['3','vetoed','saturday bill'],['2','vetoed','friday bill'],['1','vetoed','old term bill']]);
    expect((await pool.query('SELECT count(*)::int AS n FROM mayor_bill_events')).rows[0].n).toBe(3);
    // Restart: re-running migration keeps everything.
    await new MayorLaws(pool, () => now).init();
    expect((await a.history()).history).toEqual(all);
  } finally {
    await pool.end(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end();
  }
}, 60000);

it.skipIf(!url)('real PostgreSQL: vice succession on removal is atomic with submit/veto; daily slot kept; durable', async () => {
  const { Mayor } = await import('../server/mayor');
  const u = new URL(url!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('Only a disposable local test DB is allowed.');
  const schema = `mayor_succ_test_${process.pid}_${Date.now()}`;
  const root = new pg.Pool({ connectionString: url });
  await root.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: url, max: 24, options: `-c search_path=${schema}` });
  let now = Date.parse('2026-11-07T00:00:00.000Z'); // Nov 6 18:00 Regina
  const clock = () => now;
  try {
    const m = new Mayor(pool, (() => ({})) as never, clock); await m.init();
    const start = now - 86400000, end = now + 3 * 86400000;
    await pool.query("INSERT INTO mayor_terms (week, player_key, name, votes, starts_at, ends_at, vice_key, vice_name, vice_votes, vice_settled) VALUES ('2026-11-02','alice','Alice',3,$1,$2,'vic','Vic',1,TRUE)", [start, end]);
    await pool.query("INSERT INTO mayor_bill_counter (id, value) VALUES (1, 0) ON CONFLICT (id) DO UPDATE SET value = 1");
    await pool.query("INSERT INTO mayor_bills (number, day, text, by_name, mayor_key, term_week, at) VALUES (1, '2026-11-05', 'yesterday', 'Alice', 'alice', '2026-11-02', $1)", [now - 86400000]);
    const laws = new MayorLaws(pool, clock);
    // Race: removal vs Alice submitting vs Alice vetoing an earlier bill vs Vic vetoing.
    const race = await Promise.allSettled([m.remove('abuse'), laws.submit('Alice', 'race bill'), laws.veto('Alice', '1'), laws.veto('Vic', '1')]);
    expect(race[0].status).toBe('fulfilled');
    const term = (await pool.query('SELECT * FROM mayor_terms')).rows[0];
    expect(term).toMatchObject({ player_key: 'vic', name: 'Vic', vice_key: null, removed_at: null, starts_at: String(start), ends_at: String(end) });
    // Every successful bill action was taken by whoever held the role at that serialized moment.
    const bills = (await pool.query('SELECT * FROM mayor_bills ORDER BY number')).rows;
    const ev = (await pool.query('SELECT * FROM mayor_bill_events')).rows;
    expect(ev.length).toBeLessThanOrEqual(1);
    if (ev[0]) expect(['alice', 'vic']).toContain(ev[0].by_key);
    expect(bills.filter((b) => b.day === '2026-11-06').length).toBeLessThanOrEqual(1);
    // Former mayor has no rights; new mayor (ex-vice) has mayor rights; vice slot vacant.
    await expect(laws.submit('Alice', 'x')).rejects.toThrow('Only the sitting mayor');
    const today = bills.find((b) => b.day === '2026-11-06');
    if (today) await expect(laws.submit('Vic', 'second today')).rejects.toThrow('already submitted'); // slot not reset by promotion
    else expect((await laws.submit('Vic', 'after promotion')).bill.by).toBe('Vic');
    await expect(laws.submit('Vic', 'again')).rejects.toThrow('already submitted');
    const todayNum = String((await pool.query("SELECT number FROM mayor_bills WHERE day = '2026-11-06'")).rows[0].number);
    await expect(laws.veto('Vic', todayNum)).rejects.toThrow('vice mayor'); // nobody is vice now
    await expect(laws.veto('Alice', '1')).rejects.toThrow(/Only the sitting mayor or vice mayor|already/);
    const v1 = await laws.veto('Vic', '1'); expect(v1.bill.status).toBe('vetoed');
    // Durable after restart; no third-place promotion; second removal empties the office.
    const m2 = new Mayor(pool, (() => ({})) as never, clock); await m2.init();
    expect((await m2.mayor())?.key).toBe('vic'); expect(await m2.vice()).toBeNull();
    expect((await pool.query('SELECT from_key, to_key FROM mayor_successions')).rows).toEqual([{ from_key: 'alice', to_key: 'vic' }]);
    expect(await m2.remove('again')).toEqual({ removed: 'Vic', successor: null }); expect(await m2.mayor()).toBeNull();
    // Concurrent double removal with a fresh vice: exactly one succession.
    await pool.query("UPDATE mayor_terms SET removed_at = NULL, player_key='p', name='P', vice_key='q', vice_name='Q', vice_votes=0");
    const dbl = await Promise.allSettled([m.remove('a'), m2.remove('b')]);
    expect(dbl.map((r) => r.status === 'fulfilled' ? r.value : (r.reason as Error).message)).toEqual(expect.arrayContaining([{ removed: 'P', successor: 'Q' }, { removed: 'Q', successor: null }]));
    expect((await pool.query('SELECT count(*)::int AS n FROM mayor_successions')).rows[0].n).toBe(2);
    now += 86400000; await expect(laws.submit('Q', 'x')).rejects.toThrow('Only the sitting mayor');
  } finally {
    await pool.end(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end();
  }
}, 60000);

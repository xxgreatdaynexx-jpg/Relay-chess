/**
 * Inventory writer fence (truck logistics cutover). Every inventory table is guarded by a statement trigger that only lets
 * the CURRENT holder write. The holder is a per-process, crypto-random token sent as the Postgres application_name
 * (PGAPPNAME, set here at import time, before any pool exists; an inherited chud-inv-* value is never reused).
 *
 * Boot (newest server wins), each step its own short transaction so nothing waits on a lock while holding another:
 *  1. probe: BEGIN; SHOW application_name; COMMIT must return this process's token (else fail closed, fence untouched);
 *  2. table + check function (CREATE IF NOT EXISTS / OR REPLACE: no inventory table lock);
 *  3. triggers: created only where MISSING (never DROP), lock_timeout + retry, BEFORE the fence row is touched, so an
 *     old writer can never deadlock against us (it holds a table lock and waits for the fence row, or vice versa);
 *  4. fence: advisory lock + UPDATE of the fence row (waits for in-flight writers, which read it FOR SHARE).
 *     The previous holder/mode are remembered for a pre-ready rollback.
 *
 * `migrated` is sticky: it is set (own txn) BEFORE the first legacy->location write. From then on the database is in
 * the new shape and pre-logistics code must never write it again.
 *
 * Pre-ready failure (boot error, boot deadline, SIGTERM/SIGINT before ready) -> releaseIfPreReady(): only if this process
 * still holds the fence (same token + epoch), give it back to the previous holder:
 *  - previous holder was another new-code server (mode 'fenced'): always safe (same code shape);
 *  - previous mode was 'open' (old code era): only while NOT migrated (nothing new-shape was written yet).
 * Otherwise the fence stays: inventory writes stay refused (maintenance, fail closed) until a new-code server boots and
 * finishes (forward recovery). /health reports not-ready the whole time (invHealth()).
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { databaseUrl } from './leaderboard-store.js';

export const FENCE_TOKEN = `chud-inv-${randomUUID()}`;
if (process.env.PGAPPNAME?.startsWith('chud-inv-')) console.warn('[fence] ignoring an inherited fence token; this process uses its own');
process.env.PGAPPNAME = FENCE_TOKEN; // never reuse an inherited token (two processes must never share one)
export const fenceToken = () => FENCE_TOKEN;

/** Inventory tables (only those that exist get a trigger; call again after every module created its tables). */
export const FENCED_TABLES = ['mine_items', 'mine_carried', 'mine_factories', 'factory_v2', 'fish_catches', 'kitchen_dishes', 'kitchen_fillets', 'kitchen_cooks',
  'building_inv', 'freight_shipments', 'loc_stock', 'market_stack_listings', 'farm_tiles', 'fortmc_state', 'loc_migrations'];

export const FENCE_SQL = `
CREATE TABLE IF NOT EXISTS inv_fence (id INT PRIMARY KEY CHECK (id = 1), holder TEXT, mode TEXT NOT NULL DEFAULT 'fenced', epoch BIGINT NOT NULL DEFAULT 0, at BIGINT NOT NULL DEFAULT 0);
ALTER TABLE inv_fence ADD COLUMN IF NOT EXISTS migrated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE inv_fence ADD COLUMN IF NOT EXISTS prev_holder TEXT;
ALTER TABLE inv_fence ADD COLUMN IF NOT EXISTS prev_mode TEXT;
CREATE OR REPLACE FUNCTION inv_fence_check() RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE h TEXT; m TEXT;
BEGIN
  SELECT holder, mode INTO h, m FROM inv_fence WHERE id = 1 FOR SHARE;
  IF NOT FOUND OR m = 'open' THEN RETURN NULL; END IF;
  IF h IS DISTINCT FROM current_setting('application_name', true) THEN
    RAISE EXCEPTION 'inventory fenced: another server holds inventory writes' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $f$;`;

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }> };
type P = Q & { connect: () => Promise<Q & { release: () => void }> };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Missing-only trigger install: one short transaction per table with a lock_timeout, retried. Never drops a trigger. */
export async function installFenceTriggers(db: P, opts: { tries?: number; lockMs?: number } = {}): Promise<string[]> {
  const done: string[] = []; const tries = opts.tries ?? 20;
  for (const t of FENCED_TABLES) {
    for (let i = 0; ; i++) {
      const cl = await db.connect();
      try {
        await cl.query('BEGIN'); await cl.query(`SET LOCAL lock_timeout = '${opts.lockMs ?? 2000}ms'`);
        const exists = (await cl.query('SELECT to_regclass($1) AS r', [t])).rows[0]?.r;
        const has = exists && (await cl.query('SELECT 1 FROM pg_trigger WHERE tgname = $1 AND tgrelid = to_regclass($2)', [`inv_fence_${t}`, t])).rows.length;
        if (exists && !has) { await cl.query(`CREATE TRIGGER inv_fence_${t} BEFORE INSERT OR UPDATE OR DELETE ON ${t} FOR EACH STATEMENT EXECUTE FUNCTION inv_fence_check()`); done.push(t); }
        await cl.query('COMMIT'); break;
      } catch (e) {
        await cl.query('ROLLBACK').catch(() => {});
        const c = (e as { code?: string }).code; // 55P03 lock_not_available, 42710 duplicate (a concurrent boot made it)
        if (c === '42710') break;
        if (c !== '55P03' || i + 1 >= tries) throw e;
        await sleep(250 * (i + 1));
      } finally { cl.release(); }
    }
  }
  return done;
}

let pool: pg.Pool | null = null;
let held = false; let epoch = -1; let ready = false; let lost = false; let watch: ReturnType<typeof setInterval> | null = null;
const noDb = () => !databaseUrl();
export const fenceHeld = () => noDb() || (held && !lost);
/** Inventory timers / writers may run: fence held AND boot migration finished. */
export const invReady = () => noDb() || (fenceHeld() && ready);
export const invHealth = () => ({ ok: invReady(), fence: noDb() ? 'none' : lost ? 'lost' : held ? 'held' : 'not held', ready: noDb() || ready });

/** Take the fence (newest boot wins). Throws (fail closed, fence untouched) if this process's token can't be verified. */
export async function initInventoryFence(url = databaseUrl(), opts: { lockMs?: number; tries?: number } = {}): Promise<void> {
  if (!url) return;
  pool ??= new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  const p = pool as unknown as P;
  { const cl = await p.connect(); let seen = '';
    try { await cl.query('BEGIN'); seen = String((await cl.query('SHOW application_name')).rows[0]?.application_name ?? ''); await cl.query('COMMIT'); }
    catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    if (seen !== FENCE_TOKEN) throw new Error('[fence] application_name did not reach Postgres unchanged: inventory stays offline (fail closed)'); }
  { const cl = await p.connect();
    try { await cl.query('BEGIN'); await cl.query("SELECT pg_advisory_xact_lock(hashtext('chud:inv_fence_ddl'))"); await cl.query(FENCE_SQL); await cl.query('COMMIT'); }
    catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); } }
  await installFenceTriggers(p, opts);
  const cl = await p.connect();
  try {
    await cl.query('BEGIN');
    await cl.query("SELECT pg_advisory_xact_lock(hashtext('chud:inv_fence'))");
    await cl.query("INSERT INTO inv_fence (id, holder, mode, epoch, at) VALUES (1, NULL, 'open', 0, 0) ON CONFLICT (id) DO NOTHING"); // first boot: old code was writing freely
    const r = await cl.query(`UPDATE inv_fence SET prev_holder = holder, prev_mode = mode, holder = $1, mode = 'fenced', epoch = epoch + 1, at = $2
      WHERE id = 1 RETURNING epoch`, [FENCE_TOKEN, Date.now()]); // waits for in-flight writers (they hold the row FOR SHARE)
    epoch = Number(r.rows[0]!.epoch);
    await cl.query('COMMIT');
  } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
  held = true; console.log('[fence] inventory writer fence taken');
  for (const s of ['SIGTERM', 'SIGINT'] as const) process.once(s, () => { if (!ready) void releaseIfPreReady(`${s} before ready`).finally(() => process.exit(0)); });
  const fatal = (why: string) => (e: unknown) => { if (ready) return; console.error(`[fence] ${why}:`, (e as Error)?.message ?? e); void releaseIfPreReady(why).finally(() => process.exit(1)); };
  const f = fatal('boot failed'); process.on('uncaughtException', f); process.on('unhandledRejection', f);
  unhook = () => { process.off('uncaughtException', f); process.off('unhandledRejection', f); }; // after ready: default crash behaviour again
  const deadline = Number(process.env.INV_BOOT_DEADLINE_MS ?? 8 * 60_000); // bounded boot: never hold the fence forever un-ready
  const d = setTimeout(() => { if (!ready) fatal(`boot not ready after ${deadline} ms`)(new Error('deadline')); }, deadline); d.unref?.();
  watch = setInterval(() => { void pool!.query('SELECT holder, epoch FROM inv_fence WHERE id = 1').then((x) => {
    const row = x.rows[0]; if (held && !lost && (row?.holder !== FENCE_TOKEN || Number(row?.epoch) !== epoch)) { lost = true; console.error('[fence] lost the inventory fence: inventory writes refused, /health not ready'); }
  }, () => {}); }, 5_000); watch.unref?.();
}
/** Set (sticky) before the first legacy->location write. */
export async function markMigrating(): Promise<void> {
  if (!pool) return;
  const r = await pool.query('UPDATE inv_fence SET migrated = true WHERE id = 1 AND holder = $1 AND epoch = $2', [FENCE_TOKEN, epoch]);
  if (!r.rowCount) { lost = true; throw new Error('[fence] lost the inventory fence before migrating: not migrating (fail closed)'); }
}
let unhook = () => {};
export function markReady() { ready = true; unhook(); }
/** Pre-ready failure: hand the fence back only when provably safe (see header). Returns what happened. */
export async function releaseIfPreReady(why: string): Promise<'released' | 'kept' | 'not-held'> {
  if (!pool || !held || ready) return 'not-held';
  try {
    const r = await pool.query(`UPDATE inv_fence SET holder = prev_holder, mode = prev_mode, prev_holder = NULL, prev_mode = NULL, at = $3
      WHERE id = 1 AND holder = $1 AND epoch = $2 AND prev_mode IS NOT NULL AND (prev_mode = 'fenced' OR NOT migrated) RETURNING mode`, [FENCE_TOKEN, epoch, Date.now()]);
    held = false;
    if (r.rowCount) { console.error(`[fence] ${why}: fence handed back to the previous server (${String(r.rows[0]!.mode)})`); return 'released'; }
    console.error(`[fence] ${why}: fence KEPT (database already migrated or another boot took it): inventory writes stay refused until a new server finishes booting`);
    return 'kept';
  } catch (e) { console.error('[fence] release failed:', (e as Error).message); return 'kept'; }
}
/** After every module created its tables: guard the ones that did not exist yet at boot (missing-only). */
export async function refreshFenceTriggers(): Promise<void> { if (pool) await installFenceTriggers(pool as unknown as P); }
/** Test hook. */
export async function closeFence() { if (watch) clearInterval(watch); watch = null; await pool?.end().catch(() => {}); pool = null; held = false; ready = false; lost = false; epoch = -1; }

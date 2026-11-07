/**
 * Inventory writer fence (truck logistics cutover). Every inventory table is guarded by a statement trigger that only lets
 * the CURRENT holder write: the holder is a per-process token sent as the Postgres application_name (PGAPPNAME, set here
 * at import time, before any pool exists). The newest server to boot takes the fence; an older process (the previous
 * deployment during an overlapping deploy, or any second instance) then gets "inventory fenced" on every inventory write
 * and its whole transaction (chips included) rolls back: it can never overwrite stock from a stale cache or write a
 * legacy shape after the cutover. The trigger reads the fence row FOR SHARE, so taking the fence waits for every
 * in-flight writer transaction to finish; boot loads inventory only after that.
 *
 * Fail closed: if application_name does not reach the server unchanged (a pooler that drops it), the fence is NOT taken
 * and inventory stays offline (initInventoryFence throws).
 *
 * Rollback barrier: pre-logistics code has no token, so it is fenced out too. To roll back deliberately:
 *   UPDATE inv_fence SET mode = 'open';   -- (operator) every writer allowed again, like before the cutover
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { databaseUrl } from './leaderboard-store.js';

export const FENCE_TOKEN = `chud-inv-${randomUUID()}`;
if (!process.env.PGAPPNAME || !process.env.PGAPPNAME.startsWith('chud-inv-')) process.env.PGAPPNAME = FENCE_TOKEN;
export const fenceToken = () => process.env.PGAPPNAME!;

/** Inventory tables (only those that exist get a trigger; call again after every module created its tables). */
export const FENCED_TABLES = ['mine_items', 'mine_carried', 'mine_factories', 'factory_v2', 'fish_catches', 'kitchen_dishes', 'kitchen_fillets', 'kitchen_cooks',
  'building_inv', 'freight_shipments', 'loc_stock', 'market_stack_listings', 'farm_tiles', 'fortmc_state', 'loc_migrations'];

export const FENCE_SQL = `
CREATE TABLE IF NOT EXISTS inv_fence (id INT PRIMARY KEY CHECK (id = 1), holder TEXT, mode TEXT NOT NULL DEFAULT 'fenced', epoch BIGINT NOT NULL DEFAULT 0, at BIGINT NOT NULL DEFAULT 0);
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

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };
export async function installFenceTriggers(db: Q): Promise<string[]> {
  const done: string[] = [];
  for (const t of FENCED_TABLES) {
    if (!(await db.query('SELECT to_regclass($1) AS r', [t])).rows[0]?.r) continue;
    await db.query(`DROP TRIGGER IF EXISTS inv_fence_${t} ON ${t}`);
    await db.query(`CREATE TRIGGER inv_fence_${t} BEFORE INSERT OR UPDATE OR DELETE ON ${t} FOR EACH STATEMENT EXECUTE FUNCTION inv_fence_check()`);
    done.push(t);
  }
  return done;
}

let pool: pg.Pool | null = null;
let held = false;
export const fenceHeld = () => held || !databaseUrl();
/** Take the fence (newest boot wins). Throws (fail closed) if this process's token can't be verified on the server. */
export async function initInventoryFence(url = databaseUrl()): Promise<void> {
  if (!url) return;
  pool ??= new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  const seen = String((await pool.query("SELECT current_setting('application_name', true) AS a")).rows[0]?.a ?? '');
  if (seen !== fenceToken()) throw new Error(`[fence] application_name did not reach Postgres (got "${seen.slice(0, 40)}"): inventory stays offline (fail closed)`);
  const cl = await pool.connect();
  try {
    await cl.query('BEGIN');
    await cl.query("SELECT pg_advisory_xact_lock(hashtext('chud:inv_fence'))");
    await cl.query(FENCE_SQL);
    await cl.query("INSERT INTO inv_fence (id, holder, mode, epoch, at) VALUES (1, NULL, 'fenced', 0, 0) ON CONFLICT (id) DO NOTHING");
    await cl.query("UPDATE inv_fence SET holder = $1, mode = 'fenced', epoch = epoch + 1, at = $2 WHERE id = 1", [fenceToken(), Date.now()]); // waits for in-flight writers (FOR SHARE)
    await installFenceTriggers(cl as unknown as Q);
    await cl.query('COMMIT');
  } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
  held = true; console.log('[fence] inventory writer fence taken');
  const t = setInterval(() => { void pool!.query('SELECT holder FROM inv_fence WHERE id = 1').then((r) => { const h = r.rows[0]?.holder; if (h !== fenceToken() && held) { held = false; console.error('[fence] another server took the inventory fence: this process can no longer write inventory'); } }, () => {}); }, 15_000); t.unref?.();
}
/** After every module created its tables: guard the ones that did not exist yet at boot. */
export async function refreshFenceTriggers(): Promise<void> { if (pool) await installFenceTriggers(pool as unknown as Q); }

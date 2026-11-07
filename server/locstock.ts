/**
 * Per-location goods (truck logistics, Dayne 2026-11-06). See shared/inventoryLocations.ts for the location ids.
 *
 * Storage
 *  - factory            the existing banked store (mine_items / Mines packs): legacy banked stock IS factory stock, no copy.
 *  - warehouse, mine:city, farm:<plot>, kitchen:<home>   `loc_stock` rows (this file), mirrored in memory like Mines packs.
 *  - coral              the Coral Grotto haul bin (`building_inv`, server/warehouse.ts), unchanged. Every farm plot (city and
 *                       resort) is its own loc_stock location; the old pooled resort barn is migrated to the factory.
 *  - fish / dishes      rows (`fish_catches.loc`, `kitchen_dishes.loc`) so species, weight and quality stay with each one.
 *
 * Every change is one Postgres transaction: withdrawals are guarded statements (`qty + delta >= 0`, otherwise the
 * statement divides by zero and the whole transaction rolls back), so the database can never go negative or duplicate
 * even if memory were stale. Memory is applied first and reverted when the transaction fails (the Mines pattern).
 */
import pg from 'pg';
import { playerKey } from './skins.js';
import { databaseUrl } from './leaderboard-store.js';
import { parseLoc } from '../shared/inventoryLocations.js';

type Stmt = { sql: string; args: unknown[] };
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export type LocPool = Q & { connect: () => Promise<Q & { release: () => void }> };
export class LocError extends Error {}

export const LOC_MIGRATION = `
CREATE TABLE IF NOT EXISTS loc_stock (player_key TEXT NOT NULL, name TEXT NOT NULL, loc TEXT NOT NULL, item TEXT NOT NULL, qty BIGINT NOT NULL CHECK (qty >= 0), PRIMARY KEY (player_key, loc, item));
CREATE INDEX IF NOT EXISTS loc_stock_loc ON loc_stock (loc);
CREATE TABLE IF NOT EXISTS loc_migrations (id TEXT PRIMARY KEY, at BIGINT NOT NULL, report JSONB NOT NULL);`;

/** Guarded change of one stack inside a transaction. Withdrawals fail the transaction when stock is short. */
export function locStmt(key: string, name: string, loc: string, item: string, delta: number): Stmt {
  if (delta >= 0) return { sql: `INSERT INTO loc_stock (player_key, name, loc, item, qty) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (player_key, loc, item) DO UPDATE SET qty = loc_stock.qty + EXCLUDED.qty, name = EXCLUDED.name`, args: [key, name, loc, item, delta] };
  return { sql: `WITH u AS (UPDATE loc_stock SET qty = qty + $4 WHERE player_key = $1 AND loc = $2 AND item = $3 AND qty + $4 >= 0 RETURNING 1) SELECT 1 / (SELECT count(*) FROM u)::int AS ok`, args: [key, loc, item, delta] };
}
/** Fails the transaction unless exactly one row matched (e.g. a shipment flipping transit -> delivered once). */
export const mustOne = (sql: string, args: unknown[]): Stmt => ({ sql: `WITH u AS (${sql} RETURNING 1) SELECT 1 / (SELECT count(*) FROM u)::int AS ok`, args });

export interface LocDelta { loc: string; item: string; delta: number }

export class LocStore {
  /** player_key -> loc -> item -> qty */
  mem = new Map<string, Map<string, Map<string, number>>>();
  names = new Map<string, string>();
  private chain: Promise<unknown> = Promise.resolve();
  /** Resolves once every queued write has settled (tests / shutdown). */
  idle() { return this.chain; }
  /** In-memory (dev/tests) is ready at once; a DB-backed store refuses every read/write until it has loaded. */
  loaded: boolean;
  constructor(readonly pool: LocPool | null) { this.loaded = !pool; }
  async init() {
    if (!this.pool) { this.loaded = true; return; }
    await this.pool.query(LOC_MIGRATION);
    const r = await this.pool.query('SELECT player_key, name, loc, item, qty FROM loc_stock WHERE qty > 0');
    this.mem.clear();
    for (const x of r.rows) { this.bucket(String(x.player_key), String(x.loc)).set(String(x.item), Number(x.qty)); this.names.set(String(x.player_key), String(x.name)); }
    this.loaded = true;
  }
  private bucket(k: string, loc: string) { let p = this.mem.get(k); if (!p) { p = new Map(); this.mem.set(k, p); } let b = p.get(loc); if (!b) { b = new Map(); p.set(loc, b); } return b; }
  qty(name: string, loc: string, item: string) { return this.mem.get(playerKey(name))?.get(loc)?.get(item) ?? 0; }
  at(name: string, loc: string): Array<{ item: string; qty: number }> { return [...(this.mem.get(playerKey(name))?.get(loc) ?? new Map())].filter(([, q]) => q > 0).map(([item, qty]) => ({ item, qty })); }
  locs(name: string): Map<string, Array<{ item: string; qty: number }>> { const out = new Map<string, Array<{ item: string; qty: number }>>(); for (const loc of this.mem.get(playerKey(name))?.keys() ?? []) { const a = this.at(name, loc); if (a.length) out.set(loc, a); } return out; }
  /** All holders of a location kind (e.g. every warehouse stack, for net worth). */
  all(): Array<{ key: string; loc: string; item: string; qty: number }> { const out = []; for (const [key, p] of this.mem) for (const [loc, b] of p) for (const [item, qty] of b) if (qty > 0) out.push({ key, loc, item, qty }); return out; }
  private guard() { if (!this.loaded) throw new LocError('Storage is reconnecting. Your goods are safe, try again in a minute.'); }
  /** Can these deltas apply (no stack below zero)? */
  check(name: string, deltas: LocDelta[]): boolean {
    const k = playerKey(name); const sum = new Map<string, number>();
    for (const d of deltas) { if (!Number.isSafeInteger(d.delta)) return false; parseLoc(d.loc); const kk = `${d.loc}\u0000${d.item}`; sum.set(kk, (sum.get(kk) ?? 0) + d.delta); }
    for (const [kk, d] of sum) { const [loc, item] = kk.split('\u0000') as [string, string]; if ((this.mem.get(k)?.get(loc)?.get(item) ?? 0) + d < 0) return false; }
    return true;
  }
  /** Memory only (after a transaction that already contained rowsFor()). */
  applyMem(name: string, deltas: LocDelta[], sign = 1) {
    const k = playerKey(name); this.names.set(k, name.trim());
    for (const d of deltas) { const b = this.bucket(k, d.loc); const n = (b.get(d.item) ?? 0) + sign * d.delta; if (n > 0) b.set(d.item, n); else b.delete(d.item); }
  }
  rowsFor(name: string, deltas: LocDelta[]): Stmt[] { const k = playerKey(name); return deltas.filter((d) => d.delta !== 0).map((d) => locStmt(k, name.trim(), d.loc, d.item, d.delta)); }
  /**
   * Apply deltas now (all-or-nothing: false = short somewhere, nothing changed) and commit them with `extra` in ONE
   * transaction. The returned promise rejects if the transaction failed (memory is reverted first).
   */
  adjust(name: string, deltas: LocDelta[], extra: Stmt[] = [], opts: { after?: Promise<unknown>; check?: (cl: Q) => Promise<void>; committed?: () => Promise<boolean> } = {}): Promise<void> | false {
    this.guard();
    if (!this.check(name, deltas)) return false;
    this.applyMem(name, deltas);
    const rows = [...this.rowsFor(name, deltas), ...extra];
    if (!this.pool) return Promise.resolve();
    const pool = this.pool;
    const run = async () => {
      await opts.after; const cl = await pool.connect();
      try { await cl.query('BEGIN'); if (opts.check) await opts.check(cl); for (const s of rows) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
      catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    // A commit whose reply was lost (the retry then trips its exactly-once guard) must not be reverted in memory.
    return p.catch(async (e) => { if (opts.committed && await opts.committed().catch(() => false)) return; this.applyMem(name, deltas, -1); throw e; });
  }
}

let store = new LocStore(null);
export const getLocStore = () => store;
export const setLocStore = (s: LocStore) => { store = s; };
export async function initLocStore(): Promise<void> {
  const url = databaseUrl(); if (!url) { store = new LocStore(null); await store.init(); return; }
  const pool = new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[locstock] pool error:', e.message));
  const s = new LocStore(pool as unknown as LocPool); store = s; // fails closed (not loaded) until the load below succeeds
  const attempt = async () => { try { await s.init(); console.log('[locstock] ready'); return true; } catch (e) { console.error('[locstock] init failed (retrying):', (e as Error).message); return false; } };
  if (await attempt()) return;
  void (async () => { for (let i = 0; ; i++) { await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** Math.min(i, 5)))); if (await attempt()) return; } })();
}

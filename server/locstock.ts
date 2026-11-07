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

/** Map pools (Dayne 2026-11-07): the city map has ONE inventory. Its stackable goods (ore / bar / good / food incl.
 *  fillets) ARE the pre-Millionaire banked store (mine_items, the Mines pack the factory produces from and the Mines
 *  store sells from), so 'warehouse' stacks of those types are served by that store, not by loc_stock. Crops, other
 *  keys, fish rows and dishes stay in loc_stock / their rows under 'warehouse'. Wired in locmoves.wireLocMoves(). */
export interface CityPack {
  qty(name: string, type: string, id: string): number;
  stacks(name: string): Array<{ type: string; id: string; qty: number }>;
  /** All-or-nothing apply + persist with `extra` rows in the pack's own transaction (false = short somewhere). */
  adjust(name: string, deltas: Array<{ type: string; id: string; delta: number }>, extra: Stmt[], opts: { after?: Promise<unknown>; committed?: () => Promise<boolean>; onLate?: (ok: boolean) => void; pool?: LocPool | null }): Promise<void> | false;
}
export const CITY = 'warehouse';
let defaultCityPack: CityPack | null = null;
/** Registered by mines.ts at import: the city pack is always the CURRENT Mines world's banked store. */
export const setDefaultCityPack = (c: CityPack) => { defaultCityPack = c; };
const PACKED = new Set(['ore', 'bar', 'good', 'food']);
const split = (item: string) => { const i = item.indexOf(':'); return { type: item.slice(0, i), id: item.slice(i + 1) }; };
/** Is this (loc, item) held in the city pack? */
export const packed = (loc: string, item: string) => loc === CITY && PACKED.has(split(item).type);

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
  /** The city pack (set at wiring). Without it, city stackables are refused (fail closed), never put in loc_stock. */
  cityPack: CityPack | null = null;
  private get cp(): CityPack | null { return this.cityPack ?? defaultCityPack; }
  private pack(): CityPack { const c = this.cp; if (!c) throw new LocError('Storage is reconnecting. Your goods are safe, try again in a minute.'); return c; }
  async init() {
    if (!this.pool) { this.loaded = true; return; }
    await this.pool.query(LOC_MIGRATION);
    const r = await this.pool.query('SELECT player_key, name, loc, item, qty FROM loc_stock WHERE qty > 0');
    this.mem.clear();
    for (const x of r.rows) { this.bucket(String(x.player_key), String(x.loc)).set(String(x.item), Number(x.qty)); this.names.set(String(x.player_key), String(x.name)); }
    this.loaded = true;
  }
  private bucket(k: string, loc: string) { let p = this.mem.get(k); if (!p) { p = new Map(); this.mem.set(k, p); } let b = p.get(loc); if (!b) { b = new Map(); p.set(loc, b); } return b; }
  qty(name: string, loc: string, item: string) { if (packed(loc, item)) { const x = split(item); return this.cp ? this.cp.qty(name, x.type, x.id) : 0; } return this.mem.get(playerKey(name))?.get(loc)?.get(item) ?? 0; }
  at(name: string, loc: string): Array<{ item: string; qty: number }> {
    const own = [...(this.mem.get(playerKey(name))?.get(loc) ?? new Map())].filter(([item, q]) => q > 0 && !packed(loc, item)).map(([item, qty]) => ({ item, qty }));
    const cp = this.cp; if (loc !== CITY || !cp) return own;
    return [...own, ...cp.stacks(name).filter((s) => s.qty > 0 && PACKED.has(s.type)).map((s) => ({ item: `${s.type}:${s.id}`, qty: s.qty }))];
  }
  locs(name: string): Map<string, Array<{ item: string; qty: number }>> { const out = new Map<string, Array<{ item: string; qty: number }>>(); for (const loc of new Set([...(this.mem.get(playerKey(name))?.keys() ?? []), CITY])) { const a = this.at(name, loc); if (a.length) out.set(loc, a); } return out; }
  /** All holders of a location kind (e.g. every warehouse stack, for net worth). */
  all(): Array<{ key: string; loc: string; item: string; qty: number }> { const out = []; for (const [key, p] of this.mem) for (const [loc, b] of p) for (const [item, qty] of b) if (qty > 0) out.push({ key, loc, item, qty }); return out; }
  private guard() { if (!this.loaded) throw new LocError('Storage is reconnecting. Your goods are safe, try again in a minute.'); }
  /** Can these deltas apply (no stack below zero)? */
  check(name: string, deltas: LocDelta[]): boolean {
    const k = playerKey(name); const sum = new Map<string, number>();
    for (const d of deltas) { if (!Number.isSafeInteger(d.delta)) return false; parseLoc(d.loc); const kk = `${d.loc}\u0000${d.item}`; sum.set(kk, (sum.get(kk) ?? 0) + d.delta); }
    for (const [kk, d] of sum) { const [loc, item] = kk.split('\u0000') as [string, string]; if (this.qty(name, loc, item) + d < 0) return false; void k; }
    return true;
  }
  /** Memory only (after a transaction that already contained rowsFor()). */
  applyMem(name: string, deltas: LocDelta[], sign = 1) {
    if (deltas.some((d) => packed(d.loc, d.item))) throw new LocError('city stackables go through adjust() (the city pack), never raw rows');
    const k = playerKey(name); this.names.set(k, name.trim());
    for (const d of deltas) { const b = this.bucket(k, d.loc); const n = (b.get(d.item) ?? 0) + sign * d.delta; if (n > 0) b.set(d.item, n); else b.delete(d.item); }
  }
  rowsFor(name: string, deltas: LocDelta[]): Stmt[] { if (deltas.some((d) => packed(d.loc, d.item))) throw new LocError('city stackables go through adjust() (the city pack), never raw rows'); const k = playerKey(name); return deltas.filter((d) => d.delta !== 0).map((d) => locStmt(k, name.trim(), d.loc, d.item, d.delta)); }
  /**
   * Apply deltas now (all-or-nothing: false = short somewhere, nothing changed) and commit them with `extra` in ONE
   * transaction. The returned promise rejects if the transaction failed (memory is reverted first).
   */
  adjust(name: string, deltas: LocDelta[], extra: Stmt[] = [], opts: AdjustOpts = {}): Promise<void> | false {
    this.guard();
    if (!this.check(name, deltas)) return false;
    const pk = deltas.filter((d) => packed(d.loc, d.item) && d.delta !== 0);
    if (pk.length) return this.adjustPacked(name, pk, deltas.filter((d) => !packed(d.loc, d.item)), extra, opts);
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
    const committed = opts.committed ?? (opts.marker ? markerCheck(pool, opts.marker) : null);
    return p.catch(async (e) => {
      // An error does not prove the transaction rolled back (a lost COMMIT acknowledgement). Ask the database by this
      // write's own marker (shipment id / ledger key / row id) before undoing anything in memory.
      const v = committed ? await outcome(committed) : false;
      if (v === true) return; // it DID commit: keep memory, report success
      if (v === false) { this.applyMem(name, deltas, -1); throw e; }
      // Still unknown (database unreachable): memory keeps the change (never duplicated); a background reconcile settles it.
      void settle(committed!).then((late) => { if (!late) this.applyMem(name, deltas, -1); opts.onLate?.(late); });
      throw new OutcomeUnknown(e as Error);
    });
  }
  /** City stackables (+ any loc_stock deltas + extra rows) commit in the city pack's ONE transaction. Memory of the
   *  loc_stock part is applied first and reverted only when the write provably did not commit. */
  private adjustPacked(name: string, pk: LocDelta[], rest: LocDelta[], extra: Stmt[], opts: AdjustOpts): Promise<void> | false {
    const pack = this.pack(); const pool = this.pool;
    const committed = opts.committed ?? (opts.marker && pool ? markerCheck(pool, opts.marker) : undefined);
    this.applyMem(name, rest);
    const rows = [...this.rowsFor(name, rest), ...extra];
    const r = pack.adjust(name, pk.map((d) => ({ ...split(d.item), delta: d.delta })), rows, { after: opts.after, committed, pool: opts.pool ?? pool,
      onLate: (ok) => { if (!ok) this.applyMem(name, rest, -1); opts.onLate?.(ok); } });
    if (r === false) { this.applyMem(name, rest, -1); return false; }
    return r.catch((e) => { if (!isOutcomeUnknown(e)) this.applyMem(name, rest, -1); throw e; });
  }
}
type Stmt_ = { sql: string; args: unknown[] };
export type AdjustOpts = {
  /** Pool for the rows when the city pack runs memory-only (dev/tests): the caller's own database. */ pool?: LocPool; after?: Promise<unknown>; check?: (cl: Q) => Promise<void>;
  /** Did this write commit? (returns true/false; throws when it can't tell). */ committed?: () => Promise<boolean>;
  /** Or: a SELECT that returns a row iff this write committed. */ marker?: Stmt_;
  /** Late verdict after an OutcomeUnknown (true = it had committed; false = memory was reverted: undo your side too). */ onLate?: (committed: boolean) => void };
/** The write's outcome could not be determined yet; memory keeps it until a background check settles it. */
export class OutcomeUnknown extends Error { constructor(readonly cause_: Error) { super(`outcome unknown: ${cause_.message}`); } }
export const isOutcomeUnknown = (e: unknown): e is OutcomeUnknown => e instanceof OutcomeUnknown;
const markerCheck = (pool: LocPool, m: Stmt_) => async () => ((await pool.query(m.sql, m.args)).rows.length > 0);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A few quick tries: true / false, or null if the database can't be asked. */
export async function outcome(f: () => Promise<boolean>, tries = 3): Promise<boolean | null> {
  for (let i = 0; i < tries; i++) { try { return await f(); } catch { if (i + 1 < tries) await wait(200 * (i + 1)); } }
  return null;
}
async function settle(f: () => Promise<boolean>): Promise<boolean> {
  for (let i = 0; ; i++) { const v = await outcome(f, 1); if (v !== null) return v; await wait(Math.min(60_000, 1000 * 2 ** Math.min(i, 6))); }
}
/** Marker for a transaction that writes a wallet ledger row: its tx_key exists iff it committed. */
export function ledgerMarker(stmts: Stmt_[]): Stmt_ | undefined {
  const s = stmts.find((x) => /INSERT INTO wallet_transactions/i.test(x.sql)); return s ? { sql: 'SELECT 1 FROM wallet_transactions WHERE tx_key = $1', args: [s.args[0]] } : undefined;
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

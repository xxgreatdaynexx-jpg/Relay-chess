/**
 * Location-keyed inventory + truck station legs (truck-only logistics, phase 1–2 core).
 * Every write is transactional: dispatch debits the source and records the in-flight load in ONE transaction; arrival
 * credits the destination and closes the load in ONE transaction (exactly once, safe across instances and restarts).
 * Legacy migration (banked `mine_items`, unsold `fish_catches`, `kitchen_fillets`) moves stock to each owner's single
 * factory, conserves every per-player/per-item total, is idempotent, and FAILS CLOSED when any holder has no factory.
 */
import { randomUUID } from 'node:crypto';
import { canSellAt, factoryLoc, parseLoc, WAREHOUSE_LOC } from '../shared/inventoryLocations.js';

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, any>[]; rowCount?: number | null }> };
export type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };
export class InventoryError extends Error {}

export const INVENTORY_MIGRATION = `
CREATE TABLE IF NOT EXISTS inv_stock (player_key TEXT NOT NULL, loc_id TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL,
  qty BIGINT NOT NULL CHECK (qty >= 0), PRIMARY KEY (player_key, loc_id, item_type, item_id));
CREATE INDEX IF NOT EXISTS inv_stock_loc ON inv_stock (loc_id);
CREATE TABLE IF NOT EXISTS inv_fish_loc (fish_id TEXT PRIMARY KEY, player_key TEXT NOT NULL, loc_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inv_loads (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, from_loc TEXT NOT NULL, to_loc TEXT NOT NULL,
  item_type TEXT NOT NULL, item_id TEXT NOT NULL, qty BIGINT NOT NULL CHECK (qty > 0), truck_id TEXT NOT NULL,
  depart_at BIGINT NOT NULL, arrive_at BIGINT NOT NULL, status TEXT NOT NULL CHECK (status IN ('moving','arrived')), arrived_at BIGINT,
  CHECK (from_loc <> to_loc), CHECK ((status = 'moving') = (arrived_at IS NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS inv_loads_truck_busy ON inv_loads (truck_id) WHERE status = 'moving';
CREATE INDEX IF NOT EXISTS inv_loads_due ON inv_loads (arrive_at) WHERE status = 'moving';
CREATE TABLE IF NOT EXISTS inv_migrations (id TEXT PRIMARY KEY, at BIGINT NOT NULL, report JSONB NOT NULL);
`;
const MIGRATION_LOCK = 74210612;
export const LEGACY_MIGRATION_ID = 'legacy-to-factory-v1';

type Item = { type: string; id: string };
const posInt = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const item = (t: unknown, i: unknown): Item => {
  if (typeof t !== 'string' || typeof i !== 'string' || !/^[a-z_]{1,24}$/.test(t) || !/^[A-Za-z0-9_.-]{1,64}$/.test(i)) throw new InventoryError('Unknown item.');
  return { type: t, id: i };
};

export class Inventory {
  constructor(private readonly pool: PoolLike, private readonly clock = () => Date.now()) {}
  async init() { await this.pool.query(INVENTORY_MIGRATION); }
  private async tx<T>(fn: (cl: Q) => Promise<T>): Promise<T> {
    const cl = await this.pool.connect();
    try { await cl.query('BEGIN'); const r = await fn(cl); await cl.query('COMMIT'); return r; }
    catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
  }
  static async add(cl: Q, player: string, loc: string, it: Item, qty: number) {
    parseLoc(loc); if (!posInt(qty)) throw new InventoryError('Bad quantity.');
    await cl.query(`INSERT INTO inv_stock (player_key, loc_id, item_type, item_id, qty) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (player_key, loc_id, item_type, item_id) DO UPDATE SET qty = inv_stock.qty + EXCLUDED.qty`, [player, loc, it.type, it.id, qty]);
  }
  /** Debit exactly qty or throw (conditional update; concurrent debits can never go negative). */
  static async take(cl: Q, player: string, loc: string, it: Item, qty: number) {
    parseLoc(loc); if (!posInt(qty)) throw new InventoryError('Bad quantity.');
    const r = await cl.query('UPDATE inv_stock SET qty = qty - $5 WHERE player_key = $1 AND loc_id = $2 AND item_type = $3 AND item_id = $4 AND qty >= $5', [player, loc, it.type, it.id, qty]);
    if (!r.rowCount) throw new InventoryError('Not enough of that item here.');
  }
  async qty(player: string, loc: string, it: Item): Promise<number> {
    const r = await this.pool.query('SELECT qty FROM inv_stock WHERE player_key = $1 AND loc_id = $2 AND item_type = $3 AND item_id = $4', [player, loc, it.type, it.id]);
    return Number(r.rows[0]?.qty ?? 0);
  }
  async at(player: string, loc: string) {
    return (await this.pool.query('SELECT item_type, item_id, qty FROM inv_stock WHERE player_key = $1 AND loc_id = $2 AND qty > 0 ORDER BY 1,2', [player, loc])).rows
      .map((r) => ({ type: String(r.item_type), id: String(r.item_id), qty: Number(r.qty) }));
  }
  /** Producer output lands at its own source location (e.g. a mine haul at mine:<id>, a harvest at farm:<plot>). */
  async produce(player: string, loc: string, items: Array<[Item, number]>) {
    return this.tx(async (cl) => { for (const [it, n] of items) await Inventory.add(cl, player, loc, item(it.type, it.id), n); });
  }
  /** Sell gate: goods can only be sold from the Warehouse. Returns the debit statement runner for the sale transaction. */
  static async takeForSale(cl: Q, player: string, loc: string, it: Item, qty: number) {
    if (!canSellAt(loc)) throw new InventoryError('Goods only sell at the Chud City Warehouse. Ship them there by truck.');
    await Inventory.take(cl, player, loc, it, qty);
  }

  /** Truck station leg: debit source + record load atomically. Ownership of both ends is checked by `owns` (caller resolves
   * farm plots / homes / factory). One load per truck at a time (DB-enforced). Capacity and travel come from the truck. */
  async dispatch(player: string, b: { from: unknown; to: unknown; type: unknown; id: unknown; qty: unknown; truck: { id: string; cap: number; travelMs: number } },
    owns: (player: string, loc: string) => Promise<boolean> | boolean) {
    const from = parseLoc(b.from).id, to = parseLoc(b.to).id; if (from === to) throw new InventoryError('Pick a different destination.');
    const it = item(b.type, b.id); const qty = Number(b.qty);
    if (!posInt(qty)) throw new InventoryError('Pick a quantity.');
    if (qty > b.truck.cap) throw new InventoryError(`That truck carries at most ${b.truck.cap}.`);
    for (const l of [from, to]) if (!(await owns(player, l))) throw new InventoryError('You can only move goods between your own places and the Warehouse.');
    return this.tx(async (cl) => {
      const now = this.clock();
      const busy = await cl.query("SELECT 1 FROM inv_loads WHERE truck_id = $1 AND status = 'moving' FOR UPDATE", [b.truck.id]);
      if (busy.rows.length) throw new InventoryError('That truck is already out on a delivery.');
      await Inventory.take(cl, player, from, it, qty);
      const id = randomUUID();
      try {
        await cl.query("INSERT INTO inv_loads (id, player_key, from_loc, to_loc, item_type, item_id, qty, truck_id, depart_at, arrive_at, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'moving')",
          [id, player, from, to, it.type, it.id, qty, b.truck.id, now, now + b.truck.travelMs]);
      } catch (e) { if ((e as { code?: string }).code === '23505') throw new InventoryError('That truck is already out on a delivery.'); throw e; }
      return { id, arriveAt: now + b.truck.travelMs };
    });
  }
  /** Deliver due loads exactly once (SKIP LOCKED: concurrent instances never double-credit). Destination stock is usable only after this. */
  async arrive(): Promise<number> {
    return this.tx(async (cl) => {
      const now = this.clock();
      const due = await cl.query("SELECT * FROM inv_loads WHERE status = 'moving' AND arrive_at <= $1 ORDER BY arrive_at LIMIT 200 FOR UPDATE SKIP LOCKED", [now]);
      for (const l of due.rows) {
        await Inventory.add(cl, String(l.player_key), String(l.to_loc), { type: String(l.item_type), id: String(l.item_id) }, Number(l.qty));
        await cl.query("UPDATE inv_loads SET status = 'arrived', arrived_at = $2 WHERE id = $1 AND status = 'moving'", [l.id, now]);
      }
      return due.rows.length;
    });
  }

  /**
   * Legacy migration: all banked stock (mine_items, incl. pantry food), unsold fish (fish_catches, kept as individual fish
   * via inv_fish_loc) and kitchen fillets -> the owner's factory. Fails closed (nothing written) if any holder lacks exactly
   * one factory. Idempotent (marker row). Conservation asserted inside the transaction. Legacy rows are NOT deleted here.
   * `allow` must be passed explicitly by an operator after user confirmation; there is no automatic call site.
   */
  async migrateLegacyToFactory(allow: { confirmedBy: string }): Promise<{ status: 'done' | 'already'; report: Record<string, unknown> }> {
    if (!allow?.confirmedBy) throw new InventoryError('Legacy migration needs explicit confirmation.');
    return this.tx(async (cl) => {
      await cl.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
      const done = await cl.query('SELECT report FROM inv_migrations WHERE id = $1', [LEGACY_MIGRATION_ID]);
      if (done.rows[0]) return { status: 'already' as const, report: done.rows[0].report };
      // Freeze sources for the duration (writers block; nobody can add/remove legacy stock mid-migration).
      await cl.query('LOCK TABLE mine_items, fish_catches, kitchen_fillets, mine_factories IN SHARE ROW EXCLUSIVE MODE');
      const holders = await cl.query(`SELECT h.player_key, (SELECT count(*) FROM mine_factories f WHERE f.player_key = h.player_key AND f.level > 0)::int AS factories FROM (
        SELECT player_key FROM mine_items WHERE qty > 0 UNION SELECT player_key FROM fish_catches WHERE sold_at IS NULL UNION SELECT player_key FROM kitchen_fillets WHERE qty > 0) h`);
      const bad = holders.rows.filter((r) => r.factories !== 1);
      if (bad.length) throw new InventoryError(`Legacy migration held: ${bad.length} holder(s) without exactly one factory: ${bad.map((r) => `${r.player_key}(${r.factories})`).join(', ')}`);
      const neg = await cl.query('SELECT count(*)::int AS n FROM mine_items WHERE qty < 0'); if (neg.rows[0].n) throw new InventoryError('Legacy migration held: negative legacy stacks.');
      const pre = await cl.query(`SELECT player_key, item_type, item_id, sum(qty)::bigint AS q FROM (
        SELECT player_key, item_type, item_id, qty FROM mine_items WHERE qty > 0
        UNION ALL SELECT player_key, 'fillet', kind, qty FROM kitchen_fillets WHERE qty > 0) s GROUP BY 1,2,3`);
      const preFish = await cl.query('SELECT player_key, species, count(*)::int AS n FROM fish_catches WHERE sold_at IS NULL GROUP BY 1,2');
      const k = (r: Record<string, any>) => `${r.player_key}|${r.item_type}|${r.item_id}`;
      const base = new Map((await cl.query("SELECT player_key, item_type, item_id, qty FROM inv_stock WHERE loc_id = 'factory:' || player_key FOR UPDATE")).rows.map((r) => [k(r), Number(r.qty)]));
      for (const r of pre.rows) await Inventory.add(cl, String(r.player_key), factoryLoc(String(r.player_key)), { type: String(r.item_type), id: String(r.item_id) }, Number(r.q));
      await cl.query("INSERT INTO inv_fish_loc (fish_id, player_key, loc_id) SELECT id, player_key, 'factory:' || player_key FROM fish_catches WHERE sold_at IS NULL ON CONFLICT (fish_id) DO NOTHING");
      // Conservation: factory stock after = factory stock before + legacy total, for every (player,item).
      const post = await cl.query("SELECT player_key, item_type, item_id, qty FROM inv_stock WHERE loc_id = 'factory:' || player_key");
      const pm = new Map(pre.rows.map((r) => [k(r), Number(r.q)])); const qm = new Map(post.rows.map((r) => [k(r), Number(r.qty)]));
      for (const [key, q0] of pm) { const q = q0 + (base.get(key) ?? 0); if (qm.get(key) !== q) throw new InventoryError(`Conservation failed at ${key}: ${q} -> ${qm.get(key)}`); }
      for (const [key, q] of base) if (!pm.has(key) && qm.get(key) !== q) throw new InventoryError(`Conservation failed at ${key}`);
      const postFish = await cl.query("SELECT f.player_key, f.species, count(*)::int AS n FROM fish_catches f JOIN inv_fish_loc l ON l.fish_id = f.id AND l.loc_id = 'factory:' || f.player_key WHERE f.sold_at IS NULL GROUP BY 1,2");
      if (JSON.stringify(preFish.rows.map((r) => [r.player_key, r.species, r.n]).sort()) !== JSON.stringify(postFish.rows.map((r) => [r.player_key, r.species, r.n]).sort())) throw new InventoryError('Conservation failed for fish.');
      const report = { holders: holders.rows.length, stacks: pre.rows.length, units: pre.rows.reduce((a, r) => a + Number(r.q), 0), fish: preFish.rows.reduce((a, r) => a + r.n, 0), confirmedBy: allow.confirmedBy };
      await cl.query('INSERT INTO inv_migrations (id, at, report) VALUES ($1,$2,$3)', [LEGACY_MIGRATION_ID, this.clock(), JSON.stringify(report)]);
      return { status: 'done' as const, report };
    });
  }
}
export { WAREHOUSE_LOC };

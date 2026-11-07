/**
 * Map pools (Dayne 2026-11-07, t1942u + t1945u): farming / logistics / inventory go back to the pre-Millionaire model
 * (3c5e4c7: ONE global store per owner, no locations), except that goods are now on a MAP: each owner has ONE shared
 * inventory per map ("the warehouse on each map"), and only cross-map moves (ship / plane) remain as logistics.
 *
 *   city    -> loc 'warehouse' (the Chud City Warehouse: loc_stock rows + fish/dish rows with loc 'warehouse')
 *   resort  -> loc 'resort'    (the Resort Warehouse: loc_stock rows + fish/dish rows with loc 'resort')
 *   The owner's factory store ('factory': mine_items banked stacks, factory crops, fish/dishes with loc 'factory') is
 *   NOT folded: it is the factory's input/output store on the city map, as banked storage was pre-update; moves between
 *   it and the city warehouse are instant and free (same map).
 *   fortmc  -> the Fort McChud store (already a single per-owner map store; untouched here)
 *
 * foldToMapPools() is the one-time forward migration from the per-location model (7eda887) into those pools:
 *  - ONE transaction, under a transaction-scoped advisory lock (two booting processes serialise; the second sees the
 *    marker and does nothing), so a crash/lost COMMIT leaves either everything or nothing (re-run is safe either way);
 *  - item keys are NEVER converted (crop:wheat stays crop:wheat), so per owner/item totals are compared before/after
 *    inside the same transaction and any mismatch rolls the whole fold back;
 *  - fish / dish rows keep their id, species, weight, value, quality; only their loc changes;
 *  - in-flight freight keeps status/qty; a transit leg's to_loc is re-pointed at the pool of its to_hub so it lands
 *    exactly once (the existing transit->delivered guard) in the right pool;
 *  - legacy HELD entries (rows the 7eda887 migration left untouched: loc IS NULL fish/dishes, kitchen_fillets > 0,
 *    building_inv 'resort_farm') are NOT touched and are listed in the report.
 */
export const CITY_POOL = 'warehouse';
export const RESORT_POOL = 'resort';
export const FOLD_ID = 'map-pools-v1';
const LOCK = 7_420_011; // pg_advisory_xact_lock key for the fold

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }> };
export type Client = Q & { release?: () => void };
export type FoldPool = { connect: () => Promise<Client> };

/** Map of a per-location id (see shared/inventoryLocations.ts). Kitchens need the home's map. */
export function hubOfLocId(loc: string, resortHomes: ReadonlySet<string>): 'city' | 'resort' | 'fortmc' | null {
  if (loc === 'factory' || loc === 'warehouse') return 'city';
  if (loc === 'resort' || loc === 'coral') return 'resort';
  const i = loc.indexOf(':'); if (i < 1) return null; const kind = loc.slice(0, i), ref = loc.slice(i + 1);
  if (kind === 'mine') return 'city';
  if (kind === 'farm') return ref.startsWith('rf:') ? 'resort' : 'city';
  if (kind === 'fishing') return ref === 'lake' ? 'city' : (ref === 'reef' || ref === 'deep') ? 'resort' : null;
  if (kind === 'kitchen') return resortHomes.has(ref) ? 'resort' : 'city';
  return null;
}
export const poolOfHub = (h: string): string | null => (h === 'city' ? CITY_POOL : h === 'resort' ? RESORT_POOL : null);
export function poolOfLoc(loc: string, resortHomes: ReadonlySet<string>): string | null { const h = hubOfLocId(loc, resortHomes); return h ? poolOfHub(h) : null; }


export interface FoldReport {
  id: string; already: boolean; conserved: boolean;
  stacks: number; units: number; fish: number; dishes: number; coral: number; freightRepointed: number;
  unknownLocs: Array<{ table: string; loc: string; n: number }>;
  heldLegacy: { fishNullLoc: number; dishNullLoc: number; fillets: number; resortBarn: number };
}

/** Per owner|map|item totals of everything the fold touches (and the held legacy rows, which must not move). */
async function totals(cl: Q, resortHomes: string[]) {
  const t = new Map<string, number>(); const add = (k: string, n: number) => t.set(k, (t.get(k) ?? 0) + n);
  const homes = new Set(resortHomes);
  const hub = (loc: string) => (loc === 'factory' ? 'factory' : loc.startsWith('transit:') ? loc : hubOfLocId(loc, homes) ?? `?${loc}`);
  for (const r of (await cl.query('SELECT player_key k, loc, item, qty FROM loc_stock WHERE qty > 0')).rows) add(`${r.k}|${hub(String(r.loc))}|${r.item}`, Number(r.qty));
  for (const r of (await cl.query('SELECT player_key k, item_type t, item_id i, qty FROM mine_items WHERE qty > 0')).rows) add(`${r.k}|factory|${r.t}:${r.i}`, Number(r.qty));
  for (const r of (await cl.query("SELECT player_key k, item, qty FROM building_inv WHERE building = 'coral' AND qty > 0")).rows) add(`${r.k}|resort|${r.item}`, Number(r.qty));
  for (const r of (await cl.query("SELECT player_key k, coalesce(loc,'<null>') loc, species s, (dish IS NOT NULL) d, count(*)::int n, sum(value)::bigint v FROM fish_catches WHERE sold_at IS NULL GROUP BY 1,2,3,4")).rows) { const h = r.loc === '<null>' ? 'held' : hub(String(r.loc)); add(`${r.k}|${h}|${r.d ? 'fdish' : 'fish'}:${r.s}`, Number(r.n)); add(`${r.k}|${h}|value`, Number(r.v)); }
  for (const r of (await cl.query("SELECT player_key k, coalesce(loc,'<null>') loc, recipe s, count(*)::int n, sum(value)::bigint v FROM kitchen_dishes WHERE sold_at IS NULL GROUP BY 1,2,3")).rows) { const h = r.loc === '<null>' ? 'held' : hub(String(r.loc)); add(`${r.k}|${h}|dish:${r.s}`, Number(r.n)); add(`${r.k}|${h}|dvalue`, Number(r.v)); }
  for (const r of (await cl.query('SELECT player_key k, kind, qty FROM kitchen_fillets WHERE qty > 0')).rows) add(`${r.k}|held|fillet:${r.kind}`, Number(r.qty));
  for (const r of (await cl.query("SELECT player_key k, item, qty FROM building_inv WHERE building = 'resort_farm' AND qty > 0")).rows) add(`${r.k}|held|barn:${r.item}`, Number(r.qty));
  for (const r of (await cl.query("SELECT player_key k, to_hub h, item_type t, item_id i, sum(qty)::bigint q FROM freight_shipments WHERE status IN ('transit','moving') GROUP BY 1,2,3,4")).rows) add(`${r.k}|freight>${r.h}|${r.t}:${r.i}`, Number(r.q));
  return t;
}
const same = (a: Map<string, number>, b: Map<string, number>) => { const bad: string[] = []; for (const k of new Set([...a.keys(), ...b.keys()])) if ((a.get(k) ?? 0) !== (b.get(k) ?? 0)) bad.push(`${k}: ${a.get(k) ?? 0} -> ${b.get(k) ?? 0}`); return bad; };

/** Tables the fold reads must exist (fresh/dev DBs). Never drops anything. */
export const FOLD_PREP = `
CREATE TABLE IF NOT EXISTS loc_stock (player_key TEXT NOT NULL, name TEXT NOT NULL, loc TEXT NOT NULL, item TEXT NOT NULL, qty BIGINT NOT NULL CHECK (qty >= 0), PRIMARY KEY (player_key, loc, item));
CREATE TABLE IF NOT EXISTS loc_migrations (id TEXT PRIMARY KEY, at BIGINT NOT NULL, report JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS mine_items (player_key TEXT NOT NULL, owner_name TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (player_key, item_type, item_id));
CREATE TABLE IF NOT EXISTS building_inv (player_key TEXT NOT NULL, name TEXT NOT NULL, building TEXT NOT NULL, item TEXT NOT NULL, qty BIGINT NOT NULL, PRIMARY KEY (player_key, building, item));
CREATE TABLE IF NOT EXISTS fish_catches (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, species TEXT NOT NULL, weight_g INTEGER NOT NULL, value INTEGER NOT NULL, caught_at BIGINT NOT NULL, sold_at BIGINT);
ALTER TABLE fish_catches ADD COLUMN IF NOT EXISTS loc TEXT; ALTER TABLE fish_catches ADD COLUMN IF NOT EXISTS dish TEXT;
CREATE TABLE IF NOT EXISTS kitchen_dishes (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, recipe TEXT NOT NULL, quality REAL NOT NULL, value INTEGER NOT NULL, cooked_at BIGINT NOT NULL, sold_at BIGINT);
ALTER TABLE kitchen_dishes ADD COLUMN IF NOT EXISTS loc TEXT;
CREATE TABLE IF NOT EXISTS kitchen_fillets (player_key TEXT NOT NULL, kind TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0), PRIMARY KEY (player_key, kind));
CREATE TABLE IF NOT EXISTS freight_shipments (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, to_key TEXT NOT NULL, to_name TEXT NOT NULL,
  mode TEXT NOT NULL, truck TEXT, from_hub TEXT NOT NULL, to_hub TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL, fee BIGINT NOT NULL,
  created_at BIGINT NOT NULL, depart_at BIGINT NOT NULL, arrive_at BIGINT NOT NULL, status TEXT NOT NULL);
ALTER TABLE freight_shipments ADD COLUMN IF NOT EXISTS from_loc TEXT; ALTER TABLE freight_shipments ADD COLUMN IF NOT EXISTS to_loc TEXT;`;

/**
 * Run the fold once. `resortHomes`: property ids on the resort map (kitchens there fold into the resort pool).
 * `failAt` is test-only fault injection ('afterMove' throws inside the transaction before COMMIT).
 */
export async function foldToMapPools(pool: FoldPool, resortHomes: string[], opts: { now?: number; failAt?: 'afterMove' } = {}): Promise<FoldReport> {
  const cl = await pool.connect();
  const homes = new Set(resortHomes);
  try {
    await cl.query(FOLD_PREP);
    await cl.query('BEGIN');
    await cl.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
    const done = (await cl.query('SELECT report FROM loc_migrations WHERE id = $1', [FOLD_ID])).rows[0];
    if (done) { await cl.query('COMMIT'); return { ...(done.report as FoldReport), already: true }; }
    const before = await totals(cl, resortHomes);
    const r: FoldReport = { id: FOLD_ID, already: false, conserved: false, stacks: 0, units: 0, fish: 0, dishes: 0, coral: 0, freightRepointed: 0, unknownLocs: [], heldLegacy: { fishNullLoc: 0, dishNullLoc: 0, fillets: 0, resortBarn: 0 } };

    // 1) loc_stock stacks -> their map pool. City pack types go to mine_items (the banked store the factory loc reads).
    const rows = (await cl.query("SELECT player_key, name, loc, item, qty FROM loc_stock WHERE qty > 0 AND loc NOT IN ($1,$2,'factory') ORDER BY player_key, loc, item", [CITY_POOL, RESORT_POOL])).rows;
    for (const x of rows) {
      const key = String(x.player_key), name = String(x.name), loc = String(x.loc), item = String(x.item), qty = Number(x.qty);
      const to = poolOfLoc(loc, homes);
      if (!to) { r.unknownLocs.push({ table: 'loc_stock', loc, n: qty }); continue; } // left untouched, reported
      await cl.query(`INSERT INTO loc_stock (player_key, name, loc, item, qty) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (player_key, loc, item) DO UPDATE SET qty = loc_stock.qty + EXCLUDED.qty`, [key, name, to, item, qty]);
      const d = await cl.query('DELETE FROM loc_stock WHERE player_key = $1 AND loc = $2 AND item = $3 AND qty = $4', [key, loc, item, qty]);
      if (d.rowCount !== 1) throw new Error(`fold: loc_stock row changed underneath (${key} ${loc} ${item})`);
      r.stacks++; r.units += qty;
    }
    // 2) Coral Grotto haul bin -> resort pool.
    for (const x of (await cl.query("SELECT player_key, name, item, qty FROM building_inv WHERE building = 'coral' AND qty > 0")).rows) {
      await cl.query(`INSERT INTO loc_stock (player_key, name, loc, item, qty) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (player_key, loc, item) DO UPDATE SET qty = loc_stock.qty + EXCLUDED.qty`, [x.player_key, x.name, RESORT_POOL, x.item, x.qty]);
      const d = await cl.query("UPDATE building_inv SET qty = 0 WHERE player_key = $1 AND building = 'coral' AND item = $2 AND qty = $3", [x.player_key, x.item, x.qty]);
      if (d.rowCount !== 1) throw new Error('fold: coral row changed underneath');
      r.coral += Number(x.qty);
    }
    // 3) fish / dish rows: only loc changes (identity, species, weight, value, quality kept). NULL loc = legacy held: untouched.
    for (const [table, field] of [['fish_catches', 'fish'], ['kitchen_dishes', 'dishes']] as const) {
      for (const x of (await cl.query(`SELECT loc, count(*)::int n FROM ${table} WHERE sold_at IS NULL AND loc IS NOT NULL AND loc NOT IN ($1,$2,'factory') AND loc NOT LIKE 'transit:%' GROUP BY loc` /* in-flight rows land via their (re-pointed) shipment */, [CITY_POOL, RESORT_POOL])).rows) {
        const loc = String(x.loc); const to = poolOfLoc(loc, homes);
        if (!to) { r.unknownLocs.push({ table, loc, n: Number(x.n) }); continue; }
        const u = await cl.query(`UPDATE ${table} SET loc = $2 WHERE loc = $1 AND sold_at IS NULL`, [loc, to]);
        r[field] += u.rowCount ?? 0;
      }
    }
    // 4) in-flight freight: re-point the landing location at the destination map's pool (status / qty untouched).
    for (const x of (await cl.query("SELECT id, to_hub, to_loc FROM freight_shipments WHERE status IN ('transit','moving') AND to_loc IS NOT NULL")).rows) {
      const to = poolOfHub(String(x.to_hub)); if (!to || to === x.to_loc || x.to_loc === 'factory') continue;
      const u = await cl.query("UPDATE freight_shipments SET to_loc = $2 WHERE id = $1 AND status IN ('transit','moving') AND to_loc = $3", [x.id, to, x.to_loc]);
      r.freightRepointed += u.rowCount ?? 0;
    }
    // 5) held legacy (reported, untouched)
    r.heldLegacy = {
      fishNullLoc: Number((await cl.query('SELECT count(*)::int n FROM fish_catches WHERE loc IS NULL AND sold_at IS NULL')).rows[0]!.n),
      dishNullLoc: Number((await cl.query('SELECT count(*)::int n FROM kitchen_dishes WHERE loc IS NULL AND sold_at IS NULL')).rows[0]!.n),
      fillets: Number((await cl.query('SELECT coalesce(sum(qty),0)::bigint n FROM kitchen_fillets WHERE qty > 0')).rows[0]!.n),
      resortBarn: Number((await cl.query("SELECT coalesce(sum(qty),0)::bigint n FROM building_inv WHERE building = 'resort_farm' AND qty > 0")).rows[0]!.n),
    };
    if (opts.failAt === 'afterMove') throw new Error('test: fold failed before COMMIT');
    // 6) conservation per owner|map|item (and fish/dish value sums), inside the same transaction
    const bad = same(before, await totals(cl, resortHomes));
    if (bad.length) throw new Error(`fold: CONSERVATION MISMATCH ${bad.slice(0, 5).join('; ')}`);
    r.conserved = true;
    await cl.query('INSERT INTO loc_migrations (id, at, report) VALUES ($1,$2,$3)', [FOLD_ID, opts.now ?? Date.now(), JSON.stringify(r)]);
    await cl.query('COMMIT');
    return r;
  } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; }
  finally { cl.release?.(); }
}

/** Boot step (index.ts): right after this process takes the inventory fence and BEFORE any inventory store loads, so
 *  every store reads the folded state. No DB = dev memory mode, nothing to fold. A failure throws: boot fails closed
 *  (the fence keeps every other writer out; nothing was committed because the fold is one transaction). */
export async function initMapPools(dbUrl: string | undefined, resortHomes: string[]): Promise<FoldReport | null> {
  if (!dbUrl) return null;
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: dbUrl, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const t0 = Date.now(); const r = await foldToMapPools(pool, resortHomes);
    console.log(`[mapPools] ${r.already ? 'already folded' : 'folded'} in ${Date.now() - t0} ms:`, JSON.stringify({ stacks: r.stacks, units: r.units, fish: r.fish, dishes: r.dishes, coral: r.coral, freight: r.freightRepointed, unknown: r.unknownLocs.length, held: r.heldLegacy, conserved: r.conserved }));
    return r;
  } finally { await pool.end().catch(() => {}); }
}

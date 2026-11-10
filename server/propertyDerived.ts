/**
 * Plot-scoped rows that must follow the properties deed (farm tiles, upgrades, soil, auto-farm, fertilizer,
 * and a sold home's placed furniture). Ownership changes call releasePropertyDerived in the same transaction
 * as the deed write. healStalePropertyDerived recomputes from properties and never touches chip balances.
 *
 * Each statement is isolated with a savepoint so a missing table cannot abort the deed transaction.
 */
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rowCount?: number | null; rows: Array<Record<string, unknown>> }> };

const missing = (e: unknown) => /42P01|does not exist|relation .* does not exist/i.test((e as Error).message ?? '');

async function have(q: Q): Promise<Set<string>> {
  try {
    const r = await q.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    return new Set(r.rows.map((x) => String(x.table_name)));
  } catch { return new Set(); }
}

async function exec(q: Q, sql: string, args: unknown[] = []): Promise<number> {
  try { await q.query('SAVEPOINT property_derived'); }
  catch { /* not in a transaction (heal on boot): run the statement directly */ return execPlain(q, sql, args); }
  try {
    const n = Number((await q.query(sql, args)).rowCount ?? 0);
    await q.query('RELEASE SAVEPOINT property_derived');
    return n;
  } catch (e) {
    await q.query('ROLLBACK TO SAVEPOINT property_derived').catch(() => {});
    if (missing(e)) return 0;
    throw e;
  }
}

async function execPlain(q: Q, sql: string, args: unknown[] = []): Promise<number> {
  try { return Number((await q.query(sql, args)).rowCount ?? 0); }
  catch (e) { if (missing(e)) return 0; throw e; }
}

async function staleKeys(q: Q, table: string): Promise<Array<{ id: string; owner: string }>> {
  const r = await execSelect(q, `SELECT t.plot_id AS id, t.owner_key AS owner FROM ${table} t
    LEFT JOIN properties p ON p.id = t.plot_id AND p.owner_key = t.owner_key WHERE p.id IS NULL`);
  const seen = new Set<string>(); const out: Array<{ id: string; owner: string }> = [];
  for (const row of r) {
    const id = String(row.id), owner = String(row.owner); const k = `${id}\0${owner}`;
    if (seen.has(k)) continue; seen.add(k); out.push({ id, owner });
  }
  return out;
}

async function execSelect(q: Q, sql: string, args: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  try { return (await q.query(sql, args)).rows; }
  catch (e) { if (missing(e)) return []; throw e; }
}

/** Drop this owner's derived rows for one property. Call on the same client as the deed DELETE/UPDATE. */
export async function releasePropertyDerived(cl: Q, id: string, ownerKey: string): Promise<void> {
  const t = await have(cl);
  if (t.has('farm_tiles')) await exec(cl, 'DELETE FROM farm_tiles WHERE plot_id = $1 AND owner_key = $2', [id, ownerKey]);
  if (t.has('farm_upgrades')) await exec(cl, 'DELETE FROM farm_upgrades WHERE plot_id = $1 AND owner_key = $2', [id, ownerKey]);
  if (t.has('farm_soil')) await exec(cl, 'DELETE FROM farm_soil WHERE plot_id = $1 AND owner_key = $2', [id, ownerKey]);
  if (t.has('farm_auto')) await exec(cl, 'DELETE FROM farm_auto WHERE plot_id = $1 AND owner_key = $2', [id, ownerKey]);
  if (t.has('farm_fert') && t.has('farm_tiles')) {
    await exec(cl, `DELETE FROM farm_fert WHERE plot_id = $1 AND NOT EXISTS (
      SELECT 1 FROM farm_tiles x WHERE x.plot_id = farm_fert.plot_id AND x.tile = farm_fert.tile AND x.nonce = farm_fert.nonce)`, [id]);
  } else if (t.has('farm_fert')) {
    await exec(cl, 'DELETE FROM farm_fert WHERE plot_id = $1', [id]);
  }
  if (t.has('home_layout')) await exec(cl, "UPDATE home_layout SET items = '[]' WHERE property_id = $1 AND owner_key = $2", [id, ownerKey]);
}

export interface HealCounts { tiles: number; upgrades: number; soil: number; auto: number; fert: number; homes: number }

/** Delete or reset derived rows whose owner_key no longer matches the properties deed. Idempotent; no wallet writes. */
export async function healStalePropertyDerived(q: Q): Promise<HealCounts> {
  const t = await have(q);
  const delOwned = async (table: keyof HealCounts & string, name: string) => {
    if (!t.has(name)) return 0;
    const rows = await staleKeys(q, name);
    let n = 0;
    for (const r of rows) n += await exec(q, `DELETE FROM ${name} WHERE plot_id = $1 AND owner_key = $2`, [r.id, r.owner]);
    return n;
  };
  const tiles = await delOwned('tiles', 'farm_tiles');
  const upgrades = await delOwned('upgrades', 'farm_upgrades');
  const soil = await delOwned('soil', 'farm_soil');
  const auto = await delOwned('auto', 'farm_auto');
  let fert = 0;
  if (t.has('farm_fert')) {
    const rows = await execSelect(q, `SELECT f.plot_id AS id, f.tile, f.nonce FROM farm_fert f
      LEFT JOIN farm_tiles x ON x.plot_id = f.plot_id AND x.tile = f.tile AND x.nonce = f.nonce
      LEFT JOIN properties p ON p.id = x.plot_id AND p.owner_key = x.owner_key
      WHERE x.plot_id IS NULL OR p.id IS NULL`);
    for (const r of rows) fert += await exec(q, 'DELETE FROM farm_fert WHERE plot_id = $1 AND tile = $2 AND nonce = $3', [r.id, r.tile, r.nonce]);
  }
  let homes = 0;
  if (t.has('home_layout')) {
    const rows = await execSelect(q, `SELECT h.property_id AS id, h.owner_key AS owner FROM home_layout h
      LEFT JOIN properties p ON p.id = h.property_id AND p.owner_key = h.owner_key WHERE p.id IS NULL`);
    for (const r of rows) homes += await exec(q, "UPDATE home_layout SET items = '[]' WHERE property_id = $1 AND owner_key = $2", [String(r.id), String(r.owner)]);
  }
  const out = { tiles, upgrades, soil, auto, fert, homes };
  if (Object.values(out).some((n) => n > 0)) console.log('[property] healed stale derived rows', out);
  return out;
}

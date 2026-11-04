/**
 * #31 (chessguy2): hourly server-side net worth snapshots for ALL players, so profile charts have no gaps even when
 * nobody opens a profile. Read-only for chips and the ledger: chips come from one casino_players SELECT, assets from
 * the same Economy.playerAssets used by the profile. Rows are written in batched multi-row INSERTs into
 * networth_history (additive migration only). Dedupe with the on-open profile snapshot: a player who already has a
 * snapshot in the current UTC hour is skipped, and the profile skips its own insert when one exists within the hour.
 */
import pg from 'pg';
import { databaseUrl } from './leaderboard-store.js';
import { getEconomy } from './economy.js';

export const HOUR = 3_600_000;
export const NETWORTH_MIGRATION = [
  'CREATE TABLE IF NOT EXISTS networth_history (player_key TEXT NOT NULL, t BIGINT NOT NULL, net BIGINT NOT NULL, chips BIGINT NOT NULL, PRIMARY KEY (player_key, t))',
  'CREATE INDEX IF NOT EXISTS networth_history_t_idx ON networth_history (t)',
];
const BATCH = 200;
const CONCURRENCY = 4;

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
export interface SnapshotDeps { db: Q; assets: (name: string, now: number) => Promise<number>; now: number }

/** Take one snapshot pass. Returns how many rows were written. */
export async function snapshotAllNetWorth({ db, assets, now }: SnapshotDeps): Promise<number> {
  for (const s of NETWORTH_MIGRATION) await db.query(s);
  const hourStart = Math.floor(now / HOUR) * HOUR;
  const done = new Set((await db.query('SELECT DISTINCT player_key FROM networth_history WHERE t >= $1 AND t < $2', [hourStart, hourStart + HOUR])).rows.map((r) => String(r.player_key)));
  const players = (await db.query('SELECT player_key, name, chips FROM casino_players ORDER BY player_key')).rows
    .map((r) => ({ key: String(r.player_key), name: String(r.name), chips: Number(r.chips) }))
    .filter((p) => !done.has(p.key));
  const rows: Array<[string, number, number, number]> = [];
  for (let i = 0; i < players.length; i += CONCURRENCY) {
    const part = players.slice(i, i + CONCURRENCY);
    const vals = await Promise.all(part.map((p) => assets(p.name, now).catch(() => 0)));
    part.forEach((p, j) => rows.push([p.key, hourStart, Math.round(p.chips + (vals[j] || 0)), Math.round(p.chips)]));
  }
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH); const args: unknown[] = [];
    const ph = chunk.map((r, j) => { args.push(...r); const b = j * 4; return `($${b + 1},$${b + 2},$${b + 3},$${b + 4})`; }).join(',');
    await db.query(`INSERT INTO networth_history (player_key, t, net, chips) VALUES ${ph} ON CONFLICT DO NOTHING`, args);
    written += chunk.length;
  }
  return written;
}

let pool: pg.Pool | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Run a pass a couple of minutes after each UTC hour (and once shortly after boot). */
export function startNetWorthSnapshots(): void {
  const url = databaseUrl(); if (!url || timer) return;
  pool ??= new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  const run = () => {
    const econ = getEconomy(); if (!econ || !pool) return;
    void snapshotAllNetWorth({ db: pool, now: Date.now(), assets: async (n, t) => (await econ.playerAssets(n, t))?.total ?? 0 })
      .catch((e) => console.error('[networth]', (e as Error).message));
  };
  const arm = () => { const now = Date.now(); timer = setTimeout(() => { run(); arm(); }, Math.floor(now / HOUR) * HOUR + HOUR + 120_000 - now); timer.unref?.(); };
  setTimeout(run, 180_000).unref?.();
  arm();
}

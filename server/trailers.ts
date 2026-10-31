/** Trailer Park: a stable lot per eligible player (trailer_lots table). Never touches player accounts. */
import express from 'express';
import pg from 'pg';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import { adminAuthorized } from './admin.js';
import { trailerExclusion, TRAILER_PARK_LIVE, type TrailerLot } from '../shared/trailerPark.js';

export const TRAILER_MIGRATION = `CREATE TABLE IF NOT EXISTS trailer_lots (
  player_key TEXT PRIMARY KEY,
  lot INT NOT NULL UNIQUE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export interface ParkPreview { eligible: { name: string; key: string; lot: number | null }[]; excluded: { name: string; key: string; reason: string }[] }

/** Who gets a trailer (oldest accounts first) and who doesn't, with the lots already assigned. Read-only. */
export async function previewPark(db: Queryable): Promise<ParkPreview> {
  await db.query(TRAILER_MIGRATION);
  const players = (await db.query('SELECT player_key, name FROM players ORDER BY created_at, player_key')).rows as { player_key: string; name: string }[];
  const flags = new Map<string, string[]>();
  try { for (const f of (await db.query('SELECT player_key, reason FROM arena_flags GROUP BY 1, 2')).rows as { player_key: string; reason: string }[]) (flags.get(f.player_key) ?? flags.set(f.player_key, []).get(f.player_key)!).push(f.reason); }
  catch { /* no arena_flags table yet */ }
  const lots = new Map(((await db.query('SELECT player_key, lot FROM trailer_lots')).rows as { player_key: string; lot: number }[]).map((r) => [r.player_key, Number(r.lot)]));
  const out: ParkPreview = { eligible: [], excluded: [] };
  for (const p of players) {
    const reason = trailerExclusion(p.name, flags.get(p.player_key) ?? []);
    if (reason) out.excluded.push({ name: p.name, key: p.player_key, reason });
    else out.eligible.push({ name: p.name, key: p.player_key, lot: lots.get(p.player_key) ?? null });
  }
  return out;
}

/** Give every eligible player without a lot the next free lot number (stable: existing lots never move). */
export async function assignLots(db: Queryable): Promise<TrailerLot[]> {
  const pv = await previewPark(db);
  const used = new Set(pv.eligible.flatMap((e) => (e.lot == null ? [] : [e.lot])));
  const all = ((await db.query('SELECT lot FROM trailer_lots')).rows as { lot: number }[]).map((r) => Number(r.lot));
  let next = Math.max(-1, ...all) + 1;
  for (const e of pv.eligible) if (e.lot == null) {
    const { rows } = await db.query('INSERT INTO trailer_lots (player_key, lot) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING lot', [e.key, next]);
    if (rows.length) { e.lot = next; used.add(next); }
    next++;
  }
  return pv.eligible.filter((e) => e.lot != null).map((e) => ({ lot: e.lot!, name: e.name })).sort((a, b) => a.lot - b.lot);
}

let pool: pg.Pool | null = null;
const getPool = () => { const url = databaseUrl(); if (!url) return null; return (pool ??= new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 })); };
let cache: { at: number; lots: TrailerLot[] } | null = null;

export function trailerRouter(live = TRAILER_PARK_LIVE): express.Router {
  const r = express.Router();
  /** Public: the park's lots (name + lot number). Refreshed at most once a minute, which also gives new players a lot. */
  r.get('/api/trailer-park', async (_req, res) => {
    const db = getPool();
    if (!live || !db) return res.json({ ok: true, lots: [] });
    try {
      if (!cache || Date.now() - cache.at > 60_000) cache = { at: Date.now(), lots: await assignLots(db) };
      res.json({ ok: true, lots: cache.lots });
    } catch (e) { console.error('[trailers] failed:', (e as Error).message); res.json({ ok: true, lots: cache?.lots ?? [] }); }
  });
  /** Admin (bearer token): who gets a trailer and who's excluded, and why. Read-only. */
  r.get('/api/admin/trailer-park', async (req, res) => {
    if (!adminAuthorized(req.get('authorization'))) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    const db = getPool(); if (!db) return res.status(503).json({ ok: false, error: 'No database.' });
    try { const pv = await previewPark(db); res.json({ ok: true, live, eligible: pv.eligible.map(({ name, lot }) => ({ name, lot })), excluded: pv.excluded.map(({ name, reason }) => ({ name, reason })) }); }
    catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });
  return r;
}

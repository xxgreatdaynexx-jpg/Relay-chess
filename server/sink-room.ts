/** Per-player chips lost to sinks today (UTC), read from the wallet ledger: live via bank.onChange, seeded from
 * wallet_transactions at boot so a restart mid-day keeps the room. Read-only: it never moves chips. */
import pg from 'pg';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { playerKey } from './skins.js';
import { dayKey } from '../shared/mines.js';
import { SinkDay } from '../shared/sinkRoom.js';

const days = new Map<string, SinkDay>();
const seen = new Set<string>();
export function recordSink(name: string, row: { game: string; amount: number; memo?: string | null; key?: string | null }, now = Date.now()) {
  if (row.key) { if (seen.has(row.key)) return; seen.add(row.key); }
  const k = playerKey(name); let d = days.get(k); if (!d) days.set(k, (d = new SinkDay()));
  d.add(dayKey(now), row);
}
export const sinkLostToday = (name: string, now = Date.now()) => days.get(playerKey(name))?.lost(dayKey(now)) ?? 0;
export const sinkKeysToday = (now = Date.now()) => { const day = dayKey(now); return [...days].filter(([, d]) => d.day === day && d.lost(day) > 0).map(([k]) => k); };
export const resetSinkRoomForTest = () => { days.clear(); seen.clear(); };

export function startSinkRoom(): void {
  getBank().onChange((_a, tx) => recordSink(tx.name, tx));
  const url = databaseUrl(); if (!url) return;
  const db = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  const start = Math.floor(Date.now() / 86_400_000) * 86_400_000;
  void db.query(`SELECT name, game, amount, memo, tx_key FROM wallet_transactions WHERE created_at >= to_timestamp($1/1000.0) ORDER BY id`, [start])
    .then((r) => { for (const x of r.rows) recordSink(String(x.name), { game: String(x.game), amount: Number(x.amount), memo: x.memo, key: x.tx_key }); console.log(`[sink-room] seeded ${r.rowCount} rows`); })
    .catch((e) => console.error('[sink-room] seed failed:', (e as Error).message)).finally(() => void db.end().catch(() => {}));
}

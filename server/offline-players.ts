/** Read-only directory of offline players worth enough to remain visible in chat. */
import pg from 'pg';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { getEconomy } from './economy.js';
import { isBotName, isGuestName } from './accounts.js';
import { isQaName } from '../shared/qa.js';
import { isDisabledName } from '../shared/disabled.js';

export const PLAYER_LIST_MIN_NET_WORTH = 10_000;
export interface OfflinePlayer { name: string; lastSeen: number | null }

let pool: pg.Pool | null = null;
const getPool = (): Queryable | null => {
  const url = databaseUrl(); if (!url) return null;
  return (pool ??= new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 }));
};

/**
 * Existing durable activity only: playtime's last active heartbeat, or the latest session login.
 * No account/player writes. Accounts without either timestamp still appear, with an unknown time.
 */
export async function loadOfflinePlayers(db: Queryable | null = getPool(), now = Date.now()): Promise<OfflinePlayer[]> {
  if (!db) return [];
  const result = await db.query(`SELECT p.player_key, p.name, p.disabled_at, p.created_at,
    pp.updated_at AS play_seen, MAX(s.created_at) AS session_seen
    FROM players p
    LEFT JOIN player_playtime pp ON pp.player_key = p.player_key
    LEFT JOIN player_sessions s ON s.player_key = p.player_key
    GROUP BY p.player_key, p.name, p.disabled_at, p.created_at, pp.updated_at
    ORDER BY p.player_key`);
  const bank = getBank(); const econ = getEconomy(); const out: OfflinePlayer[] = [];
  for (const row of result.rows) {
    const name = String(row.name);
    if (row.disabled_at || isDisabledName(name) || isGuestName(name) || isBotName(name) || isQaName(name)) continue;
    const chips = await bank.refresh(name).catch(() => bank.account(name).chips);
    const assets = (await econ?.playerAssets(name, now).catch(() => null))?.total ?? 0;
    if (chips + assets < PLAYER_LIST_MIN_NET_WORTH) continue;
    const playSeen = Number(row.play_seen ?? 0);
    const sessionSeen = row.session_seen ? new Date(row.session_seen as string | Date).getTime() : 0;
    const lastSeen = Math.max(playSeen, sessionSeen);
    out.push({ name, lastSeen: Number.isFinite(lastSeen) && lastSeen > 0 ? lastSeen : null });
  }
  return out;
}

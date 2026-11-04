import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import { signedIn } from './auth-sockets.js';
import { creditFor } from '../shared/playtime.js';

const pkey = (n: string) => n.replace(/\s+/g, ' ').trim().toLowerCase();

/** Per-user total play time. Credit is per USER (not per tab), so multiple tabs never double-count. */
export class PlayTimeStore {
  db: Queryable | null = null;
  private mem = new Map<string, number>();
  private last = new Map<string, number>();
  async attach(db: Queryable): Promise<void> {
    await db.query(`CREATE TABLE IF NOT EXISTS player_playtime (player_key TEXT PRIMARY KEY, play_ms BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0)`);
    this.db = db;
  }
  /** Handle a heartbeat. Inactive beats reset the anchor so idle time is never credited later. */
  async beat(name: string, now: number, active: boolean): Promise<number> {
    const k = pkey(name);
    const add = creditFor(this.last.get(k), now, active);
    if (active) this.last.set(k, now); else this.last.delete(k);
    if (this.last.size > 20_000) this.last.clear();
    if (add <= 0) return 0;
    if (this.db) await this.db.query(`INSERT INTO player_playtime (player_key, play_ms, updated_at) VALUES ($1,$2,$3) ON CONFLICT (player_key) DO UPDATE SET play_ms = player_playtime.play_ms + EXCLUDED.play_ms, updated_at = EXCLUDED.updated_at`, [k, add, now]);
    else this.mem.set(k, (this.mem.get(k) ?? 0) + add);
    return add;
  }
  async total(name: string): Promise<number> {
    const k = pkey(name);
    if (this.db) { const r = await this.db.query(`SELECT play_ms FROM player_playtime WHERE player_key=$1`, [k]); return Number(r.rows[0]?.play_ms ?? 0); }
    return this.mem.get(k) ?? 0;
  }
}

let store = new PlayTimeStore();
export const getPlayTime = () => store;
export function resetPlayTime(): PlayTimeStore { store = new PlayTimeStore(); return store; }

export async function initPlayTimeStorage(): Promise<void> {
  const url = databaseUrl();
  if (!url) { console.warn('[playtime] no DATABASE_URL; in-memory only'); return; }
  try {
    const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
    pool.on('error', (e) => console.error('[playtime] pool error:', e.message));
    await store.attach(pool);
  } catch (e) { console.error('[playtime] postgres attach failed:', (e as Error).message); }
}

export function registerPlayTime(_io: Server, socket: Socket): void {
  let lastBeat = 0;
  socket.on('play_beat', async (p: unknown) => {
    const now = Date.now();
    if (now - lastBeat < 20_000) return; // per-socket flood guard
    lastBeat = now;
    let name = ''; try { name = signedIn(socket); } catch { return; }
    const active = (p as { active?: unknown } | null)?.active === true;
    try { await store.beat(name, now, active); } catch (e) { console.error('[playtime] beat failed:', (e as Error).message); }
  });
}

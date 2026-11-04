/**
 * Admin jail (pt1478u). Postgres table `jail` is the source of truth; an in-memory map mirrors it for the per-event
 * socket gate. Jailing never moves chips. Release: timer runs out, the player types JAIL_PHRASE JAIL_LINES_NEEDED
 * times (server-counted, one line per submit, rate-limited), or an admin unjails.
 */
import pg from 'pg';
import { databaseUrl } from './leaderboard-store.js';
import { nameKey } from './accounts.js';
import { isApology, JAIL_LINES_NEEDED, JAIL_MIN_GAP_MS, jailMessage, type JailInfo } from '../shared/jail.js';

export class JailError extends Error {}

export class Jail {
  private m = new Map<string, JailInfo>();
  private last = new Map<string, number>();
  onChange: (name: string, j: JailInfo | null) => void = () => {};
  constructor(private pool: pg.Pool | null) {}
  async init(): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(`CREATE TABLE IF NOT EXISTS jail (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, reason TEXT NOT NULL, until_ms BIGINT, typed INT NOT NULL DEFAULT 0, needed INT NOT NULL, jailed_ms BIGINT NOT NULL)`);
    const r = await this.pool.query('SELECT * FROM jail');
    for (const x of r.rows) this.m.set(String(x.player_key), { name: String(x.name), reason: String(x.reason), until: x.until_ms == null ? null : Number(x.until_ms), typed: Number(x.typed), needed: Number(x.needed), at: Number(x.jailed_ms) });
  }
  /** Current jail record, or null. Expired sentences are released on read. */
  status(name: string | null | undefined, now = Date.now()): JailInfo | null {
    if (!name) return null; const k = nameKey(name); const j = this.m.get(k); if (!j) return null;
    if (j.until != null && j.until <= now) { void this.release(name, 'time served'); return null; }
    return j;
  }
  isJailed(name: string | null | undefined, now = Date.now()): boolean { return !!this.status(name, now); }
  list(now = Date.now()): JailInfo[] { return [...this.m.values()].filter((j) => this.status(j.name, now)); }
  async jail(name: string, hours: number | null, reason: string, now = Date.now(), needed = JAIL_LINES_NEEDED): Promise<JailInfo> {
    const k = nameKey(name); const prev = this.m.get(k);
    const j: JailInfo = { name, reason, until: hours == null ? null : now + Math.round(hours * 3_600_000), typed: prev?.typed ?? 0, needed, at: now };
    if (this.pool) await this.pool.query(`INSERT INTO jail (player_key, name, reason, until_ms, typed, needed, jailed_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (player_key) DO UPDATE SET name=$2, reason=$3, until_ms=$4, typed=$5, needed=$6, jailed_ms=$7`, [k, j.name, j.reason, j.until, j.typed, j.needed, j.at]);
    this.m.set(k, j); console.log(`[jail] ${name} jailed ${hours == null ? 'until lines done' : `${hours}h`}: ${reason}`); this.onChange(name, j); return j;
  }
  async release(name: string, why: string): Promise<boolean> {
    const k = nameKey(name); const j = this.m.get(k); if (!j) return false;
    this.m.delete(k); this.last.delete(k);
    if (this.pool) await this.pool.query('DELETE FROM jail WHERE player_key = $1', [k]).catch((e) => console.error('[jail] release failed:', (e as Error).message));
    console.log(`[jail] ${j.name} released: ${why}`); this.onChange(j.name, null); return true;
  }
  /** One submitted line. Only an exact single-line match counts, at most one per JAIL_MIN_GAP_MS. */
  async apologize(name: string, text: unknown, now = Date.now()): Promise<{ counted: boolean; typed: number; needed: number; released: boolean; error?: string }> {
    const j = this.status(name, now); if (!j) return { counted: false, typed: 0, needed: JAIL_LINES_NEEDED, released: true };
    const k = nameKey(name);
    if (now - (this.last.get(k) ?? 0) < JAIL_MIN_GAP_MS) return { counted: false, typed: j.typed, needed: j.needed, released: false, error: 'Slow down. One line at a time.' };
    this.last.set(k, now);
    if (!isApology(text)) return { counted: false, typed: j.typed, needed: j.needed, released: false, error: 'That doesn\'t match exactly. Type it again.' };
    j.typed += 1;
    if (j.typed >= j.needed) { await this.release(name, 'lines done'); return { counted: true, typed: j.typed, needed: j.needed, released: true }; }
    if (this.pool) await this.pool.query('UPDATE jail SET typed = $2 WHERE player_key = $1', [k, j.typed]);
    if (j.typed % 25 === 0) this.onChange(name, j);
    return { counted: true, typed: j.typed, needed: j.needed, released: false };
  }
  /** Releases expired sentences (called on an interval). */
  sweep(now = Date.now()): void { for (const j of [...this.m.values()]) this.status(j.name, now); }
}

let jail = new Jail(null);
export const getJail = () => jail;
export function setJail(j: Jail) { jail = j; }
export const isJailed = (name: string | null | undefined) => jail.isJailed(name);
export const jailBlockMessage = (name: string): string | null => { const j = jail.status(name); return j ? jailMessage(j) : null; };

export async function initJail(): Promise<void> {
  const url = databaseUrl(); if (!url) return;
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[jail] pool error:', e.message));
  const j = new Jail(pool);
  try { await j.init(); jail = j; console.log(`[jail] ready (${j.list().length} jailed)`); } catch (e) { console.error('[jail] init failed:', (e as Error).message); }
}

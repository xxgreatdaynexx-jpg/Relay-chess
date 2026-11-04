/**
 * Shared guards for co-op 3 (supply contracts, fishing fleets, weekly events): who may take part, the anti-alt check,
 * linked-account blocking, and a small Postgres transaction helper. Errors thrown as Coop3Error are shown to players.
 */
import pg from 'pg';
import { databaseUrl } from './leaderboard-store.js';
import { isJailed } from './jail.js';
import { getPlayTime } from './playtime.js';
import { playerKey } from './skins.js';
import { getLinks } from './linked.js';
import { isQaName } from '../shared/qa.js';

export class Coop3Error extends Error {}
export type Stmt = { sql: string; args: unknown[] };
export type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };
export const NONCE = /^[A-Za-z0-9_-]{6,64}$/;
export const BOT = /^(qa-bot-|bot[-_ ]|cpu[-_ ])/i;
export const MIN_AGE_MS = 3 * 24 * 3_600_000;
export const MIN_PLAY_MS = 2 * 3_600_000;
export interface AccountInfo { ageMs: number; playMs: number; exists: boolean }

/**
 * Local screenshots only: lets qa- accounts take part and skips the age / play-time / linked checks. Refused in
 * production no matter what the env says.
 */
export const coop3AllowQa = () => process.env.NODE_ENV !== 'production' && process.env.COOP3_ALLOW_QA === '1';

export class Guard {
  allowQa = coop3AllowQa();
  accountInfo: (name: string) => Promise<AccountInfo>;
  linked: (a: string, b: string) => boolean = (a, b) => getLinks().linked(a, b);
  constructor(private readonly pool: Q | null, private readonly clock = () => Date.now()) {
    this.accountInfo = async (name) => {
      const playMs = await getPlayTime().total(name);
      if (!this.pool) return { ageMs: Number.POSITIVE_INFINITY, playMs, exists: true };
      const r = await this.pool.query('SELECT created_at FROM players WHERE player_key = $1', [playerKey(name)]); const t = r.rows[0]?.created_at;
      const ms = t ? new Date(t as string).getTime() : NaN; return { ageMs: Number.isFinite(ms) ? this.clock() - ms : 0, playMs, exists: r.rows.length > 0 };
    };
  }
  /** Why `name` can't take part (QA / bot / jail), or null. */
  excluded(name: string): string | null {
    if (typeof name !== 'string' || !name.trim()) return 'Sign in first.';
    if ((isQaName(name) && !this.allowQa) || BOT.test(name.trim())) return 'QA and bot accounts can’t take part.';
    if (isJailed(name)) return 'You can’t do that from jail.';
    return null;
  }
  gate(name: string, who = 'You') { const r = this.excluded(name); if (r) throw new Coop3Error(who === 'You' ? r : r.replace(/^You can’t do that from jail\./, `${who} is in jail.`).replace(/^QA and bot accounts can’t take part\./, `${who} can’t take part (QA or bot account).`)); }
  /** Full check: gate + account age + play time (fails closed). */
  async eligible(name: string, who = 'You') {
    this.gate(name, who); if (this.allowQa && isQaName(name)) return;
    let a: AccountInfo; try { a = await this.accountInfo(name); } catch { throw new Coop3Error('Can’t check that account right now.'); }
    if (!a.exists) throw new Coop3Error(who === 'You' ? 'Sign in first.' : `No player called ${name.trim()}.`);
    if (!(a.ageMs >= MIN_AGE_MS)) throw new Coop3Error(`${who === 'You' ? 'Your' : `${who}’s`} account must be at least 3 days old.`);
    if (!(a.playMs >= MIN_PLAY_MS)) throw new Coop3Error(`${who === 'You' ? 'You need' : `${who} needs`} at least 2 hours of play time.`);
  }
  noLink(a: string, b: string) {
    if (playerKey(a) === playerKey(b)) throw new Coop3Error('You can’t deal with yourself.');
    if (!(this.allowQa && (isQaName(a) || isQaName(b))) && this.linked(a, b)) throw new Coop3Error('Those accounts look linked (same device or network), so they can’t trade with each other.');
  }
}

export async function runTx(pool: PoolLike | null, rows: Stmt[]): Promise<void> {
  if (!pool || !rows.length) return; const cl = await pool.connect();
  try { await cl.query('BEGIN'); for (const s of rows) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
  catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
}
export function openPool(tag: string): PoolLike | null {
  const url = databaseUrl(); if (!url) return null;
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 }); pool.on('error', (e) => console.error(`[${tag}] pool error:`, e.message));
  return pool as unknown as PoolLike;
}
/** Map an internal failure to a player-safe message. */
export const friendly = (e: unknown) => { const m = (e as Error)?.message ?? ''; return /duplicate|unique|Already/i.test(m) ? 'Already applied.' : /chips|balance|null value/i.test(m) ? 'Not enough chips.' : 'That didn’t go through. Nothing was taken.'; };

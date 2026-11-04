/**
 * Linked-account detector (mu-coop3). Two accounts are LINKED when they were seen on the same proxied IP or the same
 * client device id within LINK_WINDOW_MS. Used to block player-to-player deals that could launder chips between alts
 * (supply contracts, fishing-fleet crews, Trade Week credit). Signatures are stored hashed, never raw.
 */
import { createHash } from 'node:crypto';
import type { Socket } from 'socket.io';
import { playerKey } from './skins.js';

export const LINK_WINDOW_MS = 30 * 24 * 3_600_000;
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
export const LINKED_MIGRATION = 'CREATE TABLE IF NOT EXISTS account_seen (player_key TEXT NOT NULL, sig TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (player_key, sig));\nCREATE INDEX IF NOT EXISTS account_seen_sig ON account_seen (sig)';
const hash = (s: string) => createHash('sha256').update(`chud-link:${s}`).digest('hex').slice(0, 32);
const IGNORE = new Set(['', 'unknown']);

export class LinkRegistry {
  private bySig = new Map<string, Map<string, number>>();
  private byKey = new Map<string, Map<string, number>>();
  private wrote = new Map<string, number>();
  constructor(private readonly pool: Q | null = null, private readonly clock = () => Date.now()) {}
  async init() {
    if (!this.pool) return; await this.pool.query(LINKED_MIGRATION);
    const since = this.clock() - LINK_WINDOW_MS;
    for (const r of (await this.pool.query('SELECT player_key, sig, at FROM account_seen WHERE at >= $1', [since])).rows) this.put(String(r.player_key), String(r.sig), Number(r.at));
  }
  private put(k: string, sig: string, at: number) {
    const a = this.bySig.get(sig) ?? new Map(); a.set(k, Math.max(at, a.get(k) ?? 0)); this.bySig.set(sig, a);
    const b = this.byKey.get(k) ?? new Map(); b.set(sig, Math.max(at, b.get(sig) ?? 0)); this.byKey.set(k, b);
  }
  /** Record that `name` was seen with this ip / device (raw values are hashed before they are kept). */
  record(name: string, ip?: string | null, device?: string | null) {
    const k = playerKey(name); const at = this.clock();
    for (const [kind, v] of [['ip', ip], ['dev', device]] as const) {
      if (!v || IGNORE.has(v)) continue; const sig = `${kind}:${hash(v)}`; this.put(k, sig, at);
      const wk = `${k}|${sig}`; if (this.pool && at - (this.wrote.get(wk) ?? 0) > 3_600_000) { this.wrote.set(wk, at);
        void this.pool.query('INSERT INTO account_seen (player_key, sig, at) VALUES ($1,$2,$3) ON CONFLICT (player_key, sig) DO UPDATE SET at = GREATEST(account_seen.at, EXCLUDED.at)', [k, sig, at]).catch(() => {}); }
    }
  }
  linked(a: string, b: string): boolean {
    const ka = playerKey(a), kb = playerKey(b); if (ka === kb) return true;
    const since = this.clock() - LINK_WINDOW_MS; const mine = this.byKey.get(ka); if (!mine) return false;
    for (const [sig, at] of mine) { if (at < since) continue; const o = this.bySig.get(sig)?.get(kb); if (o != null && o >= since) return true; }
    return false;
  }
}

let reg = new LinkRegistry();
export const getLinks = () => reg;
export async function initLinks() {
  const { openPool } = await import('./coop3-gate.js'); const pool = openPool('linked'); if (!pool) return;
  try { const r = new LinkRegistry(pool); await r.init(); reg = r; } catch (e) { console.error('[linked] init failed:', (e as Error).message); }
}
export const setLinks = (r: LinkRegistry) => { reg = r; return r; };
/** Last X-Forwarded-For hop (added by our proxy) else the socket address, plus the client's device id if it sent one. */
export function socketSigs(s: Socket): { ip: string | null; device: string | null } {
  const fwd = s.handshake.headers['x-forwarded-for'];
  const hops = (Array.isArray(fwd) ? fwd.join(',') : fwd ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const d = (s.handshake.auth as { device?: unknown } | undefined)?.device;
  return { ip: hops[hops.length - 1] || s.handshake.address || null, device: typeof d === 'string' && d.length >= 8 && d.length <= 64 ? d : null };
}

/**
 * Chud Resort travel (shared/resort.ts). Every player is in the 'city' unless they bought a plane ticket at Chud Hub
 * International: px(RESORT_TICKET_BASE) chips, ONE Postgres transaction (ledger row 'resort_ticket' + location
 * upsert). The return flight is free. Resort features call requireResort() / isAtResort() before doing anything.
 */
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { px } from './price-index.js';
import { RESORT_TICKET_BASE, type Location } from '../shared/resort.js';

export class TravelError extends Error {}
export const TRAVEL_MIGRATION = `CREATE TABLE IF NOT EXISTS player_location (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, loc TEXT NOT NULL, since BIGINT NOT NULL);`;
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };
const keyOf = (n: string) => n.trim().toLowerCase();

export class Travel {
  private loc = new Map<string, Location>();
  private tickets = 0;
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) {}
  async init() {
    if (!this.pool) return; await this.pool.query(TRAVEL_MIGRATION);
    for (const r of (await this.pool.query("SELECT player_key, loc FROM player_location WHERE loc = 'resort'")).rows) this.loc.set(String(r.player_key), 'resort');
  }
  where(name: string | null | undefined): Location { return name ? this.loc.get(keyOf(name)) ?? 'city' : 'city'; }
  status(name: string | null) { return { loc: this.where(name), ticket: px(RESORT_TICKET_BASE) }; }

  /** Buy a ticket and fly to the resort (atomic: ledger + location). */
  async fly(name: string) {
    const k = keyOf(name); if (this.where(name) === 'resort') throw new TravelError('You are already at Chud Resort.');
    const fee = px(RESORT_TICKET_BASE); const bank = getBank();
    if (!bank.canAfford(name, fee)) throw new TravelError(`Not enough chips: a ticket costs ${fee.toLocaleString('en-US')}.`);
    const now = this.clock(); this.tickets++;
    const w = bank.transferAtomic([{ name, amount: -fee, key: `resort_ticket:${k}:${now}:${this.tickets}`, game: 'resort_ticket', memo: 'Plane ticket: Chud Hub International → Chud Resort' }]);
    const run = async () => {
      if (!this.pool) return; await w.after; const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query("INSERT INTO player_location (player_key, name, loc, since) VALUES ($1,$2,'resort',$3) ON CONFLICT (player_key) DO UPDATE SET loc = 'resort', name = EXCLUDED.name, since = EXCLUDED.since", [k, name.trim(), now]);
        for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); console.error('[travel] ticket failed:', (e as Error).message); throw new TravelError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : 'Booking failed. Nothing was charged.'); }
    this.loc.set(k, 'resort');
    return { loc: 'resort' as Location, fee, chips: bank.account(name).chips };
  }

  /** Free return flight to the city. */
  async home(name: string) {
    const k = keyOf(name);
    if (this.pool) await this.pool.query("INSERT INTO player_location (player_key, name, loc, since) VALUES ($1,$2,'city',$3) ON CONFLICT (player_key) DO UPDATE SET loc = 'city', since = EXCLUDED.since", [k, name.trim(), this.clock()]);
    this.loc.delete(k); return { loc: 'city' as Location };
  }
}

let travel: Travel = new Travel(null);
export const getTravel = () => travel;
export function setTravel(t: Travel) { travel = t; }
export const isAtResort = (name: string | null | undefined) => travel.where(name) === 'resort';
/** Throws `Err` unless `name` is at Chud Resort. */
export async function requireResort(name: string | null | undefined, Err: new (m: string) => Error = TravelError) {
  if (!isAtResort(name)) throw new Err('You need to be at Chud Resort for that. Fly there from Chud Hub International.');
}

export async function initTravel(): Promise<void> {
  const url = databaseUrl(); if (!url) return;
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[travel] pool error:', e.message));
  try { const t = new Travel(pool as unknown as PoolLike); await t.init(); travel = t; console.log('[travel] ready'); } catch (e) { console.error('[travel] init failed:', (e as Error).message); }
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerTravel(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const on = (ev: string, fn: () => unknown) => socket.on(ev, async (_b: unknown, ack?: Ack) => {
    try { ack?.({ ok: true, ...((await fn()) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof TravelError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  const need = () => { const n = nameOf(); if (!n) throw new TravelError('Sign in to fly.'); return n; };
  on('trip_status', () => travel.status(nameOf()));
  on('trip_buy', () => travel.fly(need()));
  on('trip_home', () => travel.home(need()));
}

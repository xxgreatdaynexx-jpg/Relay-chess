/**
 * Chud Resort travel (shared/resort.ts). Every player is in the 'city' unless they bought a plane ticket at Chud Hub
 * International: px(RESORT_TICKET_BASE) chips, ONE Postgres transaction (ledger row 'resort_ticket' + location
 * upsert). Private-jet owners fly their jet instead (no ticket, any destination). The return flight is free. Resort features call requireResort() / isAtResort() before doing anything.
 */
import { coopPerk } from './coop-perks.js';
import { cityTicketPrice } from './city-rates.js';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { px } from './price-index.js';
import { DESTINATIONS, RESORT_TICKET_BASE, isDestination, isLocation, type Destination, type Location } from '../shared/resort.js';

export class TravelError extends Error {}
export const TRAVEL_MIGRATION = `CREATE TABLE IF NOT EXISTS player_location (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, loc TEXT NOT NULL, since BIGINT NOT NULL);`;
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };
const keyOf = (n: string) => n.trim().toLowerCase();
/**
 * Ticket waiver hook: return a reason string to fly free (e.g. a private jet, on the mu-resort branch), or null to pay.
 * Generic over destinations so every new map gets it for free.
 */
export type TicketWaiver = (name: string, dest: Destination) => string | null;
let waiver: TicketWaiver = () => null;
export function setTicketWaiver(fn: TicketWaiver | null) { waiver = fn ?? (() => null); }

/** Co-op Fort McChud Bridge perk: half-price Fort McChud tickets for everyone. */
export const ticketPrice = (d: Destination) => { const p = px(DESTINATIONS[d].ticket); return d === 'fortmc' && coopPerk('bridge') ? Math.ceil(p / 2) : p; };

export class Travel {
  private loc = new Map<string, Location>();
  private tickets = 0;
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) {}
  async init() {
    if (!this.pool) return; await this.pool.query(TRAVEL_MIGRATION);
    for (const r of (await this.pool.query("SELECT player_key, loc FROM player_location WHERE loc <> 'city'")).rows) if (isLocation(r.loc) && r.loc !== 'city') this.loc.set(String(r.player_key), r.loc);
  }
  where(name: string | null | undefined): Location { return name ? this.loc.get(keyOf(name)) ?? 'city' : 'city'; }
  status(name: string | null) {
    const tickets = Object.fromEntries((Object.keys(DESTINATIONS) as Destination[]).map((d) => [d, name && waiver(name, d) ? 0 : cityTicketPrice(ticketPrice(d))])) as Record<Destination, number>;
    return { loc: this.where(name), ticket: name && waiver(name, 'resort') ? 0 : cityTicketPrice(px(RESORT_TICKET_BASE)), tickets };
  }

  /** Buy a ticket and fly to `dest` (atomic: ledger + location). A waived ticket (private jet etc.) skips the ledger. */
  async fly(name: string, dest: Destination = 'resort') {
    if (!isDestination(dest)) throw new TravelError('Unknown destination.');
    const D = DESTINATIONS[dest]; const k = keyOf(name); if (this.where(name) === dest) throw new TravelError(`You are already at ${D.name}.`);
    // #11: private-jet owners fly their own jet, no ticket, to every destination (Chud Resort and, per Dayne, Fort McChud).
    // The jet's normal daily upkeep (server/fleet.ts runUpkeep) still applies; flying it costs nothing extra.
    const jet = await jetHook(name).catch(() => null);
    const waivedBy = waiver(name, dest); const waived = waivedBy || jet;
    const fee = waived ? 0 : cityTicketPrice(ticketPrice(dest)); const bank = getBank();
    if (fee > 0 && !bank.canAfford(name, fee)) throw new TravelError(`Not enough chips: a ticket costs ${fee.toLocaleString('en-US')}.`);
    const now = this.clock(); this.tickets++;
    const w = fee > 0 ? bank.transferAtomic([{ name, amount: -fee, key: `${D.game}:${k}:${now}:${this.tickets}`, game: D.game, memo: `Plane ticket: Chud Hub International → ${D.name}` }]) : { stmts: [], after: Promise.resolve(), bind: () => {}, revert: () => {} };
    const run = async () => {
      if (!this.pool) return; await w.after; const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query("INSERT INTO player_location (player_key, name, loc, since) VALUES ($1,$2,$4,$3) ON CONFLICT (player_key) DO UPDATE SET loc = EXCLUDED.loc, name = EXCLUDED.name, since = EXCLUDED.since", [k, name.trim(), now, dest]);
        for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); console.error('[travel] ticket failed:', (e as Error).message); throw new TravelError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : 'Booking failed. Nothing was charged.'); }
    this.loc.set(k, dest);
    return { loc: dest as Location, fee, waived: waivedBy ?? undefined, jet: jet ?? undefined, chips: bank.account(name).chips };
  }

  /** Jet seat passenger (server/jetSeats.ts): moved with the owner's jet, no ticket. */
  async carry(name: string, to: Location) {
    const k = keyOf(name);
    if (this.pool) await this.pool.query("INSERT INTO player_location (player_key, name, loc, since) VALUES ($1,$2,$4,$3) ON CONFLICT (player_key) DO UPDATE SET loc = EXCLUDED.loc, name = EXCLUDED.name, since = EXCLUDED.since", [k, name.trim(), this.clock(), to]);
    if (to === 'city') this.loc.delete(k); else this.loc.set(k, to); return { loc: to };
  }

  /** Free return flight to the city. */
  async home(name: string) {
    const k = keyOf(name);
    if (this.pool) await this.pool.query("INSERT INTO player_location (player_key, name, loc, since) VALUES ($1,$2,'city',$3) ON CONFLICT (player_key) DO UPDATE SET loc = 'city', since = EXCLUDED.since", [k, name.trim(), this.clock()]);
    this.loc.delete(k); return { loc: 'city' as Location };
  }
}

/** #11: name of the player's private jet (server/fleet.ts sets this), or null. */
let jetHook: (name: string) => Promise<string | null> = async () => null;
export const setTravelJetHook = (f: typeof jetHook) => { jetHook = f; };
let travel: Travel = new Travel(null);
export const getTravel = () => travel;
export function setTravel(t: Travel) { travel = t; }
export const isAtResort = (name: string | null | undefined) => travel.where(name) === 'resort';
/** Millionaire Update warehouse-only rule: Chud City's markets (fishmonger, diner, ore buyer) only buy from players who are in
 * Chud City. Away at Chud Resort or Fort McChud, goods reach the market by Ship & sell to the Chud City Warehouse. */
export const MARKET_AWAY_MSG = 'You are away from Chud City. Its markets only buy from you in person: travel back, or use Ship & sell from your building to send goods to the Chud City Warehouse.';
export function awayFromMarket(name: string | null | undefined, E: new (m: string) => Error): void { if (isAtResort(name) || isAtFortMc(name)) throw new E(MARKET_AWAY_MSG); }
export const isAtFortMc = (name: string | null | undefined) => travel.where(name) === 'fortmc';
/** Throws `Err` unless `name` is at Fort McChud. */
export async function requireFortMc(name: string | null | undefined, Err: new (m: string) => Error = TravelError) {
  if (!isAtFortMc(name)) throw new Err('You need to be at Fort McChud for that. Fly there from Chud Hub International.');
}
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
  const on = (ev: string, fn: (b: unknown) => unknown) => socket.on(ev, async (b: unknown, ack?: Ack) => {
    if (typeof b === 'function') { ack = b as Ack; b = undefined; }
    try { ack?.({ ok: true, ...((await fn(b)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof TravelError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  const need = () => { const n = nameOf(); if (!n) throw new TravelError('Sign in to fly.'); return n; };
  on('trip_status', async () => { const n = nameOf(); return { ...travel.status(n), jet: n ? await jetHook(n).catch(() => null) : null }; });
  on('trip_buy', (b) => { const d = (b as { dest?: unknown } | undefined)?.dest; return travel.fly(need(), d === undefined ? 'resort' : (d as Destination)); });
  on('trip_home', () => travel.home(need()));
}

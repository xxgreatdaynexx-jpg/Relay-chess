import { invReady } from './invFence.js';
/**
 * Logistics (Millionaire Update): truck store + shipments between maps.
 *
 * Chips only move through the wallet + ledger: a truck buy is CasinoBank.transferAtomic ('truck_buy') in ONE Postgres
 * transaction with the truck_owned row; a sell-back is 'truck_sell'; carrier fees are 'freight' debits that commit in the
 * same transaction as the goods leaving storage and the shipment row (Mines adjustStack extra rows). Fees are a chip sink.
 * Goods are escrowed (out of storage) while in transit and land in the recipient's banked storage on arrival.
 * Every in-transit or loading shipment is broadcast to the 'freight' room so the map can draw the vehicle.
 */
import { salesTaxFor, cityPerk, cityFreightMul, treasuryStmtsFor } from './city-rates.js';
import { isJailed } from './jail.js';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { bootAttach, setBootState } from './boot-retry.js';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { getMines } from './mines.js';
import { getAccounts } from './accounts.js';
import { px, priceIndex } from './price-index.js';
import { nameOf, type ItemType } from '../shared/mines.js';
import { isStackable } from './market.js';
import { locLabel } from '../shared/inventoryLocations.js';
import { getFleet } from './fleet.js';
import { CARGO, cargoCap, multiTripMs, ownFeeBase, tripsFor } from '../shared/cargo.js';
import { HUBS, isOwnMode, MAX_SHIP_QTY, MAX_TRUCKS, MODES, TRUCKS, TRUCK_BY_ID, TRUCK_SELL_BACK, arrivalOf, feeBase, shipFee, isHub, isMode, nextDeparture, truckTravelMs, type HubId, type LiveVehicle, type Mode, truckAllowed, NO_CROSS_MAP_TRUCK, isTruckMode, legModeAllowed, SAME_MAP_TRUCK_ONLY } from '../shared/logistics.js';

export class FreightError extends Error {}
const keyOf = (n: string) => n.replace(/\s+/g, ' ').trim().toLowerCase();
type Stmt = { sql: string; args: unknown[] };
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };

export const LOGISTICS_MIGRATION = `CREATE TABLE IF NOT EXISTS truck_owned (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, truck_id TEXT NOT NULL, paid BIGINT NOT NULL, bought_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS truck_owned_player ON truck_owned (player_key);
CREATE TABLE IF NOT EXISTS freight_shipments (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, to_key TEXT NOT NULL, to_name TEXT NOT NULL,
  mode TEXT NOT NULL, truck TEXT, from_hub TEXT NOT NULL, to_hub TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL, fee BIGINT NOT NULL,
  created_at BIGINT NOT NULL, depart_at BIGINT NOT NULL, arrive_at BIGINT NOT NULL, status TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS freight_shipments_status ON freight_shipments (status);
ALTER TABLE freight_shipments ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'move';
ALTER TABLE freight_shipments ADD COLUMN IF NOT EXISTS src TEXT;
ALTER TABLE freight_shipments ADD COLUMN IF NOT EXISTS auto BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE freight_shipments ADD COLUMN IF NOT EXISTS from_loc TEXT;
ALTER TABLE freight_shipments ADD COLUMN IF NOT EXISTS to_loc TEXT;`;

export interface OwnedTruck { id: string; truckId: string; paid: number; boughtAt: number }
export interface Shipment { id: string; owner: string; ownerName: string; toKey: string; toName: string; mode: Mode; truck: string | null; from: HubId; to: HubId; type: ItemType; itemId: string; qty: number; fee: number; createdAt: number; departAt: number; arriveAt: number; status: 'transit' | 'delivered';
  /** 'sell' = a ship-to-sell load: it sells at the Chud City Warehouse on arrival instead of landing in storage. */ kind?: 'move' | 'sell' | 'factory' | 'loc'; /** building inventory it left (autosell) */ src?: string | null; auto?: boolean;
  /** kind 'loc' (truck logistics): the individual location it left and the one it is delivered to (server/locmoves.ts). */ fromLoc?: string | null; toLoc?: string | null }

/** Rollback barrier: per-location legs ('loc') are stored as status 'moving', which pre-logistics code (status =
 *  'transit' only) never loads, so a rollback can't mis-deliver them; they resume when this code runs again. */
export const MOVING = 'moving';
const dbStatus = (s: Shipment) => (s.kind === 'loc' && s.status === 'transit' ? MOVING : s.status);
export const shipStmt = (s: Shipment): Stmt => ({
  sql: `INSERT INTO freight_shipments (id, player_key, name, to_key, to_name, mode, truck, from_hub, to_hub, item_type, item_id, qty, fee, created_at, depart_at, arrive_at, status, kind, src, auto, from_loc, to_loc)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
  args: [s.id, s.owner, s.ownerName, s.toKey, s.toName, s.mode, s.truck, s.from, s.to, s.type, s.itemId, s.qty, s.fee, s.createdAt, s.departAt, s.arriveAt, dbStatus(s), s.kind ?? 'move', s.src ?? null, !!s.auto, s.fromLoc ?? null, s.toLoc ?? null],
});
const rowShip = (r: Record<string, unknown>): Shipment => ({ id: String(r.id), owner: String(r.player_key), ownerName: String(r.name), toKey: String(r.to_key), toName: String(r.to_name), mode: String(r.mode) as Mode, truck: r.truck == null ? null : String(r.truck),
  from: String(r.from_hub) as HubId, to: String(r.to_hub) as HubId, type: String(r.item_type) as ItemType, itemId: String(r.item_id), qty: Number(r.qty), fee: Number(r.fee), createdAt: Number(r.created_at), departAt: Number(r.depart_at), arriveAt: Number(r.arrive_at), status: (String(r.status) === MOVING ? 'transit' : String(r.status)) as Shipment['status'],
  kind: r.kind === 'sell' || r.kind === 'factory' || r.kind === 'loc' ? r.kind : 'move', src: r.src == null ? null : String(r.src), auto: r.auto === true,
  fromLoc: r.from_loc == null ? null : String(r.from_loc), toLoc: r.to_loc == null ? null : String(r.to_loc) });
const stackable = isStackable;

export class Logistics {
  trucks = new Map<string, OwnedTruck[]>();
  ships = new Map<string, Shipment>();
  /** Recipient check (signed-up account); swappable in tests. */
  exists: (name: string) => Promise<boolean> = async (n) => { try { return (await getAccounts().status(n)).claimed; } catch { return false; } };
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) {}
  async init() {
    if (!this.pool) return;
    await this.pool.query(LOGISTICS_MIGRATION);
    for (const r of (await this.pool.query('SELECT * FROM truck_owned ORDER BY bought_at')).rows) { const k = String(r.player_key); const l = this.trucks.get(k) ?? []; l.push({ id: String(r.id), truckId: String(r.truck_id), paid: Number(r.paid), boughtAt: Number(r.bought_at) }); this.trucks.set(k, l); }
    for (const r of (await this.pool.query("SELECT * FROM freight_shipments WHERE status IN ('transit', 'moving')")).rows) { const s = rowShip(r); this.ships.set(s.id, s); }
  }
  private rows(rows: Stmt[]) { if (!rows.length || !this.pool) return; const pool = this.pool; void (async () => { const cl = await pool.connect(); try { await cl.query('BEGIN'); for (const s of rows) await cl.query(s.sql, s.args); await cl.query('COMMIT'); } catch (e) { await cl.query('ROLLBACK').catch(() => {}); console.error('[logistics] write failed:', (e as Error).message); } finally { cl.release(); } })(); }

  owned(name: string) { return [...(this.trucks.get(keyOf(name)) ?? [])]; }
  busyTrucks(name: string) { return this.busyOf(name, 'truck'); }
  busyOf(name: string, mode: Mode) { const k = keyOf(name); const out = new Set([...this.ships.values()].filter((s) => s.owner === k && s.mode === mode && s.truck).map((s) => s.truck!)); if (mode === 'truck') for (const t of extraBusyTrucks(name)) out.add(t); return out; }
  /** mu-cargo: UTC day each own vehicle last ran (its per-day-used upkeep is charged on the first trip of a day). */
  usedDay = new Map<string, string>();
  private today() { return new Date(this.clock()).toISOString().slice(0, 10); }
  firstToday(vehicleId: string) { return this.usedDay.get(vehicleId) !== this.today(); }
  /** Own-vehicle fee (indexed): trips x fuel per trip + today's upkeep if this vehicle has not run yet today. */
  ownQuote(model: string, vehicleId: string, qty: number) { const f = ownFeeBase(model, qty, this.firstToday(vehicleId)); return f ? Math.max(1, Math.round(px(f) * (1 - cityPerk('vehicle_upkeep')))) : 0; } // Hospital perk
  markUsed(vehicleId: string) { this.usedDay.set(vehicleId, this.today()); }
  /** Own jets/boats (Fleet) as cargo vehicles: the requested one, or the first idle one. */
  async craftFor(name: string, mode: 'jet' | 'boat', want?: unknown): Promise<{ id: string; model: string }> {
    const f = getFleet(); const mine = f ? await f.owned(name, mode) : [];
    const label = mode === 'jet' ? 'jet' : 'boat';
    if (!mine.length) throw new FreightError(`You do not own a ${label}. Buy one at the ${mode === 'jet' ? 'Private Hangar' : 'Marina'}, or use a public carrier.`);
    const busy = this.busyOf(name, mode); const pick = typeof want === 'string' ? mine.find((c) => c.id === want) : mine.find((c) => !busy.has(c.id));
    if (!pick) throw new FreightError(`All your ${label}s are out on deliveries.`); if (busy.has(pick.id)) throw new FreightError(`That ${label} is already out on a delivery.`);
    return { id: pick.id, model: pick.model };
  }

  /** Truck store: one transaction (ledger debit + truck row). */
  async buyTruck(name: string, truckId: unknown) {
    const t = typeof truckId === 'string' ? TRUCK_BY_ID.get(truckId) : undefined; if (!t) throw new FreightError('That truck is not in the store.');
    const k = keyOf(name); const mine = this.owned(name); if (mine.length >= MAX_TRUCKS) throw new FreightError(`Fleet full (${MAX_TRUCKS} trucks). Sell one first.`);
    const price = px(t.price); const bank = getBank();
    const id = randomUUID(); const at = this.clock(); const truck: OwnedTruck = { id, truckId: t.id, paid: price, boughtAt: at };
    const st = salesTaxFor(name, price, `truck_buy:${id}`, t.name); if (!bank.canAfford(name, price + st.tax)) throw new FreightError(st.tax ? `Not enough chips: ${price.toLocaleString('en-US')} + ${st.tax.toLocaleString('en-US')} sales tax.` : 'Not enough chips.');
    const w = bank.transferAtomic([{ name, amount: -price, key: `truck_buy:${id}`, game: 'truck_buy', memo: `Bought a ${t.name}` }, ...(st.move ? [st.move] : [])]);
    const run = async () => {
      if (!this.pool) return; await w.after; const cl = await this.pool.connect();
      try { await cl.query('BEGIN'); await cl.query('INSERT INTO truck_owned (id, player_key, name, truck_id, paid, bought_at) VALUES ($1,$2,$3,$4,$5,$6)', [id, k, name.trim(), t.id, price, at]); for (const s of [...w.stmts, ...st.stmts]) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
      catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); console.error('[logistics] buy failed:', (e as Error).message); throw new FreightError('Purchase failed. Nothing was charged.'); }
    this.trucks.set(k, [...mine, truck]);
    return { truck, price, chips: bank.account(name).chips };
  }
  async sellTruck(name: string, ownedId: unknown) {
    const k = keyOf(name); const mine = this.owned(name); const tr = mine.find((x) => x.id === ownedId); if (!tr) throw new FreightError('You do not own that truck.');
    if (this.busyTrucks(name).has(tr.id)) throw new FreightError('That truck is out on a delivery. Sell it when it gets back.');
    const pay = Math.floor(tr.paid * TRUCK_SELL_BACK); const bank = getBank();
    const w = bank.transferAtomic([{ name, amount: pay, key: `truck_sell:${tr.id}`, game: 'truck_sell', memo: `Sold a ${TRUCK_BY_ID.get(tr.truckId)?.name ?? 'truck'}` }]);
    const run = async () => {
      if (!this.pool) return; await w.after; const cl = await this.pool.connect();
      try { await cl.query('BEGIN'); if (((await cl.query('DELETE FROM truck_owned WHERE id = $1 AND player_key = $2', [tr.id, k])).rowCount ?? 0) === 0) throw new FreightError('You do not own that truck.'); for (const s of w.stmts) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
      catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); if (e instanceof FreightError) throw e; throw new FreightError('Sale failed. Nothing changed.'); }
    this.trucks.set(k, mine.filter((x) => x.id !== tr.id));
    return { paid: pay, chips: bank.account(name).chips };
  }

  /** Ship-to-sell loads call this on arrival (server/warehouse.ts). Rejects = retried on the next tick. */
  onSell: ((s: Shipment) => Promise<void>) | null = null;
  private selling = new Set<string>();
  /** Fort McChud → your factory loads call this on arrival (server/fortmc.ts factoryDelivered). Rejects = retried. */
  onFactory: ((s: Shipment) => Promise<void>) | null = null;
  /** Truck logistics loads (kind 'loc') call this on arrival (server/locmoves.ts). Rejects = retried with backoff. */
  onLoc: ((s: Shipment) => Promise<void>) | null = null;
  onLegacy: ((s: Shipment) => Promise<void>) | null = null;
  /** Failed factory deliveries (factory full): next retry time, doubling 30 s → 10 min; the failure is logged once per load. */
  factoryBackoff = new Map<string, { wait: number; next: number }>();
  idleTruck(name: string, skip?: Set<string>): { id: string; cap: number } | null {
    const busy = this.busyTrucks(name); for (const x of skip ?? []) busy.add(x); const t = this.owned(name).find((x) => !busy.has(x.id)); return t ? { id: t.id, cap: TRUCK_BY_ID.get(t.truckId)!.cap } : null;
  }
  /**
   * Plan a ship-to-sell load from a building on another map (no side effects). The caller commits the goods leaving the
   * building, the fee debit (ledger 'freight') and shipStmt(s) in ONE transaction, then calls admit(s).
   */
  planSell(name: string, b: { mode: unknown; from: HubId; type: string; id: string; qty: number; src: string; auto?: boolean; kind?: 'sell' | 'factory'; skip?: Set<string> }): Shipment {
    const mode = b.mode; if (!isMode(mode)) throw new FreightError('Pick how to ship it.');
    const qty = b.qty; if (!Number.isInteger(qty) || qty < 1 || qty > MAX_SHIP_QTY) throw new FreightError('Pick a quantity.');
    if (!truckAllowed(mode, b.from, 'city')) throw new FreightError(NO_CROSS_MAP_TRUCK); // building loads always go to Chud City
    let truck: string | null = null; let travel = MODES[mode].travelMs; let cap = MODES[mode].cap; let model = '';
    if (mode === 'truck') {
      const t = this.idleTruck(name, b.skip);
      if (!this.owned(name).length) throw new FreightError('You do not own a truck. Buy one at the truck store, or hire one for a fee.');
      if (!t) throw new FreightError('All your trucks are out on deliveries. Hire one, or wait.');
      const m = TRUCK_BY_ID.get(this.owned(name).find((x) => x.id === t.id)!.truckId)!; truck = t.id; cap = m.cap; travel = Math.round(truckTravelMs(m) * (1 - cityPerk('truck_speed'))); model = m.id;
    } else if (mode === 'jet' || mode === 'boat') throw new FreightError('Building loads go by truck, hired rig, freight plane or cargo ship.');
    if (qty > cap) throw new FreightError(`Too much for one ${MODES[mode].label.toLowerCase()}: max ${cap.toLocaleString('en-US')} units.`);
    const now = this.clock(); const departAt = nextDeparture(mode, now);
    const s: Shipment = { id: randomUUID(), owner: keyOf(name), ownerName: name.trim(), toKey: keyOf(name), toName: name.trim(), mode, truck, from: b.from, to: 'city', type: b.type as ItemType, itemId: b.id, qty,
      fee: truck ? this.ownQuote(model, truck, qty) : this.quote(mode, qty), createdAt: now, departAt, arriveAt: mode === 'truck' || mode === 'hired' ? departAt + travel : arrivalOf(mode, departAt), status: 'transit', kind: b.kind ?? 'sell', src: b.src, auto: !!b.auto };
    return s;
  }
  /** Units of each item already on the road for this player, by load kind (e.g. factory loads count against storage room). */
  pending(name: string, kind: 'sell' | 'factory'): Map<string, number> {
    const k = keyOf(name); const m = new Map<string, number>();
    for (const s of this.ships.values()) if (s.owner === k && s.kind === kind) m.set(s.itemId, (m.get(s.itemId) ?? 0) + s.qty);
    return m;
  }
  /** Register a committed shipment (it now shows on the map and is delivered by tick()). */
  admit(s: Shipment) { this.ships.set(s.id, s); if (s.truck) this.markUsed(s.truck); }

  /** Public carriers: base fee x the mayor's freight lever x the Street Lights perk. */
  quote(mode: Mode, qty: number) { const f = shipFee(mode, qty, priceIndex()); return f ? Math.max(1, Math.round(f * cityFreightMul())) : 0; }
  /** Part of a public-carrier fee above the default rate (lever > 1) goes to the treasury. */
  freightSurplus(mode: Mode, qty: number, fee: number) { return Math.max(0, fee - shipFee(mode, qty, priceIndex())); }

  /**
   * Truck logistics leg between two individual locations (server/locmoves.ts). Same rules and prices as the Freight Yard:
   * own truck / jet / boat = fuel per trip (+ the day's upkeep), several trips for a big load; hired / plane / ship = the
   * public fee, one load. Trucks (own or hired) only drive within one map. The truck is picked or validated here from the
   * player's real fleet and global busy set; nothing about the vehicle comes from the client except which one.
   * No side effects: the caller commits goods + fee + shipStmt(s) in one transaction, then calls admit(s).
   */
  async planLeg(name: string, b: { mode: unknown; vehicle?: unknown; fromHub: HubId; toHub: HubId; type: string; itemId: string; qty: number; fromLoc: string; toLoc: string }): Promise<{ shipment: Shipment; trips: number; surplus: number }> {
    const mode = b.mode; if (!isMode(mode)) throw new FreightError('Pick how to ship it.');
    const qty = b.qty; if (!Number.isInteger(qty) || qty < 1 || qty > MAX_SHIP_QTY) throw new FreightError('Pick a quantity.');
    // Map pools (Dayne 2026-11-07, pre-Millionaire restore): places on ONE map share an inventory, so a same-map move
    // is free and instant (no truck, no fee). It still goes through the shipment row + exactly-once arrival.
    if (b.fromHub === b.toHub) {
      const now = this.clock();
      const s: Shipment = { id: randomUUID(), owner: keyOf(name), ownerName: name.trim(), toKey: keyOf(name), toName: name.trim(), mode: 'hired', truck: null, from: b.fromHub, to: b.toHub, type: b.type as ItemType, itemId: b.itemId, qty, fee: 0,
        createdAt: now, departAt: now, arriveAt: now, status: 'transit', kind: 'loc', src: b.fromLoc, fromLoc: b.fromLoc, toLoc: b.toLoc };
      this.ships.set(s.id, s); return { shipment: s, trips: 1, surplus: 0 };
    }
    if (isTruckMode(mode)) throw new FreightError(NO_CROSS_MAP_TRUCK); // between maps: plane / ship (own jet / boat) only
    let truck: string | null = null; let travel = MODES[mode].travelMs; let cap = MODES[mode].cap; let model = '';
    if (mode === 'jet' || mode === 'boat') { const c = await this.craftFor(name, mode, b.vehicle); truck = c.id; model = c.model; cap = cargoCap(c.model); }
    const trips = isOwnMode(mode) ? tripsFor(qty, cap) : 1;
    if (!isOwnMode(mode) && qty > cap) throw new FreightError(`Too much for one ${MODES[mode].label.toLowerCase()}: max ${cap.toLocaleString('en-US')} units.`);
    if (isOwnMode(mode)) travel = multiTripMs(travel, trips);
    const fee = truck ? this.ownQuote(model, truck, qty) : this.quote(mode, qty);
    const now = this.clock(); const departAt = nextDeparture(mode, now);
    const s: Shipment = { id: randomUUID(), owner: keyOf(name), ownerName: name.trim(), toKey: keyOf(name), toName: name.trim(), mode, truck, from: b.fromHub, to: b.toHub, type: b.type as ItemType, itemId: b.itemId, qty, fee,
      createdAt: now, departAt, arriveAt: isOwnMode(mode) ? departAt + travel : arrivalOf(mode, departAt), status: 'transit', kind: 'loc', src: b.fromLoc, fromLoc: b.fromLoc, toLoc: b.toLoc };
    this.ships.set(s.id, s); // reserve the vehicle now (busy for every other dispatch); the caller admit()s or release()s it
    return { shipment: s, trips, surplus: fee && !truck ? this.freightSurplus(mode, qty, fee) : 0 };
  }
  /** Undo a planLeg reservation whose transaction failed. */
  release(id: string) { this.ships.delete(id); }

  /** Send goods. Goods leave storage, the fee (if any) is debited and the shipment row is written, all in one transaction. */
  static freightYardClosed = true;
  async ship(name: string, b: Record<string, unknown>): Promise<{ trips: number; shipment: Shipment; chips: number | null }> {
    // Map pools revert (Dayne 2026-11-07): the Freight Yard (same-map factory -> factory loads, added by the Millionaire update)
    // takes no NEW loads. Loads already on the road still arrive exactly once. Cross-map moves: 🏭 My places (ship / plane).
    if (Logistics.freightYardClosed) throw new FreightError('The Freight Yard takes no new loads. To move goods to another map, use 🏭 My places (ship or plane).');
    const mode = b.mode; if (!isMode(mode)) throw new FreightError('Pick how to ship it.');
    // Freight Yard goods are banked in Chud City: the origin map is the server's, never the client's.
    const from: HubId = 'city'; const to = b.to; if (!isHub(to)) throw new FreightError('Pick a destination.');
    if (!truckAllowed(mode, from, to)) throw new FreightError(NO_CROSS_MAP_TRUCK);
    if (from === to && !b.recipient) throw new FreightError('Pick a different map (or send it to another player).');
    if (!stackable(b.type, b.id)) throw new FreightError('That item can not be shipped.');
    const type = b.type as ItemType; const itemId = b.id as string;
    const qty = Number(b.qty); if (!Number.isInteger(qty) || qty < 1 || qty > MAX_SHIP_QTY) throw new FreightError('Pick a quantity.');
    const recipient = typeof b.recipient === 'string' && b.recipient.trim() ? b.recipient.trim().slice(0, 40) : name.trim();
    if (keyOf(recipient) !== keyOf(name) && !(await this.exists(recipient))) throw new FreightError(`No player called ${recipient}.`);
    if (keyOf(recipient) !== keyOf(name) && isJailed(recipient)) throw new FreightError(`${recipient} is in City Jail and can't receive shipments.`);
    // Truck logistics: a Freight Yard load leaves YOUR factory and lands at the recipient's factory (an explicit, existing
    // destination in Chud City). Anything else goes from a specific place to a specific place in 🏭 My places.
    const hasFactory = (n: string) => { const m = getMines(); const k = keyOf(n); return (m.factories.get(k)?.level ?? 0) > 0 || m.fv2.has(k); };
    if (!hasFactory(name)) throw new FreightError('Your banked goods are held until you build a factory.');
    if (to !== 'city') throw new FreightError('Freight Yard loads go factory to factory in Chud City. To send goods to a place on another map, use 🏭 My places.');
    if (!hasFactory(recipient)) throw new FreightError(`${recipient} has no factory to receive goods.`);
    if (!legModeAllowed(mode, from, to)) throw new FreightError(SAME_MAP_TRUCK_ONLY); // factory->factory in the city: road only
    let truck: string | null = null; let travel = MODES[mode].travelMs; let cap = MODES[mode].cap; let model = '';
    if (mode === 'truck') {
      const busy = this.busyTrucks(name); const mine = this.owned(name);
      const pick = typeof b.truck === 'string' ? mine.find((t) => t.id === b.truck) : mine.find((t) => !busy.has(t.id));
      if (!mine.length) throw new FreightError('You do not own a truck. Buy one at the truck store, or hire one for a fee.');
      if (!pick) throw new FreightError('All your trucks are out on deliveries. Hire one, or wait.');
      if (busy.has(pick.id)) throw new FreightError('That truck is already out on a delivery.');
      const m = TRUCK_BY_ID.get(pick.truckId)!; truck = pick.id; cap = m.cap; travel = Math.round(truckTravelMs(m) * (1 - cityPerk('truck_speed'))); model = m.id;
    } else if (mode === 'jet' || mode === 'boat') { const c = await this.craftFor(name, mode, b.vehicle); truck = c.id; model = c.model; cap = cargoCap(c.model); }
    // mu-cargo: own vehicles take a big load in several trips (there and back between loads); public carriers take one load.
    const trips = isOwnMode(mode) ? tripsFor(qty, cap) : 1;
    if (!isOwnMode(mode) && qty > cap) throw new FreightError(`Too much for one ${MODES[mode].label.toLowerCase()}: max ${cap.toLocaleString('en-US')} units.`);
    if (isOwnMode(mode)) travel = multiTripMs(travel, trips);
    const mines = getMines(); const have = mines.stackQty(name, type, itemId);
    if (have < qty) throw new FreightError(`You only have ${have} ${nameOf({ type, id: itemId })}.`);
    const fee = truck ? this.ownQuote(model, truck, qty) : this.quote(mode, qty); const bank = getBank();
    if (fee && !bank.canAfford(name, fee)) throw new FreightError(`Not enough chips for the 🪙 ${fee.toLocaleString('en-US')} fee.`);
    const now = this.clock(); const departAt = nextDeparture(mode, now);
    const s: Shipment = { id: randomUUID(), owner: keyOf(name), ownerName: name.trim(), toKey: keyOf(recipient), toName: recipient, mode, truck, from, to, type, itemId, qty, fee, createdAt: now, departAt, arriveAt: departAt + travel, status: 'transit' };
    if (!isOwnMode(mode)) s.arriveAt = arrivalOf(mode, departAt);
    const w = fee ? bank.transferAtomic([{ name, amount: -fee, key: `freight:${s.id}`, game: 'freight', memo: `${MODES[mode].label}: ${qty} ${nameOf({ type, id: itemId })} to ${HUBS[to].label}` }]) : null;
    this.ships.set(s.id, s);
    const onFail = () => { w?.revert(); this.ships.delete(s.id); };
    const ok = mines.adjustStack(name, type, itemId, -qty, [...(w?.stmts ?? []), shipStmt(s), ...(fee && !truck ? treasuryStmtsFor(name, 'freight', this.freightSurplus(mode, qty, fee), 'Freight lever surplus') : [])], (r) => this.rows(r), w ? { after: w.after, bind: w.bind, onFail } : { onFail });
    if (!ok) { onFail(); throw new FreightError('Not enough items.'); }
    if (truck) this.markUsed(truck);
    return { trips, shipment: s, chips: bank.ready ? bank.account(name).chips : null };
  }

  /** Deliver everything that has arrived. Returns delivered shipments. */
  tick(): Shipment[] {
    const now = this.clock(); const out: Shipment[] = [];
    for (const s of [...this.ships.values()]) {
      if (s.arriveAt > now) continue;
      if (s.kind === 'loc') { // truck logistics: credited at the destination location exactly once (retried with backoff)
        if (this.selling.has(s.id) || !this.onLoc) continue;
        const bo = this.factoryBackoff.get(s.id); if (bo && now < bo.next) continue;
        this.selling.add(s.id);
        void this.onLoc(s).then(() => { s.status = 'delivered'; this.ships.delete(s.id); this.factoryBackoff.delete(s.id); }, (e) => { const prev = this.factoryBackoff.get(s.id); const wait = Math.min(prev ? prev.wait * 2 : 15_000, 10 * 60_000); if (!prev) console.error(`[logistics] location delivery ${s.id} failed (will retry with backoff, logged once):`, (e as Error).message); this.factoryBackoff.set(s.id, { wait, next: this.clock() + wait }); }).finally(() => this.selling.delete(s.id));
        out.push(s); continue;
      }
      if (s.kind === 'factory') { // Fort McChud ore/petcoke for your factory: lands in factory storage on arrival (retried until it fits)
        if (this.selling.has(s.id) || !this.onFactory) continue;
        const bo = this.factoryBackoff.get(s.id); if (bo && now < bo.next) continue;
        this.selling.add(s.id);
        void this.onFactory(s).then(() => { s.status = 'delivered'; this.ships.delete(s.id); this.factoryBackoff.delete(s.id); }, (e) => { const prev = this.factoryBackoff.get(s.id); const wait = Math.min(prev ? prev.wait * 2 : 30_000, 10 * 60_000); if (!prev) console.error(`[logistics] factory delivery ${s.id} failed (will retry with backoff, logged once):`, (e as Error).message); this.factoryBackoff.set(s.id, { wait, next: this.clock() + wait }); }).finally(() => this.selling.delete(s.id));
        out.push(s); continue;
      }
      if (s.kind === 'sell') { // sells at the Chud City Warehouse on arrival; stays in transit (retried) until the sale commits
        if (this.selling.has(s.id) || !this.onSell) continue;
        this.selling.add(s.id);
        void this.onSell(s).then(() => { s.status = 'delivered'; this.ships.delete(s.id); }, (e) => console.error('[logistics] warehouse sale failed (will retry):', (e as Error).message)).finally(() => this.selling.delete(s.id));
        out.push(s); continue;
      }
      // Factory-to-factory (and legacy in-flight) loads: credited exactly once at the recipient's factory, or held if the
      // recipient has none (truck logistics; see LocMoves.arriveLegacy). Retried with backoff until it commits.
      if (this.onLegacy) {
        if (this.selling.has(s.id)) continue;
        const bo = this.factoryBackoff.get(s.id); if (bo && now < bo.next) continue;
        this.selling.add(s.id);
        void this.onLegacy(s).then(() => { s.status = 'delivered'; this.ships.delete(s.id); this.factoryBackoff.delete(s.id); }, (e) => { const prev = this.factoryBackoff.get(s.id); const wait = Math.min(prev ? prev.wait * 2 : 15_000, 10 * 60_000); if (!prev) console.error('[logistics] delivery failed (will retry):', (e as Error).message); this.factoryBackoff.set(s.id, { next: now + wait, wait }); }).finally(() => this.selling.delete(s.id));
        out.push(s); continue;
      }
      s.status = 'delivered'; this.ships.delete(s.id);
      getMines().adjustStack(s.toName, s.type, s.itemId, s.qty, [shipStmt(s)], (r) => this.rows(r), { onFail: () => { s.status = 'transit'; this.ships.set(s.id, s); } });
      out.push(s);
    }
    return out;
  }

  /** One vehicle per truck shipment; scheduled planes/ships group every load on the same departure+route. */
  live(): LiveVehicle[] {
    const now = this.clock(); const out = new Map<string, LiveVehicle>();
    for (const s of this.ships.values()) {
      if (s.arriveAt <= now || this.selling.has(s.id)) continue;
      const tag = s.kind === 'sell' ? (s.auto ? ' · auto-sell' : ' · to market') : s.kind === 'factory' ? ' · to factory' : s.kind === 'loc' ? ` · to ${locLabel(s.toLoc ?? '')}` : '';
      if (s.mode === 'truck' || s.mode === 'hired') {
        const m = s.truck ? TRUCK_BY_ID.get(this.owned(s.ownerName).find((t) => t.id === s.truck)?.truckId ?? '') : undefined;
        if (now < s.departAt) continue;
        out.set(s.id, { id: s.id, mode: s.mode, owner: s.ownerName, truck: m?.id ?? 'hired', label: (s.mode === 'truck' ? `${s.ownerName}'s ${m?.name ?? 'truck'}` : `Hired rig · ${s.ownerName}`) + tag, color: m?.color ?? 0x9ca3af, from: s.from, to: s.to, departAt: s.departAt, arriveAt: s.arriveAt, loads: 1, units: s.qty });
        continue;
      }
      if (s.mode === 'jet' || s.mode === 'boat') { 
        out.set(s.id, { id: s.id, mode: s.mode, owner: s.ownerName, truck: s.mode, label: `${s.ownerName}'s ${MODES[s.mode].label.replace('My ', '')}` + tag, color: s.mode === 'jet' ? 0xf4f4f4 : 0xe8eef6, from: s.from, to: s.to, departAt: s.departAt, arriveAt: s.arriveAt, loads: 1, units: s.qty }); continue; }
      const dir = s.to === 'city' ? 'in' : 'out'; const id = `${s.mode}:${s.departAt}:${dir}`; const v = out.get(id);
      if (v) { v.loads++; v.units += s.qty; if (v.owner !== s.ownerName) v.owner = null; continue; }
      out.set(id, { id, mode: s.mode, owner: s.ownerName, label: '', color: s.mode === 'ship' ? 0x1e3a8a : 0xf8fafc, from: s.from, to: s.to, departAt: s.departAt, arriveAt: s.arriveAt, loads: 1, units: s.qty });
    }
    for (const v of out.values()) if (!v.label) v.label = `${MODES[v.mode].label} · ${v.loads === 1 ? v.owner : `${v.loads} shippers`}`;
    return [...out.values()].sort((a, b) => a.departAt - b.departAt).slice(0, 40);
  }

  view(name: string | null) {
    const now = this.clock(); const k = name ? keyOf(name) : '';
    const busy = name ? this.busyTrucks(name) : new Set<string>();
    return {
      now, signedIn: !!name, chips: name && getBank().ready ? getBank().account(name).chips : null,
      store: TRUCKS.map((t) => ({ ...t, basePrice: t.price, price: px(t.price), travelMs: truckTravelMs(t), tripFee: px(CARGO[t.id]!.trip), upkeep: px(CARGO[t.id]!.useUpkeep), perUnit: px(CARGO[t.id]!.trip * 1000) / 1000 / CARGO[t.id]!.cap })),
      fleet: name ? this.owned(name).map((t) => ({ ...t, busy: busy.has(t.id) })) : [],
      modes: Object.values(MODES).map((m) => ({ ...m, next: nextDeparture(m.id, now), perUnitFee: m.perUnit ? px(m.perUnit * 100) / 100 : 0, minFeeNow: m.minFee ? px(m.minFee) : 0 })),
      stacks: name ? (() => { try { return getMines().stacks(name).map((s) => ({ ...s, name: nameOf(s) })); } catch { return []; } })() : [],
      shipments: name ? [...this.ships.values()].filter((s) => s.owner === k || s.toKey === k).sort((a, b) => a.arriveAt - b.arriveAt) : [],
      live: this.live(),
    };
  }
}

let logistics: Logistics | null = null;
export const getLogistics = () => logistics;
/** mu-coop3: trucks out on a supply-contract delivery are busy for freight too (server/supplyContracts.ts sets this). */
let extraBusyTrucks: (name: string) => Iterable<string> = () => [];
export function setExtraBusyTrucks(fn: ((name: string) => Iterable<string>) | null) { extraBusyTrucks = fn ?? (() => []); }
export function setLogistics(l: Logistics | null) { logistics = l; }
export async function initLogistics(): Promise<void> {
  const url = databaseUrl();
  if (!url) { logistics = new Logistics(null); setBootState('logistics', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[logistics] pool error:', e.message));
  await bootAttach('logistics', async () => { try { const l = new Logistics(pool as unknown as PoolLike); await l.init(); logistics = l; console.log('[logistics] ready'); return true; } catch (e) { console.error('[logistics] init failed:', (e as Error).message); return false; } });
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
let timer: NodeJS.Timeout | null = null;
export function registerLogistics(io: Server, socket: Socket): void {
  if (!timer) {
    let last = '';
    timer = setInterval(() => {
      if (!logistics || !invReady()) return; const done = logistics.tick();
      for (const s of done) io.to(`freight:${s.toKey}`).emit('freight_arrived', { qty: s.qty, what: nameOf({ type: s.type, id: s.itemId }), from: s.ownerName, mode: s.mode });
      const j = JSON.stringify(logistics.live()); if (j !== last || done.length) { last = j; io.to('freight').emit('freight_live', JSON.parse(j)); }
    }, 3000); timer.unref?.();
  }
  const nameOf_ = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf_(); if (!n) throw new FreightError('Sign in to ship goods and buy trucks. Guests can watch the traffic.'); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>, l: Logistics) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { if (!logistics) throw new FreightError('The freight yard is opening up. Try again in a moment.'); const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b, logistics)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof FreightError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  on('freight_view', async (_b, l) => { const n = nameOf_(); if (n) void socket.join(`freight:${keyOf(n)}`);
    const f = getFleet(); const own = n && f ? await f.owned(n).catch(() => []) : []; const busyJ = n ? l.busyOf(n, 'jet') : new Set<string>(), busyB = n ? l.busyOf(n, 'boat') : new Set<string>();
    return { ...l.view(n), crafts: own.map((c) => ({ id: c.id, kind: c.kind, model: c.model, cap: cargoCap(c.model), busy: (c.kind === 'jet' ? busyJ : busyB).has(c.id) })) }; });
  on('freight_quote', async (b, l) => {
    const qty = Math.max(1, Math.floor(Number(b.qty) || 1)); if (!isMode(b.mode)) return { fee: 0 };
    const n = nameOf_(); if (!isOwnMode(b.mode) || !n) return { fee: isOwnMode(b.mode) ? 0 : l.quote(b.mode, qty), trips: 1 };
    let v: { id: string; model: string } | null = null;
    if (b.mode === 'truck') { const t = l.idleTruck(n); const o = t && l.owned(n).find((x) => x.id === t.id); v = o ? { id: o.id, model: o.truckId } : null; } else v = await l.craftFor(n, b.mode, b.vehicle).catch(() => null);
    return v ? { fee: l.ownQuote(v.model, v.id, qty), trips: tripsFor(qty, cargoCap(v.model)), cap: cargoCap(v.model) } : { fee: 0, trips: 0 };
  });
  on('freight_ship', async (b, l) => { const r = await l.ship(need(), b); io.to('freight').emit('freight_live', l.live()); return r; });
  // Map pools: same-map moves need no truck, and trucks never cross maps, so no NEW truck sales (owned trucks + sell-back kept).
  on('truck_buy', async () => { throw new FreightError('Trucks are no longer needed: moves on the same map are instant and free.'); });
  on('truck_sell', (b, l) => l.sellTruck(need(), b.id));
  socket.on('freight_watch', (on: unknown) => { if (on === false) void socket.leave('freight'); else { void socket.join('freight'); if (logistics) socket.emit('freight_live', logistics.live()); } });
}

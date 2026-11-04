/**
 * Logistics (Millionaire Update): truck store + shipments between maps.
 *
 * Chips only move through the wallet + ledger: a truck buy is CasinoBank.transferAtomic ('truck_buy') in ONE Postgres
 * transaction with the truck_owned row; a sell-back is 'truck_sell'; carrier fees are 'freight' debits that commit in the
 * same transaction as the goods leaving storage and the shipment row (Mines adjustStack extra rows). Fees are a chip sink.
 * Goods are escrowed (out of storage) while in transit and land in the recipient's banked storage on arrival.
 * Every in-transit or loading shipment is broadcast to the 'freight' room so the map can draw the vehicle.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { bootAttach, setBootState } from './boot-retry.js';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { getMines } from './mines.js';
import { getAccounts } from './accounts.js';
import { px } from './price-index.js';
import { nameOf, type ItemType } from '../shared/mines.js';
import { isStackable } from './market.js';
import { HUBS, MAX_SHIP_QTY, MAX_TRUCKS, MODES, TRUCKS, TRUCK_BY_ID, TRUCK_SELL_BACK, arrivalOf, feeBase, isHub, isMode, nextDeparture, truckTravelMs, type HubId, type LiveVehicle, type Mode } from '../shared/logistics.js';

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
CREATE INDEX IF NOT EXISTS freight_shipments_status ON freight_shipments (status);`;

export interface OwnedTruck { id: string; truckId: string; paid: number; boughtAt: number }
export interface Shipment { id: string; owner: string; ownerName: string; toKey: string; toName: string; mode: Mode; truck: string | null; from: HubId; to: HubId; type: ItemType; itemId: string; qty: number; fee: number; createdAt: number; departAt: number; arriveAt: number; status: 'transit' | 'delivered' }

const shipStmt = (s: Shipment): Stmt => ({
  sql: `INSERT INTO freight_shipments (id, player_key, name, to_key, to_name, mode, truck, from_hub, to_hub, item_type, item_id, qty, fee, created_at, depart_at, arrive_at, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
  args: [s.id, s.owner, s.ownerName, s.toKey, s.toName, s.mode, s.truck, s.from, s.to, s.type, s.itemId, s.qty, s.fee, s.createdAt, s.departAt, s.arriveAt, s.status],
});
const rowShip = (r: Record<string, unknown>): Shipment => ({ id: String(r.id), owner: String(r.player_key), ownerName: String(r.name), toKey: String(r.to_key), toName: String(r.to_name), mode: String(r.mode) as Mode, truck: r.truck == null ? null : String(r.truck),
  from: String(r.from_hub) as HubId, to: String(r.to_hub) as HubId, type: String(r.item_type) as ItemType, itemId: String(r.item_id), qty: Number(r.qty), fee: Number(r.fee), createdAt: Number(r.created_at), departAt: Number(r.depart_at), arriveAt: Number(r.arrive_at), status: String(r.status) as Shipment['status'] });
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
    for (const r of (await this.pool.query("SELECT * FROM freight_shipments WHERE status = 'transit'")).rows) { const s = rowShip(r); this.ships.set(s.id, s); }
  }
  private rows(rows: Stmt[]) { if (!rows.length || !this.pool) return; const pool = this.pool; void (async () => { const cl = await pool.connect(); try { await cl.query('BEGIN'); for (const s of rows) await cl.query(s.sql, s.args); await cl.query('COMMIT'); } catch (e) { await cl.query('ROLLBACK').catch(() => {}); console.error('[logistics] write failed:', (e as Error).message); } finally { cl.release(); } })(); }

  owned(name: string) { return [...(this.trucks.get(keyOf(name)) ?? [])]; }
  busyTrucks(name: string) { const k = keyOf(name); return new Set([...this.ships.values()].filter((s) => s.owner === k && s.mode === 'truck' && s.truck).map((s) => s.truck!)); }

  /** Truck store: one transaction (ledger debit + truck row). */
  async buyTruck(name: string, truckId: unknown) {
    const t = typeof truckId === 'string' ? TRUCK_BY_ID.get(truckId) : undefined; if (!t) throw new FreightError('That truck is not in the store.');
    const k = keyOf(name); const mine = this.owned(name); if (mine.length >= MAX_TRUCKS) throw new FreightError(`Fleet full (${MAX_TRUCKS} trucks). Sell one first.`);
    const price = px(t.price); const bank = getBank(); if (!bank.canAfford(name, price)) throw new FreightError('Not enough chips.');
    const id = randomUUID(); const at = this.clock(); const truck: OwnedTruck = { id, truckId: t.id, paid: price, boughtAt: at };
    const w = bank.transferAtomic([{ name, amount: -price, key: `truck_buy:${id}`, game: 'truck_buy', memo: `Bought a ${t.name}` }]);
    const run = async () => {
      if (!this.pool) return; await w.after; const cl = await this.pool.connect();
      try { await cl.query('BEGIN'); await cl.query('INSERT INTO truck_owned (id, player_key, name, truck_id, paid, bought_at) VALUES ($1,$2,$3,$4,$5,$6)', [id, k, name.trim(), t.id, price, at]); for (const s of w.stmts) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
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

  quote(mode: Mode, qty: number) { return feeBase(mode, qty) ? px(feeBase(mode, qty)) : 0; }

  /** Send goods. Goods leave storage, the fee (if any) is debited and the shipment row is written, all in one transaction. */
  async ship(name: string, b: Record<string, unknown>): Promise<{ shipment: Shipment; chips: number | null }> {
    const mode = b.mode; if (!isMode(mode)) throw new FreightError('Pick how to ship it.');
    const from = isHub(b.from) ? b.from : 'city'; const to = b.to; if (!isHub(to)) throw new FreightError('Pick a destination.');
    if (from === to && !b.recipient) throw new FreightError('Pick a different map (or send it to another player).');
    if (!stackable(b.type, b.id)) throw new FreightError('That item can not be shipped.');
    const type = b.type as ItemType; const itemId = b.id as string;
    const qty = Number(b.qty); if (!Number.isInteger(qty) || qty < 1 || qty > MAX_SHIP_QTY) throw new FreightError('Pick a quantity.');
    const recipient = typeof b.recipient === 'string' && b.recipient.trim() ? b.recipient.trim().slice(0, 40) : name.trim();
    if (keyOf(recipient) !== keyOf(name) && !(await this.exists(recipient))) throw new FreightError(`No player called ${recipient}.`);
    let truck: string | null = null; let travel = MODES[mode].travelMs; let cap = MODES[mode].cap;
    if (mode === 'truck') {
      const busy = this.busyTrucks(name); const mine = this.owned(name);
      const pick = typeof b.truck === 'string' ? mine.find((t) => t.id === b.truck) : mine.find((t) => !busy.has(t.id));
      if (!mine.length) throw new FreightError('You do not own a truck. Buy one at the truck store, or hire one for a fee.');
      if (!pick) throw new FreightError('All your trucks are out on deliveries. Hire one, or wait.');
      if (busy.has(pick.id)) throw new FreightError('That truck is already out on a delivery.');
      const m = TRUCK_BY_ID.get(pick.truckId)!; truck = pick.id; cap = m.cap; travel = truckTravelMs(m);
    }
    if (qty > cap) throw new FreightError(`Too much for one ${MODES[mode].label.toLowerCase()}: max ${cap.toLocaleString('en-US')} units.`);
    const mines = getMines(); const have = mines.stackQty(name, type, itemId);
    if (have < qty) throw new FreightError(`You only have ${have} ${nameOf({ type, id: itemId })}.`);
    const fee = this.quote(mode, qty); const bank = getBank();
    if (fee && !bank.canAfford(name, fee)) throw new FreightError(`Not enough chips for the 🪙 ${fee.toLocaleString('en-US')} fee.`);
    const now = this.clock(); const departAt = nextDeparture(mode, now);
    const s: Shipment = { id: randomUUID(), owner: keyOf(name), ownerName: name.trim(), toKey: keyOf(recipient), toName: recipient, mode, truck, from, to, type, itemId, qty, fee, createdAt: now, departAt, arriveAt: departAt + travel, status: 'transit' };
    if (mode !== 'truck') s.arriveAt = arrivalOf(mode, departAt);
    const w = fee ? bank.transferAtomic([{ name, amount: -fee, key: `freight:${s.id}`, game: 'freight', memo: `${MODES[mode].label}: ${qty} ${nameOf({ type, id: itemId })} to ${HUBS[to].label}` }]) : null;
    this.ships.set(s.id, s);
    const onFail = () => { w?.revert(); this.ships.delete(s.id); };
    const ok = mines.adjustStack(name, type, itemId, -qty, [...(w?.stmts ?? []), shipStmt(s)], (r) => this.rows(r), w ? { after: w.after, bind: w.bind, onFail } : { onFail });
    if (!ok) { onFail(); throw new FreightError('Not enough items.'); }
    return { shipment: s, chips: bank.ready ? bank.account(name).chips : null };
  }

  /** Deliver everything that has arrived. Returns delivered shipments. */
  tick(): Shipment[] {
    const now = this.clock(); const out: Shipment[] = [];
    for (const s of [...this.ships.values()]) {
      if (s.arriveAt > now) continue;
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
      if (s.arriveAt <= now) continue;
      if (s.mode === 'truck' || s.mode === 'hired') {
        const m = s.truck ? TRUCK_BY_ID.get(this.owned(s.ownerName).find((t) => t.id === s.truck)?.truckId ?? '') : undefined;
        if (now < s.departAt) continue;
        out.set(s.id, { id: s.id, mode: s.mode, owner: s.ownerName, truck: m?.id ?? 'hired', label: s.mode === 'truck' ? `${s.ownerName}'s ${m?.name ?? 'truck'}` : `Hired rig · ${s.ownerName}`, color: m?.color ?? 0x9ca3af, from: s.from, to: s.to, departAt: s.departAt, arriveAt: s.arriveAt, loads: 1, units: s.qty });
        continue;
      }
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
      store: TRUCKS.map((t) => ({ ...t, basePrice: t.price, price: px(t.price), travelMs: truckTravelMs(t) })),
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
      if (!logistics) return; const done = logistics.tick();
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
  on('freight_view', (_b, l) => { const n = nameOf_(); if (n) void socket.join(`freight:${keyOf(n)}`); return l.view(n); });
  on('freight_quote', (b, l) => ({ fee: isMode(b.mode) ? l.quote(b.mode, Math.max(1, Math.floor(Number(b.qty) || 1))) : 0 }));
  on('freight_ship', async (b, l) => { const r = await l.ship(need(), b); io.to('freight').emit('freight_live', l.live()); return r; });
  on('truck_buy', (b, l) => l.buyTruck(need(), b.truck));
  on('truck_sell', (b, l) => l.sellTruck(need(), b.id));
  socket.on('freight_watch', (on: unknown) => { if (on === false) void socket.leave('freight'); else { void socket.join('freight'); if (logistics) socket.emit('freight_live', logistics.live()); } });
}

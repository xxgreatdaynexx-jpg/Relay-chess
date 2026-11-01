/**
 * Car Dealership + live driving relay.
 *
 * Garage: buy / sell-back / pick an active car. A buy is ONE Postgres transaction holding the chip ledger rows
 * (CasinoBank.transferAtomic, reason 'car_buy') and the car_owned row; a sell-back pays the depreciated value ('car_sell').
 * Chips never get written any other way.
 *
 * Driving: signed-in players with an active car send their pose ~8 Hz ('drive_state'). The server checks each update
 * (bounds, speed for that car, max travel since the last one), keeps the last accepted pose, and broadcasts one snapshot
 * of every active driver at 8 Hz to the 'drive' room (anyone on the city map, guests included). Disconnect, 'drive_stop'
 * or 8 s without an update removes the car.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { bootAttach, setBootState } from './boot-retry.js';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { px } from './price-index.js';
import { FLY_DEST, nearAirport, type FlyDest } from '../shared/venues.js';
import { CAR_BY_ID, CARS, DRIVE_BROADCAST_MS, DRIVE_IDLE_MS, DRIVE_MAX_VISIBLE, carValue, validDrive, type DriveState } from '../shared/cars.js';

export class CarError extends Error {}
export const keyOf = (n: string) => n.trim().toLowerCase();
export const MAX_CARS = 12;

export const CARS_MIGRATION = `CREATE TABLE IF NOT EXISTS car_owned (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, car_id TEXT NOT NULL,
  color INTEGER NOT NULL, paid BIGINT NOT NULL, bought_at BIGINT NOT NULL, active BOOLEAN NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS car_owned_player ON car_owned (player_key);`;

export interface OwnedCar { id: string; carId: string; color: number; paid: number; boughtAt: number; active: boolean }
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };
const row = (r: Record<string, unknown>): OwnedCar => ({ id: String(r.id), carId: String(r.car_id), color: Number(r.color), paid: Number(r.paid), boughtAt: Number(r.bought_at), active: !!r.active });

export class Garage {
  private mem = new Map<string, OwnedCar[]>();
  /** Active car cache per player (for the driving relay). */
  private activeCache = new Map<string, { carId: string; color: number } | null>();
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) {}
  async init() { if (this.pool) await this.pool.query(CARS_MIGRATION); }

  async owned(name: string): Promise<OwnedCar[]> {
    const k = keyOf(name);
    if (!this.pool) return [...(this.mem.get(k) ?? [])];
    return (await this.pool.query('SELECT * FROM car_owned WHERE player_key = $1 ORDER BY bought_at', [k])).rows.map(row);
  }
  async garage(name: string | null) {
    const now = this.clock();
    const cars = name ? (await this.owned(name)).map((c) => ({ ...c, value: carValue(resaleBase(c), c.boughtAt, now) })) : [];
    return { signedIn: !!name, cars, chips: name && getBank().ready ? getBank().account(name).chips : null };
  }
  async active(name: string): Promise<{ carId: string; color: number } | null> {
    const k = keyOf(name);
    if (this.activeCache.has(k)) return this.activeCache.get(k)!;
    const a = (await this.owned(name)).find((c) => c.active) ?? null;
    const v = a ? { carId: a.carId, color: a.color } : null; this.activeCache.set(k, v); return v;
  }

  async buy(name: string, carId: unknown, color: unknown) {
    const car = typeof carId === 'string' ? CAR_BY_ID.get(carId) : undefined; if (!car) throw new CarError('That car is not on the lot.');
    const col = typeof color === 'number' && car.colors.includes(color) ? color : car.colors[0]!;
    const mine = await this.owned(name); const price = px(car.price); if (mine.length >= MAX_CARS) throw new CarError(`Garage full (${MAX_CARS} cars). Sell one first.`);
    const bank = getBank(); if (!bank.canAfford(name, price)) throw new CarError('Not enough chips.');
    const id = randomUUID(); const at = this.clock(); const k = keyOf(name); const first = !mine.some((c) => c.active);
    const w = bank.transferAtomic([{ name, amount: -price, key: `car_buy:${id}`, game: 'car_buy', memo: `Bought ${car.name}` }]);
    const run = async () => {
      if (!this.pool) { const l = this.mem.get(k) ?? []; l.push({ id, carId: car.id, color: col, paid: price, boughtAt: at, active: first }); this.mem.set(k, l); return; }
      await w.after; const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query('INSERT INTO car_owned (id, player_key, name, car_id, color, paid, bought_at, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, k, name.trim(), car.id, col, price, at, first]);
        for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); console.error('[cars] buy failed:', (e as Error).message); throw new CarError(/chips|balance|null value/i.test((e as Error).message) ? 'Not enough chips.' : 'Purchase failed. Nothing was charged.'); }
    this.activeCache.delete(k);
    return { id, car: car.id, price, chips: bank.account(name).chips };
  }

  async sell(name: string, ownedId: unknown) {
    if (typeof ownedId !== 'string') throw new CarError('Pick a car to sell.');
    const k = keyOf(name); const c = (await this.owned(name)).find((x) => x.id === ownedId); if (!c) throw new CarError('You do not own that car.');
    const car = CAR_BY_ID.get(c.carId); const pay = carValue(resaleBase(c), c.boughtAt, this.clock()); const bank = getBank();
    const w = bank.transferAtomic([{ name, amount: pay, key: `car_sell:${c.id}`, game: 'car_sell', memo: `Sold ${car?.name ?? c.carId} back to the dealer` }]);
    const run = async () => {
      if (!this.pool) { const l = this.mem.get(k) ?? []; const i = l.findIndex((x) => x.id === c.id); if (i < 0) throw new CarError('You do not own that car.'); l.splice(i, 1); return; }
      await w.after; const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        if (((await cl.query('DELETE FROM car_owned WHERE id = $1 AND player_key = $2', [c.id, k])).rowCount ?? 0) === 0) throw new CarError('You do not own that car.');
        for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); if (e instanceof CarError) throw e; console.error('[cars] sell failed:', (e as Error).message); throw new CarError('Sale failed. Nothing changed.'); }
    this.activeCache.delete(k);
    return { paid: pay, chips: bank.account(name).chips };
  }

  async setActive(name: string, ownedId: unknown) {
    const k = keyOf(name); const mine = await this.owned(name); if (!mine.some((c) => c.id === ownedId)) throw new CarError('You do not own that car.');
    if (!this.pool) for (const c of this.mem.get(k) ?? []) c.active = c.id === ownedId;
    else await this.pool.query('UPDATE car_owned SET active = (id = $2) WHERE player_key = $1', [k, ownedId]);
    this.activeCache.delete(k); return { active: ownedId };
  }

  /** Total depreciated value per player (Bank assets). */
  async values(exclude = (k: string) => k.startsWith('qa-')): Promise<Array<{ carId: string; value: number }>> {
    const now = this.clock();
    const all = this.pool ? (await this.pool.query('SELECT * FROM car_owned')).rows.map((r) => ({ k: String(r.player_key), c: row(r) })) : [...this.mem].flatMap(([k, l]) => l.map((c) => ({ k, c })));
    return all.filter((x) => !exclude(x.k)).map((x) => ({ carId: x.c.carId, value: carValue(resaleBase(x.c), x.c.boughtAt, now) }));
  }
}

/** Sell-back / asset value is based on today's indexed list price (falls back to what was paid for unknown models). */
const resaleBase = (c: { carId: string; paid: number }) => { const m = CAR_BY_ID.get(c.carId); return m ? px(m.price) : c.paid; };

/** Live drivers (in-memory; one Render instance). */
export interface Driver extends DriveState { name: string; carId: string; color: number; t: number; sid: string }
export class DriveRelay {
  drivers = new Map<string, Driver>();
  constructor(private readonly clock = () => Date.now()) {}
  update(sid: string, name: string, car: { carId: string; color: number }, s: unknown): boolean {
    const k = keyOf(name); const now = this.clock(); const prev = this.drivers.get(k);
    const model = CAR_BY_ID.get(car.carId); if (!model) return false;
    const fresh = !prev || prev.sid !== sid || prev.carId !== car.carId || now - prev.t > DRIVE_IDLE_MS;
    if (!validDrive(s, fresh ? null : prev, now, model.topKmh)) return false;
    const st = s as DriveState;
    this.drivers.set(k, { name: name.trim(), carId: car.carId, color: car.color, sid, t: now, x: st.x, z: st.z, a: st.a, v: st.v });
    return true;
  }
  /** Airport fast travel: only from near the terminal; moves the accepted pose so the next update isn't a 'teleport'. */
  fly(name: string, sid: string, to: unknown): { x: number; z: number; a: number } | null {
    const k = keyOf(name); const d = this.drivers.get(k); const now = this.clock(); const dest = typeof to === 'string' ? FLY_DEST[to as FlyDest] : undefined;
    if (!dest || !d || d.sid !== sid || now - d.t > DRIVE_IDLE_MS || !nearAirport(d.x, d.z)) return null;
    Object.assign(d, { x: dest.x, z: dest.z, a: dest.a, v: 0, t: now }); return { x: dest.x, z: dest.z, a: dest.a };
  }
  stop(name: string, sid?: string) { const k = keyOf(name); const d = this.drivers.get(k); if (d && (!sid || d.sid === sid)) this.drivers.delete(k); }
  dropSocket(sid: string) { for (const [k, d] of this.drivers) if (d.sid === sid) this.drivers.delete(k); }
  snapshot() {
    const now = this.clock(); const out: Array<[string, string, number, number, number, number, number]> = [];
    for (const [k, d] of this.drivers) { if (now - d.t > DRIVE_IDLE_MS) { this.drivers.delete(k); continue; } out.push([d.name, d.carId, d.color, +d.x.toFixed(2), +d.z.toFixed(2), +d.a.toFixed(3), +d.v.toFixed(1)]); }
    return out.slice(0, DRIVE_MAX_VISIBLE);
  }
}

let garage: Garage | null = null;
const relay = new DriveRelay();
/** Called with every accepted pose (the racetrack's lap timer); `reset` after a fly / stop. Returns events to send back. */
export type DriveHook = { pose: (name: string, carId: string, x: number, z: number, t: number) => Promise<unknown[]> | unknown[]; reset: (name: string) => void };
let hook: DriveHook | null = null;
export const setDriveHook = (h: DriveHook | null) => { hook = h; };
export const getGarage = () => garage;
export function setGarage(g: Garage | null) { garage = g; }
export async function initCars(): Promise<void> {
  const url = databaseUrl();
  if (!url) { garage = new Garage(null); setBootState('cars', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[cars] pool error:', e.message));
  await bootAttach('cars', async () => { try { const g = new Garage(pool as unknown as PoolLike); await g.init(); garage = g; console.log('[cars] ready'); return true; } catch (e) { console.error('[cars] init failed:', (e as Error).message); return false; } });
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
let timer: NodeJS.Timeout | null = null; let lastSent = '';
export function registerCars(io: Server, socket: Socket): void {
  if (!timer) { timer = setInterval(() => { const s = relay.snapshot(); const j = JSON.stringify(s); if (j === lastSent && !s.length) return; lastSent = j; io.to('drive').emit('drive_cars', s); }, DRIVE_BROADCAST_MS); timer.unref?.(); }
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf(); if (!n) throw new CarError('Sign in to buy and drive cars. Guests can browse.'); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>, g: Garage) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { if (!garage) throw new CarError('The dealership is opening up. Try again in a moment.'); const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b, garage)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof CarError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  on('car_catalog', () => ({ cars: CARS.map((c) => ({ ...c, basePrice: c.price, price: px(c.price) })) }));
  on('car_garage', (_b, g) => g.garage(nameOf()));
  on('car_buy', (b, g) => g.buy(need(), b.car, b.color));
  on('car_sell', async (b, g) => { const n = need(); const r = await g.sell(n, b.id); relay.stop(n); return r; });
  on('car_active', (b, g) => g.setActive(need(), b.id));
  // Viewing the city map: join to receive other drivers.
  socket.on('drive_watch', (on: unknown) => { if (on === false) void socket.leave('drive'); else { void socket.join('drive'); socket.emit('drive_cars', relay.snapshot()); } });
  let warn = 0;
  socket.on('drive_state', async (s: unknown) => {
    const n = nameOf(); if (!n || !garage) return;
    const car = await garage.active(n).catch(() => null); if (!car) return;
    if (!relay.update(socket.id, n, car, s)) { if (Date.now() - warn > 5000) { warn = Date.now(); socket.emit('drive_reject'); } return; }
    if (hook) { const st = s as DriveState; const ev = await Promise.resolve(hook.pose(n, car.carId, st.x, st.z, Date.now())).catch(() => []); if (ev.length) socket.emit('race_ev', ev); }
  });
  socket.on('drive_stop', () => { const n = nameOf(); if (n) { relay.stop(n, socket.id); hook?.reset(n); } });
  socket.on('drive_fly', (b: unknown, ack?: Ack) => {
    const n = nameOf(); const to = b && typeof b === 'object' ? (b as Record<string, unknown>).to : undefined;
    const r = n ? relay.fly(n, socket.id, to) : null; if (r && n) hook?.reset(n);
    ack?.(r ? { ok: true, ...r } : { ok: false, error: 'Drive up to the airport terminal to catch a flight.' });
  });
  socket.on('disconnect', () => relay.dropSocket(socket.id));
}

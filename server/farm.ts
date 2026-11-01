/**
 * Farm game (see shared/farm.ts for crops, tiers and layout). Postgres is the source of truth and the server clock is
 * the only clock: planting stores planted_at = server now; stages are derived from it. Chips only move through the
 * atomic wallet (CasinoBank.transferAtomic) with ledger reasons 'farm_seed' and 'farm_harvest', committed in the same
 * transaction as the tile change, so a harvest pays exactly once: the DELETE of the claimed tiles (matched by their
 * plant nonce) must remove every tile we priced, and the daily-tier row is advanced with an optimistic check, or the
 * whole transaction (ledger included) rolls back.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { getBank, type CasinoBank } from './casino-store.js';
import { px, priceIndex } from './price-index.js';
import { CROPS, cropById, farmPayout, farmPlots, stageOf, WITHER_FACTOR, type FarmTile, type FarmView } from '../shared/farm.js';

export const FARM_MIGRATION = `
CREATE TABLE IF NOT EXISTS farm_tiles (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, owner_key TEXT NOT NULL, crop TEXT NOT NULL, planted_at BIGINT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY (plot_id, tile));
CREATE TABLE IF NOT EXISTS farm_daily (player_key TEXT NOT NULL, day TEXT NOT NULL, gross BIGINT NOT NULL DEFAULT 0, paid BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (player_key, day));
`;
export class FarmError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const plotOf = (id: unknown) => (typeof id === 'string' && /^f:\d+$/.test(id) ? farmPlots().find((p) => `f:${p.n}` === id) : undefined);
interface TileRow { plot_id: string; tile: number; owner_key: string; crop: string; planted_at: string | number; nonce: string }

export class Farm {
  onChange?: (plotId: string) => void;
  private locks = new Map<string, Promise<unknown>>();
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  constructor(private readonly pool: pg.Pool, private readonly bank: () => CasinoBank = getBank, private readonly clock = () => Date.now()) {}
  async init() { await this.pool.query(FARM_MIGRATION); }

  private async ownerOf(q: { query: pg.Pool['query'] } | pg.PoolClient, id: string): Promise<{ key: string; name: string } | null> {
    const r = await q.query('SELECT owner_key, owner_name FROM properties WHERE id = $1', [id]);
    return r.rows[0] ? { key: String(r.rows[0].owner_key), name: String(r.rows[0].owner_name) } : null;
  }
  /** Tiles of the CURRENT owner only (crops left by a previous owner are gone with the deed). */
  private async tiles(id: string, ownerKey: string): Promise<TileRow[]> {
    return (await this.pool.query('SELECT * FROM farm_tiles WHERE plot_id = $1 AND owner_key = $2 ORDER BY tile', [id, ownerKey])).rows as TileRow[];
  }
  private async today(key: string) {
    const r = await this.pool.query('SELECT gross, paid FROM farm_daily WHERE player_key = $1 AND day = $2', [key, utcDay(this.clock())]);
    return { gross: Number(r.rows[0]?.gross ?? 0), paid: Number(r.rows[0]?.paid ?? 0) };
  }
  private toTile(r: TileRow, now: number): FarmTile | null {
    const c = cropById(r.crop); if (!c) return null; const at = Number(r.planted_at);
    return { tile: Number(r.tile), crop: c.id, plantedAt: at, stage: stageOf(c, at, now), readyAt: at + c.grow, witherAt: at + c.grow * (1 + WITHER_FACTOR) };
  }

  /** Anyone can look at a farm (visiting neighbours); only the owner can act on it. */
  async view(id: unknown, name: string | null): Promise<FarmView> {
    const p = plotOf(id); if (!p) throw new FarmError('Unknown farm plot.');
    const pid = `f:${p.n}`; const o = await this.ownerOf(this.pool, pid); const now = this.clock();
    const tiles = o ? (await this.tiles(pid, o.key)).map((r) => this.toTile(r, now)).filter((t): t is FarmTile => !!t) : [];
    const mine = !!o && !!name && o.key === keyOf(name);
    return { id: pid, owner: o?.name ?? null, mine, cols: p.cols, rows: p.rows, tiles, now, today: mine ? await this.today(o!.key) : { gross: 0, paid: 0 }, index: priceIndex() };
  }

  private async atomic(name: string, amount: number, game: string, memo: string, body: (cl: pg.PoolClient) => Promise<void>) {
    if (amount === 0) { const cl = await this.pool.connect(); try { await cl.query('BEGIN'); await body(cl); await cl.query('COMMIT'); } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); } return; }
    const w = this.bank().transferAtomic([{ name, amount, key: `${game}:${randomUUID()}`, game, memo }]);
    const run = async () => {
      await w.after; const cl = await this.pool.connect();
      try { await cl.query('BEGIN'); await body(cl); for (const s of w.stmts) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
      catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); if (e instanceof FarmError) throw e; console.error(`[farm] ${game} failed:`, (e as Error).message); throw new FarmError(/chips|balance|null value/i.test((e as Error).message) ? 'Not enough chips.' : 'Something went wrong. Nothing was charged.'); }
  }
  private async mustOwn(cl: pg.PoolClient, pid: string, name: string) {
    const o = await this.ownerOf(cl, pid); if (!o || o.key !== keyOf(name)) throw new FarmError('You do not own this farm plot.'); return o;
  }
  private tileList(p: NonNullable<ReturnType<typeof plotOf>>, tiles: unknown): number[] {
    const n = p.cols * p.rows; const arr = Array.isArray(tiles) ? tiles : [tiles];
    const out = [...new Set(arr.filter((t): t is number => Number.isInteger(t) && (t as number) >= 0 && (t as number) < n))];
    if (!out.length) throw new FarmError('Pick a tile.'); return out;
  }

  /** Plant `crop` on the given empty tiles; seeds are paid now (px-indexed). */
  async plant(name: string, id: unknown, cropId: unknown, tiles: unknown) {
    const p = plotOf(id); if (!p) throw new FarmError('Unknown farm plot.'); const c = cropById(cropId); if (!c) throw new FarmError('Unknown seed.');
    const list = this.tileList(p, tiles); const pid = `f:${p.n}`;
    return this.lock(pid, async () => {
      const cost = px(c.seed) * list.length; const bank = this.bank(); await bank.refresh(name);
      if (bank.account(name).chips < cost) throw new FarmError(`Not enough chips: ${list.length} × ${c.label} seeds cost ${cost.toLocaleString('en-US')}.`);
      const now = this.clock(); const nonce = randomUUID();
      await this.atomic(name, -cost, 'farm_seed', `Farm ${pid}: planted ${list.length} ${c.label}`, async (cl) => {
        const o = await this.mustOwn(cl, pid, name);
        await cl.query('DELETE FROM farm_tiles WHERE plot_id = $1 AND owner_key <> $2', [pid, o.key]); // a previous owner's crops
        const busy = (await cl.query('SELECT tile FROM farm_tiles WHERE plot_id = $1', [pid])).rows.map((r) => Number(r.tile));
        if (list.some((t) => busy.includes(t))) throw new FarmError(list.length === 1 ? 'That tile is already planted.' : 'Some of those tiles are already planted.');
        for (const t of list) await cl.query('INSERT INTO farm_tiles (plot_id, tile, owner_key, crop, planted_at, nonce) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (plot_id, tile) DO NOTHING', [pid, t, o.key, c.id, now, nonce]);
        const r = await cl.query('SELECT tile FROM farm_tiles WHERE plot_id = $1 AND nonce = $2', [pid, nonce]);
        if (r.rows.length !== list.length) throw new FarmError(list.length === 1 ? 'That tile is already planted.' : 'Some of those tiles are already planted.');
      });
      this.onChange?.(pid);
      return { planted: list.length, cost, chips: bank.account(name).chips };
    });
  }

  /** Harvest every ready tile (or the given ones). Exactly once: the tiles are deleted in the payout's transaction. */
  async harvest(name: string, id: unknown, tiles?: unknown) {
    const p = plotOf(id); if (!p) throw new FarmError('Unknown farm plot.'); const pid = `f:${p.n}`;
    const only = tiles === undefined || tiles === null ? null : new Set(this.tileList(p, tiles));
    return this.lock(`h:${keyOf(name)}`, () => this.lock(pid, async () => {
      const now = this.clock(); const key = keyOf(name);
      const ready = (await this.tiles(pid, key)).filter((r) => (!only || only.has(Number(r.tile))) && this.toTile(r, now)?.stage === 'ready');
      if (!ready.length) throw new FarmError('Nothing is ready to harvest.');
      let seeds = 0, profit = 0; const counts = new Map<string, number>();
      for (const r of ready) { const c = cropById(r.crop)!; seeds += c.seed; profit += c.sell - c.seed; counts.set(c.label, (counts.get(c.label) ?? 0) + 1); }
      const day = utcDay(now); const t = await this.today(key);
      const paid = Math.floor((seeds + farmPayout(profit, t.gross)) * priceIndex());
      const memo = `Farm ${pid}: harvested ${[...counts].map(([l, n]) => `${n} ${l}`).join(', ')}`.slice(0, 200);
      await this.atomic(name, paid, 'farm_harvest', memo, async (cl) => {
        await this.mustOwn(cl, pid, name);
        let gone = 0;
        for (const r of ready) gone += (await cl.query('DELETE FROM farm_tiles WHERE plot_id = $1 AND tile = $2 AND nonce = $3 AND owner_key = $4', [pid, r.tile, r.nonce, key])).rowCount ?? 0;
        if (gone !== ready.length) throw new FarmError('Already harvested.');
        await cl.query('INSERT INTO farm_daily (player_key, day, gross, paid) VALUES ($1,$2,0,0) ON CONFLICT (player_key, day) DO NOTHING', [key, day]);
        const u = await cl.query('UPDATE farm_daily SET gross = gross + $3, paid = paid + $4 WHERE player_key = $1 AND day = $2 AND gross = $5', [key, day, profit, paid, t.gross]);
        if (!u.rowCount) throw new FarmError('Busy, try again.');
      });
      this.onChange?.(pid);
      return { harvested: ready.length, paid, chips: this.bank().account(name).chips };
    }));
  }

  /** Clear withered crops (free). */
  async clear(name: string, id: unknown) {
    const p = plotOf(id); if (!p) throw new FarmError('Unknown farm plot.'); const pid = `f:${p.n}`; const key = keyOf(name);
    return this.lock(pid, async () => {
      const now = this.clock(); const dead = (await this.tiles(pid, key)).filter((r) => this.toTile(r, now)?.stage === 'withered');
      if (!dead.length) throw new FarmError('Nothing has withered.');
      for (const r of dead) await this.pool.query('DELETE FROM farm_tiles WHERE plot_id = $1 AND tile = $2 AND nonce = $3', [pid, r.tile, r.nonce]);
      this.onChange?.(pid); return { cleared: dead.length };
    });
  }

  /** Every planted tile on an owned plot (for the map: crops visible from the city view). */
  async mapTiles(): Promise<Array<[string, number, string, Stage]>> {
    const rows = (await this.pool.query('SELECT t.plot_id, t.tile, t.crop, t.planted_at, t.owner_key, p.owner_key AS cur FROM farm_tiles t JOIN properties p ON p.id = t.plot_id')).rows as Array<TileRow & { cur: string }>;
    const now = this.clock();
    return rows.filter((r) => r.owner_key === r.cur).flatMap((r) => { const t = this.toTile(r, now); return t ? [[r.plot_id, t.tile, t.crop, t.stage] as [string, number, string, Stage]] : []; });
  }
}
type Stage = FarmTile['stage'];

let farm: Farm | null = null;
export const getFarm = () => farm;
export async function initFarm(): Promise<void> {
  const url = databaseUrl(); if (!url) return;
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[farm] pool error:', e.message));
  try { const f = new Farm(pool); await f.init(); farm = f; console.log('[farm] ready'); } catch (e) { console.error('[farm] init failed:', (e as Error).message); }
}

/** Public read: crops on every owned plot (for the map) and the seed shop at today's prices. */
export function farmRouter() {
  const r = express.Router();
  r.get('/api/farm', async (_req, res) => {
    const seeds = CROPS.map((c) => ({ id: c.id, seed: px(c.seed), sell: px(c.sell) }));
    if (!farm) { res.json({ ok: true, live: false, tiles: [], seeds }); return; }
    try { res.json({ ok: true, live: true, tiles: await farm.mapTiles(), seeds }); } catch { res.status(500).json({ ok: false }); }
  });
  return r;
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
let wired: Server | null = null;
export function registerFarm(io: Server, socket: Socket): void {
  if (wired !== io && farm) { wired = io; farm.onChange = (id) => io.emit('farm_changed', { id }); }
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const on = (ev: string, fn: (b: Record<string, unknown>, f: Farm) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { if (!farm) throw new FarmError('The farm is offline right now.'); const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b, farm)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof FarmError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  const need = () => { const n = nameOf(); if (!n) throw new FarmError('Sign in to farm.'); return n; };
  on('farm_view', async (b, f) => ({ farm: await f.view(b.id, nameOf()) }));
  on('farm_plant', (b, f) => f.plant(need(), b.id, b.crop, b.tiles));
  on('farm_harvest', (b, f) => f.harvest(need(), b.id, b.tiles));
  on('farm_clear', (b, f) => f.clear(need(), b.id));
}

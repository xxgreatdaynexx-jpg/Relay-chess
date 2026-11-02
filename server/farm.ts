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
import { bootAttach, setBootState } from './boot-retry.js';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { getBank, type CasinoBank } from './casino-store.js';
import { px, priceIndex } from './price-index.js';
import { resortPlotOf, isTropical, TROPICAL_CROPS } from '../shared/resort.js';
import { requireResort } from './travel.js';
import { fieldPlotOf } from '../shared/fieldFarms.js';
import { getMines } from './mines.js';
import { awardXp } from './skills.js';
import { CROPS, cropById, farmPayout, farmPlots, stageOf, WITHER_FACTOR, type FarmTile, type FarmView } from '../shared/farm.js';
import { skillLevelAsync } from './skills.js';
import { farmingGrowMul } from '../shared/skillPerks.js';
import { combinedGrowMul, fertilizerProfitMul, greenhouseWither, MAX_UPGRADE_LEVEL, NO_UPGRADES, upgradeDef, upgradePrice, type FarmUpgradeLevels } from '../shared/farmUpgrades.js';

export const FARM_MIGRATION = `
CREATE TABLE IF NOT EXISTS farm_tiles (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, owner_key TEXT NOT NULL, crop TEXT NOT NULL, planted_at BIGINT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY (plot_id, tile));
CREATE TABLE IF NOT EXISTS farm_upgrades (plot_id TEXT NOT NULL, kind TEXT NOT NULL, owner_key TEXT NOT NULL, level INTEGER NOT NULL, PRIMARY KEY (plot_id, kind));
CREATE TABLE IF NOT EXISTS farm_daily (player_key TEXT NOT NULL, day TEXT NOT NULL, gross BIGINT NOT NULL DEFAULT 0, paid BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (player_key, day));
`;
/** Where a harvest/catch goes instead of the market (server/factory-import.ts): written in the same DB transaction. */
export interface ImportSink { write(cl: pg.PoolClient, items: Array<[string, number]>): Promise<void>; after(items: Array<[string, number]>): void }
export class FarmError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
/** City plots `f:<n>` and Chud Resort plantation plots `rf:<n>` (shared/resort.ts) share the farm engine and daily cap. */
const plotOf = (id: unknown): { pid: string; cols: number; rows: number; resort: boolean } | undefined => {
  if (typeof id !== 'string') return undefined;
  if (/^f:\d+$/.test(id)) { const p = farmPlots().find((q) => `f:${q.n}` === id); return p && { pid: id, cols: p.cols, rows: p.rows, resort: false }; }
  const c = fieldPlotOf(id); if (c) return { pid: id as string, cols: c.cols, rows: c.rows, resort: false };
  const r = resortPlotOf(id); return r && { pid: id, cols: r.cols, rows: r.rows, resort: true };
};
interface TileRow { plot_id: string; tile: number; owner_key: string; crop: string; planted_at: string | number; nonce: string }

export class Farm {
  onChange?: (plotId: string) => void;
  private locks = new Map<string, Promise<unknown>>();
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  constructor(private readonly pool: pg.Pool, private readonly bank: () => CasinoBank = getBank, private readonly clock = () => Date.now()) {}
  async init() { await this.pool.query(FARM_MIGRATION); await this.pool.query('CREATE TABLE IF NOT EXISTS kitchen_harvests (tile_key TEXT PRIMARY KEY NOT NULL, at BIGINT NOT NULL)'); }

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
  private toTile(r: TileRow, now: number, wither = WITHER_FACTOR): FarmTile | null {
    const c = cropById(r.crop); if (!c) return null; const at = Number(r.planted_at);
    const readyAt = at + c.grow, witherAt = at + c.grow * (1 + wither);
    return { tile: Number(r.tile), crop: c.id, plantedAt: at, stage: wither === WITHER_FACTOR ? stageOf(c, at, now) : now < readyAt ? 'growing' : now < witherAt ? 'ready' : 'withered', readyAt, witherAt };
  }
  /** Upgrade levels bought by the CURRENT owner (a previous owner's upgrades do not carry over). */
  async upgrades(q: { query: pg.Pool['query'] } | pg.PoolClient, pid: string, ownerKey: string): Promise<FarmUpgradeLevels> {
    const out: FarmUpgradeLevels = { ...NO_UPGRADES };
    for (const row of (await q.query('SELECT kind, level FROM farm_upgrades WHERE plot_id = $1 AND owner_key = $2', [pid, ownerKey])).rows as Array<{ kind: string; level: number }>) {
      if (upgradeDef(row.kind)) out[row.kind as keyof FarmUpgradeLevels] = Math.max(0, Math.min(MAX_UPGRADE_LEVEL, Number(row.level)));
    }
    return out;
  }
  private withers = (u: FarmUpgradeLevels) => greenhouseWither(WITHER_FACTOR, u.greenhouse);

  /** Buy the next level of an upgrade on your plot. Chip sink only: debited via the atomic wallet + ledger ('farm_upgrade')
   *  in the same transaction as the level change, with an optimistic level check so a double-click buys once. */
  async buyUpgrade(name: string, id: unknown, kind: unknown) {
    const p = plotOf(id); if (!p) throw new FarmError('Unknown farm plot.'); const d = upgradeDef(kind); if (!d) throw new FarmError('Unknown upgrade.');
    const pid = p.pid; const key = keyOf(name);
    return this.lock(pid, async () => {
      const o = await this.ownerOf(this.pool, pid); if (!o || o.key !== key) throw new FarmError('You do not own this farm plot.');
      const cur = (await this.upgrades(this.pool, pid, key))[d.id];
      const base = upgradePrice(d.id, cur, p.cols * p.rows); if (base === null) throw new FarmError(`${d.label} is already maxed out.`);
      const cost = px(base); const bank = this.bank(); await bank.refresh(name);
      if (bank.account(name).chips < cost) throw new FarmError(`Not enough chips: ${d.label} level ${cur + 1} costs ${cost.toLocaleString('en-US')}.`);
      await this.atomic(name, -cost, 'farm_upgrade', `Farm ${pid}: ${d.label} level ${cur + 1}`, async (cl) => {
        await this.mustOwn(cl, pid, name);
        const row = (await cl.query('SELECT owner_key, level FROM farm_upgrades WHERE plot_id = $1 AND kind = $2', [pid, d.id])).rows[0] as { owner_key: string; level: number } | undefined;
        const now = row && row.owner_key === key ? Number(row.level) : 0;
        if (now !== cur) throw new FarmError('Already upgraded. Nothing was charged.');
        if (row) { const u = await cl.query('UPDATE farm_upgrades SET owner_key = $3, level = $4 WHERE plot_id = $1 AND kind = $2 AND owner_key = $5 AND level = $6', [pid, d.id, key, cur + 1, row.owner_key, row.level]); if (!u.rowCount) throw new FarmError('Busy, try again.'); }
        else await cl.query('INSERT INTO farm_upgrades (plot_id, kind, owner_key, level) VALUES ($1,$2,$3,$4)', [pid, d.id, key, cur + 1]);
      });
      this.onChange?.(pid);
      return { kind: d.id, level: cur + 1, cost, chips: bank.account(name).chips };
    });
  }

  /** Anyone can look at a farm (visiting neighbours); only the owner can act on it. */
  async view(id: unknown, name: string | null): Promise<FarmView> {
    const p = plotOf(id); if (!p) throw new FarmError('Unknown farm plot.');
    const pid = p.pid; const o = await this.ownerOf(this.pool, pid); const now = this.clock();
    const upgrades = o ? await this.upgrades(this.pool, pid, o.key) : { ...NO_UPGRADES };
    const tiles = o ? (await this.tiles(pid, o.key)).map((r) => this.toTile(r, now, this.withers(upgrades))).filter((t): t is FarmTile => !!t) : [];
    const mine = !!o && !!name && o.key === keyOf(name);
    return { id: pid, owner: o?.name ?? null, mine, cols: p.cols, rows: p.rows, tiles, now, today: mine ? await this.today(o!.key) : { gross: 0, paid: 0 }, index: priceIndex(), upgrades };
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
    if (isTropical(c.id) !== p.resort) throw new FarmError(p.resort ? 'Only tropical crops grow at the resort plantation.' : 'Tropical crops only grow at Chud Resort.');
    const list = this.tileList(p, tiles); const pid = p.pid;
    return this.lock(pid, async () => {
      const cost = px(c.seed) * list.length; const bank = this.bank(); await bank.refresh(name);
      if (bank.account(name).chips < cost) throw new FarmError(`Not enough chips: ${list.length} × ${c.label} seeds cost ${cost.toLocaleString('en-US')}.`);
      const now = this.clock(); const nonce = randomUUID();
      // Farming perk: crops grow up to 25% faster (planted_at is back-dated by the saved share of the grow time).
      // Sprinklers (farm upgrade) stack multiplicatively with it, floored at half the grow time.
      const up = await this.upgrades(this.pool, pid, keyOf(name));
      const plantedAt = now - Math.round(c.grow * (1 - combinedGrowMul(farmingGrowMul(await skillLevelAsync(name, 'farming')), up.sprinkler)));
      await this.atomic(name, -cost, 'farm_seed', `Farm ${pid}: planted ${list.length} ${c.label}`, async (cl) => {
        const o = await this.mustOwn(cl, pid, name);
        await cl.query('DELETE FROM farm_tiles WHERE plot_id = $1 AND owner_key <> $2', [pid, o.key]); // a previous owner's crops
        const busy = (await cl.query('SELECT tile FROM farm_tiles WHERE plot_id = $1', [pid])).rows.map((r) => Number(r.tile));
        if (list.some((t) => busy.includes(t))) throw new FarmError(list.length === 1 ? 'That tile is already planted.' : 'Some of those tiles are already planted.');
        for (const t of list) await cl.query('INSERT INTO farm_tiles (plot_id, tile, owner_key, crop, planted_at, nonce) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (plot_id, tile) DO NOTHING', [pid, t, o.key, c.id, plantedAt, nonce]);
        const r = await cl.query('SELECT tile FROM farm_tiles WHERE plot_id = $1 AND nonce = $2', [pid, nonce]);
        if (r.rows.length !== list.length) throw new FarmError(list.length === 1 ? 'That tile is already planted.' : 'Some of those tiles are already planted.');
      });
      this.onChange?.(pid);
      return { planted: list.length, cost, chips: bank.account(name).chips };
    });
  }

  /** Harvest every ready tile (or the given ones). Exactly once: the tiles are deleted in the payout's transaction. */
  async harvest(name: string, id: unknown, tiles?: unknown, sink?: ImportSink, pantry = false) {
    const p = plotOf(id); if (!p) throw new FarmError('Unknown farm plot.'); const pid = p.pid;
    const only = tiles === undefined || tiles === null ? null : new Set(this.tileList(p, tiles));
    return this.lock(`h:${keyOf(name)}`, () => this.lock(pid, async () => {
      const now = this.clock(); const key = keyOf(name);
      const up = await this.upgrades(this.pool, pid, key);
      const ready = (await this.tiles(pid, key)).filter((r) => (!only || only.has(Number(r.tile))) && this.toTile(r, now, this.withers(up))?.stage === 'ready');
      if (!ready.length) throw new FarmError('Nothing is ready to harvest.');
      if (pantry) return this.harvestToPantry(name, pid, key, ready, now);
      let seeds = 0, profit = 0; const counts = new Map<string, number>();
      for (const r of ready) { const c = cropById(r.crop)!; seeds += c.seed; profit += c.sell - c.seed; counts.set(c.label, (counts.get(c.label) ?? 0) + 1); }
      if (sink) { // pt1252u: send the crops to your Factory storage instead of selling them (no chips, no farm tier)
        const items: Array<[string, number]> = []; for (const r of ready) { const id = `crop_${r.crop}`; const at = items.find((x) => x[0] === id); if (at) at[1]++; else items.push([id, 1]); }
        await this.atomic(name, 0, 'farm_to_factory', '', async (cl) => {
          await this.mustOwn(cl, pid, name);
          let gone = 0;
          for (const r of ready) gone += (await cl.query('DELETE FROM farm_tiles WHERE plot_id = $1 AND tile = $2 AND nonce = $3 AND owner_key = $4', [pid, r.tile, r.nonce, key])).rowCount ?? 0;
          if (gone !== ready.length) throw new FarmError('Already harvested.');
          await sink.write(cl, items);
        });
        sink.after(items); this.onChange?.(pid);
        return { harvested: ready.length, paid: 0, toFactory: items, chips: this.bank().account(name).chips };
      }
      profit = Math.floor(profit * fertilizerProfitMul(up.fertilizer)); // Fertilizer: still inside the daily farm tier below
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

  /** Plots where this player has planted tiles (for "send every ready crop to the factory"). */
  async myPlots(name: string): Promise<string[]> {
    return ((await this.pool.query('SELECT DISTINCT plot_id FROM farm_tiles WHERE owner_key = $1', [keyOf(name)])).rows as Array<{ plot_id: string }>).map((r) => String(r.plot_id));
  }

  /** Harvest into the kitchen pantry instead of selling (pt1312u): no chips, no daily-tier use; Farming XP as usual.
   * Tiles are claimed with a NOT NULL guard row in the SAME transaction as the pantry stacks (Mines' stack table). */
  private async harvestToPantry(name: string, pid: string, key: string, ready: TileRow[], now: number) {
    const counts = new Map<string, number>(); let value = 0;
    for (const r of ready) { const c = cropById(r.crop)!; counts.set(c.id, (counts.get(c.id) ?? 0) + 1); value += c.sell; }
    const extra: Array<{ sql: string; args: unknown[] }> = [];
    for (const r of ready) {
      extra.push({ sql: `INSERT INTO kitchen_harvests (tile_key, at) VALUES ((SELECT t.plot_id || ':' || t.tile || ':' || t.nonce FROM farm_tiles t JOIN properties p ON p.id = t.plot_id AND p.owner_key = $4
        WHERE t.plot_id = $1 AND t.tile = $2 AND t.nonce = $3 AND t.owner_key = $4), $5)`, args: [pid, r.tile, r.nonce, key, now] });
      extra.push({ sql: 'DELETE FROM farm_tiles WHERE plot_id = $1 AND tile = $2 AND nonce = $3', args: [pid, r.tile, r.nonce] });
    }
    const mines = getMines(); let failed: Error | null = null; let done: Promise<unknown> = Promise.resolve(); let rows: Array<{ sql: string; args: unknown[] }> | null = null;
    const deltas = [...counts].map(([id, n]) => ({ type: 'food' as const, id, delta: n }));
    let ok = false;
    try { ok = mines.adjustStacks(name, deltas, extra, (r) => { rows = r; }, { bind: (p) => { done = p; }, onFail: (e) => { failed = e; } }); }
    catch (e) { throw new FarmError((e as Error).message || 'Storage is offline right now.'); }
    if (!ok) throw new FarmError('Could not store that.');
    if (rows) {
      const cl = await this.pool.connect();
      try { await cl.query('BEGIN'); for (const s of rows as Array<{ sql: string; args: unknown[] }>) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
      catch (e) { await cl.query('ROLLBACK').catch(() => {}); mines.adjustStacks(name, deltas.map((d) => ({ ...d, delta: -d.delta }))); failed = e as Error; }
      finally { cl.release(); }
    } else await done;
    if (failed) { console.error('[farm] pantry harvest failed:', (failed as Error).message); throw new FarmError('Already harvested (or storage hiccup). Nothing was lost.'); }
    awardXp(name, 'farming', Math.min(400, 10 + Math.round(value / 5)));
    this.onChange?.(pid);
    return { harvested: ready.length, paid: 0, pantry: Object.fromEntries(counts), toFactory: undefined as Array<[string, number]> | undefined, chips: this.bank().account(name).chips };
  }

  /** Clear withered crops (free). */
  async clear(name: string, id: unknown) {
    const p = plotOf(id); if (!p) throw new FarmError('Unknown farm plot.'); const pid = p.pid; const key = keyOf(name);
    return this.lock(pid, async () => {
      const now = this.clock(); const up = await this.upgrades(this.pool, pid, key); const dead = (await this.tiles(pid, key)).filter((r) => this.toTile(r, now, this.withers(up))?.stage === 'withered');
      if (!dead.length) throw new FarmError('Nothing has withered.');
      for (const r of dead) await this.pool.query('DELETE FROM farm_tiles WHERE plot_id = $1 AND tile = $2 AND nonce = $3', [pid, r.tile, r.nonce]);
      this.onChange?.(pid); return { cleared: dead.length };
    });
  }

  /** Every planted tile on an owned plot (for the map: crops visible from the city view). */
  async mapTiles(): Promise<Array<[string, number, string, Stage]>> {
    const rows = (await this.pool.query('SELECT t.plot_id, t.tile, t.crop, t.planted_at, t.owner_key, p.owner_key AS cur FROM farm_tiles t JOIN properties p ON p.id = t.plot_id')).rows as Array<TileRow & { cur: string }>;
    const now = this.clock(); const gh = new Map((await this.pool.query("SELECT plot_id, owner_key, level FROM farm_upgrades WHERE kind = 'greenhouse'")).rows.map((u: { plot_id: string; owner_key: string; level: number }) => [`${u.plot_id}|${u.owner_key}`, Number(u.level)]));
    return rows.filter((r) => r.owner_key === r.cur).flatMap((r) => { const t = this.toTile(r, now, greenhouseWither(WITHER_FACTOR, gh.get(`${r.plot_id}|${r.owner_key}`) ?? 0)); return t ? [[r.plot_id, t.tile, t.crop, t.stage] as [string, number, string, Stage]] : []; });
  }
}
type Stage = FarmTile['stage'];

let farm: Farm | null = null;
export const getFarm = () => farm;
export async function initFarm(): Promise<void> {
  const url = databaseUrl(); if (!url) { setBootState('farm', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[farm] pool error:', e.message));
  await bootAttach('farm', async () => { try { const f = new Farm(pool); await f.init(); farm = f; console.log('[farm] ready'); return true; } catch (e) { console.error('[farm] init failed:', (e as Error).message); return false; } });
}

/** Public read: crops on every owned plot (for the map) and the seed shop at today's prices. */
export function farmRouter() {
  const r = express.Router();
  r.get('/api/farm', async (_req, res) => {
    const seeds = [...CROPS, ...TROPICAL_CROPS].map((c) => ({ id: c.id, seed: px(c.seed), sell: px(c.sell) }));
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
  // Resort plots can only be worked while you are at Chud Resort.
  const at = async (id: unknown) => { const n = need(); if (typeof id === 'string' && id.startsWith('rf:')) await requireResort(n, FarmError); return n; };
  on('farm_plant', async (b, f) => f.plant(await at(b.id), b.id, b.crop, b.tiles));
  on('farm_harvest', async (b, f) => f.harvest(await at(b.id), b.id, b.tiles, undefined, b.pantry === true));
  on('farm_clear', async (b, f) => f.clear(await at(b.id), b.id));
  on('farm_upgrade', async (b, f) => f.buyUpgrade(await at(b.id), b.id, b.kind));
}

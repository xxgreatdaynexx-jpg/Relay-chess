import { isBarnProperty } from '../shared/barnFarms.js';
import type { BarnFarmOverview } from '../shared/barnFarmStatus.js';
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
import { resortPlotOf, isTropical, TROPICAL_CROPS, RESORT_HARVEST_MUL } from '../shared/resort.js';
import { requireResort } from './travel.js';
import { fieldPlotOf } from '../shared/fieldFarms.js';
import { wineryOf, WINERY_GROW_MUL, WINERY_YIELD_BONUS } from '../shared/mapExpansion.js';
import { HYPER_GROW_MUL } from '../shared/hyperFarm.js';
import { outcome, ledgerMarker, isOutcomeUnknown, getLocStore } from './locstock.js';
import { farmLoc } from '../shared/inventoryLocations.js';
import { emitHaul } from './haulVisual.js';
import { farmHaulSite } from '../shared/haulVisual.js';
import { PANTRY_MAX } from '../shared/cooking.js';
import { awardXp } from './skills.js';
import { getEstate } from './estateProjects.js';
import { isHyperCrop } from '../shared/farm.js';
import { CROPS, cropById, cropSellValue, farmHarvestChips, farmPayout, farmPlots, ripeWindow, stageOf, WITHER_FACTOR, type FarmTile, type FarmView } from '../shared/farm.js';
import { skillLevelAsync } from './skills.js';
import { farmingGrowMul } from '../shared/skillPerks.js';
import { combinedGrowMul, fertilizerYieldBonus, greenhouseWither, MAX_UPGRADE_LEVEL, NO_UPGRADES, upgradeDef, upgradePrice, yieldQty, type FarmUpgradeLevels } from '../shared/farmUpgrades.js';
import { checkFarmAction } from './farmGuard.js';
import { recordPlantSeed } from './plant-cap.js';
import { FARM_TEMPLATE_MAX, normalizeLayout, normalizeTemplateName, stampLayout, type FarmTemplate, type FarmTemplateCell } from '../shared/farmTemplates.js';
import { isHubAwake } from '../shared/hubSleep.js';
import { isMillionairePrelaunch } from '../shared/millionairePrelaunch.js';
import type { FarmAuto } from '../shared/farm.js';
import { cityPolicyMul } from './city-rates.js';
import { eventCredit } from './weeklyEvent.js';
import { ledgerXp } from './skills.js';
import { healStalePropertyDerived } from './propertyDerived.js';

export const FARM_MIGRATION = `
CREATE TABLE IF NOT EXISTS farm_tiles (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, owner_key TEXT NOT NULL, crop TEXT NOT NULL, planted_at BIGINT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY (plot_id, tile));
ALTER TABLE farm_tiles ADD COLUMN IF NOT EXISTS failed BOOLEAN;
CREATE TABLE IF NOT EXISTS farm_upgrades (plot_id TEXT NOT NULL, kind TEXT NOT NULL, owner_key TEXT NOT NULL, level INTEGER NOT NULL, PRIMARY KEY (plot_id, kind));
CREATE TABLE IF NOT EXISTS farm_daily (player_key TEXT NOT NULL, day TEXT NOT NULL, gross BIGINT NOT NULL DEFAULT 0, paid BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (player_key, day));
-- Millionaire Update records kept (not used by the restored farm, never dropped):
CREATE TABLE IF NOT EXISTS farm_soil (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, owner_key TEXT NOT NULL, PRIMARY KEY (plot_id, tile));
CREATE TABLE IF NOT EXISTS farm_fert (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, nonce TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (plot_id, tile, nonce));
CREATE TABLE IF NOT EXISTS farm_machines (owner_key TEXT NOT NULL, kind TEXT NOT NULL, bought_at BIGINT NOT NULL, PRIMARY KEY (owner_key, kind));
ALTER TABLE farm_daily ADD COLUMN IF NOT EXISTS xp_gross BIGINT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS farm_auto (plot_id TEXT NOT NULL, owner_key TEXT NOT NULL, harvest BOOLEAN NOT NULL DEFAULT false, plant BOOLEAN NOT NULL DEFAULT false, crop TEXT NOT NULL DEFAULT 'wheat', PRIMARY KEY (plot_id, owner_key));
ALTER TABLE farm_auto ADD COLUMN IF NOT EXISTS pantry BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS farm_templates (
  owner_key TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  cols INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  cells TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (owner_key, id)
);
`;
/** Server auto-farm sweep for every plot with toggles on — online or offline (Dayne 2026-11-05). */
export const FARM_AUTO_SWEEP_MS = 30 * 60_000; // 30 minutes (Dayne 2026-11-05)
/** Where a harvest/catch goes instead of the market (server/factory-import.ts): written in the same DB transaction. */
export interface ImportSink { write(cl: pg.PoolClient, items: Array<[string, number]>): Promise<void>; after(items: Array<[string, number]>): void }
export class FarmError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
/** City plots `f:<n>` and Chud Resort plantation plots `rf:<n>` (shared/resort.ts) share the farm engine. */
const plotOf = (id: unknown): { pid: string; cols: number; rows: number; resort: boolean } | undefined => {
  if (typeof id !== 'string') return undefined;
  if (/^f:\d+$/.test(id)) { const p = farmPlots().find((q) => `f:${q.n}` === id); return p && { pid: id, cols: p.cols, rows: p.rows, resort: false }; }
  const c = fieldPlotOf(id); if (c) return { pid: id as string, cols: c.cols, rows: c.rows, resort: false };
  const w = wineryOf(id); if (w) return { pid: id as string, cols: w.cols, rows: w.rows, resort: false };
  const r = resortPlotOf(id); return r && { pid: id, cols: r.cols, rows: r.rows, resort: true };
};
interface TileRow { plot_id: string; tile: number; owner_key: string; crop: string; planted_at: string | number; nonce: string; failed?: boolean | null }

export class Farm {
  onChange?: (plotId: string) => void;
  private locks = new Map<string, Promise<unknown>>();
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  constructor(private readonly pool: pg.Pool, private readonly bank: () => CasinoBank = getBank, private readonly clock = () => Date.now()) {}
  async init() { await this.pool.query(FARM_MIGRATION); await this.pool.query('CREATE TABLE IF NOT EXISTS kitchen_harvests (tile_key TEXT PRIMARY KEY NOT NULL, at BIGINT NOT NULL)'); await healStalePropertyDerived(this.pool); }
  private async autoOf(pid: string, ownerKey: string): Promise<FarmAuto> {
    const r = (await this.pool.query('SELECT harvest, plant, crop, pantry FROM farm_auto WHERE plot_id = $1 AND owner_key = $2', [pid, ownerKey])).rows[0] as { harvest: boolean; plant: boolean; crop: string; pantry?: boolean } | undefined;
    return { harvest: r?.harvest === true, pantry: r?.pantry === true, plant: r?.plant === true, crop: r?.crop ?? 'wheat' };
  }

  private async ownerOf(q: { query: pg.Pool['query'] } | pg.PoolClient, id: string): Promise<{ key: string; name: string } | null> {
    const r = await q.query('SELECT owner_key, owner_name FROM properties WHERE id = $1', [id]);
    return r.rows[0] ? { key: String(r.rows[0].owner_key), name: String(r.rows[0].owner_name) } : null;
  }
  /** Tiles of the CURRENT owner only (crops left by a previous owner are gone with the deed). */
  private async tiles(id: string, ownerKey: string): Promise<TileRow[]> {
    const p = plotOf(id); const n = p ? p.cols * p.rows : 0; // tiles indexed past the field (e.g. after a layout change) are ignored: not shown, not harvestable
    return ((await this.pool.query('SELECT * FROM farm_tiles WHERE plot_id = $1 AND owner_key = $2 ORDER BY tile', [id, ownerKey])).rows as TileRow[]).filter((r) => Number(r.tile) >= 0 && Number(r.tile) < n);
  }
  private async today(key: string) {
    const r = await this.pool.query('SELECT gross, paid FROM farm_daily WHERE player_key = $1 AND day = $2', [key, utcDay(this.clock())]);
    return { gross: Number(r.rows[0]?.gross ?? 0), paid: Number(r.rows[0]?.paid ?? 0) };
  }
  private toTile(r: TileRow, now: number, wither = WITHER_FACTOR): FarmTile | null {
    const c = cropById(r.crop); if (!c) return null; const at = Number(r.planted_at);
    const readyAt = at + c.grow, witherAt = readyAt + ripeWindow(c.grow, wither);
    const stage = wither === WITHER_FACTOR ? stageOf(c, at, now) : now < readyAt ? 'growing' : now < witherAt ? 'ready' : 'withered';
    return { tile: Number(r.tile), crop: c.id, plantedAt: at, stage, readyAt, witherAt };
  }
  /** Ready-window tiles. The farm_tiles.failed column is ignored: previously failed plantings harvest normally. */
  private harvestable(r: TileRow, now: number, wither: number): boolean {
    const t = this.toTile(r, now, wither); if (!t) return false;
    return now >= t.readyAt && now < t.witherAt;
  }
  /** Upgrade levels bought by the CURRENT owner (a previous owner's upgrades do not carry over). */
  async upgrades(q: { query: pg.Pool['query'] } | pg.PoolClient, pid: string, ownerKey: string): Promise<FarmUpgradeLevels> {
    const out: FarmUpgradeLevels = { ...NO_UPGRADES };
    for (const row of (await q.query('SELECT kind, level FROM farm_upgrades WHERE plot_id = $1 AND owner_key = $2', [pid, ownerKey])).rows as Array<{ kind: string; level: number }>) {
      if (upgradeDef(row.kind)) out[row.kind as keyof FarmUpgradeLevels] = Math.max(0, Math.min(MAX_UPGRADE_LEVEL, Number(row.level)));
    }
    return out;
  }

  private harvestQty(pid: string, crop: string, fertB: number, seed: string, resortMul: number) {
    let q = yieldQty(fertB, seed) * resortMul;
    if (wineryOf(pid) && crop === 'grapes') q *= (1 + WINERY_YIELD_BONUS);
    return q;
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
    const auto = mine ? await this.autoOf(pid, o!.key) : undefined;
    return { id: pid, owner: o?.name ?? null, mine, cols: p.cols, rows: p.rows, tiles, now, today: mine ? await this.today(o!.key) : { gross: 0, paid: 0 }, index: priceIndex(), upgrades, auto };
  }

  /** Per-plot auto plant/harvest toggles (owner only). Crop is the seed used when auto-plant is on. */
  async setAuto(name: string, id: unknown, patch: { harvest?: unknown; plant?: unknown; crop?: unknown; pantry?: unknown }) {
    const p = plotOf(id); if (!p) throw new FarmError('Unknown farm plot.');
    const cId = patch.crop !== undefined ? String(patch.crop) : undefined;
    if (cId !== undefined) {
      const c = cropById(cId); if (!c) throw new FarmError('Unknown seed.');
      if (isTropical(c.id) !== p.resort) throw new FarmError(p.resort ? 'Only tropical crops grow at the resort plantation.' : 'Tropical crops only grow at Chud Resort.');
    }
    return this.lock(p.pid, async () => {
      const o = await this.ownerOf(this.pool, p.pid); if (!o || o.key !== keyOf(name)) throw new FarmError('You do not own this farm plot.');
      const cur = await this.autoOf(p.pid, o.key);
      let harvest = typeof patch.harvest === 'boolean' ? patch.harvest : cur.harvest;
      let pantry = typeof patch.pantry === 'boolean' ? patch.pantry : cur.pantry;
      // Mutual exclusion: turning on sell-harvest clears pantry destination; pantry-on implies harvest-on.
      if (typeof patch.pantry === 'boolean' && patch.pantry) { harvest = true; pantry = true; }
      if (typeof patch.harvest === 'boolean' && patch.harvest && patch.pantry !== true) { pantry = false; }
      if (!harvest) pantry = false;
      const next: FarmAuto = {
        harvest,
        pantry,
        plant: typeof patch.plant === 'boolean' ? patch.plant : cur.plant,
        crop: cId ?? cur.crop,
      };
      if (!cropById(next.crop)) next.crop = p.resort ? 'pineapple' : 'wheat';
      await this.pool.query(
        `INSERT INTO farm_auto (plot_id, owner_key, harvest, plant, crop, pantry) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (plot_id, owner_key) DO UPDATE SET harvest = EXCLUDED.harvest, plant = EXCLUDED.plant, crop = EXCLUDED.crop, pantry = EXCLUDED.pantry`,
        [p.pid, o.key, next.harvest, next.plant, next.crop, next.pantry],
      );
      this.onChange?.(p.pid);
      return { auto: next };
    });
  }

  private async xpGross(key: string, day: string): Promise<number> {
    return Number((await this.pool.query('SELECT xp_gross FROM farm_daily WHERE player_key = $1 AND day = $2', [key, day])).rows[0]?.xp_gross ?? 0);
  }
  /** Guarded (compare-and-set) so two harvests can't both read the same counter. */
  private async bumpXpGross(cl: { query: (q: string, a?: unknown[]) => Promise<{ rowCount?: number | null }> }, key: string, day: string, profit: number, was: number) {
    await cl.query('INSERT INTO farm_daily (player_key, day, gross, paid) VALUES ($1,$2,0,0) ON CONFLICT (player_key, day) DO NOTHING', [key, day]);
    const u = await cl.query('UPDATE farm_daily SET xp_gross = xp_gross + $3 WHERE player_key = $1 AND day = $2 AND xp_gross = $4', [key, day, Math.round(profit), was]);
    if (!u.rowCount) throw new FarmError('Busy, try again.');
  }
  private async atomic(name: string, amount: number, game: string, memo: string, body: (cl: pg.PoolClient) => Promise<void>, ledgerKey?: string,
    zero?: { committed: () => Promise<boolean>; late: () => void }) {
    if (amount === 0) {
      const cl = await this.pool.connect();
      try { await cl.query('BEGIN'); await body(cl); await cl.query('COMMIT'); return; }
      catch (e) {
        await cl.query('ROLLBACK').catch(() => {});
        if (e instanceof FarmError || !zero) throw e;
        // Lost COMMIT reply: ask the database (tiles gone = it committed) before claiming anything.
        const v = await outcome(zero.committed);
        if (v === true) return;
        if (v === null) {
          void (async () => { for (let i = 0; ; i++) { await new Promise((r) => setTimeout(r, Math.min(60_000, 1000 * 2 ** Math.min(i, 6)))); const x = await outcome(zero.committed, 1); if (x === null) continue; if (x) zero.late(); return; } })();
          throw new FarmError('Still confirming that harvest with the server. Check again in a minute; nothing will be lost or doubled.');
        }
        throw e;
      } finally { cl.release(); }
    }
    const w = this.bank().transferAtomic([{ name, amount, key: ledgerKey ?? `${game}:${randomUUID()}`, game, memo }]);
    const run = async () => {
      await w.after; const cl = await this.pool.connect();
      try { await cl.query('BEGIN'); await body(cl); for (const s of w.stmts) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
      catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) {
      // Lost COMMIT reply: the wallet ledger row exists iff the transaction committed. Never claim "nothing charged" unless
      // the database says so; if it can't be asked, keep the charge in memory and settle in the background.
      const m = e instanceof FarmError ? undefined : ledgerMarker(w.stmts); const pool = this.pool;
      const ask = m ? () => pool.query(m.sql, m.args).then((r) => r.rows.length > 0) : null;
      const v = ask ? await outcome(ask) : false;
      if (v === true) { w.confirm(); return; }
      if (v === null) {
        void (async () => { for (let i = 0; ; i++) { await new Promise((r) => setTimeout(r, Math.min(60_000, 1000 * 2 ** Math.min(i, 6)))); const x = await outcome(ask!, 1); if (x === null) continue; if (x) w.confirm(); else w.revert(); this.onChange?.(''); return; } })();
        throw new FarmError('Still confirming that with the server. Check again in a minute; nothing will be charged twice.');
      }
      w.revert(); if (e instanceof FarmError) throw e; console.error(`[farm] ${game} failed:`, (e as Error).message); throw new FarmError(/chips|balance|null value/i.test((e as Error).message) ? 'Not enough chips.' : 'Something went wrong. Nothing was charged.'); }
  }
  private async mustOwn(cl: pg.PoolClient, pid: string, name: string) {
    const o = await this.ownerOf(cl, pid); if (!o || o.key !== keyOf(name)) throw new FarmError('You do not own this farm plot.'); return o;
  }
  private tileList(p: NonNullable<ReturnType<typeof plotOf>>, tiles: unknown): number[] {
    const n = p.cols * p.rows; const arr = Array.isArray(tiles) ? tiles : [tiles];
    const out = [...new Set(arr.filter((t): t is number => Number.isInteger(t) && (t as number) >= 0 && (t as number) < n))];
    if (!out.length) throw new FarmError('Pick a tile.'); return out;
  }

  /** Private read-only snapshot: the caller owns a separate barn AND every returned field. No client ids accepted. */
  async overview(name: string | null): Promise<BarnFarmOverview> {
    if (!name) throw new FarmError('Sign in to view your farms.');
    const key = keyOf(name); const cl = await this.pool.connect();
    try {
      await cl.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const owned = (await cl.query('SELECT id FROM properties WHERE owner_key = $1 ORDER BY id', [key])).rows as Array<{ id: string }>;
      if (!owned.some((r) => isBarnProperty(r.id))) throw new FarmError('Own a separately purchased barn to view all your farms.');
      const targets = owned.flatMap((r) => { const p = plotOf(r.id); return p ? [p] : []; });
      const ids = targets.map((p) => p.pid);
      // One batch each, not one request/query per field; snapshots never include a different owner's rows.
      const rows = ids.length ? (await cl.query('SELECT * FROM farm_tiles WHERE plot_id = ANY($1) AND owner_key = $2 ORDER BY plot_id, tile', [ids, key])).rows as TileRow[] : [];
      const levels = ids.length ? (await cl.query('SELECT plot_id, kind, level FROM farm_upgrades WHERE plot_id = ANY($1) AND owner_key = $2', [ids, key])).rows as Array<{ plot_id: string; kind: string; level: number }> : [];
      const raw = targets.map((p) => {
        const upgrades: FarmUpgradeLevels = { ...NO_UPGRADES };
        for (const row of levels) if (row.plot_id === p.pid && upgradeDef(row.kind)) upgrades[row.kind as keyof FarmUpgradeLevels] = Math.max(0, Math.min(MAX_UPGRADE_LEVEL, Number(row.level)));
        return { p, upgrades, rows: rows.filter((r) => r.plot_id === p.pid) };
      });
      const now = this.clock();
      const plots = raw.map(({ p, upgrades, rows }) => ({ id: p.pid, cols: p.cols, rows: p.rows,
        tiles: rows.filter((r) => Number(r.tile) >= 0 && Number(r.tile) < p.cols * p.rows)
          .map((r) => this.toTile(r, now, this.withers(upgrades))).filter((t): t is FarmTile => !!t) }));
      await cl.query('COMMIT'); return { now, plots, index: priceIndex() };
    } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; }
    finally { cl.release(); }
  }

  /** Plant `crop` on the given empty tiles; seeds are paid now (px-indexed). */
  async plant(name: string, id: unknown, cropId: unknown, tiles: unknown, opts?: { auto?: boolean; skipGuard?: boolean }) {
    const p = plotOf(id); if (!p) throw new FarmError('Unknown farm plot.'); const c = cropById(cropId); if (!c) throw new FarmError('Unknown seed.');
    if (isHyperCrop(c.id) && !getEstate()?.hyperComplete(name, p.pid)) throw new FarmError('Flowers and other difficult crops need a finished hyper farm glasshouse.');
    if (isTropical(c.id) !== p.resort) throw new FarmError(p.resort ? 'Only tropical crops grow at the resort plantation.' : 'Tropical crops only grow at Chud Resort.');
    const list = this.tileList(p, tiles); const pid = p.pid;
    if (!opts?.skipGuard) { const blocked = checkFarmAction('plant', keyOf(name), this.clock(), opts?.auto ? { auto: true } : undefined); if (blocked) throw new FarmError(blocked); }
    return this.lock(pid, async () => {
      const cost = px(c.seed) * list.length; const bank = this.bank(); await bank.refresh(name);
      if (bank.account(name).chips < cost) throw new FarmError(`Not enough chips: ${list.length} × ${c.label} seeds cost ${cost.toLocaleString('en-US')}.`);
      const now = this.clock(); const nonce = randomUUID();
      // Farming perk: crops grow up to 25% faster (planted_at is back-dated by the saved share of the grow time).
      // Sprinklers (farm upgrade) stack multiplicatively with it, floored at half the grow time.
      const up = await this.upgrades(this.pool, pid, keyOf(name));
      let gmul = combinedGrowMul(farmingGrowMul(await skillLevelAsync(name, 'farming')), up.sprinkler);
      if (wineryOf(pid) && c.id === 'grapes') gmul *= WINERY_GROW_MUL;
      if (getEstate()?.hyperComplete(name, pid)) gmul *= HYPER_GROW_MUL;
      const plantedAt = now - Math.round(c.grow * (1 - Math.min(1, gmul)));
      const seedKey = `farm_seed:${keyOf(name)}:${now}:${nonce}`;
      await this.atomic(name, -cost, 'farm_seed', `Farm ${pid}: planted ${list.length} ${c.label}`, async (cl) => {
        const o = await this.mustOwn(cl, pid, name);
        await cl.query('DELETE FROM farm_tiles WHERE plot_id = $1 AND owner_key <> $2', [pid, o.key]); // a previous owner's crops
        const busy = (await cl.query('SELECT tile FROM farm_tiles WHERE plot_id = $1', [pid])).rows.map((r) => Number(r.tile));
        if (list.some((t) => busy.includes(t))) throw new FarmError(list.length === 1 ? 'That tile is already planted.' : 'Some of those tiles are already planted.');
        for (const t of list) await cl.query('INSERT INTO farm_tiles (plot_id, tile, owner_key, crop, planted_at, nonce) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (plot_id, tile) DO NOTHING', [pid, t, o.key, c.id, plantedAt, nonce]);
        const r = await cl.query('SELECT tile FROM farm_tiles WHERE plot_id = $1 AND nonce = $2', [pid, nonce]);
        if (r.rows.length !== list.length) throw new FarmError(list.length === 1 ? 'That tile is already planted.' : 'Some of those tiles are already planted.');
      }, seedKey);
      recordPlantSeed(name, { game: 'farm_seed', amount: -cost, key: seedKey }, now);
      this.onChange?.(pid);
      return { planted: list.length, cost, chips: bank.account(name).chips };
    });
  }


  private parseTemplateRow(r: { id: string; name: string; cols: number; rows: number; cells: string; updated_at: string | number }): FarmTemplate | null {
    try {
      const layout = normalizeLayout({ cols: Number(r.cols), rows: Number(r.rows), cells: JSON.parse(r.cells) as unknown });
      if (typeof layout === 'string') return null;
      return { id: String(r.id), name: String(r.name), cols: layout.cols, rows: layout.rows, cells: layout.cells, updatedAt: Number(r.updated_at) };
    } catch { return null; }
  }
  async listTemplates(name: string): Promise<{ templates: FarmTemplate[] }> {
    const rows = (await this.pool.query('SELECT id, name, cols, rows, cells, updated_at FROM farm_templates WHERE owner_key = $1 ORDER BY updated_at DESC', [keyOf(name)])).rows as Array<{ id: string; name: string; cols: number; rows: number; cells: string; updated_at: string | number }>;
    return { templates: rows.map((r) => this.parseTemplateRow(r)).filter((t): t is FarmTemplate => !!t) };
  }
  async saveTemplate(name: string, body: { id?: unknown; name?: unknown; cols?: unknown; rows?: unknown; cells?: unknown }) {
    const label = normalizeTemplateName(body.name); if (!label) throw new FarmError('Pick a template name (up to 32 characters).');
    const layout = normalizeLayout(body); if (typeof layout === 'string') throw new FarmError(layout);
    const key = keyOf(name);
    const id = typeof body.id === 'string' && /^[0-9a-f-]{8,64}$/i.test(body.id) ? body.id : randomUUID();
    const now = this.clock();
    const existing = await this.listTemplates(name);
    if (!existing.templates.some((t) => t.id === id) && existing.templates.length >= FARM_TEMPLATE_MAX) {
      throw new FarmError(`You already have ${FARM_TEMPLATE_MAX} farm templates. Delete one first.`);
    }
    await this.pool.query(
      `INSERT INTO farm_templates (owner_key, id, name, cols, rows, cells, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (owner_key, id) DO UPDATE SET name = EXCLUDED.name, cols = EXCLUDED.cols, rows = EXCLUDED.rows, cells = EXCLUDED.cells, updated_at = EXCLUDED.updated_at`,
      [key, id, label, layout.cols, layout.rows, JSON.stringify(layout.cells), now],
    );
    const templates = (await this.listTemplates(name)).templates;
    return { template: templates.find((t) => t.id === id)!, templates };
  }
  async deleteTemplate(name: string, id: unknown) {
    if (typeof id !== 'string' || !id) throw new FarmError('Unknown template.');
    const r = await this.pool.query('DELETE FROM farm_templates WHERE owner_key = $1 AND id = $2', [keyOf(name), id]);
    if (!r.rowCount) throw new FarmError('Unknown template.');
    return this.listTemplates(name);
  }

  /**
   * Plant a mixed-crop layout in one seed charge. Occupied tiles are skipped (and not charged).
   * Seeds are paid the same way as plant() (`farm_seed`), so the house-cap planting bonus applies.
   */
  async plantLayout(name: string, id: unknown, cellsRaw: unknown, opts?: { skipGuard?: boolean }) {
    const p = plotOf(id); if (!p) throw new FarmError('Unknown farm plot.');
    const parsed = normalizeLayout({ cols: p.cols, rows: p.rows, cells: cellsRaw });
    if (typeof parsed === 'string') throw new FarmError(parsed);
    const pid = p.pid;
    const wrong = parsed.cells.find((c) => isTropical(c.crop) !== p.resort);
    if (wrong) throw new FarmError(p.resort ? 'Only tropical crops grow at the resort plantation.' : 'Tropical crops only grow at Chud Resort.');
    if (!opts?.skipGuard) { const blocked = checkFarmAction('plant', keyOf(name), this.clock()); if (blocked) throw new FarmError(blocked); }
    return this.lock(pid, async () => {
      const bank = this.bank(); await bank.refresh(name);
      const now = this.clock(); const nonce = randomUUID();
      const up = await this.upgrades(this.pool, pid, keyOf(name));
      const growMul = combinedGrowMul(farmingGrowMul(await skillLevelAsync(name, 'farming')), up.sprinkler);
      const plantedAtOf = (cropId: string) => { const c = cropById(cropId)!; return now - Math.round(c.grow * (1 - growMul)); };
      // Pre-check cost against current empty tiles so we fail cheaply when the wallet is short; the transaction re-checks.
      const own = await this.ownerOf(this.pool, pid); if (!own || own.key !== keyOf(name)) throw new FarmError('You do not own this farm plot.');
      const busyNow = new Set((await this.tiles(pid, own.key)).map((r) => Number(r.tile)));
      const planned = parsed.cells.filter((c) => !busyNow.has(c.tile));
      if (!planned.length) throw new FarmError('Every tile in that template is already planted.');
      let cost = 0; for (const c of planned) cost += px(cropById(c.crop)!.seed);
      if (bank.account(name).chips < cost) throw new FarmError(`Not enough chips: that layout costs ${cost.toLocaleString('en-US')}.`);
      const seedKey = `farm_seed:${keyOf(name)}:${now}:${nonce}`;
      let planted: FarmTemplateCell[] = [];
      await this.atomic(name, -cost, 'farm_seed', `Farm ${pid}: planted layout (${planned.length} tiles)`, async (cl) => {
        const o = await this.mustOwn(cl, pid, name);
        await cl.query('DELETE FROM farm_tiles WHERE plot_id = $1 AND owner_key <> $2', [pid, o.key]);
        const busy = new Set((await cl.query('SELECT tile FROM farm_tiles WHERE plot_id = $1', [pid])).rows.map((r) => Number(r.tile)));
        planted = parsed.cells.filter((c) => !busy.has(c.tile));
        if (!planted.length) throw new FarmError('Every tile in that template is already planted.');
        let inner = 0; for (const c of planted) inner += px(cropById(c.crop)!.seed);
        if (inner !== cost) throw new FarmError('The field changed while that layout was being planted. Try again.');
        for (const c of planted) await cl.query('INSERT INTO farm_tiles (plot_id, tile, owner_key, crop, planted_at, nonce) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (plot_id, tile) DO NOTHING', [pid, c.tile, o.key, c.crop, plantedAtOf(c.crop), nonce]);
        const r = await cl.query('SELECT tile FROM farm_tiles WHERE plot_id = $1 AND nonce = $2', [pid, nonce]);
        if (r.rows.length !== planted.length) throw new FarmError('Some of those tiles are already planted.');
      }, seedKey);
      recordPlantSeed(name, { game: 'farm_seed', amount: -cost, key: seedKey }, now);
      this.onChange?.(pid);
      return { planted: planted.length, skipped: parsed.cells.length - planted.length, cost, chips: bank.account(name).chips };
    });
  }
  async applyTemplate(name: string, id: unknown, templateId: unknown, originTile: unknown) {
    if (typeof templateId !== 'string' || !templateId) throw new FarmError('Unknown template.');
    const p = plotOf(id); if (!p) throw new FarmError('Unknown farm plot.');
    const row = (await this.pool.query('SELECT id, name, cols, rows, cells, updated_at FROM farm_templates WHERE owner_key = $1 AND id = $2', [keyOf(name), templateId])).rows[0] as { id: string; name: string; cols: number; rows: number; cells: string; updated_at: string | number } | undefined;
    const tmpl = row ? this.parseTemplateRow(row) : null;
    if (!tmpl) throw new FarmError('Unknown template.');
    const origin = Number.isInteger(originTile) ? (originTile as number) : 0;
    const cells = stampLayout(tmpl, p.cols, p.rows, origin);
    if (!cells.length) throw new FarmError('That template does not fit this field.');
    return this.plantLayout(name, id, cells);
  }

  /** Harvest every ready tile (or the given ones). Exactly once: the tiles are deleted in the payout's transaction. */
  async harvest(name: string, id: unknown, tiles?: unknown, sink?: ImportSink, pantry = false, opts?: { auto?: boolean; skipGuard?: boolean }) {
    const p = plotOf(id); if (!p) throw new FarmError('Unknown farm plot.'); const pid = p.pid;
    const only = tiles === undefined || tiles === null ? null : new Set(this.tileList(p, tiles));
    if (!opts?.skipGuard) { const blocked = checkFarmAction('harvest', keyOf(name), this.clock(), opts?.auto ? { auto: true } : undefined); if (blocked) throw new FarmError(blocked); }
    return this.lock(`h:${keyOf(name)}`, () => this.lock(pid, async () => {
      const now = this.clock(); const key = keyOf(name);
      const up = await this.upgrades(this.pool, pid, key);
      const ready = (await this.tiles(pid, key)).filter((r) => (!only || only.has(Number(r.tile))) && this.harvestable(r, now, this.withers(up)));
      if (!ready.length) throw new FarmError('Nothing is ready to harvest.');
      // Map pools: factory is city-only — resort crops must ship. Pantry stays on-map (city → warehouse, resort → Resort Warehouse).
      if (sink && p.resort) throw new FarmError('Resort crops sell here at the plantation. To use them in the city, ship them by boat or plane.');
      const fertB = fertilizerYieldBonus(up.fertilizer);
      if (pantry) return this.harvestToPantry(name, pid, key, ready, now, fertB, !!opts?.auto);
      // pt2093u: Fertilizer boosts crop COUNT (yield), not sell-price/profit. Same % as the old profit buff.
      let seeds = 0, profit = 0, cropUnits = 0; const counts = new Map<string, number>();
      for (const r of ready) {
        const c = cropById(r.crop)!;
        const qty = this.harvestQty(pid, r.crop, fertB, `${r.nonce}:${r.tile}:${r.crop}`, p.resort ? RESORT_HARVEST_MUL : 1);
        seeds += c.seed; profit += qty * cropSellValue(c) - c.seed; cropUnits += qty;
        counts.set(c.label, (counts.get(c.label) ?? 0) + qty);
      }
      profit = Math.floor(profit);
      if (sink) { // pt1252u: send the crops to your Factory storage instead of selling them (no chips, no farm tier)
        const items: Array<[string, number]> = [];
        for (const r of ready) {
          const c = cropById(r.crop)!;
          const qty = this.harvestQty(pid, r.crop, fertB, `${r.nonce}:${r.tile}:${r.crop}`, p.resort ? RESORT_HARVEST_MUL : 1);
          const id = `crop_${c.id}`; const at = items.find((x) => x[0] === id); if (at) at[1] += qty; else items.push([id, qty]);
        }
        const impKey = `import:${randomUUID()}`;
        await this.atomic(name, 0, 'farm_to_factory', '', async (cl) => {
          await this.mustOwn(cl, pid, name);
          let gone = 0;
          for (const r of ready) gone += (await cl.query('DELETE FROM farm_tiles WHERE plot_id = $1 AND tile = $2 AND nonce = $3 AND owner_key = $4', [pid, r.tile, r.nonce, key])).rowCount ?? 0;
          if (gone !== ready.length) throw new FarmError('Already harvested.');
          await sink.write(cl, items);
          await cl.query('INSERT INTO kitchen_harvests (tile_key, at) VALUES ($1, $2)', [impKey, now]); // durable marker: exists iff THIS import committed
        }, undefined, { committed: async () => (await this.pool.query('SELECT 1 FROM kitchen_harvests WHERE tile_key = $1', [impKey])).rows.length > 0,
          late: () => { sink.after(items); this.onChange?.(pid); } });
        sink.after(items); this.onChange?.(pid);
        try { emitHaul({ name, from: farmHaulSite(pid), to: 'factory', kind: 'farm-factory', background: !!opts?.auto }); } catch { /* visual only */ }
        return { harvested: cropUnits, paid: 0, toFactory: items, chips: this.bank().account(name).chips };
      }
      const day = utcDay(now); const t = await this.today(key);
      let seedIndexed = 0;
      for (const r of ready) seedIndexed += px(cropById(r.crop)!.seed);
      const paid = farmHarvestChips(seeds, farmPayout(profit * cityPolicyMul('farming'), t.gross), priceIndex(), seedIndexed); // Farming subsidy policy (City Hall, kept)
      const memo = `Farm ${pid}: harvested ${[...counts].map(([l, n]) => `${n} ${l}`).join(', ') || 'nothing'}`.slice(0, 200);
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
      eventCredit('harvest', name, cropUnits); // weekly server event (kept); count bonus yield crops
      try { emitHaul({ name, from: farmHaulSite(pid), to: sink ? 'factory' : (p.resort ? 'resort' : 'market'), kind: sink ? 'farm-factory' : 'farm-sell', background: !!opts?.auto }); } catch { /* visual only */ }
      return { harvested: cropUnits, paid, chips: this.bank().account(name).chips };
    }));
  }

  /** Map-pool restoration: harvests create no crop stock; sellShipped only settles crop loads already in flight
   *  (committed before the restoration), exactly once by their shipment id. */
  barn: null = null;
  /**
   * A ship-&-sell load of crops reached the Chud City Warehouse: pay it like a harvest (seed back + profit through the
   * price-indexed), ledger 'farm_harvest' keyed by the shipment id (exactly once), with the sale
   * log + delivered shipment rows in the same transaction.
   */
  /** `xp`: 'all' only for legacy in-flight barn loads dispatched before the cutover (their baseline sale XP event);
   *  every other crop already got its XP at harvest. */
  async sellShipped(s: { id: string; ownerName: string; itemId: string; qty: number }, rows: Array<{ sql: string; args: unknown[] }>, from = 'the Resort plantation', xp: 'all' | 'none' = 'none'): Promise<number> {
    const c = cropById(s.itemId); if (!c) throw new FarmError('Unknown crop.');
    const name = s.ownerName; const key = keyOf(name);
    return this.lock(`h:${key}`, async () => {
      const now = this.clock(); const day = utcDay(now); const t = await this.today(key);
      const seeds = c.seed * s.qty; const profit = Math.max(0, (cropSellValue(c) - c.seed) * s.qty);
      const paid = farmHarvestChips(seeds, farmPayout(profit * cityPolicyMul('farming'), t.gross), priceIndex(), px(c.seed) * s.qty); // Farming subsidy policy
      try {
        // XP: only crops from the Resort plantation (tropical) earned sale XP in the baseline (their barn harvest XP + the
        // farm_harvest ledger XP when sold); city crops earned theirs at harvest (above), so their sale gives none.
        const xpQty = xp === 'all' || isTropical(c.id) ? s.qty : 0; const xg = xpQty ? await this.xpGross(key, day) : 0;
        await this.atomic(name, paid, 'farm_sale', `Chud City Warehouse: sold ${s.qty} ${c.label} from ${from}`, async (cl) => {
          await cl.query('INSERT INTO farm_daily (player_key, day, gross, paid) VALUES ($1,$2,0,0) ON CONFLICT (player_key, day) DO NOTHING', [key, day]);
          const u = await cl.query('UPDATE farm_daily SET gross = gross + $3, paid = paid + $4 WHERE player_key = $1 AND day = $2 AND gross = $5', [key, day, Math.round(profit), paid, t.gross]);
          if (!u.rowCount) throw new FarmError('Busy, try again.');
          for (const q of rows) await cl.query(q.sql, q.sql.includes('warehouse_sales') ? q.args.map((v, i) => (i === 8 ? paid : v)) : q.args); // sale log gets the real payout
          if (xpQty) await this.bumpXpGross(cl, key, day, profit, xg); // the baseline daily counter included resort sales
        }, `whsale:${s.id}`);
        const lx = xpQty > 0 ? ledgerXp('farm_harvest', paid) : null; if (lx) awardXp(name, 'farming', lx.xp); // = the old farm_harvest ledger XP, once (ledger key)
      } catch (e) { if ((e as Error).message === 'Already applied.') return 0; throw e; }
      return paid;
    });
  }

  /** Plots where this player has planted tiles (for "send every ready crop to the factory"). */
  async myPlots(name: string): Promise<string[]> {
    return ((await this.pool.query('SELECT DISTINCT t.plot_id FROM farm_tiles t JOIN properties p ON p.id = t.plot_id AND p.owner_key = t.owner_key WHERE t.owner_key = $1', [keyOf(name)])).rows as Array<{ plot_id: string }>).map((r) => String(r.plot_id));
  }

  /** Harvest into the map pantry instead of selling (pt1312u / pt2094u): no chips, no daily-tier use; Farming XP as usual.
   *  Map pools: city plots → warehouse food stacks; resort plantation → Resort Warehouse food (same pool resort kitchens use).
   *  Tile deletes and the stock commit in the SAME transaction: exactly once (a missing tile aborts it all). */
  private async harvestToPantry(name: string, pid: string, key: string, ready: TileRow[], now: number, fertB = 0, background = false) {
    const counts = new Map<string, number>(); let value = 0; let cropUnits = 0;
    for (const r of ready) {
      const c = cropById(r.crop)!;
      const qty = this.harvestQty(pid, r.crop, fertB, `${r.nonce}:${r.tile}:${r.crop}`, pid.startsWith('rf:') ? RESORT_HARVEST_MUL : 1);
      counts.set(c.id, (counts.get(c.id) ?? 0) + qty); value += c.sell * qty; cropUnits += qty;
    }
    const ls = getLocStore(); if (!ls.loaded) throw new FarmError('Storage is reconnecting. Nothing was harvested; try again in a minute.');
    const loc = farmLoc(pid); const deltas = [...counts].map(([id, n]) => ({ loc, item: `food:${id}`, delta: n }));
    for (const d of deltas) if (ls.qty(name, loc, d.item) + d.delta > PANTRY_MAX) throw new FarmError('Your pantry is full for that crop.');
    const extra: Array<{ sql: string; args: unknown[] }> = [];
    for (const r of ready) {
      extra.push({ sql: `INSERT INTO kitchen_harvests (tile_key, at) VALUES ((SELECT t.plot_id || ':' || t.tile::text || ':' || t.nonce FROM farm_tiles t JOIN properties p ON p.id = t.plot_id AND p.owner_key = $4
        WHERE t.plot_id = $1 AND t.tile = $2 AND t.nonce = $3 AND t.owner_key = $4), $5)`, args: [pid, r.tile, r.nonce, key, now] });
      extra.push({ sql: 'DELETE FROM farm_tiles WHERE plot_id = $1 AND tile = $2 AND nonce = $3', args: [pid, r.tile, r.nonce] });
    }
    const first = ready[0]!; const tk = `${pid}:${first.tile}:${first.nonce}`; const pool = this.pool;
    let r: Promise<void> | false;
    try { r = ls.adjust(name, deltas, extra, { pool: this.pool as never, committed: async () => ((await pool.query('SELECT 1 FROM kitchen_harvests WHERE tile_key = $1', [tk])).rows.length > 0) }); }
    catch (e) { throw new FarmError((e as Error).message || 'Storage is offline right now.'); }
    if (r === false) throw new FarmError('Could not store that.');
    try { await r; } catch (e) {
      if (isOutcomeUnknown(e)) throw new FarmError('Storage hiccup: your harvest is being confirmed. Nothing will be lost or doubled.');
      console.error('[farm] pantry harvest failed:', (e as Error).message); throw new FarmError('Already harvested (or storage hiccup). Nothing was lost.');
    }
    awardXp(name, 'farming', Math.min(400, 10 + Math.round(value / 5)));
    this.onChange?.(pid);
    try { emitHaul({ name, from: farmHaulSite(pid), to: farmLoc(pid), kind: 'farm-pantry', background }); } catch { /* visual only */ }
    return { harvested: cropUnits, paid: 0, pantry: Object.fromEntries(counts), toFactory: undefined as Array<[string, number]> | undefined, chips: this.bank().account(name).chips };
  }

  /**
   * Barn dashboard actions: harvest, pantry-harvest, plant empty tiles, clear withered, or harvest-then-replant
   * across the caller's own plots on a single map. Seeds and harvest payouts use the normal per-plot methods.
   * One rate-limit token is spent for the harvest half and one for the plant half (not one per plot).
   */
  async dash(name: string, b: Record<string, unknown>) {
    if (!name) throw new FarmError('Sign in to farm.');
    const action = b.action;
    if (action !== 'harvest' && action !== 'pantry' && action !== 'plant' && action !== 'clear' && action !== 'harvest_replant') {
      throw new FarmError('Unknown farm action.');
    }
    const raw = Array.isArray(b.ids) ? b.ids : [];
    const ids = [...new Set(raw.filter((id): id is string => typeof id === 'string' && !!plotOf(id)))].slice(0, 64);
    if (!ids.length) throw new FarmError('Pick a farm.');
    const maps = new Set(ids.map((id) => (id.startsWith('rf:') ? 'resort' : 'city')));
    if (maps.size > 1) throw new FarmError('Work one map at a time. Travel first to use farms on the other map.');
    const key = keyOf(name);
    const owned = (await this.pool.query('SELECT id FROM properties WHERE owner_key = $1', [key])).rows as Array<{ id: string }>;
    if (!owned.some((r) => isBarnProperty(r.id))) throw new FarmError('Own a separately purchased barn to use the farm dashboard.');
    const mine = new Set(owned.map((r) => r.id));
    for (const id of ids) if (!mine.has(id)) throw new FarmError('You do not own this farm plot.');

    const doHarvest = action === 'harvest' || action === 'pantry' || action === 'harvest_replant';
    const doPlant = action === 'plant' || action === 'harvest_replant';
    const doClear = action === 'clear';
    const pantry = action === 'pantry';
    const now = this.clock();

    if (doPlant) {
      const cropId = typeof b.crop === 'string' ? b.crop : '';
      const c = cropById(cropId); if (!c) throw new FarmError('Pick a seed.');
      const resort = ids[0]!.startsWith('rf:');
      if (isTropical(c.id) !== resort) throw new FarmError(resort ? 'Only tropical crops grow at the resort plantation.' : 'Tropical crops only grow at Chud Resort.');
    }
    if (doHarvest) {
      const blocked = checkFarmAction('harvest', key, now); if (blocked) throw new FarmError(blocked);
    }
    if (doPlant) {
      const blocked = checkFarmAction('plant', key, now); if (blocked) throw new FarmError(blocked);
    }

    if (doPlant) {
      // Pre-check seed cost for every empty tile (and ready tiles that harvest_replant will free) so a mid-batch chip shortage does not plant only some plots.
      const c = cropById(String(b.crop))!;
      let need = 0;
      for (const id of ids) {
        const view = await this.view(id, name);
        const occupied = new Set(view.tiles.map((t) => t.tile));
        let empty = view.cols * view.rows - occupied.size;
        if (action === 'harvest_replant') empty += view.tiles.filter((t) => t.stage === 'ready').length;
        need += empty;
      }
      const cost = px(c.seed) * need;
      const bank = this.bank(); await bank.refresh(name);
      if (need > 0 && bank.account(name).chips < cost) throw new FarmError(`Not enough chips: ${need} × ${c.label} seeds cost ${cost.toLocaleString('en-US')}.`);
    }

    let harvested = 0, paid = 0, planted = 0, cost = 0, cleared = 0;
    const errors: Array<{ id: string; error: string }> = [];
    const skip = { skipGuard: true as const };

    for (const id of ids) {
      if (doHarvest) {
        try {
          const r = await this.harvest(name, id, undefined, undefined, pantry, skip);
          harvested += Number(r.harvested ?? 0); paid += Number(r.paid ?? 0);
        } catch (e) {
          if (e instanceof FarmError && /Nothing is ready/.test(e.message)) { /* ok */ }
          else if (e instanceof FarmError) errors.push({ id, error: e.message });
          else throw e;
        }
      }
      if (doClear) {
        try {
          const r = await this.clear(name, id);
          cleared += Number(r.cleared ?? 0);
        } catch (e) {
          if (e instanceof FarmError && /Nothing has withered/.test(e.message)) { /* ok */ }
          else if (e instanceof FarmError) errors.push({ id, error: e.message });
          else throw e;
        }
      }
      if (doPlant) {
        try {
          const view = await this.view(id, name);
          const occ = new Set(view.tiles.map((t) => t.tile));
          const empties = Array.from({ length: view.cols * view.rows }, (_, i) => i).filter((i) => !occ.has(i));
          if (!empties.length) continue;
          const r = await this.plant(name, id, b.crop, empties, skip);
          planted += Number(r.planted ?? 0); cost += Number(r.cost ?? 0);
        } catch (e) {
          if (e instanceof FarmError) errors.push({ id, error: e.message });
          else throw e;
        }
      }
    }

    if (!harvested && !planted && !cleared && !errors.length) {
      if (doHarvest && !doPlant) throw new FarmError('Nothing is ready to harvest.');
      if (doClear) throw new FarmError('Nothing has withered.');
      if (doPlant && !doHarvest) throw new FarmError('No empty tiles to plant.');
    }
    return { harvested, paid, planted, cost, cleared, errors, chips: this.bank().account(name).chips };
  }

    /** Clear withered crops (free). */
  async clear(name: string, id: unknown) {
    const p = plotOf(id); if (!p) throw new FarmError('Unknown farm plot.'); const pid = p.pid; const key = keyOf(name);
    return this.lock(pid, async () => {
      const now = this.clock(); const up = await this.upgrades(this.pool, pid, key); const dead = (await this.tiles(pid, key)).filter((r) => { const t = this.toTile(r, now, this.withers(up)); return !!t && now >= t.witherAt; });
      if (!dead.length) throw new FarmError('Nothing has withered.');
      for (const r of dead) await this.pool.query('DELETE FROM farm_tiles WHERE plot_id = $1 AND tile = $2 AND nonce = $3', [pid, r.tile, r.nonce]);
      this.onChange?.(pid); return { cleared: dead.length };
    });
  }

  /**
   * One auto-farm pass for every owned plot with Auto-harvest / Auto-plant on (online or offline).
   * Only queries farm_auto rows that are enabled. Respects hub sleep and farmGuard rate limits
   * (clockwork skipped for official auto). Resort plots run offline like city plots (pt2094u); manual
   * rf: actions still require being at the resort via the socket gate.
   */
  async autoSweep(): Promise<number> {
    if (!isHubAwake(this.clock()) || isMillionairePrelaunch(this.clock())) return 0;
    const rows = (await this.pool.query(
      `SELECT a.plot_id, a.owner_key, a.harvest, a.plant, a.crop, a.pantry, p.owner_name
       FROM farm_auto a JOIN properties p ON p.id = a.plot_id AND p.owner_key = a.owner_key
       WHERE a.harvest = true OR a.plant = true`,
    )).rows as Array<{ plot_id: string; owner_key: string; harvest: boolean; plant: boolean; crop: string; pantry: boolean; owner_name: string }>;
    let n = 0;
    for (const r of rows) {
      const name = String(r.owner_name);
      const pid = String(r.plot_id);
      const plot = plotOf(pid); if (!plot) continue;
      try {
        if (r.harvest) {
          // pantry destination: crops stay on the field if that map's pantry is full (FarmError); never sold by surprise.
          const toPantry = r.pantry === true;
          try { await this.harvest(name, pid, undefined, undefined, toPantry, { auto: true }); n++; }
          catch (e) { if (!(e instanceof FarmError)) console.warn('[farm-auto] harvest', pid, (e as Error).message); }
        }
        if (r.plant) {
          try { await this.clear(name, pid); } catch { /* nothing withered */ }
          const busy = new Set((await this.tiles(pid, r.owner_key)).map((t) => Number(t.tile)));
          const empties: number[] = [];
          for (let i = 0; i < plot.cols * plot.rows; i++) if (!busy.has(i)) empties.push(i);
          if (empties.length) {
            try { await this.plant(name, pid, r.crop, empties, { auto: true }); n++; }
            catch (e) { if (!(e instanceof FarmError)) console.warn('[farm-auto] plant', pid, (e as Error).message); }
          }
        }
      } catch (e) { console.warn('[farm-auto]', pid, (e as Error).message); }
    }
    return n;
  }

  /** Every planted tile on an owned plot (for the map: crops visible from the city view). */
  async mapTiles(): Promise<Array<[string, number, string, Stage]>> {
    const rows = (await this.pool.query('SELECT t.plot_id, t.tile, t.crop, t.planted_at, t.owner_key, p.owner_key AS cur FROM farm_tiles t JOIN properties p ON p.id = t.plot_id')).rows as Array<TileRow & { cur: string }>;
    const now = this.clock(); const gh = new Map((await this.pool.query("SELECT plot_id, owner_key, level FROM farm_upgrades WHERE kind = 'greenhouse'")).rows.map((u: { plot_id: string; owner_key: string; level: number }) => [`${u.plot_id}|${u.owner_key}`, Number(u.level)]));
    return rows.filter((r) => { if (r.owner_key !== r.cur) return false; const p = plotOf(r.plot_id); return !!p && Number(r.tile) >= 0 && Number(r.tile) < p.cols * p.rows; }).flatMap((r) => { const t = this.toTile(r, now, greenhouseWither(WITHER_FACTOR, gh.get(`${r.plot_id}|${r.owner_key}`) ?? 0)); return t ? [[r.plot_id, t.tile, t.crop, t.stage] as [string, number, string, Stage]] : []; });
  }
}
type Stage = FarmTile['stage'];

let farm: Farm | null = null;
export const getFarm = () => farm;

let autoTimer: ReturnType<typeof setInterval> | null = null;
function startFarmAutoSweep() {
  if (autoTimer) return;
  const run = () => { void farm?.autoSweep().catch((e) => console.error('[farm-auto] sweep failed:', (e as Error).message)); };
  setTimeout(run, 15_000).unref?.();
  autoTimer = setInterval(run, FARM_AUTO_SWEEP_MS);
  autoTimer.unref?.();
}

export async function initFarm(): Promise<void> {
  const url = databaseUrl(); if (!url) { setBootState('farm', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[farm] pool error:', e.message));
  await bootAttach('farm', async () => { try { const f = new Farm(pool); await f.init(); farm = f; startFarmAutoSweep(); console.log('[farm] ready'); return true; } catch (e) { console.error('[farm] init failed:', (e as Error).message); return false; } });
}

/** Public read: crops on every owned plot (for the map) and the seed shop at today's prices. */
export function farmRouter() {
  const r = express.Router();
  r.get('/api/farm', async (_req, res) => {
    const seeds = [...CROPS, ...TROPICAL_CROPS].map((c) => ({ id: c.id, seed: px(c.seed), sell: px(cropSellValue(c)) }));
    if (!farm) { res.json({ ok: true, live: false, tiles: [], seeds }); return; }
    try { res.json({ ok: true, live: true, tiles: await farm.mapTiles(), seeds }); } catch { res.status(500).json({ ok: false }); }
  });
  return r;
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
let wired: Server | null = null;

export function registerFarm(io: Server, socket: Socket): void {
  if (wired !== io && farm) {
    wired = io;
    farm.onChange = (id) => io.emit('farm_changed', { id });
    startFarmAutoSweep();
  }
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const on = (ev: string, fn: (b: Record<string, unknown>, f: Farm) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { if (!farm) throw new FarmError('The farm is offline right now.'); const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b, farm)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof FarmError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  const need = () => { const n = nameOf(); if (!n) throw new FarmError('Sign in to farm.'); return n; };
  on('farm_view', async (b, f) => ({ farm: await f.view(b.id, nameOf()) }));
  on('farm_overview', async (_b, f) => ({ overview: await f.overview(need()) }));
  // Resort plots can only be worked while you are at Chud Resort.
  const at = async (id: unknown) => { const n = need(); if (typeof id === 'string' && id.startsWith('rf:')) await requireResort(n, FarmError); return n; };
  on('farm_plant', async (b, f) => f.plant(await at(b.id), b.id, b.crop, b.tiles));
  on('farm_harvest', async (b, f) => f.harvest(await at(b.id), b.id, b.tiles, undefined, b.pantry === true));
  on('farm_clear', async (b, f) => f.clear(await at(b.id), b.id));
  on('farm_upgrade', async (b, f) => f.buyUpgrade(await at(b.id), b.id, b.kind));
  on('farm_auto', async (b, f) => f.setAuto(await at(b.id), b.id, { harvest: b.harvest, plant: b.plant, crop: b.crop, pantry: b.pantry }));
  on('farm_dash', async (b, f) => {
    const ids = Array.isArray(b.ids) ? b.ids : [];
    if (ids.some((id) => typeof id === 'string' && id.startsWith('rf:'))) await requireResort(need(), FarmError);
    return f.dash(need(), b);
  });
  on('farm_templates', async (_b, f) => f.listTemplates(need()));
  on('farm_template_save', async (b, f) => f.saveTemplate(need(), b));
  on('farm_template_delete', async (b, f) => f.deleteTemplate(need(), b.id));
  on('farm_plant_layout', async (b, f) => f.plantLayout(await at(b.plot ?? b.id), b.plot ?? b.id, b.cells));
  on('farm_template_apply', async (b, f) => f.applyTemplate(await at(b.plot ?? b.id), b.plot ?? b.id, b.templateId ?? b.template, b.origin));
}


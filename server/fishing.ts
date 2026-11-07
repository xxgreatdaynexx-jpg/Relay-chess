/**
 * Fishing at the lake dock (rules in shared/fishing.ts). The server rolls every catch when you cast (crypto RNG),
 * keeps it secret until it is landed, and replays the reel minigame from the client's input timeline with the same
 * seed: only a timeline that lands the fish on its last step, in plausible wall time, puts it in your cooler.
 * Catches live in fish_catches (Postgres); selling claims the rows (UPDATE ... sold_at IS NULL must hit every id) and
 * credits chips through the atomic wallet (ledger game 'fish_sell') in the SAME transaction, after the daily-tier row
 * is advanced with an optimistic check, so a fish sells exactly once and the daily cap holds across instances.
 * Every landed catch is announced on the skill-activity bus (server/activity.ts) for the Fishing skill.
 */
import { royaltyEarn } from './royalty.js';
import { randomInt, randomUUID } from 'node:crypto';
import { parseSellQty, pickForQty } from '../shared/sellQty.js';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { getBank, PgCasinoStore, type CasinoBank } from './casino-store.js';
import { px, priceIndex } from './price-index.js';
import { emitActivity } from './activity.js';
import { awardXp, skillLevelAsync } from './skills.js';
import { isQaName } from '../shared/qa.js';
import type { ImportSink } from './farm.js';
import { fishingLuckRoll, fishingBiteMul } from '../shared/skillPerks.js';
import {
  BITE_MAX_MS, BITE_MIN_MS, CAST_COOLDOWN_MS, fishSellValue, fishDailyKey, spotOf, COOLER_MAX, FISH, FISH_XP, fishById, fishDiff, fishPayout, fishValue, HOOK_WINDOW_MS,
  REEL_DT, replayReel, rollFish, rollWeight, anglerAim, type AnglerState, type FishCatch, type FishView,
} from '../shared/fishing.js';
import { cookPayout, cookSellValue } from '../shared/cooking.js';
import { isFishSpot, type FishSpot } from '../shared/fishing.js';
import { fishingLoc, WAREHOUSE, FACTORY, isPool } from '../shared/inventoryLocations.js';
import { FLEET_MAX_CUT } from '../shared/coop3.js';
import { isAtResort, awayFromMarket } from './travel.js';
import { baitLuckRoll, gearDef } from '../shared/fishGear.js';
import { eventCredit, eventTrade } from './weeklyEvent.js';

/** Equipped bait + fly per account (server/fishGear.ts installs the real lookup once Postgres is attached). */
let gearHook: (name: string) => { bait: string; fly: string } = () => ({ bait: 'worm', fly: 'no_fly' });
/** Deep sea (#10c): the player's best boat (server/fleet.ts sets this). zone 0 = no boat. */
var boatHook: (name: string) => Promise<{ zone: number; biteMul: number; name: string | null }> = async () => ({ zone: 0, biteMul: 1, name: null });
export function setFishBoatHook(f: typeof boatHook) { boatHook = f; }
/** mu-coop3 fishing fleets (server/fishFleet.ts): the fleet trip this player is on, if any. captain = who earns the cut (null for the captain themself). */
export type CrewInfo = { tripId: string; captain: string | null; cut: number; zone: number; biteMul: number; crewed: boolean };
var crewHook: (name: string) => CrewInfo | null = () => null;
export function setFishCrewHook(f: typeof crewHook | null) { crewHook = f ?? (() => null); } // hoisted: server/fleet.ts calls it during a circular import
/** mu-coop3: the fleet trip log (catches + captain's cuts), set by server/fishFleet.ts. Called only after the write commits. */
export type FleetNote = { trip?: string; captain?: string; name: string; kind: 'catch' | 'cut'; fish?: string; grams?: number; chips?: number };
var fleetNote: (e: FleetNote) => void = () => {};
export function setFishFleetNote(f: typeof fleetNote | null) { fleetNote = f ?? (() => {}); }
export const setFishGearHook = (f: typeof gearHook) => { gearHook = f; };

export const FISH_MIGRATION = `
CREATE TABLE IF NOT EXISTS fish_catches (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, species TEXT NOT NULL, weight_g INTEGER NOT NULL, value INTEGER NOT NULL, caught_at BIGINT NOT NULL, sold_at BIGINT);
CREATE INDEX IF NOT EXISTS fish_catches_player ON fish_catches (player_key, sold_at);
ALTER TABLE fish_catches ADD COLUMN IF NOT EXISTS dish TEXT;
ALTER TABLE fish_catches ADD COLUMN IF NOT EXISTS raw_value INTEGER;
ALTER TABLE fish_catches ADD COLUMN IF NOT EXISTS hired BOOLEAN;
ALTER TABLE fish_catches ADD COLUMN IF NOT EXISTS crew_trip TEXT;
ALTER TABLE fish_catches ADD COLUMN IF NOT EXISTS captain TEXT;
ALTER TABLE fish_catches ADD COLUMN IF NOT EXISTS cut REAL;
ALTER TABLE fish_catches ADD COLUMN IF NOT EXISTS loc TEXT;
CREATE INDEX IF NOT EXISTS fish_catches_loc ON fish_catches (player_key, loc) WHERE sold_at IS NULL;
CREATE TABLE IF NOT EXISTS kitchen_daily (player_key TEXT NOT NULL, day TEXT NOT NULL, gross BIGINT NOT NULL DEFAULT 0, paid BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (player_key, day));
CREATE TABLE IF NOT EXISTS fish_daily (player_key TEXT NOT NULL, day TEXT NOT NULL, gross BIGINT NOT NULL DEFAULT 0, paid BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (player_key, day));
`;
/** Factory units for one cooler fish (base value): raw -> fillets (8 each), cooked -> portions (10 each). */
export const fishImportQty = (value: number, cooked: boolean) => Math.floor(value / (cooked ? 10 : 8));
export class FishError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
interface Cast { castAt: number; biteAt: number; fish: string; grams: number; seed: number; hookedAt: number | null; diffAdd: number; spot?: FishSpot; crew?: { trip: string; captain: string | null; cut: number } | null }
interface Row { id: string; species: string; weight_g: number | string; value: number | string; caught_at: number | string }
export interface FishRng { int(lo: number, hi: number): number; unit(): number }
const cryptoRng: FishRng = { int: (lo, hi) => randomInt(lo, hi), unit: () => randomInt(0, 2 ** 32) / 2 ** 32 };

export class Fishing {
  private casts = new Map<string, Cast>();
  private lastCast = new Map<string, number>();
  private locks = new Map<string, Promise<unknown>>();
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  constructor(readonly pool: pg.Pool, private readonly bank: () => CasinoBank = getBank, private readonly clock = () => Date.now(), private readonly rng: FishRng = cryptoRng) {}
  async init() { await this.pool.query(FISH_MIGRATION); }

  private async cooler(key: string): Promise<FishCatch[]> {
    const r = await this.pool.query('SELECT id, species, weight_g, value, caught_at, loc FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL ORDER BY caught_at DESC', [key]);
    return (r.rows as Row[]).map((x) => ({ id: x.id, fish: x.species, grams: Number(x.weight_g), value: Number(x.value), at: Number(x.caught_at), loc: (x as { loc?: string | null }).loc ?? null }));
  }
  private async dishIds(key: string): Promise<Set<string>> {
    const r = await this.pool.query('SELECT id FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL AND dish IS NOT NULL', [key]);
    return new Set((r.rows as Array<{ id: string }>).map((x) => String(x.id)));
  }
  private async kitchenToday(key: string) {
    const r = await this.pool.query('SELECT gross, paid FROM kitchen_daily WHERE player_key = $1 AND day = $2', [key, utcDay(this.clock())]).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
    return { gross: Number(r.rows[0]?.gross ?? 0), paid: Number(r.rows[0]?.paid ?? 0) };
  }
  private async today(key: string, spot: FishSpot = 'lake') {
    const r = await this.pool.query('SELECT gross, paid FROM fish_daily WHERE player_key = $1 AND day = $2', [fishDailyKey(key, spot), utcDay(this.clock())]);
    return { gross: Number(r.rows[0]?.gross ?? 0), paid: Number(r.rows[0]?.paid ?? 0) };
  }
  async view(name: string): Promise<FishView> {
    const key = keyOf(name);
    const best = (await this.pool.query("SELECT species, weight_g FROM fish_catches WHERE player_key = $1 AND COALESCE(hired, FALSE) = FALSE ORDER BY weight_g DESC, caught_at ASC, id ASC LIMIT 1", [key])).rows[0];
    const n = (await this.pool.query('SELECT count(*) AS n FROM fish_catches WHERE player_key = $1', [key])).rows[0];
    return { cooler: await this.cooler(key), today: await this.today(key), todayBySpot: { lake: await this.today(key, 'lake'), reef: await this.today(key, 'reef'), deep: await this.today(key, 'deep') }, index: priceIndex(), best: best ? { fish: String(best.species), grams: Number(best.weight_g) } : null, totals: { caught: Number(n?.n ?? 0) } };
  }

  /** Throw a line. The fish (and when it bites) is decided now and stays server-side. */
  async cast(name: string, spotIn: unknown = 'lake', atResort: (n: string) => boolean = isAtResort): Promise<{ biteIn: number }> {
    const key = keyOf(name); const now = this.clock();
    const spot: FishSpot = isFishSpot(spotIn) ? spotIn : 'lake';
    if (spot === 'reef' && !atResort(name)) throw new FishError('The Reef Pier is at Chud Resort. Fly there first.');
    if (spot === 'deep' && !atResort(name)) throw new FishError('Deep-sea trips leave from the Chud Resort Marina. Fly there first.');
    const crew = spot === 'deep' ? crewHook(name) : null; // on a fleet trip you fish from the captain's boat
    const boat = crew ? { zone: crew.zone, biteMul: crew.biteMul } : spot === 'deep' ? await boatHook(name) : { zone: 3, biteMul: 1 };
    if (spot === 'deep' && boat.zone < 1) throw new FishError('You need a boat for deep-sea fishing. Buy one at the Resort Marina.');
    if (now - (this.lastCast.get(key) ?? -Infinity) < CAST_COOLDOWN_MS) throw new FishError('Easy — let the line settle first.');
    const n = Number((await this.pool.query('SELECT count(*) AS n FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL', [key])).rows[0]?.n ?? 0);
    if (n >= COOLER_MAX) throw new FishError(`Your cooler is full (${COOLER_MAX}). Sell or release some fish first.`);
    this.lastCast.set(key, now);
    const lvl = await skillLevelAsync(name, 'fishing'); // Fishing perk: a little rare-fish luck and quicker bites
    const gear = gearHook(name); const fly = gearDef(gear.fly); // Fishing upgrades (#28): bait luck + fly speed/fight
    const u = this.rng.unit(); const f = rollFish(baitLuckRoll(u, fishingLuckRoll(u, lvl), gear.bait), this.rng.unit(), spot, boat.zone, !!crew?.crewed); const grams = rollWeight(f, this.rng.unit());
    const biteIn = Math.max(BITE_MIN_MS * (fly?.biteMul ?? 1) * boat.biteMul, Math.round(this.rng.int(BITE_MIN_MS, BITE_MAX_MS + 1) * fishingBiteMul(lvl) * (fly?.biteMul ?? 1) * boat.biteMul));
    this.casts.set(key, { castAt: now, biteAt: now + biteIn, fish: f.id, grams, seed: this.rng.int(1, 2 ** 31), hookedAt: null, diffAdd: fly?.diffAdd ?? 0, spot, crew: crew ? { trip: crew.tripId, captain: crew.captain, cut: crew.cut } : null });
    return { biteIn };
  }
  /** Strike when it bites: too early spooks it, too late it is gone. Returns the reel game's seed + difficulty. */
  hook(name: string): { seed: number; diff: number } {
    const key = keyOf(name); const c = this.casts.get(key); const now = this.clock();
    if (!c || c.hookedAt !== null) throw new FishError('Cast your line first.');
    if (now < c.biteAt - 200) { this.casts.delete(key); throw new FishError('Too early — you spooked it.'); }
    if (now > c.biteAt + HOOK_WINDOW_MS) { this.casts.delete(key); throw new FishError('Too slow — it stole your bait.'); }
    c.hookedAt = now; return { seed: c.seed, diff: Math.min(1, fishDiff(fishById(c.fish)!, c.grams) + c.diffAdd) };
  }
  /** Land (or lose) the fish: the server replays the reel timeline. */
  async land(name: string, inputs: unknown): Promise<{ caught: boolean; fish?: FishCatch; xp?: number }> {
    const key = keyOf(name); const c = this.casts.get(key); const now = this.clock();
    if (!c || c.hookedAt === null) throw new FishError('Nothing on the line.');
    this.casts.delete(key);
    const f = fishById(c.fish)!; const res = replayReel(c.seed, Math.min(1, fishDiff(f, c.grams) + c.diffAdd), inputs as string);
    if (res === 'invalid') throw new FishError('The line snapped.');
    const steps = (inputs as string).length;
    if (now - c.hookedAt < steps * REEL_DT * 1000 - 600) throw new FishError('The line snapped.'); // faster than real time
    if (res === 'lost') return { caught: false };
    return this.lock(`c:${key}`, async () => {
      const n = Number((await this.pool.query('SELECT count(*) AS n FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL', [key])).rows[0]?.n ?? 0);
      if (n >= COOLER_MAX) throw new FishError('Your cooler is full.');
      const fish: FishCatch = { id: randomUUID(), fish: f.id, grams: c.grams, value: fishValue(f, c.grams), at: now };
      // Truck logistics: a catch stays AT its fishing spot until it is shipped (sold only at the Chud City Warehouse).
      await this.pool.query('INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at, crew_trip, captain, cut, loc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [fish.id, key, name, f.id, fish.grams, fish.value, now, c.crew?.trip ?? null, c.crew?.captain ?? null, c.crew?.captain ? c.crew.cut : null, fishingLoc(c.spot ?? 'lake')]);
      const xp = FISH_XP[f.rarity];
      awardXp(name, 'fishing', xp);
      eventCredit('fishing', name, 1, fish.id);
      if (c.crew) { try { fleetNote({ trip: c.crew.trip, name, kind: 'catch', fish: f.id, grams: fish.grams }); } catch { /* log only */ } }
      emitActivity({ name, skill: 'fishing', xp, action: 'catch', detail: { fish: f.id, rarity: f.rarity, grams: fish.grams, value: fish.value }, at: now });
      return { caught: true, fish, xp };
    });
  }
  /** Give up on the current cast (no penalty). */
  reelIn(name: string) { this.casts.delete(keyOf(name)); }

  /** Sell from the cooler (all, or the given ids) for chips: daily tiers on base value, then the price index. */
  async sell(name: string, ids?: unknown, qtyIn?: unknown): Promise<{ sold: number; gross: number; paid: number; chips: number; captainCut?: number }> {
    const key = keyOf(name);
    return this.lock(`c:${key}`, async () => {
      const all = await this.cooler(key);
      let rows = all.filter((r) => !!r.loc && isPool(r.loc)); // map pools: either map's warehouse sells
      if (Array.isArray(ids)) { const want = new Set(ids.filter((x): x is string => typeof x === 'string').slice(0, COOLER_MAX)); rows = rows.filter((r) => want.has(r.id)); }
      if (!rows.length) throw new FishError(all.length ? 'Move those fish from your factory to a map warehouse to sell them.' : 'Nothing to sell.');
      if (qtyIn !== undefined && qtyIn !== null) { const v = parseSellQty(qtyIn, rows.length); if (!v.ok) throw new FishError(v.error); rows = pickForQty(rows, v.qty); }
      const day = utcDay(this.clock());
      // Pan-fried dishes (fishPan) count toward the ONE daily cooking-sales cap (kitchen_daily, shared with recipe
      // dishes), not the raw-fish tiers. If that cap is used up, dishes stay in the cooler instead of selling for 0.
      const dishIds = await this.dishIds(key); const k = await this.kitchenToday(key);
      let dishRows = rows.filter((r) => dishIds.has(r.id)); const rawRows = rows.filter((r) => !dishIds.has(r.id));
      let dGross = cookSellValue(dishRows.reduce((a, r) => a + r.value, 0)); /* +50% cooking buff (pan-fried dishes) */ let dPaid = Math.floor(cookPayout(dGross, k.gross) * priceIndex());
      if (dPaid <= 0 && dishRows.length) { dishRows = []; dGross = 0; dPaid = 0; }
      rows = [...rawRows, ...dishRows];
      // mu-fishing: each spot (lake / reef / deep) has its own daily cap, tracked in its own fish_daily row.
      const spotOfRow = (r: FishCatch): FishSpot => { const f = fishById(r.fish); return f ? spotOf(f) : 'lake'; };
      const bySpot: Array<{ spot: FishSpot; gross: number; t: { gross: number; paid: number }; paid: number }> = [];
      for (const sp of ['lake', 'reef', 'deep'] as FishSpot[]) {
        const g = Math.floor(fishSellValue(rawRows.filter((r) => spotOfRow(r) === sp).reduce((a, r) => a + r.value, 0))); if (!g) continue; // +15% fishing buff
        const t = await this.today(key, sp); bySpot.push({ spot: sp, gross: g, t, paid: Math.floor(fishPayout(g, t.gross, sp) * priceIndex()) });
      }
      // Fish from a spot whose cap is used up stay in the cooler instead of selling for 0.
      const live = bySpot.filter((b) => b.paid > 0); const liveSpots = new Set(live.map((b) => b.spot));
      rows = rows.filter((r) => dishIds.has(r.id) || liveSpots.has(spotOfRow(r)));
      const gross = live.reduce((a, b) => a + b.gross, 0);
      const fPaid = live.reduce((a, b) => a + b.paid, 0); const paid = fPaid + dPaid;
      if (paid <= 0 || !rows.length) throw new FishError(rawRows.length && !live.length ? "The fishmonger has bought all they can from you today. Come back after 00:00 UTC (or release your catch)." : 'You have hit today\'s cooking sales cap (shared by every dish you cook). Come back after 00:00 UTC (6 PM CST).');
      const counts = new Map<string, number>(); for (const r of rows) counts.set(fishById(r.fish)?.label ?? r.fish, (counts.get(fishById(r.fish)?.label ?? r.fish) ?? 0) + 1);
      const memo = `Fish market: sold ${[...counts].map(([l, n]) => `${n} ${l}`).join(', ')}`.slice(0, 200);
      const body = async (cl: pg.PoolClient) => {
        const ph = rows.map((_, i) => `$${i + 3}`).join(',');
        const u = await cl.query(`UPDATE fish_catches SET sold_at = $1 WHERE player_key = $2 AND sold_at IS NULL AND loc = 'warehouse' AND id IN (${ph})`, [this.clock(), key, ...rows.map((r) => r.id)]);
        if (u.rowCount !== rows.length) throw new FishError('Already sold.');
        for (const b of live) {
          const dk = fishDailyKey(key, b.spot);
          if (b.t.gross === 0 && b.t.paid === 0) await cl.query('INSERT INTO fish_daily (player_key, day, gross, paid) VALUES ($1,$2,0,0) ON CONFLICT (player_key, day) DO NOTHING', [dk, day]);
          const d = await cl.query('UPDATE fish_daily SET gross = gross + $3, paid = paid + $4 WHERE player_key = $1 AND day = $2 AND gross = $5', [dk, day, b.gross, b.paid, b.t.gross]);
          if (d.rowCount !== 1) throw new FishError('Busy — try again.');
        }
        if (dishRows.length) {
          await cl.query('INSERT INTO kitchen_daily (player_key, day, gross, paid) VALUES ($1,$2,0,0) ON CONFLICT (player_key, day) DO NOTHING', [key, day]);
          const kd = await cl.query('UPDATE kitchen_daily SET gross = gross + $3, paid = paid + $4 WHERE player_key = $1 AND day = $2 AND gross = $5', [key, day, dGross, dPaid, k.gross]);
          if (kd.rowCount !== 1) throw new FishError('Busy — try again.');
        }
      };
      // mu-coop3: fleet catches pay the captain their cut, pro rata from the deep-sea payout (the seller's deep cap is what limits it).
      const cuts = new Map<string, number>(); const deep = live.find((b) => b.spot === 'deep');
      if (deep && deep.gross > 0) {
        const want = new Set(rows.map((r) => r.id)); const capt = (await this.pool.query('SELECT id, captain, cut, value FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL AND captain IS NOT NULL', [key])).rows as Array<{ id: string; captain: string; cut: number; value: number }>;
        for (const r of capt) { if (!want.has(r.id)) continue; const share = fishSellValue(Number(r.value)) * (deep.paid / deep.gross) * Math.min(FLEET_MAX_CUT, Math.max(0, Number(r.cut) || 0)); cuts.set(r.captain, (cuts.get(r.captain) ?? 0) + share); }
        for (const [k, v] of cuts) { const f = Math.floor(v); if (f > 0 && keyOf(k) !== key) cuts.set(k, f); else cuts.delete(k); }
      }
      const cutTotal = [...cuts.values()].reduce((a, b) => a + b, 0); const sid = randomUUID();
      const w = this.bank().transferAtomic([{ name, amount: paid - cutTotal, key: `fish_sell:${sid}`, game: 'fish_sell', memo: cutTotal ? `${memo} (less 🪙 ${cutTotal.toLocaleString('en-US')} captain's cut)`.slice(0, 200) : memo },
        ...[...cuts].map(([cap, amt]) => ({ name: cap, amount: amt, key: `fish_cut:${sid}:${keyOf(cap)}`, game: 'fish_fleet', memo: `🛥️ Captain's cut from ${name}'s fleet catch` }))]);
      const run = async () => {
        await w.after; const cl = await this.pool.connect();
        try { await cl.query('BEGIN'); await body(cl); for (const s of w.stmts) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
        catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
      };
      const p = run(); w.bind(p);
      try { await p; } catch (e) { w.revert(); if (e instanceof FishError) throw e; console.error('[fishing] sell failed:', (e as Error).message); throw new FishError('Something went wrong. Nothing was sold.'); }
      royaltyEarn('dock', name, paid);
      for (const [cap, amt] of cuts) { try { fleetNote({ captain: cap, name, kind: 'cut', chips: amt }); } catch { /* log only */ } }
      return { sold: rows.length, gross: gross + dGross, paid: paid - cutTotal, chips: this.bank().account(name).chips, ...(cutTotal ? { captainCut: cutTotal } : {}) };
    });
  }
  /** pt1252u: move fish from the cooler into Factory storage. Raw fish -> fillets (1 per 8 base value), cooked dishes ->
   * portions (1 per 10). Junk can't go. One UPDATE (still yours, unsold) + the storage write in the same transaction. */
  async toFactory(name: string, ids: unknown, sink: ImportSink): Promise<{ moved: number; items: Array<[string, number]> }> {
    const key = keyOf(name);
    return this.lock(`c:${key}`, async () => {
      const all = (await this.pool.query("SELECT id, species, value, dish FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL AND loc IN ('factory', 'warehouse')", [key]) /* map pools: any city-map fish, no hauling */).rows as Array<{ id: string; species: string; value: number; dish: string | null }>;
      const want = Array.isArray(ids) ? new Set(ids.filter((x): x is string => typeof x === 'string').slice(0, COOLER_MAX)) : null;
      const rows = all.filter((r) => (!want || want.has(r.id)) && fishById(r.species)?.rarity !== 'junk' && fishImportQty(Number(r.value), !!r.dish) > 0);
      if (!rows.length) throw new FishError(want ? 'Only fish on the city map can go in (ship resort fish to the city first; junk and tiny fish can\'t).' : 'No fish on the city map big enough to process. Ship resort fish to the city first.');
      let fillet = 0, portion = 0; for (const r of rows) { const n = fishImportQty(Number(r.value), !!r.dish); if (r.dish) portion += n; else fillet += n; }
      const items: Array<[string, number]> = []; if (fillet) items.push(['fish_fillet', fillet]); if (portion) items.push(['fish_portion', portion]);
      const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        const ph = rows.map((_, i) => `$${i + 3}`).join(',');
        const u = await cl.query(`UPDATE fish_catches SET sold_at = $1 WHERE player_key = $2 AND sold_at IS NULL AND loc = '${FACTORY}' AND id IN (${ph})`, [this.clock(), key, ...rows.map((r) => r.id)]);
        if (u.rowCount !== rows.length) throw new FishError('Your factory fish changed — try again.');
        await sink.write(cl, items);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); if (e instanceof FishError) throw e; console.error('[fishing] toFactory failed:', (e as Error).message); throw new FishError('Something went wrong. Nothing was moved.'); }
      finally { cl.release(); }
      sink.after(items);
      return { moved: rows.length, items };
    });
  }
  async release(name: string, ids: unknown): Promise<{ released: number }> {
    const key = keyOf(name); if (!Array.isArray(ids) || !ids.length) throw new FishError('Pick fish to release.');
    const list = ids.filter((x): x is string => typeof x === 'string').slice(0, COOLER_MAX);
    return this.lock(`c:${key}`, async () => {
      const ph = list.map((_, i) => `$${i + 2}`).join(',');
      const r = await this.pool.query(`DELETE FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL AND (loc IS NULL OR loc NOT LIKE 'transit:%') AND id IN (${ph})`, [key, ...list]);
      return { released: r.rowCount ?? 0 };
    });
  }
  /** Biggest catch by weight (heaviest first, ties to the earliest catch; (one entry per player, junk excluded, QA accounts hidden). */
  async board(limit = 10): Promise<Array<{ name: string; fish: string; grams: number; value: number; at: number }>> {
    const real = FISH.filter((f) => f.rarity !== 'junk').map((f) => `'${f.id}'`).join(',');
    const r = await this.pool.query(`SELECT name, player_key, species, weight_g, COALESCE(raw_value, value) AS value, caught_at FROM fish_catches WHERE species IN (${real}) AND COALESCE(hired, FALSE) = FALSE ORDER BY weight_g DESC, caught_at ASC, id ASC LIMIT 400`);
    const seen = new Set<string>(); const out: Array<{ name: string; fish: string; grams: number; value: number; at: number }> = [];
    for (const x of r.rows as Array<Row & { name: string; player_key: string }>) {
      if (seen.has(x.player_key) || isQaName(x.name)) continue; seen.add(x.player_key);
      out.push({ name: x.name, fish: x.species, grams: Number(x.weight_g), value: Number(x.value), at: Number(x.caught_at) }); if (out.length >= limit) break;
    }
    return out;
  }
}

let fishing: Fishing | null = null;
export const getFishing = () => fishing;
export async function initFishing(): Promise<void> {
  const url = databaseUrl();
  try {
    let pool: pg.Pool;
    if (url) { pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 }); pool.on('error', (e) => console.error('[fishing] pool error:', e.message)); }
    else if (process.env.NODE_ENV !== 'production') { // local dev without a database: in-memory tables (wallet SQL included)
      const { newDb } = await import('pg-mem'); const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg(); pool = new Pool() as pg.Pool;
      await new PgCasinoStore(pool).init();
    } else return;
    const f = new Fishing(pool); await f.init(); fishing = f; console.log('[fishing] ready');
  } catch (e) { console.error('[fishing] init failed:', (e as Error).message); }
}

/** Who is fishing at the dock right now (any fish_* action in the last 20 s), and what they are doing, so other players
 *  see their cast, line, reel and catch (pt242u). Changes are pushed to the 'fish-dock' room as 'fish_anglers'. */
const HERE = new Map<string, AnglerState>();
export const HERE_MS = 20_000;
export const DOCK_ROOM = 'fish-dock';
export function markHere(name: string, now = Date.now(), patch?: Partial<Omit<AnglerState, 'name' | 'since'>>) {
  const prev = HERE.get(name);
  const next: AnglerState = { name, pose: 'idle', yaw: 0, power: 0.5, ...prev, ...(patch ?? {}), since: patch?.pose ? now : prev?.since ?? now } as AnglerState;
  if (patch?.pose && patch.pose !== 'catch') delete next.fish;
  (next as AnglerState & { seen?: number }).seen = now; HERE.set(name, next);
  if (HERE.size > 500) for (const [k, a] of HERE) if (now - ((a as AnglerState & { seen?: number }).seen ?? 0) > HERE_MS) HERE.delete(k);
}
export function leaveDock(name: string) { return HERE.delete(name); }
export function anglerStates(except: string | null, now = Date.now()): AnglerState[] {
  const out: AnglerState[] = [];
  for (const [k, a] of HERE) { const seen = (a as AnglerState & { seen?: number }).seen ?? 0; if (now - seen > HERE_MS) { HERE.delete(k); continue; }
    if (k !== except && out.length < 8) out.push({ name: a.name, pose: a.pose, since: a.since, yaw: a.yaw, power: a.power, ...(a.fish ? { fish: a.fish } : {}) }); }
  return out;
}
export function anglersHere(except: string | null, now = Date.now()): string[] { return anglerStates(except, now).map((a) => a.name); }
/** Per-socket token bucket: 8 actions, refills 4/s. */
function bucket(cap = 8, perSec = 4) { let tok = cap, at = Date.now(); return () => { const n = Date.now(); tok = Math.min(cap, tok + ((n - at) / 1000) * perSec); at = n; if (tok < 1) return false; tok -= 1; return true; }; }
type Ack = (r: Record<string, unknown>) => void;
export function registerFishing(io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const take = bucket();
  const on = (ev: string, fn: (b: Record<string, unknown>, f: Fishing, name: string) => unknown, needName = true) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try {
      if (!take()) throw new FishError('Slow down.');
      if (!fishing) throw new FishError('The dock is closed right now.');
      const name = nameOf(); if (needName && !name) throw new FishError('Sign in to fish.');
      if (name && needName) markHere(name);
      const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      ack?.({ ok: true, ...((await fn(b, fishing, name ?? '')) as object ?? {}) });
    } catch (e) { ack?.({ ok: false, error: e instanceof FishError ? e.message : 'Something went wrong.' }); if (!(e instanceof FishError)) console.error(`[fishing] ${ev}:`, (e as Error).message); }
  });
  on('fish_state', async (_b, f, n) => ({ state: await f.view(n), prices: Object.fromEntries(FISH.map((x) => [x.id, px(fishSellValue(x.base))])) }));
  const pushDock = () => { try { io.to(DOCK_ROOM).emit('fish_anglers', { anglers: anglerStates(null) }); } catch { /* best effort */ } };
  const pose = (n: string, patch: Partial<Omit<AnglerState, 'name' | 'since'>>) => { markHere(n, Date.now(), patch); pushDock(); };
  on('fish_cast', async (b, f, n) => { const r = await f.cast(n, b.spot); pose(n, { pose: 'cast', ...anglerAim(b.yaw, b.power) }); return r; });
  on('fish_hook', async (_b, f, n) => { const r = await f.hook(n); pose(n, { pose: 'reel' }); return r; });
  on('fish_land', async (b, f, n) => { const r = await f.land(n, b.inputs); pose(n, r.caught && r.fish ? { pose: 'catch', fish: r.fish.fish } : { pose: 'idle' }); return r; });
  on('fish_reel_in', (_b, f, n) => { f.reelIn(n); pose(n, { pose: 'idle' }); return {}; });
  on('fish_sell', (b, f, n) => { awayFromMarket(n, FishError); return f.sell(n, b.ids, b.qty); });
  on('fish_release', (b, f, n) => f.release(n, b.ids));
  on('fish_here', () => { void socket.join(DOCK_ROOM); return { anglers: anglersHere(nameOf()), states: anglerStates(nameOf()) }; });
  const leave = () => { void socket.leave(DOCK_ROOM); const n = nameOf(); if (n && leaveDock(n)) pushDock(); };
  socket.on('fish_leave', (_p: unknown, ack?: Ack) => { leave(); ack?.({ ok: true }); });
  socket.on('disconnect', () => { const n = nameOf(); if (n && leaveDock(n)) pushDock(); });
  on('fish_board', async (_b, f) => ({ board: await f.board() }), false);
}

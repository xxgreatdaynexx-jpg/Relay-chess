/**
 * Fishing at the lake dock (rules in shared/fishing.ts). The server rolls every catch when you cast (crypto RNG),
 * keeps it secret until it is landed, and replays the reel minigame from the client's input timeline with the same
 * seed: only a timeline that lands the fish on its last step, in plausible wall time, puts it in your cooler.
 * Catches live in fish_catches (Postgres); selling claims the rows (UPDATE ... sold_at IS NULL must hit every id) and
 * credits chips through the atomic wallet (ledger game 'fish_sell') in the SAME transaction, after the daily-tier row
 * is advanced with an optimistic check, so a fish sells exactly once and the daily cap holds across instances.
 * Every landed catch is announced on the skill-activity bus (server/activity.ts) for the Fishing skill.
 */
import { randomInt, randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { getBank, PgCasinoStore, type CasinoBank } from './casino-store.js';
import { px, priceIndex } from './price-index.js';
import { emitActivity } from './activity.js';
import { awardXp } from './skills.js';
import { isQaName } from '../shared/qa.js';
import type { ImportSink } from './farm.js';
import {
  BITE_MAX_MS, BITE_MIN_MS, CAST_COOLDOWN_MS, COOLER_MAX, FISH, FISH_XP, fishById, fishDiff, fishPayout, fishValue, HOOK_WINDOW_MS,
  REEL_DT, replayReel, rollFish, rollWeight, type FishCatch, type FishView,
} from '../shared/fishing.js';

export const FISH_MIGRATION = `
CREATE TABLE IF NOT EXISTS fish_catches (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, species TEXT NOT NULL, weight_g INTEGER NOT NULL, value INTEGER NOT NULL, caught_at BIGINT NOT NULL, sold_at BIGINT);
CREATE INDEX IF NOT EXISTS fish_catches_player ON fish_catches (player_key, sold_at);
ALTER TABLE fish_catches ADD COLUMN IF NOT EXISTS dish TEXT;
ALTER TABLE fish_catches ADD COLUMN IF NOT EXISTS raw_value INTEGER;
CREATE TABLE IF NOT EXISTS fish_daily (player_key TEXT NOT NULL, day TEXT NOT NULL, gross BIGINT NOT NULL DEFAULT 0, paid BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (player_key, day));
`;
/** Factory units for one cooler fish (base value): raw -> fillets (8 each), cooked -> portions (10 each). */
export const fishImportQty = (value: number, cooked: boolean) => Math.floor(value / (cooked ? 10 : 8));
export class FishError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
interface Cast { castAt: number; biteAt: number; fish: string; grams: number; seed: number; hookedAt: number | null }
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
    const r = await this.pool.query('SELECT id, species, weight_g, value, caught_at FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL ORDER BY caught_at DESC', [key]);
    return (r.rows as Row[]).map((x) => ({ id: x.id, fish: x.species, grams: Number(x.weight_g), value: Number(x.value), at: Number(x.caught_at) }));
  }
  private async today(key: string) {
    const r = await this.pool.query('SELECT gross, paid FROM fish_daily WHERE player_key = $1 AND day = $2', [key, utcDay(this.clock())]);
    return { gross: Number(r.rows[0]?.gross ?? 0), paid: Number(r.rows[0]?.paid ?? 0) };
  }
  async view(name: string): Promise<FishView> {
    const key = keyOf(name);
    const best = (await this.pool.query("SELECT species, weight_g FROM fish_catches WHERE player_key = $1 ORDER BY COALESCE(raw_value, value) DESC, weight_g DESC LIMIT 1", [key])).rows[0];
    const n = (await this.pool.query('SELECT count(*) AS n FROM fish_catches WHERE player_key = $1', [key])).rows[0];
    return { cooler: await this.cooler(key), today: await this.today(key), index: priceIndex(), best: best ? { fish: String(best.species), grams: Number(best.weight_g) } : null, totals: { caught: Number(n?.n ?? 0) } };
  }

  /** Throw a line. The fish (and when it bites) is decided now and stays server-side. */
  async cast(name: string): Promise<{ biteIn: number }> {
    const key = keyOf(name); const now = this.clock();
    if (now - (this.lastCast.get(key) ?? -Infinity) < CAST_COOLDOWN_MS) throw new FishError('Easy — let the line settle first.');
    const n = Number((await this.pool.query('SELECT count(*) AS n FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL', [key])).rows[0]?.n ?? 0);
    if (n >= COOLER_MAX) throw new FishError(`Your cooler is full (${COOLER_MAX}). Sell or release some fish first.`);
    this.lastCast.set(key, now);
    const f = rollFish(this.rng.unit(), this.rng.unit()); const grams = rollWeight(f, this.rng.unit());
    const biteIn = this.rng.int(BITE_MIN_MS, BITE_MAX_MS + 1);
    this.casts.set(key, { castAt: now, biteAt: now + biteIn, fish: f.id, grams, seed: this.rng.int(1, 2 ** 31), hookedAt: null });
    return { biteIn };
  }
  /** Strike when it bites: too early spooks it, too late it is gone. Returns the reel game's seed + difficulty. */
  hook(name: string): { seed: number; diff: number } {
    const key = keyOf(name); const c = this.casts.get(key); const now = this.clock();
    if (!c || c.hookedAt !== null) throw new FishError('Cast your line first.');
    if (now < c.biteAt - 200) { this.casts.delete(key); throw new FishError('Too early — you spooked it.'); }
    if (now > c.biteAt + HOOK_WINDOW_MS) { this.casts.delete(key); throw new FishError('Too slow — it stole your bait.'); }
    c.hookedAt = now; return { seed: c.seed, diff: fishDiff(fishById(c.fish)!, c.grams) };
  }
  /** Land (or lose) the fish: the server replays the reel timeline. */
  async land(name: string, inputs: unknown): Promise<{ caught: boolean; fish?: FishCatch; xp?: number }> {
    const key = keyOf(name); const c = this.casts.get(key); const now = this.clock();
    if (!c || c.hookedAt === null) throw new FishError('Nothing on the line.');
    this.casts.delete(key);
    const f = fishById(c.fish)!; const res = replayReel(c.seed, fishDiff(f, c.grams), inputs as string);
    if (res === 'invalid') throw new FishError('The line snapped.');
    const steps = (inputs as string).length;
    if (now - c.hookedAt < steps * REEL_DT * 1000 - 600) throw new FishError('The line snapped.'); // faster than real time
    if (res === 'lost') return { caught: false };
    return this.lock(`c:${key}`, async () => {
      const n = Number((await this.pool.query('SELECT count(*) AS n FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL', [key])).rows[0]?.n ?? 0);
      if (n >= COOLER_MAX) throw new FishError('Your cooler is full.');
      const fish: FishCatch = { id: randomUUID(), fish: f.id, grams: c.grams, value: fishValue(f, c.grams), at: now };
      await this.pool.query('INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [fish.id, key, name, f.id, fish.grams, fish.value, now]);
      const xp = FISH_XP[f.rarity];
      awardXp(name, 'fishing', xp);
      emitActivity({ name, skill: 'fishing', xp, action: 'catch', detail: { fish: f.id, rarity: f.rarity, grams: fish.grams, value: fish.value }, at: now });
      return { caught: true, fish, xp };
    });
  }
  /** Give up on the current cast (no penalty). */
  reelIn(name: string) { this.casts.delete(keyOf(name)); }

  /** Sell from the cooler (all, or the given ids) for chips: daily tiers on base value, then the price index. */
  async sell(name: string, ids?: unknown): Promise<{ sold: number; gross: number; paid: number; chips: number }> {
    const key = keyOf(name);
    return this.lock(`c:${key}`, async () => {
      let rows = await this.cooler(key);
      if (Array.isArray(ids)) { const want = new Set(ids.filter((x): x is string => typeof x === 'string').slice(0, COOLER_MAX)); rows = rows.filter((r) => want.has(r.id)); }
      if (!rows.length) throw new FishError('Nothing to sell.');
      const day = utcDay(this.clock()); const t = await this.today(key);
      const gross = rows.reduce((a, r) => a + r.value, 0);
      const base = fishPayout(gross, t.gross); const paid = Math.floor(base * priceIndex());
      if (paid <= 0) throw new FishError("The fishmonger has bought all they can from you today. Come back after 00:00 UTC (or release your catch).");
      const counts = new Map<string, number>(); for (const r of rows) counts.set(fishById(r.fish)?.label ?? r.fish, (counts.get(fishById(r.fish)?.label ?? r.fish) ?? 0) + 1);
      const memo = `Fish market: sold ${[...counts].map(([l, n]) => `${n} ${l}`).join(', ')}`.slice(0, 200);
      const body = async (cl: pg.PoolClient) => {
        const ph = rows.map((_, i) => `$${i + 3}`).join(',');
        const u = await cl.query(`UPDATE fish_catches SET sold_at = $1 WHERE player_key = $2 AND sold_at IS NULL AND id IN (${ph})`, [this.clock(), key, ...rows.map((r) => r.id)]);
        if (u.rowCount !== rows.length) throw new FishError('Already sold.');
        if (t.gross === 0 && t.paid === 0) await cl.query('INSERT INTO fish_daily (player_key, day, gross, paid) VALUES ($1,$2,0,0) ON CONFLICT (player_key, day) DO NOTHING', [key, day]);
        const d = await cl.query('UPDATE fish_daily SET gross = gross + $3, paid = paid + $4 WHERE player_key = $1 AND day = $2 AND gross = $5', [key, day, gross, paid, t.gross]);
        if (d.rowCount !== 1) throw new FishError('Busy — try again.');
      };
      const w = this.bank().transferAtomic([{ name, amount: paid, key: `fish_sell:${randomUUID()}`, game: 'fish_sell', memo }]);
      const run = async () => {
        await w.after; const cl = await this.pool.connect();
        try { await cl.query('BEGIN'); await body(cl); for (const s of w.stmts) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
        catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
      };
      const p = run(); w.bind(p);
      try { await p; } catch (e) { w.revert(); if (e instanceof FishError) throw e; console.error('[fishing] sell failed:', (e as Error).message); throw new FishError('Something went wrong. Nothing was sold.'); }
      return { sold: rows.length, gross, paid, chips: this.bank().account(name).chips };
    });
  }
  /** pt1252u: move fish from the cooler into Factory storage. Raw fish -> fillets (1 per 8 base value), cooked dishes ->
   * portions (1 per 10). Junk can't go. One UPDATE (still yours, unsold) + the storage write in the same transaction. */
  async toFactory(name: string, ids: unknown, sink: ImportSink): Promise<{ moved: number; items: Array<[string, number]> }> {
    const key = keyOf(name);
    return this.lock(`c:${key}`, async () => {
      const all = (await this.pool.query('SELECT id, species, value, dish FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL', [key])).rows as Array<{ id: string; species: string; value: number; dish: string | null }>;
      const want = Array.isArray(ids) ? new Set(ids.filter((x): x is string => typeof x === 'string').slice(0, COOLER_MAX)) : null;
      const rows = all.filter((r) => (!want || want.has(r.id)) && fishById(r.species)?.rarity !== 'junk' && fishImportQty(Number(r.value), !!r.dish) > 0);
      if (!rows.length) throw new FishError(want ? 'Those fish can\'t go to the factory (junk or too small).' : 'No fish in your cooler big enough for the factory.');
      let fillet = 0, portion = 0; for (const r of rows) { const n = fishImportQty(Number(r.value), !!r.dish); if (r.dish) portion += n; else fillet += n; }
      const items: Array<[string, number]> = []; if (fillet) items.push(['fish_fillet', fillet]); if (portion) items.push(['fish_portion', portion]);
      const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        const ph = rows.map((_, i) => `$${i + 3}`).join(',');
        const u = await cl.query(`UPDATE fish_catches SET sold_at = $1 WHERE player_key = $2 AND sold_at IS NULL AND id IN (${ph})`, [this.clock(), key, ...rows.map((r) => r.id)]);
        if (u.rowCount !== rows.length) throw new FishError('Your cooler changed — try again.');
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
      const r = await this.pool.query(`DELETE FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL AND id IN (${ph})`, [key, ...list]);
      return { released: r.rowCount ?? 0 };
    });
  }
  /** Biggest catch per species-weight (one entry per player, junk excluded, QA accounts hidden). */
  async board(limit = 10): Promise<Array<{ name: string; fish: string; grams: number; value: number; at: number }>> {
    const real = FISH.filter((f) => f.rarity !== 'junk').map((f) => `'${f.id}'`).join(',');
    const r = await this.pool.query(`SELECT name, player_key, species, weight_g, COALESCE(raw_value, value) AS value, caught_at FROM fish_catches WHERE species IN (${real}) ORDER BY COALESCE(raw_value, value) DESC, weight_g DESC LIMIT 400`);
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

/** Who is fishing at the dock right now (any fish_* action in the last 20 s), for the 3D scene's other anglers. */
const HERE = new Map<string, number>();
export const HERE_MS = 20_000;
export function markHere(name: string, now = Date.now()) { HERE.set(name, now); if (HERE.size > 500) for (const [k, t] of HERE) if (now - t > HERE_MS) HERE.delete(k); }
export function anglersHere(except: string | null, now = Date.now()): string[] {
  const out: string[] = []; for (const [k, t] of HERE) { if (now - t > HERE_MS) { HERE.delete(k); continue; } if (k !== except && out.length < 8) out.push(k); } return out;
}
/** Per-socket token bucket: 8 actions, refills 4/s. */
function bucket(cap = 8, perSec = 4) { let tok = cap, at = Date.now(); return () => { const n = Date.now(); tok = Math.min(cap, tok + ((n - at) / 1000) * perSec); at = n; if (tok < 1) return false; tok -= 1; return true; }; }
type Ack = (r: Record<string, unknown>) => void;
export function registerFishing(_io: Server, socket: Socket): void {
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
  on('fish_state', async (_b, f, n) => ({ state: await f.view(n), prices: Object.fromEntries(FISH.map((x) => [x.id, px(x.base)])) }));
  on('fish_cast', (_b, f, n) => f.cast(n));
  on('fish_hook', (_b, f, n) => f.hook(n));
  on('fish_land', (b, f, n) => f.land(n, b.inputs));
  on('fish_reel_in', (_b, f, n) => { f.reelIn(n); return {}; });
  on('fish_sell', (b, f, n) => f.sell(n, b.ids));
  on('fish_release', (b, f, n) => f.release(n, b.ids));
  on('fish_here', () => ({ anglers: anglersHere(nameOf()) }));
  on('fish_board', async (_b, f) => ({ board: await f.board() }), false);
}

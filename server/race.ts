import { isJailed } from './jail.js';
/**
 * Chud Hub Speedway: server-timed laps + the Daily Cup.
 *
 * Laps are timed from the poses the driving relay already accepted (speed / teleport checks in shared/cars.validDrive),
 * through four timing gates in order (shared/venues.LapTimer). Leaving the track mid-lap voids it. Every valid lap
 * updates the player's best of the day (race_laps); the all-time board is the best over all days.
 *
 * Daily Cup: entering costs px(RACE_ENTRY_BASE) chips (ONE Postgres transaction: ledger row 'race_entry' + race_entries row).
 * Laps after entering count for the Cup. At the end of the UTC day the pool (all entry fees + px(RACE_SEED_BASE) from
 * the house) pays the top 3 Cup laps 50/30/20 ('race_prize', idempotent ledger keys race_prize:<day>:<rank>). QA accounts
 * can race and enter but never take a prize (their share is not paid out).
 */
import { royaltyEarn } from './royalty.js';
import pg from 'pg';
import { bootAttach, setBootState } from './boot-retry.js';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { awardXp } from './skills.js';
import { px } from './price-index.js';
import { setDriveHook, keyOf } from './cars.js';
import { CAR_BY_ID } from '../shared/cars.js';
import { LapTimer, RACE_ENTRY_BASE, RACE_SEED_BASE, RACE_SPLIT, fmtLap, type LapEvent } from '../shared/venues.js';
import { skillLevelAsync } from './skills.js';
import { racingEntryMul } from '../shared/skillPerks.js';
import { minLapMs } from '../shared/racePhysics.js';
import { MAX_SPEED_FACTOR } from '../shared/mechanic.js';

/** Fastest believable lap (ms) for a car with every engine/nitro upgrade: the server's lap-time sanity floor. */
export const carMinLapMs = (carId: string) => minLapMs((CAR_BY_ID.get(carId)?.topKmh ?? 35) * MAX_SPEED_FACTOR);

export class RaceError extends Error {}
export const RACE_MIGRATION = `CREATE TABLE IF NOT EXISTS race_laps (day TEXT NOT NULL, player_key TEXT NOT NULL, name TEXT NOT NULL, car_id TEXT NOT NULL, ms INTEGER NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (day, player_key));
CREATE TABLE IF NOT EXISTS race_entries (day TEXT NOT NULL, player_key TEXT NOT NULL, name TEXT NOT NULL, fee BIGINT NOT NULL, best_ms INTEGER, best_car TEXT, at BIGINT NOT NULL, PRIMARY KEY (day, player_key));
CREATE TABLE IF NOT EXISTS race_paid (day TEXT PRIMARY KEY, pool BIGINT NOT NULL, payouts JSONB NOT NULL, at BIGINT NOT NULL);`;

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };
export const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const isQa = (k: string) => k.startsWith('qa-');
export interface BoardRow { name: string; car: string; ms: number }
interface Entry { name: string; fee: number; bestMs: number | null; bestCar: string | null }

export class Speedway {
  private timers = new Map<string, LapTimer>();
  private timerCar = new Map<string, string>();
  private memLaps = new Map<string, Map<string, BoardRow>>(); // day -> key -> best
  private memEntries = new Map<string, Map<string, Entry>>();
  private memPaid = new Map<string, { pool: number; payouts: Array<{ name: string; rank: number; amount: number }> }>();
  private entered = new Map<string, boolean>(); // `${day}|${key}` cache
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) {}
  async init() { if (this.pool) await this.pool.query(RACE_MIGRATION); }

  /** Feed an accepted pose; returns lap events for that driver. */
  async pose(name: string, carId: string, x: number, z: number, t: number): Promise<Array<LapEvent & { text?: string; best?: boolean }>> {
    const k = keyOf(name); const minMs = carMinLapMs(carId); let lt = this.timers.get(k);
    if (!lt || this.timerCar.get(k) !== carId) { lt = new LapTimer({ minMs }); this.timers.set(k, lt); this.timerCar.set(k, carId); }
    const evs = lt.feed(x, z, t); const out: Array<LapEvent & { text?: string; best?: boolean }> = [];
    for (const e of evs) {
      if (e.kind !== 'lap') { out.push(e); continue; }
      const best = await this.record(name, carId, e.ms!, t);
      awardXp(name, 'racing', best ? 50 : 30);
      out.push({ ...e, best, text: `Lap ${fmtLap(e.ms!)}${best ? ' · personal best today!' : ''}` });
    }
    return out;
  }
  reset(name: string) { this.timers.get(keyOf(name))?.reset(); }

  private async isEntered(day: string, k: string): Promise<boolean> {
    const ck = `${day}|${k}`; if (this.entered.has(ck)) return this.entered.get(ck)!;
    const v = this.pool ? ((await this.pool.query('SELECT 1 FROM race_entries WHERE day = $1 AND player_key = $2', [day, k])).rowCount ?? 0) > 0 : !!this.memEntries.get(day)?.has(k);
    this.entered.set(ck, v); return v;
  }
  /** Store a lap; returns true when it is the player's best of the day. */
  async record(name: string, carId: string, ms: number, t: number): Promise<boolean> {
    const day = dayOf(t); const k = keyOf(name); const car = CAR_BY_ID.has(carId) ? carId : 'cart';
    if (!Number.isFinite(ms) || ms < carMinLapMs(car)) throw new RaceError('Lap rejected: faster than that car can go.'); // defence in depth
    let best: boolean;
    if (!this.pool) {
      const m = this.memLaps.get(day) ?? new Map<string, BoardRow>(); this.memLaps.set(day, m); const cur = m.get(k);
      best = !cur || ms < cur.ms; if (best) m.set(k, { name: name.trim(), car, ms });
      const e = this.memEntries.get(day)?.get(k); if (e && (e.bestMs == null || ms < e.bestMs)) { e.bestMs = ms; e.bestCar = car; }
      return best;
    }
    const r = await this.pool.query(`INSERT INTO race_laps (day, player_key, name, car_id, ms, at) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (day, player_key) DO UPDATE SET ms = EXCLUDED.ms, car_id = EXCLUDED.car_id, name = EXCLUDED.name, at = EXCLUDED.at WHERE race_laps.ms > EXCLUDED.ms RETURNING ms`, [day, k, name.trim(), car, ms, t]);
    best = (r.rowCount ?? 0) > 0;
    if (await this.isEntered(day, k)) await this.pool.query('UPDATE race_entries SET best_ms = $3, best_car = $4 WHERE day = $1 AND player_key = $2 AND (best_ms IS NULL OR best_ms > $3)', [day, k, ms, car]);
    return best;
  }

  /** Enter today's Cup: one atomic ledger + entry write. */
  async enter(name: string) {
    const day = dayOf(this.clock()); const k = keyOf(name); const fee = Math.max(1, Math.round(px(RACE_ENTRY_BASE) * racingEntryMul(await skillLevelAsync(name, 'racing')))); // Racing perk
    if (await this.isEntered(day, k)) throw new RaceError('You are already in today\'s Cup. Set your fastest lap!');
    const bank = getBank(); if (!bank.canAfford(name, fee)) throw new RaceError('Not enough chips.');
    const w = bank.transferAtomic([{ name, amount: -fee, key: `race_entry:${day}:${k}`, game: 'race_entry', memo: `Speedway Daily Cup entry (${day})` }]);
    const run = async () => {
      if (!this.pool) { const m = this.memEntries.get(day) ?? new Map<string, Entry>(); this.memEntries.set(day, m); m.set(k, { name: name.trim(), fee, bestMs: null, bestCar: null }); return; }
      await w.after; const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query('INSERT INTO race_entries (day, player_key, name, fee, at) VALUES ($1,$2,$3,$4,$5)', [day, k, name.trim(), fee, this.clock()]);
        for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); console.error('[race] entry failed:', (e as Error).message); throw new RaceError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : 'Entry failed. Nothing was charged.'); }
    this.entered.set(`${day}|${k}`, true);
    return { fee, chips: bank.account(name).chips };
  }

  private async entries(day: string): Promise<Array<Entry & { key: string }>> {
    if (!this.pool) return [...(this.memEntries.get(day) ?? new Map<string, Entry>())].map(([key, e]) => ({ key, ...e }));
    return (await this.pool.query('SELECT * FROM race_entries WHERE day = $1', [day])).rows.map((r) => ({ key: String(r.player_key), name: String(r.name), fee: Number(r.fee), bestMs: r.best_ms == null ? null : Number(r.best_ms), bestCar: r.best_car == null ? null : String(r.best_car) }));
  }
  async cup(day = dayOf(this.clock()), me?: string | null) {
    const es = await this.entries(day); const fees = es.reduce((a, e) => a + e.fee, 0);
    const ranked = es.filter((e) => e.bestMs != null).sort((a, b) => a.bestMs! - b.bestMs!);
    return { day, entry: px(RACE_ENTRY_BASE), seed: px(RACE_SEED_BASE), pool: fees + px(RACE_SEED_BASE), entrants: es.length, split: RACE_SPLIT,
      entered: !!(me && es.some((e) => e.key === keyOf(me))), standings: ranked.slice(0, 10).map((e) => ({ name: e.name, car: e.bestCar ?? '', ms: e.bestMs! })) };
  }
  async board(me?: string | null) {
    const day = dayOf(this.clock()); let today: BoardRow[]; let allTime: BoardRow[];
    if (!this.pool) {
      today = [...(this.memLaps.get(day)?.values() ?? [])].sort((a, b) => a.ms - b.ms).slice(0, 10);
      const best = new Map<string, BoardRow>(); for (const m of this.memLaps.values()) for (const [k, r] of m) if (!best.has(k) || r.ms < best.get(k)!.ms) best.set(k, r);
      allTime = [...best.values()].sort((a, b) => a.ms - b.ms).slice(0, 10);
    } else {
      const map = (r: Record<string, unknown>) => ({ name: String(r.name), car: String(r.car_id), ms: Number(r.ms) });
      today = (await this.pool.query('SELECT name, car_id, ms FROM race_laps WHERE day = $1 ORDER BY ms LIMIT 10', [day])).rows.map(map);
      allTime = (await this.pool.query('SELECT DISTINCT ON (player_key) player_key, name, car_id, ms FROM race_laps ORDER BY player_key, ms')).rows.map(map).sort((a, b) => a.ms - b.ms).slice(0, 10);
    }
    return { today, allTime, cup: await this.cup(day, me), lastCup: await this.lastPaid() };
  }
  private async lastPaid() {
    if (!this.pool) { const d = [...this.memPaid.keys()].sort().pop(); return d ? { day: d, ...this.memPaid.get(d)! } : null; }
    const r = (await this.pool.query('SELECT * FROM race_paid ORDER BY day DESC LIMIT 1')).rows[0];
    return r ? { day: String(r.day), pool: Number(r.pool), payouts: r.payouts as Array<{ name: string; rank: number; amount: number }> } : null;
  }

  /** Pay out every finished day that has entries and no payout yet. Safe to run repeatedly (ledger keys are idempotent). */
  async settle(): Promise<number> {
    const today = dayOf(this.clock()); const bank = getBank(); if (!bank.ready) return 0;
    const days = this.pool ? (await this.pool.query('SELECT DISTINCT e.day FROM race_entries e LEFT JOIN race_paid p ON p.day = e.day WHERE p.day IS NULL AND e.day < $1 ORDER BY e.day', [today])).rows.map((r) => String(r.day))
      : [...this.memEntries.keys()].filter((d) => d < today && !this.memPaid.has(d)).sort();
    let n = 0;
    for (const day of days) {
      const c = await this.cup(day); const es = await this.entries(day); const byName = new Map(es.map((e) => [e.name, e.key]));
      const payouts: Array<{ name: string; rank: number; amount: number }> = [];
      for (const [i, s] of c.standings.slice(0, RACE_SPLIT.length).entries()) {
        const amount = Math.floor(c.pool * RACE_SPLIT[i]!); const k = byName.get(s.name) ?? keyOf(s.name);
        if (isQa(k) || amount <= 0 || isJailed(s.name)) continue; // jailed: share not paid
        if (await bank.transferConfirmed(s.name, amount, { key: `race_prize:${day}:${i + 1}`, game: 'race_prize', memo: `Speedway Daily Cup ${day}: #${i + 1} (${fmtLap(s.ms)})` })) royaltyEarn('racetrack', s.name, amount);
        payouts.push({ name: s.name, rank: i + 1, amount }); n++;
      }
      if (!this.pool) this.memPaid.set(day, { pool: c.pool, payouts });
      else await this.pool.query('INSERT INTO race_paid (day, pool, payouts, at) VALUES ($1,$2,$3,$4) ON CONFLICT (day) DO NOTHING', [day, c.pool, JSON.stringify(payouts), this.clock()]);
    }
    return n;
  }
}

let speedway: Speedway | null = null;
export const getSpeedway = () => speedway;
export function setSpeedway(s: Speedway | null) {
  speedway = s;
  setDriveHook(s ? { pose: (n, c, x, z, t) => s.pose(n, c, x, z, t), reset: (n) => s.reset(n) } : null);
}
let settleTimer: NodeJS.Timeout | null = null;
export async function initRace(): Promise<void> {
  const url = databaseUrl();
  if (!url) { setSpeedway(new Speedway(null)); setBootState('race', 'memory'); }
  else {
    const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
    pool.on('error', (e) => console.error('[race] pool error:', e.message));
    await bootAttach('race', async () => { try { const s = new Speedway(pool as unknown as PoolLike); await s.init(); setSpeedway(s); console.log('[race] ready'); return true; } catch (e) { console.error('[race] init failed:', (e as Error).message); return false; } });
  }
  if (!settleTimer) { settleTimer = setInterval(() => { void speedway?.settle().catch((e) => console.error('[race] settle:', (e as Error).message)); }, 5 * 60_000); settleTimer.unref?.(); }
  setTimeout(() => { void speedway?.settle().catch(() => {}); }, 30_000).unref?.();
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerRace(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const on = (ev: string, fn: (s: Speedway) => unknown) => socket.on(ev, async (_b: unknown, ack?: Ack) => {
    try { if (!speedway) throw new RaceError('The Speedway is opening up. Try again in a moment.'); ack?.({ ok: true, ...((await fn(speedway)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof RaceError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  on('race_board', (s) => s.board(nameOf()));
  on('race_enter', (s) => { const n = nameOf(); if (!n) throw new RaceError('Sign in to enter the Cup.'); return s.enter(n); });
}

/**
 * Employment Office (pt1274u): hired AI workers (shared/employment.ts has the rules and prices).
 * Postgres is the source of truth (employ_workers); production is computed lazily from server timestamps, so it
 * survives restarts and needs no ticking. Chips only move through the atomic wallet (CasinoBank.transferAtomic) with
 * ledger reasons 'employ_hire' and 'employ_wage', committed in the same transaction as the worker row.
 *
 * Lifecycle: hire = hire fee + the first day's wage. Work runs from last_at to min(now, paid_until, seen_at + 8 h).
 * When a paid day ends the next day's wage is charged, unless the owner has been away 8 h by then (worker goes idle,
 * nothing charged) or can't pay (worker stops unpaid; no debt). Collecting re-hires an idle/unpaid worker for a new
 * day. Firing is free and refunds nothing. Output goes to normal storage (ores → mine storage, fish → cooler), so the
 * usual daily sell tiers apply; workers give the owner no skill XP.
 */
import { getLocStore } from './locstock.js';
import { mineLoc, fishingLoc } from '../shared/inventoryLocations.js';
import { randomUUID, randomInt } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { bootAttach, setBootState } from './boot-retry.js';
import { databaseUrl } from './leaderboard-store.js';
import { getBank, type CasinoBank } from './casino-store.js';
import { px } from './price-index.js';
import { getMines, MINES_OFFLINE_MSG } from './mines.js';
import { getFactory } from './factory.js';
import { playerKey } from './skins.js';
import { workerBonusTotal } from '../shared/realEstate.js';
import { ORES, MAX_BANKED_STACK, stackKey, type OreId } from '../shared/mines.js';
import { COOLER_MAX } from '../shared/fishing.js';
import {
  JOBS, jobById, baseHire, baseWage, itemsPerDay, dayValue, rollOre, rollWorkerFish, boxCount,
  DAY, MAX_WORKERS, OFFLINE_CAP_MS, MIN_ACCOUNT_AGE_MS, type JobDef, type EmployLogItem, type Unit, type WorkerBox, type WorkerStatus, type WorkerView, type EmployView,
} from '../shared/employment.js';

export const EMPLOY_MIGRATION = `
CREATE TABLE IF NOT EXISTS employ_workers (id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, owner_name TEXT NOT NULL, job TEXT NOT NULL, hired_at BIGINT NOT NULL, last_at BIGINT NOT NULL, seen_at BIGINT NOT NULL, paid_until BIGINT NOT NULL, status TEXT NOT NULL, box TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS employ_workers_owner ON employ_workers (owner_key);
CREATE TABLE IF NOT EXISTS employ_log (owner_key TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL, at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS employ_log_owner ON employ_log (owner_key, at);
`;
export class EmployError extends Error {}
const HOUR_MS = 3_600_000;
interface LogRow { type: 'ore' | 'fish'; id: string; qty: number; at: number }
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
/** Where a miner's ores land (banked mine storage), inside the caller's transaction. */
export interface OreSink { write(cl: Q, items: Array<[OreId, number]>): Promise<void>; after(items: Array<[OreId, number]>): void; /** Free space for this ore (default: unlimited). */ room?(id: OreId): number }
interface Row { id: string; owner_key: string; owner_name: string; job: string; hired_at: string | number; last_at: string | number; seen_at: string | number; paid_until: string | number; status: string; box: string }
interface W { id: string; job: JobDef; hiredAt: number; lastAt: number; seenAt: number; paidUntil: number; status: WorkerStatus; box: WorkerBox }
const parse = (r: Row): W | null => {
  const job = jobById(r.job); if (!job) return null;
  let box: WorkerBox = {}; try { box = JSON.parse(r.box || '{}'); } catch { box = {}; }
  return { id: r.id, job, hiredAt: Number(r.hired_at), lastAt: Number(r.last_at), seenAt: Number(r.seen_at), paidUntil: Number(r.paid_until), status: (r.status as WorkerStatus), box };
};
const boxValue = (b: WorkerBox) => Object.entries(b.ores ?? {}).reduce((a, [id, n]) => a + ORES[id as OreId].price * (n ?? 0), 0) + (b.fish ?? []).reduce((a, f) => a + f.value, 0);
export const cryptoUnit: Unit = () => randomInt(0, 2 ** 32) / 2 ** 32;

/** Real sink: hired miners' ores land AT The Mine (loc_stock 'mine:mine', truck logistics) in the caller's transaction;
 * the in-memory mirror is applied after it commits. Truck them to your factory / the Warehouse from there. */
export function mineOreSink(account: string): OreSink {
  const ls = getLocStore(); if (!ls.loaded) throw new EmployError(MINES_OFFLINE_MSG);
  const loc = mineLoc('mine'); const d = (items: Array<[OreId, number]>) => items.map(([id, n]) => ({ loc, item: `ore:${id}`, delta: n }));
  return {
    room: (id) => Math.max(0, MAX_BANKED_STACK - ls.qty(account, loc, `ore:${id}`)),
    async write(cl, items) {
      for (const [id, n] of items) if (ls.qty(account, loc, `ore:${id}`) + n > MAX_BANKED_STACK) throw new EmployError('Your mine storage is full for that ore.');
      for (const st of ls.rowsFor(account, d(items))) await cl.query(st.sql, st.args);
    },
    after(items) { ls.applyMem(account, d(items)); },
  };
}

export class Employment {
  private locks = new Map<string, Promise<unknown>>();
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  constructor(private readonly pool: pg.Pool, private readonly bank: () => CasinoBank = getBank, private readonly clock = () => Date.now(),
    private readonly sink: (account: string) => OreSink = mineOreSink, private readonly unit: Unit = cryptoUnit) {}
  async init() { await this.pool.query(EMPLOY_MIGRATION); }

  hirePrice = (j: JobDef) => px(baseHire(j));
  wagePrice = (j: JobDef) => px(baseWage(j));

  private async tx(body: (cl: pg.PoolClient) => Promise<void>, charge?: { name: string; amount: number; game: string; memo: string }) {
    let w: ReturnType<CasinoBank['transferAtomic']> | null = null;
    try { w = charge && charge.amount !== 0 ? this.bank().transferAtomic([{ name: charge.name, amount: charge.amount, key: `${charge.game}:${randomUUID()}`, game: charge.game, memo: charge.memo }]) : null; }
    catch (e) { throw new EmployError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : (e as Error).message === 'Wallet temporarily unavailable.' ? 'Wallet temporarily unavailable.' : 'Something went wrong. Nothing was charged.'); }
    const run = async () => {
      if (w) await w.after; const cl = await this.pool.connect();
      try { await cl.query('BEGIN'); await body(cl); if (w) for (const s of w.stmts) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
      catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); const ww = w; ww?.bind(p);
    try { await p; } catch (e) { ww?.revert(); if (e instanceof EmployError) throw e; if (w && /chips|balance|null value/i.test((e as Error).message)) throw new EmployError('Not enough chips.'); console.error('[employ] failed:', (e as Error).message); throw new EmployError('Something went wrong. Nothing was charged.'); }
  }
  private async rows(key: string): Promise<W[]> {
    const r = await this.pool.query('SELECT * FROM employ_workers WHERE owner_key = $1 ORDER BY hired_at ASC, id ASC', [key]);
    return (r.rows as Row[]).map(parse).filter((w): w is W => !!w);
  }
  private save(cl: Q, w: W) {
    return cl.query('UPDATE employ_workers SET last_at = $2, seen_at = $3, paid_until = $4, status = $5, box = $6 WHERE id = $1', [w.id, w.lastAt, w.seenAt, w.paidUntil, w.status, JSON.stringify(w.box)]);
  }
  /** Pick-up log rows waiting to be written (owner key → rows), filled by produce(). */
  private pendingLog = new Map<string, LogRow[]>();
  private produce(w: W, until: number, key?: string) {
    const every = w.job.everyMs; if (until <= w.lastAt) return; const n = Math.floor((until - w.lastAt) / every); if (n <= 0) return;
    const log = key ? (this.pendingLog.get(key) ?? []) : null; if (log && key) this.pendingLog.set(key, log);
    for (let i = 0; i < n; i++) {
      const at = w.lastAt + (i + 1) * every; let type: 'ore' | 'fish', id: string;
      if (w.job.kind === 'miner') { const o = rollOre(w.job.cave!, this.unit); (w.box.ores ??= {})[o] = (w.box.ores[o] ?? 0) + 1; type = 'ore'; id = o; }
      else { const f = rollWorkerFish(this.unit); (w.box.fish ??= []).push({ species: f.fish.id, grams: f.grams, value: f.value }); type = 'fish'; id = f.fish.id; }
      if (log) { const b = Math.floor(at / HOUR_MS); const last = log.find((r) => r.type === type && r.id === id && Math.floor(r.at / HOUR_MS) === b); if (last) { last.qty++; last.at = at; } else log.push({ type, id, qty: 1, at }); }
    }
    w.lastAt += n * every;
  }
  private async flushLog(key: string) {
    const rows = this.pendingLog.get(key); this.pendingLog.delete(key); if (!rows?.length) return;
    try { for (const r of rows) await this.pool.query('INSERT INTO employ_log (owner_key, item_type, item_id, qty, at) VALUES ($1,$2,$3,$4,$5)', [key, r.type, r.id, r.qty, r.at]); }
    catch (e) { console.error('[employ] log write failed:', (e as Error).message); }
  }
  /** What the workers picked up in the last 24 h, totalled per item (newest pick-up time per item). */
  async log(key: string, now = this.clock()): Promise<EmployLogItem[]> {
    const r = await this.pool.query('SELECT item_type, item_id, qty, at FROM employ_log WHERE owner_key = $1 AND at > $2', [key, now - DAY]);
    const m = new Map<string, EmployLogItem>();
    for (const x of r.rows as Array<{ item_type: string; item_id: string; qty: number | string; at: number | string }>) {
      const k = `${x.item_type}:${x.item_id}`; const e = m.get(k) ?? { type: x.item_type as 'ore' | 'fish', id: x.item_id, qty: 0, lastAt: 0 };
      e.qty += Number(x.qty); e.lastAt = Math.max(e.lastAt, Number(x.at)); m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty || b.lastAt - a.lastAt);
  }
  /** Bring one worker up to `now`: produce, then charge each new day's wage (or stop). */
  private async settle(name: string, w: W, now: number) {
    for (let guard = 0; guard < 4; guard++) {
      if (w.status !== 'working') return;
      this.produce(w, Math.min(now, w.paidUntil, w.seenAt + OFFLINE_CAP_MS), playerKey(name));
      if (now < w.paidUntil) { await this.save(this.pool, w); return; }
      if (w.seenAt + OFFLINE_CAP_MS <= w.paidUntil) { w.status = 'idle'; await this.save(this.pool, w); return; }
      const next = { ...w, paidUntil: w.paidUntil + DAY };
      try { await this.tx((cl) => this.save(cl, next).then(() => {}), { name, amount: -this.wagePrice(w.job), game: 'employ_wage', memo: `${w.job.label} daily wage` }); w.paidUntil = next.paidUntil; }
      catch (e) { if (!(e instanceof EmployError) || e.message !== 'Not enough chips.') throw e; w.status = 'unpaid'; await this.save(this.pool, w); return; }
    }
  }
  private async accountAge(key: string): Promise<number | null> {
    try { const r = await this.pool.query('SELECT created_at FROM players WHERE player_key = $1', [key]); const t = r.rows[0]?.created_at; if (!t) return null; const ms = new Date(t).getTime(); return Number.isFinite(ms) ? this.clock() - ms : null; }
    catch { return null; } // fail closed
  }
  private toView(w: W): WorkerView {
    const nextAt = w.status === 'working' ? Math.min(w.lastAt + w.job.everyMs, w.paidUntil, w.seenAt + OFFLINE_CAP_MS) : null;
    return { id: w.id, job: w.job.id, status: w.status, hiredAt: w.hiredAt, paidUntil: w.paidUntil, seenAt: w.seenAt, nextAt, box: w.box, boxValue: px(boxValue(w.box)), wage: this.wagePrice(w.job) };
  }
  /** Base cap + property bonus (owned buildings/landmarks; see shared/realEstate workerBonusOf). Fails to base if the table is missing. */
  async capOf(key: string, name?: string): Promise<{ max: number; base: number; bonus: number }> {
    let bonus = 0;
    try { const alt = (name ?? key).trim().toLowerCase(); const r = await this.pool.query('SELECT id FROM properties WHERE owner_key = $1 OR owner_key = $2', [key, alt]); bonus = workerBonusTotal((r.rows as Array<{ id: string }>).map((x) => x.id)); } catch { bonus = 0; }
    return { max: MAX_WORKERS + bonus, base: MAX_WORKERS, bonus };
  }
  private async canHire(key: string, n: number, max = MAX_WORKERS): Promise<string | undefined> {
    if (n >= max) return n > max ? `You have ${n} workers but your cap is ${max} — they keep working, but you can't hire more until you're under the cap.` : `You can employ at most ${max} workers. Own more property to raise the cap.`;
    const age = await this.accountAge(key); if (age === null || age < MIN_ACCOUNT_AGE_MS) return 'Accounts must be at least 24 hours old to hire workers.';
    return undefined;
  }
  async view(name: string | null): Promise<EmployView> {
    const now = this.clock();
    const jobs = JOBS.map((j) => ({ id: j.id, hire: this.hirePrice(j), wage: this.wagePrice(j), perDay: itemsPerDay(j), dayValue: px(Math.round(dayValue(j))) }));
    if (!name) return { workers: [], jobs, now, canHire: false, reason: 'Sign in to hire workers.', max: MAX_WORKERS, base: MAX_WORKERS, bonus: 0 };
    const key = playerKey(name);
    return this.lock(key, async () => {
      const ws = await this.rows(key); for (const w of ws) await this.settle(name, w, now);
      // Opening the office is a check-in: working workers keep going for another 8 h (same rule the old Collect had).
      for (const w of ws) if (w.status === 'working' && w.seenAt !== now) { if (now > w.seenAt + OFFLINE_CAP_MS) w.lastAt = now; w.seenAt = now; await this.save(this.pool, w); }
      let notes: string[] = []; try { notes = (await this.deliver(name, key, ws, now)).notes; } catch (e) { notes = [e instanceof EmployError ? e.message : 'Storage is offline — your workers are holding their haul until it is back.']; }
      await this.flushLog(key);
      const cap = await this.capOf(key, name); const reason = await this.canHire(key, ws.length, cap.max);
      return { workers: ws.map((w) => this.toView(w)), jobs, now, canHire: !reason, reason, max: cap.max, base: cap.base, bonus: cap.bonus, log: await this.log(key, now), notes };
    });
  }
  async hire(name: string, jobId: unknown) {
    const j = jobById(jobId); if (!j) throw new EmployError('Unknown job.');
    const key = playerKey(name);
    return this.lock(key, async () => {
      const now = this.clock(); const n = (await this.rows(key)).length;
      const cap = await this.capOf(key, name); const why = await this.canHire(key, n, cap.max); if (why) throw new EmployError(why);
      const id = randomUUID(); const cost = this.hirePrice(j) + this.wagePrice(j);
      await this.tx(async (cl) => {
        const c = Number((await cl.query('SELECT count(*) AS n FROM employ_workers WHERE owner_key = $1', [key])).rows[0]?.n ?? 0);
        if (c >= cap.max) throw new EmployError(`You can employ at most ${cap.max} workers.`);
        await cl.query('INSERT INTO employ_workers (id, owner_key, owner_name, job, hired_at, last_at, seen_at, paid_until, status, box) VALUES ($1,$2,$3,$4,$5,$5,$5,$6,$7,$8)', [id, key, name.trim(), j.id, now, now + DAY, 'working', '{}']);
      }, { name, amount: -cost, game: 'employ_hire', memo: `Hired ${j.label} (fee + first day's wage)` });
      return { id, charged: cost };
    });
  }
  /** Move the box into storage / cooler, reset the 8 h clock, and re-hire a stopped worker for a new day. */
  async collect(name: string, id?: unknown) {
    const key = playerKey(name);
    return this.lock(key, async () => {
      const now = this.clock(); const ws = (await this.rows(key)).filter((w) => id === undefined || w.id === id);
      if (id !== undefined && !ws.length) throw new EmployError('No such worker.');
      let ores = 0, fish = 0, charged = 0; const notes: string[] = [];
      for (const w of ws) await this.settle(name, w, now);
      const d = await this.deliver(name, key, ws, now); ores = d.ores; fish = d.fish; notes.push(...d.notes);
      for (const w of ws) {
        if (w.status === 'working') { if (now > w.seenAt + OFFLINE_CAP_MS) w.lastAt = now; w.seenAt = now; await this.save(this.pool, w); continue; }
        // Stopped (idle / unpaid): start a fresh paid day now.
        const next: W = { ...w, status: 'working', lastAt: now, seenAt: now, paidUntil: now + DAY };
        try { await this.tx((cl) => this.save(cl, next).then(() => {}), { name, amount: -this.wagePrice(w.job), game: 'employ_wage', memo: `${w.job.label} daily wage` }); Object.assign(w, next); charged += this.wagePrice(w.job); }
        catch (e) { if (!(e instanceof EmployError) || e.message !== 'Not enough chips.') throw e; w.seenAt = now; await this.save(this.pool, w); notes.push(`Not enough chips to pay ${w.job.label}'s wage — they stay off until you can.`); }
      }
      await this.flushLog(key);
      return { ores, fish, charged, notes };
    });
  }
  /** Auto-deposit: move every worker's haul into storage (ores → banked mine/factory storage, fish → cooler) as far
   * as it fits. Anything that doesn't fit stays in the worker's box and goes in on a later pass. Caller holds the lock. */
  private async deliver(name: string, key: string, ws: W[], now: number) {
    let ores = 0, fish = 0; const notes: string[] = [];
      // Ores → mine storage (one transaction for all miners).
      const oreItems = new Map<OreId, number>();
      for (const w of ws) for (const [o, q] of Object.entries(w.box.ores ?? {})) if (q) oreItems.set(o as OreId, (oreItems.get(o as OreId) ?? 0) + q);
      if (oreItems.size) {
        const sink = this.sink(name);
        // Only what fits: the rest stays with the miner and goes in on a later pass (never lost).
        const fit = new Map<OreId, number>(); for (const [o, q] of oreItems) { const n = Math.min(q, Math.max(0, Math.floor(sink.room?.(o) ?? Infinity))); if (n > 0) fit.set(o, n); }
        const items = [...fit];
        if (items.length) {
          const left = new Map(fit);
          const after = ws.map((w) => { const box = { ...w.box, ores: { ...(w.box.ores ?? {}) } }; for (const [o, q] of Object.entries(box.ores)) { const take = Math.min(q ?? 0, left.get(o as OreId) ?? 0); if (take) { left.set(o as OreId, (left.get(o as OreId) ?? 0) - take); const rest = (q ?? 0) - take; if (rest > 0) box.ores[o as OreId] = rest; else delete box.ores[o as OreId]; } } return { ...w, box }; });
          await this.tx(async (cl) => { await sink.write(cl, items); for (const a of after) await this.save(cl, a); });
          sink.after(items); ws.forEach((w, i) => { w.box.ores = after[i]!.box.ores; }); ores = items.reduce((a, [, q]) => a + q, 0);
        }
        if (ws.some((w) => Object.values(w.box.ores ?? {}).some((q) => q))) notes.push('Your storage is full for some ores — your miners are holding the rest until there is room.');
      }
      // Fish → cooler, as far as it has room (the rest waits in the box).
      if (ws.some((w) => w.box.fish?.length)) {
        await this.tx(async (cl) => {
          let free = COOLER_MAX - Number((await cl.query('SELECT count(*) AS n FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL', [key])).rows[0]?.n ?? 0);
          for (const w of ws) {
            if (!w.box.fish?.length) continue;
            const keep: NonNullable<WorkerBox['fish']> = [];
            for (const f of w.box.fish ?? []) {
              if (free <= 0) { keep.push(f); continue; }
              await cl.query('INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at, hired, loc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [randomUUID(), key, name.trim(), f.species, f.grams, f.value, now, true, fishingLoc('lake')]);
              free--; fish++;
            }
            w.box.fish = keep; await this.save(cl, w);
          }
        });
        if (ws.some((w) => w.box.fish?.length)) notes.push('Your cooler is full — the rest of the fish are waiting with your fisher.');
      }
    return { ores, fish, notes };
  }
  /** Background pass (every few minutes + once at boot): settle and auto-deposit for every employer. No check-in. */
  async sweep() {
    const r = await this.pool.query('SELECT DISTINCT owner_name, owner_key FROM employ_workers');
    for (const o of r.rows as Array<{ owner_name: string; owner_key: string }>) {
      try {
        await this.lock(o.owner_key, async () => { const now = this.clock(); const ws = await this.rows(o.owner_key); for (const w of ws) await this.settle(o.owner_name, w, now); await this.deliver(o.owner_name, o.owner_key, ws, now); await this.flushLog(o.owner_key); });
      } catch (e) { if (!(e instanceof EmployError)) console.error('[employ] sweep', o.owner_key, (e as Error).message); }
    }
    await this.pool.query('DELETE FROM employ_log WHERE at < $1', [this.clock() - 2 * DAY]).catch(() => {});
  }
  /** Fire: collects what it can first; no refund of fees or wages. */
  async fire(name: string, id: unknown) {
    const key = playerKey(name);
    const ws = await this.rows(key); const w = ws.find((x) => x.id === id); if (!w) throw new EmployError('No such worker.');
    let got = { ores: 0, fish: 0 }; try { got = await this.collect0(name, key, w.id); } catch { /* storage offline: fire anyway */ }
    return this.lock(key, async () => { await this.pool.query('DELETE FROM employ_workers WHERE id = $1 AND owner_key = $2', [id, key]); return got; });
  }
  /** Deliver one worker's box (what fits) without charging any wage — used when firing. */
  private async collect0(name: string, key: string, id: string) {
    return this.lock(key, async () => {
      const now = this.clock(); const w = (await this.rows(key)).find((x) => x.id === id); if (!w) return { ores: 0, fish: 0 };
      if (w.status === 'working') this.produce(w, Math.min(now, w.paidUntil, w.seenAt + OFFLINE_CAP_MS), key);
      await this.flushLog(key);
      let ores = 0, fish = 0;
      const sink = this.sink(name);
      const items = (Object.entries(w.box.ores ?? {}).filter(([, q]) => q) as Array<[OreId, number]>).map(([o, q]): [OreId, number] => [o, Math.min(q, Math.max(0, Math.floor(sink.room?.(o) ?? Infinity)))]).filter(([, q]) => q > 0);
      if (items.length) { await this.tx(async (cl) => { await sink.write(cl, items); await this.save(cl, { ...w, box: { ...w.box, ores: {} } }); }); sink.after(items); w.box.ores = {}; ores = items.reduce((a, [, q]) => a + q, 0); }
      if (w.box.fish?.length) await this.tx(async (cl) => {
        let free = COOLER_MAX - Number((await cl.query('SELECT count(*) AS n FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL', [key])).rows[0]?.n ?? 0);
        for (const f of w.box.fish ?? []) { if (free-- <= 0) break; await cl.query('INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at, hired, loc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [randomUUID(), key, name.trim(), f.species, f.grams, f.value, now, true, fishingLoc('lake')]); fish++; }
      });
      return { ores, fish };
    });
  }
}
export { boxCount };

let emp: Employment | null = null;
export const getEmployment = () => emp;
const SWEEP_MS = 5 * 60_000;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
/** Auto-deposit loop. The first pass (30 s after boot) also deposits any haul left over from the old Collect button. */
function startEmploySweep(e: Employment) {
  if (sweepTimer) clearInterval(sweepTimer);
  const run = () => { void e.sweep().catch((x) => console.error('[employ] sweep failed:', (x as Error).message)); };
  setTimeout(run, 30_000).unref?.(); sweepTimer = setInterval(run, SWEEP_MS); sweepTimer.unref?.();
}
export const setEmploymentForTest = (e: Employment | null) => { emp = e; };
export async function initEmployment(): Promise<void> {
  const url = databaseUrl(); if (!url) { setBootState('employ', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[employ] pool error:', e.message));
  await bootAttach('employ', async () => { try { const e = new Employment(pool); await e.init(); emp = e; console.log('[employ] ready'); startEmploySweep(e); return true; } catch (e) { console.error('[employ] init failed:', (e as Error).message); return false; } });
}
/** Public read: today's prices. */
export function employmentRouter() {
  const r = express.Router();
  r.get('/api/employment', (_req, res) => {
    res.json({ ok: true, live: !!emp, max: MAX_WORKERS, jobs: JOBS.map((j) => ({ id: j.id, label: j.label, hire: px(baseHire(j)), wage: px(baseWage(j)), perDay: itemsPerDay(j), dayValue: px(Math.round(dayValue(j))) })) });
  });
  return r;
}
type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerEmployment(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf(); if (!n) throw new EmployError('Sign in to hire workers.'); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>, e: Employment) => Promise<object>) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    try { if (!emp) throw new EmployError('The Employment Office is closed right now.'); const r = await fn(b, emp); ack?.({ ok: true, ...r, view: await emp.view(nameOf()) }); }
    catch (e) { let view: EmployView | undefined; try { view = emp ? await emp.view(nameOf()) : undefined; } catch { /* */ } ack?.({ ok: false, error: e instanceof EmployError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.', view }); if (!(e instanceof EmployError)) console.error('[employ]', e); }
  });
  on('employ_view', async () => ({}));
  on('employ_hire', async (b, e) => e.hire(need(), b.job));
  on('employ_collect', async (b, e) => e.collect(need(), typeof b.id === 'string' ? b.id : undefined));
  on('employ_fire', async (b, e) => e.fire(need(), b.id));
}

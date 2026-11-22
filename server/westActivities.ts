/**
 * West Chud things to do (shared/westActivities.ts has the rules and the numbers):
 *  - Ironworks Steel Mill: timed furnace batches. Starting a batch takes the inputs out of banked storage, pays the
 *    furnace fee (and the crew wage) and records the batch in westchud_mill_jobs, all in ONE Mines store transaction.
 *    Collecting credits the outputs and marks the batch collected in one transaction too. Additive table only.
 *  - Fishing pier, campground, farmers' market, U-Pick and rodeo: every payout is one keyed ledger row (tx_key is UNIQUE
 *    in wallet_transactions), so the daily caps survive restarts without a table. Draws are an HMAC of the ledger key
 *    under a server-only secret. The market sale (crops out, chips in) commits in one Mines store transaction.
 * Everything needs the player in Chud City (not travelling elsewhere), not jailed and not disabled.
 */
import pg from 'pg';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { isDisabledName } from '../shared/disabled.js';
import { GOODS, type ItemType } from '../shared/mines.js';
import {
  CAMP_MS, CAMP_PAY, FISH_COOLDOWN_MS, FISH_PER_DAY, MARKET_MAX_UNITS, MARKET_SALES_PER_DAY, MILL_DAILY_POURS, MILL_FURNACES, MILL_GAME, MILL_MAX_BATCH,
  MILL_RECIPES, PICK_COOLDOWN_MS, PICK_PER_DAY, RODEO_COOLDOWN_MS, RODEO_PER_DAY, fishOf, isMarketCrop, marketPay, millBatchMs, millCost, millRecipe,
  pickFindOf, rodeoOf, westDayKey, type Find, type MillRecipeId, type MillView, type WestActState,
} from '../shared/westActivities.js';

export class WestActivityError extends Error {}
export const WEST_FISH_GAME = 'westchud_fish';
export const WEST_CAMP_GAME = 'westchud_camp';
export const WEST_MARKET_GAME = 'westchud_market';
export const WEST_PICK_GAME = 'westchud_upick';
export const WEST_RODEO_GAME = 'westchud_rodeo';
export const WEST_MILL_MIGRATION = `CREATE TABLE IF NOT EXISTS westchud_mill_jobs (
  id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, recipe TEXT NOT NULL, qty INTEGER NOT NULL, crew BOOLEAN NOT NULL DEFAULT false,
  start_at BIGINT NOT NULL, done_at BIGINT NOT NULL, day TEXT NOT NULL, collected_at BIGINT);
CREATE INDEX IF NOT EXISTS westchud_mill_jobs_open ON westchud_mill_jobs (player_key) WHERE collected_at IS NULL;`;

export type Stmt = { sql: string; args: unknown[] };
export type Atomic = { stmts: Stmt[]; after: Promise<unknown>; bind: (p: Promise<unknown>) => void; revert: () => void; confirm: () => void };
export interface WestBank {
  ready: boolean; hasKey(key: string): boolean; account(name: string): { chips: number };
  transferConfirmed(name: string, amount: number, opts: { key: string; game: string; memo?: string }): Promise<boolean>;
  transferAtomic(moves: Array<{ name: string; amount: number; key: string; game: string; memo?: string }>): Atomic;
}
type Delta = { type: ItemType; id: string; delta: number };
export interface WestMines {
  offline: boolean; store?: unknown;
  stackQty(account: string, type: ItemType, id: string): number;
  adjustStacks(account: string, deltas: Delta[], extra?: Stmt[], fallback?: (rows: Stmt[]) => void, opts?: { onUnknown?: (e: Error) => void; onLate?: (committed: boolean) => void; committed?: () => Promise<boolean>; after?: Promise<unknown>; bind?: (p: Promise<unknown>) => void; onFail?: (e: Error) => void }): boolean;
}
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
export interface WestDeps {
  bank: () => WestBank;
  mines: () => WestMines;
  inCity: (name: string) => boolean;
  jailed: (name: string) => boolean;
  px: (n: number) => number;
  clock?: () => number;
  salt?: string;
  /** Mill table reads (committed checks). Null: memory only (dev/tests). */
  db?: Q | null;
}

const keyOf = (n: string) => n.replace(/\s+/g, ' ').trim().toLowerCase();
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const fmt = (n: number) => n.toLocaleString('en-US');
let defaultSalt: string | null = null;
const saltOf = (d: WestDeps) => d.salt ?? (defaultSalt ??= createHash('sha256').update(`west-activities:${process.env.DATABASE_URL || randomBytes(32).toString('hex')}`).digest('hex'));
const draw = (d: WestDeps, key: string) => createHmac('sha256', saltOf(d)).update(key).digest().readUInt32BE(0) / 4294967296;
const nowOf = (d: WestDeps) => (d.clock ?? Date.now)();

const lastFish = new Map<string, number>();
const lastPick = new Map<string, number>();
const lastRide = new Map<string, number>();
const camps = new Map<string, number>();
const busy = new Set<string>();

function guard(name: string, d: WestDeps) {
  if (!d.inCity(name)) throw new WestActivityError('Be in Chud City for that. Travel back first.');
  if (d.jailed(name) || isDisabledName(name)) throw new WestActivityError('Not available right now.');
  const bank = d.bank(); if (!bank.ready) throw new WestActivityError('Wallet temporarily unavailable.');
  return bank;
}
async function locked<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const k = keyOf(name); if (busy.has(k)) throw new WestActivityError('One thing at a time.');
  busy.add(k); try { return await fn(); } finally { busy.delete(k); }
}
const usedOf = (bank: WestBank, kind: Parameters<typeof westDayKey>[0], p: string, day: string, max: number) => { let n = 0; for (let i = 1; i <= max; i++) if (bank.hasKey(westDayKey(kind, p, day, i))) n++; return n; };
const nextSlot = (bank: WestBank, kind: Parameters<typeof westDayKey>[0], p: string, day: string, max: number) => { let n = 1; while (n <= max && bank.hasKey(westDayKey(kind, p, day, n))) n++; return n; };

/* ---------------- one Mines store transaction: stack deltas + extra rows (+ an optional atomic chip move) ---------------- */
type Outcome = 'ok' | 'short' | 'failed';
export async function commitPack(m: WestMines, account: string, deltas: Delta[], extra: Stmt[], w: Atomic | null, committed?: () => Promise<boolean>): Promise<Outcome> {
  let failed = false; let unknown = false; let late: boolean | null = null; let memOnly = false; let done: Promise<unknown> = Promise.resolve();
  const ok = m.adjustStacks(account, deltas, [...extra, ...(w?.stmts ?? [])], () => { memOnly = true; }, {
    after: w?.after,
    bind: (p) => { done = p; w?.bind(p); },
    onFail: () => { failed = true; w?.revert(); },
    onUnknown: () => { unknown = true; },
    onLate: (c) => { late = c; },
    committed,
  });
  if (!ok) { w?.revert(); return 'short'; }
  if (memOnly) { w?.bind(Promise.resolve()); return 'ok'; }
  await done;
  if (unknown) return late ? 'ok' : 'failed';
  return failed ? 'failed' : 'ok';
}
export const storeCommitted = (m: WestMines, key: string) => { const s = m.store as { txCommitted?: (k: string) => Promise<boolean> } | null | undefined; return s?.txCommitted ? () => s.txCommitted!(key) : undefined; };

/* ---------------- Steel Mill ---------------- */
export interface MillJob { id: string; player: string; name: string; recipe: MillRecipeId; qty: number; crew: boolean; startAt: number; doneAt: number; day: string; collected: boolean }
const jobs = new Map<string, MillJob[]>();
const jobsOf = (p: string) => jobs.get(p) ?? [];
const pruneJobs = (p: string, day: string) => { const a = jobsOf(p).filter((j) => !j.collected || j.day >= day); if (a.length) jobs.set(p, a); else jobs.delete(p); return a; };
/** Load open batches and today's history (for the daily pour cap) after a restart. */
export async function loadMillJobs(db: Q, now = Date.now()): Promise<number> {
  const r = await db.query('SELECT id, player_key, name, recipe, qty, crew, start_at, done_at, day, collected_at FROM westchud_mill_jobs WHERE collected_at IS NULL OR day >= $1', [utcDay(now)]);
  jobs.clear();
  for (const row of r.rows) {
    if (!millRecipe(row.recipe)) continue;
    const j: MillJob = { id: String(row.id), player: String(row.player_key), name: String(row.name), recipe: row.recipe as MillRecipeId, qty: Number(row.qty), crew: !!row.crew, startAt: Number(row.start_at), doneAt: Number(row.done_at), day: String(row.day), collected: row.collected_at != null };
    jobs.set(j.player, [...jobsOf(j.player), j]);
  }
  return r.rows.length;
}

function millView(name: string | null, d: WestDeps): MillView {
  const now = nowOf(d); const day = utcDay(now); const p = name ? keyOf(name) : ''; const all = name ? pruneJobs(p, day) : [];
  const m = d.mines();
  const canPour = (r: (typeof MILL_RECIPES)[number]) => { if (!name || m.offline) return 0; let n = Infinity; for (const it of r.inputs) n = Math.min(n, Math.floor(m.stackQty(name, it.type, it.id) / it.qty)); return Number.isFinite(n) ? n : 0; };
  return {
    furnaces: MILL_FURNACES, maxBatch: MILL_MAX_BATCH, dailyPours: MILL_DAILY_POURS,
    poursToday: all.filter((j) => j.day === day).reduce((a, j) => a + j.qty, 0),
    jobs: all.filter((j) => !j.collected).map((j) => ({ id: j.id, recipe: j.recipe, qty: j.qty, crew: j.crew, startAt: j.startAt, doneAt: j.doneAt, ready: j.doneAt <= now })),
    recipes: MILL_RECIPES.map((r) => ({ id: r.id, fee: d.px(r.fee), wage: millCost(r, 1, true, d.px) - millCost(r, 1, false, d.px), canPour: canPour(r) })),
  };
}

export async function millStart(name: string, b: { recipe?: unknown; qty?: unknown; crew?: unknown }, d: WestDeps): Promise<{ job: MillView['jobs'][number]; paid: number }> {
  const r = millRecipe(b.recipe); if (!r) throw new WestActivityError('Pick a recipe.');
  const qty = Number(b.qty); if (!Number.isInteger(qty) || qty < 1 || qty > MILL_MAX_BATCH) throw new WestActivityError(`A batch is 1 to ${MILL_MAX_BATCH} pours.`);
  const crew = b.crew === true;
  const bank = guard(name, d); const m = d.mines(); if (m.offline) throw new WestActivityError('Storage is reconnecting. Your goods are safe, try again in a minute.');
  return locked(name, async () => {
    const now = nowOf(d); const day = utcDay(now); const p = keyOf(name); const all = pruneJobs(p, day);
    if (all.filter((j) => !j.collected).length >= MILL_FURNACES) throw new WestActivityError(`Both furnaces are busy. Collect a finished batch first.`);
    const used = all.filter((j) => j.day === day).reduce((a, j) => a + j.qty, 0);
    if (used + qty > MILL_DAILY_POURS) throw new WestActivityError(`The mill runs ${MILL_DAILY_POURS} pours a day per player: ${Math.max(0, MILL_DAILY_POURS - used)} left today. Resets 00:00 UTC.`);
    for (const it of r.inputs) { const have = m.stackQty(name, it.type as ItemType, it.id); if (have < it.qty * qty) throw new WestActivityError(`Not enough ${GOODS[it.id]?.name ?? it.id}: ${fmt(it.qty * qty)} needed, you have ${fmt(have)} in storage.`); }
    const cost = millCost(r, qty, crew, d.px); const id = randomUUID(); const key = `${MILL_GAME}:${id}`;
    let w: Atomic;
    try { w = bank.transferAtomic([{ name, amount: -cost, key, game: MILL_GAME, memo: `🏭 Steel Mill · ${qty}x ${r.label}${crew ? ' · shift crew' : ''}` }]); }
    catch (e) { throw new WestActivityError((e as Error).message === 'Not enough chips.' ? `Not enough chips: the furnace${crew ? ' and crew' : ''} cost ${fmt(cost)}.` : 'Wallet temporarily unavailable.'); }
    const job: MillJob = { id, player: p, name: name.trim(), recipe: r.id, qty, crew, startAt: now, doneAt: now + millBatchMs(r, qty, crew), day, collected: false };
    const ins: Stmt = { sql: 'INSERT INTO westchud_mill_jobs (id, player_key, name, recipe, qty, crew, start_at, done_at, day) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING', args: [id, p, job.name, r.id, qty, crew, job.startAt, job.doneAt, day] };
    const out = await commitPack(m, name, r.inputs.map((it) => ({ type: it.type as ItemType, id: it.id, delta: -it.qty * qty })), [ins], w, storeCommitted(m, key));
    if (out === 'short') throw new WestActivityError('Your storage changed. Nothing was charged; try again.');
    if (out === 'failed') throw new WestActivityError('The furnace did not light. Nothing was charged or taken.');
    jobs.set(p, [...jobsOf(p), job]);
    return { job: { id, recipe: r.id, qty, crew, startAt: job.startAt, doneAt: job.doneAt, ready: false }, paid: cost };
  });
}

export async function millCollect(name: string, d: WestDeps): Promise<{ collected: Array<{ type: string; id: string; qty: number }>; batches: number }> {
  guard(name, d); const m = d.mines(); if (m.offline) throw new WestActivityError('Storage is reconnecting. Your goods are safe, try again in a minute.');
  return locked(name, async () => {
    const now = nowOf(d); const p = keyOf(name); const ready = jobsOf(p).filter((j) => !j.collected && j.doneAt <= now);
    if (!ready.length) throw new WestActivityError('Nothing is ready yet.');
    const sum = new Map<string, Delta>();
    for (const j of ready) { const r = millRecipe(j.recipe)!; const k = `${r.output.type}:${r.output.id}`; const c = sum.get(k); if (c) c.delta += r.output.qty * j.qty; else sum.set(k, { type: r.output.type as ItemType, id: r.output.id, delta: r.output.qty * j.qty }); }
    const ids = ready.map((j) => j.id);
    for (const j of ready) j.collected = true; // reserved now: no double collect while this commits
    const upd: Stmt = { sql: 'UPDATE westchud_mill_jobs SET collected_at = $2 WHERE id = ANY($1::text[]) AND collected_at IS NULL', args: [ids, now] };
    const db = d.db ?? null;
    const committed = db ? async () => (await db.query('SELECT 1 FROM westchud_mill_jobs WHERE id = $1 AND collected_at IS NOT NULL', [ids[0]])).rows.length > 0 : undefined;
    const out = await commitPack(m, name, [...sum.values()], [upd], null, committed);
    if (out !== 'ok') { for (const j of ready) j.collected = false; throw new WestActivityError('That pickup did not go through. Your batches are still waiting at the mill.'); }
    return { collected: [...sum.values()].map((s) => ({ type: s.type, id: s.id, qty: s.delta })), batches: ready.length };
  });
}

/* ---------------- day activities ---------------- */
const findsOf = (d: WestDeps, bank: WestBank, kind: 'fish' | 'pick', p: string, day: string, max: number, of: (u: number) => Find) => {
  const out: Array<{ id: string; label: string; emoji: string; pay: number }> = [];
  for (let n = 1; n <= max; n++) { const k = westDayKey(kind, p, day, n); if (bank.hasKey(k)) { const f = of(draw(d, k)); out.push({ id: f.id, label: f.label, emoji: f.emoji, pay: d.px(f.pay) }); } }
  return out;
};
export function westActState(name: string | null, d: WestDeps): WestActState {
  const now = nowOf(d); const day = utcDay(now); const bank = d.bank(); const p = name ? keyOf(name) : ''; const m = d.mines();
  const rides: Array<{ secs: number; pay: number }> = [];
  if (name) for (let n = 1; n <= RODEO_PER_DAY; n++) { const k = westDayKey('rodeo', p, day, n); if (bank.hasKey(k)) { const r = rodeoOf(draw(d, k)); rides.push({ secs: r.secs, pay: d.px(r.pay) }); } }
  const camp = camps.get(p);
  return {
    day, here: !!name && d.inCity(name),
    fish: { used: name ? usedOf(bank, 'fish', p, day, FISH_PER_DAY) : 0, max: FISH_PER_DAY, catches: name ? findsOf(d, bank, 'fish', p, day, FISH_PER_DAY, fishOf) : [], readyIn: Math.max(0, (lastFish.get(p) ?? 0) + FISH_COOLDOWN_MS - now) },
    camp: { claimed: !!name && bank.hasKey(westDayKey('camp', p, day, 1)), pay: d.px(CAMP_PAY), restingFor: camp != null ? now - camp : null, ms: CAMP_MS },
    market: { used: name ? usedOf(bank, 'mkt', p, day, MARKET_SALES_PER_DAY) : 0, max: MARKET_SALES_PER_DAY, maxUnits: MARKET_MAX_UNITS,
      crops: name && !m.offline ? Object.values(GOODS).filter((g) => isMarketCrop(g.id)).map((g) => ({ id: g.id, name: g.name, have: m.stackQty(name, 'good', g.id), each: marketPay(g.price, 1, d.px) })).filter((c) => c.have > 0) : [] },
    pick: { used: name ? usedOf(bank, 'pick', p, day, PICK_PER_DAY) : 0, max: PICK_PER_DAY, finds: name ? findsOf(d, bank, 'pick', p, day, PICK_PER_DAY, pickFindOf) : [], readyIn: Math.max(0, (lastPick.get(p) ?? 0) + PICK_COOLDOWN_MS - now) },
    rodeo: { used: rides.length, max: RODEO_PER_DAY, rides, readyIn: Math.max(0, (lastRide.get(p) ?? 0) + RODEO_COOLDOWN_MS - now) },
    mill: millView(name, d),
  };
}

async function drawPay(name: string, d: WestDeps, o: { kind: 'fish' | 'pick' | 'rodeo'; max: number; cooldown: number; last: Map<string, number>; game: string; waitMsg: string; doneMsg: string; memo: (n: number, key: string) => { pay: number; memo: string } }) {
  const bank = guard(name, d);
  return locked(name, async () => {
    const now = nowOf(d); const day = utcDay(now); const p = keyOf(name);
    const wait = (o.last.get(p) ?? 0) + o.cooldown - now;
    if (wait > 0) throw new WestActivityError(`${o.waitMsg} ${Math.ceil(wait / 1000)}s.`);
    const n = nextSlot(bank, o.kind, p, day, o.max);
    if (n > o.max) throw new WestActivityError(o.doneMsg);
    const key = westDayKey(o.kind, p, day, n); const { pay, memo } = o.memo(n, key); const paid = d.px(pay);
    if (!(await bank.transferConfirmed(name, paid, { key, game: o.game, memo }))) throw new WestActivityError('That did not go through. Nothing was paid.');
    o.last.set(p, now);
    return { key, n, paid, left: o.max - n, chips: bank.account(name).chips };
  });
}
export async function castLine(name: string, d: WestDeps) {
  let f: Find | null = null;
  const r = await drawPay(name, d, { kind: 'fish', max: FISH_PER_DAY, cooldown: FISH_COOLDOWN_MS, last: lastFish, game: WEST_FISH_GAME, waitMsg: 'Let the lake settle: next cast in', doneMsg: `That's all ${FISH_PER_DAY} casts for today. The pier reopens at 00:00 UTC.`,
    memo: (n, key) => { f = fishOf(draw(d, key)); return { pay: f.pay, memo: `🎣 Cedar Lake pier · ${f.label} · cast ${n}/${FISH_PER_DAY}` }; } });
  const c = f as unknown as Find;
  return { catch: { id: c.id, label: c.label, emoji: c.emoji, paid: r.paid }, left: r.left, chips: r.chips };
}
export async function pickBasket(name: string, d: WestDeps) {
  let f: Find | null = null;
  const r = await drawPay(name, d, { kind: 'pick', max: PICK_PER_DAY, cooldown: PICK_COOLDOWN_MS, last: lastPick, game: WEST_PICK_GAME, waitMsg: 'Catch your breath: next basket in', doneMsg: `That's all ${PICK_PER_DAY} baskets for today. The rows reopen at 00:00 UTC.`,
    memo: (n, key) => { f = pickFindOf(draw(d, key)); return { pay: f.pay, memo: `🍇 Millbrook U-Pick · ${f.label} · basket ${n}/${PICK_PER_DAY}` }; } });
  const c = f as unknown as Find;
  return { find: { id: c.id, label: c.label, emoji: c.emoji, paid: r.paid }, left: r.left, chips: r.chips };
}
export async function rideBull(name: string, d: WestDeps) {
  let secs = 0;
  const r = await drawPay(name, d, { kind: 'rodeo', max: RODEO_PER_DAY, cooldown: RODEO_COOLDOWN_MS, last: lastRide, game: WEST_RODEO_GAME, waitMsg: 'The bull needs a breather: next ride in', doneMsg: `That's all ${RODEO_PER_DAY} rides for today. The chutes reopen at 00:00 UTC.`,
    memo: (n, key) => { const t = rodeoOf(draw(d, key)); secs = t.secs; return { pay: t.pay, memo: `🤠 Stadium rodeo · ${t.secs}s on the bull · ride ${n}/${RODEO_PER_DAY}` }; } });
  return { secs, paid: r.paid, left: r.left, chips: r.chips };
}

export function startCamp(name: string, d: WestDeps): { ms: number; bonus: boolean } {
  const bank = guard(name, d); const now = nowOf(d); const p = keyOf(name);
  camps.set(p, now);
  return { ms: CAMP_MS, bonus: !bank.hasKey(westDayKey('camp', p, utcDay(now), 1)) };
}
export async function claimCamp(name: string, d: WestDeps): Promise<{ paid: number; chips: number }> {
  const bank = guard(name, d);
  return locked(name, async () => {
    const now = nowOf(d); const p = keyOf(name); const t = camps.get(p);
    if (t == null) throw new WestActivityError('Sit down by the campfire first.');
    if (now - t < CAMP_MS - 3_000) throw new WestActivityError(`Still resting: ${Math.ceil((CAMP_MS - (now - t)) / 1000)}s to go.`);
    camps.delete(p);
    if (now - t > 30 * 60_000) throw new WestActivityError('The fire burned out. Sit down again.');
    const key = westDayKey('camp', p, utcDay(now), 1);
    if (bank.hasKey(key)) return { paid: 0, chips: bank.account(name).chips };
    const paid = d.px(CAMP_PAY);
    if (!(await bank.transferConfirmed(name, paid, { key, game: WEST_CAMP_GAME, memo: '🏕️ Cedar Lake campground · well rested' }))) throw new WestActivityError('The bonus did not go through.');
    return { paid, chips: bank.account(name).chips };
  });
}

export async function marketSell(name: string, b: { id?: unknown; qty?: unknown }, d: WestDeps): Promise<{ id: string; qty: number; paid: number; left: number; chips: number }> {
  if (!isMarketCrop(b.id)) throw new WestActivityError('The market stalls buy field and orchard crops.');
  const qty = Number(b.qty); if (!Number.isInteger(qty) || qty < 1 || qty > MARKET_MAX_UNITS) throw new WestActivityError(`Sell 1 to ${MARKET_MAX_UNITS} at a time.`);
  const bank = guard(name, d); const m = d.mines(); if (m.offline) throw new WestActivityError('Storage is reconnecting. Your goods are safe, try again in a minute.');
  const id = b.id; const g = GOODS[id]!;
  return locked(name, async () => {
    const day = utcDay(nowOf(d)); const p = keyOf(name);
    const n = nextSlot(bank, 'mkt', p, day, MARKET_SALES_PER_DAY);
    if (n > MARKET_SALES_PER_DAY) throw new WestActivityError(`That's all ${MARKET_SALES_PER_DAY} market sales for today. The stalls reopen at 00:00 UTC.`);
    const have = m.stackQty(name, 'good', id); if (have < qty) throw new WestActivityError(`You have ${fmt(have)} ${g.name} in storage.`);
    const paid = marketPay(g.price, qty, d.px); const key = westDayKey('mkt', p, day, n);
    let w: Atomic;
    try { w = bank.transferAtomic([{ name, amount: paid, key, game: WEST_MARKET_GAME, memo: `🧺 Cedar Crossing market · ${qty}x ${g.name}` }]); }
    catch { throw new WestActivityError('Wallet temporarily unavailable.'); }
    const out = await commitPack(m, name, [{ type: 'good', id, delta: -qty }], [], w, storeCommitted(m, key));
    if (out === 'short') throw new WestActivityError('Your storage changed. Nothing was sold.');
    if (out === 'failed') throw new WestActivityError('That sale did not go through. Your crops are still in storage.');
    return { id, qty, paid, left: MARKET_SALES_PER_DAY - n, chips: bank.account(name).chips };
  });
}

/** Test hook: forget in-memory cooldowns, rests and mill batches. */
export function resetWestActivityMemory() { lastFish.clear(); lastPick.clear(); lastRide.clear(); camps.clear(); busy.clear(); jobs.clear(); }

/* ---------------- wiring ---------------- */
let pool: (Q & { end?: () => Promise<void> }) | null = null;
let liveDeps: (() => WestDeps) | null = null;
export function setWestDeps(f: () => WestDeps) { liveDeps = f; }
export const westDb = () => pool;
/** Creates the mill table (additive) and loads open batches. No DATABASE_URL: memory only. */
export async function initWestActivities(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const p = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  p.on('error', (e) => console.error('[westchud] pool error:', e.message));
  try { await p.query(WEST_MILL_MIGRATION); const n = await loadMillJobs(p as unknown as Q); pool = p as unknown as Q; console.log(`[westchud] mill ready (${n} batches)`); }
  catch (e) { console.error('[westchud] init failed:', (e as Error).message); }
}
type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerWestActivities(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const known = (e: unknown) => e instanceof WestActivityError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message);
  const on = (ev: string, fn: (b: Record<string, unknown>, name: string | null, d: WestDeps) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    if (typeof payload === 'function') { ack = payload as Ack; payload = {}; }
    try {
      if (!liveDeps) throw new WestActivityError('West Chud activities are offline right now.');
      const d = liveDeps(); const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const result = await fn(b, nameOf(), d); ack?.({ ok: true, result, state: westActState(nameOf(), d) });
    } catch (e) {
      if (!known(e)) console.error('[westchud]', e);
      let state: WestActState | undefined; try { if (liveDeps) state = westActState(nameOf(), liveDeps()); } catch { /* offline */ }
      ack?.({ ok: false, error: known(e) ? (e as Error).message : 'Something went wrong.', state });
    }
  });
  const need = (n: string | null) => { if (!n) throw new WestActivityError('Sign in first.'); return n; };
  on('wc_state', () => null);
  on('wc_mill_start', (b, n, d) => millStart(need(n), b, d));
  on('wc_mill_collect', (_b, n, d) => millCollect(need(n), d));
  on('wc_fish', (_b, n, d) => castLine(need(n), d));
  on('wc_camp_start', (_b, n, d) => startCamp(need(n), d));
  on('wc_camp_claim', (_b, n, d) => claimCamp(need(n), d));
  on('wc_market_sell', (b, n, d) => marketSell(need(n), b, d));
  on('wc_pick', (_b, n, d) => pickBasket(need(n), d));
  on('wc_rodeo', (_b, n, d) => rideBull(need(n), d));
}

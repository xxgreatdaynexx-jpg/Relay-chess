/**
 * West Chud ranches (shared/westRanch.ts has the rules). State is one JSON row per ranch (westchud_ranches, additive
 * table). Every change commits in ONE Mines store transaction with what it pays or produces: buying or selling animals
 * (chips + state), collecting (pantry food stacks + wool chips + state) and hiring the ranch hand (chips + state).
 * Only the deed's current owner can use a ranch; a new owner starts with an empty pasture. In Chud City only, not jailed or disabled.
 */
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { isDisabledName } from '../shared/disabled.js';
import {
  ANIMALS, ANIMAL_SELL_BACK, HAND_MAX_DAYS, RANCH_BUY_MAX, RANCH_MIGRATION, animalById, barnCap, emptyHerd, handWagePerDay, isRanchId, newRanch, ranchById,
  ranchCapacity, settle, unitsUsed, type AnimalId, type Herd, type RanchState, type RanchView,
} from '../shared/westRanch.js';
import { commitPack, storeCommitted, type Atomic, type Stmt, type WestBank, type WestMines } from './westActivities.js';

export class RanchError extends Error {}
export const RANCH_GAME = 'westchud_ranch';
export const WOOL_GAME = 'westchud_wool';
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
export interface RanchDeps {
  bank: () => WestBank; mines: () => WestMines; inCity: (name: string) => boolean; jailed: (name: string) => boolean; px: (n: number) => number;
  ownerOf: (id: string) => Promise<{ key: string; name: string } | null>; clock?: () => number;
}
const keyOf = (n: string) => n.replace(/\s+/g, ' ').trim().toLowerCase();
const fmt = (n: number) => n.toLocaleString('en-US');
const nowOf = (d: RanchDeps) => (d.clock ?? Date.now)();
type Row = { owner: string; name: string; s: RanchState };
const ranches = new Map<string, Row>();
const busy = new Set<string>();
export function resetRanchMemory() { ranches.clear(); busy.clear(); }

const clean = (s: Partial<RanchState> | null | undefined, now: number): RanchState => {
  const b = newRanch(now); if (!s || typeof s !== 'object') return b;
  for (const a of ANIMALS) { b.herd[a.id] = Math.max(0, Math.floor(Number(s.herd?.[a.id]) || 0)); b.barn[a.id] = Math.max(0, Math.floor(Number(s.barn?.[a.id]) || 0)); b.t[a.id] = Number(s.t?.[a.id]) || now; }
  b.handUntil = Number(s.handUntil) || 0; return b;
};
export async function loadRanches(db: Q, now = Date.now()): Promise<number> {
  const r = await db.query('SELECT ranch_id, player_key, name, state FROM westchud_ranches'); ranches.clear();
  for (const row of r.rows) { try { ranches.set(String(row.ranch_id), { owner: String(row.player_key), name: String(row.name), s: clean(JSON.parse(String(row.state)), now) }); } catch { /* skip a bad row */ } }
  return r.rows.length;
}
const upsert = (id: string, owner: string, name: string, s: RanchState, now: number): Stmt => ({
  sql: 'INSERT INTO westchud_ranches (ranch_id, player_key, name, state, updated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (ranch_id) DO UPDATE SET player_key = EXCLUDED.player_key, name = EXCLUDED.name, state = EXCLUDED.state, updated_at = EXCLUDED.updated_at',
  args: [id, owner, name, JSON.stringify(s), now] });

async function own(name: string, id: unknown, d: RanchDeps): Promise<{ id: string; p: string; row: Row }> {
  if (!isRanchId(id)) throw new RanchError('Pick a ranch.');
  const o = await d.ownerOf(id); const p = keyOf(name);
  if (!o || o.key !== p) throw new RanchError('Buy this ranch\'s deed first.');
  let row = ranches.get(id);
  if (!row || row.owner !== p) row = { owner: p, name: name.trim(), s: newRanch(nowOf(d)) }; // new owner: empty pasture
  return { id, p, row };
}
function guard(name: string, d: RanchDeps) {
  if (!d.inCity(name)) throw new RanchError('Be in Chud City for that. Travel back first.');
  if (d.jailed(name) || isDisabledName(name)) throw new RanchError('Not available right now.');
  const bank = d.bank(); if (!bank.ready) throw new RanchError('Wallet temporarily unavailable.');
  const m = d.mines(); if (m.offline) throw new RanchError('Storage is reconnecting. Your goods are safe, try again in a minute.');
  return { bank, m };
}
async function locked<T>(id: string, fn: () => Promise<T>): Promise<T> { if (busy.has(id)) throw new RanchError('One thing at a time.'); busy.add(id); try { return await fn(); } finally { busy.delete(id); } }
const clone = (s: RanchState): RanchState => JSON.parse(JSON.stringify(s));

export async function ranchView(name: string | null, id: unknown, d: RanchDeps): Promise<RanchView> {
  const r = ranchById(id); if (!r) throw new RanchError('Pick a ranch.');
  const now = nowOf(d); const o = await d.ownerOf(r.id); const mine = !!name && !!o && o.key === keyOf(name);
  const row = ranches.get(r.id); const s = mine && row && row.owner === keyOf(name!) ? settle(clone(row.s), now) : newRanch(now);
  const cap = emptyHerd(); for (const a of ANIMALS) cap[a.id] = barnCap(s, a, now);
  return { id: r.id, label: r.label, tiles: r.tiles, capacity: ranchCapacity(r), used: unitsUsed(s.herd), owner: mine, here: !!name && d.inCity(name),
    herd: s.herd, barn: s.barn, cap, handUntil: s.handUntil, handWage: d.px(handWagePerDay(s.herd)),
    animals: ANIMALS.map((a) => ({ id: a.id, price: d.px(a.price), sell: Math.floor(d.px(a.price) * ANIMAL_SELL_BACK), product: d.px(a.product.base) })) };
}

/** Commit a new state (+ items + chips) in one transaction; memory changes only on success. */
async function commit(d: RanchDeps, m: WestMines, name: string, id: string, p: string, s: RanchState, deltas: Array<{ type: 'food'; id: string; delta: number }>, w: Atomic | null, key: string | null) {
  const now = nowOf(d);
  const out = await commitPack(m, name, deltas, [upsert(id, p, name.trim(), s, now)], w, key ? storeCommitted(m, key) : undefined);
  if (out !== 'ok') throw new RanchError('That did not go through. Nothing changed.');
  ranches.set(id, { owner: p, name: name.trim(), s });
}

export async function buyAnimals(name: string, b: { id?: unknown; animal?: unknown; n?: unknown }, d: RanchDeps) {
  const a = animalById(b.animal); if (!a) throw new RanchError('Pick an animal.');
  const n = Number(b.n); if (!Number.isInteger(n) || n < 1 || n > RANCH_BUY_MAX) throw new RanchError(`Buy 1 to ${RANCH_BUY_MAX} at a time.`);
  const { bank, m } = guard(name, d); const { id, p, row } = await own(name, b.id, d); const r = ranchById(id)!;
  return locked(id, async () => {
    const now = nowOf(d); const s = settle(clone(row.s), now);
    if (unitsUsed(s.herd) + a.units * n > ranchCapacity(r)) throw new RanchError(`Not enough pasture: ${ranchCapacity(r) - unitsUsed(s.herd)} room left, ${a.label.toLowerCase()}s need ${a.units} each.`);
    if ((s.herd[a.id] ?? 0) === 0) s.t[a.id] = now;
    s.herd[a.id] = (s.herd[a.id] ?? 0) + n;
    const cost = d.px(a.price) * n; const key = `${RANCH_GAME}:buy:${randomUUID()}`;
    let w: Atomic; try { w = bank.transferAtomic([{ name, amount: -cost, key, game: RANCH_GAME, memo: `🐄 ${r.label}: bought ${n} ${a.label}${n === 1 ? '' : 's'}` }]); }
    catch (e) { throw new RanchError((e as Error).message === 'Not enough chips.' ? `Not enough chips: ${n} ${a.label.toLowerCase()}${n === 1 ? '' : 's'} cost ${fmt(cost)}.` : 'Wallet temporarily unavailable.'); }
    await commit(d, m, name, id, p, s, [], w, key);
    return { animal: a.id, n, paid: cost };
  });
}
export async function sellAnimals(name: string, b: { id?: unknown; animal?: unknown; n?: unknown }, d: RanchDeps) {
  const a = animalById(b.animal); if (!a) throw new RanchError('Pick an animal.');
  const n = Number(b.n); if (!Number.isInteger(n) || n < 1) throw new RanchError('Sell at least one.');
  const { bank, m } = guard(name, d); const { id, p, row } = await own(name, b.id, d); const r = ranchById(id)!;
  return locked(id, async () => {
    const now = nowOf(d); const s = settle(clone(row.s), now);
    if ((s.herd[a.id] ?? 0) < n) throw new RanchError(`You have ${s.herd[a.id] ?? 0} ${a.label.toLowerCase()}${s.herd[a.id] === 1 ? '' : 's'}.`);
    s.herd[a.id] -= n; s.barn[a.id] = Math.min(s.barn[a.id], barnCap(s, a, now));
    const pay = Math.floor(d.px(a.price) * ANIMAL_SELL_BACK) * n; const key = `${RANCH_GAME}:sell:${randomUUID()}`;
    let w: Atomic; try { w = bank.transferAtomic([{ name, amount: pay, key, game: RANCH_GAME, memo: `🐄 ${r.label}: sold ${n} ${a.label}${n === 1 ? '' : 's'}` }]); } catch { throw new RanchError('Wallet temporarily unavailable.'); }
    await commit(d, m, name, id, p, s, [], w, key);
    return { animal: a.id, n, paid: pay };
  });
}
export async function collectRanch(name: string, b: { id?: unknown }, d: RanchDeps) {
  const { bank, m } = guard(name, d); const { id, p, row } = await own(name, b.id, d); const r = ranchById(id)!;
  return locked(id, async () => {
    const now = nowOf(d); const s = settle(clone(row.s), now);
    const got: Array<{ id: string; qty: number }> = []; const deltas: Array<{ type: 'food'; id: string; delta: number }> = []; let wool = 0;
    for (const a of ANIMALS) { const q = s.barn[a.id] ?? 0; if (q <= 0) continue; s.barn[a.id] = 0; got.push({ id: a.product.id, qty: q }); if (a.product.kind === 'food') deltas.push({ type: 'food', id: a.product.id, delta: q }); else wool += q; }
    if (!got.length) throw new RanchError('The barn is empty. Animals produce on their timers.');
    const sheep = ANIMALS.find((a) => a.product.kind === 'wool')!; const woolPay = d.px(sheep.product.base) * wool;
    let w: Atomic | null = null; const key = `${WOOL_GAME}:${randomUUID()}`;
    if (woolPay > 0) { try { w = bank.transferAtomic([{ name, amount: woolPay, key, game: WOOL_GAME, memo: `🧶 ${r.label}: ${wool} fleece${wool === 1 ? '' : 's'} to the Cedar Crossing wool buyer` }]); } catch { throw new RanchError('Wallet temporarily unavailable.'); } }
    await commit(d, m, name, id, p, s, deltas, w, w ? key : null);
    return { got, woolPay };
  });
}
export async function hireHand(name: string, b: { id?: unknown; days?: unknown }, d: RanchDeps) {
  const days = Number(b.days); if (!Number.isInteger(days) || days < 1 || days > HAND_MAX_DAYS) throw new RanchError(`Hire for 1 to ${HAND_MAX_DAYS} days.`);
  const { bank, m } = guard(name, d); const { id, p, row } = await own(name, b.id, d); const r = ranchById(id)!;
  return locked(id, async () => {
    const now = nowOf(d); const s = settle(clone(row.s), now);
    if (unitsUsed(s.herd) === 0) throw new RanchError('Stock some animals first.');
    if (s.handUntil - now > (HAND_MAX_DAYS - days) * 86_400_000) throw new RanchError(`The hand is booked up to ${HAND_MAX_DAYS} days ahead.`);
    const cost = d.px(handWagePerDay(s.herd)) * days; const key = `${RANCH_GAME}:hand:${randomUUID()}`;
    s.handUntil = Math.max(now, s.handUntil) + days * 86_400_000;
    let w: Atomic; try { w = bank.transferAtomic([{ name, amount: -cost, key, game: RANCH_GAME, memo: `🤠 ${r.label}: ranch hand for ${days} day${days === 1 ? '' : 's'}` }]); }
    catch (e) { throw new RanchError((e as Error).message === 'Not enough chips.' ? `Not enough chips: ${days} day${days === 1 ? '' : 's'} of wages cost ${fmt(cost)}.` : 'Wallet temporarily unavailable.'); }
    await commit(d, m, name, id, p, s, [], w, key);
    return { days, paid: cost, until: s.handUntil };
  });
}
export const herdOf = (id: string): Herd | null => ranches.get(id)?.s.herd ?? null;
export type { AnimalId };

let liveDeps: (() => RanchDeps) | null = null;
export function setRanchDeps(f: () => RanchDeps) { liveDeps = f; }
export async function initRanches(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const p = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  p.on('error', (e) => console.error('[ranch] pool error:', e.message));
  try { await p.query(RANCH_MIGRATION); const n = await loadRanches(p as unknown as Q); console.log(`[ranch] ready (${n} ranches)`); }
  catch (e) { console.error('[ranch] init failed:', (e as Error).message); }
  finally { await p.end().catch(() => {}); }
}
type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerRanches(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const known = (e: unknown) => e instanceof RanchError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message);
  const on = (ev: string, fn: (b: Record<string, unknown>, name: string | null, d: RanchDeps) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    if (typeof payload === 'function') { ack = payload as Ack; payload = {}; }
    const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    try {
      if (!liveDeps) throw new RanchError('Ranches are offline right now.'); const d = liveDeps();
      const result = await fn(b, nameOf(), d); ack?.({ ok: true, result, ranch: await ranchView(nameOf(), b.id, d) });
    } catch (e) {
      if (!known(e)) console.error('[ranch]', e);
      let ranch: RanchView | undefined; try { if (liveDeps && isRanchId(b.id)) ranch = await ranchView(nameOf(), b.id, liveDeps()); } catch { /* offline */ }
      ack?.({ ok: false, error: known(e) ? (e as Error).message : 'Something went wrong.', ranch });
    }
  });
  const need = (n: string | null) => { if (!n) throw new RanchError('Sign in first.'); return n; };
  on('ranch_state', () => null);
  on('ranch_buy', (b, n, d) => buyAnimals(need(n), b, d));
  on('ranch_sell', (b, n, d) => sellAnimals(need(n), b, d));
  on('ranch_collect', (b, n, d) => collectRanch(need(n), b, d));
  on('ranch_hire', (b, n, d) => hireHand(need(n), b, d));
}

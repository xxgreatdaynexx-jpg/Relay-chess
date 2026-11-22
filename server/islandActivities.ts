/**
 * Private Island day activities (shared/islandActivities.ts): Snorkel Reef dives, the beach Treasure Hunt and the
 * Helicopter Tour bonus. Island-only. Every payout is one keyed ledger row (tx_key is UNIQUE in wallet_transactions),
 * so the per-day caps survive restarts without any new table. Outcomes are an HMAC of the ledger key under a
 * server-only secret: stable for a given player and day, not computable by the client.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isDisabledName } from '../shared/disabled.js';
import {
  CHEST_PAY, DIG_PER_DAY, DIVE_COOLDOWN_MS, DIVE_PER_DAY, TOUR_MS, TOUR_PAY, TREASURE_SPOTS, TRINKET_PAY,
  diveFindOf, islandDayKey, type DiveFind,
} from '../shared/islandActivities.js';

export const ISLAND_DIVE_GAME = 'island_dive';
export const ISLAND_DIG_GAME = 'island_dig';
export const ISLAND_TOUR_GAME = 'island_tour';
export class IslandActivityError extends Error {}
export interface ActivityBank { ready: boolean; hasKey(key: string): boolean; transferConfirmed(name: string, amount: number, opts: { key: string; game: string; memo?: string }): Promise<boolean>; account(name: string): { chips: number } }
export interface ActivityDeps {
  bank: () => ActivityBank;
  atIsland: (name: string) => boolean;
  jailed: (name: string) => boolean;
  px: (n: number) => number;
  clock?: () => number;
  /** Server-only secret for find/chest draws. Defaults to a hash of DATABASE_URL (stable across restarts). */
  salt?: string;
}
const keyOf = (n: string) => n.trim().toLowerCase();
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
let defaultSalt: string | null = null;
const saltOf = (d: ActivityDeps) => d.salt ?? (defaultSalt ??= createHash('sha256').update(`island-activities:${process.env.DATABASE_URL || randomBytes(32).toString('hex')}`).digest('hex'));
const draw = (d: ActivityDeps, key: string) => createHmac('sha256', saltOf(d)).update(key).digest().readUInt32BE(0) / 4294967296;
/** Which X hides this player's chest today (1-based). */
export const chestSpot = (d: ActivityDeps, player: string, day: string) => 1 + Math.floor(draw(d, `isle_chest:${keyOf(player)}:${day}`) * TREASURE_SPOTS);
export const diveFind = (d: ActivityDeps, key: string): DiveFind => diveFindOf(draw(d, key));

const lastDive = new Map<string, number>();
const tours = new Map<string, number>();
const busy = new Set<string>();
/** Test hook: forget in-memory cooldowns and tour timers. */
export function resetIslandActivityMemory() { lastDive.clear(); tours.clear(); busy.clear(); }

function guard(name: string, d: ActivityDeps) {
  if (!d.atIsland(name)) throw new IslandActivityError('Be on the Private Island for that. Fly there from Travel.');
  if (d.jailed(name) || isDisabledName(name)) throw new IslandActivityError('Not available right now.');
  const bank = d.bank(); if (!bank.ready) throw new IslandActivityError('Wallet temporarily unavailable.');
  return bank;
}
async function locked<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const k = keyOf(name); if (busy.has(k)) throw new IslandActivityError('One thing at a time.');
  busy.add(k); try { return await fn(); } finally { busy.delete(k); }
}

export interface IslandActivityState {
  day: string; here: boolean;
  dives: { used: number; max: number; finds: Array<{ id: string; label: string; emoji: string; pay: number }>; readyIn: number };
  hunt: { used: number; max: number; dug: number[]; found: number | null };
  tour: { claimed: boolean; pay: number; running: boolean };
  pay: { chest: number; trinket: number };
}
export function islandActivityState(name: string | null, d: ActivityDeps): IslandActivityState {
  const now = (d.clock ?? Date.now)(); const day = utcDay(now); const bank = d.bank(); const p = name ? keyOf(name) : '';
  const finds: IslandActivityState['dives']['finds'] = []; const dug: number[] = []; let found: number | null = null;
  if (name) {
    for (let n = 1; n <= DIVE_PER_DAY; n++) { const k = islandDayKey('dive', p, day, n); if (bank.hasKey(k)) { const f = diveFind(d, k); finds.push({ id: f.id, label: f.label, emoji: f.emoji, pay: d.px(f.pay) }); } }
    const chest = chestSpot(d, p, day);
    for (let s = 1; s <= TREASURE_SPOTS; s++) if (bank.hasKey(islandDayKey('dig', p, day, s))) { dug.push(s); if (s === chest) found = s; }
  }
  const last = lastDive.get(p) ?? 0;
  return {
    day, here: !!name && d.atIsland(name),
    dives: { used: finds.length, max: DIVE_PER_DAY, finds, readyIn: Math.max(0, last + DIVE_COOLDOWN_MS - now) },
    hunt: { used: dug.length, max: DIG_PER_DAY, dug, found },
    tour: { claimed: !!name && bank.hasKey(islandDayKey('tour', p, day, 1)), pay: d.px(TOUR_PAY), running: tours.has(p) },
    pay: { chest: d.px(CHEST_PAY), trinket: d.px(TRINKET_PAY) },
  };
}

export async function dive(name: string, d: ActivityDeps): Promise<{ find: DiveFind & { paid: number }; left: number; chips: number }> {
  const bank = guard(name, d);
  return locked(name, async () => {
    const now = (d.clock ?? Date.now)(); const day = utcDay(now); const p = keyOf(name);
    const wait = (lastDive.get(p) ?? 0) + DIVE_COOLDOWN_MS - now;
    if (wait > 0) throw new IslandActivityError(`Catch your breath: next dive in ${Math.ceil(wait / 1000)}s.`);
    let n = 1; while (n <= DIVE_PER_DAY && bank.hasKey(islandDayKey('dive', p, day, n))) n++;
    if (n > DIVE_PER_DAY) throw new IslandActivityError(`That's all ${DIVE_PER_DAY} dives for today. The reef resets at 00:00 UTC.`);
    const key = islandDayKey('dive', p, day, n); const f = diveFind(d, key); const paid = d.px(f.pay);
    if (!(await bank.transferConfirmed(name, paid, { key, game: ISLAND_DIVE_GAME, memo: `🤿 Snorkel Reef · ${f.label} · dive ${n}/${DIVE_PER_DAY}` }))) throw new IslandActivityError('That dive did not go through. Nothing was paid.');
    lastDive.set(p, now);
    return { find: { ...f, paid }, left: DIVE_PER_DAY - n, chips: bank.account(name).chips };
  });
}

export async function dig(name: string, spot: unknown, d: ActivityDeps): Promise<{ spot: number; chest: boolean; paid: number; left: number; chips: number }> {
  const s = Number(spot); if (!Number.isInteger(s) || s < 1 || s > TREASURE_SPOTS) throw new IslandActivityError('Pick one of the X marks.');
  const bank = guard(name, d);
  return locked(name, async () => {
    const day = utcDay((d.clock ?? Date.now)()); const p = keyOf(name); const chest = chestSpot(d, p, day);
    let used = 0; let found = false;
    for (let i = 1; i <= TREASURE_SPOTS; i++) if (bank.hasKey(islandDayKey('dig', p, day, i))) { used++; if (i === chest) found = true; }
    if (found) throw new IslandActivityError('You already found today\'s chest. A new map washes up at 00:00 UTC.');
    const key = islandDayKey('dig', p, day, s);
    if (bank.hasKey(key)) throw new IslandActivityError('You already dug there today.');
    if (used >= DIG_PER_DAY) throw new IslandActivityError(`Out of digs: ${DIG_PER_DAY} a day. The sand resets at 00:00 UTC.`);
    const hit = s === chest; const paid = d.px(hit ? CHEST_PAY : TRINKET_PAY);
    if (!(await bank.transferConfirmed(name, paid, { key, game: ISLAND_DIG_GAME, memo: hit ? `🗺️ Treasure Hunt · chest at X${s}` : `🗺️ Treasure Hunt · trinket at X${s}` }))) throw new IslandActivityError('That dig did not go through. Nothing was paid.');
    return { spot: s, chest: hit, paid, left: hit ? 0 : DIG_PER_DAY - used - 1, chips: bank.account(name).chips };
  });
}

export function startTour(name: string, d: ActivityDeps): { ms: number; bonus: boolean } {
  const bank = guard(name, d); const now = (d.clock ?? Date.now)(); const p = keyOf(name);
  tours.set(p, now);
  return { ms: TOUR_MS, bonus: !bank.hasKey(islandDayKey('tour', p, utcDay(now), 1)) };
}

export async function claimTour(name: string, d: ActivityDeps): Promise<{ paid: number; chips: number }> {
  const bank = guard(name, d);
  return locked(name, async () => {
    const now = (d.clock ?? Date.now)(); const p = keyOf(name); const t = tours.get(p);
    if (t == null) throw new IslandActivityError('Take off from the helipad first.');
    if (now - t < TOUR_MS - 5_000) throw new IslandActivityError('Still in the air. Finish the loop first.');
    tours.delete(p);
    if (now - t > 30 * 60_000) throw new IslandActivityError('That tour timed out. Take off again.');
    const key = islandDayKey('tour', p, utcDay(now), 1);
    if (bank.hasKey(key)) return { paid: 0, chips: bank.account(name).chips };
    const paid = d.px(TOUR_PAY);
    if (!(await bank.transferConfirmed(name, paid, { key, game: ISLAND_TOUR_GAME, memo: '🚁 Island helicopter tour · postcard bonus' }))) throw new IslandActivityError('The bonus did not go through.');
    return { paid, chips: bank.account(name).chips };
  });
}

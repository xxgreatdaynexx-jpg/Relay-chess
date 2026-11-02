/**
 * Home kitchen (rules in shared/fishPan.ts). Start a cook on one raw fish in your cooler: the server picks the pan's
 * seed and remembers the session. Plating sends the input timeline; the server replays it (plausible wall time only)
 * and turns the fish into a dish with ONE conditional UPDATE (still yours, unsold, uncooked), so a fish is cooked
 * exactly once. Cooking moves no chips: the dish's base value sells through the normal fish market (daily tiers +
 * price index + atomic wallet/ledger in server/fishing.ts).
 */
import { randomInt } from 'node:crypto';
import type pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { getFishing } from './fishing.js';
import { getSkills, awardXp } from './skills.js';
import { priceIndex } from './price-index.js';
import { fishById, sizeFrac } from '../shared/fishing.js';
import { levelFor } from '../shared/skills.js';
import { COOK_DT, COOK_LEVEL, COOK_XP, OUTCOME_XP, cookable, cookedValue, dishName, replayCook, type Outcome } from '../shared/fishPan.js';

export class PanError extends Error {}
const keyOf = (n: string) => n.replace(/\s+/g, ' ').trim().toLowerCase();
interface Session { fishId: string; species: string; grams: number; value: number; seed: number; level: number; at: number }
export interface CookItem { id: string; fish: string; grams: number; value: number; dish: string | null; raw: number | null; at: number }
export const SESSION_MS = 120_000;

export class FishPan {
  private sessions = new Map<string, Session>();
  private busy = new Set<string>();
  constructor(private readonly pool: pg.Pool, private readonly level: (name: string) => Promise<number>, private readonly clock = () => Date.now(), private readonly seedFn = () => randomInt(1, 2 ** 31)) {}

  async pantry(name: string): Promise<{ items: CookItem[]; level: number; index: number; cooking: string | null }> {
    const key = keyOf(name);
    const r = await this.pool.query('SELECT id, species, weight_g, value, dish, raw_value, caught_at FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL ORDER BY caught_at DESC', [key]);
    const items = (r.rows as Array<Record<string, unknown>>).map((x) => ({ id: String(x.id), fish: String(x.species), grams: Number(x.weight_g), value: Number(x.value), dish: (x.dish as string | null) ?? null, raw: x.raw_value == null ? null : Number(x.raw_value), at: Number(x.caught_at) }));
    const s = this.sessions.get(key); const live = s && this.clock() - s.at < SESSION_MS ? s.fishId : null;
    return { items, level: await this.level(name), index: priceIndex(), cooking: live };
  }

  private async excl<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(key)) throw new PanError('Hang on — the last step is still cooking.');
    this.busy.add(key); try { return await fn(); } finally { this.busy.delete(key); }
  }

  /** Put a raw fish in the pan. */
  async start(name: string, fishId: unknown): Promise<{ seed: number; thick: number; level: number; fish: string; grams: number }> {
    const key = keyOf(name); if (typeof fishId !== 'string' || fishId.length > 64) throw new PanError('Pick a fish from your cooler.');
    return this.excl(key, async () => {
      const r = await this.pool.query('SELECT species, weight_g, value, dish FROM fish_catches WHERE id = $1 AND player_key = $2 AND sold_at IS NULL', [fishId, key]);
      const row = r.rows[0] as { species: string; weight_g: number; value: number; dish: string | null } | undefined;
      if (!row) throw new PanError("That fish isn't in your cooler.");
      if (row.dish) throw new PanError("That one's already cooked.");
      const f = fishById(row.species); if (!f || !cookable(f.rarity)) throw new PanError("You can't cook that. (Maybe sell it for scrap.)");
      const level = await this.level(name); const need = COOK_LEVEL[f.rarity];
      if (level < need) throw new PanError(`You need Cooking level ${need} to cook a ${f.label} (you're ${level}).`);
      const seed = this.seedFn(); const grams = Number(row.weight_g);
      this.sessions.set(key, { fishId, species: f.id, grams, value: Number(row.value), seed, level, at: this.clock() });
      return { seed, thick: sizeFrac(f, grams), level, fish: f.id, grams };
    });
  }
  cancel(name: string) { this.sessions.delete(keyOf(name)); }

  /** Plate it: the server replays the timeline and writes the dish. */
  async plate(name: string, inputs: unknown): Promise<{ outcome: Outcome; dish: string; value: number; raw: number; xp: number }> {
    const key = keyOf(name);
    return this.excl(key, async () => {
      const s = this.sessions.get(key); const now = this.clock();
      if (!s || now - s.at > SESSION_MS) { this.sessions.delete(key); throw new PanError('Nothing in the pan.'); }
      this.sessions.delete(key);
      const f = fishById(s.species)!;
      const res = replayCook(s.seed, sizeFrac(f, s.grams), s.level, inputs);
      if (res === 'invalid') throw new PanError('The pan slipped. Try again.');
      if (now - s.at < (inputs as string).length * COOK_DT * 1000 - 800) throw new PanError('The pan slipped. Try again.'); // faster than real time
      if (!cookable(f.rarity)) throw new PanError("You can't cook that.");
      const value = cookedValue(s.value, res); const dish = dishName(f.label, f.rarity, res);
      const u = await this.pool.query('UPDATE fish_catches SET value = $1, dish = $2, raw_value = value WHERE id = $3 AND player_key = $4 AND sold_at IS NULL AND dish IS NULL AND value = $5', [value, dish, s.fishId, key, s.value]);
      if (u.rowCount !== 1) throw new PanError('That fish is gone from your cooler.');
      const xp = Math.round(COOK_XP[f.rarity] * OUTCOME_XP[res]);
      awardXp(name, 'cooking', xp);
      return { outcome: res, dish, value, raw: s.value, xp };
    });
  }
}

let cooking: FishPan | null = null;
export const getFishPan = () => cooking;
export function setFishPan(c: FishPan | null) { cooking = c; }
export async function cookLevel(name: string): Promise<number> {
  const rows = await getSkills().store.one(keyOf(name)).catch(() => []);
  const r = rows.find((x) => x.skill === 'cooking'); return levelFor(Number(r?.xp ?? 0));
}
export function initFishPan(): void {
  const f = getFishing(); if (!f) return;
  cooking = new FishPan(f.pool, cookLevel); console.log('[fishPan] ready');
}

function bucket(cap = 6, perSec = 3) { let tok = cap, at = Date.now(); return () => { const n = Date.now(); tok = Math.min(cap, tok + ((n - at) / 1000) * perSec); at = n; if (tok < 1) return false; tok -= 1; return true; }; }
type Ack = (r: Record<string, unknown>) => void;
export function registerFishPan(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const take = bucket();
  const on = (ev: string, fn: (b: Record<string, unknown>, c: FishPan, name: string) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try {
      if (!take()) throw new PanError('Slow down.');
      if (!cooking) throw new PanError('The kitchen is closed right now.');
      const name = nameOf(); if (!name) throw new PanError('Sign in to cook.');
      const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      ack?.({ ok: true, ...((await fn(b, cooking, name)) as object ?? {}) });
    } catch (e) { ack?.({ ok: false, error: e instanceof PanError ? e.message : 'Something went wrong.' }); if (!(e instanceof PanError)) console.error(`[fishPan] ${ev}:`, (e as Error).message); }
  });
  on('pan_state', (_b, c, n) => c.pantry(n));
  on('pan_start', (b, c, n) => c.start(n, b.id));
  on('pan_plate', (b, c, n) => c.plate(n, b.inputs));
  on('pan_cancel', (_b, c, n) => { c.cancel(n); return {}; });
}

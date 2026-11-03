/**
 * Fishing upgrades shop (request #28). Ownership + equipped bait/fly live in Postgres; chips move only through the atomic
 * wallet (CasinoBank.transferAtomic, ledger game 'fish_gear') in the same transaction as the ownership row, so a double
 * click buys once and a failed write charges nothing. Fishing.cast reads the equipped gear synchronously from the cache.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { bootAttach, setBootState } from './boot-retry.js';
import { databaseUrl } from './leaderboard-store.js';
import { getBank, type CasinoBank } from './casino-store.js';
import { px, priceIndex } from './price-index.js';
import { setFishGearHook } from './fishing.js';
import { canBuyGear, DEFAULT_BAIT, DEFAULT_FLY, FISH_GEAR, gearDef, gearTiers, type FishGearKind, type FishGearView } from '../shared/fishGear.js';

export const FISH_GEAR_MIGRATION = `
CREATE TABLE IF NOT EXISTS fish_gear (player_key TEXT NOT NULL, gear_id TEXT NOT NULL, price BIGINT NOT NULL, bought_at BIGINT NOT NULL, PRIMARY KEY (player_key, gear_id));
CREATE TABLE IF NOT EXISTS fish_gear_equipped (player_key TEXT NOT NULL, kind TEXT NOT NULL, gear_id TEXT NOT NULL, PRIMARY KEY (player_key, kind));
`;
export class FishGearError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();

export class FishGear {
  owned = new Map<string, Set<string>>();
  equipped = new Map<string, { bait: string; fly: string }>();
  private locks = new Map<string, Promise<unknown>>();
  constructor(private readonly pool: pg.Pool, private readonly bank: () => CasinoBank = getBank, private readonly clock = () => Date.now()) {}
  async init() {
    await this.pool.query(FISH_GEAR_MIGRATION);
    for (const r of (await this.pool.query('SELECT player_key, gear_id FROM fish_gear')).rows as Array<{ player_key: string; gear_id: string }>) if (gearDef(r.gear_id)) this.set(r.player_key).add(r.gear_id);
    for (const r of (await this.pool.query('SELECT player_key, kind, gear_id FROM fish_gear_equipped')).rows as Array<{ player_key: string; kind: string; gear_id: string }>) {
      if (r.kind === 'bait' || r.kind === 'fly') this.eq(r.player_key)[r.kind] = r.gear_id;
    }
  }
  private set(k: string) { let s = this.owned.get(k); if (!s) { s = new Set(); this.owned.set(k, s); } return s; }
  private eq(k: string) { let e = this.equipped.get(k); if (!e) { e = { bait: DEFAULT_BAIT, fly: DEFAULT_FLY }; this.equipped.set(k, e); } return e; }
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  ownedOf(name: string): string[] { const s = this.owned.get(keyOf(name)); return [DEFAULT_BAIT, DEFAULT_FLY, ...FISH_GEAR.filter((g) => g.tier > 0 && s?.has(g.id)).map((g) => g.id)]; }
  /** Equipped gear (guests/unknown = worm + plain hook). Only ever returns gear the player owns. */
  equippedOf(name: string | null): { bait: string; fly: string } {
    if (!name) return { bait: DEFAULT_BAIT, fly: DEFAULT_FLY };
    const k = keyOf(name); const e = this.equipped.get(k); const own = this.owned.get(k);
    const ok = (id: string | undefined, d: string) => (id && (id === d || own?.has(id)) ? id : d);
    return { bait: ok(e?.bait, DEFAULT_BAIT), fly: ok(e?.fly, DEFAULT_FLY) };
  }
  view(name: string | null): FishGearView & { index: number } {
    const e = this.equippedOf(name);
    return { owned: name ? this.ownedOf(name) : [DEFAULT_BAIT, DEFAULT_FLY], bait: e.bait, fly: e.fly, prices: Object.fromEntries(FISH_GEAR.map((g) => [g.id, px(g.price)])), index: priceIndex() };
  }
  private async saveEquip(cl: { query: pg.Pool['query'] } | pg.PoolClient, k: string, kind: FishGearKind, id: string) {
    await cl.query('INSERT INTO fish_gear_equipped (player_key, kind, gear_id) VALUES ($1,$2,$3) ON CONFLICT (player_key, kind) DO UPDATE SET gear_id = EXCLUDED.gear_id', [k, kind, id]);
  }
  async buy(name: string, id: unknown) {
    const d = gearDef(id); if (!d || d.tier === 0) throw new FishGearError('Unknown gear.');
    const k = keyOf(name);
    return this.lock(k, async () => {
      const owned = this.ownedOf(name);
      if (owned.includes(d.id)) throw new FishGearError(`You already own the ${d.name}.`);
      if (!canBuyGear(owned, d.id)) throw new FishGearError(`Buy the ${gearTiers(d.kind)[d.tier - 1]!.name} first.`);
      const cost = px(d.price); const bank = this.bank(); await bank.refresh(name);
      if (bank.account(name).chips < cost) throw new FishGearError(`Not enough chips: the ${d.name} costs ${cost.toLocaleString('en-US')}.`);
      const w = bank.transferAtomic([{ name, amount: -cost, key: `fish_gear:${k}:${d.id}:${randomUUID()}`, game: 'fish_gear', memo: `Fishing: bought ${d.name}` }]);
      const run = async () => {
        await w.after; const cl = await this.pool.connect();
        try {
          await cl.query('BEGIN');
          const ins = await cl.query('INSERT INTO fish_gear (player_key, gear_id, price, bought_at) VALUES ($1,$2,$3,$4) ON CONFLICT (player_key, gear_id) DO NOTHING', [k, d.id, cost, this.clock()]);
          if (!ins.rowCount) throw new FishGearError(`You already own the ${d.name}. Nothing was charged.`);
          await this.saveEquip(cl, k, d.kind, d.id);
          for (const s of w.stmts) await cl.query(s.sql, s.args);
          await cl.query('COMMIT');
        } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
      };
      const p = run(); w.bind(p);
      try { await p; } catch (e) { w.revert(); if (e instanceof FishGearError) throw e; console.error('[fish-gear] buy failed:', (e as Error).message); throw new FishGearError(/chips|balance|null value/i.test((e as Error).message) ? 'Not enough chips.' : 'Something went wrong. Nothing was charged.'); }
      this.set(k).add(d.id); this.eq(k)[d.kind] = d.id;
      return { gear: d.id, cost, chips: bank.account(name).chips };
    });
  }
  async equip(name: string, id: unknown) {
    const d = gearDef(id); if (!d) throw new FishGearError('Unknown gear.');
    const k = keyOf(name);
    return this.lock(k, async () => {
      if (!this.ownedOf(name).includes(d.id)) throw new FishGearError(`You don't own the ${d.name}.`);
      await this.saveEquip(this.pool, k, d.kind, d.id);
      this.eq(k)[d.kind] = d.id;
      return { gear: d.id };
    });
  }
}

let gear: FishGear | null = null;
export const getFishGear = () => gear;
export function setFishGear(g: FishGear | null) { gear = g; setFishGearHook((n) => (gear ? gear.equippedOf(n) : { bait: DEFAULT_BAIT, fly: DEFAULT_FLY })); }
export async function initFishGear(): Promise<void> {
  const url = databaseUrl(); if (!url) { setBootState('fish-gear', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[fish-gear] pool error:', e.message));
  await bootAttach('fish-gear', async () => { try { const g = new FishGear(pool); await g.init(); setFishGear(g); console.log('[fish-gear] ready'); return true; } catch (e) { console.error('[fish-gear] init failed:', (e as Error).message); return false; } });
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerFishGear(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const on = (ev: string, fn: (b: Record<string, unknown>, g: FishGear) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try {
      if (!gear) throw new FishGearError('The tackle shop is offline right now.');
      const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const r = (await fn(b, gear)) as object | undefined;
      ack?.({ ok: true, ...(r ?? {}), gear: gear.view(nameOf()) });
    } catch (e) { ack?.({ ok: false, error: e instanceof FishGearError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  const need = () => { const n = nameOf(); if (!n) throw new FishGearError('Sign in to buy fishing gear.'); return n; };
  on('fish_gear_view', () => undefined);
  on('fish_gear_buy', (b, g) => g.buy(need(), b.gear));
  on('fish_gear_equip', (b, g) => g.equip(need(), b.gear));
}

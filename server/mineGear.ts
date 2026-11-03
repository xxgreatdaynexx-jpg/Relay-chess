/**
 * Mine Weapon Store + deepest floor (Millionaire Update #13). Same pattern as the mining tool shop (server/mineTools.ts):
 * ownership + equipped gear live in Postgres; chips move only through the atomic wallet (CasinoBank.transferAtomic,
 * ledger game 'mine_weapon') in the same transaction as the ownership row, so a double click buys once and a failed write
 * charges nothing. 'mine_weapon' is NOT a sink (like 'mine_tool': only the SINK_DEBIT_GAMES list in shared/sinkRoom.ts
 * counts). MinesWorld reads equipped gear and the deepest floor synchronously from the in-memory cache.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { bootAttach, setBootState } from './boot-retry.js';
import { databaseUrl } from './leaderboard-store.js';
import { getBank, type CasinoBank } from './casino-store.js';
import { px } from './price-index.js';
import { setMineGearHooks } from './mines.js';
import { ARMORS, WEAPONS, armorDef, canBuyGear, isArmor, isWeapon, weaponDef, type ArmorId, type GearView, type WeaponId } from '../shared/mineCombat.js';
import { MAX_FLOOR } from '../shared/mineFloors.js';

export const MINE_GEAR_MIGRATION = `
CREATE TABLE IF NOT EXISTS mine_gear (player_key TEXT NOT NULL, item_id TEXT NOT NULL, price BIGINT NOT NULL, bought_at BIGINT NOT NULL, PRIMARY KEY (player_key, item_id));
CREATE TABLE IF NOT EXISTS mine_gear_equipped (player_key TEXT PRIMARY KEY, weapon TEXT NOT NULL, armor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mine_depth (player_key TEXT PRIMARY KEY, deepest INTEGER NOT NULL);
`;
export class MineGearError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();
type Equip = { weapon: WeaponId; armor: ArmorId };
const STARTER: Equip = { weapon: 'rusty_sword', armor: 'none' };

export class MineGear {
  owned = new Map<string, Set<string>>();
  equipped = new Map<string, Equip>();
  deepest = new Map<string, number>();
  private locks = new Map<string, Promise<unknown>>();
  private depthChain: Promise<unknown> = Promise.resolve();
  constructor(private readonly pool: pg.Pool, private readonly bank: () => CasinoBank = getBank, private readonly clock = () => Date.now()) {}
  async init() {
    await this.pool.query(MINE_GEAR_MIGRATION);
    for (const r of (await this.pool.query('SELECT player_key, item_id FROM mine_gear')).rows as Array<{ player_key: string; item_id: string }>) if (isWeapon(r.item_id) || isArmor(r.item_id)) this.set(r.player_key).add(r.item_id);
    for (const r of (await this.pool.query('SELECT player_key, weapon, armor FROM mine_gear_equipped')).rows as Array<{ player_key: string; weapon: string; armor: string }>) this.equipped.set(r.player_key, { weapon: isWeapon(r.weapon) ? r.weapon : STARTER.weapon, armor: isArmor(r.armor) ? r.armor : STARTER.armor });
    for (const r of (await this.pool.query('SELECT player_key, deepest FROM mine_depth')).rows as Array<{ player_key: string; deepest: number }>) this.deepest.set(r.player_key, Number(r.deepest));
  }
  private set(k: string) { let s = this.owned.get(k); if (!s) { s = new Set(); this.owned.set(k, s); } return s; }
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  ownedOf(name: string): string[] { const s = this.owned.get(keyOf(name)); return [STARTER.weapon, STARTER.armor, ...[...WEAPONS, ...ARMORS].filter((x) => x.tier > 0 && s?.has(x.id)).map((x) => x.id)]; }
  /** Only ever returns gear the player owns (guests = starter sword, no armor). */
  equippedOf(name: string | null): Equip {
    if (!name) return STARTER; const k = keyOf(name); const e = this.equipped.get(k); const s = this.owned.get(k);
    if (!e) return STARTER;
    return { weapon: e.weapon === STARTER.weapon || s?.has(e.weapon) ? e.weapon : STARTER.weapon, armor: e.armor === STARTER.armor || s?.has(e.armor) ? e.armor : STARTER.armor };
  }
  deepestOf(name: string): number { return this.deepest.get(keyOf(name)) ?? 1; }
  recordDepth(name: string, floor: number) {
    const k = keyOf(name); const f = Math.min(MAX_FLOOR, Math.floor(floor));
    if (f <= this.deepestOf(name)) return;
    this.deepest.set(k, f);
    this.depthChain = this.depthChain.then(() => this.pool.query('INSERT INTO mine_depth (player_key, deepest) VALUES ($1,$2) ON CONFLICT (player_key) DO UPDATE SET deepest = GREATEST(mine_depth.deepest, EXCLUDED.deepest)', [k, f])).catch((e) => console.error('[mine-gear] depth save failed:', (e as Error).message));
  }
  flush() { return this.depthChain; }
  view(name: string | null): GearView {
    const e = this.equippedOf(name);
    return { owned: name ? this.ownedOf(name) : [STARTER.weapon, STARTER.armor], weapon: e.weapon, armor: e.armor, prices: Object.fromEntries([...WEAPONS, ...ARMORS].map((x) => [x.id, px(x.price)])), deepest: name ? this.deepestOf(name) : 1, signedIn: !!name };
  }
  private saveEquip(c: { query: pg.Pool['query'] } | pg.PoolClient, k: string, e: Equip) {
    return c.query('INSERT INTO mine_gear_equipped (player_key, weapon, armor) VALUES ($1,$2,$3) ON CONFLICT (player_key) DO UPDATE SET weapon = EXCLUDED.weapon, armor = EXCLUDED.armor', [k, e.weapon, e.armor]);
  }

  async buy(name: string, id: unknown) {
    const kind = isWeapon(id) ? 'weapon' : isArmor(id) ? 'armor' : null;
    if (!kind) throw new MineGearError('Unknown item.');
    const d = kind === 'weapon' ? weaponDef(id) : armorDef(id); const k = keyOf(name);
    if (d.tier === 0) throw new MineGearError(`Everyone starts with ${d.name === 'No Armor' ? 'no armor' : `the ${d.name}`}.`);
    return this.lock(k, async () => {
      const owned = this.ownedOf(name);
      if (owned.includes(d.id)) throw new MineGearError(`You already own the ${d.name}.`);
      const list = kind === 'weapon' ? WEAPONS : ARMORS;
      if (!canBuyGear(kind, d.id, owned)) throw new MineGearError(`Buy the ${list[d.tier - 1].name} first.`);
      const cost = px(d.price); const bank = this.bank(); await bank.refresh(name);
      if (bank.account(name).chips < cost) throw new MineGearError(`Not enough chips: the ${d.name} costs ${cost.toLocaleString('en-US')}.`);
      const w = bank.transferAtomic([{ name, amount: -cost, key: `mine_weapon:${k}:${d.id}:${randomUUID()}`, game: 'mine_weapon', memo: `Mines: bought a ${d.name}` }]);
      const next: Equip = { ...this.equippedOf(name), [kind]: d.id };
      const run = async () => {
        await w.after; const cl = await this.pool.connect();
        try {
          await cl.query('BEGIN');
          const ins = await cl.query('INSERT INTO mine_gear (player_key, item_id, price, bought_at) VALUES ($1,$2,$3,$4) ON CONFLICT (player_key, item_id) DO NOTHING', [k, d.id, cost, this.clock()]);
          if (!ins.rowCount) throw new MineGearError(`You already own the ${d.name}. Nothing was charged.`);
          await this.saveEquip(cl, k, next);
          for (const s of w.stmts) await cl.query(s.sql, s.args);
          await cl.query('COMMIT');
        } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
      };
      const p = run(); w.bind(p);
      try { await p; } catch (e) { w.revert(); if (e instanceof MineGearError) throw e; console.error('[mine-gear] buy failed:', (e as Error).message); throw new MineGearError(/chips|balance|null value/i.test((e as Error).message) ? 'Not enough chips.' : 'Something went wrong. Nothing was charged.'); }
      this.set(k).add(d.id); this.equipped.set(k, next);
      return { item: d.id, cost, chips: bank.account(name).chips };
    });
  }

  async equip(name: string, id: unknown) {
    const kind = isWeapon(id) ? 'weapon' : isArmor(id) ? 'armor' : null;
    if (!kind) throw new MineGearError('Unknown item.');
    const k = keyOf(name);
    return this.lock(k, async () => {
      if (!this.ownedOf(name).includes(id as string)) throw new MineGearError("You don't own that.");
      const next: Equip = { ...this.equippedOf(name), [kind]: id };
      await this.saveEquip(this.pool, k, next);
      this.equipped.set(k, next);
      return { item: id };
    });
  }
}

let gear: MineGear | null = null;
export const getMineGear = () => gear;
export function setMineGear(g: MineGear | null) {
  gear = g;
  setMineGearHooks((a) => (gear ? gear.equippedOf(a) : STARTER), { get: (a) => (gear ? gear.deepestOf(a) : 1), record: (a, f) => gear?.recordDepth(a, f) });
}
export async function initMineGear(): Promise<void> {
  const url = databaseUrl(); if (!url) { setBootState('mine-gear', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[mine-gear] pool error:', e.message));
  await bootAttach('mine-gear', async () => { try { const g = new MineGear(pool); await g.init(); setMineGear(g); console.log('[mine-gear] ready'); return true; } catch (e) { console.error('[mine-gear] init failed:', (e as Error).message); return false; } });
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerMineGear(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const on = (ev: string, fn: (b: Record<string, unknown>, g: MineGear) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try {
      if (!gear) throw new MineGearError('The weapon store is offline right now.');
      const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const r = (await fn(b, gear)) as object | undefined;
      ack?.({ ok: true, ...(r ?? {}), gear: gear.view(nameOf()) });
    } catch (e) { ack?.({ ok: false, error: e instanceof MineGearError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  const need = () => { const n = nameOf(); if (!n) throw new MineGearError('Sign in to buy weapons and armor.'); return n; };
  on('mine_gear_view', () => undefined);
  on('mine_gear_buy', (b, g) => g.buy(need(), b.item));
  on('mine_gear_equip', (b, g) => g.equip(need(), b.item));
}

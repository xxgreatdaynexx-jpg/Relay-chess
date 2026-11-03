/** Mines: shared first-person cave. Server-authoritative nodes, backpacks (generic item stacks) and house selling. */
import pg from 'pg';
import { px, priceIndex } from './price-index.js';
import type { Server, Socket } from 'socket.io';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { awardXp, skillLevel } from './skills.js';
import { miningSwingMul, miningBonusChance } from '../shared/skillPerks.js';
import { combinedBonus, extraOreRoll, combinedSwingMul, DEFAULT_TOOL, type MineToolId } from '../shared/mineTools.js';
import { MinesLeaderboard, setMinesBoard } from './mines-board.js';
import { getVault, playerKey } from './skins.js';
import { guestName, lineOfSight, moveAllowance, MOVE_CARRY_MAX, normAngle, clampPitch, canStand, validateMove, eyeHeightOf, type Body } from '../shared/fps.js';
import { parseSellQty } from '../shared/sellQty.js';
import { royaltyEarn } from './royalty.js';
import { CAVE_LANDMARK } from '../shared/royalty.js';
import { CAVES, caveOf, type CaveId, BACKPACK_CAP, MAX_HITS_PER_10S, MINE_MAP, MINE_NODES, NODE_R, ORES, REACH, SWING_MIN_MS, SWING_MS, dayKey, isOre, payoutFor, houseCapBase, stackKey, priceOf, sellable, nameOf, recipeById, FACTORY_LEVELS, type ItemType, type MineNode, type Stack, type Job, type MachineId, type OreId, inExit, weightOf } from '../shared/mines.js';
import { isAtResort } from './travel.js';
import { levelOf, hasFloors, inLadder, canRideTo, respawnFloor, elevatorStops, MAX_FLOOR, clampFloor } from '../shared/mineFloors.js';
import { MOBS, MOB_AGGRO, MOB_REACH, MOB_RESPAWN_MS, SAFE_X, mobCount, mobDmg, mobHp, mobKindFor, lootCount, hitThrough, maxHpOf, weaponDef, lostOnDeath, REGEN_AFTER_MS, REGEN_PER_S, type MobKind, type WeaponId, type ArmorId } from '../shared/mineCombat.js';
import { oreFor, mineHash } from '../shared/mines.js';
import { sinkLostToday } from './sink-room.js';
import { effectiveAlready } from '../shared/sinkRoom.js';
import { houseCapIndex, HOUSE_SELL_BLOCKED } from './house-cap-index.js';

export const MINES_MIGRATION = [
  // Generic per-player stacks: item_type 'ore' | 'bar' | 'good' (Factory) — also the Market hook for stackables.
  `CREATE TABLE IF NOT EXISTS mine_items (player_key TEXT NOT NULL, owner_name TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (player_key, item_type, item_id))`,
  `CREATE TABLE IF NOT EXISTS mine_daily (player_key TEXT NOT NULL, day TEXT NOT NULL, gross REAL NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (player_key, day))`,
  `CREATE TABLE IF NOT EXISTS mine_sales (id SERIAL PRIMARY KEY, player_key TEXT NOT NULL, items TEXT NOT NULL, gross REAL NOT NULL, paid INTEGER NOT NULL, ledger_key TEXT NOT NULL, at BIGINT NOT NULL)`,
  // Factory (stage 2): one per player, levelled with chips; jobs carry server timestamps so they finish while offline.
  `CREATE TABLE IF NOT EXISTS mine_factories (player_key TEXT PRIMARY KEY, owner_name TEXT NOT NULL, level INTEGER NOT NULL, built_at BIGINT NOT NULL)`,
  // What a signed-in miner is carrying in the mine (not yet banked), so a deploy/restart doesn't wipe it.
  `CREATE TABLE IF NOT EXISTS mine_carried (player_key TEXT PRIMARY KEY, owner_name TEXT NOT NULL, items JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  // Factory v2 grid builder: layout + sim state per player (JSON), saved in the same transaction as the pack it feeds.
  `CREATE TABLE IF NOT EXISTS factory_v2 (player_key TEXT PRIMARY KEY, owner_name TEXT NOT NULL, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  // One row per haul banked at the EXIT lift (Mining leaderboard: ore mined, best haul). Same transaction as the banked stacks.
  `CREATE TABLE IF NOT EXISTS mine_banks (id SERIAL PRIMARY KEY, player_key TEXT NOT NULL, owner_name TEXT NOT NULL, ore_qty INTEGER NOT NULL, worth REAL NOT NULL, at BIGINT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS mine_banks_at ON mine_banks (at)`,
  `CREATE TABLE IF NOT EXISTS mine_jobs (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, machine TEXT NOT NULL, recipe TEXT NOT NULL, qty INTEGER NOT NULL, start_at BIGINT NOT NULL, done_at BIGINT NOT NULL)`,
];
export interface FactoryState { level: number; builtAt: number; jobs: Job[] }

export interface MineStore { init(): Promise<void>; load(): Promise<{ items: Array<{ key: string; name: string; type: ItemType; id: string; qty: number }>; daily: Array<{ key: string; day: string; gross: number; paid: number }>; factories?: Array<{ key: string } & FactoryState>; carried?: Array<{ key: string; name: string; stacks: Stack[] }>; fv2?: Array<{ key: string; name?: string; data: unknown }> }>; saveCarried?(key: string, name: string, stacks: Stack[]): Promise<void>; loadCarried?(key: string): Promise<Stack[]>; save(key: string, name: string, stacks: Stack[], sale?: { day: string; gross: number; paid: number; items: string; ledgerKey: string; at: number; dayGross: number; dayPaid: number }, factory?: FactoryState, extra?: Array<{ sql: string; args: unknown[] }>): Promise<void> }

export class PgMineStore implements MineStore {
  constructor(private readonly db: Queryable & { connect?: () => Promise<pg.PoolClient> }) { db.on?.('error', (e) => console.error('[mines] pool error:', e.message)); }
  async init() { for (const q of MINES_MIGRATION) await this.db.query(q); }
  async load() {
    const items = (await this.db.query('SELECT * FROM mine_items')).rows.filter((r) => Number(r.qty) > 0).map((r) => ({ key: String(r.player_key), name: String(r.owner_name), type: r.item_type as ItemType, id: String(r.item_id), qty: Number(r.qty) }));
    const daily = (await this.db.query('SELECT * FROM mine_daily')).rows.map((r) => ({ key: String(r.player_key), day: String(r.day), gross: Number(r.gross), paid: Number(r.paid) }));
    const jobs = (await this.db.query('SELECT * FROM mine_jobs')).rows.map((r) => ({ key: String(r.player_key), job: { id: String(r.id), machine: r.machine as MachineId, recipe: String(r.recipe), qty: Number(r.qty), startAt: Number(r.start_at), doneAt: Number(r.done_at) } }));
    const factories = (await this.db.query('SELECT * FROM mine_factories')).rows.map((r) => ({ key: String(r.player_key), level: Number(r.level), builtAt: Number(r.built_at), jobs: jobs.filter((j) => j.key === String(r.player_key)).map((j) => j.job) }));
    const carried = (await this.db.query('SELECT * FROM mine_carried')).rows.map((r) => ({ key: String(r.player_key), name: String(r.owner_name), stacks: (typeof r.items === 'string' ? JSON.parse(r.items) : r.items) as Stack[] }));
    const fv2 = (await this.db.query('SELECT player_key, owner_name, data FROM factory_v2')).rows.map((r) => ({ key: String(r.player_key), name: String(r.owner_name), data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data }));
    return { items, daily, factories, carried, fv2 };
  }
  /** Fresh read of one player's carried haul (on join: never trust a boot-time snapshot, another instance may have saved since). */
  async loadCarried(key: string): Promise<Stack[]> {
    const r = (await this.db.query('SELECT items FROM mine_carried WHERE player_key = $1', [key])).rows[0];
    if (!r) return [];
    const v = (typeof r.items === 'string' ? JSON.parse(r.items) : r.items) as Stack[];
    return Array.isArray(v) ? v.filter((s) => s && Number(s.qty) > 0).map((s) => ({ type: s.type, id: s.id, qty: Number(s.qty) })) : [];
  }
  /** Idempotent: absolute snapshot upsert, or delete when empty. */
  async saveCarried(key: string, name: string, stacks: Stack[]) {
    if (!stacks.length) { await this.db.query('DELETE FROM mine_carried WHERE player_key = $1', [key]); return; }
    await this.db.query(`INSERT INTO mine_carried (player_key, owner_name, items, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (player_key) DO UPDATE SET owner_name = EXCLUDED.owner_name, items = EXCLUDED.items, updated_at = now()`, [key, name, JSON.stringify(stacks)]);
  }
  async save(key: string, name: string, stacks: Stack[], sale?: Parameters<MineStore['save']>[3], factory?: FactoryState, extra?: Array<{ sql: string; args: unknown[] }>) {
    const c = this.db.connect ? await this.db.connect() : null;
    const q = (sql: string, args: unknown[]) => (c ?? this.db).query(sql, args);
    try {
      if (c) await c.query('BEGIN');
      await q('DELETE FROM mine_items WHERE player_key = $1', [key]);
      for (const s of stacks) if (s.qty > 0) await q('INSERT INTO mine_items (player_key, owner_name, item_type, item_id, qty) VALUES ($1,$2,$3,$4,$5)', [key, name, s.type, s.id, s.qty]);
      if (sale) {
        await q(`INSERT INTO mine_daily (player_key, day, gross, paid) VALUES ($1,$2,$3,$4) ON CONFLICT (player_key, day) DO UPDATE SET gross = EXCLUDED.gross, paid = EXCLUDED.paid`, [key, sale.day, sale.dayGross, sale.dayPaid]);
        await q('INSERT INTO mine_sales (player_key, items, gross, paid, ledger_key, at) VALUES ($1,$2,$3,$4,$5,$6)', [key, sale.items, sale.gross, sale.paid, sale.ledgerKey, sale.at]);
      }
      if (factory) {
        await q(`INSERT INTO mine_factories (player_key, owner_name, level, built_at) VALUES ($1,$2,$3,$4) ON CONFLICT (player_key) DO UPDATE SET level = EXCLUDED.level, owner_name = EXCLUDED.owner_name`, [key, name, factory.level, factory.builtAt]);
        await q('DELETE FROM mine_jobs WHERE player_key = $1', [key]);
        for (const j of factory.jobs) await q('INSERT INTO mine_jobs (id, player_key, machine, recipe, qty, start_at, done_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [j.id, key, j.machine, j.recipe, j.qty, j.startAt, j.doneAt]);
      }
      for (const x of extra ?? []) await q(x.sql, x.args); // e.g. Market stack-listing rows, same transaction as the pack
      if (c) await c.query('COMMIT');
    } catch (e) { if (c) await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c?.release(); }
  }
}

export class MineError extends Error {}
/** Equipped mining tool per account (server/mineTools.ts installs the real lookup once Postgres is attached). */
let toolHook: (account: string | null) => MineToolId = () => DEFAULT_TOOL;
export const setMineToolHook = (f: (account: string | null) => MineToolId) => { toolHook = f; };
/** Equipped weapon + armor and deepest floor reached (server/mineGear.ts installs the Postgres-backed versions). */
let gearHook: (account: string | null) => { weapon: WeaponId; armor: ArmorId } = () => ({ weapon: 'rusty_sword', armor: 'none' });
let depthHook: { get: (account: string) => number; record: (account: string, floor: number) => void } = { get: () => 1, record: () => {} };
export const setMineGearHooks = (g: typeof gearHook, d: typeof depthHook) => { gearHook = g; depthHook = d; };
export interface MobState { id: number; kind: MobKind; x: number; y: number; hx: number; hy: number; hp: number; max: number; dmg: number; deadUntil: number; lastAttack: number; a: number }
/** Debounce for carried-haul saves, and how long a haul restored after a restart waits for its owner. */
export const CARRY_SAVE_MS = 1500;
/** Shown while the mines DB is configured but not connected: never serve (or overwrite) storage/factories from empty memory. */
export const MINES_OFFLINE_MSG = 'Mines storage is reconnecting. Your factory and storage are safe, try again in a minute.';
export const RESTART_GRACE_MS = 10 * 60_000;

interface Miner extends Body { restoring?: Promise<void>; id: string; name: string; account: string | null; a: number; p: number; lastMove: number; carry: number; lastHit: number; hits: number[]; sprint: boolean; carried: Map<string, Stack>; cave: CaveId; floor: number; hp: number; lastHurt: number; lastAttack: number; deepest: number; lastFloorMove: number }
interface NodeState { node: MineNode; hp: number; downUntil: number }

export class MinesWorld {
  /** Mining level for an account (perks). Tests can override. */
  miningLevel: (account: string | null) => number = (a) => (a ? skillLevel(a, 'mining') : 1);
  /** RNG for the bonus-ore roll (tests can override). */
  bonusRng: () => number = () => Math.random();
  /** Equipped mining tool (request #16). Tests can override. */
  toolOf: (account: string | null) => MineToolId = (a) => toolHook(a);
  /** Tool × Mining-perk swing multiplier, floored at MIN_SWING_MUL (25% of the base time). */
  swingMulFor(account: string | null) { return combinedSwingMul(miningSwingMul(this.miningLevel(account)), this.toolOf(account)); }
  swingMsFor(account: string | null) { return Math.round(SWING_MS * this.swingMulFor(account)); }
  miners = new Map<string, Miner>();
  /** Per-cave rock state (pt1201u). `nodes` stays The Mine's for back-compat. */
  caveNodes: Record<CaveId, NodeState[]> = Object.fromEntries(Object.values(CAVES).map((c) => [c.id, c.nodes.map((n) => ({ node: n, hp: ORES[n.ore].hits, downUntil: 0 }))])) as Record<CaveId, NodeState[]>;
  nodes: NodeState[] = this.caveNodes.mine;
  /** Mine floors 2..MAX_FLOOR: rock state per floor, created when someone first goes down there. */
  floorNodes = new Map<number, NodeState[]>();
  /** Creatures per floor (floor 3+), created on first visit; they only act while someone is on that floor. */
  floorMobs = new Map<number, MobState[]>();
  gearOf: (account: string | null) => { weapon: WeaponId; armor: ArmorId } = (a) => gearHook(a);
  deepestOf(m: Miner) { return Math.max(m.deepest, m.account ? depthHook.get(m.account) : 1); }
  maxHp(m: Miner) { return maxHpOf(this.gearOf(m.account).armor); }
  mapOf(m: Miner) { return levelOf(m.cave, m.floor).map; }
  nodeStates(cave: CaveId, floor = 1): NodeState[] {
    if (!hasFloors(cave) || floor <= 1) return this.caveNodes[cave];
    let n = this.floorNodes.get(floor);
    if (!n) { n = levelOf(cave, floor).nodes.map((node) => ({ node, hp: ORES[node.ore].hits, downUntil: 0 })); this.floorNodes.set(floor, n); }
    return n;
  }
  mobsOn(floor: number): MobState[] {
    let list = this.floorMobs.get(floor);
    if (list) return list;
    list = [];
    const map = levelOf('mine', floor).map; const n = mobCount(floor);
    const spots: Array<[number, number]> = [];
    for (let y = 1; y < map.d / 2 - 1; y++) for (let x = 10; x < map.w / 2 - 2; x++) if (canStand(x * 2 + 1, y * 2 + 1, 0, map)) spots.push([x * 2 + 1, y * 2 + 1]);
    for (let i = 0; i < n && spots.length; i++) {
      const [x, y] = spots[Math.floor(mineHash(floor * 4243 + i * 31) * spots.length)];
      const kind = mobKindFor(floor, mineHash(floor * 977 + i * 13)); const max = mobHp(kind, floor);
      list.push({ id: i, kind, x, y, hx: x, hy: y, hp: max, max, dmg: mobDmg(kind, floor), deadUntil: 0, lastAttack: 0, a: 0 });
    }
    this.floorMobs.set(floor, list);
    return list;
  }
  /** Put a miner on a floor of The Mine, at the lift. */
  setFloor(m: Miner, floor: number, now = Date.now()) {
    const f = clampFloor(floor); const sp = levelOf(m.cave, f).map.spawns; const p = sp[this.miners.size % sp.length];
    Object.assign(m, { floor: f, x: p[0], y: p[1], z: 0, vz: 0, grounded: true, crouch: false, carry: 0, lastMove: now, lastFloorMove: now });
    if (f > m.deepest) m.deepest = f;
    if (m.account && f > 1) depthHook.record(m.account, f);
  }
  /** Ladder at the far end of a floor: go one floor down. */
  descend(id: string, now: number): number {
    const m = this.miners.get(id); if (!m) throw new MineError('Join the mine first.');
    if (!hasFloors(m.cave)) throw new MineError('This cave has one floor.');
    if (!inLadder(m.x, m.y)) throw new MineError('Find the ladder at the far end of the floor.');
    if (m.floor >= MAX_FLOOR) throw new MineError('This is the bottom of the mine.');
    if (now - m.lastFloorMove < 800) throw new MineError('Too fast.');
    this.setFloor(m, m.floor + 1, now);
    return m.floor;
  }
  /** Elevator in the lift: any stop (1, 5, 10, ...) at or above the deepest floor you've reached. */
  ride(id: string, to: unknown, now: number): number {
    const m = this.miners.get(id); if (!m) throw new MineError('Join the mine first.');
    if (!hasFloors(m.cave)) throw new MineError('This cave has no elevator.');
    if (!inExit(m.x, m.y)) throw new MineError('Step into the lift to use the elevator.');
    const f = typeof to === 'number' && Number.isInteger(to) ? to : NaN;
    if (!canRideTo(f, this.deepestOf(m))) throw new MineError('Reach that floor first.');
    if (now - m.lastFloorMove < 800) throw new MineError('Too fast.');
    this.setFloor(m, f, now);
    return m.floor;
  }
  /** Weapon swing at a creature: weapon cooldown, reach (eye to the creature's body) and line of sight. */
  attack(id: string, mobId: unknown, now: number): { mob: number; hp: number; killed: boolean; dmg: number; loot?: Stack[] } {
    const m = this.miners.get(id); if (!m) throw new MineError('Join the mine first.');
    if (m.restoring) throw new MineError('Loading your backpack...');
    const list = this.floorMobs.get(m.floor);
    const mob = hasFloors(m.cave) && list && typeof mobId === 'number' ? list[mobId] : undefined;
    if (!mob || mob.deadUntil) throw new MineError('Nothing to hit.');
    const w = weaponDef(this.gearOf(m.account).weapon);
    if (now - m.lastAttack < w.ms - 80) throw new MineError('Too fast.');
    const def = MOBS[mob.kind]; const eye = { x: m.x, y: m.y, z: m.z + eyeHeightOf(m) }; const c = { x: mob.x, y: mob.y, z: def.z };
    if (Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z) - def.radius > w.reach) throw new MineError('Too far.');
    if (!lineOfSight(eye, c, this.mapOf(m))) throw new MineError('Something is in the way.');
    m.lastAttack = now; m.lastHurt = Math.max(m.lastHurt, now - REGEN_AFTER_MS + 2000);
    mob.hp = Math.max(0, mob.hp - w.dmg);
    if (mob.hp > 0) return { mob: mob.id, hp: mob.hp, killed: false, dmg: w.dmg };
    mob.deadUntil = now + MOB_RESPAWN_MS;
    // loot: ore rolled from this floor's mix, only what fits in the backpack
    const lvl = levelOf(m.cave, m.floor); const loot: Stack[] = [];
    for (let i = 0; i < lootCount(m.floor); i++) {
      const ore = oreFor(3, this.bonusRng(), lvl.bias, lvl.anyDepth);
      if (this.load(id) + ORES[ore].weight > BACKPACK_CAP) break;
      const key = `ore:${ore}`; const cur = m.carried.get(key); if (cur) cur.qty += 1; else m.carried.set(key, { type: 'ore', id: ore, qty: 1 });
      const l = loot.find((s) => s.id === ore); if (l) l.qty++; else loot.push({ type: 'ore', id: ore, qty: 1 });
    }
    if (loot.length && m.account) this.markCarried(playerKey(m.account));
    return { mob: mob.id, hp: 0, killed: true, dmg: w.dmg, loot };
  }
  /** Dying: drop half (rounded up) of each carried stack, wake at the nearest elevator stop at or above, full HP. */
  die(m: Miner, now: number): { floor: number; lost: Stack[] } {
    const lost: Stack[] = [];
    for (const [k, s] of m.carried) { const q = lostOnDeath(s.qty); if (q > 0) lost.push({ ...s, qty: q }); s.qty -= q; if (s.qty <= 0) m.carried.delete(k); }
    if (lost.length && m.account) this.markCarried(playerKey(m.account));
    const from = m.floor;
    this.setFloor(m, respawnFloor(from), now);
    m.hp = this.maxHp(m); m.lastHurt = 0;
    return { floor: m.floor, lost };
  }
  private lastMobTick = 0;
  /** Server tick: creatures chase and hit miners on their floor; regen out of combat. Returns hits and deaths for the socket layer. */
  tickMobs(now: number): { hurt: Array<{ id: string; hp: number; max: number; dmg: number; by: number }>; died: Array<{ id: string; floor: number; lost: Stack[]; room: string }> } {
    const dt = Math.min(0.25, this.lastMobTick ? (now - this.lastMobTick) / 1000 : 0.1); this.lastMobTick = now;
    const hurt: Array<{ id: string; hp: number; max: number; dmg: number; by: number }> = []; const died: Array<{ id: string; floor: number; lost: Stack[]; room: string }> = [];
    const byFloor = new Map<number, Miner[]>();
    for (const m of this.miners.values()) {
      const max = this.maxHp(m); if (m.hp > max) m.hp = max;
      if (m.hp < max && now - m.lastHurt > REGEN_AFTER_MS) m.hp = Math.min(max, m.hp + REGEN_PER_S * dt);
      if (inExit(m.x, m.y)) m.hp = max; // the lift heals you
      if (hasFloors(m.cave) && m.floor >= 3) { const l = byFloor.get(m.floor) ?? []; l.push(m); byFloor.set(m.floor, l); }
    }
    for (const [floor, miners] of byFloor) {
      const map = levelOf('mine', floor).map;
      for (const mob of this.mobsOn(floor)) {
        if (mob.deadUntil) { if (now >= mob.deadUntil) Object.assign(mob, { deadUntil: 0, hp: mob.max, x: mob.hx, y: mob.hy }); else continue; }
        const def = MOBS[mob.kind]; let best: Miner | null = null; let bd = MOB_AGGRO;
        for (const m of miners) {
          if (m.x < SAFE_X || m.hp <= 0) continue;
          const d = Math.hypot(m.x - mob.x, m.y - mob.y);
          if (d < bd && lineOfSight({ x: mob.x, y: mob.y, z: def.z }, { x: m.x, y: m.y, z: m.z + 1 }, map)) { best = m; bd = d; }
        }
        if (!best) continue;
        mob.a = Math.atan2(best.y - mob.y, best.x - mob.x);
        if (bd > MOB_REACH * 0.8) {
          const step = def.speed * dt; const nx = mob.x + Math.cos(mob.a) * step, ny = mob.y + Math.sin(mob.a) * step;
          if (nx >= SAFE_X && canStand(nx, mob.y, 0, map)) mob.x = nx;
          if (canStand(mob.x, ny, 0, map)) mob.y = ny;
        }
        if (bd <= MOB_REACH && now - mob.lastAttack >= def.attackMs) {
          mob.lastAttack = now;
          const dmg = hitThrough(mob.dmg, this.gearOf(best.account).armor);
          best.hp -= dmg; best.lastHurt = now;
          if (best.hp <= 0) { const r = this.die(best, now); died.push({ id: best.id, ...r, room: roomOf(best.cave, best.floor) }); }
          else hurt.push({ id: best.id, hp: Math.round(best.hp), max: this.maxHp(best), dmg, by: mob.id });
        }
      }
    }
    return { hurt, died };
  }
  mobsView(floor: number) { return (this.floorMobs.get(floor) ?? []).map((b) => ({ id: b.id, k: b.kind, x: +b.x.toFixed(2), y: +b.y.toFixed(2), a: +b.a.toFixed(2), hp: b.deadUntil ? 0 : b.hp, max: b.max })); }
  /** signed-in backpacks by player key; guests keep theirs on the miner id (lost on leave) */
  packs = new Map<string, Map<string, Stack>>();
  names = new Map<string, string>();
  daily = new Map<string, { day: string; gross: number; paid: number }>();
  factories = new Map<string, FactoryState>();
  /** carried hauls of signed-in players who dropped without exiting. Kept (in memory AND in mine_carried) until they come back and bank it: restarts, deploys and disconnects never wipe a haul. */
  grace = new Map<string, { stacks: Stack[]; until: number }>();
  private jobSeq = 0;
  /** Factory v2 rows loaded at boot (server/factory.ts owns them). */
  fv2 = new Map<string, unknown>();
  /** player_key -> display name for persisted v2 factories (background sweep). */
  fv2Names = new Map<string, string>();
  /** Called before storage is read for selling/quotes so a running factory has caught up. */
  beforeStorage: ((account: string) => void) | null = null;
  store: MineStore | null = null;
  /** True while a database is configured but not attached: signed-in storage and factory actions refuse (fail closed). */
  offline = false;
  private chain: Promise<void> = Promise.resolve();
  private saleSeq = 0;
  private lastCave = new Map<string, CaveId>();

  async attach(store: MineStore): Promise<boolean> {
    try {
      await store.init();
      const { items, daily, factories, carried, fv2 } = await store.load();
      for (const r of fv2 ?? []) { this.fv2.set(r.key, r.data); if (r.name) this.fv2Names.set(r.key, r.name); }
      // Hauls carried when the last server stopped: restored on the player's next join (restart grace).
      if (!store.loadCarried) for (const c of carried ?? []) if (c.stacks.length) { this.grace.set(c.key, { stacks: c.stacks.map((x) => ({ ...x })), until: Date.now() + RESTART_GRACE_MS }); this.names.set(c.key, c.name); }
      for (const f of factories ?? []) this.factories.set(f.key, { level: f.level, builtAt: f.builtAt, jobs: f.jobs });
      for (const i of items) { this.rawPack(i.key).set(stackKey(i), { type: i.type, id: i.id, qty: i.qty }); this.names.set(i.key, i.name); }
      for (const d of daily) { const cur = this.daily.get(d.key); if (!cur || cur.day < d.day) this.daily.set(d.key, d); }
      this.store = store; this.offline = false; return true;
    } catch (e) { console.error('[mines] postgres unavailable, mines in memory only:', (e as Error).message); return false; }
  }
  /** Set on SIGTERM: no new hauls once the final save has started. */
  closing = false;
  /** Write pending hauls. On shutdown (closing) every signed-in miner's and every dropped player's haul is written, not just the debounced ones. */
  async flush() {
    const keys = new Set(this.carryTimers.keys());
    if (this.closing) { for (const m of this.miners.values()) if (m.account && !m.restoring) keys.add(playerKey(m.account)); for (const k of this.grace.keys()) keys.add(k); }
    for (const k of keys) this.saveCarried(k);
    await this.chain;
  }
  private carryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Current carried haul for a player key: online miner's, else unexpired grace, else nothing. */
  private carriedOf(k: string, now = Date.now()): Stack[] {
    for (const m of this.miners.values()) if (m.account && playerKey(m.account) === k) return [...m.carried.values()].filter((s) => s.qty > 0).map((s) => ({ ...s }));
    const g = this.grace.get(k); void now; return g ? g.stacks.map((s) => ({ ...s })) : [];
  }
  /** Queue an absolute snapshot of the carried haul now (ordered on the same chain as pack saves). */
  private saveCarried(k: string) {
    const t = this.carryTimers.get(k); if (t) { clearTimeout(t); this.carryTimers.delete(k); }
    const store = this.store; if (!store?.saveCarried) return;
    const snap = this.carriedOf(k); const name = this.names.get(k) ?? k;
    this.chain = this.chain.then(() => store.saveCarried!(k, name, snap)).catch((e) => console.error('[mines] carry save failed:', (e as Error).message));
  }
  /** Debounced carried-haul save (signed-in only). */
  private markCarried(k: string) {
    if (!this.store?.saveCarried || this.carryTimers.has(k)) return;
    const t = setTimeout(() => this.saveCarried(k), CARRY_SAVE_MS); t.unref?.(); this.carryTimers.set(k, t);
  }

  /** Banked pack map for an account (Factory v2 sim reads/writes it directly). */
  packOf(account: string) { this.names.set(playerKey(account), account.trim()); return this.pack(playerKey(account)); }
  /** Persist pack (+ factory level) plus extra rows in one queued transaction. */
  savePack(account: string, extra: Array<{ sql: string; args: unknown[] }>, withFactory = false): Promise<void> { this.persist({ account }, undefined, withFactory, extra); return this.chain; }
  /** Throws while offline for any signed-in key (guests' in-session packs are memory-only anyway). */
  guardOnline(k: string) { if (this.offline && !k.startsWith('guest:')) throw new MineError(MINES_OFFLINE_MSG); }
  private pack(k: string) { this.guardOnline(k); return this.rawPack(k); }
  private rawPack(k: string) { let p = this.packs.get(k); if (!p) { p = new Map(); this.packs.set(k, p); } return p; }
  packKey(m: Miner) { return m.account ? playerKey(m.account) : `guest:${m.id}`; }
  /** Banked storage (mine_items) of the miner on this socket. */
  backpack(id: string): Stack[] { const m = this.miners.get(id); if (!m) return []; return [...this.pack(this.packKey(m)).values()].filter((s) => s.qty > 0); }
  /** Banked storage by account name (Factory tab: no need to be in the mine). */
  storage(account: string): Stack[] { this.guardOnline(playerKey(account)); return [...(this.packs.get(playerKey(account))?.values() ?? [])].filter((s) => s.qty > 0); }
  /** What the miner is carrying right now (in-session, not banked). */
  carried(id: string): Stack[] { const m = this.miners.get(id); return m ? [...m.carried.values()].filter((s) => s.qty > 0) : []; }
  load(id: string): number { return this.carried(id).reduce((t, s) => t + weightOf(s), 0); }
  inMine(account: string) { const k = playerKey(account); for (const m of this.miners.values()) if (m.account && playerKey(m.account) === k) return true; return false; }

  join(id: string, account: string | null, now: number, caveId: unknown = 'mine'): Miner {
    const cave = caveOf(caveId); const spawns = cave.map.spawns;
    const sp = spawns[this.miners.size % spawns.length];
    const m: Miner = { id, name: account?.trim() || guestName(), account: account?.trim() || null, x: sp[0], y: sp[1], z: 0, vz: 0, grounded: true, crouch: false, a: 0, p: 0, lastMove: now, carry: 0, lastHit: 0, hits: [], sprint: false, carried: new Map(), cave: cave.id, floor: 1, hp: 0, lastHurt: 0, lastAttack: 0, deepest: 1, lastFloorMove: 0 };
    m.hp = this.maxHp(m);
    this.miners.set(id, m);
    if (m.account) {
      const k = playerKey(m.account); this.names.set(k, m.account);
      const g = this.grace.get(k);
      if (g) { this.grace.delete(k); for (const s of g.stacks) m.carried.set(stackKey(s), { ...s }); }
      else if (this.store?.loadCarried) { const r = this.restoreCarried(m, k); m.restoring = r; r.catch(() => {}); }
    }
    return m;
  }
  /** Resolves once a joining miner's saved haul has loaded (tests, and the join handler's ack). */
  ready(id: string): Promise<void> { return this.miners.get(id)?.restoring ?? Promise.resolve(); }
  /** Load the saved haul from Postgres for a signed-in join (hits wait for it). A read failure keeps the miner locked out of mining rather than letting a save overwrite the row with an empty haul. */
  private async restoreCarried(m: Miner, k: string): Promise<void> {
    const store = this.store!;
    let saved: Stack[] | null = null;
    for (let i = 0; i < 3 && !saved; i++) { try { await this.chain; saved = await store.loadCarried!(k); } catch (e) { console.error('[mines] carry load failed:', (e as Error).message); await new Promise((r) => setTimeout(r, 300 * (i + 1))); } }
    if (!saved) throw new MineError('Could not load your backpack. Leave and rejoin the mine in a moment; your haul is safe.');
    for (const s of saved) { const key = stackKey(s); const cur = m.carried.get(key); if (cur) cur.qty += s.qty; else m.carried.set(key, { ...s }); }
    m.restoring = undefined;
  }
  /** Leaving without the lift: guests lose everything; signed-in players get a short reconnect grace, then the haul is gone. */
  /** Put a miner at a spawn in another cave (carried ore comes along; the EXIT lift is in the same place in every cave). */
  moveToCave(m: Miner, caveId: CaveId): void {
    const spawns = caveOf(caveId).map.spawns; const sp = spawns[this.miners.size % spawns.length];
    Object.assign(m, { cave: caveOf(caveId).id, floor: 1, x: sp[0], y: sp[1], z: 0, vz: 0, grounded: true, crouch: false, carry: 0 });
  }

  leave(id: string, now = Date.now()) {
    const m = this.miners.get(id); if (!m) return;
    if (!m.account) this.packs.delete(this.packKey(m));
    else if (!m.restoring) { const k = playerKey(m.account); const c = this.carried(id); if (c.length) this.grace.set(k, { stacks: c.map((s) => ({ ...s })), until: Infinity }); this.miners.delete(id); this.saveCarried(k); } // a miner whose haul never loaded leaves the saved row untouched
    this.miners.delete(id); void now;
  }
  /** Walk into the lift: everything carried moves into banked storage. Position is the server-validated one. */
  exit(id: string): { banked: Stack[]; worth: number } {
    const m = this.miners.get(id); if (!m) throw new MineError('Join the mine first.');
    if (m.restoring) throw new MineError('Loading your backpack...');
    if (!inExit(m.x, m.y)) throw new MineError('Walk to the EXIT lift to bank your haul.');
    const banked = this.carried(id); if (!banked.length) return { banked: [], worth: 0 };
    if (m.account) this.lastCave.set(playerKey(m.account), m.cave); // royalties: ore is credited to the cave it was hauled out of
    const p = this.pack(this.packKey(m));
    m.carried.clear();
    for (const s of banked) { const k = stackKey(s); const cur = p.get(k); if (cur) cur.qty += s.qty; else p.set(k, { ...s }); }
    if (m.account) { const k = playerKey(m.account); const t = this.carryTimers.get(k); if (t) { clearTimeout(t); this.carryTimers.delete(k); } }
    // Banked stacks and the cleared carry row commit in one transaction: no duplicate or lost haul across a restart.
    const worth = banked.reduce((t, s) => t + s.qty * priceOf(s), 0);
    const ore = banked.filter((s) => s.type === 'ore').reduce((t, s) => t + s.qty, 0);
    this.persist(m, undefined, false, m.account ? [
      { sql: 'DELETE FROM mine_carried WHERE player_key = $1', args: [playerKey(m.account)] },
      { sql: 'INSERT INTO mine_banks (player_key, owner_name, ore_qty, worth, at) VALUES ($1,$2,$3,$4,$5)', args: [playerKey(m.account), m.account, ore, worth, Date.now()] },
    ] : undefined);
    return { banked, worth };
  }

  /** Reuses Arena's movement validator (speed cap with carry, collision). Returns true if the client should be corrected. */
  move(id: string, x: unknown, y: unknown, z: unknown, a: unknown, p: unknown, crouch: unknown, sprint: unknown, now: number): boolean {
    const m = this.miners.get(id); if (!m) return false;
    const dt = now - m.lastMove; m.lastMove = now;
    m.crouch = crouch === true; m.sprint = sprint === true;
    const speedBody = { crouch: m.crouch, sprint: m.sprint };
    const allowed = moveAllowance(speedBody, dt, m.carry);
    const want = typeof x === 'number' && typeof y === 'number' ? Math.hypot(x - m.x, y - m.y) : 0;
    validateMove(m, x, y, dt, this.mapOf(m), allowed);
    m.carry = Math.min(MOVE_CARRY_MAX, Math.max(0, allowed - want));
    if (typeof z === 'number' && Number.isFinite(z) && z >= 0 && z <= 1.4 && canStand(m.x, m.y, z, this.mapOf(m))) m.z = z;
    const na = normAngle(a); if (na !== null) m.a = na;
    const np = clampPitch(p); if (np !== null) m.p = np;
    return typeof x === 'number' && typeof y === 'number' && Math.hypot(x - m.x, y - m.y) > 0.6;
  }

  nodeAvailable(n: NodeState, now: number) { if (n.downUntil && now >= n.downUntil) { n.downUntil = 0; n.hp = ORES[n.node.ore].hits; } return !n.downUntil; }

  /** One pickaxe hit. Validates reach, line of sight, swing rate and backpack room. */
  hit(id: string, nodeId: unknown, now: number): { node: number; hp: number; broke: boolean; ore?: OreId; full?: boolean; bonus?: number } {
    const m = this.miners.get(id); if (!m) throw new MineError('Join the mine first.');
    if (this.closing) throw new MineError('The server is restarting. Your haul is saved, mine again in a moment.');
    if (m.restoring) throw new MineError('Loading your backpack...');
    const n = typeof nodeId === 'number' ? this.nodeStates(m.cave, m.floor)[nodeId] : undefined;
    if (!n) throw new MineError('No rock there.');
    const lvl = this.miningLevel(m.account); const tool = this.toolOf(m.account); const mul = combinedSwingMul(miningSwingMul(lvl), tool);
    if (now - m.lastHit < SWING_MIN_MS * mul) throw new MineError('Too fast.');
    m.hits = m.hits.filter((t) => now - t < 10_000);
    if (m.hits.length >= Math.ceil(MAX_HITS_PER_10S / mul)) throw new MineError('Too fast.');
    if (!this.nodeAvailable(n, now)) throw new MineError('That vein is mined out.');
    const eye = { x: m.x, y: m.y, z: m.z + eyeHeightOf(m) };
    const c = n.node;
    const dist = Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z) - NODE_R;
    if (dist > REACH) throw new MineError('Too far.');
    // LOS to a point on the node's near face (centre sits half inside the wall).
    const toward = Math.hypot(eye.x - c.x, eye.y - c.y) || 1;
    const face = { x: c.x + ((eye.x - c.x) / toward) * NODE_R * 0.9, y: c.y + ((eye.y - c.y) / toward) * NODE_R * 0.9, z: c.z };
    if (!lineOfSight(eye, face, this.mapOf(m))) throw new MineError('Something is in the way.');
    const ore = ORES[c.ore];
    if (this.load(id) + ore.weight > BACKPACK_CAP) return { node: c.id, hp: n.hp, broke: false, full: true };
    m.lastHit = now; m.hits.push(now);
    n.hp -= 1;
    if (n.hp > 0) return { node: c.id, hp: n.hp, broke: false };
    n.downUntil = now + ore.respawnMs; n.hp = 0;
    // Mining perk + tool: expected extra ore (only what fits), capped at MAX_TOTAL_BONUS. Never rolls an extra key/chest drop.
    const want = extraOreRoll(combinedBonus(miningBonusChance(lvl), tool), this.bonusRng());
    const bonus = Math.max(0, Math.min(want, Math.floor((BACKPACK_CAP - this.load(id)) / ore.weight) - 1));
    { const key = `ore:${c.ore}`; const cur = m.carried.get(key); if (cur) cur.qty += 1 + bonus; else m.carried.set(key, { type: 'ore', id: c.ore, qty: 1 + bonus }); }
    if (m.account) this.markCarried(playerKey(m.account));
    return { node: c.id, hp: 0, broke: true, ore: c.ore, ...(bonus ? { bonus } : {}) };
  }

  add(m: Miner, stacks: Stack[]) {
    const p = this.pack(this.packKey(m));
    for (const s of stacks) { const k = stackKey(s); const cur = p.get(k); if (cur) cur.qty += s.qty; else p.set(k, { ...s }); }
    this.persist(m);
  }

  private persist(m: { account: string | null }, sale?: Parameters<MineStore['save']>[3], withFactory = false, extra?: Array<{ sql: string; args: unknown[] }>) {
    if (!m.account || !this.store) return;
    const k = playerKey(m.account); const snap = [...this.pack(k).values()].map((s) => ({ ...s })); const store = this.store;
    const f = withFactory ? this.factories.get(k) : undefined; const fs = f ? { level: f.level, builtAt: f.builtAt, jobs: f.jobs.map((j) => ({ ...j })) } : undefined;
    this.chain = this.chain.then(() => store.save(k, m.account!, snap, sale, fs, extra)).catch((e) => console.error('[mines] save failed:', (e as Error).message));
  }

  quote(account: string, now: number, only?: unknown): { gross: number; paid: number; already: number; lost: number; effAlready: number; capBase: number; capIndex: number; items: Stack[] } {
    const m = { account };
    this.beforeStorage?.(account);
    const items = this.storage(account).filter((s) => sellable(s) && (typeof only !== 'string' || s.id === only || stackKey(s) === only));
    const gross = items.reduce((t, s) => t + s.qty * priceOf(s), 0);
    const k = playerKey(m.account); const d = this.daily.get(k); const already = d && d.day === dayKey(now) ? d.gross : 0;
    // Chips lost to sinks today free up room (pt1405u), converted to base chips; may push effAlready below 0.
    const lost = sinkLostToday(account, now); const effAlready = effectiveAlready(already, lost, priceIndex());
    // House ore/goods prices follow the price index (tiers stay in base units so the daily caps scale too).
    const capIndex = houseCapIndex(); const capBase = HOUSE_SELL_BLOCKED.has(k) ? 0 : houseCapBase(capIndex, priceIndex()); // cap follows total assets (pt1442u)
    return { gross, paid: Math.floor(payoutFor(gross, effAlready, capBase) * priceIndex()), already, lost, effAlready, capBase, capIndex, items };
  }

  /** Sell ore to the house. Signed-in only. Stone etc. pay fractional chips: the whole sale is floored once. */
  sell(account: string | null, now: number, only?: unknown, qtyIn?: unknown): { paid: number; gross: number; sold: Stack[] } {
    if (!account) throw new MineError('Sign in to sell ore. Guests can mine but not sell.');
    if (HOUSE_SELL_BLOCKED.has(playerKey(account))) throw new MineError('House selling is disabled on this account.');
    if (this.inMine(account)) throw new MineError('Leave the mine to sell.');
    const m = { account };
    let q = this.quote(account, now, only);
    if (!q.items.length) throw new MineError('Nothing to sell.');
    // Partial sale (request #11): one stack, an integer 1..owned. Re-quote just that slice so the tier cap applies to it.
    let partial: { key: string; qty: number } | null = null;
    if (qtyIn !== undefined && qtyIn !== null) {
      if (typeof only !== 'string' || q.items.length !== 1) throw new MineError('Pick one item to sell a quantity.');
      const v = parseSellQty(qtyIn, q.items[0].qty); if (!v.ok) throw new MineError(v.error);
      const s0 = q.items[0]; const items = [{ ...s0, qty: v.qty }]; const gross = v.qty * priceOf(s0);
      q = { ...q, items, gross, paid: Math.floor(payoutFor(gross, q.effAlready, q.capBase) * priceIndex()) };
      partial = { key: stackKey(s0), qty: v.qty };
    }
    if (q.paid < 1) throw new MineError('Not worth a chip yet. Mine a bit more (stone is 1 chip per 10).');
    const k = playerKey(m.account); const day = dayKey(now);
    const ledgerKey = `mine:sell:${k}:${now}:${++this.saleSeq}`;
    const memo = `Mines: sold ${q.items.map((s) => `${s.qty} ${nameOf(s)}`).join(', ')}`.slice(0, 200);
    getBank().transfer(m.account, q.paid, { key: ledgerKey, game: 'mines', memo });
    { // Monument royalties: ore -> the mine it was last hauled out of, everything else (bars/goods/food) -> the Factory
      const oreG = q.items.filter((s) => s.type === 'ore').reduce((t, s) => t + s.qty * priceOf(s), 0); const share = q.gross > 0 ? oreG / q.gross : 0;
      const cave = CAVE_LANDMARK[this.lastCave.get(k) ?? 'mine'];
      if (cave) royaltyEarn(cave, m.account, q.paid * share); royaltyEarn('factory', m.account, q.paid * (1 - share));
    }
    const p = this.pack(k);
    if (partial) { const cur = p.get(partial.key)!; const left = cur.qty - partial.qty; if (left > 0) p.set(partial.key, { ...cur, qty: left }); else p.delete(partial.key); }
    else for (const s of q.items) p.delete(stackKey(s));
    const prev = this.daily.get(k); const base = prev && prev.day === day ? prev : { day, gross: 0, paid: 0 };
    const nd = { day, gross: base.gross + q.gross, paid: base.paid + q.paid }; this.daily.set(k, nd);
    this.persist(m, { day, gross: q.gross, paid: q.paid, items: JSON.stringify(q.items), ledgerKey, at: now, dayGross: nd.gross, dayPaid: nd.paid });
    return { paid: q.paid, gross: q.gross, sold: q.items };
  }

  // ------------------------------------------------------------ Factory
  private signedIn(account: string | null) { if (!account) throw new MineError('Sign in to build a factory.'); return { account }; }
  factoryView(account: string | null, now: number) {
    const m = account ? { account } : null; if (!m) return null;
    this.guardOnline(playerKey(m.account));
    const f = this.factories.get(playerKey(m.account)); if (!f) return { level: 0, jobs: [], now };
    return { level: f.level, jobs: f.jobs.map((j) => ({ ...j, done: now >= j.doneAt })), now };
  }
  /** Build (level 1) or upgrade the factory. Chips go to the house through the bank ledger. */
  upgradeFactory(account: string | null, now: number): { level: number; cost: number } {
    const m = this.signedIn(account); const k = playerKey(m.account);
    const f = this.factories.get(k); const next = FACTORY_LEVELS[f ? f.level : 0];
    if (!next) throw new MineError('Your factory is maxed out.');
    const cost = px(next.cost);
    if (!getBank().canAfford(m.account, cost)) throw new MineError(`You need ${cost} chips.`);
    getBank().transfer(m.account, -cost, { key: `mine:factory:${k}:L${next.level}`, game: 'mines', memo: next.level === 1 ? 'Mines: built a factory' : `Mines: factory upgraded to level ${next.level}` });
    if (f) f.level = next.level; else this.factories.set(k, { level: 1, builtAt: now, jobs: [] });
    this.persist(m, undefined, true);
    return { level: next.level, cost };
  }
  /** Start a batch: inputs leave the backpack now, outputs are collectable at doneAt (server clock). */
  startJob(account: string | null, recipeId: unknown, qtyIn: unknown, now: number): Job {
    const m = this.signedIn(account); const k = playerKey(m.account);
    const f = this.factories.get(k); if (!f) throw new MineError('Build a factory first.');
    const r = recipeById(recipeId); if (!r) throw new MineError('Unknown recipe.');
    const lv = FACTORY_LEVELS[f.level - 1];
    const qty = typeof qtyIn === 'number' && Number.isInteger(qtyIn) ? qtyIn : 1;
    if (qty < 1 || qty > lv.batch) throw new MineError(`Batch size is 1 to ${lv.batch} at level ${f.level}.`);
    if (f.jobs.filter((j) => j.machine === r.machine).length >= lv.slots) throw new MineError(`Your ${r.machine} is busy. Collect or upgrade for more slots.`);
    const p = this.pack(k);
    for (const i of r.in) if ((p.get(stackKey(i))?.qty ?? 0) < i.qty * qty) throw new MineError(`Need ${i.qty * qty} ${nameOf(i)}.`);
    for (const i of r.in) { const s = p.get(stackKey(i))!; s.qty -= i.qty * qty; if (s.qty <= 0) p.delete(stackKey(i)); }
    const job: Job = { id: `${k}:${now}:${++this.jobSeq}`, machine: r.machine, recipe: r.id, qty, startAt: now, doneAt: now + r.ms * qty };
    f.jobs.push(job);
    this.persist(m, undefined, true);
    return job;
  }
  /** Move every finished job's output into the backpack. */
  collect(account: string | null, now: number): Stack[] {
    const m = this.signedIn(account); const k = playerKey(m.account);
    const f = this.factories.get(k); if (!f) throw new MineError('Build a factory first.');
    const done = f.jobs.filter((j) => now >= j.doneAt); if (!done.length) throw new MineError('Nothing finished yet.');
    const got: Stack[] = [];
    for (const j of done) { const r = recipeById(j.recipe); if (r) got.push({ ...r.out, qty: r.out.qty * j.qty }); }
    f.jobs = f.jobs.filter((j) => now < j.doneAt);
    const p = this.pack(k);
    for (const s of got) { const key = stackKey(s); const cur = p.get(key); if (cur) cur.qty += s.qty; else p.set(key, { ...s }); }
    this.persist(m, undefined, true);
    return got;
  }

  // ------------------------------------------------------------ Market hook (stackable listings)
  /** Current qty of one stack for an account (online or offline). */
  stackQty(account: string, type: ItemType, id: string): number { this.beforeStorage?.(account); return this.pack(playerKey(account)).get(stackKey({ type, id }))?.qty ?? 0; }
  /** Move qty into (+) or out of (-) an account's pack and persist the pack plus `extra` rows in ONE transaction (queued in order with every other pack save).
   * Returns false (no change) if a withdrawal would go negative. Without a store, `fallback` gets the rows instead. */
  /** Weight of an account's stored pack (same units as BACKPACK_CAP). */
  packLoad(account: string): number { let t = 0; for (const s of this.pack(playerKey(account)).values()) t += s.qty * (s.type === 'ore' && isOre(s.id) ? ORES[s.id].weight : 1); return t; }
  adjustStack(account: string, type: ItemType, id: string, delta: number, extra: Array<{ sql: string; args: unknown[] }> = [], fallback?: (rows: Array<{ sql: string; args: unknown[] }>) => void, opts: { after?: Promise<unknown>; bind?: (p: Promise<unknown>) => void; onFail?: (e: Error) => void } = {}): boolean {
    return this.adjustStacks(account, [{ type, id, delta }], extra, fallback, opts);
  }
  /** Several stack deltas, all-or-nothing (false and no change if any withdrawal would go negative), one transaction. */
  adjustStacks(account: string, deltas: Array<{ type: ItemType; id: string; delta: number }>, extra: Array<{ sql: string; args: unknown[] }> = [], fallback?: (rows: Array<{ sql: string; args: unknown[] }>) => void, opts: { after?: Promise<unknown>; bind?: (p: Promise<unknown>) => void; onFail?: (e: Error) => void } = {}): boolean {
    this.beforeStorage?.(account);
    const k = playerKey(account); const p = this.pack(k);
    const sum = new Map<string, { type: ItemType; id: string; delta: number }>();
    for (const d of deltas) { if (!Number.isInteger(d.delta)) return false; const key = stackKey(d); const c = sum.get(key); if (c) c.delta += d.delta; else sum.set(key, { ...d }); }
    for (const [key, d] of sum) if ((p.get(key)?.qty ?? 0) + d.delta < 0) return false;
    const apply = (sign: number) => { for (const [key, d] of sum) { const n = (p.get(key)?.qty ?? 0) + sign * d.delta; if (n <= 0) p.delete(key); else p.set(key, { type: d.type, id: d.id, qty: n }); } };
    apply(1);
    this.names.set(k, account.trim());
    if (!this.store) { fallback?.(extra); return true; }
    const snap = [...p.values()].map((s) => ({ ...s })); const store = this.store;
    // Retried (every row is idempotent: absolute snapshots + ON CONFLICT ledger keys) so a blip can't lose a paid-for delivery.
    const run = async () => { await opts.after; for (let i = 0; ; i++) { try { return await store.save(k, account.trim(), snap, undefined, undefined, extra); } catch (e) { if (i >= 3) throw e; await new Promise((r) => setTimeout(r, 250 * 2 ** i)); } } };
    const job = this.chain.then(run);
    this.chain = job.catch((e) => {
      console.error('[mines] save failed:', (e as Error).message);
      if (!opts.onFail) return;
      // Nothing committed: undo the in-memory deltas so memory matches the DB, then let the caller undo its side.
      apply(-1);
      try { opts.onFail(e as Error); } catch (err) { console.error('[mines] rollback failed:', (err as Error).message); }
    });
    opts.bind?.(this.chain);
    return true;
  }

  nodesView(now: number, cave: CaveId = 'mine', floor = 1) { return this.nodeStates(cave, floor).map((n) => (this.nodeAvailable(n, now) ? n.hp : -1)); }
  private skinCache = new Map<string, { pk: string | null; at: number }>();
  /** Equipped pickaxe skin for third-person rendering (cached 5s; guests = stock). */
  private pickSkin(m: Miner): string | null {
    if (!m.account) return null;
    const now = Date.now(); const c = this.skinCache.get(m.id);
    if (c && now - c.at < 5000) return c.pk;
    let pk: string | null = null;
    try { pk = (getVault()?.loadout(m.account) as Record<string, string | undefined> | undefined)?.pickaxe ?? null; } catch { pk = null; }
    this.skinCache.set(m.id, { pk, at: now }); return pk;
  }
  playersView(cave?: CaveId, floor?: number) { return [...this.miners.values()].filter((m) => (!cave || m.cave === cave) && (floor === undefined || m.floor === floor)).map((m) => ({ id: m.id, name: m.name, x: +m.x.toFixed(2), y: +m.y.toFixed(2), z: +m.z.toFixed(2), a: +m.a.toFixed(3), p: +m.p.toFixed(3), c: !!m.crouch, sw: m.lastHit, pk: this.pickSkin(m), tl: this.toolOf(m.account), hp: Math.round(m.hp), mhp: this.maxHp(m), wp: this.gearOf(m.account).weapon, at: m.lastAttack })); }
}

let world = new MinesWorld();
export const getMines = () => world;
export function resetMines() { world = new MinesWorld(); return world; }

export async function initMinesStorage(): Promise<void> {
  const url = databaseUrl(); if (!url) { console.warn('[mines] no DATABASE_URL; mines in memory only'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  await attachWithRetry(world, () => new PgMineStore(pool), () => setMinesBoard(new MinesLeaderboard(pool)));
}

/**
 * Neon cold starts often time out the first connect. A failed attach used to leave the instance running mines from
 * empty memory: every factory and banked stack looked deleted. Now: retry, and while still down stay `offline`
 * (signed-in storage/factory actions refuse) and keep retrying in the background until the real rows are loaded.
 */
export async function attachWithRetry(w: MinesWorld, mk: () => MineStore, onOk: () => void = () => {}, opts: { tries?: number; delayMs?: number; retryMs?: number } = {}): Promise<boolean> {
  const tries = opts.tries ?? 4; const delay = opts.delayMs ?? 2000; const retryMs = opts.retryMs ?? 15_000;
  w.offline = true;
  const ok = () => { console.log('[mines] connected to postgres'); onOk(); return true; };
  for (let i = 0; i < tries; i++) {
    if (await w.attach(mk())) return ok();
    if (i < tries - 1) await new Promise((r) => setTimeout(r, delay * 2 ** i));
  }
  console.error('[mines] still offline: storage and factories refuse until postgres connects (retrying)');
  const t = setInterval(() => { void w.attach(mk()).then((a) => { if (a) { clearInterval(t); ok(); } }); }, retryMs); t.unref?.();
  return false;
}

/** Socket room per cave, and per floor for The Mine below floor 1. */
export const roomOf = (c: CaveId, floor = 1) => (hasFloors(c) && floor > 1 ? `mines:${c}:f${floor}` : `mines:${c}`);
const roomOfM = (m: { cave: CaveId; floor: number }) => roomOf(m.cave, m.floor);
const MAX_MINERS = 24;
let ticker: ReturnType<typeof setInterval> | null = null;
type Ack = (r: Record<string, unknown>) => void;
const body = (p: unknown) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {});

const floorMsg = (m: Miner) => ({ floor: m.floor, deepest: world.deepestOf(m), stops: hasFloors(m.cave) ? elevatorStops(world.deepestOf(m)) : [], hp: Math.round(m.hp), maxHp: world.maxHp(m), nodes: world.nodesView(Date.now(), m.cave, m.floor), x: m.x, y: m.y, z: m.z });
function ensureTicker(io: Server) {
  if (ticker) return;
  ticker = setInterval(() => {
    if (!world.miners.size) { clearInterval(ticker!); ticker = null; return; }
    const now = Date.now();
    const { hurt, died } = world.tickMobs(now);
    for (const h of hurt) io.to(h.id).emit('mines_hurt', h);
    for (const d of died) {
      for (const s of io.sockets.sockets.get(d.id)?.rooms ?? []) if (s.startsWith('mines:')) void io.sockets.sockets.get(d.id)?.leave(s);
      void io.sockets.sockets.get(d.id)?.join(d.room);
      const m = world.miners.get(d.id);
      if (m) io.to(d.id).emit('mines_died', { ...floorMsg(m), lost: d.lost, pack: world.carried(d.id), load: world.load(d.id), cap: BACKPACK_CAP });
    }
    const live = new Map<string, { cave: CaveId; floor: number }>();
    for (const m of world.miners.values()) live.set(roomOfM(m), { cave: m.cave, floor: m.floor });
    for (const [room, l] of live) io.to(room).emit('mines_state', { t: now, floor: l.floor, players: world.playersView(l.cave, l.floor), nodes: world.nodesView(now, l.cave, l.floor), mobs: world.mobsView(l.floor) });
  }, 100);
  ticker.unref?.();
}

export function registerMines(io: Server, socket: Socket): void {
  const account = () => (socket.data.account as { name?: string } | undefined)?.name ?? null;
  const me = () => world.miners.get(socket.id);
  const packMsg = () => ({ pack: world.carried(socket.id), load: world.load(socket.id), cap: BACKPACK_CAP });
  const storeMsg = () => { const a = account(); if (a) world.beforeStorage?.(a); const q = a ? world.quote(a, Date.now()) : null; return { storage: a ? world.storage(a) : [], quote: q ? { gross: q.gross, paid: q.paid, already: q.already, lost: q.lost, effAlready: q.effAlready, index: priceIndex(), capBase: q.capBase, capIndex: q.capIndex } : null, inMine: a ? world.inMine(a) : false, guest: !a }; };
  socket.on('mines_join', async (p: unknown, ack?: Ack) => {
    let m = me();
    const want = caveOf(body(p).cave).id;
    if (want === 'coral' && !isAtResort(account())) return ack?.({ ok: false, error: 'The Coral Grotto is at Chud Resort. Fly there from Chud Hub International.' });
    if (m && !m.account && account()) { const room = roomOfM(m); world.leave(socket.id); void socket.leave(room); m = undefined; } // signed in after joining as a guest: rejoin as the account so the saved haul loads
    if (m && m.cave !== want) {
      // Switching caves on the same socket (or a join that beat the old leave): move to the new cave's spawn.
      // Keeping the old miner would validate every step against the OTHER cave's walls (rubber-banding into
      // invisible walls, walking through real ones) and start the player at a spot that is inside rock here.
      void socket.leave(roomOfM(m));
      world.moveToCave(m, want);
      void socket.join(roomOfM(m));
    }
    if (!m) {
      if (world.miners.size >= MAX_MINERS) return ack?.({ ok: false, error: 'The mine is full, try again in a bit.' });
      m = world.join(socket.id, account(), Date.now(), want);
      void socket.join(roomOfM(m));
    }
    ensureTicker(io);
    if (m.restoring) { try { await m.restoring; } catch (e) { return ack?.({ ok: false, error: (e as Error).message }); } if (world.miners.get(socket.id) !== m) return ack?.({ ok: false, error: 'Left the mine.' }); }
    ack?.({ ok: true, swingMs: world.swingMsFor(m.account), tool: world.toolOf(m.account), id: socket.id, name: m.name, guest: !m.account, cave: m.cave, a: m.a, ...floorMsg(m), ...packMsg() });
  });
  socket.on('mines_move', (p: unknown) => {
    const b = body(p);
    if (world.move(socket.id, b.x, b.y, b.z, b.a, b.p, b.c, b.s, Date.now())) { const m = me()!; socket.emit('mines_correct', { x: m.x, y: m.y, z: m.z }); }
  });
  socket.on('mines_hit', (p: unknown, ack?: Ack) => {
    try {
      const r = world.hit(socket.id, body(p).node, Date.now());
      if (r.broke && r.ore) awardXp(account(), 'mining', ORES[r.ore].hits * 5); // XP scales with ore hardness
      let drop: { kind: string; id: string } | undefined;
      const mm = me();
      if (r.broke && r.ore && mm?.account) {
        try {
          const now = Date.now();
          const it = getVault().dropForMine(mm.account, `mine-drop:${playerKey(mm.account)}:${mm.cave}${mm.floor > 1 ? `-f${mm.floor}` : ''}:${r.node}:${now}`, `${r.ore} in ${mm.cave}${mm.floor > 1 ? ` floor ${mm.floor}` : ''}`);
          if (it) drop = { kind: it.kind, id: it.id };
        } catch (e) { console.warn('[mines] drop skipped:', (e as Error).message); }
      }
      socket.to(roomOfM(me()!)).emit('mines_fx', { node: r.node, hp: r.hp, broke: r.broke, by: socket.id });
      ack?.({ ok: true, ...r, swingMs: world.swingMsFor(account()), ...(r.broke ? packMsg() : {}), ...(drop ? { drop } : {}) });
    } catch (e) { ack?.({ ok: false, error: (e as Error).message }); }
  });
  socket.on('mines_pack', (_p: unknown, ack?: Ack) => ack?.({ ok: true, ...packMsg() }));
  // Floors (Millionaire Update #13): ladder down, elevator, weapon attacks.
  const changeFloor = (fn: (m: Miner) => void) => (p: unknown, ack?: Ack) => {
    try {
      const m = me(); if (!m) throw new MineError('Join the mine first.');
      const before = roomOfM(m); fn(m); const after = roomOfM(m);
      if (before !== after) { void socket.leave(before); io.to(before).emit('mines_left', { id: socket.id }); void socket.join(after); }
      ack?.({ ok: true, ...floorMsg(m), ...packMsg() });
    } catch (e) { ack?.({ ok: false, error: (e as Error).message }); }
    void p;
  };
  socket.on('mines_descend', (p: unknown, ack?: Ack) => changeFloor(() => world.descend(socket.id, Date.now()))(p, ack));
  socket.on('mines_elevator', (p: unknown, ack?: Ack) => changeFloor(() => world.ride(socket.id, body(p).floor, Date.now()))(p, ack));
  socket.on('mines_attack', (p: unknown, ack?: Ack) => {
    try {
      const r = world.attack(socket.id, body(p).mob, Date.now());
      if (r.killed) { const m = me(); const f = m?.floor ?? 1; const lst = world.floorMobs.get(f)?.[r.mob]; awardXp(account(), 'mining', lst ? MOBS[lst.kind].xp : 5); }
      socket.to(roomOfM(me()!)).emit('mines_mobfx', { mob: r.mob, hp: r.hp, killed: r.killed, by: socket.id });
      ack?.({ ok: true, ...r, ...(r.loot?.length ? packMsg() : {}) });
    } catch (e) { ack?.({ ok: false, error: (e as Error).message }); }
  });
  socket.on('mines_exit', (_p: unknown, ack?: Ack) => {
    try { const r = world.exit(socket.id); ack?.({ ok: true, ...r, ...packMsg() }); }
    catch (e) { ack?.({ ok: false, error: (e as Error).message }); }
  });
  const safe = (fn: () => Record<string, unknown>) => (_p: unknown, ack?: Ack) => { try { ack?.({ ok: true, ...fn() }); } catch (e) { ack?.({ ok: false, offline: world.offline, error: (e as Error).message }); } };
  socket.on('mines_storage', safe(() => storeMsg()));
  socket.on('mines_sell', (p: unknown, ack?: Ack) => {
    try { const r = world.sell(account(), Date.now(), body(p).ore, body(p).qty); ack?.({ ok: true, ...r, ...storeMsg() }); }
    catch (e) { ack?.({ ok: false, error: (e as Error).message }); }
  });
  const fact = () => ({ factory: world.factoryView(account(), Date.now()) });
  const fx = (fn: () => unknown) => (_p: unknown, ack?: Ack) => {
    try { const r = fn(); ack?.({ ok: true, result: r, ...fact(), ...storeMsg() }); }
    catch (e) { ack?.({ ok: false, error: (e as Error).message }); }
  };
  socket.on('mines_factory', safe(() => ({ ...fact(), ...storeMsg() })));
  // Retired (Factory v2): stale clients must not start, collect or upgrade old timed jobs. Opening v2 migrates any old jobs first.
  const gone = (_p: unknown, ack?: Ack) => { const a = account(); if (world.offline) return ack?.({ ok: false, offline: true, error: MINES_OFFLINE_MSG }); if (a) world.beforeStorage?.(a); ack?.({ ok: false, gone: true, status: 410, error: 'The old factory was replaced. Open the Factory tab to build with machines and belts.', ...storeMsg() }); };
  socket.on('mines_factory_upgrade', gone);
  socket.on('mines_collect', gone);
  socket.on('mines_craft', gone);
  const leave = () => { const m = me(); if (m) { const room = roomOfM(m); world.leave(socket.id); void socket.leave(room); io.to(room).emit('mines_left', { id: socket.id }); } };
  socket.on('mines_leave', leave);
  socket.on('disconnect', leave);
}

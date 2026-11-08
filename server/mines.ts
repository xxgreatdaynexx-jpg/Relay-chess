import { outcome , setDefaultCityPack, OutcomeUnknown } from './locstock.js';
import { randomUUID } from 'node:crypto';
/** Mines: shared first-person cave. Server-authoritative nodes, backpacks (generic item stacks) and house selling. */
import { houseSellPrice } from '../shared/sellBuff.js';
import { sellCapMul } from './coop-perks.js';
import { cityPolicyMul } from './city-rates.js';
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
import { isAtFortMc, isAtResort } from './travel.js';
import { levelOf, hasFloors, floorKey, inLadder, canRideTo, respawnFloor, elevatorStops, MAX_FLOOR, clampFloor } from '../shared/mineFloors.js';
import { newAI, stepAI, onHurt, ST_CODE, SHOT_HIT_R, SHOT_LIFE_MS, MINI_HP, MINI_DMG, SPLIT_N, BOSS_MOVE_NAMES, type AIMob, type AIEvent } from '../shared/mineAI.js';
import { MOBS, MOB_RESPAWN_MS, mobSkin, SAFE_X, mobCount, mobDmg, mobHp, mobKindAt, lootCount, hitThrough, maxHpOf, weaponDef, lostOnDeath, REGEN_AFTER_MS, REGEN_PER_S, type MobKind, type WeaponId, type ArmorId } from '../shared/mineCombat.js';
import { oreFor, mineHash } from '../shared/mines.js';
import { raidHpMul, raidDmgMul, raidBossHpMul, raidPotSize, lootRoll, type RaidLootMsg } from '../shared/mineRaids.js';
import { sinkLostToday } from './sink-room.js';
import { effectiveAlready } from '../shared/sinkRoom.js';
import { houseCapIndex, HOUSE_SELL_BLOCKED } from './house-cap-index.js';
import { eventCredit, eventTrade } from './weeklyEvent.js';
import { getLocStore, setLocStore, LocStore } from './locstock.js';
import { getLocMoves } from './locmoves.js';
import { WAREHOUSE } from '../shared/inventoryLocations.js';

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
  `ALTER TABLE mine_banks ADD COLUMN IF NOT EXISTS bank_id TEXT`, // idempotent bank marker: reconciles a lost commit acknowledgement
  // Co-op raids: one row per party-boss group loot roll (PK = the kill), written in the same transaction as every member's carried haul.
  `CREATE TABLE IF NOT EXISTS mine_raid_rolls (id TEXT PRIMARY KEY, party TEXT NOT NULL, cave TEXT NOT NULL, floor INTEGER NOT NULL, winner TEXT, rolls JSONB NOT NULL, pot JSONB NOT NULL, at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS mine_jobs (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, machine TEXT NOT NULL, recipe TEXT NOT NULL, qty INTEGER NOT NULL, start_at BIGINT NOT NULL, done_at BIGINT NOT NULL)`,
];
export interface FactoryState { level: number; builtAt: number; jobs: Job[] }

export interface MineStore { init(): Promise<void>; load(): Promise<{ items: Array<{ key: string; name: string; type: ItemType; id: string; qty: number }>; daily: Array<{ key: string; day: string; gross: number; paid: number }>; factories?: Array<{ key: string } & FactoryState>; carried?: Array<{ key: string; name: string; stacks: Stack[] }>; fv2?: Array<{ key: string; name?: string; data: unknown }> }>; saveCarried?(key: string, name: string, stacks: Stack[]): Promise<void>; loadCarried?(key: string): Promise<Stack[]>; save(key: string, name: string, stacks: Stack[], sale?: { day: string; gross: number; paid: number; items: string; ledgerKey: string; at: number; dayGross: number; dayPaid: number }, factory?: FactoryState, extra?: Array<{ sql: string; args: unknown[] }>): Promise<void> }

export class PgMineStore implements MineStore {
  constructor(private readonly db: Queryable & { connect?: () => Promise<pg.PoolClient> }) { db.on?.('error', (e) => console.error('[mines] pool error:', e.message)); }
  async init() { for (const q of MINES_MIGRATION) await this.db.query(q); }
  /** Did a bank with this marker commit? (unknown-outcome reconcile). Throws if the database can't be asked. */
  /** Did a wallet move with this key commit? (unknown-outcome reconcile for factory machine sales). */
  async txCommitted(key: string) { return (await this.db.query('SELECT 1 FROM wallet_transactions WHERE tx_key = $1', [key])).rows.length > 0; }
  async banked(id: string) { return (await this.db.query('SELECT 1 FROM mine_banks WHERE bank_id = $1', [id])).rows.length > 0; }
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
let depthHook: { get: (account: string, cave?: CaveId) => number; record: (account: string, floor: number, cave?: CaveId) => void } = { get: () => 1, record: () => {} };
export const setMineGearHooks = (g: typeof gearHook, d: typeof depthHook) => { gearHook = g; depthHook = d; };
export interface MobState extends AIMob { deadUntil: number; /** raid instance: party size it was scaled for */ party?: number; /** kills so far (raid roll id) */ lives?: number; /** summoned/split mobs never respawn */ gone?: boolean; parent?: number }
export interface Shot { x: number; y: number; vx: number; vy: number; dmg: number; until: number; by: number; id: number }
/** Area/phase effects since the last broadcast (client draws the burst / banner). */
export interface MobFx { k: 'aoe' | 'phase' | 'split' | 'summon'; x: number; y: number; r?: number; phase?: number; name?: string; by: number }
/** Debounce for carried-haul saves, and how long a haul restored after a restart waits for its owner. */
export const CARRY_SAVE_MS = 1500;
/** Shown while the mines DB is configured but not connected: never serve (or overwrite) storage/factories from empty memory. */
export const MINES_OFFLINE_MSG = 'Mines storage is reconnecting. Your factory and storage are safe, try again in a minute.';
export const RESTART_GRACE_MS = 10 * 60_000;

interface Miner extends Body { restoring?: Promise<void>; id: string; name: string; account: string | null; a: number; p: number; lastMove: number; carry: number; lastHit: number; hits: number[]; sprint: boolean; carried: Map<string, Stack>; cave: CaveId; floor: number; hp: number; lastHurt: number; lastAttack: number; deepest: number; lastFloorMove: number; /** co-op raid instance (`p:<party>`); unset = the public mine */ inst?: string }
interface NodeState { node: MineNode; hp: number; downUntil: number }

/** Floor key inside a raid instance (public floors keep the plain floorKey). */
export const instKey = (fk: number | string, inst?: string): number | string => (inst ? `${inst}|${fk}` : fk);
export interface RaidKill { mob: number; shared: Array<{ id: string; loot: Stack[] }>; roll?: RaidLootMsg & { id: string } }

export class MinesWorld {
  /** Co-op raids (server/mineRaids.ts installs these): party size of an instance, and the instance an account belongs to. */
  raidSize: (inst: string) => number = () => 1;
  raidOf: (account: string | null) => string | undefined = () => undefined;
  /** Rolls already paid out (kill ids): a replayed or duplicated kill never rolls twice. */
  raidRolled = new Set<string>();
  /** Personal veins: in a raid every member has their own copy of each rock. */
  nodeInst(m: Miner) { return m.inst ? `${m.inst}:${this.packKey(m)}` : undefined; }
  /** Miners in the same raid instance on this floor. */
  partyHere(m: Miner) { return [...this.miners.values()].filter((o) => o.inst && o.inst === m.inst && o.cave === m.cave && o.floor === m.floor); }
  /** Raid elevator: any stop a party member in this cave has reached. */
  raidDeepest(m: Miner) { let d = this.deepestOf(m); if (m.inst) for (const o of this.miners.values()) if (o.inst === m.inst && o.cave === m.cave) d = Math.max(d, this.deepestOf(o)); return d; }
  /** Move a miner into (inst) or out of (undefined) a raid instance: back to the lift of the same floor. True if it changed. */
  setInst(m: Miner, inst: string | undefined, now = Date.now()): boolean {
    if ((m.inst ?? '') === (inst ?? '')) return false;
    m.inst = inst; this.setFloor(m, m.floor, now); return true;
  }
  /** Forget an empty raid instance's rocks, creatures and shots. */
  dropInstance(inst: string) {
    for (const mp of [this.floorNodes, this.floorMobs, this.floorShots, this.floorFx] as Array<Map<number | string, unknown>>) for (const k of [...mp.keys()]) if (typeof k === 'string' && (k.startsWith(`${inst}|`) || k.startsWith(`${inst}:`))) mp.delete(k);
  }
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
  floorNodes = new Map<number | string, NodeState[]>();
  /** Creatures per floor (floor 3+), created on first visit; they only act while someone is on that floor. */
  floorMobs = new Map<number | string, MobState[]>();
  floorShots = new Map<number | string, Shot[]>();
  floorFx = new Map<number | string, MobFx[]>();
  private shotSeq = 1;
  /** Add a temporary creature (slime split, boss summon) reusing a gone slot so mob ids stay list indices. */
  spawnMini(list: MobState[], kind: MobKind, x: number, y: number, max: number, dmg: number, parent: number, now: number): MobState {
    let id = list.findIndex((b) => b.gone && b.deadUntil); if (id < 0) id = list.length;
    const b: MobState = { ...newAI(id, kind, x, y, Math.max(1, Math.round(max)), Math.max(1, Math.round(dmg))), deadUntil: 0, mini: true, parent };
    b.st = 'stagger'; b.stAt = now; b.stUntil = now + 400; list[id] = b; return b;
  }
  gearOf: (account: string | null) => { weapon: WeaponId; armor: ArmorId } = (a) => gearHook(a);
  deepestOf(m: Miner) { return Math.max(m.deepest, m.account ? depthHook.get(m.account, m.cave) : 1); }
  maxHp(m: Miner) { return maxHpOf(this.gearOf(m.account).armor); }
  mapOf(m: Miner) { return levelOf(m.cave, m.floor).map; }
  nodeStates(cave: CaveId, floor = 1, inst?: string): NodeState[] {
    const top = !hasFloors(cave) || floor <= 1;
    if (top && !inst) return this.caveNodes[cave];
    const fk = instKey(floorKey(cave, top ? 1 : floor), inst); let n = this.floorNodes.get(fk);
    if (!n) { n = (top ? CAVES[cave].nodes : levelOf(cave, floor).nodes).map((node) => ({ node, hp: ORES[node.ore].hits, downUntil: 0 })); this.floorNodes.set(fk, n); }
    return n;
  }
  mobsOn(floor: number, cave: CaveId = 'mine', inst?: string): MobState[] {
    const fk = instKey(floorKey(cave, floor), inst); let list = this.floorMobs.get(fk);
    const n0 = inst ? this.raidSize(inst) : 1;
    if (list) return list;
    list = [];
    const map = levelOf(cave, floor).map; const n = mobCount(floor); const salt = cave === 'mine' ? 0 : cave.charCodeAt(0) * 101;
    const spots: Array<[number, number]> = [];
    for (let y = 1; y < map.d / 2 - 1; y++) for (let x = 10; x < map.w / 2 - 2; x++) if (canStand(x * 2 + 1, y * 2 + 1, 0, map)) spots.push([x * 2 + 1, y * 2 + 1]);
    for (let i = 0; i < n && spots.length; i++) {
      const [x, y] = spots[Math.floor(mineHash(floor * 4243 + i * 31 + salt) * spots.length)];
      const kind = mobKindAt(floor, i, mineHash(floor * 977 + i * 13));
      // raid instance: scaled with the party size when the floor is first opened (respawns keep it)
      const max = Math.round(mobHp(kind, floor) * (kind === 'boss' ? raidBossHpMul(n0) : raidHpMul(n0))); const dmg = Math.round(mobDmg(kind, floor) * raidDmgMul(n0));
      list.push({ ...newAI(i, kind, x, y, max, dmg), deadUntil: 0, ...(n0 > 1 ? { party: n0 } : {}) });
    }
    this.floorMobs.set(fk, list);
    return list;
  }
  /** Put a miner on a floor of The Mine, at the lift. */
  setFloor(m: Miner, floor: number, now = Date.now()) {
    const f = clampFloor(floor); const sp = levelOf(m.cave, f).map.spawns; const p = sp[this.miners.size % sp.length];
    Object.assign(m, { floor: f, x: p[0], y: p[1], z: 0, vz: 0, grounded: true, crouch: false, carry: 0, lastMove: now, lastFloorMove: now });
    if (f > m.deepest) m.deepest = f;
    if (m.account && f > 1) depthHook.record(m.account, f, m.cave);
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
    if (!canRideTo(f, this.raidDeepest(m))) throw new MineError('Reach that floor first.');
    if (now - m.lastFloorMove < 800) throw new MineError('Too fast.');
    this.setFloor(m, f, now);
    return m.floor;
  }
  /** Weapon swing at a creature: weapon cooldown, reach (eye to the creature's body) and line of sight. */
  attack(id: string, mobId: unknown, now: number): { mob: number; hp: number; killed: boolean; dmg: number; loot?: Stack[]; raid?: RaidKill } {
    const m = this.miners.get(id); if (!m) throw new MineError('Join the mine first.');
    if (m.restoring) throw new MineError('Loading your backpack...');
    const list = this.floorMobs.get(instKey(floorKey(m.cave, m.floor), m.inst));
    const mob = hasFloors(m.cave) && list && typeof mobId === 'number' ? list[mobId] : undefined;
    if (!mob || mob.deadUntil) throw new MineError('Nothing to hit.');
    const w = weaponDef(this.gearOf(m.account).weapon);
    if (now - m.lastAttack < w.ms - 80) throw new MineError('Too fast.');
    const def = MOBS[mob.kind]; const eye = { x: m.x, y: m.y, z: m.z + eyeHeightOf(m) }; const c = { x: mob.x, y: mob.y, z: def.z };
    if (Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z) - def.radius > w.reach) throw new MineError('Too far.');
    if (!lineOfSight(eye, c, this.mapOf(m))) throw new MineError('Something is in the way.');
    m.lastAttack = now; m.lastHurt = Math.max(m.lastHurt, now - REGEN_AFTER_MS + 2000);
    mob.hp = Math.max(0, mob.hp - w.dmg);
    if (mob.hp > 0) { onHurt(mob, now, id); return { mob: mob.id, hp: mob.hp, killed: false, dmg: w.dmg }; }
    mob.deadUntil = mob.mini ? now + 1 : now + MOB_RESPAWN_MS; mob.tel = null; if (mob.mini) mob.gone = true;
    if (mob.mini && mob.parent !== undefined && list![mob.parent]) list![mob.parent].adds = Math.max(0, (list![mob.parent].adds ?? 1) - 1);
    if (mob.kind === 'slime' && !mob.mini) { // slimes split into two small ones
      for (let i = 0; i < SPLIT_N; i++) { const a = mob.a + Math.PI / 2 + i * Math.PI; const ox = mob.x + Math.cos(a) * 0.5, oy = mob.y + Math.sin(a) * 0.5; const ok = canStand(ox, oy, 0, this.mapOf(m)) && ox >= SAFE_X;
        this.spawnMini(list!, 'slime', ok ? ox : mob.x, ok ? oy : mob.y, mob.max * MINI_HP, mob.dmg * MINI_DMG, mob.id, now); }
      this.pushFx(m.cave, m.floor, { k: 'split', x: mob.x, y: mob.y, by: mob.id }, m.inst);
    }
    // loot: ore rolled from this floor's mix, only what fits in the backpack
    const lvl = levelOf(m.cave, m.floor);
    const loot = this.giveOre(m, lootCount(m.floor), () => oreFor(3, this.bonusRng(), lvl.bias, lvl.anyDepth));
    mob.lives = (mob.lives ?? 0) + 1;
    if (!m.inst) return { mob: mob.id, hp: 0, killed: true, dmg: w.dmg, loot };
    // Raid: every member on the floor gets their own loot (nobody's drop is taken from anyone else), all in this one synchronous step.
    const here = this.partyHere(m); const raid: RaidKill = { mob: mob.id, shared: [] };
    for (const o of here) if (o !== m && !o.restoring) raid.shared.push({ id: o.id, loot: this.giveOre(o, lootCount(m.floor), () => oreFor(3, this.bonusRng(), lvl.bias, lvl.anyDepth)) });
    // Party boss: group loot roll for the bonus pot, once per kill (replay-safe id), committed with every member's haul in one transaction.
    if (mob.kind === 'boss' && !mob.mini && (mob.party ?? 1) > 1) {
      const rid = `raid:${m.inst}:${m.cave}:${m.floor}:${mob.id}:${mob.lives}`;
      if (!this.raidRolled.has(rid)) {
        this.raidRolled.add(rid);
        const eligible = here.filter((o) => o.account && !o.restoring);
        const { rolls, winner } = lootRoll(eligible.map((o) => o.account!), () => this.bonusRng());
        const wm = eligible.find((o) => o.account === winner);
        const pot = wm ? this.giveOre(wm, raidPotSize(mob.party ?? 1, m.floor), () => oreFor(4, this.bonusRng(), lvl.bias, lvl.anyDepth)) : [];
        raid.roll = { id: rid, floor: m.floor, boss: mobSkin(m.cave, 'boss').name, rolls, winner: winner ?? null, pot: pot.map((s) => ({ id: s.id, qty: s.qty })) };
        this.commitRaid(rid, m, eligible, raid.roll);
      }
    }
    return { mob: mob.id, hp: 0, killed: true, dmg: w.dmg, loot, raid };
  }
  /** Add up to n ore to a miner's carried haul (only what fits). */
  giveOre(m: Miner, n: number, pick: () => OreId): Stack[] {
    const loot: Stack[] = [];
    for (let i = 0; i < n; i++) {
      const ore = pick();
      if (this.load(m.id) + ORES[ore].weight > BACKPACK_CAP) break;
      const key = `ore:${ore}`; const cur = m.carried.get(key); if (cur) cur.qty += 1; else m.carried.set(key, { type: 'ore', id: ore, qty: 1 });
      const l = loot.find((s) => s.id === ore); if (l) l.qty++; else loot.push({ type: 'ore', id: ore, qty: 1 });
    }
    if (loot.length && m.account) this.markCarried(playerKey(m.account));
    return loot;
  }
  /** One transaction: the roll row (PK = kill id, a replay is a no-op) plus every member's carried-haul snapshot. */
  private commitRaid(rid: string, by: Miner, members: Miner[], roll: RaidLootMsg) {
    const store = this.store; if (!store || !by.account) return;
    const rows: Array<{ sql: string; args: unknown[] }> = [{ sql: 'INSERT INTO mine_raid_rolls (id, party, cave, floor, winner, rolls, pot, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING', args: [rid, by.inst ?? '', by.cave, by.floor, roll.winner, JSON.stringify(roll.rolls), JSON.stringify(roll.pot), Date.now()] }];
    for (const o of members) {
      const k = playerKey(o.account!); const t = this.carryTimers.get(k); if (t) { clearTimeout(t); this.carryTimers.delete(k); }
      rows.push({ sql: `INSERT INTO mine_carried (player_key, owner_name, items, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (player_key) DO UPDATE SET owner_name = EXCLUDED.owner_name, items = EXCLUDED.items, updated_at = now()`, args: [k, o.account, JSON.stringify(this.carriedOf(k))] });
    }
    const k = playerKey(by.account); try { this.pack(k); } catch { return; }
    this.chain = this.chain.then(() => store.save(k, by.account!, this.snapNow(k), undefined, undefined, rows)).catch((e) => console.error('[mines] raid save failed:', (e as Error).message));
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
  tickMobs(now: number): { hurt: Array<{ id: string; hp: number; max: number; dmg: number; by: number; kx?: number; ky?: number }>; died: Array<{ id: string; floor: number; lost: Stack[]; room: string }> } {
    const dt = Math.min(0.25, this.lastMobTick ? (now - this.lastMobTick) / 1000 : 0.1); this.lastMobTick = now;
    const hurt: Array<{ id: string; hp: number; max: number; dmg: number; by: number; kx?: number; ky?: number }> = []; const died: Array<{ id: string; floor: number; lost: Stack[]; room: string }> = [];
    const byFloor = new Map<number | string, { cave: CaveId; floor: number; inst?: string; miners: Miner[] }>();
    for (const m of this.miners.values()) {
      const max = this.maxHp(m); if (m.hp > max) m.hp = max;
      if (m.hp < max && now - m.lastHurt > REGEN_AFTER_MS) m.hp = Math.min(max, m.hp + REGEN_PER_S * dt);
      if (inExit(m.x, m.y)) m.hp = max; // the lift heals you
      if (hasFloors(m.cave) && m.floor >= 3) { const fk = instKey(floorKey(m.cave, m.floor), m.inst); const l = byFloor.get(fk) ?? { cave: m.cave, floor: m.floor, inst: m.inst, miners: [] }; l.miners.push(m); byFloor.set(fk, l); }
    }
    for (const { cave, floor, inst, miners } of byFloor.values()) {
      const map = levelOf(cave, floor).map; const fk = instKey(floorKey(cave, floor), inst);
      const env = { canStand: (x: number, y: number) => canStand(x, y, 0, map), los: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => lineOfSight({ x: ax, y: ay, z: az }, { x: bx, y: by, z: bz }, map), rng: () => this.bonusRng(), model: undefined as ReturnType<typeof mobSkin>['model'] | undefined };
      const targets = miners.filter((m) => m.hp > 0).map((m) => ({ id: m.id, x: m.x, y: m.y, z: m.z }));
      const byId = new Map(miners.map((m) => [m.id, m]));
      const hit = (mid: string, raw: number, by: number, kx = 0, ky = 0) => {
        const best = byId.get(mid); if (!best || best.hp <= 0 || best.x < SAFE_X) return;
        const dmg = hitThrough(raw, this.gearOf(best.account).armor);
        best.hp -= dmg; best.lastHurt = now;
        if (best.hp > 0 && (kx || ky)) { // knockback: server moves the miner (client mirrors kx/ky from mines_hurt); stops at rock / the lift line
          const k = Math.hypot(kx, ky), n = Math.ceil(k / 0.25); let ax = 0, ay = 0;
          for (let j = 1; j <= n; j++) { const nx = best.x + (kx * j) / n, ny = best.y + (ky * j) / n; if (nx < SAFE_X || !canStand(nx, ny, best.z, map)) break; ax = (kx * j) / n; ay = (ky * j) / n; }
          best.x += ax; best.y += ay; kx = ax; ky = ay; const t = targets.find((q) => q.id === best.id); if (t) { t.x = best.x; t.y = best.y; }
        }
        if (best.hp <= 0) { const r = this.die(best, now); died.push({ id: best.id, ...r, room: roomOf(best.cave, best.floor, best.inst) }); }
        else hurt.push({ id: best.id, hp: Math.round(best.hp), max: this.maxHp(best), dmg, by, kx: +kx.toFixed(2), ky: +ky.toFixed(2) });
      };
      const list = this.mobsOn(floor, cave, inst); const shots = this.floorShots.get(fk) ?? []; this.floorShots.set(fk, shots);
      for (let i = 0; i < list.length; i++) {
        const mob = list[i];
        if (mob.deadUntil) { if (mob.gone || now < mob.deadUntil) continue; Object.assign(mob, newAI(mob.id, mob.kind, mob.hx, mob.hy, mob.max, mob.dmg), { deadUntil: 0 }); }
        env.model = mobSkin(cave, mob.kind).model;
        for (const e of stepAI(mob, targets, now, dt, env) as AIEvent[]) {
          if (e.t === 'hit') hit(e.target, e.dmg, e.by, e.kx, e.ky);
          else if (e.t === 'shot') shots.push({ x: e.x, y: e.y, vx: e.vx, vy: e.vy, dmg: e.dmg, until: now + SHOT_LIFE_MS, by: e.by, id: this.shotSeq++ });
          else if (e.t === 'aoe') this.pushFx(cave, floor, { k: 'aoe', x: e.x, y: e.y, r: e.r, by: e.by }, inst);
          else if (e.t === 'phase') this.pushFx(cave, floor, { k: 'phase', x: mob.x, y: mob.y, phase: e.phase, by: e.by }, inst);
          else if (e.t === 'summon') {
            const tier = this.summonKind(floor);
            for (let n = 0; n < e.n; n++) { const a = (n / e.n) * Math.PI * 2; const ox = mob.x + Math.cos(a) * 1.4, oy = mob.y + Math.sin(a) * 1.4; const ok = ox >= SAFE_X && canStand(ox, oy, 0, map);
              const b = this.spawnMini(list, tier, ok ? ox : mob.x, ok ? oy : mob.y, mobHp(tier, floor) * 0.6, mobDmg(tier, floor) * 0.7, mob.id, now); b.target = mob.target; }
            mob.adds = (mob.adds ?? 0) + e.n;
            this.pushFx(cave, floor, { k: 'summon', x: mob.x, y: mob.y, name: BOSS_MOVE_NAMES[cave].summon, by: e.by }, inst);
          }
        }
      }
      // projectiles: fly straight, stop on rock, hit the first miner they touch (dodgeable)
      for (let i = shots.length - 1; i >= 0; i--) {
        const sh = shots[i]; sh.x += sh.vx * dt; sh.y += sh.vy * dt; let done = now >= sh.until || !canStand(sh.x, sh.y, 0, map) || sh.x < SAFE_X;
        if (!done) for (const t of targets) if (Math.hypot(t.x - sh.x, t.y - sh.y) <= SHOT_HIT_R) { const L = Math.hypot(sh.vx, sh.vy) || 1; hit(t.id, sh.dmg, sh.by, (sh.vx / L) * 0.7, (sh.vy / L) * 0.7); done = true; break; }
        if (done) shots.splice(i, 1);
      }
    }
    return { hurt, died };
  }
  /** Weakest-but-one creature open on this floor: what a boss calls in. */
  summonKind(floor: number): MobKind { return floor >= MOBS.bat.minFloor ? 'bat' : 'slime'; }
  pushFx(cave: CaveId, floor: number, f: MobFx, inst?: string) { const fk = instKey(floorKey(cave, floor), inst); const l = this.floorFx.get(fk) ?? []; l.push(f); if (l.length > 20) l.shift(); this.floorFx.set(fk, l); }
  /** Drain this floor's fx since the last broadcast. */
  takeFx(floor: number, cave: CaveId = 'mine', inst?: string): MobFx[] { const fk = instKey(floorKey(cave, floor), inst); const l = this.floorFx.get(fk) ?? []; this.floorFx.delete(fk); return l; }
  shotsView(floor: number, cave: CaveId = 'mine', inst?: string) { return (this.floorShots.get(instKey(floorKey(cave, floor), inst)) ?? []).map((s) => ({ id: s.id, x: +s.x.toFixed(2), y: +s.y.toFixed(2), by: s.by })); }
  mobsView(floor: number, cave: CaveId = 'mine', inst?: string) {
    const now = Date.now();
    return (this.floorMobs.get(instKey(floorKey(cave, floor), inst)) ?? []).filter((b) => !b.gone).map((b) => ({ id: b.id, k: b.kind, x: +b.x.toFixed(2), y: +b.y.toFixed(2), a: +b.a.toFixed(2), hp: b.deadUntil ? 0 : Math.round(b.hp), max: b.max,
      st: ST_CODE[b.st], ...(b.mini ? { mini: 1 } : {}), ...(b.kind === 'boss' ? { ph: b.phase } : {}), ...(b.party ? { pt: b.party } : {}),
      ...(b.tel && (b.st === 'windup' || b.st === 'dash') ? { tw: { k: b.tel.k, x: +b.tel.x.toFixed(2), y: +b.tel.y.toFixed(2), r: b.tel.r, dx: +b.tel.dx.toFixed(2), dy: +b.tel.dy.toFixed(2), ms: Math.max(0, b.stUntil - now), ...(b.kind === 'boss' && b.tel.k !== 'melee' ? { n: BOSS_MOVE_NAMES[cave][b.tel.k as 'slam'] } : {}) } } : {}) })); }
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
  carryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Current carried haul for a player key: online miner's, else unexpired grace, else nothing. */
  carriedOf(k: string, now = Date.now()): Stack[] {
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
  pack(k: string) { this.guardOnline(k); return this.rawPack(k); }
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
    m.hp = this.maxHp(m); m.inst = this.raidOf(m.account);
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
    Object.assign(m, { cave: caveOf(caveId).id, floor: 1, deepest: 1, x: sp[0], y: sp[1], z: 0, vz: 0, grounded: true, crouch: false, carry: 0 });
  }

  leave(id: string, now = Date.now()) {
    const m = this.miners.get(id); if (!m) return;
    if (!m.account) this.packs.delete(this.packKey(m));
    else if (!m.restoring) { const k = playerKey(m.account); const c = this.carried(id); if (c.length) this.grace.set(k, { stacks: c.map((s) => ({ ...s })), until: Infinity }); this.miners.delete(id); this.saveCarried(k); } // a miner whose haul never loaded leaves the saved row untouched
    this.miners.delete(id); void now;
  }
  /** Walk into the lift: everything carried moves into banked storage. Position is the server-validated one. */
  /** Millionaire Update: Coral Grotto (resort) hauls bank into the grotto's own building inventory, not the Chud City
   * Warehouse (server/warehouse.ts sets this; it returns the SQL rows that land in the same transaction). */
  coralBin: ((account: string, stacks: Stack[], cave?: CaveId) => Array<{ sql: string; args: unknown[] }>) | null = null;
  /** Fort McChud Mine hauls bank into the fort's mine bin (unloaded into the plant with the fort 'unload' op). */
  fortBin: ((account: string, stacks: Stack[], cave?: CaveId) => Array<{ sql: string; args: unknown[] }>) | null = null;
  /** Truck logistics: Chud City cave hauls bank AT that mine (mine:<cave>, server/locmoves.ts), not in the factory store. */
  cityBin: ((account: string, stacks: Stack[], cave: CaveId) => Array<{ sql: string; args: unknown[] }>) | null = null;
  /** Called after the cave-stock rows committed (memory mirror update). */
  cityBinDone: ((account: string, stacks: Stack[], cave: CaveId) => void) | null = null;
  exit(id: string): { banked: Stack[]; worth: number; bin?: string } {
    const m = this.miners.get(id); if (!m) throw new MineError('Join the mine first.');
    if (m.restoring) throw new MineError('Loading your backpack...');
    if (!inExit(m.x, m.y)) throw new MineError('Walk to the EXIT lift to bank your haul.');
    const banked = this.carried(id); if (!banked.length) return { banked: [], worth: 0 };
    if (m.account) this.lastCave.set(playerKey(m.account), m.cave); // royalties: ore is credited to the cave it was hauled out of
    const p = this.pack(this.packKey(m));
    // Map pools: city caves bank into the one city store (the banked pack, as before Millionaire); Coral Grotto -> Resort Warehouse.
    const binHook = m.cave === 'fortmc' ? this.fortBin : m.cave === 'coral' ? this.cityBin : null;
    // Truck logistics: a signed-in city haul banks AT that cave (mine:<cave>). Never fall back to the factory store.
    if (m.account && m.cave === 'coral' && !this.cityBin) { throw new MineError('Cave storage is starting up. Your haul is safe in your pack, try again in a moment.'); }
    const city = !!(m.account && m.cave === 'coral');
    const bin = m.account && binHook ? binHook(m.account, banked, m.cave) : null; // may throw (storage starting): haul stays carried
    m.carried.clear();
    if (!bin) for (const s of banked) { const k = stackKey(s); const cur = p.get(k); if (cur) cur.qty += s.qty; else p.set(k, { ...s }); }
    if (m.account) { const k = playerKey(m.account); const t = this.carryTimers.get(k); if (t) { clearTimeout(t); this.carryTimers.delete(k); } }
    // Banked stacks and the cleared carry row commit in one transaction: no duplicate or lost haul across a restart.
    const worth = banked.reduce((t, s) => t + s.qty * priceOf(s), 0); const bankId = randomUUID();
    const ore = banked.filter((s) => s.type === 'ore').reduce((t, s) => t + s.qty, 0);
    this.persist(m, undefined, false, m.account ? [
      { sql: 'DELETE FROM mine_carried WHERE player_key = $1', args: [playerKey(m.account)] },
      { sql: 'INSERT INTO mine_banks (player_key, owner_name, ore_qty, worth, at, bank_id) VALUES ($1,$2,$3,$4,$5,$6)', args: [playerKey(m.account), m.account, ore, worth, Date.now(), bankId] },
      ...(bin ?? []),
    ] : undefined, city ? (ok) => { // cave stock shows only once its rows committed; a bank that did NOT commit puts the haul back
      const applied = () => this.cityBinDone?.(m.account!, banked, m.cave);
      const restore = () => { for (const s of banked) { const k = stackKey(s); const c = m.carried.get(k); if (c) c.qty += s.qty; else m.carried.set(k, { ...s }); } };
      if (ok) return applied();
      // The error may be a lost acknowledgement of a commit: ask the database (bank marker) before restoring anything.
      // While it can't be asked, the haul is in neither place in memory (never duplicated); retried until known.
      const store = this.store as (MineStore & { banked?: (id: string) => Promise<boolean> }) | null;
      if (!store?.banked) return restore();
      const check = (n: number) => { void store.banked!(bankId).then((done) => (done ? applied() : restore()), () => { if (n < 120) setTimeout(() => check(n + 1), Math.min(30_000, 1000 * 2 ** Math.min(n, 5))).unref?.(); else console.error(`[mines] bank ${bankId} outcome unknown after retries: haul held for reconcile`); }); };
      check(0);
    } : undefined);
    return bin ? { banked, worth, bin: m.cave } : { banked, worth };
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
    const n = typeof nodeId === 'number' ? this.nodeStates(m.cave, m.floor, this.nodeInst(m))[nodeId] : undefined;
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

  private persist(m: { account: string | null }, sale?: Parameters<MineStore['save']>[3], withFactory = false, extra?: Array<{ sql: string; args: unknown[] }>, done?: (ok: boolean) => void) {
    if (!m.account || !this.store) { done?.(true); return; }
    const k = playerKey(m.account); const store = this.store;
    const f = withFactory ? this.factories.get(k) : undefined; const fs = f ? { level: f.level, builtAt: f.builtAt, jobs: f.jobs.map((j) => ({ ...j })) } : undefined;
    this.chain = this.chain.then(() => store.save(k, m.account!, this.snapNow(k), sale, fs, extra)).then(() => done?.(true), (e) => { console.error('[mines] save failed:', (e as Error).message); done?.(false); });
  }

  quote(account: string, now: number, only?: unknown): { gross: number; paid: number; already: number; lost: number; effAlready: number; capBase: number; capIndex: number; items: Stack[] } {
    this.beforeStorage?.(account);
    const items = this.storage(account).filter((s) => sellable(s) && (typeof only !== 'string' || s.id === only || stackKey(s) === only));
    return this.quoteItems(account, now, items);
  }
  /** House quote for an explicit list of stacks (Chud City Warehouse stock, server/locmoves.ts). Same tiers and caps. */
  quoteItems(account: string, now: number, items: Stack[]): { gross: number; paid: number; already: number; lost: number; effAlready: number; capBase: number; capIndex: number; items: Stack[] } {
    const m = { account };
    const gross = items.reduce((t, s) => t + s.qty * houseSellPrice(s), 0) * cityPolicyMul('mining'); // Mining boom policy
    const k = playerKey(m.account); const d = this.daily.get(k); const already = d && d.day === dayKey(now) ? d.gross : 0;
    // Chips lost to sinks today free up room (pt1405u), converted to base chips; may push effAlready below 0.
    const lost = sinkLostToday(account, now); const effAlready = effectiveAlready(already, lost, priceIndex());
    // House ore/goods prices follow the price index (tiers stay in base units so the daily caps scale too).
    const capIndex = houseCapIndex(); const capBase = HOUSE_SELL_BLOCKED.has(k) ? 0 : houseCapBase(capIndex, priceIndex()) * sellCapMul(account); // cap follows total assets (pt1442u)
    return { gross, paid: Math.floor(payoutFor(gross, effAlready, capBase) * priceIndex()), already, lost, effAlready, capBase, capIndex, items };
  }

  /** Sell ore to the house. Signed-in only. Stone etc. pay fractional chips: the whole sale is floored once. */
  /** Sell to the house once per client request id (Chud City Warehouse "Sell to house"): a retried / double-sent request
   *  with the same `rid` returns the first result (replay: true) and never sells again. No rid = plain sell(). */
  private sellRids = new Map<string, { at: number; res: { paid: number; gross: number; sold: Stack[] } }>();
  sellOnce(account: string | null, now: number, only?: unknown, qtyIn?: unknown, rid?: unknown): { paid: number; gross: number; sold: Stack[]; replay?: boolean } {
    if (typeof rid !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(rid) || !account) return this.sell(account, now, only, qtyIn);
    for (const [k, v] of this.sellRids) if (now - v.at > 15 * 60_000) this.sellRids.delete(k);
    const key = `${playerKey(account)}|${rid}`; const hit = this.sellRids.get(key);
    if (hit) return { ...hit.res, replay: true };
    const res = this.sell(account, now, only, qtyIn); this.sellRids.set(key, { at: now, res }); return res;
  }
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
      const s0 = q.items[0]; const items = [{ ...s0, qty: v.qty }]; const gross = v.qty * houseSellPrice(s0);
      q = { ...q, items, gross, paid: Math.floor(payoutFor(gross, q.effAlready, q.capBase) * priceIndex()) };
      partial = { key: stackKey(s0), qty: v.qty };
    }
    if (q.paid < 1) throw new MineError('Not worth a chip yet. Mine a bit more (stone is 1 chip per 10).');
    const k = playerKey(m.account); const day = dayKey(now);
    const ledgerKey = `mine:sell:${k}:${now}:${++this.saleSeq}`;
    const memo = `Mines: sold ${q.items.map((s) => `${s.qty} ${nameOf(s)}`).join(', ')}`.slice(0, 200);
    getBank().transfer(m.account, q.paid, { key: ledgerKey, game: 'mines', memo });
    { // Monument royalties: ore -> the mine it was last hauled out of, everything else (bars/goods/food) -> the Factory
      const oreG = q.items.filter((s) => s.type === 'ore').reduce((t, s) => t + s.qty * houseSellPrice(s), 0); const share = q.gross > 0 ? oreG / q.gross : 0;
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

  /**
   * Truck logistics: a house sale of goods held at the Chud City Warehouse. The caller debits the warehouse stock in the
   * same transaction as `stmts` (wallet credit + mine_daily + mine_sales) and calls apply() once it commits.
   */
  houseSale(account: string, now: number, items: Stack[]) {
    if (HOUSE_SELL_BLOCKED.has(playerKey(account))) throw new MineError('House selling is disabled on this account.');
    const q = this.quoteItems(account, now, items.filter((s) => sellable(s) && s.qty > 0));
    if (!q.items.length) throw new MineError('Nothing to sell.');
    if (q.paid < 1) throw new MineError('Not worth a chip yet. Sell a bigger stack (stone is 1 chip per 10).');
    const k = playerKey(account); const day = dayKey(now);
    const ledgerKey = `mine:sell:${k}:${now}:${++this.saleSeq}`;
    const memo = `Chud City Warehouse: sold ${q.items.map((s) => `${s.qty} ${nameOf(s)}`).join(', ')}`.slice(0, 200);
    const prev = this.daily.get(k); const base = prev && prev.day === day ? prev : { day, gross: 0, paid: 0 };
    const nd = { day, gross: base.gross + q.gross, paid: base.paid + q.paid };
    const w = getBank().transferAtomic([{ name: account, amount: q.paid, key: ledgerKey, game: 'mines', memo }]);
    const stmts = [...w.stmts,
      { sql: `INSERT INTO mine_daily (player_key, day, gross, paid) VALUES ($1,$2,$3,$4) ON CONFLICT (player_key, day) DO UPDATE SET gross = mine_daily.gross + $5, paid = mine_daily.paid + $6`, args: [k, day, nd.gross, nd.paid, q.gross, q.paid] },
      { sql: 'INSERT INTO mine_sales (player_key, items, gross, paid, ledger_key, at) VALUES ($1,$2,$3,$4,$5,$6)', args: [k, JSON.stringify(q.items), q.gross, q.paid, ledgerKey, now] }];
    const apply = () => {
      const cur = this.daily.get(k); const b2 = cur && cur.day === day ? cur : { day, gross: 0, paid: 0 };
      this.daily.set(k, { day, gross: b2.gross + q.gross, paid: b2.paid + q.paid });
      const oreG = q.items.filter((s) => s.type === 'ore').reduce((t, s) => t + s.qty * houseSellPrice(s), 0); const share = q.gross > 0 ? oreG / q.gross : 0;
      const cave = CAVE_LANDMARK[this.lastCave.get(k) ?? 'mine'];
      if (cave) royaltyEarn(cave, account, q.paid * share); royaltyEarn('factory', account, q.paid * (1 - share));
    };
    return { q, w, stmts, apply };
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
  /** Every stack in a player's banked storage (logistics shipping picker). */
  stacks(account: string): Array<{ type: ItemType; id: string; qty: number }> { this.beforeStorage?.(account); return [...this.pack(playerKey(account)).values()].map((s) => ({ type: s.type, id: s.id, qty: s.qty })); }
  stackQty(account: string, type: ItemType, id: string): number { this.beforeStorage?.(account); return this.pack(playerKey(account)).get(stackKey({ type, id }))?.qty ?? 0; }
  /** Move qty into (+) or out of (-) an account's pack and persist the pack plus `extra` rows in ONE transaction (queued in order with every other pack save).
   * Returns false (no change) if a withdrawal would go negative. Without a store, `fallback` gets the rows instead. */
  /** Weight of an account's stored pack (same units as BACKPACK_CAP). */
  packLoad(account: string): number { let t = 0; for (const s of this.pack(playerKey(account)).values()) t += s.qty * (s.type === 'ore' && isOre(s.id) ? ORES[s.id].weight : 1); return t; }
  /** Deltas applied to memory whose own save has NOT run yet (per account). Every queued snapshot subtracts them, so a
   *  save never persists another, still-uncommitted withdrawal/deposit (which could later roll back and be lost/doubled). */
  private pendingD = new Map<string, Set<Map<string, { type: ItemType; id: string; delta: number }>>>();
  /** Pack snapshot at save time: memory minus every pending (not yet saved) delta, except `own`. */
  private snapNow(k: string, own?: Map<string, { type: ItemType; id: string; delta: number }>): Stack[] {
    const out = new Map<string, Stack>(); for (const [key, st] of this.pack(k)) out.set(key, { ...st });
    // Memory holds pending DEBITS (reserved at call time) but NOT pending CREDITS (applied only once confirmed). So: a
    // snapshot gives back every other pending debit, and adds its own pending credits.
    const add = (key: string, d: { type: ItemType; id: string }, by: number) => { const n = (out.get(key)?.qty ?? 0) + by; if (n <= 0) out.delete(key); else out.set(key, { type: d.type, id: d.id, qty: n } as Stack); };
    for (const rec of this.pendingD.get(k) ?? []) for (const [key, d] of rec) { if (rec === own) { if (d.delta > 0) add(key, d, d.delta); } else if (d.delta < 0) add(key, d, -d.delta); }
    return [...out.values()];
  }
  adjustStack(account: string, type: ItemType, id: string, delta: number, extra: Array<{ sql: string; args: unknown[] }> = [], fallback?: (rows: Array<{ sql: string; args: unknown[] }>) => void, opts: { onUnknown?: (e: Error) => void; onLate?: (committed: boolean) => void; committed?: () => Promise<boolean>; after?: Promise<unknown>; bind?: (p: Promise<unknown>) => void; onFail?: (e: Error) => void } = {}): boolean {
    return this.adjustStacks(account, [{ type, id, delta }], extra, fallback, opts);
  }
  /** Several stack deltas, all-or-nothing (false and no change if any withdrawal would go negative), one transaction. */
  adjustStacks(account: string, deltas: Array<{ type: ItemType; id: string; delta: number }>, extra: Array<{ sql: string; args: unknown[] }> = [], fallback?: (rows: Array<{ sql: string; args: unknown[] }>) => void, opts: { onUnknown?: (e: Error) => void; onLate?: (committed: boolean) => void; committed?: () => Promise<boolean>; after?: Promise<unknown>; bind?: (p: Promise<unknown>) => void; onFail?: (e: Error) => void } = {}): boolean {
    this.beforeStorage?.(account);
    const k = playerKey(account); const p = this.pack(k);
    const sum = new Map<string, { type: ItemType; id: string; delta: number }>();
    for (const d of deltas) { if (!Number.isInteger(d.delta)) return false; const key = stackKey(d); const c = sum.get(key); if (c) c.delta += d.delta; else sum.set(key, { ...d }); }
    for (const [key, d] of sum) if ((p.get(key)?.qty ?? 0) + d.delta < 0) return false;
    // Debits are reserved in memory now (nobody can spend them twice); credits stay OUT of memory until their commit is
    // confirmed, so no consumer (sale, craft, transfer, factory, payroll...) can ever spend a tentative credit.
    const apply = (sign: number, which: 'all' | 'credit' | 'debit') => { for (const [key, d] of sum) { if (which === 'credit' && d.delta <= 0) continue; if (which === 'debit' && d.delta >= 0) continue; const n = (p.get(key)?.qty ?? 0) + sign * d.delta; if (n <= 0) p.delete(key); else p.set(key, { type: d.type, id: d.id, qty: n }); } };
    this.names.set(k, account.trim());
    if (!this.store) { apply(1, 'all'); fallback?.(extra); return true; }
    apply(1, 'debit');
    const rec = sum; let set = this.pendingD.get(k); if (!set) { set = new Set(); this.pendingD.set(k, set); } set.add(rec);
    const settle = () => { const st = this.pendingD.get(k); st?.delete(rec); if (st && !st.size) this.pendingD.delete(k); };
    const store = this.store;
    // Retried (every row is idempotent: absolute snapshots + ON CONFLICT ledger keys) so a blip can't lose a paid-for delivery.
    // The snapshot is taken when the save RUNS (after any earlier failed delta was undone), never at call time.
    const run = async () => { await opts.after; for (let i = 0; ; i++) { const snap = this.snapNow(k, rec); try { const r = await store.save(k, account.trim(), snap, undefined, undefined, extra); apply(1, 'credit'); settle(); return r; } catch (e) { if (i >= 3) throw e; await new Promise((r) => setTimeout(r, 250 * 2 ** i)); } } };
    const job = this.chain.then(run);
    this.chain = job.catch(async (e) => {
      console.error('[mines] save failed:', (e as Error).message);
      // The record stays pending (credits out of memory, debits reserved) until the outcome is KNOWN; the chain is blocked
      // meanwhile, so no snapshot runs. The commit may have landed with its reply lost: ask the caller.
      const keep = () => { apply(1, 'credit'); settle(); };
      const undo = () => { apply(-1, 'debit'); settle(); try { opts.onFail?.(e as Error); } catch (err) { console.error('[mines] rollback failed:', (err as Error).message); } };
      const v = opts.committed ? await outcome(opts.committed) : false;
      if (v === true) { keep(); return; }
      if (v === false) { if (opts.onFail) undo(); else keep() /* legacy fire-and-forget: kept for the next snapshot */; return; }
      // Unknown (database unreachable): tell the caller now, but SERIALIZE the uncertainty: the save queue does not advance
      // until this write's own marker answers. No later whole-pack snapshot can persist (or erase) a delta whose commit is
      // unknown; once known, memory is made exact (kept or undone) and only then do queued saves run. A restart meanwhile
      // simply reloads the database (queued saves are not durable promises).
      opts.onUnknown?.(e as Error);
      for (let i = 0; ; i++) { await new Promise((r) => setTimeout(r, Math.min(60_000, 1000 * 2 ** Math.min(i, 6)))); const late = await outcome(opts.committed!, 1); if (late === null) continue; if (late) keep(); else undo(); opts.onLate?.(late); return; }
    });
    opts.bind?.(this.chain);
    return true;
  }

  nodesView(now: number, cave: CaveId = 'mine', floor = 1, inst?: string) { return this.nodeStates(cave, floor, inst).map((n) => (this.nodeAvailable(n, now) ? n.hp : -1)); }
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
  playersView(cave?: CaveId, floor?: number, inst?: string) { return [...this.miners.values()].filter((m) => (!cave || m.cave === cave) && (floor === undefined || m.floor === floor) && (m.inst ?? '') === (inst ?? '')).map((m) => ({ id: m.id, name: m.name, x: +m.x.toFixed(2), y: +m.y.toFixed(2), z: +m.z.toFixed(2), a: +m.a.toFixed(3), p: +m.p.toFixed(3), c: !!m.crouch, sw: m.lastHit, pk: this.pickSkin(m), tl: this.toolOf(m.account), hp: Math.round(m.hp), mhp: this.maxHp(m), wp: this.gearOf(m.account).weapon, at: m.lastAttack })); }
}

let world = new MinesWorld();
export const getMines = () => world;
export function resetMines() { world = new MinesWorld(); setLocStore(new LocStore(null)); return world; } // tests: fresh per-location stock too

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
export const roomOf = (c: CaveId, floor = 1, inst?: string) => { const r = hasFloors(c) && floor > 1 ? `mines:${c}:f${floor}` : `mines:${c}`; return inst ? `${r}@${inst}` : r; };
const roomOfM = (m: { cave: CaveId; floor: number; inst?: string }) => roomOf(m.cave, m.floor, m.inst);
const MAX_MINERS = 24;
let ticker: ReturnType<typeof setInterval> | null = null;
type Ack = (r: Record<string, unknown>) => void;
const body = (p: unknown) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {});

const floorMsg = (m: Miner) => ({ floor: m.floor, deepest: world.deepestOf(m), stops: hasFloors(m.cave) ? elevatorStops(world.raidDeepest(m)) : [], hp: Math.round(m.hp), maxHp: world.maxHp(m), nodes: world.nodesView(Date.now(), m.cave, m.floor, world.nodeInst(m)), x: m.x, y: m.y, z: m.z, raid: m.inst ? world.raidSize(m.inst) : 0 });
/** Re-seat every online miner whose raid party changed (joined, left, disbanded): new instance, lift of the same floor, new socket room. */
export function syncRaids(io: Server, drop: string[] = []): void {
  for (const m of world.miners.values()) {
    const before = roomOfM(m);
    if (!world.setInst(m, world.raidOf(m.account))) continue;
    const s = io.sockets.sockets.get(m.id); const after = roomOfM(m);
    if (s) { void s.leave(before); void s.join(after); }
    io.to(before).emit('mines_left', { id: m.id });
    io.to(m.id).emit('mines_raid_moved', { ...floorMsg(m), pack: world.carried(m.id), load: world.load(m.id), cap: BACKPACK_CAP });
  }
  for (const i of drop) if (![...world.miners.values()].some((m) => m.inst === i)) world.dropInstance(i);
}
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
    const live = new Map<string, { cave: CaveId; floor: number; inst?: string; ms: Miner[] }>();
    for (const m of world.miners.values()) { const r = roomOfM(m); const l = live.get(r) ?? { cave: m.cave, floor: m.floor, inst: m.inst, ms: [] }; l.ms.push(m); live.set(r, l); }
    for (const [room, l] of live) {
      const base = { t: now, floor: l.floor, players: world.playersView(l.cave, l.floor, l.inst), mobs: world.mobsView(l.floor, l.cave, l.inst), shots: world.shotsView(l.floor, l.cave, l.inst), mfx: world.takeFx(l.floor, l.cave, l.inst) };
      if (!l.inst) io.to(room).emit('mines_state', { ...base, nodes: world.nodesView(now, l.cave, l.floor) });
      else for (const m of l.ms) io.to(m.id).emit('mines_state', { ...base, raid: world.raidSize(l.inst), nodes: world.nodesView(now, l.cave, l.floor, world.nodeInst(m)) }); // personal veins
    }
  }, 100);
  ticker.unref?.();
}

export function registerMines(io: Server, socket: Socket): void {
  const account = () => (socket.data.account as { name?: string } | undefined)?.name ?? null;
  const me = () => world.miners.get(socket.id);
  const packMsg = () => ({ pack: world.carried(socket.id), load: world.load(socket.id), cap: BACKPACK_CAP });
  const storeMsg = () => { const a = account(); if (a) world.beforeStorage?.(a); const q = a ? world.quoteItems(a, Date.now(), getLocStore().at(a, WAREHOUSE).flatMap((x) => { const i = x.item.indexOf(':'); const t = x.item.slice(0, i) as ItemType; const st = { type: t, id: x.item.slice(i + 1), qty: x.qty }; return (t === 'ore' || t === 'bar' || t === 'good' || t === 'food') && sellable(st) ? [st] : []; })) : null; const wh = a ? getLocStore().at(a, WAREHOUSE).flatMap((x) => { const i = x.item.indexOf(':'); const t = x.item.slice(0, i); return t === 'ore' || t === 'bar' || t === 'good' || t === 'food' ? [{ type: t as ItemType, id: x.item.slice(i + 1), qty: x.qty }] : []; }) : [];
    return { storage: a ? world.storage(a) : [], warehouse: wh, quote: q ? { gross: q.gross, paid: q.paid, already: q.already, lost: q.lost, effAlready: q.effAlready, index: priceIndex(), capBase: q.capBase, capIndex: q.capIndex, sellBonus: sellCapMul(a) - 1 } : null, inMine: a ? world.inMine(a) : false, guest: !a }; };
  socket.on('mines_join', async (p: unknown, ack?: Ack) => {
    let m = me();
    const want = caveOf(body(p).cave).id;
    if (want === 'coral' && !isAtResort(account())) return ack?.({ ok: false, error: 'The Coral Grotto is at Chud Resort. Fly there from Chud Hub International.' });
    if (want === 'fortmc' && !isAtFortMc(account())) return ack?.({ ok: false, error: 'The Fort McChud Mine is in Fort McChud. Fly there from Chud Hub International.' });
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
      if (r.broke && r.ore) { awardXp(account(), 'mining', ORES[r.ore].hits * 5); eventCredit('mining', me()?.account, 1 + (r.bonus ?? 0)); } // XP scales with ore hardness
      let drop: { kind: string; id: string } | undefined;
      const mm = me();
      if (r.broke && r.ore && mm?.account) {
        try {
          const now = Date.now();
          const it = getVault().dropForMine(mm.account, `mine-drop:${playerKey(mm.account)}:${mm.cave}${mm.floor > 1 ? `-f${mm.floor}` : ''}:${r.node}:${now}`, `${r.ore} in ${mm.cave}${mm.floor > 1 ? ` floor ${mm.floor}` : ''}`);
          if (it) drop = { kind: it.kind, id: it.id };
        } catch (e) { console.warn('[mines] drop skipped:', (e as Error).message); }
      }
      if (!me()!.inst) socket.to(roomOfM(me()!)).emit('mines_fx', { node: r.node, hp: r.hp, broke: r.broke, by: socket.id }); // raid veins are personal
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
  const lst0 = (mob: number) => { const m = me(); const l = m ? world.floorMobs.get(instKey(floorKey(m.cave, m.floor), m.inst))?.[mob] : undefined; return l ? MOBS[l.kind].xp : undefined; };
  socket.on('mines_attack', (p: unknown, ack?: Ack) => {
    try {
      const r = world.attack(socket.id, body(p).mob, Date.now());
      if (r.killed) { const m = me(); const f = m?.floor ?? 1; const lst = world.floorMobs.get(instKey(floorKey(m?.cave ?? 'mine', f), m?.inst))?.[r.mob]; awardXp(account(), 'mining', lst ? MOBS[lst.kind].xp : 5); }
      socket.to(roomOfM(me()!)).emit('mines_mobfx', { mob: r.mob, hp: r.hp, killed: r.killed, by: socket.id });
      if (r.raid) {
        for (const sh of r.raid.shared) { const o = world.miners.get(sh.id); if (o && r.killed) awardXp(o.account, 'mining', Math.round((lst0(r.mob) ?? 5) / 2)); io.to(sh.id).emit('mines_raid_loot', { mob: r.mob, loot: sh.loot, pack: world.carried(sh.id), load: world.load(sh.id), cap: BACKPACK_CAP }); }
        if (r.raid.roll) { const { id: _rid, ...roll } = r.raid.roll; void _rid; io.to(roomOfM(me()!)).emit('mines_raid_roll', roll); }
      }
      const { raid: _raid, ...out } = r; void _raid;
      ack?.({ ok: true, ...out, ...(r.loot?.length ? packMsg() : {}) });
    } catch (e) { ack?.({ ok: false, error: (e as Error).message }); }
  });
  socket.on('mines_exit', (_p: unknown, ack?: Ack) => {
    try { const r = world.exit(socket.id); ack?.({ ok: true, ...r, ...packMsg() }); }
    catch (e) { ack?.({ ok: false, error: (e as Error).message }); }
  });
  const safe = (fn: () => Record<string, unknown>) => (_p: unknown, ack?: Ack) => { try { ack?.({ ok: true, ...fn() }); } catch (e) { ack?.({ ok: false, offline: world.offline, error: (e as Error).message }); } };
  socket.on('mines_storage', safe(() => storeMsg()));
  // Truck logistics: the house only buys goods that are AT the Chud City Warehouse (loc_stock 'warehouse'). Factory /
  // mine stock has to be trucked there first (server/locmoves.ts); this handler never sells from the factory store.
  const sold = new Map<string, { at: number; res: Record<string, unknown> }>(); const selling = new Set<string>();
  socket.on('mines_sell', async (p: unknown, ack?: Ack) => {
    try {
      if (isAtResort(account()) || isAtFortMc(account())) throw new MineError('The market is the Chud City Warehouse. Travel back to Chud City to sell here, or use Ship & sell from your building.');
      const a = account(); if (!a) throw new MineError('Sign in to sell ore. Guests can mine but not sell.');
      if (world.inMine(a)) throw new MineError('Leave the mine to sell.');
      const b = body(p); const rid = typeof b.rid === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.rid) ? `${playerKey(a)}|${b.rid}` : null;
      const now = Date.now(); for (const [k, v] of sold) if (now - v.at > 15 * 60_000) sold.delete(k);
      if (rid && sold.has(rid)) return ack?.({ ok: true, ...sold.get(rid)!.res, replay: true, ...storeMsg() });
      if (rid && selling.has(rid)) throw new MineError('Already selling, one moment.');
      if (rid) selling.add(rid);
      try {
      const wh = getLocStore().at(a, WAREHOUSE).filter((x) => /^(ore|bar|good|food):/.test(x.item));
      const only = typeof b.ore === 'string' ? b.ore : null;
      const pick = only ? wh.filter((x) => x.item === only || x.item.slice(x.item.indexOf(':') + 1) === only) : wh.filter((x) => { const [t, id] = [x.item.slice(0, x.item.indexOf(':')), x.item.slice(x.item.indexOf(':') + 1)]; return sellable({ type: t as ItemType, id }); });
      if (!pick.length) throw new MineError('Nothing to sell here.');
      if (b.qty !== undefined && b.qty !== null && pick.length !== 1) throw new MineError('Pick one item to sell a quantity.');
      let paid = 0, gross = 0; const out: Stack[] = []; let err: Error | null = null;
      for (const x of pick) {
        try { const r = await getLocMoves().sell(a, { item: x.item, qty: b.qty ?? x.qty }) as { paid?: number; gross?: number }; paid += r.paid ?? 0; gross += r.gross ?? 0; const i = x.item.indexOf(':'); out.push({ type: x.item.slice(0, i) as ItemType, id: x.item.slice(i + 1), qty: Number(b.qty ?? x.qty) }); }
        catch (e) { err = e as Error; if (pick.length === 1) throw e; }
      }
      if (!out.length && err) throw err;
      const res = { paid, gross, sold: out }; if (rid) sold.set(rid, { at: now, res });
      ack?.({ ok: true, ...res, ...storeMsg() });
      } finally { if (rid) selling.delete(rid); }
    } catch (e) { ack?.({ ok: false, error: (e as Error).message }); }
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

// Map pools: the city map's stackables ARE this banked store (LocStore routes loc 'warehouse' ore/bar/good/food here).
setDefaultCityPack({
  qty: (n, t, id) => getMines().stackQty(n, t as ItemType, id),
  stacks: (n) => getMines().stacks(n),
  adjust(n, deltas, extra, o) {
    const mines = getMines();
    if (mines.offline || (getLocStore().pool && !(mines as unknown as { store: unknown }).store)) throw new MineError('Storage is reconnecting. Your goods are safe, try again in a minute.');
    let failed: Error | null = null, unknown: Error | null = null, settled: Promise<unknown> | null = null; let sawUnknown: (() => void) | null = null;
    const early = new Promise<void>((r) => { sawUnknown = r; });
    let fb: Array<{ sql: string; args: unknown[] }> | null = null; const ds = deltas.map((d) => ({ type: d.type as ItemType, id: d.id, delta: d.delta }));
    const ok = mines.adjustStacks(n, ds, extra, (r) => { fb = r; }, {
      after: o.after, committed: o.committed, onLate: o.onLate,
      onFail: (e) => { failed = e; }, onUnknown: (e) => { unknown = e; sawUnknown?.(); }, bind: (p) => { settled = p; } });
    if (!ok) return false;
    const lp = o.pool ?? getLocStore().pool;
    if (fb && lp) { const rows: Array<{ sql: string; args: unknown[] }> = fb; return (async () => { // memory-only pack (dev/tests): the rows still commit together
      await o.after; const cl = await lp.connect();
      try { await cl.query('BEGIN'); for (const q of rows) await cl.query(q.sql, q.args); await cl.query('COMMIT'); }
      catch (e) { await cl.query('ROLLBACK').catch(() => {}); mines.adjustStacks(n, ds.map((d) => ({ ...d, delta: -d.delta }))); throw e; }
      finally { cl.release(); } })(); }
    return (async () => { await Promise.race([settled, early]); if (failed) throw failed; if (unknown) throw new OutcomeUnknown(unknown); })();
  },
});

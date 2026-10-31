/** Mines: shared first-person cave. Server-authoritative nodes, backpacks (generic item stacks) and house selling. */
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { playerKey } from './skins.js';
import { guestName, lineOfSight, moveAllowance, MOVE_CARRY_MAX, normAngle, clampPitch, canStand, validateMove, eyeHeightOf, type Body } from '../shared/fps.js';
import { BACKPACK_CAP, MAX_HITS_PER_10S, MINE_MAP, MINE_NODES, NODE_R, ORES, REACH, SWING_MIN_MS, dayKey, isOre, payoutFor, stackKey, type ItemType, type MineNode, type OreId, type Stack } from '../shared/mines.js';

export const MINES_MIGRATION = [
  // Generic per-player stacks: item_type 'ore' | 'bar' | 'good' (Factory) — also the Market hook for stackables.
  `CREATE TABLE IF NOT EXISTS mine_items (player_key TEXT NOT NULL, owner_name TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (player_key, item_type, item_id))`,
  `CREATE TABLE IF NOT EXISTS mine_daily (player_key TEXT NOT NULL, day TEXT NOT NULL, gross REAL NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (player_key, day))`,
  `CREATE TABLE IF NOT EXISTS mine_sales (id SERIAL PRIMARY KEY, player_key TEXT NOT NULL, items TEXT NOT NULL, gross REAL NOT NULL, paid INTEGER NOT NULL, ledger_key TEXT NOT NULL, at BIGINT NOT NULL)`,
];

export interface MineStore { init(): Promise<void>; load(): Promise<{ items: Array<{ key: string; name: string; type: ItemType; id: string; qty: number }>; daily: Array<{ key: string; day: string; gross: number; paid: number }> }>; save(key: string, name: string, stacks: Stack[], sale?: { day: string; gross: number; paid: number; items: string; ledgerKey: string; at: number; dayGross: number; dayPaid: number }): Promise<void> }

export class PgMineStore implements MineStore {
  constructor(private readonly db: Queryable & { connect?: () => Promise<pg.PoolClient> }) { db.on?.('error', (e) => console.error('[mines] pool error:', e.message)); }
  async init() { for (const q of MINES_MIGRATION) await this.db.query(q); }
  async load() {
    const items = (await this.db.query('SELECT * FROM mine_items')).rows.filter((r) => Number(r.qty) > 0).map((r) => ({ key: String(r.player_key), name: String(r.owner_name), type: r.item_type as ItemType, id: String(r.item_id), qty: Number(r.qty) }));
    const daily = (await this.db.query('SELECT * FROM mine_daily')).rows.map((r) => ({ key: String(r.player_key), day: String(r.day), gross: Number(r.gross), paid: Number(r.paid) }));
    return { items, daily };
  }
  async save(key: string, name: string, stacks: Stack[], sale?: Parameters<MineStore['save']>[3]) {
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
      if (c) await c.query('COMMIT');
    } catch (e) { if (c) await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c?.release(); }
  }
}

export class MineError extends Error {}

interface Miner extends Body { id: string; name: string; account: string | null; a: number; p: number; lastMove: number; carry: number; lastHit: number; hits: number[]; sprint: boolean }
interface NodeState { node: MineNode; hp: number; downUntil: number }

export class MinesWorld {
  miners = new Map<string, Miner>();
  nodes: NodeState[] = MINE_NODES.map((n) => ({ node: n, hp: ORES[n.ore].hits, downUntil: 0 }));
  /** signed-in backpacks by player key; guests keep theirs on the miner id (lost on leave) */
  packs = new Map<string, Map<string, Stack>>();
  names = new Map<string, string>();
  daily = new Map<string, { day: string; gross: number; paid: number }>();
  store: MineStore | null = null;
  private chain: Promise<void> = Promise.resolve();
  private saleSeq = 0;

  async attach(store: MineStore): Promise<boolean> {
    try {
      await store.init();
      const { items, daily } = await store.load();
      for (const i of items) { this.pack(i.key).set(stackKey(i), { type: i.type, id: i.id, qty: i.qty }); this.names.set(i.key, i.name); }
      for (const d of daily) { const cur = this.daily.get(d.key); if (!cur || cur.day < d.day) this.daily.set(d.key, d); }
      this.store = store; return true;
    } catch (e) { console.error('[mines] postgres unavailable, mines in memory only:', (e as Error).message); return false; }
  }
  async flush() { await this.chain; }

  private pack(k: string) { let p = this.packs.get(k); if (!p) { p = new Map(); this.packs.set(k, p); } return p; }
  packKey(m: Miner) { return m.account ? playerKey(m.account) : `guest:${m.id}`; }
  backpack(id: string): Stack[] { const m = this.miners.get(id); if (!m) return []; return [...this.pack(this.packKey(m)).values()].filter((s) => s.qty > 0); }
  load(id: string): number { return this.backpack(id).reduce((t, s) => t + s.qty * (s.type === 'ore' && isOre(s.id) ? ORES[s.id].weight : 1), 0); }

  join(id: string, account: string | null, now: number): Miner {
    const sp = MINE_MAP.spawns[this.miners.size % MINE_MAP.spawns.length];
    const m: Miner = { id, name: account?.trim() || guestName(), account: account?.trim() || null, x: sp[0], y: sp[1], z: 0, vz: 0, grounded: true, crouch: false, a: 0, p: 0, lastMove: now, carry: 0, lastHit: 0, hits: [], sprint: false };
    this.miners.set(id, m);
    if (m.account) this.names.set(playerKey(m.account), m.account);
    return m;
  }
  leave(id: string) { const m = this.miners.get(id); if (m && !m.account) this.packs.delete(this.packKey(m)); this.miners.delete(id); }

  /** Reuses Arena's movement validator (speed cap with carry, collision). Returns true if the client should be corrected. */
  move(id: string, x: unknown, y: unknown, z: unknown, a: unknown, p: unknown, crouch: unknown, sprint: unknown, now: number): boolean {
    const m = this.miners.get(id); if (!m) return false;
    const dt = now - m.lastMove; m.lastMove = now;
    m.crouch = crouch === true; m.sprint = sprint === true;
    const speedBody = { crouch: m.crouch, sprint: m.sprint };
    const allowed = moveAllowance(speedBody, dt, m.carry);
    const want = typeof x === 'number' && typeof y === 'number' ? Math.hypot(x - m.x, y - m.y) : 0;
    validateMove(m, x, y, dt, MINE_MAP, allowed);
    m.carry = Math.min(MOVE_CARRY_MAX, Math.max(0, allowed - want));
    if (typeof z === 'number' && Number.isFinite(z) && z >= 0 && z <= 1.4 && canStand(m.x, m.y, z, MINE_MAP)) m.z = z;
    const na = normAngle(a); if (na !== null) m.a = na;
    const np = clampPitch(p); if (np !== null) m.p = np;
    return typeof x === 'number' && typeof y === 'number' && Math.hypot(x - m.x, y - m.y) > 0.6;
  }

  nodeAvailable(n: NodeState, now: number) { if (n.downUntil && now >= n.downUntil) { n.downUntil = 0; n.hp = ORES[n.node.ore].hits; } return !n.downUntil; }

  /** One pickaxe hit. Validates reach, line of sight, swing rate and backpack room. */
  hit(id: string, nodeId: unknown, now: number): { node: number; hp: number; broke: boolean; ore?: OreId; full?: boolean } {
    const m = this.miners.get(id); if (!m) throw new MineError('Join the mine first.');
    const n = typeof nodeId === 'number' ? this.nodes[nodeId] : undefined;
    if (!n) throw new MineError('No rock there.');
    if (now - m.lastHit < SWING_MIN_MS) throw new MineError('Too fast.');
    m.hits = m.hits.filter((t) => now - t < 10_000);
    if (m.hits.length >= MAX_HITS_PER_10S) throw new MineError('Too fast.');
    if (!this.nodeAvailable(n, now)) throw new MineError('That vein is mined out.');
    const eye = { x: m.x, y: m.y, z: m.z + eyeHeightOf(m) };
    const c = n.node;
    const dist = Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z) - NODE_R;
    if (dist > REACH) throw new MineError('Too far.');
    // LOS to a point on the node's near face (centre sits half inside the wall).
    const toward = Math.hypot(eye.x - c.x, eye.y - c.y) || 1;
    const face = { x: c.x + ((eye.x - c.x) / toward) * NODE_R * 0.9, y: c.y + ((eye.y - c.y) / toward) * NODE_R * 0.9, z: c.z };
    if (!lineOfSight(eye, face, MINE_MAP)) throw new MineError('Something is in the way.');
    const ore = ORES[c.ore];
    if (this.load(id) + ore.weight > BACKPACK_CAP) return { node: c.id, hp: n.hp, broke: false, full: true };
    m.lastHit = now; m.hits.push(now);
    n.hp -= 1;
    if (n.hp > 0) return { node: c.id, hp: n.hp, broke: false };
    n.downUntil = now + ore.respawnMs; n.hp = 0;
    this.add(m, [{ type: 'ore', id: c.ore, qty: 1 }]);
    return { node: c.id, hp: 0, broke: true, ore: c.ore };
  }

  add(m: Miner, stacks: Stack[]) {
    const p = this.pack(this.packKey(m));
    for (const s of stacks) { const k = stackKey(s); const cur = p.get(k); if (cur) cur.qty += s.qty; else p.set(k, { ...s }); }
    this.persist(m);
  }

  private persist(m: Miner, sale?: Parameters<MineStore['save']>[3]) {
    if (!m.account || !this.store) return;
    const k = playerKey(m.account); const snap = [...this.pack(k).values()].map((s) => ({ ...s })); const store = this.store;
    this.chain = this.chain.then(() => store.save(k, m.account!, snap, sale)).catch((e) => console.error('[mines] save failed:', (e as Error).message));
  }

  quote(id: string, now: number, only?: unknown): { gross: number; paid: number; already: number; items: Stack[] } {
    const m = this.miners.get(id); if (!m) throw new MineError('Join the mine first.');
    const items = this.backpack(id).filter((s) => s.type === 'ore' && isOre(s.id) && (!isOre(only) || s.id === only));
    const gross = items.reduce((t, s) => t + s.qty * ORES[s.id as OreId].price, 0);
    const k = this.packKey(m); const d = this.daily.get(k); const already = d && d.day === dayKey(now) ? d.gross : 0;
    return { gross, paid: payoutFor(gross, already), already, items };
  }

  /** Sell ore to the house. Signed-in only. Stone etc. pay fractional chips: the whole sale is floored once. */
  sell(id: string, now: number, only?: unknown): { paid: number; gross: number; sold: Stack[] } {
    const m = this.miners.get(id); if (!m) throw new MineError('Join the mine first.');
    if (!m.account) throw new MineError('Sign in to sell ore. Guests can mine but not sell.');
    const q = this.quote(id, now, only);
    if (!q.items.length) throw new MineError('Nothing to sell.');
    if (q.paid < 1) throw new MineError('Not worth a chip yet. Mine a bit more (stone is 1 chip per 10).');
    const k = playerKey(m.account); const day = dayKey(now);
    const ledgerKey = `mine:sell:${k}:${now}:${++this.saleSeq}`;
    const memo = `Sold ${q.items.map((s) => `${s.qty} ${ORES[s.id as OreId].name}`).join(', ')}`;
    getBank().transfer(m.account, q.paid, { key: ledgerKey, game: 'mines', memo });
    const p = this.pack(k);
    for (const s of q.items) p.delete(stackKey(s));
    const prev = this.daily.get(k); const base = prev && prev.day === day ? prev : { day, gross: 0, paid: 0 };
    const nd = { day, gross: base.gross + q.gross, paid: base.paid + q.paid }; this.daily.set(k, nd);
    this.persist(m, { day, gross: q.gross, paid: q.paid, items: JSON.stringify(q.items), ledgerKey, at: now, dayGross: nd.gross, dayPaid: nd.paid });
    return { paid: q.paid, gross: q.gross, sold: q.items };
  }

  nodesView(now: number) { return this.nodes.map((n) => (this.nodeAvailable(n, now) ? n.hp : -1)); }
  playersView() { return [...this.miners.values()].map((m) => ({ id: m.id, name: m.name, x: +m.x.toFixed(2), y: +m.y.toFixed(2), z: +m.z.toFixed(2), a: +m.a.toFixed(3), p: +m.p.toFixed(3), c: !!m.crouch, sw: m.lastHit })); }
}

let world = new MinesWorld();
export const getMines = () => world;
export function resetMines() { world = new MinesWorld(); return world; }

export async function initMinesStorage(): Promise<void> {
  const url = databaseUrl(); if (!url) { console.warn('[mines] no DATABASE_URL; mines in memory only'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  if (await world.attach(new PgMineStore(pool))) console.log('[mines] connected to postgres');
}

const ROOM = 'mines';
const MAX_MINERS = 24;
let ticker: ReturnType<typeof setInterval> | null = null;
type Ack = (r: Record<string, unknown>) => void;
const body = (p: unknown) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {});

function ensureTicker(io: Server) {
  if (ticker) return;
  ticker = setInterval(() => {
    if (!world.miners.size) { clearInterval(ticker!); ticker = null; return; }
    io.to(ROOM).emit('mines_state', { t: Date.now(), players: world.playersView(), nodes: world.nodesView(Date.now()) });
  }, 100);
  ticker.unref?.();
}

export function registerMines(io: Server, socket: Socket): void {
  const account = () => (socket.data.account as { name?: string } | undefined)?.name ?? null;
  const me = () => world.miners.get(socket.id);
  const packMsg = () => ({ pack: world.backpack(socket.id), load: world.load(socket.id), cap: BACKPACK_CAP, quote: (() => { try { const q = world.quote(socket.id, Date.now()); return { gross: q.gross, paid: q.paid, already: q.already }; } catch { return null; } })() });
  socket.on('mines_join', (_p: unknown, ack?: Ack) => {
    let m = me();
    if (!m) {
      if (world.miners.size >= MAX_MINERS) return ack?.({ ok: false, error: 'The mine is full, try again in a bit.' });
      m = world.join(socket.id, account(), Date.now());
      void socket.join(ROOM);
    }
    ensureTicker(io);
    ack?.({ ok: true, id: socket.id, name: m.name, guest: !m.account, x: m.x, y: m.y, z: m.z, a: m.a, nodes: world.nodesView(Date.now()), ...packMsg() });
  });
  socket.on('mines_move', (p: unknown) => {
    const b = body(p);
    if (world.move(socket.id, b.x, b.y, b.z, b.a, b.p, b.c, b.s, Date.now())) { const m = me()!; socket.emit('mines_correct', { x: m.x, y: m.y, z: m.z }); }
  });
  socket.on('mines_hit', (p: unknown, ack?: Ack) => {
    try {
      const r = world.hit(socket.id, body(p).node, Date.now());
      socket.to(ROOM).emit('mines_fx', { node: r.node, hp: r.hp, broke: r.broke, by: socket.id });
      ack?.({ ok: true, ...r, ...(r.broke ? packMsg() : {}) });
    } catch (e) { ack?.({ ok: false, error: (e as Error).message }); }
  });
  socket.on('mines_pack', (_p: unknown, ack?: Ack) => ack?.({ ok: true, ...packMsg() }));
  socket.on('mines_sell', (p: unknown, ack?: Ack) => {
    try { const r = world.sell(socket.id, Date.now(), body(p).ore); ack?.({ ok: true, ...r, ...packMsg() }); }
    catch (e) { ack?.({ ok: false, error: (e as Error).message }); }
  });
  const leave = () => { if (me()) { world.leave(socket.id); void socket.leave(ROOM); io.to(ROOM).emit('mines_left', { id: socket.id }); } };
  socket.on('mines_leave', leave);
  socket.on('disconnect', leave);
}

/**
 * Enterable, customizable homes + the Furniture Store (Millionaire Update, pt1459u). Rules live in shared/homes.ts.
 *
 * Storage (Postgres is the source of truth; an in-memory fallback runs without DATABASE_URL, like the garage):
 *  - home_inventory: (player_key, item) → qty. Furniture ids, plus 'wall:<id>' / 'floor:<id>' styles (qty 1).
 *    A purchase is ONE transaction holding the wallet ledger row (CasinoBank.transferAtomic, game 'furniture_buy') and the
 *    inventory upsert. No resale: furniture is a pure chip sink, and it counts as house-room sink (shared/sinkRoom.ts).
 *  - home_layout: one row per property id (owner_key, wall, floor, items JSONB, access, invites JSONB).
 *    A layout only counts while its owner_key still owns the property; a sold home's furniture returns to the inventory.
 *
 * Live visits ride the existing socket.io connection: room `home:<propertyId>` carries presence (home_peers), avatar
 * moves (home_pos, ~6 Hz, clamped to the room), chat (home_chat) and layout updates (home_layout). The owner's access
 * setting (open / invite list / locked) is checked on enter and re-applied to everyone inside when it changes.
 */
import { salesTaxFor } from './city-rates.js';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { bootAttach, setBootState } from './boot-retry.js';
import { databaseUrl } from './leaderboard-store.js';
import { getBank, type CasinoBank } from './casino-store.js';
import { px } from './price-index.js';
import { getRealEstate } from './realEstate.js';
import { propertyById } from '../shared/realEstate.js';
import {
  CHAT_MAX, EMPTY_LAYOUT, FLOOR_STYLES, FURNITURE, FURN_CATS, MAX_BUY_QTY, MAX_INVITES, MAX_VISITORS, WALL_STYLES,
  canVisit, clampPos, isHomeProperty, shopItem, validateLayout, type HomeAccess, type HomeLayout,
} from '../shared/homes.js';

export class HomeError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();

export const HOMES_MIGRATION = `
CREATE TABLE IF NOT EXISTS home_inventory (player_key TEXT NOT NULL, item TEXT NOT NULL, qty INT NOT NULL DEFAULT 0, PRIMARY KEY (player_key, item));
CREATE TABLE IF NOT EXISTS home_layout (property_id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, wall TEXT NOT NULL, floor TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]', access TEXT NOT NULL DEFAULT 'invite', invites JSONB NOT NULL DEFAULT '[]', updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS home_layout_owner ON home_layout (owner_key);`;

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };
export type OwnerOf = (propertyId: string) => Promise<string | null>;
export interface HomeState { id: string; owner: string; layout: HomeLayout; access: HomeAccess; invites: string[] }
const ACCESS = new Set<HomeAccess>(['open', 'invite', 'locked']);
const j = <T>(v: unknown, d: T): T => { if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return d; } } return (v ?? d) as T; };

/** Default owner lookup: the real-estate table. */
export const realEstateOwner: OwnerOf = async (id) => { const re = getRealEstate(); if (!re) return null; return (await re.owned()).find((o) => o.id === id)?.owner ?? null; };

export class Homes {
  private memInv = new Map<string, Map<string, number>>();
  private memLayout = new Map<string, { owner_key: string; layout: HomeLayout; access: HomeAccess; invites: string[] }>();
  constructor(private readonly pool: PoolLike | null, private readonly ownerOf: OwnerOf = realEstateOwner, private readonly bank: () => CasinoBank = getBank, private readonly clock = () => Date.now()) {}
  async init() { if (this.pool) await this.pool.query(HOMES_MIGRATION); }

  catalog() {
    return { cats: FURN_CATS, furniture: FURNITURE.map((f) => ({ ...f, base: f.price, price: px(f.price) })), walls: WALL_STYLES.map((s) => ({ ...s, price: px(s.price) })), floors: FLOOR_STYLES.map((s) => ({ ...s, price: px(s.price) })) };
  }

  async inventory(name: string): Promise<Map<string, number>> {
    const k = keyOf(name);
    if (!this.pool) return new Map(this.memInv.get(k) ?? []);
    const r = await this.pool.query('SELECT item, qty FROM home_inventory WHERE player_key = $1 AND qty > 0', [k]);
    return new Map(r.rows.map((x) => [String(x.item), Number(x.qty)]));
  }
  /** Layout rows for homes this player still owns (ownerOf is checked per row). */
  private async ownedLayouts(name: string) {
    const k = keyOf(name); let rows: { id: string; items: HomeLayout['items'] }[];
    if (!this.pool) rows = [...this.memLayout].filter(([, v]) => v.owner_key === k).map(([id, v]) => ({ id, items: v.layout.items }));
    else rows = (await this.pool.query('SELECT property_id, items FROM home_layout WHERE owner_key = $1', [k])).rows.map((x) => ({ id: String(x.property_id), items: j(x.items, []) }));
    const out = [] as typeof rows; for (const r of rows) { const o = await this.ownerOf(r.id); if (o && keyOf(o) === k) out.push(r); } return out;
  }
  /** Copies free to place in `exceptHome` (owned minus placed in the player's other homes). */
  async available(name: string, exceptHome?: string): Promise<Map<string, number>> {
    const inv = await this.inventory(name);
    for (const l of await this.ownedLayouts(name)) if (l.id !== exceptHome) for (const it of l.items) inv.set(it.f, (inv.get(it.f) ?? 0) - 1);
    return inv;
  }
  /** What the store / build mode shows: owned, placed, free per item. */
  async locker(name: string) {
    const inv = await this.inventory(name); const placed = new Map<string, number>();
    for (const l of await this.ownedLayouts(name)) for (const it of l.items) placed.set(it.f, (placed.get(it.f) ?? 0) + 1);
    return { items: [...inv].map(([item, qty]) => ({ item, qty, placed: placed.get(item) ?? 0 })), chips: this.bank().ready ? this.bank().account(name).chips : null };
  }

  async buy(name: string, item: unknown, qty: unknown = 1) {
    const it = typeof item === 'string' ? shopItem(item) : null; if (!it) throw new HomeError('That item is not in the store.');
    const n = it.once ? 1 : Math.floor(Number(qty)); if (!Number.isInteger(n) || n < 1 || n > MAX_BUY_QTY) throw new HomeError(`Buy 1 to ${MAX_BUY_QTY} at a time.`);
    if (it.price <= 0) throw new HomeError('That style is free: everyone has it.');
    const k = keyOf(name); const have = await this.inventory(name);
    if (it.once && (have.get(it.key) ?? 0) > 0) throw new HomeError('You already own that style.');
    const price = px(it.price) * n; const bank = this.bank(); await bank.refresh(name).catch(() => 0);
    const bid = randomUUID(); const st = salesTaxFor(name, price, `furniture_buy:${bid}`, `${n} × ${it.name}`);
    if (!bank.canAfford(name, price + st.tax)) throw new HomeError(`Not enough chips: ${n} × ${it.name} costs ${price.toLocaleString('en-US')}${st.tax ? ` + ${st.tax.toLocaleString('en-US')} sales tax` : ''}.`);
    const w = bank.transferAtomic([{ name, amount: -price, key: `furniture_buy:${bid}`, game: 'furniture_buy', memo: `Bought ${n} × ${it.name} at the Furniture Store` }, ...(st.move ? [st.move] : [])]);
    const run = async () => {
      if (!this.pool) { const m = this.memInv.get(k) ?? new Map(); m.set(it.key, (m.get(it.key) ?? 0) + n); this.memInv.set(k, m); return; }
      await w.after; const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query('INSERT INTO home_inventory (player_key, item, qty) VALUES ($1,$2,$3) ON CONFLICT (player_key, item) DO UPDATE SET qty = home_inventory.qty + EXCLUDED.qty', [k, it.key, n]);
        for (const s of [...w.stmts, ...st.stmts]) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); console.error('[homes] buy failed:', (e as Error).message); throw new HomeError(/chips|balance|null value/i.test((e as Error).message) ? 'Not enough chips.' : 'Purchase failed. Nothing was charged.'); }
    return { item: it.key, qty: n, price, chips: bank.account(name).chips };
  }

  /** Current state of a home (an empty default room when the owner hasn't decorated, or the row belongs to a past owner). */
  async state(id: string): Promise<HomeState> {
    const p = propertyById(id); if (!isHomeProperty(p)) throw new HomeError('That property has no interior.');
    const owner = await this.ownerOf(id); if (!owner) throw new HomeError('Nobody owns that home.');
    let row: { owner_key: string; layout: HomeLayout; access: HomeAccess; invites: string[] } | undefined;
    if (!this.pool) row = this.memLayout.get(id);
    else { const r = (await this.pool.query('SELECT * FROM home_layout WHERE property_id = $1', [id])).rows[0]; if (r) row = { owner_key: String(r.owner_key), layout: { wall: String(r.wall), floor: String(r.floor), items: j(r.items, []) }, access: (ACCESS.has(r.access as HomeAccess) ? r.access : 'invite') as HomeAccess, invites: j(r.invites, []) }; }
    if (!row || row.owner_key !== keyOf(owner)) return { id, owner, layout: { ...EMPTY_LAYOUT, items: [] }, access: 'invite', invites: [] };
    return { id, owner, ...row };
  }
  private async put(id: string, owner: string, s: Omit<HomeState, 'id' | 'owner'>) {
    if (!this.pool) { this.memLayout.set(id, { owner_key: keyOf(owner), ...s }); return; }
    await this.pool.query(`INSERT INTO home_layout (property_id, owner_key, wall, floor, items, access, invites, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (property_id) DO UPDATE SET owner_key = EXCLUDED.owner_key, wall = EXCLUDED.wall, floor = EXCLUDED.floor, items = EXCLUDED.items, access = EXCLUDED.access, invites = EXCLUDED.invites, updated_at = EXCLUDED.updated_at`,
    [id, keyOf(owner), s.layout.wall, s.layout.floor, JSON.stringify(s.layout.items), s.access, JSON.stringify(s.invites), this.clock()]);
  }
  private async requireOwner(name: string, id: unknown) {
    if (typeof id !== 'string') throw new HomeError('Pick a home.');
    const st = await this.state(id); if (keyOf(st.owner) !== keyOf(name)) throw new HomeError('Only the owner can change this home.'); return st;
  }
  async save(name: string, id: unknown, layout: unknown) {
    const st = await this.requireOwner(name, id); const inv = await this.inventory(name);
    const v = validateLayout(layout, await this.available(name, st.id), (key) => (inv.get(key) ?? 0) > 0); if (!v.ok) throw new HomeError(v.error);
    await this.put(st.id, name, { layout: v.layout, access: st.access, invites: st.invites });
    return { ...st, layout: v.layout };
  }
  async setAccess(name: string, id: unknown, access: unknown, invites: unknown) {
    const st = await this.requireOwner(name, id);
    const a = typeof access === 'string' && ACCESS.has(access as HomeAccess) ? access as HomeAccess : st.access;
    const inv = Array.isArray(invites) ? [...new Set(invites.filter((x): x is string => typeof x === 'string').map(keyOf).filter((x) => x && x.length <= 32 && x !== keyOf(name)))].slice(0, MAX_INVITES) : st.invites;
    await this.put(st.id, name, { layout: st.layout, access: a, invites: inv });
    return { ...st, access: a, invites: inv };
  }
  /** Homes a player owns, with whether `viewer` may visit (profile "Visit" button). */
  async homesOf(player: string, viewer: string | null) {
    const re = getRealEstate(); const all = re ? await re.owned() : [];
    const mine = all.filter((o) => keyOf(o.owner) === keyOf(player) && isHomeProperty(propertyById(o.id)));
    const out = [];
    for (const o of mine) { const st = await this.state(o.id); out.push({ id: o.id, label: propertyById(o.id)!.label, access: st.access, canVisit: !!viewer && canVisit(st.access, st.invites, st.owner, viewer), items: st.layout.items.length }); }
    return out;
  }
}

let homes: Homes | null = null;
export const getHomes = () => homes;
export function setHomes(h: Homes | null) { homes = h; }
export async function initHomes(): Promise<void> {
  const url = databaseUrl();
  if (!url) { homes = new Homes(null); setBootState('homes', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[homes] pool error:', e.message));
  await bootAttach('homes', async () => { try { const h = new Homes(pool as unknown as PoolLike); await h.init(); homes = h; console.log('[homes] ready'); return true; } catch (e) { console.error('[homes] init failed:', (e as Error).message); return false; } });
}

/** Who is inside each home right now (socket id → visitor). */
export interface Visitor { sid: string; name: string; x: number; z: number; ry: number }
const inside = new Map<string, Map<string, Visitor>>();
const roomOf = (id: string) => `home:${id}`;
const peers = (id: string) => [...(inside.get(id)?.values() ?? [])];
export const resetHomesForTest = () => inside.clear();

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerHomes(io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf(); if (!n) throw new HomeError('Sign in to visit and decorate homes.'); return n; };
  let at: string | null = null; let lastPos = 0; let lastChat = 0;
  const leave = () => {
    if (!at) return; const id = at; at = null; void socket.leave(roomOf(id));
    const m = inside.get(id); m?.delete(socket.id); if (m && !m.size) inside.delete(id);
    io.to(roomOf(id)).emit('home_peers', { id, peers: peers(id) });
  };
  const on = (ev: string, fn: (b: Record<string, unknown>, h: Homes) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { if (!homes) throw new HomeError('Homes are opening up. Try again in a moment.'); const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b, homes)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof HomeError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  on('furn_catalog', (_b, h) => h.catalog());
  on('furn_locker', (_b, h) => h.locker(need()));
  on('furn_buy', (b, h) => h.buy(need(), b.item, b.qty ?? 1));
  on('home_of', (b, h) => (typeof b.player === 'string' ? h.homesOf(b.player, nameOf()).then((homes) => ({ homes })) : { homes: [] }));
  on('home_enter', async (b, h) => {
    const n = need(); if (typeof b.id !== 'string') throw new HomeError('Pick a home.');
    const st = await h.state(b.id);
    if (!canVisit(st.access, st.invites, st.owner, n)) throw new HomeError(st.access === 'locked' ? `${st.owner}'s home is locked.` : `${st.owner}'s home is invite only.`);
    const m = inside.get(st.id) ?? new Map<string, Visitor>();
    if (keyOf(st.owner) !== keyOf(n) && m.size >= MAX_VISITORS) throw new HomeError('That home is full right now.');
    leave(); at = st.id; inside.set(st.id, m); m.set(socket.id, { sid: socket.id, name: n, x: 1.5 + m.size * 0.8, z: 8.5, ry: Math.PI });
    void socket.join(roomOf(st.id)); io.to(roomOf(st.id)).emit('home_peers', { id: st.id, peers: peers(st.id) });
    const mine = keyOf(st.owner) === keyOf(n);
    return { home: { ...st, invites: mine ? st.invites : [] }, owner: mine, peers: peers(st.id), me: socket.id, ...(mine ? { locker: await h.locker(n) } : {}) };
  });
  on('home_leave', () => { leave(); return {}; });
  on('home_save', async (b, h) => {
    const n = need(); const st = await h.save(n, b.id, b.layout);
    io.to(roomOf(st.id)).emit('home_layout', { id: st.id, layout: st.layout });
    return { home: st, locker: await h.locker(n) };
  });
  on('home_access', async (b, h) => {
    const n = need(); const st = await h.setAccess(n, b.id, b.access, b.invites);
    // Re-apply the rule to everyone inside: anyone no longer allowed is sent out.
    for (const v of peers(st.id)) if (!canVisit(st.access, st.invites, st.owner, v.name)) { const s = io.sockets.sockets.get(v.sid); s?.emit('home_kicked', { id: st.id, why: st.access === 'locked' ? 'The owner locked the home.' : 'The owner changed who can visit.' }); s?.leave(roomOf(st.id)); inside.get(st.id)?.delete(v.sid); }
    io.to(roomOf(st.id)).emit('home_peers', { id: st.id, peers: peers(st.id) });
    return { home: st };
  });
  socket.on('home_pos', (p: unknown) => {
    if (!at) return; const now = Date.now(); if (now - lastPos < 120) return; lastPos = now;
    const o = (p ?? {}) as Record<string, unknown>; const c = clampPos(o.x, o.z); const v = inside.get(at)?.get(socket.id); if (!c || !v) return;
    v.x = c.x; v.z = c.z; v.ry = Number.isFinite(Number(o.ry)) ? Number(o.ry) : v.ry;
    socket.to(roomOf(at)).emit('home_pos', { sid: socket.id, x: v.x, z: v.z, ry: v.ry });
  });
  socket.on('home_chat', (t: unknown) => {
    const n = nameOf(); if (!at || !n || typeof t !== 'string') return; const now = Date.now(); if (now - lastChat < 700) return; lastChat = now;
    const text = t.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX); if (!text) return;
    io.to(roomOf(at)).emit('home_chat', { sid: socket.id, name: n, text, at: now });
  });
  socket.on('disconnect', leave);
}

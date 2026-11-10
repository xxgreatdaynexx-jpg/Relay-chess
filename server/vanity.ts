/**
 * Vanity Desk: titles, fireworks, liveries and shout-outs. Each purchase is a chip sink (game 'vanity').
 * Additive tables only. Wallets are never pushed negative.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { bootAttach, setBootState } from './boot-retry.js';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { px } from './price-index.js';
import { getFleet, setCraftPaintHook } from './fleet.js';
import { getChatLog } from './chat.js';
import { setChatTitleHook } from './chat.js';
import { validateChat } from '../shared/chat.js';
import {
  VANITY_FIREWORKS, VANITY_LIVERIES, VANITY_TITLES, SHOUT_COOLDOWN_MS, SHOUT_MAX, SHOUT_PRICE,
  fireworksById, liveryById, titleById,
} from '../shared/vanity.js';

export class VanityError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();

export const VANITY_MIGRATION = `
CREATE TABLE IF NOT EXISTS vanity_titles (
  player_key TEXT NOT NULL, title_id TEXT NOT NULL, paid BIGINT NOT NULL, bought_at BIGINT NOT NULL, equipped BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (player_key, title_id));
CREATE TABLE IF NOT EXISTS vanity_liveries (
  id TEXT PRIMARY KEY, player_key TEXT NOT NULL, livery_id TEXT NOT NULL, craft_id TEXT, paid BIGINT NOT NULL, bought_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS vanity_liveries_player ON vanity_liveries (player_key);
CREATE TABLE IF NOT EXISTS vanity_shouts (
  player_key TEXT PRIMARY KEY, last_at BIGINT NOT NULL);
`;

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };

interface TitleRow { id: string; paid: number; at: number; equipped: boolean }
interface LiveryRow { id: string; liveryId: string; craftId: string | null; paid: number; at: number }

export class Vanity {
  private titles = new Map<string, TitleRow[]>();
  private liveries = new Map<string, LiveryRow[]>();
  private shouts = new Map<string, number>();
  /** player_key -> display title, for the sync chat hook */
  private equippedNames = new Map<string, string>();
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) {}
  async init() {
    if (this.pool) {
      await this.pool.query(VANITY_MIGRATION);
      const rows = (await this.pool.query("SELECT player_key, title_id FROM vanity_titles WHERE equipped = TRUE")).rows;
      for (const r of rows) { const name = titleById(String(r.title_id))?.name; if (name) this.equippedNames.set(String(r.player_key), name); }
    }
  }
  liveTitle(name: string): string | null { return this.equippedNames.get(keyOf(name)) ?? null; }

  async ownedTitles(name: string): Promise<TitleRow[]> {
    const k = keyOf(name);
    if (this.pool) return (await this.pool.query('SELECT title_id, paid, bought_at, equipped FROM vanity_titles WHERE player_key = $1', [k])).rows.map((r) => ({ id: String(r.title_id), paid: Number(r.paid), at: Number(r.bought_at), equipped: !!r.equipped }));
    return [...(this.titles.get(k) ?? [])];
  }
  async equippedTitle(name: string): Promise<string | null> {
    const row = (await this.ownedTitles(name)).find((t) => t.equipped);
    return row ? (titleById(row.id)?.name ?? row.id) : null;
  }
  async ownedLiveries(name: string): Promise<LiveryRow[]> {
    const k = keyOf(name);
    if (this.pool) return (await this.pool.query('SELECT id, livery_id, craft_id, paid, bought_at FROM vanity_liveries WHERE player_key = $1 ORDER BY bought_at', [k])).rows.map((r) => ({ id: String(r.id), liveryId: String(r.livery_id), craftId: r.craft_id == null ? null : String(r.craft_id), paid: Number(r.paid), at: Number(r.bought_at) }));
    return [...(this.liveries.get(k) ?? [])];
  }
  async lastShout(name: string): Promise<number> {
    const k = keyOf(name);
    if (this.pool) return Number((await this.pool.query('SELECT last_at FROM vanity_shouts WHERE player_key = $1', [k])).rows[0]?.last_at ?? 0);
    return this.shouts.get(k) ?? 0;
  }

  async paintMap(name: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const row of await this.ownedLiveries(name)) {
      if (!row.craftId) continue;
      const color = liveryById(row.liveryId)?.color;
      if (color != null) out[row.craftId] = color;
    }
    return out;
  }
  async view(name: string | null) {
    const now = this.clock();
    const catalog = {
      titles: VANITY_TITLES.map((t) => ({ ...t, basePrice: t.price, price: px(t.price) })),
      fireworks: VANITY_FIREWORKS.map((t) => ({ ...t, basePrice: t.price, price: px(t.price) })),
      liveries: VANITY_LIVERIES.map((t) => ({ ...t, basePrice: t.price, price: px(t.price) })),
      shout: { name: 'City shout-out', price: px(SHOUT_PRICE), basePrice: SHOUT_PRICE, max: SHOUT_MAX, cooldownMs: SHOUT_COOLDOWN_MS, blurb: 'Post a short announcement to city chat. Once an hour.' },
    };
    if (!name) return { signedIn: false, chips: null, catalog, titles: [], equipped: null, liveries: [], crafts: [], shoutAt: 0, now };
    const [titles, liveries, shoutAt, chips, crafts] = await Promise.all([
      this.ownedTitles(name),
      this.ownedLiveries(name),
      this.lastShout(name),
      Promise.resolve(getBank().ready ? getBank().account(name).chips : null),
      (getFleet()?.owned(name) ?? Promise.resolve([])).then((l) => l.filter((c) => c.kind === 'boat' || c.kind === 'jet').map((c) => ({ id: c.id, kind: c.kind, model: c.model }))).catch(() => []),
    ]);
    const equipped = titles.find((t) => t.equipped)?.id ?? null;
    return { signedIn: true, chips, catalog, titles, equipped, liveries, crafts, shoutAt, now };
  }

  private async charge(name: string, amount: number, key: string, memo: string) {
    const bank = getBank();
    if (!bank.canAfford(name, amount)) throw new VanityError('Not enough chips.');
    const w = bank.transferAtomic([{ name, amount: -amount, key, game: 'vanity', memo }]);
    return w;
  }

  async buyTitle(name: string, id: unknown) {
    const t = titleById(id); if (!t) throw new VanityError('That title is not on the desk.');
    const have = await this.ownedTitles(name); if (have.some((x) => x.id === t.id)) throw new VanityError('You already own that title.');
    const price = px(t.price); const at = this.clock(); const k = keyOf(name); const bid = randomUUID();
    const w = await this.charge(name, price, `vanity:title:${t.id}:${k}`, `Vanity Desk: ${t.name} title`);
    const run = async () => {
      if (!this.pool) {
        const l = this.titles.get(k) ?? [];
        for (const x of l) x.equipped = false;
        l.push({ id: t.id, paid: price, at, equipped: true });
        this.titles.set(k, l);
        return;
      }
      await w.after; const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query('UPDATE vanity_titles SET equipped = FALSE WHERE player_key = $1', [k]);
        await cl.query('INSERT INTO vanity_titles (player_key, title_id, paid, bought_at, equipped) VALUES ($1,$2,$3,$4,TRUE)', [k, t.id, price, at]);
        for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); if (e instanceof VanityError) throw e; throw new VanityError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : 'Purchase failed. Nothing was charged.'); }
    this.equippedNames.set(k, t.name);
    return { id: t.id, price, chips: getBank().account(name).chips };
  }

  async equipTitle(name: string, id: unknown) {
    const k = keyOf(name);
    if (id == null || id === '' || id === 'none') {
      if (this.pool) await this.pool.query('UPDATE vanity_titles SET equipped = FALSE WHERE player_key = $1', [k]);
      else for (const t of this.titles.get(k) ?? []) t.equipped = false;
      this.equippedNames.delete(k);
      return { equipped: null };
    }
    const t = titleById(id); if (!t) throw new VanityError('Unknown title.');
    const have = await this.ownedTitles(name); if (!have.some((x) => x.id === t.id)) throw new VanityError('Buy that title first.');
    if (this.pool) {
      await this.pool.query('UPDATE vanity_titles SET equipped = (title_id = $2) WHERE player_key = $1', [k, t.id]);
    } else {
      for (const x of this.titles.get(k) ?? []) x.equipped = x.id === t.id;
    }
    this.equippedNames.set(k, t.name);
    return { equipped: t.id, name: t.name };
  }

  async fireworks(name: string, id: unknown) {
    const t = fireworksById(id); if (!t) throw new VanityError('That show is not on the desk.');
    const price = px(t.price); const bid = randomUUID();
    const w = await this.charge(name, price, `vanity:fw:${bid}`, `Vanity Desk: ${t.name}`);
    const run = async () => {
      if (this.pool) {
        await w.after; const cl = await this.pool.connect();
        try { await cl.query('BEGIN'); for (const s of w.stmts) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
        catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
      }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); throw new VanityError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : 'Purchase failed. Nothing was charged.'); }
    const event = { id: t.id, name: t.name, by: name.trim(), durationMs: t.durationMs, at: this.clock() };
    io?.emit('vanity_fireworks', event);
    return { ...event, price, chips: getBank().account(name).chips };
  }

  async buyLivery(name: string, id: unknown) {
    const t = liveryById(id); if (!t) throw new VanityError('That livery is not on the desk.');
    const price = px(t.price); const at = this.clock(); const k = keyOf(name); const rowId = randomUUID();
    const w = await this.charge(name, price, `vanity:livery:${rowId}`, `Vanity Desk: ${t.name} livery`);
    const run = async () => {
      if (!this.pool) {
        const l = this.liveries.get(k) ?? [];
        l.push({ id: rowId, liveryId: t.id, craftId: null, paid: price, at });
        this.liveries.set(k, l);
        return;
      }
      await w.after; const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query('INSERT INTO vanity_liveries (id, player_key, livery_id, craft_id, paid, bought_at) VALUES ($1,$2,$3,$4,$5,$6)', [rowId, k, t.id, null, price, at]);
        for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); throw new VanityError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : 'Purchase failed. Nothing was charged.'); }
    return { id: rowId, liveryId: t.id, price, chips: getBank().account(name).chips };
  }

  async applyLivery(name: string, rowId: unknown, craftId: unknown) {
    if (typeof rowId !== 'string') throw new VanityError('Pick a livery.');
    const k = keyOf(name);
    const mine = await this.ownedLiveries(name);
    const row = mine.find((x) => x.id === rowId); if (!row) throw new VanityError('You do not own that livery.');
    const cid = craftId == null || craftId === '' ? null : String(craftId);
    if (cid) {
      const crafts = await (getFleet()?.owned(name) ?? Promise.resolve([]));
      if (!crafts.some((c) => c.id === cid && (c.kind === 'boat' || c.kind === 'jet'))) throw new VanityError('Apply that to a yacht or jet you own.');
    }
    if (this.pool) {
      if (cid) await this.pool.query('UPDATE vanity_liveries SET craft_id = NULL WHERE player_key = $1 AND craft_id = $2', [k, cid]);
      await this.pool.query('UPDATE vanity_liveries SET craft_id = $3 WHERE id = $1 AND player_key = $2', [rowId, k, cid]);
    } else {
      const l = this.liveries.get(k) ?? [];
      if (cid) for (const x of l) if (x.craftId === cid) x.craftId = null;
      const x = l.find((r) => r.id === rowId); if (x) x.craftId = cid;
    }
    return { id: rowId, craftId: cid };
  }

  async shout(name: string, raw: unknown) {
    const check = validateChat(raw); if (!check.ok) throw new VanityError(check.error);
    if ([...check.text].length > SHOUT_MAX) throw new VanityError(`Keep the shout-out under ${SHOUT_MAX} characters.`);
    const now = this.clock(); const last = await this.lastShout(name);
    if (last && now - last < SHOUT_COOLDOWN_MS) {
      const wait = Math.ceil((SHOUT_COOLDOWN_MS - (now - last)) / 60_000);
      throw new VanityError(`You can shout again in ${wait} minute${wait === 1 ? '' : 's'}.`);
    }
    const price = px(SHOUT_PRICE); const k = keyOf(name); const bid = randomUUID();
    const w = await this.charge(name, price, `vanity:shout:${bid}`, 'Vanity Desk: city shout-out');
    const run = async () => {
      if (!this.pool) { this.shouts.set(k, now); return; }
      await w.after; const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query('INSERT INTO vanity_shouts (player_key, last_at) VALUES ($1,$2) ON CONFLICT (player_key) DO UPDATE SET last_at = EXCLUDED.last_at', [k, now]);
        for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); throw new VanityError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : 'Purchase failed. Nothing was charged.'); }
    const title = this.liveTitle(name);
    const chat = getChatLog();
    const message = chat?.postShout ? chat.postShout(name, check.text, now, title) : { id: now, name: name.trim(), text: check.text, at: now, shout: true as const, ...(title ? { title } : {}) };
    io?.emit('chat_msg', message);
    return { price, text: check.text, chips: getBank().account(name).chips, message };
  }
}

let vanity: Vanity | null = null;
let io: Server | null = null;
export const getVanity = () => vanity;
export function setVanity(v: Vanity | null) { vanity = v; setChatTitleHook(v ? (n) => v.liveTitle(n) : null); setCraftPaintHook(v ? (n) => v.paintMap(n) : null); }
export async function initVanity(): Promise<void> {
  const url = databaseUrl();
  if (!url) { const v = new Vanity(null); setVanity(v); setBootState('vanity', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[vanity] pool error:', e.message));
  await bootAttach('vanity', async () => { try { const v = new Vanity(pool as unknown as PoolLike); await v.init(); setVanity(v); console.log('[vanity] ready'); return true; } catch (e) { console.error('[vanity] init failed:', (e as Error).message); return false; } });
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerVanity(server: Server, socket: Socket): void {
  io = server;
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf(); if (!n) throw new VanityError('Sign in first.'); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>, v: Vanity) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { if (!vanity) throw new VanityError('Opening up. Try again in a moment.'); const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b, vanity)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof VanityError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  on('vanity_view', async (_b, v) => v.view(nameOf()));
  on('vanity_buy_title', async (b, v) => v.buyTitle(need(), b.id));
  on('vanity_equip_title', async (b, v) => v.equipTitle(need(), b.id));
  on('vanity_fireworks', async (b, v) => v.fireworks(need(), b.id));
  on('vanity_buy_livery', async (b, v) => v.buyLivery(need(), b.id));
  on('vanity_apply_livery', async (b, v) => v.applyLivery(need(), b.id, b.craftId));
  on('vanity_shout', async (b, v) => v.shout(need(), b.text));
}

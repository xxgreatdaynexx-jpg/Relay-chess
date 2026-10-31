/** Skin inventory: cases, keys and skins as individually-id'd items. Memory is authoritative; Postgres written behind (restart-safe, idempotent by source key). */
import pg from 'pg';
import { randomInt, randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import { CASE_NAME, DROP_CASE_CHANCE, DROP_MIN_MS, KEY_NAME, rollSkin, SKIN_BY_ID, SKINS, skinToken, type ItemKind, type SkinDef, type SkinItem } from '../shared/skins.js';

export interface StoredItem extends SkinItem { owner: string; ownerName: string; sourceKey: string; gone: boolean }
export interface ItemEvent { item: string; kind: string; from: string | null; to: string | null; memo: string; at: number }
export interface ItemStore { init(): Promise<void>; loadAll(): Promise<StoredItem[]>; write(items: StoredItem[], events: ItemEvent[]): Promise<void> }

export const ITEMS_MIGRATION = [
  `CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY, player_key TEXT NOT NULL, owner_name TEXT NOT NULL, kind TEXT NOT NULL, skin_id TEXT NOT NULL DEFAULT '',
    wear REAL NOT NULL DEFAULT 0, seed INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL, source_key TEXT NOT NULL UNIQUE,
    equipped BOOLEAN NOT NULL DEFAULT false, locked TEXT, gone BOOLEAN NOT NULL DEFAULT false,
    created_at BIGINT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS item_events (id SERIAL PRIMARY KEY, item_id TEXT NOT NULL, kind TEXT NOT NULL, from_key TEXT, to_key TEXT, memo TEXT NOT NULL DEFAULT '', at BIGINT NOT NULL)`,
];

export class PgItemStore implements ItemStore {
  constructor(private readonly db: Queryable & { connect?: () => Promise<pg.PoolClient> }) { db.on?.('error', (e) => console.error('[skins] pool error:', e.message)); }
  async init() { for (const q of ITEMS_MIGRATION) await this.db.query(q); }
  async loadAll(): Promise<StoredItem[]> {
    const { rows } = await this.db.query('SELECT * FROM inventory_items');
    return rows.map((r) => ({
      id: String(r.id), owner: String(r.player_key), ownerName: String(r.owner_name), kind: r.kind as ItemKind, skin: String(r.skin_id), float: Number(r.wear), seed: Number(r.seed),
      source: String(r.source), sourceKey: String(r.source_key), equipped: Boolean(r.equipped), locked: r.locked ? String(r.locked) as never : undefined, gone: Boolean(r.gone), at: Number(r.created_at),
    }));
  }
  /** Every change (item rows + audit events) lands in one transaction. */
  async write(items: StoredItem[], events: ItemEvent[]) {
    const c = this.db.connect ? await this.db.connect() : null;
    const q = (sql: string, args: unknown[]) => (c ?? this.db).query(sql, args);
    try {
      if (c) await c.query('BEGIN');
      for (const i of items) {
        await q(`INSERT INTO inventory_items (id, player_key, owner_name, kind, skin_id, wear, seed, source, source_key, equipped, locked, gone, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT (id) DO UPDATE SET player_key = EXCLUDED.player_key, owner_name = EXCLUDED.owner_name, equipped = EXCLUDED.equipped, locked = EXCLUDED.locked, gone = EXCLUDED.gone, updated_at = now()`,
        [i.id, i.owner, i.ownerName, i.kind, i.skin, i.float, i.seed, i.source, i.sourceKey, i.equipped, i.locked ?? null, i.gone, i.at]);
      }
      for (const e of events) await q('INSERT INTO item_events (item_id, kind, from_key, to_key, memo, at) VALUES ($1,$2,$3,$4,$5,$6)', [e.item, e.kind, e.from, e.to, e.memo, e.at]);
      if (c) await c.query('COMMIT');
    } catch (e) { if (c) await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c?.release(); }
  }
}

export const playerKey = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();
const rand = () => randomInt(0, 2 ** 32) / 2 ** 32;
export class RuleError extends Error {}

export class ItemVault {
  items = new Map<string, StoredItem>();
  private sources = new Set<string>();
  private store: ItemStore | null = null;
  private chain: Promise<void> = Promise.resolve();
  onChange?: (ownerKey: string) => void;
  readonly listeners = new Set<(ownerKey: string) => void>();
  constructor(private readonly rng: () => number = rand) {}

  async attach(store: ItemStore): Promise<boolean> {
    try {
      await store.init();
      for (const i of await store.loadAll()) { this.items.set(i.id, i); this.sources.add(i.sourceKey); }
      this.store = store;
      return true;
    } catch (e) { console.error('[skins] postgres unavailable, items in memory only:', (e as Error).message); return false; }
  }
  async flush() { await this.chain; }
  /** Queue one atomic write of these items + events. */
  commit(items: StoredItem[], events: ItemEvent[]) {
    for (const k of new Set(items.map((i) => i.owner))) { this.onChange?.(k); for (const l of this.listeners) l(k); }
    if (!this.store) return;
    const snap = items.map((i) => ({ ...i }));
    this.chain = this.chain.then(() => this.store!.write(snap, events)).catch((e) => console.error('[skins] save failed:', (e as Error).message));
  }
  hasSource(k: string) { return this.sources.has(k); }

  /** Make a new item, idempotent by sourceKey. Returns null if that source already produced one. */
  make(name: string, kind: ItemKind, sourceKey: string, source: string, skin?: SkinDef): StoredItem | null {
    if (this.sources.has(sourceKey)) return null;
    const it: StoredItem = {
      id: randomUUID(), owner: playerKey(name), ownerName: name.trim(), kind, skin: skin?.id ?? '', float: skin ? Math.round(this.rng() * 1e5) / 1e5 : 0,
      seed: skin ? Math.floor(this.rng() * 1000) : 0, source, sourceKey, equipped: false, gone: false, at: Date.now(),
    };
    this.items.set(it.id, it); this.sources.add(sourceKey);
    return it;
  }

  owned(name: string): StoredItem[] {
    const k = playerKey(name);
    return [...this.items.values()].filter((i) => i.owner === k && !i.gone).sort((a, b) => b.at - a.at);
  }
  view(i: StoredItem): SkinItem { return { id: i.id, kind: i.kind, skin: i.skin, float: i.float, seed: i.seed, at: i.at, source: i.source, equipped: i.equipped, ...(i.locked ? { locked: true } : {}) }; }
  inventory(name: string): SkinItem[] { return this.owned(name).map((i) => this.view(i)); }

  /** One drop per signed-in human per match: 50% case, 50% key. */
  dropForMatch(matchId: string, players: Array<{ name: string; ms: number; kills: number; deaths: number }>): Array<{ name: string; item: SkinItem }> {
    const out: Array<{ name: string; item: SkinItem }> = [];
    for (const p of players) {
      if (p.ms < DROP_MIN_MS && p.kills + p.deaths < 1) continue;
      const kind: ItemKind = this.rng() < DROP_CASE_CHANCE ? 'case' : 'key';
      const it = this.make(p.name, kind, `drop:${matchId}:${playerKey(p.name)}`, 'arena-drop');
      if (!it) continue;
      this.commit([it], [{ item: it.id, kind: 'drop', from: null, to: it.owner, memo: `${kind} from match ${matchId}`, at: Date.now() }]);
      out.push({ name: p.name, item: this.view(it) });
    }
    return out;
  }

  /** Consume one free case + one free key, roll a skin. Returns the new item and a reel for the unboxing animation. */
  openCase(name: string, caseId?: unknown): { item: SkinItem; reel: string[]; win: number } {
    const mine = this.owned(name).filter((i) => !i.locked);
    const c = (typeof caseId === 'string' ? mine.find((i) => i.id === caseId && i.kind === 'case') : undefined) ?? mine.find((i) => i.kind === 'case');
    const k = mine.find((i) => i.kind === 'key');
    if (!c) throw new RuleError(`You need a ${CASE_NAME}. They drop from Arena matches.`);
    if (!k) throw new RuleError(`You need a ${KEY_NAME} to open it. Keys drop from Arena matches.`);
    const skin = rollSkin(this.rng(), this.rng());
    const it = this.make(name, 'skin', `open:${c.id}`, 'case', skin)!;
    c.gone = true; k.gone = true;
    this.commit([c, k, it], [
      { item: c.id, kind: 'open', from: c.owner, to: null, memo: 'case opened', at: Date.now() },
      { item: k.id, kind: 'open', from: k.owner, to: null, memo: 'key used', at: Date.now() },
      { item: it.id, kind: 'unbox', from: null, to: it.owner, memo: `${skin.id} from case ${c.id}`, at: Date.now() },
    ]);
    const WIN = 40;
    const reel = Array.from({ length: 48 }, (_, i) => (i === WIN ? skin.id : rollSkin(this.rng(), this.rng()).id));
    return { item: this.view(it), reel, win: WIN };
  }

  /** Equip a skin for its weapon (unequips the other one), or unequip it if already equipped. */
  equip(name: string, itemId: unknown): void {
    const i = typeof itemId === 'string' ? this.items.get(itemId) : undefined;
    if (!i || i.gone || i.owner !== playerKey(name) || i.kind !== 'skin') throw new RuleError('That item is not in your inventory.');
    if (i.locked) throw new RuleError('That item is listed or in a trade.');
    const w = SKIN_BY_ID.get(i.skin)!.weapon;
    const changed: StoredItem[] = [i];
    if (i.equipped) i.equipped = false;
    else {
      for (const o of this.owned(name)) if (o.equipped && o.kind === 'skin' && SKIN_BY_ID.get(o.skin)?.weapon === w) { o.equipped = false; changed.push(o); }
      i.equipped = true;
    }
    this.commit(changed, []);
  }

  loadout(name: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const i of this.owned(name)) if (i.equipped && i.kind === 'skin') { const s = SKIN_BY_ID.get(i.skin); if (s) out[s.weapon] = skinToken(i); }
    return out;
  }
}

let vault = new ItemVault();
export const getVault = () => vault;
export function resetVault(rng?: () => number): ItemVault { vault = new ItemVault(rng); return vault; }

export async function initSkinStorage(): Promise<void> {
  const url = databaseUrl();
  if (!url) { console.warn('[skins] no DATABASE_URL; items in memory only'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  if (await vault.attach(new PgItemStore(pool))) console.log(`[skins] connected (${vault.items.size} items)`);
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
const nameOf = (s: Socket): string | null => (s.data as { account?: { name: string } }).account?.name ?? null;
const room = (k: string) => `inv:${k}`;
let wired: Server | null = null;

export function registerSkins(io: Server, socket: Socket): void {
  if (wired !== io) { wired = io; vault.onChange = (k) => io.to(room(k)).emit('inv_changed'); }
  const on = (ev: string, fn: (b: Record<string, unknown>, n: string | null) => Record<string, unknown> | void) =>
    socket.on(ev, (payload: unknown, ack?: Ack) => {
      try { const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...(fn(b, nameOf(socket)) ?? {}) }); }
      catch (e) { ack?.({ ok: false, error: e instanceof RuleError ? e.message : (e as Error).message || 'Something went wrong.' }); }
    });
  const need = (n: string | null) => { if (!n) throw new RuleError('Sign in to own skins. Guests can look around.'); return n; };
  on('inv_get', (_b, n) => {
    for (const r of socket.rooms) if (r.startsWith('inv:')) void socket.leave(r);
    if (n) void socket.join(room(playerKey(n)));
    return { signedIn: !!n, items: n ? vault.inventory(n) : [], catalog: SKINS.length };
  });
  on('inv_open', (b, n) => vault.openCase(need(n), b.caseId));
  on('inv_equip', (b, n) => { vault.equip(need(n), b.id); return { items: vault.inventory(n!) }; });
}

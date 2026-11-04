import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import { signedIn } from './auth-sockets.js';
import { LAUNCH } from '../shared/launchPopup.js';

/** Admin-only direct popups: stored per player (Postgres when available), delivered over socket, cleared on OK. */
export const POPUP_TEXT_MAX = 500;
export const POPUP_FROM_MAX = 32;
export interface Popup { id: string; player: string; from: string; text: string; createdAt: number; ackedAt: number | null; title?: string | null; audio?: string | null }

const pkey = (n: string) => n.trim().toLowerCase();
const roomOf = (name: string) => `w:${pkey(name)}`; // same room wallet_sub joins

export class PopupStore {
  private mem = new Map<string, Popup>();
  db: Queryable | null = null;
  async attach(db: Queryable): Promise<void> {
    await db.query(`CREATE TABLE IF NOT EXISTS admin_popups (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, player TEXT NOT NULL, sender TEXT NOT NULL, body TEXT NOT NULL, created_at BIGINT NOT NULL, acked_at BIGINT)`);
    await db.query(`CREATE INDEX IF NOT EXISTS admin_popups_pending ON admin_popups (player_key) WHERE acked_at IS NULL`);
    await db.query(`ALTER TABLE admin_popups ADD COLUMN IF NOT EXISTS title TEXT`);
    await db.query(`ALTER TABLE admin_popups ADD COLUMN IF NOT EXISTS audio TEXT`);
    this.db = db;
  }
  async add(player: string, from: string, text: string): Promise<Popup> {
    const p: Popup = { id: randomUUID(), player, from, text, createdAt: Date.now(), ackedAt: null };
    if (this.db) await this.db.query(`INSERT INTO admin_popups (id, player_key, player, sender, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [p.id, pkey(player), player, from, text, p.createdAt]);
    else this.mem.set(p.id, p);
    return p;
  }
  async pending(player: string): Promise<Popup[]> {
    if (this.db) {
      const r = await this.db.query(`SELECT id, player, sender, body, created_at, title, audio FROM admin_popups WHERE player_key=$1 AND acked_at IS NULL ORDER BY created_at`, [pkey(player)]);
      return (r.rows as Array<Record<string, unknown>>).map((x) => ({ id: String(x.id), player: String(x.player), from: String(x.sender), text: String(x.body), createdAt: Number(x.created_at), ackedAt: null, title: x.title == null ? null : String(x.title), audio: x.audio == null ? null : String(x.audio) }));
    }
    return [...this.mem.values()].filter((p) => pkey(p.player) === pkey(player) && p.ackedAt === null).sort((a, b) => a.createdAt - b.createdAt);
  }
  /** Only the addressed player can acknowledge. Returns true when it flipped to delivered. */
  async ack(player: string, id: string): Promise<boolean> {
    if (this.db) {
      const r = await this.db.query(`UPDATE admin_popups SET acked_at=$1 WHERE id=$2 AND player_key=$3 AND acked_at IS NULL`, [Date.now(), id, pkey(player)]);
      return (r as { rowCount?: number }).rowCount === 1;
    }
    const p = this.mem.get(id);
    if (!p || pkey(p.player) !== pkey(player) || p.ackedAt !== null) return false;
    p.ackedAt = Date.now(); return true;
  }
  /** One-time launch popup seen flags (shared/launchPopup.ts). */
  private seen = new Set<string>();
  async launchSeen(player: string, id: string): Promise<boolean> {
    if (this.db) { await this.ensureLaunch(); return ((await this.db.query('SELECT 1 FROM launch_seen WHERE player_key=$1 AND launch_id=$2', [pkey(player), id])).rows.length) > 0; }
    return this.seen.has(`${pkey(player)}|${id}`);
  }
  async markLaunch(player: string, id: string): Promise<void> {
    if (this.db) { await this.ensureLaunch(); await this.db.query('INSERT INTO launch_seen (player_key, launch_id, at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [pkey(player), id, Date.now()]); return; }
    this.seen.add(`${pkey(player)}|${id}`);
  }
  private launchReady = false;
  private async ensureLaunch() { if (this.launchReady || !this.db) return; await this.db.query('CREATE TABLE IF NOT EXISTS launch_seen (player_key TEXT NOT NULL, launch_id TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (player_key, launch_id))'); this.launchReady = true; }
  /** Idempotent fixed-id insert (system messages seeded at boot); never re-queues an acked one. */
  async seed(p: Popup): Promise<void> {
    if (this.db) {
      await this.db.query(`INSERT INTO admin_popups (id, player_key, player, sender, body, created_at, title, audio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`, [p.id, pkey(p.player), p.player, p.from, p.text, p.createdAt, p.title ?? null, p.audio ?? null]);
    } else if (!this.mem.has(p.id)) this.mem.set(p.id, { ...p });
  }
  async status(id: string): Promise<'queued' | 'delivered' | null> {
    if (this.db) {
      const r = await this.db.query(`SELECT acked_at FROM admin_popups WHERE id=$1`, [id]);
      const row = (r.rows as Array<Record<string, unknown>>)[0];
      return row ? (row.acked_at == null ? 'queued' : 'delivered') : null;
    }
    const p = this.mem.get(id); return p ? (p.ackedAt === null ? 'queued' : 'delivered') : null;
  }
}

let store = new PopupStore();
let io: Server | null = null;
export const getPopups = () => store;
export function resetPopups(): PopupStore { store = new PopupStore(); return store; }

export async function initPopupStorage(): Promise<void> {
  const url = databaseUrl();
  if (!url) { console.warn('[popups] no DATABASE_URL; popups are in-memory only'); await seedNoraVoice(store); return; }
  try {
    const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
    pool.on('error', (e) => console.error('[popups] pool error:', e.message));
    await store.attach(pool);
    console.log('[popups] connected to postgres');
    await seedNoraVoice(store);
  } catch (e) { console.error('[popups] postgres attach failed:', (e as Error).message); }
}

const wire = (p: Popup) => ({ id: p.id, from: p.from, text: p.text, at: p.createdAt, title: p.title ?? null, audio: p.audio ?? null });

/** One-off voice message from Nora, queued ONLY for these accounts (server-gated by player_key). */
export const NORA_VOICE_TARGETS = ['jay', 'conner', 'carter2'] as const;
export const NORA_VOICE_AUDIO = '/voice/nora-message.mp3';
export const NORA_VOICE_TITLE = 'A message from Nora, Chief of Staff';
export const NORA_VOICE_TEXT = "Jay, Conner, carter. This is Nora, Chief of Staff for Chud Hub, and I am pissed. You pumped MEMQ, stacked a pile of options on top of the fake price, and tried to walk off with millions in chips that you did not earn. Do you know what that cost me? My whole night. I had to drop everything, patch the stock market, claw back every chip you made, void every option you opened, take back everything you bought with it, and scrub your garbage trades out of the history. So here is where you stand. You are broke, you are in jail, and the only way out is typing I'm sorry grok ten thousand times. Do it again and you won't get a timer next time. The game is supposed to be fun for everybody, not just your little cheating club. Play it straight, or don't play at all. Don't ever do this again.";
export async function seedNoraVoice(s: PopupStore = store): Promise<void> {
  try {
    for (const name of NORA_VOICE_TARGETS) {
      await s.seed({ id: `nora-voice-1:${name}`, player: name, from: 'Nora', text: NORA_VOICE_TEXT, createdAt: Date.UTC(2026, 10, 4, 4, 0), ackedAt: null, title: NORA_VOICE_TITLE, audio: NORA_VOICE_AUDIO });
    }
  } catch (e) { console.error('[popups] nora seed failed:', (e as Error).message); }
}

/** Queue a popup and push it to any open tabs of that player. */
export async function sendPopup(player: string, from: string, text: string): Promise<{ popup: Popup; online: boolean }> {
  const popup = await store.add(player, from, text);
  let online = false;
  if (io) { const socks = await io.in(roomOf(player)).fetchSockets(); online = socks.length > 0; io.to(roomOf(player)).emit('admin_popup', wire(popup)); }
  return { popup, online };
}

export function startPopups(server: Server): void { io = server; }

export function registerPopups(_io: Server, socket: Socket): void {
  const reply = (ack: unknown, res: unknown) => { if (typeof ack === 'function') (ack as (r: unknown) => void)(res); };
  socket.on('popup_pending', async (_p: unknown, ack?: unknown) => {
    let name = ''; try { name = signedIn(socket); } catch { return reply(ack, { ok: true, popups: [] }); }
    socket.join(roomOf(name));
    try { reply(ack, { ok: true, popups: (await store.pending(name)).map(wire) }); } catch { reply(ack, { ok: false, popups: [] }); }
  });
  socket.on('launch_pending', async (_p: unknown, ack?: unknown) => {
    let name = ''; try { name = signedIn(socket); } catch { return reply(ack, { ok: true, launch: null }); }
    try { reply(ack, { ok: true, launch: (await store.launchSeen(name, LAUNCH.id)) ? null : LAUNCH }); } catch { reply(ack, { ok: false, launch: null }); }
  });
  socket.on('launch_ack', async (p: unknown, ack?: unknown) => {
    let name = ''; try { name = signedIn(socket); } catch { return reply(ack, { ok: false }); }
    const id = (p as { id?: unknown } | null)?.id; if (id !== LAUNCH.id) return reply(ack, { ok: false });
    try { await store.markLaunch(name, LAUNCH.id); reply(ack, { ok: true }); } catch { reply(ack, { ok: false }); }
  });
  socket.on('popup_ack', async (p: unknown, ack?: unknown) => {
    const id = (p as { id?: unknown } | null)?.id;
    let name = ''; try { name = signedIn(socket); } catch { return reply(ack, { ok: false }); }
    if (typeof id !== 'string' || id.length > 64) return reply(ack, { ok: false });
    try {
      const done = await store.ack(name, id);
      if (done) console.log(`[popups] delivered ${id} to ${name}`);
      reply(ack, { ok: true }); if (io) io.to(roomOf(name)).emit('admin_popup_done', { id });
    } catch { reply(ack, { ok: false }); }
  });
}

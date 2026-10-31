/** Global chat + online-users presence over the main socket. Chat history is kept in memory and written behind to Postgres. */
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import { isQaName } from '../shared/qa.js';
import { isBotName, isGuestName, type Identity } from './accounts.js';
import { getRoom } from './rooms.js';
import {
  CHAT_HISTORY, cleanActivities, validateChat, whereLabel,
  type Activity, type ChatMessage, type OnlineSnapshot, type OnlineUser,
} from '../shared/chat.js';

import { isBuildPost } from './build.js';

export const CHAT_MIGRATION = `CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export interface ChatStore {
  init(): Promise<void>;
  recent(limit: number): Promise<ChatMessage[]>;
  insert(m: ChatMessage): Promise<void>;
  prune(keep: number): Promise<void>;
}

export class PgChatStore implements ChatStore {
  constructor(private readonly db: Queryable) {
    db.on?.('error', (err) => console.error('[chat] postgres pool error:', err.message));
  }
  async init(): Promise<void> { await this.db.query(CHAT_MIGRATION); }
  async recent(limit: number): Promise<ChatMessage[]> {
    const { rows } = await this.db.query('SELECT id, name, body, created_at FROM chat_messages ORDER BY id DESC LIMIT $1', [limit]);
    return rows.map((r) => ({ id: Number(r.id), name: String(r.name), text: String(r.body), at: new Date(r.created_at).getTime() })).reverse();
  }
  async insert(m: ChatMessage): Promise<void> {
    await this.db.query('INSERT INTO chat_messages (id, name, body, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', [m.id, m.name, m.text, new Date(m.at)]);
  }
  async prune(keep: number): Promise<void> {
    await this.db.query('DELETE FROM chat_messages WHERE id < (SELECT COALESCE(MIN(id), 0) FROM (SELECT id FROM chat_messages ORDER BY id DESC LIMIT $1) AS keep)', [keep]);
  }
}

/** Sliding-window limiter: at most `max` messages per `windowMs`, and at least `gapMs` between messages. */
export class ChatRateLimiter {
  private hits = new Map<string, number[]>();
  constructor(readonly max = 5, readonly windowMs = 10_000, readonly gapMs = 600) {}
  take(key: string, now = Date.now()): { ok: true } | { ok: false; retryMs: number } {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    const last = list[list.length - 1];
    if (last !== undefined && now - last < this.gapMs) return { ok: false, retryMs: this.gapMs - (now - last) };
    if (list.length >= this.max) return { ok: false, retryMs: this.windowMs - (now - list[0]) };
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.length || now - v[v.length - 1] > this.windowMs) this.hits.delete(k);
    return { ok: true };
  }
}

/** Chat history (capped) with optional Postgres write-behind. */
export class ChatLog {
  private messages: ChatMessage[] = [];
  private store: ChatStore | null = null;
  private lastId = 0;
  private writes = Promise.resolve();
  private sincePrune = 0;
  readonly limiter = new ChatRateLimiter();
  constructor(readonly cap = CHAT_HISTORY) {}
  get usingDatabase(): boolean { return this.store !== null; }

  async attach(store: ChatStore): Promise<boolean> {
    try {
      await store.init();
      this.messages = (await store.recent(this.cap)).slice(-this.cap);
      this.lastId = this.messages.reduce((m, x) => Math.max(m, x.id), 0);
      this.store = store;
      return true;
    } catch (err) {
      console.error('[chat] postgres unavailable, chat history is in-memory only:', (err as Error).message);
      return false;
    }
  }

  /** Validates, rate-limits and records a message. The name must come from the server-side identity. */
  post(name: string, raw: unknown, now = Date.now()): { ok: true; message: ChatMessage } | { ok: false; error: string } {
    const check = validateChat(raw);
    if (!check.ok) return check;
    const rl = this.limiter.take(name.toLowerCase(), now);
    if (!rl.ok) return { ok: false, error: `Slow down — try again in ${Math.ceil(rl.retryMs / 1000)}s.` };
    // Ids are time-based so they stay unique and ordered across restarts.
    const id = Math.max(this.lastId + 1, now);
    this.lastId = id;
    const message: ChatMessage = { id, name, text: check.text, at: now };
    this.messages.push(message);
    if (this.messages.length > this.cap) this.messages.splice(0, this.messages.length - this.cap);
    this.persist(message);
    return { ok: true, message };
  }

  /** Server-authored message (build notes etc.): no validation or rate limit. */
  postSystem(name: string, text: string, now = Date.now()): ChatMessage {
    const id = Math.max(this.lastId + 1, now);
    this.lastId = id;
    const message: ChatMessage = { id, name, text, at: now };
    this.messages.push(message);
    if (this.messages.length > this.cap) this.messages.splice(0, this.messages.length - this.cap);
    this.persist(message);
    return message;
  }

  /** History as a viewer should see it: QA accounts' messages are hidden from non-QA viewers. */
  history(viewerIsQa: boolean): ChatMessage[] {
    return this.messages.filter((m) => !isBuildPost(m) && (viewerIsQa || !isQaName(m.name))).map((m) => (isQaName(m.name) ? { ...m, qa: true as const } : m));
  }
  get size(): number { return this.messages.length; }
  async flush(): Promise<void> { await this.writes; }

  private persist(m: ChatMessage): void {
    const store = this.store;
    if (!store) return;
    const prune = ++this.sincePrune >= 20;
    if (prune) this.sincePrune = 0;
    this.writes = this.writes
      .then(() => store.insert(m))
      .then(() => (prune ? store.prune(this.cap) : undefined))
      .catch((err) => console.error('[chat] save failed:', (err as Error).message));
  }
}

let log = new ChatLog();
export const getChatLog = () => log;
export function resetChatLog(): ChatLog { log = new ChatLog(); return log; }

export async function initChatStorage(): Promise<void> {
  const url = databaseUrl();
  if (!url) { console.warn('[chat] no DATABASE_URL set; chat history is in-memory only'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  if (await log.attach(new PgChatStore(pool))) console.log(`[chat] connected to postgres (${log.size} messages loaded)`);
}

/* ---------------- presence ---------------- */

export interface PresenceSource { name: string | null; code?: string; spectating?: boolean; activities: Activity[] }

/** Merge per-socket presence into one entry per signed-in user. Bots never appear; guests are only counted. */
export function buildSnapshot(sources: Iterable<PresenceSource>, viewerIsQa: boolean, tableType: (code: string) => 'chess' | 'checkers' | null): OnlineSnapshot {
  const byKey = new Map<string, OnlineUser>();
  let guests = 0;
  for (const s of sources) {
    if (!s.name || isGuestName(s.name)) { guests += 1; continue; }
    if (isBotName(s.name)) continue;
    if (!viewerIsQa && isQaName(s.name)) continue;
    const key = s.name.toLowerCase();
    let u = byKey.get(key);
    if (!u) { u = { name: s.name, table: null, activities: [], where: '' }; if (isQaName(s.name)) u.qa = true; byKey.set(key, u); }
    const gt = s.code ? tableType(s.code) : null;
    if (s.code && gt && (!u.table || (u.table.watching && !s.spectating))) u.table = { code: s.code, gameType: gt, watching: Boolean(s.spectating) };
    for (const a of s.activities) if (!u.activities.includes(a)) u.activities.push(a);
  }
  const users = [...byKey.values()].map((u) => ({ ...u, where: whereLabel(u.table, u.activities) }));
  users.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { users, guests };
}

const nameOf = (s: Socket): string | null => (s.data.account as Identity | undefined)?.name ?? null;
const sourceOf = (s: Socket): PresenceSource => ({
  name: nameOf(s),
  code: typeof s.data.code === 'string' ? s.data.code : undefined,
  spectating: Boolean(s.data.spectating),
  activities: (s.data.activities as Activity[] | undefined) ?? [],
});
const roomType = (code: string): 'chess' | 'checkers' | null => {
  const room = getRoom(code);
  if (!room) return null;
  return room.gameType === 'checkers' ? 'checkers' : 'chess';
};

export function onlineSnapshot(io: Server, viewerIsQa: boolean): OnlineSnapshot {
  return buildSnapshot([...io.sockets.sockets.values()].map(sourceOf), viewerIsQa, roomType);
}

let presenceTimer: ReturnType<typeof setInterval> | null = null;
let lastSent = { pub: '', qa: '' };

/** Push the online list to everyone (QA viewers get the version that includes QA accounts). Only sends on change. */
export function pushPresence(io: Server, force = false): void {
  const pub = onlineSnapshot(io, false);
  const qa = onlineSnapshot(io, true);
  const pubJson = JSON.stringify(pub);
  const qaJson = JSON.stringify(qa);
  if (!force && pubJson === lastSent.pub && qaJson === lastSent.qa) return;
  lastSent = { pub: pubJson, qa: qaJson };
  for (const s of io.sockets.sockets.values()) s.emit('online', isQaName(nameOf(s)) ? qa : pub);
}

export function startPresence(io: Server): void {
  stopPresence();
  lastSent = { pub: '', qa: '' };
  presenceTimer = setInterval(() => pushPresence(io), 2000);
  (presenceTimer as unknown as { unref?: () => void }).unref?.();
}
export function stopPresence(): void { if (presenceTimer) clearInterval(presenceTimer); presenceTimer = null; }

type Ack = (res: { ok: boolean; error?: string; [k: string]: unknown }) => void;

export function registerChat(io: Server, socket: Socket): void {
  socket.data.activities = [];
  socket.on('presence', (payload: unknown) => {
    const body = (payload && typeof payload === 'object' ? payload : {}) as { activities?: unknown };
    socket.data.activities = cleanActivities(body.activities);
  });
  socket.on('online_get', (_payload: unknown, ack?: Ack) => {
    if (typeof ack === 'function') ack({ ok: true, ...onlineSnapshot(io, isQaName(nameOf(socket))) });
  });
  socket.on('chat_history', (_payload: unknown, ack?: Ack) => {
    if (typeof ack === 'function') ack({ ok: true, messages: getChatLog().history(isQaName(nameOf(socket))) });
  });
  socket.on('chat_send', (payload: unknown, ack?: Ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const name = nameOf(socket);
    if (!name) return reply({ ok: false, error: 'Sign in (or claim a name) to chat.' });
    const text = payload && typeof payload === 'object' ? (payload as { text?: unknown }).text : undefined;
    const res = getChatLog().post(name, text);
    if (!res.ok) return reply(res);
    const qa = isQaName(name);
    const msg = qa ? { ...res.message, qa: true as const } : res.message;
    for (const s of io.sockets.sockets.values()) if (!qa || isQaName(nameOf(s))) s.emit('chat_msg', msg);
    reply({ ok: true, message: msg });
  });
}

/** Chud Conquest tables: lobby, seats (with house bots), turn timer, snapshots and the conquest leaderboard. */
import type { Server, Socket } from 'socket.io';
import pg from 'pg';
import { randomInt } from 'node:crypto';
import { act, autoPlace, botAction, CQ_MAPS, CQ_PALETTE, FACTIONS, newGame, publicView, resign, RuleError, type CqAction, type CqState } from '../shared/conquest.js';
import { Leaderboard } from './leaderboard.js';
import { createPgStore, databaseUrl, type Queryable } from './leaderboard-store.js';
import { signedIn } from './auth-sockets.js';

export const CQ_TURN_MS = Number(process.env.CONQUEST_TURN_MS) || 90_000;
export const CQ_BOT_MS = Number(process.env.CONQUEST_BOT_MS ?? 700);
const IDLE_MS = 6 * 60 * 60 * 1000;
const BOT_NAMES = ['Bot Grub', 'Bot Mudlord', 'Bot Snorkel', 'Bot Gristle', 'Bot Wart'];

export interface CqSeat { name: string; bot: boolean; color?: number; faction?: string }
export interface CqSettings { turnMs: number; manualSetup: boolean; map: string; perks: boolean }
export const CQ_TURN_CHOICES = [30_000, 60_000, 90_000, 180_000, 300_000];
export interface CqTable { code: string; host: string; seats: CqSeat[]; game: CqState | null; deadline: number; recorded: boolean; touched: number; settings?: Partial<CqSettings>; /** Snapshot version, bumped on every change (newest wins across instances). */ v?: number }
/** save() returns false when the store already holds a newer version (another instance moved on). */
export interface CqSnapshotStore { init(): Promise<void>; loadAll(): Promise<CqTable[]>; load(code: string): Promise<CqTable | null>; save(t: CqTable): Promise<boolean>; remove(code: string): Promise<void> }

class PgCqStore implements CqSnapshotStore {
  constructor(private readonly db: Queryable) { db.on?.('error', (e) => console.error('[conquest] pool error:', e.message)); }
  async init() { await this.db.query('CREATE TABLE IF NOT EXISTS conquest_snapshots (code TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())'); }
  async loadAll() { const { rows } = await this.db.query('SELECT data FROM conquest_snapshots'); return rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as CqTable); }
  async load(code: string) { const { rows } = await this.db.query('SELECT data FROM conquest_snapshots WHERE code = $1', [code]); const d = rows[0]?.data; return d ? ((typeof d === 'string' ? JSON.parse(d) : d) as CqTable) : null; }
  async save(t: CqTable) {
    const r = await this.db.query(`INSERT INTO conquest_snapshots (code, data, updated_at) VALUES ($1, $2::jsonb, now())
      ON CONFLICT (code) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
      WHERE COALESCE((conquest_snapshots.data->>'v')::bigint, 0) < COALESCE((EXCLUDED.data->>'v')::bigint, 0)`, [t.code, JSON.stringify(t)]);
    return (r as { rowCount?: number | null }).rowCount !== 0;
  }
  async remove(code: string) { await this.db.query('DELETE FROM conquest_snapshots WHERE code = $1', [code]); }
}
export class MemoryCqStore implements CqSnapshotStore {
  rows = new Map<string, string>();
  async init() {}
  async loadAll() { return [...this.rows.values()].map((r) => JSON.parse(r) as CqTable); }
  async load(code: string) { const r = this.rows.get(code); return r ? (JSON.parse(r) as CqTable) : null; }
  async save(t: CqTable) { const cur = this.rows.get(t.code); if (cur && ((JSON.parse(cur) as CqTable).v ?? 0) >= (t.v ?? 0)) return false; this.rows.set(t.code, JSON.stringify(t)); return true; }
  async remove(code: string) { this.rows.delete(code); }
}

export class ConquestHub {
  tables = new Map<string, CqTable>();
  board = new Leaderboard(null);
  store: CqSnapshotStore | null = null;
  onChange: (t: CqTable) => void = () => {};
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private saving = new Map<string, Promise<void>>();
  private stopped = false;
  constructor(private rng: () => number = Math.random) {}

  private code(): string {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    do { c = 'W' + Array.from({ length: 4 }, () => A[randomInt(A.length)]).join(''); } while (this.tables.has(c));
    return c;
  }
  tableOf(name: string): CqTable | undefined {
    const k = name.toLowerCase();
    return [...this.tables.values()].find((t) => t.seats.some((s) => !s.bot && s.name.toLowerCase() === k) && !(t.game && t.game.phase === 'over'));
  }
  get(code: unknown): CqTable {
    const t = typeof code === 'string' ? this.tables.get(code.trim().toUpperCase()) : undefined;
    if (!t) throw new RuleError('No war table with that code.');
    return t;
  }
  create(host: string, now = Date.now()): CqTable {
    const t: CqTable = { code: this.code(), host, seats: [{ name: host, bot: false, color: 0, faction: 'grande' }], game: null, deadline: 0, recorded: false, touched: now, settings: { turnMs: CQ_TURN_MS, manualSetup: true, map: 'chud', perks: true }, v: 0 };
    this.tables.set(t.code, t);
    this.changed(t);
    return t;
  }
  join(code: unknown, name: string): CqTable {
    const t = this.get(code);
    if (t.seats.some((s) => !s.bot && s.name.toLowerCase() === name.toLowerCase())) return t;
    if (t.game) throw new RuleError('That war has already started. You can watch it.');
    if (t.seats.length >= 6) throw new RuleError('The table is full (6 players).');
    this.seatWithFaction(t, { name, bot: false });
    this.changed(t);
    return t;
  }
  addBot(code: unknown, by: string): CqTable {
    const t = this.get(code);
    if (t.game) throw new RuleError('The war has started.');
    if (t.host.toLowerCase() !== by.toLowerCase()) throw new RuleError('Only the host can add bots.');
    if (t.seats.length >= 6) throw new RuleError('The table is full (6 players).');
    const name = BOT_NAMES.find((n) => !t.seats.some((s) => s.name === n))!;
    this.seatWithFaction(t, { name, bot: true }, true);
    this.changed(t);
    return t;
  }
  removeSeat(code: unknown, by: string, index: number): CqTable {
    const t = this.get(code);
    const s = t.seats[index];
    if (t.game || !s) throw new RuleError('Cannot change seats now.');
    const host = t.host.toLowerCase() === by.toLowerCase();
    if (!(host && s.bot) && s.name.toLowerCase() !== by.toLowerCase()) throw new RuleError('Only the host can remove bots.');
    t.seats.splice(index, 1);
    if (!t.seats.some((x) => !x.bot)) { this.drop(t.code); return t; }
    if (s.name === t.host) t.host = t.seats.find((x) => !x.bot)!.name;
    this.changed(t);
    return t;
  }
  /** Seat a newcomer with a free faction (random for bots) and that faction's colour if it is free. */
  private seatWithFaction(t: CqTable, s: CqSeat, random = false): void {
    const free = FACTIONS.filter((f) => !t.seats.some((o) => o.faction === f.id));
    const f = random ? free[Math.floor(this.rng() * free.length)] : free[0];
    s.faction = f?.id;
    s.color = f && !t.seats.some((o) => o.color === f.color) ? f.color : this.freeColor(t);
    t.seats.push(s);
  }
  /** Pick a faction before the war (unique per table). Takes the faction's colour too when it is free. */
  setFaction(code: unknown, by: string, faction: unknown, index?: unknown): CqTable {
    const t = this.get(code);
    if (t.game) throw new RuleError('Factions are locked once the war starts.');
    const f = FACTIONS.find((x) => x.id === faction);
    if (!f) throw new RuleError('Pick one of the factions.');
    const i = this.seatIndex(t, by, index);
    if (t.seats.some((s, j) => j !== i && s.faction === f.id)) throw new RuleError('Someone already leads that faction.');
    const seat = t.seats[i]!;
    seat.faction = f.id;
    if (!t.seats.some((s, j) => j !== i && s.color === f.color)) seat.color = f.color;
    this.changed(t);
    return t;
  }
  private seatIndex(t: CqTable, by: string, index?: unknown): number {
    const isHost = t.host.toLowerCase() === by.toLowerCase();
    const i = index !== undefined && index !== null ? Number(index) : t.seats.findIndex((s) => !s.bot && s.name.toLowerCase() === by.toLowerCase());
    const seat = t.seats[i];
    if (!seat) throw new RuleError('You are not seated.');
    if (seat.bot ? !isHost : seat.name.toLowerCase() !== by.toLowerCase()) throw new RuleError('That is not your seat.');
    return i;
  }
  private freeColor(t: CqTable): number { return CQ_PALETTE.findIndex((_, i) => !t.seats.some((s) => s.color === i)); }
  /** Pick your army colour before the war starts (unique per table). The host may also recolour bots. */
  setColor(code: unknown, by: string, color: unknown, index?: unknown): CqTable {
    const t = this.get(code);
    if (t.game) throw new RuleError('Colours are locked once the war starts.');
    const c = Number(color);
    if (!Number.isInteger(c) || c < 0 || c >= CQ_PALETTE.length) throw new RuleError('Pick one of the colours.');
    const i = this.seatIndex(t, by, index);
    const seat = t.seats[i]!;
    if (t.seats.some((s, j) => j !== i && s.color === c)) throw new RuleError('Someone already has that colour.');
    seat.color = c;
    this.changed(t);
    return t;
  }
  /** Host-only table settings: turn timer length and whether players place their own starting armies. */
  configure(code: unknown, by: string, body: { turnMs?: unknown; manualSetup?: unknown; map?: unknown; perks?: unknown }): CqTable {
    const t = this.get(code);
    if (t.game) throw new RuleError('Settings are locked once the war starts.');
    if (t.host.toLowerCase() !== by.toLowerCase()) throw new RuleError('Only the host can change settings.');
    const cur = this.settingsOf(t);
    if (body.turnMs !== undefined) {
      const ms = Number(body.turnMs);
      if (!CQ_TURN_CHOICES.includes(ms)) throw new RuleError('Pick a turn length from the list.');
      cur.turnMs = ms;
    }
    if (body.manualSetup !== undefined) cur.manualSetup = Boolean(body.manualSetup);
    if (body.map !== undefined) {
      if (!CQ_MAPS.some((m) => m.id === body.map)) throw new RuleError('Pick a map from the list.');
      cur.map = body.map as string;
    }
    if (body.perks !== undefined) cur.perks = Boolean(body.perks);
    t.settings = cur;
    this.changed(t);
    return t;
  }
  settingsOf(t: CqTable): CqSettings { return { turnMs: t.settings?.turnMs ?? CQ_TURN_MS, manualSetup: t.settings?.manualSetup ?? false, map: t.settings?.map ?? 'chud', perks: t.settings?.perks ?? false }; }
  leave(code: unknown, name: string, now = Date.now()): void {
    const t = this.get(code);
    const i = t.seats.findIndex((s) => !s.bot && s.name.toLowerCase() === name.toLowerCase());
    if (i < 0) return;
    if (!t.game) { this.removeSeat(code, name, i); return; }
    if (t.game.phase !== 'over') { resign(t.game, i, this.rng); this.after(t, now); }
  }
  start(code: unknown, by: string, now = Date.now()): CqTable {
    const t = this.get(code);
    if (t.game) throw new RuleError('Already started.');
    if (t.host.toLowerCase() !== by.toLowerCase()) throw new RuleError('Only the host can start.');
    if (t.seats.length < 2) throw new RuleError('Add a player or a bot first (2–6).');
    t.seats.forEach((s, i) => { if (s.color === undefined || t.seats.some((o, j) => j < i && o.color === s.color)) s.color = CQ_PALETTE.findIndex((_, c) => !t.seats.some((o, j) => j !== i && o.color === c)); });
    t.seats.forEach((s, i) => { if (!s.faction || t.seats.some((o, j) => j < i && o.faction === s.faction)) s.faction = FACTIONS.find((f) => !t.seats.some((o, j) => j !== i && o.faction === f.id))?.id; });
    const st = this.settingsOf(t);
    t.game = newGame(t.seats, this.rng, { manualSetup: st.manualSetup, map: st.map, perks: st.perks });
    this.after(t, now);
    return t;
  }
  action(code: unknown, name: string, a: CqAction, now = Date.now()): CqTable {
    const t = this.get(code);
    if (!t.game) throw new RuleError('The war has not started.');
    const i = t.seats.findIndex((s) => !s.bot && s.name.toLowerCase() === name.toLowerCase());
    if (i < 0) throw new RuleError('You are watching this war.');
    const turnBefore = t.game.turn, phaseBefore = t.game.phase;
    act(t.game, i, a, this.rng);
    this.after(t, now, t.game.turn !== turnBefore || (phaseBefore === 'setup' && t.game.phase !== 'setup'));
    return t;
  }
  /** After any change: record a finished game, schedule the bot or timer, save. */
  private after(t: CqTable, now: number, newTurn = true): void {
    t.touched = now;
    const g = t.game!;
    const ms = this.settingsOf(t).turnMs;
    if (newTurn || !t.deadline) t.deadline = now + (g.phase === 'setup' ? Math.max(ms, 60_000) : ms);
    if (g.phase === 'over') { t.deadline = 0; this.record(t); }
    this.schedule(t);
    this.changed(t);
  }
  private record(t: CqTable): void {
    const g = t.game!;
    if (t.recorded || g.winner === null) return;
    t.recorded = true;
    if (t.seats.some((s) => s.bot)) return; // bot games never touch the leaderboard
    const winner = t.seats[g.winner]!.name;
    this.board.record({ winner: 'white', white: [winner], black: t.seats.filter((_, i) => i !== g.winner).map((s) => s.name) });
  }
  private schedule(t: CqTable): void {
    clearTimeout(this.timers.get(t.code));
    this.timers.delete(t.code);
    const g = t.game;
    if (!g || g.phase === 'over') return;
    const bot = g.phase !== 'setup' && g.players[g.turn]!.bot;
    const wait = bot ? CQ_BOT_MS + Math.floor(this.rng() * CQ_BOT_MS) : Math.max(0, t.deadline - Date.now());
    const code = t.code;
    const h = setTimeout(() => {
      void this.sync(code).then((fresh) => {
        if (this.stopped || fresh === false) return; // reloaded: the newer snapshot rescheduled itself
        try { bot ? this.botStep(code) : this.expire(code); } catch (e) { console.error('[conquest] step failed:', (e as Error).message); }
      });
    }, wait);
    h.unref?.();
    this.timers.set(t.code, h);
  }
  botStep(code: string, now = Date.now()): void {
    const t = this.tables.get(code);
    const g = t?.game;
    if (!t || !g || g.phase === 'over' || !g.players[g.turn]!.bot) return;
    const before = g.turn;
    try { act(g, g.turn, botAction(g, g.turn), this.rng); } catch { act(g, g.turn, g.pending ? { type: 'move', n: g.pending.min } : g.phase === 'reinforce' ? { type: 'place', t: g.owner.indexOf(g.turn), n: g.reserve } : { type: 'endTurn' }, this.rng); }
    this.after(t, now, g.turn !== before);
  }
  /** Turn timer ran out: finish the turn for the player (place remaining armies, move in, end). */
  expire(code: string, now = Date.now()): void {
    const t = this.tables.get(code);
    const g = t?.game;
    if (!t || !g || g.phase === 'over') return;
    if (g.phase === 'setup') {
      g.players.forEach((pl, i) => { if ((g.setup?.[i] ?? 0) > 0) { autoPlace(g, i, this.rng); g.log.push(`${pl.name}'s armies were placed automatically.`); } });
      act(g, Math.max(0, g.players.findIndex((x) => x.alive)), { type: 'autoPlace' }, this.rng); // starts the war once everyone is down
      this.after(t, now, true);
      return;
    }
    const p = g.turn;
    let guard = 0;
    while (g.turn === p && (g.phase as string) !== 'over' && guard++ < 20) {
      const a: CqAction = g.pending ? { type: 'move', n: g.pending.min }
        : g.phase === 'reinforce' ? (g.players[p]!.cards.length >= 5 || g.reserve === 0 ? botAction(g, p) : { type: 'place', t: g.owner.indexOf(p), n: g.reserve })
        : { type: 'endTurn' };
      act(g, p, a, this.rng);
    }
    g.log.push(`${g.players[p]!.name} ran out of time.`);
    this.after(t, now, true);
  }
  drop(code: string): void {
    clearTimeout(this.timers.get(code));
    this.tables.delete(code);
    void this.store?.remove(code).catch(() => {});
  }
  prune(now = Date.now()): void {
    for (const t of this.tables.values()) {
      const done = t.game?.phase === 'over';
      if (now - t.touched > (done ? 30 * 60_000 : IDLE_MS)) this.drop(t.code);
    }
  }
  private changed(t: CqTable): void {
    t.v = (t.v ?? 0) + 1;
    if (this.tables.has(t.code) && this.store) {
      const store = this.store, snap: CqTable = JSON.parse(JSON.stringify(t));
      // Saves for one table run in order; a rejected save means another instance is ahead, so adopt its state.
      const prev = this.saving.get(t.code) ?? Promise.resolve();
      const next = prev.then(async () => {
        try { if (!(await store.save(snap))) await this.sync(snap.code, true); } catch (e) { console.error('[conquest] save failed:', (e as Error).message); }
      });
      this.saving.set(t.code, next);
      void next.then(() => { if (this.saving.get(t.code) === next) this.saving.delete(t.code); });
    }
    this.onChange(t);
  }
  /** Reload a table if the store holds a newer version. Resolves true when local is current, false when it reloaded. */
  async sync(code: unknown, force = false): Promise<boolean> {
    if (!this.store || typeof code !== 'string') return true;
    const k = code.trim().toUpperCase();
    if (!force) await this.saving.get(k);
    let db: CqTable | null;
    try { db = await this.store.load(k); } catch { return true; }
    const cur = this.tables.get(k);
    // force: our save was rejected, so the stored copy wins even at the same version.
    if (!db || (cur && (force ? (cur.v ?? 0) > (db.v ?? 0) : (cur.v ?? 0) >= (db.v ?? 0)))) return true;
    this.tables.set(k, db);
    if (db.game && db.game.phase !== 'over') this.schedule(db); else { clearTimeout(this.timers.get(k)); this.timers.delete(k); }
    this.onChange(db);
    return false;
  }
  /** Shutdown: stop bots and timers, then wait for pending saves. */
  async flush(): Promise<void> { this.stopped = true; this.stop(); await Promise.all([...this.saving.values()]); }
  async attach(store: CqSnapshotStore, now = Date.now()): Promise<void> {
    this.store = store;
    await store.init();
    for (const t of await store.loadAll()) {
      this.tables.set(t.code, t);
      if (t.game && t.game.phase !== 'over') { t.deadline = Math.max(t.deadline, now + 15_000); this.schedule(t); }
    }
  }
  list() {
    return [...this.tables.values()].filter((t) => !t.game || t.game.phase !== 'over').map((t) => ({ code: t.code, host: t.host, players: t.seats.length, started: Boolean(t.game) }));
  }
  view(t: CqTable, viewer: string | null) {
    const seat = viewer ? t.seats.findIndex((s) => !s.bot && s.name.toLowerCase() === viewer.toLowerCase()) : -1;
    return { code: t.code, host: t.host, seats: t.seats, settings: this.settingsOf(t), you: seat, deadline: t.deadline, game: t.game ? publicView(t.game, seat) : null };
  }
  stop(): void { for (const h of this.timers.values()) clearTimeout(h); this.timers.clear(); }
}

let hub = new ConquestHub();
export const getConquest = () => hub;
export function resetConquest(): ConquestHub { hub.stop(); hub = new ConquestHub(); return hub; }

export async function initConquestStorage(): Promise<void> {
  const url = databaseUrl();
  if (!url) { await hub.attach(new MemoryCqStore()); return; }
  try {
    const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
    await hub.attach(new PgCqStore(pool));
    await hub.board.attachStore(createPgStore(url, 'conquest_leaderboard'));
    console.log(`[conquest] tables restored: ${hub.tables.size}`);
  } catch (e) { console.error('[conquest] storage failed:', (e as Error).message); }
}

type Ack = (res: { ok: boolean; error?: string; [k: string]: unknown }) => void;
let wired: Server | null = null;
const room = (code: string) => `cq:${code}`;

function push(io: Server, t: CqTable): void {
  for (const s of io.sockets.adapter.rooms.get(room(t.code)) ?? []) {
    const sock = io.sockets.sockets.get(s);
    if (!sock) continue;
    const n = (sock.data as { account?: { name: string } }).account?.name ?? null;
    sock.emit('cq_state', getConquest().view(t, n));
  }
  if (!getConquest().tables.has(t.code)) io.to(room(t.code)).emit('cq_state', null);
  io.to('cq:lobby').emit('cq_list', getConquest().list());
}

export function registerConquest(io: Server, socket: Socket): void {
  if (wired !== io) {
    wired = io;
    hub.onChange = (t) => push(io, t);
    const prune = setInterval(() => hub.prune(), 60_000); prune.unref?.();
  }
  const on = (ev: string, fn: (body: Record<string, unknown>, name: () => string) => unknown) => {
    socket.on(ev, async (payload: unknown, ack?: Ack) => {
      try {
        const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
        if (typeof body.code === 'string') await getConquest().sync(body.code); // never act on a stale copy
        const extra = fn(body, () => signedIn(socket));
        ack?.({ ok: true, ...((extra as object) ?? {}) });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' });
      }
    });
  };
  const enter = (t: CqTable) => {
    for (const r of socket.rooms) if (r.startsWith('cq:') && r !== 'cq:lobby') void socket.leave(r);
    void socket.join(room(t.code));
    const n = (socket.data as { account?: { name: string } }).account?.name ?? null;
    socket.emit('cq_state', getConquest().view(t, n));
    return { code: t.code };
  };
  on('cq_lobby', (_b, name) => {
    void socket.join('cq:lobby');
    let mine: string | null = null;
    try { mine = getConquest().tableOf(name())?.code ?? null; } catch { /* not signed in */ }
    return { tables: getConquest().list(), mine };
  });
  on('cq_create', (_b, name) => { const n = name(); const cur = getConquest().tableOf(n); return enter(cur ?? getConquest().create(n)); });
  on('cq_join', (b, name) => enter(getConquest().join(b.code, name())));
  on('cq_watch', (b) => enter(getConquest().get(b.code)));
  on('cq_bot', (b, name) => { getConquest().addBot(b.code, name()); });
  on('cq_unseat', (b, name) => { getConquest().removeSeat(b.code, name(), Number(b.index)); });
  on('cq_faction', (b, name) => { getConquest().setFaction(b.code, name(), b.faction, b.index); });
  on('cq_color', (b, name) => { getConquest().setColor(b.code, name(), b.color, b.index); });
  on('cq_settings', (b, name) => { getConquest().configure(b.code, name(), b); });
  on('cq_start', (b, name) => { getConquest().start(b.code, name()); });
  on('cq_leave', (b, name) => {
    getConquest().leave(b.code, name());
    for (const r of socket.rooms) if (r.startsWith('cq:') && r !== 'cq:lobby') void socket.leave(r);
  });
  on('cq_act', (b, name) => { getConquest().action(b.code, name(), b.action as CqAction); });
}

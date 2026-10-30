/** Persist chess/checkers tables to Postgres so they survive restarts and deploys. */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { adoptRoom, EMPTY_ROOM_MS, getRoom, HARD_ROOM_MS, listRooms } from './rooms.js';
import { persistable, restoreRoom, snapshotRoom, type RoomSnapshot } from './room-snapshot.js';
import { databaseUrl, type Queryable } from './leaderboard-store.js';

export interface RoomStore {
  init(): Promise<void>;
  loadAll(): Promise<RoomSnapshot[]>;
  loadOne(code: string): Promise<RoomSnapshot | null>;
  save(code: string, data: string): Promise<void>;
  remove(codes: string[]): Promise<void>;
}

export const ROOM_MIGRATION = `CREATE TABLE IF NOT EXISTS room_snapshots (
  code TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export class PgRoomStore implements RoomStore {
  constructor(private readonly db: Queryable) {
    db.on?.('error', (err) => console.error('[rooms] postgres pool error:', err.message));
  }
  async init() { await this.db.query(ROOM_MIGRATION); }
  async loadAll() {
    const { rows } = await this.db.query('SELECT data FROM room_snapshots');
    return rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as RoomSnapshot);
  }
  async loadOne(code: string) {
    const { rows } = await this.db.query('SELECT data FROM room_snapshots WHERE code = $1', [code]);
    const d = rows[0]?.data;
    return d ? ((typeof d === 'string' ? JSON.parse(d) : d) as RoomSnapshot) : null;
  }
  async save(code: string, data: string) {
    await this.db.query(
      `INSERT INTO room_snapshots (code, data, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (code) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [code, data],
    );
  }
  async remove(codes: string[]) {
    if (codes.length) await this.db.query('DELETE FROM room_snapshots WHERE code = ANY($1::text[])', [codes]);
  }
}

export class MemoryRoomStore implements RoomStore {
  rows = new Map<string, string>();
  async init() {}
  async loadAll() { return [...this.rows.values()].map((d) => JSON.parse(d) as RoomSnapshot); }
  async loadOne(code: string) { const d = this.rows.get(code); return d ? (JSON.parse(d) as RoomSnapshot) : null; }
  async save(code: string, data: string) { this.rows.set(code, data); }
  async remove(codes: string[]) { for (const c of codes) this.rows.delete(c); }
}

/** Dev/test only (ROOM_SNAPSHOT_FILE): one JSON file, so a local restart can be exercised without Postgres. */
export class FileRoomStore extends MemoryRoomStore {
  constructor(private readonly path: string) { super(); }
  override async init() {
    if (existsSync(this.path)) this.rows = new Map(Object.entries(JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, string>));
  }
  private write() { writeFileSync(this.path + '.tmp', JSON.stringify(Object.fromEntries(this.rows))); renameSync(this.path + '.tmp', this.path); }
  override async save(code: string, data: string) { await super.save(code, data); this.write(); }
  override async remove(codes: string[]) { await super.remove(codes); if (codes.length) this.write(); }
}

/** Same idle rules as pruneRooms, judged at the moment of the snapshot (nobody is connected after a restart). */
export function snapshotStale(s: RoomSnapshot, now = Date.now()): boolean {
  const idle = s.savedAt - Number(s.room.lastActivity ?? s.savedAt);
  return idle > EMPTY_ROOM_MS || idle > HARD_ROOM_MS || now - s.savedAt > HARD_ROOM_MS;
}

export const SAVE_DEBOUNCE_MS = 1500;

export class RoomPersistence {
  private saved = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;
  private loading = new Map<string, Promise<boolean>>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(readonly store: RoomStore) {}

  /** Load snapshots, drop stale ones, put the rest back into the live room map. */
  async restore(now = Date.now()): Promise<string[]> {
    const restored: string[] = [];
    const stale: string[] = [];
    for (const snap of await this.store.loadAll()) {
      try {
        if (snapshotStale(snap, now)) { stale.push(snap.code); continue; }
        adoptRoom(restoreRoom(snap, now));
        this.saved.set(snap.code, '');
        restored.push(snap.code);
      } catch (error) {
        console.error(`[rooms] could not restore ${snap?.code}:`, (error as Error).message);
        if (snap?.code) stale.push(snap.code);
      }
    }
    await this.store.remove(stale);
    return restored;
  }

  /**
   * Bring one table back when somebody asks for it (rejoin / join / watch).
   * Lazy on purpose: during a Render zero-downtime deploy the old instance keeps serving and
   * saving until SIGTERM, so the new one reads the newest row only once a player shows up.
   */
  async loadOne(code: string, now = Date.now()): Promise<boolean> {
    if (getRoom(code)) return true;
    const pending = this.loading.get(code);
    if (pending) return pending;
    const job = (async () => {
      const snap = await this.store.loadOne(code);
      if (!snap || getRoom(code)) return Boolean(getRoom(code));
      if (snapshotStale(snap, now)) { await this.store.remove([code]); return false; }
      const room = restoreRoom(snap, now);
      adoptRoom(room);
      const { savedAt: _s, ...rest } = snapshotRoom(room, now);
      this.saved.set(code, JSON.stringify(rest));
      return true;
    })().catch((error) => { console.error(`[rooms] could not restore ${code}:`, (error as Error).message); return false; })
      .finally(() => this.loading.delete(code));
    this.loading.set(code, job);
    return job;
  }

  /** Delete rows nobody came back for: idle past the empty-table rule since the last save. */
  async sweep(now = Date.now()): Promise<string[]> {
    const stale: string[] = [];
    for (const snap of await this.store.loadAll()) {
      if (getRoom(snap.code) || this.saved.has(snap.code)) continue;
      if (snapshotStale(snap, now) || now - snap.savedAt > EMPTY_ROOM_MS) stale.push(snap.code);
    }
    await this.store.remove(stale);
    return stale;
  }

  /** Write every changed table and delete rows for tables that are gone. */
  flush(now = Date.now()): Promise<void> {
    if (this.flushing) return this.flushing.then(() => this.flush(now));
    this.flushing = (async () => {
      const live = new Set<string>();
      for (const room of listRooms()) {
        if (!persistable(room)) continue;
        live.add(room.code);
        const { savedAt: _ignored, ...rest } = snapshotRoom(room, now);
        const key = JSON.stringify(rest);
        if (this.saved.get(room.code) === key) continue;
        await this.store.save(room.code, JSON.stringify({ ...rest, savedAt: now }));
        this.saved.set(room.code, key);
      }
      const gone = [...this.saved.keys()].filter((c) => !live.has(c));
      if (gone.length) {
        await this.store.remove(gone);
        for (const c of gone) this.saved.delete(c);
      }
    })().catch((error) => console.error('[rooms] snapshot save failed:', (error as Error).message)).finally(() => { this.flushing = null; });
    return this.flushing;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), SAVE_DEBOUNCE_MS);
    (this.timer as unknown as { unref?: () => void }).unref?.();
    this.sweeper = setInterval(() => void this.sweep().catch(() => {}), 5 * 60_000);
    (this.sweeper as unknown as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.sweeper) clearInterval(this.sweeper);
    this.timer = null;
    this.sweeper = null;
  }
}

let persistence: RoomPersistence | null = null;
export const getRoomPersistence = () => persistence;

export async function initRoomStorage(store?: RoomStore): Promise<void> {
  let s = store;
  if (!s) {
    const url = databaseUrl();
    const file = process.env.ROOM_SNAPSHOT_FILE;
    if (!url && file) s = new FileRoomStore(file);
    else if (!url) { console.warn('[rooms] no DATABASE_URL set; tables do not survive restarts'); return; }
    else s = new PgRoomStore(new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 }));
  }
  try {
    await s.init();
    persistence = new RoomPersistence(s);
    const swept = await persistence.sweep();
    console.log(`[rooms] table snapshots on (${s instanceof PgRoomStore ? 'postgres' : 'file'}); tables load when a player returns; swept ${swept.length} stale`);
    persistence.start();
  } catch (error) {
    console.error('[rooms] persistence disabled:', (error as Error).message);
    persistence = null;
  }
}

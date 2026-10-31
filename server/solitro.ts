/** Server-authoritative Solitro runs: one live run per signed-in account, persisted to Postgres (write-behind). */
import pg from 'pg';
import { randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import { boardFor, isQaName } from '../shared/qa.js';
import { act, isRun, newRun, viewRun, type Action, type Run, type SolitroStanding } from '../shared/solitro.js';

export interface SolitroRecord { key: string; name: string; run: Run | null; bestAnte: number; bestPlay: number; runs: number; wins: number }
export interface SolitroStore { init(): Promise<void>; loadAll(): Promise<SolitroRecord[]>; save(r: SolitroRecord): Promise<void> }

/** Separate, additive table; no other table is touched. Solitro never reads or writes casino chips. */
export const SOLITRO_MIGRATION = `CREATE TABLE IF NOT EXISTS solitro_players (
  player_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  run JSONB,
  best_ante INTEGER NOT NULL DEFAULT 0,
  best_play BIGINT NOT NULL DEFAULT 0,
  runs INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export class PgSolitroStore implements SolitroStore {
  constructor(private readonly db: Queryable) {
    db.on?.('error', (err) => console.error('[solitro] postgres pool error:', err.message));
  }
  async init(): Promise<void> { await this.db.query(SOLITRO_MIGRATION); }
  async loadAll(): Promise<SolitroRecord[]> {
    const { rows } = await this.db.query('SELECT player_key, name, run, best_ante, best_play, runs, wins FROM solitro_players');
    return rows.map((r) => ({
      key: String(r.player_key), name: String(r.name), run: isRun(r.run) ? (r.run as Run) : null,
      bestAnte: Number(r.best_ante) || 0, bestPlay: Number(r.best_play) || 0, runs: Number(r.runs) || 0, wins: Number(r.wins) || 0,
    }));
  }
  async save(a: SolitroRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO solitro_players (player_key, name, run, best_ante, best_play, runs, wins) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (player_key) DO UPDATE SET name = EXCLUDED.name, run = EXCLUDED.run, best_ante = EXCLUDED.best_ante,
         best_play = EXCLUDED.best_play, runs = EXCLUDED.runs, wins = EXCLUDED.wins, updated_at = now()`,
      [a.key, a.name, a.run ? JSON.stringify(a.run) : null, a.bestAnte, a.bestPlay, a.runs, a.wins],
    );
  }
}

const keyOf = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();

export class SolitroHall {
  private recs = new Map<string, SolitroRecord>();
  private store: SolitroStore | null = null;
  private pending = new Map<string, Promise<void>>();
  constructor(private readonly seedFn: () => number = () => randomInt(0, 2 ** 31)) {}

  get usingDatabase(): boolean { return this.store !== null; }

  async attach(store: SolitroStore): Promise<boolean> {
    try {
      await store.init();
      for (const r of await store.loadAll()) this.recs.set(r.key, r);
      this.store = store;
      return true;
    } catch (err) {
      console.error('[solitro] postgres unavailable, runs are in-memory only:', (err as Error).message);
      return false;
    }
  }

  private rec(name: string): SolitroRecord {
    const key = keyOf(name);
    let r = this.recs.get(key);
    if (!r) { r = { key, name: name.trim(), run: null, bestAnte: 0, bestPlay: 0, runs: 0, wins: 0 }; this.recs.set(key, r); }
    else r.name = name.trim();
    return r;
  }

  private settle(rec: SolitroRecord, before: Run | null, run: Run): void {
    rec.run = run;
    rec.bestAnte = Math.max(rec.bestAnte, Math.min(8, run.ante));
    rec.bestPlay = Math.max(rec.bestPlay, run.stats.bestPlay);
    if (run.phase === 'won' && before?.phase !== 'won') rec.wins++;
    this.persist(rec);
  }

  state(name: string): { run: Run | null; best: { bestAnte: number; runs: number; wins: number } } {
    const r = this.rec(name);
    return { run: r.run ? viewRun(r.run) : null, best: { bestAnte: r.bestAnte, runs: r.runs, wins: r.wins } };
  }

  start(name: string, now = Date.now()): Run {
    const rec = this.rec(name);
    const run = newRun(this.seedFn(), now);
    rec.runs++;
    this.settle(rec, null, run);
    return viewRun(run);
  }

  act(name: string, a: Action): Run {
    const rec = this.rec(name);
    if (!rec.run) throw new Error('Start a run first.');
    const before = rec.run;
    const next = act(before, a);
    this.settle(rec, before, next);
    return viewRun(next);
  }

  /** Raw (unmasked) run, for tests only. */
  rawRun(name: string): Run | null { return this.recs.get(keyOf(name))?.run ?? null; }

  standings(): SolitroStanding[] {
    return [...this.recs.values()]
      .filter((r) => r.runs > 0 && r.bestAnte > 0)
      .map(({ name, bestAnte, bestPlay, runs, wins }) => ({ name, bestAnte, bestPlay, runs, wins }))
      .sort((a, b) => b.wins - a.wins || b.bestAnte - a.bestAnte || b.bestPlay - a.bestPlay || a.name.localeCompare(b.name));
  }

  async flush(): Promise<void> { await Promise.all([...this.pending.values()]); }

  private persist(r: SolitroRecord): void {
    if (!this.store) return;
    const snap: SolitroRecord = { ...r };
    const prev = this.pending.get(r.key) ?? Promise.resolve();
    const next = prev.then(() => this.store!.save(snap)).catch((err) => console.error('[solitro] save failed:', (err as Error).message));
    this.pending.set(r.key, next);
    void next.then(() => { if (this.pending.get(r.key) === next) this.pending.delete(r.key); });
  }
}

let hall = new SolitroHall();
export const getSolitro = () => hall;
export function resetSolitro(seedFn?: () => number): SolitroHall { hall = new SolitroHall(seedFn); return hall; }

export async function initSolitroStorage(): Promise<void> {
  const url = databaseUrl();
  if (!url) { console.warn('[solitro] no DATABASE_URL set; runs are in-memory only'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  if (await hall.attach(new PgSolitroStore(pool))) console.log(`[solitro] connected to postgres (${hall.standings().length} players loaded)`);
}

export function solitroBoard(viewerIsQa: boolean): SolitroStanding[] {
  return boardFor(hall.standings(), viewerIsQa, 50);
}

type Ack = (res: { ok: boolean; error?: string; [k: string]: unknown }) => void;
const nameOf = (s: Socket): string | null => (s.data as { account?: { name: string } }).account?.name ?? null;

export function registerSolitro(_io: Server, socket: Socket): void {
  const on = (event: string, fn: (body: Record<string, unknown>, name: string | null) => Record<string, unknown>) =>
    socket.on(event, (payload: unknown, ack?: Ack) => {
      try {
        const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
        ack?.({ ok: true, ...fn(body, nameOf(socket)) });
      } catch (err) {
        ack?.({ ok: false, error: (err as Error).message });
      }
    });
  const need = (n: string | null) => { if (!n) throw new Error('Sign in to keep a Solitro run on your account.'); return n; };
  on('solitro_state', (_b, n) => (n ? hall.state(n) : { run: null, best: null }));
  on('solitro_new', (_b, n) => ({ run: hall.start(need(n)) }));
  on('solitro_act', (b, n) => ({ run: hall.act(need(n), b.a as Action) }));
  on('solitro_board', (_b, n) => ({ rows: solitroBoard(isQaName(n)) }));
}

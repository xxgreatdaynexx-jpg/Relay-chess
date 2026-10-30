import pg from 'pg';
import { databaseUrl, type Queryable } from './leaderboard-store.js';

/** Lifetime arena record for one claimed name (guests are never recorded). */
export interface ArenaRecord {
  key: string;
  name: string;
  kills: number;
  deaths: number;
  bestStreak: number;
  nukes: number;
  matches: number;
  rounds: number;
}
export interface ArenaStanding extends ArenaRecord { kd: number }

export interface ArenaStore {
  init(): Promise<void>;
  loadAll(): Promise<ArenaRecord[]>;
  save(r: ArenaRecord): Promise<void>;
}

/** Separate, additive table; no other table is touched. */
export const ARENA_MIGRATION = `CREATE TABLE IF NOT EXISTS arena_players (
  player_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  nukes INTEGER NOT NULL DEFAULT 0,
  matches INTEGER NOT NULL DEFAULT 0,
  rounds INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export class PgArenaStore implements ArenaStore {
  constructor(private readonly db: Queryable) {
    db.on?.('error', (err) => console.error('[arena] postgres pool error:', err.message));
  }
  async init(): Promise<void> {
    await this.db.query(ARENA_MIGRATION);
  }
  async loadAll(): Promise<ArenaRecord[]> {
    const { rows } = await this.db.query('SELECT player_key, name, kills, deaths, best_streak, nukes, matches, rounds FROM arena_players');
    return rows.map((r) => ({
      key: String(r.player_key), name: String(r.name), kills: Number(r.kills) || 0, deaths: Number(r.deaths) || 0,
      bestStreak: Number(r.best_streak) || 0, nukes: Number(r.nukes) || 0, matches: Number(r.matches) || 0, rounds: Number(r.rounds) || 0,
    }));
  }
  async save(a: ArenaRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO arena_players (player_key, name, kills, deaths, best_streak, nukes, matches, rounds) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (player_key) DO UPDATE SET name = EXCLUDED.name, kills = EXCLUDED.kills, deaths = EXCLUDED.deaths,
         best_streak = EXCLUDED.best_streak, nukes = EXCLUDED.nukes, matches = EXCLUDED.matches, rounds = EXCLUDED.rounds, updated_at = now()`,
      [a.key, a.name, a.kills, a.deaths, a.bestStreak, a.nukes, a.matches, a.rounds],
    );
  }
}

const keyOf = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();
export const kdOf = (r: { kills: number; deaths: number }) => Math.round((r.kills / Math.max(1, r.deaths)) * 100) / 100;

/** Server-side lifetime arena stats. Memory is the source of truth while running; Postgres is written behind. */
export class ArenaLedger {
  private records = new Map<string, ArenaRecord>();
  private store: ArenaStore | null = null;
  private pending = new Map<string, Promise<void>>();

  get usingDatabase(): boolean { return this.store !== null; }

  async attach(store: ArenaStore): Promise<boolean> {
    try {
      await store.init();
      for (const r of await store.loadAll()) this.records.set(r.key, r);
      this.store = store;
      return true;
    } catch (err) {
      console.error('[arena] postgres unavailable, arena stats are in-memory only:', (err as Error).message);
      return false;
    }
  }

  private rec(name: string): ArenaRecord {
    const key = keyOf(name);
    let r = this.records.get(key);
    if (!r) {
      r = { key, name: name.trim(), kills: 0, deaths: 0, bestStreak: 0, nukes: 0, matches: 0, rounds: 0 };
      this.records.set(key, r);
    } else r.name = name.trim();
    return r;
  }
  private bump(name: string, f: (r: ArenaRecord) => void): void {
    const r = this.rec(name);
    f(r);
    this.persist(r);
  }

  kill(name: string, streak: number): void { this.bump(name, (r) => { r.kills += 1; r.bestStreak = Math.max(r.bestStreak, streak); }); }
  death(name: string): void { this.bump(name, (r) => { r.deaths += 1; }); }
  nuke(name: string): void { this.bump(name, (r) => { r.nukes += 1; }); }
  match(name: string): void { this.bump(name, (r) => { r.matches += 1; }); }
  round(name: string): void { this.bump(name, (r) => { r.rounds += 1; }); }

  standings(limit = 100): ArenaStanding[] {
    return [...this.records.values()]
      .filter((r) => r.matches > 0 || r.kills + r.deaths > 0)
      .map((r) => ({ ...r, kd: kdOf(r) }))
      .sort((a, b) => b.kills - a.kills || b.kd - a.kd || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  async flush(): Promise<void> { await Promise.all([...this.pending.values()]); }

  private persist(r: ArenaRecord): void {
    if (!this.store) return;
    const snap = { ...r };
    const prev = this.pending.get(r.key) ?? Promise.resolve();
    const next = prev.then(() => this.store!.save(snap)).catch((err) => console.error('[arena] save failed:', (err as Error).message));
    this.pending.set(r.key, next);
    void next.then(() => { if (this.pending.get(r.key) === next) this.pending.delete(r.key); });
  }
}

let ledger = new ArenaLedger();
export const getArenaLedger = () => ledger;
export function resetArenaLedger(): ArenaLedger { ledger = new ArenaLedger(); return ledger; }

export async function initArenaStorage(): Promise<void> {
  const url = databaseUrl();
  if (!url) { console.warn('[arena] no DATABASE_URL set; arena stats are in-memory only'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  if (await ledger.attach(new PgArenaStore(pool))) console.log(`[arena] connected to postgres (${ledger.standings(1e6).length} players loaded)`);
}

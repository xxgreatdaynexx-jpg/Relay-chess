import pg from 'pg';

export interface StoredEntry {
  key: string;
  name: string;
  wins: number;
  losses: number;
  draws: number;
}

export interface LeaderboardStore {
  init(): Promise<void>;
  loadAll(): Promise<StoredEntry[]>;
  /** Atomically add deltas (upsert). */
  increment(entry: StoredEntry): Promise<void>;
  rename(key: string, name: string): Promise<void>;
  close(): Promise<void>;
}

/** Minimal subset of pg.Pool we rely on (lets tests inject pg-mem). */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
  end?(): Promise<void>;
  on?(event: 'error', listener: (err: Error) => void): unknown;
}

export const MIGRATION = `CREATE TABLE IF NOT EXISTS leaderboard (
  player_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export class PgLeaderboardStore implements LeaderboardStore {
  constructor(private readonly db: Queryable) {
    db.on?.('error', (err) => console.error('[leaderboard] postgres pool error:', err.message));
  }

  async init(): Promise<void> {
    await this.db.query(MIGRATION);
  }

  async loadAll(): Promise<StoredEntry[]> {
    const { rows } = await this.db.query('SELECT player_key, name, wins, losses, draws FROM leaderboard');
    return rows.map((row) => ({
      key: String(row.player_key),
      name: String(row.name),
      wins: Number(row.wins) || 0,
      losses: Number(row.losses) || 0,
      draws: Number(row.draws) || 0,
    }));
  }

  async increment(e: StoredEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO leaderboard (player_key, name, wins, losses, draws) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (player_key) DO UPDATE SET
         name = EXCLUDED.name,
         wins = leaderboard.wins + EXCLUDED.wins,
         losses = leaderboard.losses + EXCLUDED.losses,
         draws = leaderboard.draws + EXCLUDED.draws,
         updated_at = now()`,
      [e.key, e.name, e.wins, e.losses, e.draws],
    );
  }

  async rename(key: string, name: string): Promise<void> {
    await this.db.query('UPDATE leaderboard SET name = $2, updated_at = now() WHERE player_key = $1', [key, name]);
  }

  async close(): Promise<void> {
    await this.db.end?.();
  }
}

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.RELAY_CHESS_DATABASE_URL || undefined;
}

/** SSL is taken from the URL's sslmode (Neon URLs carry sslmode=require). */
export function createPgStore(url: string): PgLeaderboardStore {
  const pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 10_000 });
  return new PgLeaderboardStore(pool);
}

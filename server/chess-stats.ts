import pg from 'pg';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import type { ChessStatRow, MoveQuality } from '../shared/chessStats.js';

export interface ChessStatRecord {
  key: string;
  name: string;
  moves: number;
  percentileSum: number;
  brilliant: number;
  great: number;
  mistake: number;
  blunder: number;
}

export interface ChessStatsStore {
  init(): Promise<void>;
  loadAll(): Promise<ChessStatRecord[]>;
  save(r: ChessStatRecord): Promise<void>;
}

/** Separate, additive table; the existing leaderboard table is untouched. */
export const CHESS_STATS_MIGRATION = `CREATE TABLE IF NOT EXISTS chess_move_stats (
  player_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  moves INTEGER NOT NULL DEFAULT 0,
  percentile_sum DOUBLE PRECISION NOT NULL DEFAULT 0,
  brilliant INTEGER NOT NULL DEFAULT 0,
  great INTEGER NOT NULL DEFAULT 0,
  mistake INTEGER NOT NULL DEFAULT 0,
  blunder INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export class PgChessStatsStore implements ChessStatsStore {
  constructor(private readonly db: Queryable) {
    db.on?.('error', (err) => console.error('[chess-stats] postgres pool error:', err.message));
  }
  async init(): Promise<void> { await this.db.query(CHESS_STATS_MIGRATION); }
  async loadAll(): Promise<ChessStatRecord[]> {
    const { rows } = await this.db.query('SELECT player_key, name, moves, percentile_sum, brilliant, great, mistake, blunder FROM chess_move_stats');
    return rows.map((r) => ({
      key: String(r.player_key), name: String(r.name), moves: Number(r.moves) || 0, percentileSum: Number(r.percentile_sum) || 0,
      brilliant: Number(r.brilliant) || 0, great: Number(r.great) || 0, mistake: Number(r.mistake) || 0, blunder: Number(r.blunder) || 0,
    }));
  }
  async save(a: ChessStatRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO chess_move_stats (player_key, name, moves, percentile_sum, brilliant, great, mistake, blunder) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (player_key) DO UPDATE SET name = EXCLUDED.name, moves = EXCLUDED.moves, percentile_sum = EXCLUDED.percentile_sum,
         brilliant = EXCLUDED.brilliant, great = EXCLUDED.great, mistake = EXCLUDED.mistake, blunder = EXCLUDED.blunder, updated_at = now()`,
      [a.key, a.name, a.moves, a.percentileSum, a.brilliant, a.great, a.mistake, a.blunder],
    );
  }
}

const keyOf = (name: string) => name.trim().toLowerCase();

export class ChessStatsLedger {
  private records = new Map<string, ChessStatRecord>();
  private store: ChessStatsStore | null = null;
  private writes: Promise<void> = Promise.resolve();

  get usingDatabase(): boolean { return this.store !== null; }

  async attach(store: ChessStatsStore): Promise<boolean> {
    try {
      await store.init();
      for (const r of await store.loadAll()) this.records.set(r.key, r);
      this.store = store;
      return true;
    } catch (err) {
      console.error('[chess-stats] postgres unavailable, stats are in-memory only:', (err as Error).message);
      return false;
    }
  }

  record(name: string, q: MoveQuality): void {
    const key = keyOf(name);
    if (!key) return;
    const r = this.records.get(key) ?? { key, name: name.trim(), moves: 0, percentileSum: 0, brilliant: 0, great: 0, mistake: 0, blunder: 0 };
    r.name = name.trim();
    r.moves += 1;
    r.percentileSum += q.percentile;
    if (q.kind) r[q.kind] += 1;
    this.records.set(key, r);
    const store = this.store;
    if (!store) return;
    const snap = { ...r };
    this.writes = this.writes.then(() => store.save(snap)).catch((err) => console.error('[chess-stats] save failed:', (err as Error).message));
  }

  statsFor(name: string): ChessStatRow {
    const r = this.records.get(keyOf(name));
    if (!r || r.moves === 0) return { moves: 0, accuracy: null, brilliant: 0, great: 0, mistake: 0, blunder: 0 };
    return { moves: r.moves, accuracy: Math.round((r.percentileSum / r.moves) * 10) / 10, brilliant: r.brilliant, great: r.great, mistake: r.mistake, blunder: r.blunder };
  }

  flush(): Promise<void> { return this.writes; }
}

let ledger = new ChessStatsLedger();
export const getChessStats = () => ledger;
export function resetChessStats(): ChessStatsLedger { ledger = new ChessStatsLedger(); return ledger; }

export async function initChessStatsStorage(): Promise<void> {
  const url = databaseUrl();
  if (!url) { console.warn('[chess-stats] no DATABASE_URL set; chess move stats are in-memory only'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  if (await ledger.attach(new PgChessStatsStore(pool))) console.log('[chess-stats] connected to postgres');
}

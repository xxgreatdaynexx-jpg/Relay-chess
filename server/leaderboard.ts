import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LeaderboardStore } from './leaderboard-store.js';
import { createPgStore, databaseUrl } from './leaderboard-store.js';
import type { LeaderboardRow, Side } from '../shared/types.js';

interface Entry {
  name: string;
  wins: number;
  losses: number;
  draws: number;
}

interface StoredFile {
  players: Entry[];
}

export interface GameNames {
  winner: Side | null;
  white: string[];
  black: string[];
}

export function leaderboardPath(): string {
  return process.env.LEADERBOARD_PATH ?? path.join(process.cwd(), 'data', 'leaderboard.json');
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export class Leaderboard {
  private players = new Map<string, Entry>();
  private store: LeaderboardStore | null = null;
  private pending: Map<string, Entry> | null = null;

  constructor(private readonly file: string | null) {
    if (file) this.load();
  }

  /** Switch to a database store: migrate, then load rows into the cache. Never throws. */
  async attachStore(store: LeaderboardStore): Promise<boolean> {
    this.store = store;
    try {
      await store.init();
      await this.refresh();
      return true;
    } catch (err) {
      console.error('[leaderboard] postgres init failed, using in-memory cache:', (err as Error).message);
      return false;
    }
  }

  /** Re-read standings from the database (no-op without a store). Never throws. */
  async refresh(): Promise<void> {
    if (!this.store) return;
    try {
      const rows = await this.store.loadAll();
      const next = new Map<string, Entry>();
      for (const row of rows) next.set(row.key, { name: row.name, wins: row.wins, losses: row.losses, draws: row.draws });
      this.players = next;
    } catch (err) {
      console.error('[leaderboard] postgres read failed, serving cache:', (err as Error).message);
    }
  }

  get usingDatabase(): boolean {
    return this.store !== null;
  }

  private writes: Promise<void> = Promise.resolve();

  /** Resolves when queued DB writes have finished (for tests and shutdown). */
  flush(): Promise<void> {
    return this.writes;
  }

  private persist(task: (store: LeaderboardStore) => Promise<void>): void {
    const store = this.store;
    if (!store) return;
    this.writes = this.writes.then(() => task(store)).catch((err) => {
      console.error('[leaderboard] postgres write failed:', (err as Error).message);
    });
  }

  record(game: GameNames): void {
    const white = uniqueNames(game.white);
    const black = uniqueNames(game.black);
    const blackKeys = new Set(black.map((player) => player.key));
    const shared = white.filter((player) => blackKeys.has(player.key));
    const sharedKeys = new Set(shared.map((player) => player.key));
    const whiteOnly = white.filter((player) => !sharedKeys.has(player.key));
    const blackOnly = black.filter((player) => !sharedKeys.has(player.key));

    const deltas = new Map<string, Entry>();
    const mark = (players: { key: string; name: string }[], outcome: 'win' | 'loss' | 'draw') => {
      for (const player of players) {
        this.add(player.key, player.name, outcome);
        const d = deltas.get(player.key) ?? { name: player.name, wins: 0, losses: 0, draws: 0 };
        d[outcome === 'win' ? 'wins' : outcome === 'loss' ? 'losses' : 'draws'] += 1;
        deltas.set(player.key, d);
      }
    };

    if (game.winner === null) {
      mark([...whiteOnly, ...blackOnly, ...shared], 'draw');
    } else if (game.winner === 'white') {
      mark(whiteOnly, 'win');
      mark(blackOnly, 'loss');
      mark(shared, 'draw');
    } else {
      mark(blackOnly, 'win');
      mark(whiteOnly, 'loss');
      mark(shared, 'draw');
    }
    for (const [key, d] of deltas) this.persist((store) => store.increment({ key, ...d }));
    this.save();
  }

  /** Keep stats merged by case, but show the latest lobby spelling. */
  rememberName(name: string): void {
    const trimmed = name.trim();
    const key = normalizeName(trimmed);
    const entry = key ? this.players.get(key) : undefined;
    if (!entry || entry.name === trimmed) return;
    entry.name = trimmed;
    this.persist((store) => store.rename(key, trimmed));
    this.save();
  }

  standings(): LeaderboardRow[] {
    const rows: LeaderboardRow[] = [...this.players.values()].map((entry) => {
      const played = entry.wins + entry.losses + entry.draws;
      return {
        name: entry.name,
        wins: entry.wins,
        losses: entry.losses,
        draws: entry.draws,
        played,
        winRate: played === 0 ? 0 : entry.wins / played,
      };
    });
    rows.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      if (b.played !== a.played) return b.played - a.played;
      return a.name.localeCompare(b.name);
    });
    return rows;
  }

  private add(key: string, name: string, outcome: 'win' | 'loss' | 'draw'): void {
    const entry = this.players.get(key) ?? { name, wins: 0, losses: 0, draws: 0 };
    entry.name = name;
    entry[outcome === 'win' ? 'wins' : outcome === 'loss' ? 'losses' : 'draws'] += 1;
    this.players.set(key, entry);
  }

  private load(): void {
    if (!this.file) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as StoredFile;
      if (!Array.isArray(parsed.players)) return;
      for (const player of parsed.players) {
        const key = normalizeName(player.name ?? '');
        if (!key) continue;
        this.players.set(key, {
          name: String(player.name).trim(),
          wins: number(player.wins),
          losses: number(player.losses),
          draws: number(player.draws),
        });
      }
    } catch {
      this.players.clear();
    }
  }

  private save(): void {
    if (!this.file) return;
    const payload: StoredFile = {
      players: [...this.players.values()],
    };
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(payload));
    renameSync(temporary, this.file);
  }
}

function uniqueNames(names: string[]): { key: string; name: string }[] {
  const seen = new Set<string>();
  const unique: { key: string; name: string }[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = normalizeName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push({ key, name });
  }
  return unique;
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

let current = new Leaderboard(databaseUrl() ? null : leaderboardPath());

export function getLeaderboard(): Leaderboard {
  return current;
}

/** Connect to Postgres when DATABASE_URL / RELAY_CHESS_DATABASE_URL is set; otherwise warn and stay local. */
export async function initLeaderboardStorage(): Promise<void> {
  const url = databaseUrl();
  if (!url) {
    console.warn('[leaderboard] no DATABASE_URL set; leaderboard is local only and will not survive redeploys');
    return;
  }
  const board = new Leaderboard(null);
  const ok = await board.attachStore(createPgStore(url));
  current = board;
  if (ok) console.log(`[leaderboard] connected to postgres (${board.standings().length} players loaded)`);
}

let checkers = new Leaderboard(databaseUrl() ? null : checkersLeaderboardPath());

export function checkersLeaderboardPath(): string {
  return process.env.CHECKERS_LEADERBOARD_PATH ?? path.join(path.dirname(leaderboardPath()), 'checkers-leaderboard.json');
}

/** Relay Checkers standings: same shape as chess, own Neon table (checkers_leaderboard). */
export function getCheckersLeaderboard(): Leaderboard {
  return checkers;
}

export async function initCheckersLeaderboardStorage(): Promise<void> {
  const url = databaseUrl();
  if (!url) return;
  const board = new Leaderboard(null);
  const ok = await board.attachStore(createPgStore(url, 'checkers_leaderboard'));
  checkers = board;
  if (ok) console.log(`[leaderboard] checkers table ready (${board.standings().length} players loaded)`);
}

export function resetCheckersLeaderboard(file: string | null = null): Leaderboard {
  checkers = new Leaderboard(file);
  return checkers;
}

export function resetLeaderboard(file: string | null = leaderboardPath()): Leaderboard {
  current = new Leaderboard(file);
  return current;
}

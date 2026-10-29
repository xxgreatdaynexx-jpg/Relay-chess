import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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

  constructor(private readonly file: string) {
    this.load();
  }

  record(game: GameNames): void {
    const white = uniqueNames(game.white);
    const black = uniqueNames(game.black);
    const blackKeys = new Set(black.map((player) => player.key));
    const shared = white.filter((player) => blackKeys.has(player.key));
    const sharedKeys = new Set(shared.map((player) => player.key));
    const whiteOnly = white.filter((player) => !sharedKeys.has(player.key));
    const blackOnly = black.filter((player) => !sharedKeys.has(player.key));

    const mark = (players: { key: string; name: string }[], outcome: 'win' | 'loss' | 'draw') => {
      for (const player of players) this.add(player.key, player.name, outcome);
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
    this.save();
  }

  /** Keep stats merged by case, but show the latest lobby spelling. */
  rememberName(name: string): void {
    const trimmed = name.trim();
    const key = normalizeName(trimmed);
    const entry = key ? this.players.get(key) : undefined;
    if (!entry || entry.name === trimmed) return;
    entry.name = trimmed;
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

let current = new Leaderboard(leaderboardPath());

export function getLeaderboard(): Leaderboard {
  return current;
}

export function resetLeaderboard(file = leaderboardPath()): Leaderboard {
  current = new Leaderboard(file);
  return current;
}

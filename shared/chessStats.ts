/** Per-move quality for the chess leaderboard, derived from engine scores of every legal move. */
export type MoveClass = 'brilliant' | 'great' | 'mistake' | 'blunder' | null;

export interface MoveQuality {
  /** 0-100: share of the other legal moves this move scored at least as well as (ties count half). */
  percentile: number;
  kind: MoveClass;
}

/**
 * Brilliant = unique best; great = top fifth; blunder = bottom fifth; mistake = bottom 40% but not a blunder.
 * Returns null when the move cannot be judged (fewer than five legal moves or missing score).
 */
export function classifyMove(scores: readonly { uci: string; score: number }[], playedUci: string, legalCount: number): MoveQuality | null {
  if (legalCount < 5) return null;
  const unique = new Map<string, number>();
  for (const row of scores) unique.set(row.uci, row.score);
  const played = unique.get(playedUci);
  if (played === undefined || unique.size < 2) return null;
  let better = 0, worse = 0, tied = 0;
  for (const [uci, score] of unique) {
    if (uci === playedUci) continue;
    if (score > played) better += 1;
    else if (score < played) worse += 1;
    else tied += 1;
  }
  const others = better + worse + tied;
  const percentile = Math.round(((worse + tied / 2) / others) * 1000) / 10;
  let kind: MoveClass = null;
  if (better === 0 && tied === 0 && worse > 0) kind = 'brilliant';
  else if (worse * 5 >= legalCount * 4) kind = 'great';
  else if (better * 5 >= legalCount * 4) kind = 'blunder';
  else if (better * 5 >= legalCount * 3) kind = 'mistake';
  return { percentile, kind };
}

export interface ChessStatRow {
  moves: number;
  accuracy: number | null;
  brilliant: number;
  great: number;
  mistake: number;
  blunder: number;
}

export const CHESS_COLS = ['name', 'wins', 'losses', 'draws', 'played', 'winRate', 'accuracy', 'brilliant', 'great', 'mistake', 'blunder'] as const;
export type ChessCol = (typeof CHESS_COLS)[number];

export function sortChess<T extends { name: string } & Record<string, unknown>>(rows: readonly T[], key: ChessCol, dir: 'asc' | 'desc'): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'name') return sign * a.name.localeCompare(b.name);
    const av = a[key] as number | null | undefined, bv = b[key] as number | null | undefined;
    if (av == null && bv == null) return a.name.localeCompare(b.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    return sign * (av - bv) || a.name.localeCompare(b.name);
  });
}

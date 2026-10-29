import type { MoveGrade, MoveMark } from '../shared/types.js';
import { stockfishSearchLines } from './hints.js';

/** A move is a blunder when at least 80% of the legal moves score strictly better. */
export const BLUNDER_DEPTH = 2;
export const BLUNDER_MOVETIME_MS = 200;

export interface MoveScore {
  uci: string;
  score: number;
}

export type { MoveGrade, MoveMark };

export type MoveRanker = (fen: string, ucis: string[]) => Promise<MoveScore[]>;

let ranker: MoveRanker = defaultRanker;
let onReady: ((code: string) => void) | null = null;

export function onBlunderReady(listener: (code: string) => void): void {
  onReady = listener;
}

export function setMoveRanker(next: MoveRanker): void {
  ranker = next;
}

export function useDefaultMoveRanker(): void {
  ranker = defaultRanker;
}

export function parseSearchScores(lines: readonly string[]): MoveScore[] {
  const best = new Map<string, { depth: number; score: number }>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('info ') || line.includes(' currmove ')) continue;
    const depth = Number(line.match(/\bdepth (\d+)/)?.[1] ?? 0);
    const pv = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
    if (!pv) continue;
    const score = scoreOf(line);
    if (score === null) continue;
    const uci = pv[1];
    const previous = best.get(uci);
    if (!previous || depth >= previous.depth) best.set(uci, { depth, score });
  }
  return [...best.entries()].map(([uci, row]) => ({ uci, score: row.score }));
}

export function isBottomTwentieth(scores: readonly MoveScore[], playedUci: string, legalCount: number): boolean {
  if (legalCount < 5) return false;
  const unique = new Map<string, number>();
  for (const row of scores) unique.set(row.uci, row.score);
  const played = unique.get(playedUci);
  if (played === undefined) return false;
  let better = 0;
  for (const [uci, score] of unique) {
    if (uci !== playedUci && score > played) better += 1;
  }
  return better * 5 >= legalCount * 4;
}

/**
 * One marker for a move. Fewer than five legal moves, a flat eval, or a
 * missing score stay unmarked so a forced move is not decorated.
 * The unique best move is brilliant; the rest of the top fifth is good;
 * the bottom fifth is a blunder.
 */
export function gradeMove(scores: readonly MoveScore[], playedUci: string, legalCount: number): MoveGrade | null {
  if (legalCount < 5) return null;
  const unique = new Map<string, number>();
  for (const row of scores) unique.set(row.uci, row.score);
  const played = unique.get(playedUci);
  if (played === undefined) return null;
  let better = 0;
  let worse = 0;
  let tied = 0;
  for (const [uci, score] of unique) {
    if (uci === playedUci) continue;
    if (score > played) better += 1;
    else if (score < played) worse += 1;
    else tied += 1;
  }
  if (better === 0 && tied === 0 && worse > 0) return 'brilliant';
  if (worse * 5 >= legalCount * 4) return 'good';
  if (better * 5 >= legalCount * 4) return 'blunder';
  return null;
}

/**
 * Rank the move without delaying the caller. The result is applied later,
 * and only a positive mark asks the table to broadcast again.
 */
export function beginBlunderCheck(input: {
  code: string;
  fen: string;
  ucis: string[];
  playedUci: string;
  ply: number;
  destination: string;
  accept: (mark: MoveMark | null, ranked: boolean) => boolean;
}): void {
  if (input.ucis.length < 5) {
    input.accept(null, false);
    return;
  }
  const { code, fen, ucis, playedUci, ply, destination, accept } = input;
  void Promise.resolve()
    .then(() => ranker(fen, ucis))
    .then((scores) => {
      const grade = gradeMove(scores ?? [], playedUci, ucis.length);
      const mark = grade ? { square: destination, ply, at: Date.now(), grade } : null;
      if (accept(mark, true) && mark) onReady?.(code);
    })
    .catch(() => {
      accept(null, false);
    });
}

function defaultRanker(fen: string, ucis: string[]): Promise<MoveScore[]> {
  if (process.env.VITEST) return Promise.resolve([]);
  return stockfishSearchLines(fen, ucis.length, { depth: BLUNDER_DEPTH, movetime: BLUNDER_MOVETIME_MS }).then(
    parseSearchScores,
  );
}

function scoreOf(line: string): number | null {
  const mate = line.match(/\bscore mate (-?\d+)/);
  if (mate) {
    const value = Number(mate[1]);
    return value > 0 ? 1_000_000 - value : -1_000_000 - value;
  }
  const cp = line.match(/\bscore cp (-?\d+)/);
  if (!cp) return null;
  return Number(cp[1]);
}

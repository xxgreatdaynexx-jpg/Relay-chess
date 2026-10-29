import { stockfishSearchLines } from './hints.js';

/** A move is a blunder when at least 80% of the legal moves score strictly better. */
export const BLUNDER_DEPTH = 2;
export const BLUNDER_MOVETIME_MS = 200;

export interface MoveScore {
  uci: string;
  score: number;
}

export interface BlunderCall {
  square: string;
  ply: number;
  at: number;
}

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
  accept: (mark: BlunderCall | null) => boolean;
}): void {
  if (input.ucis.length < 5) {
    input.accept(null);
    return;
  }
  const { code, fen, ucis, playedUci, ply, destination, accept } = input;
  void Promise.resolve()
    .then(() => ranker(fen, ucis))
    .then((scores) => {
      const bad = isBottomTwentieth(scores ?? [], playedUci, ucis.length);
      const applied = accept(bad ? { square: destination, ply, at: Date.now() } : null);
      if (applied) onReady?.(code);
    })
    .catch(() => {
      accept(null);
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

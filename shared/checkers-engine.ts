import { applyMove, legalMoves, rankOf, fileOf, type CMove, type CPosition } from './checkers.js';

/** Win score; anything above WIN - 1000 is a forced win in (WIN - score) plies. */
export const CHECKERS_WIN = 100000;

/** Static evaluation from White's point of view (100 = one man). */
export function evaluateCheckers(p: CPosition): number {
  let score = 0;
  for (const [square, piece] of p.board) {
    const r = rankOf(square);
    const f = fileOf(square);
    let v = piece.king ? 160 : 100 + 4 * (piece.c === 'w' ? r : 7 - r);
    if (f >= 2 && f <= 5 && r >= 2 && r <= 5) v += 6; // centre
    if (!piece.king && (piece.c === 'w' ? r === 0 : r === 7)) v += 8; // back-row guard
    score += piece.c === 'w' ? v : -v;
  }
  return score;
}

export interface CheckersSearch { score: number; best: CMove | null; depth: number; nodes: number }

/** Iterative-deepening alpha-beta. Score is from White's point of view. */
export function searchCheckers(p: CPosition, opts: { maxDepth?: number; maxNodes?: number } = {}): CheckersSearch {
  const maxDepth = opts.maxDepth ?? 10;
  const maxNodes = opts.maxNodes ?? 60000;
  let nodes = 0;
  let stopped = false;

  const negamax = (pos: CPosition, depth: number, alpha: number, beta: number, ply: number): number => {
    nodes++;
    if (nodes > maxNodes) { stopped = true; return 0; }
    const moves = legalMoves(pos);
    const sign = pos.turn === 'w' ? 1 : -1;
    if (moves.length === 0) return -(CHECKERS_WIN - ply);
    // keep searching forced captures past the horizon (quiescence)
    if (depth <= 0 && (moves[0]!.captures.length === 0 || depth < -6)) return sign * evaluateCheckers(pos);
    let best = -Infinity;
    for (const m of order(moves)) {
      const v = -negamax(applyMove(pos, m), depth - 1, -beta, -alpha, ply + 1);
      if (stopped) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  };

  const root = legalMoves(p);
  const sign = p.turn === 'w' ? 1 : -1;
  if (root.length === 0) return { score: sign * -CHECKERS_WIN, best: null, depth: 0, nodes };
  let result: CheckersSearch = { score: sign * evaluateCheckers(p), best: root[0]!, depth: 0, nodes };
  let ordered = order(root);
  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -Infinity;
    let bestMove: CMove | null = null;
    const scored: Array<[CMove, number]> = [];
    for (const m of ordered) {
      const v = -negamax(applyMove(p, m), depth - 1, -Infinity, -alpha, 1);
      if (stopped) break;
      scored.push([m, v]);
      if (v > alpha) { alpha = v; bestMove = m; }
    }
    if (stopped || !bestMove) break;
    result = { score: sign * alpha, best: bestMove, depth, nodes };
    ordered = scored.sort((a, b) => b[1] - a[1]).map(([m]) => m);
    if (Math.abs(alpha) > CHECKERS_WIN - 1000) break;
  }
  result.nodes = nodes;
  return result;
}

function order(moves: CMove[]): CMove[] {
  return [...moves].sort((a, b) => b.captures.length - a.captures.length || Number(b.crowns) - Number(a.crowns));
}

export type CheckersGrade = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
export const GRADE_MARK: Record<CheckersGrade, string> = { best: '‼', good: '!', inaccuracy: '?!', mistake: '?', blunder: '??' };

/** Grade a move by how much it lost versus the engine's best, from the mover's side. */
export function gradeCheckersMove(bestScore: number, playedScore: number, mover: 'w' | 'b', onlyMove = false): CheckersGrade {
  const clamp = (v: number) => Math.max(-2000, Math.min(2000, v));
  const loss = (mover === 'w' ? 1 : -1) * (clamp(bestScore) - clamp(playedScore));
  if (onlyMove || loss <= 8) return 'best';
  if (loss <= 40) return 'good';
  if (loss <= 100) return 'inaccuracy';
  if (loss <= 250) return 'mistake';
  return 'blunder';
}

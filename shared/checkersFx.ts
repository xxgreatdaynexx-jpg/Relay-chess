import { legalMoves, parseFen } from './checkers.js';

/** Gap between explosions along a multi-jump. */
export const CHECKERS_BOOM_STAGGER_MS = 220;

export interface CheckersFx {
  /** Squares of pieces taken this move, in jump order. Each gets the chess explosion. */
  captures: string[];
  /** Chess "huh" equivalent: the move hands the opponent a multi-piece jump. */
  huh: boolean;
}

/** Which of the chess effects a checkers move should fire, from the positions around it. */
export function checkersMoveFx(beforeFen: string, afterFen: string, from: string, path: readonly string[] = []): CheckersFx {
  const before = parseFen(beforeFen);
  const after = parseFen(afterFen);
  if (!before || !after) return { captures: [], huh: false };
  const mover = before.board.get(from)?.c;
  const gone = [...before.board.entries()].filter(([sq, p]) => p.c !== mover && !after.board.has(sq)).map(([sq]) => sq);
  // Order by jump: the captured piece sits between consecutive landing squares.
  const hops = [from, ...path];
  const ordered: string[] = [];
  for (let i = 1; i < hops.length; i += 1) {
    const a = hops[i - 1]!, b = hops[i]!;
    const mid = `${String.fromCharCode((a.charCodeAt(0) + b.charCodeAt(0)) / 2)}${(Number(a[1]) + Number(b[1])) / 2}`;
    if (gone.includes(mid) && !ordered.includes(mid)) ordered.push(mid);
  }
  for (const sq of gone) if (!ordered.includes(sq)) ordered.push(sq);
  const huh = legalMoves(after).some((m) => m.captures.length >= 2);
  return { captures: ordered, huh };
}

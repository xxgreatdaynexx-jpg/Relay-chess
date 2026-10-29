/** Piece letter on a square, or null when the square is empty. */
export function pieceAt(fen: string, square: string): string | null {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const row = fen.split(' ')[0]?.split('/')[8 - rank];
  if (!row) return null;
  let col = 0;
  for (const char of row) {
    if (char >= '1' && char <= '8') {
      col += Number(char);
      continue;
    }
    if (col === file) return char;
    col += 1;
  }
  return null;
}

/** Square where a queen of either color was taken, if this move captured one. */
export function queenCaptureSquare(beforeFen: string, to: string): string | null {
  const piece = pieceAt(beforeFen, to);
  if (piece === 'q' || piece === 'Q') return to;
  return null;
}

export type QueenMoveSound = 'death' | 'capture';

/**
 * Which queen clip this move should play.
 * A queen being captured is 'death'. A queen capturing anything else is
 * 'capture'. A queen taking a queen is death only.
 */
export function queenMoveSound(beforeFen: string, from: string, to: string): QueenMoveSound | null {
  if (queenCaptureSquare(beforeFen, to)) return 'death';
  const mover = pieceAt(beforeFen, from);
  if (mover !== 'q' && mover !== 'Q') return null;
  const target = pieceAt(beforeFen, to);
  if (!target) return null;
  const moverWhite = mover === 'Q';
  const targetWhite = target === target.toUpperCase();
  if (moverWhite === targetWhite) return null;
  return 'capture';
}

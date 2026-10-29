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

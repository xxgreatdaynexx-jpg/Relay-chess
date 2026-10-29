import { Chess } from 'chess.js';

/**
 * True when the side to move has a legal move that checkmates.
 * An already finished position is false, so a game that just ended
 * does not count as "mate in one available."
 */
export function hasMateInOne(fen: string): boolean {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return false;
  }
  if (chess.isGameOver()) return false;
  for (const move of chess.moves({ verbose: true })) {
    let played = false;
    try {
      chess.move({
        from: move.from,
        to: move.to,
        ...(move.promotion ? { promotion: move.promotion } : {}),
      });
      played = true;
      if (chess.isCheckmate()) return true;
    } catch {
      // Skip a move chess.js will not apply.
    } finally {
      if (played) chess.undo();
    }
  }
  return false;
}

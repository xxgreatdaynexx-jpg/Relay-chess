import { Chess } from 'chess.js';

export function previewFen(
  fen: string,
  move: { from: string; to: string; promotion?: string },
): string | null {
  try {
    const chess = new Chess(fen);
    chess.move({
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    });
    return chess.fen();
  } catch {
    return null;
  }
}

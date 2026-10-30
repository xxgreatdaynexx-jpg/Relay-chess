import { Chess } from 'chess.js';
import type { GameType } from '../shared/types.js';

const CHESS_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Material for each side from the board part of a chess or checkers FEN (uppercase = white). */
export function material(gameType: GameType, fen: string): { white: number; black: number } {
  const out = { white: 0, black: 0 };
  for (const ch of fen.split(' ')[0] ?? '') {
    const low = ch.toLowerCase();
    if (low === ch.toUpperCase()) continue; // digits and slashes
    const v = gameType === 'checkers' ? (low === 'k' ? 1.5 : 1) : (CHESS_VALUE[low] ?? 0);
    if (ch === low) out.black += v; else out.white += v;
  }
  return out;
}

/** No realistic way for anyone to win: chess insufficient material, or checkers lone kings level. */
export function deadDraw(gameType: GameType, fen: string): boolean {
  if (gameType === 'checkers') {
    const board = fen.split(' ')[0] ?? '';
    const w = (board.match(/K/g) ?? []).length, b = (board.match(/k/g) ?? []).length;
    return !/[pP]/.test(board) && w === b && w <= 2;
  }
  try { return new Chess(fen).isInsufficientMaterial(); } catch { return false; }
}

/** A bot accepts a draw when its side is clearly behind on material, or the position is a dead draw. */
export function botAcceptsDraw(gameType: GameType, fen: string, side: 'white' | 'black'): boolean {
  if (deadDraw(gameType, fen)) return true;
  const m = material(gameType, fen);
  const deficit = (side === 'white' ? m.black - m.white : m.white - m.black);
  return deficit >= (gameType === 'checkers' ? 2 : 3);
}

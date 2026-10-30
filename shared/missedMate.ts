import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';

/**
 * "Missed mate" house rule: if the side to move had a mate in one and played
 * something else, every piece that could have delivered that mate is lost.
 *
 * Decisions:
 * - Kings are never removed (castling / king-move mates are skipped).
 * - A promotion mate removes the pawn (or what it became if that pawn moved).
 * - If the mating piece was the one just moved, it is removed from its new
 *   square; if the move was castling and the mating piece was that rook, the
 *   rook is removed from its castled square.
 * - Castling rights are dropped for any rook that is gone from its corner, and
 *   the en passant square is cleared when the double-pushed pawn is removed.
 * - Removal can expose the remover's own king while it is the opponent's turn.
 *   That FEN is still loadable, but the position is not legal chess, so the
 *   caller ends the game: the remover loses (see `exposesKing`).
 */

export interface MatingMove {
  from: Square;
  to: Square;
  san: string;
  piece: PieceSymbol;
  promotion?: PieceSymbol;
}

export interface RemovedPiece {
  /** Square the piece was taken off, in the position after the move. */
  square: Square;
  piece: PieceSymbol;
  color: Color;
}

export interface MissedMateOutcome {
  fen: string;
  removed: RemovedPiece[];
  /** Mating moves that were available, as SAN. */
  missed: string[];
  /** The remover's king is attacked after the removal (remover loses). */
  exposesKing: boolean;
}

export function matingMoves(fen: string): MatingMove[] {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }
  if (chess.isGameOver()) return [];
  const out: MatingMove[] = [];
  for (const move of chess.moves({ verbose: true })) {
    let played = false;
    try {
      chess.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
      played = true;
      if (chess.isCheckmate()) {
        out.push({
          from: move.from,
          to: move.to,
          san: move.san,
          piece: move.piece,
          ...(move.promotion ? { promotion: move.promotion } : {}),
        });
      }
    } catch {
      // ignore
    } finally {
      if (played) chess.undo();
    }
  }
  return out;
}

export const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

const CASTLE_ROOKS: Record<string, { from: Square; to: Square }> = {
  e1g1: { from: 'h1', to: 'f1' },
  e1c1: { from: 'a1', to: 'd1' },
  e8g8: { from: 'h8', to: 'f8' },
  e8c8: { from: 'a8', to: 'd8' },
};

/**
 * Apply the rule. `played` is the move actually made from `fenBefore`, and
 * `fenAfter` the position after it. Returns null when nothing is lost.
 */
export function applyMissedMate(
  fenBefore: string,
  played: { from: string; to: string; san: string; flags?: string },
  fenAfter: string,
  mates: MatingMove[] = matingMoves(fenBefore),
): MissedMateOutcome | null {
  if (mates.length === 0) return null;
  if (mates.some((m) => m.from === played.from && m.to === played.to && m.san === played.san)) return null;

  const before = new Chess(fenBefore);
  const color = before.turn();
  const castled = before.get(played.from as Square)?.type === 'k' ? CASTLE_ROOKS[`${played.from}${played.to}`] : undefined;
  const isCastle = Boolean(castled) && Math.abs(played.from.charCodeAt(0) - played.to.charCodeAt(0)) === 2;

  const sources = new Set<Square>();
  for (const m of mates) if (m.piece !== 'k') sources.add(m.from);
  if (sources.size === 0) return null;

  const after = new Chess(fenAfter);
  const removed: RemovedPiece[] = [];
  for (const from of sources) {
    let now: Square = from;
    if (from === played.from) now = played.to as Square;
    else if (isCastle && castled && from === castled.from) now = castled.to;
    const piece = after.get(now);
    if (!piece || piece.color !== color || piece.type === 'k') continue;
    removed.push({ square: now, piece: piece.type, color });
  }
  if (removed.length === 0) return null;

  const fields = fenAfter.split(' ');
  const board = boardMap(fields[0]!);
  for (const r of removed) board.delete(r.square);
  fields[0] = boardFen(board);
  fields[2] = castlingFor(board, fields[2]!);
  if (fields[3] !== '-') {
    // en passant target sits behind the pawn that just double-pushed.
    const file = fields[3]![0]!;
    const rank = fields[3]![1] === '3' ? '4' : '5';
    if (!board.has(`${file}${rank}` as Square)) fields[3] = '-';
  }
  const fen = fields.join(' ');
  const check = new Chess(fen, { skipValidation: true });
  const exposesKing = check.isAttacked(kingSquare(board, color)!, color === 'w' ? 'b' : 'w');
  return { fen, removed, missed: mates.map((m) => m.san), exposesKing };
}

type Board = Map<Square, string>;

function boardMap(placement: string): Board {
  const map: Board = new Map();
  placement.split('/').forEach((row, i) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else {
        map.set(`${'abcdefgh'[file]}${8 - i}` as Square, ch);
        file += 1;
      }
    }
  });
  return map;
}

function boardFen(board: Board): string {
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank -= 1) {
    let row = '';
    let empty = 0;
    for (const f of 'abcdefgh') {
      const p = board.get(`${f}${rank}` as Square);
      if (!p) empty += 1;
      else {
        if (empty) row += String(empty);
        empty = 0;
        row += p;
      }
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  return rows.join('/');
}

function castlingFor(board: Board, rights: string): string {
  const keep = [...rights].filter((r) => {
    if (r === 'K') return board.get('e1') === 'K' && board.get('h1') === 'R';
    if (r === 'Q') return board.get('e1') === 'K' && board.get('a1') === 'R';
    if (r === 'k') return board.get('e8') === 'k' && board.get('h8') === 'r';
    if (r === 'q') return board.get('e8') === 'k' && board.get('a8') === 'r';
    return false;
  });
  return keep.join('') || '-';
}

function kingSquare(board: Board, color: Color): Square | null {
  const want = color === 'w' ? 'K' : 'k';
  for (const [sq, p] of board) if (p === want) return sq;
  return null;
}

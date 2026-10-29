import { Chess, type Color, type Square } from 'chess.js';

/** How long the mated team has to fake-pay before the mate stands. */
export const BAILOUT_MS = 20_000;

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

export function chebyshev(a: Square, b: Square): number {
  return Math.max(Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(Number(a[1]) - Number(b[1])));
}

function squares(): Square[] {
  const all: Square[] = [];
  for (const file of FILES) {
    for (let rank = 1; rank <= 8; rank += 1) all.push(`${file}${rank}` as Square);
  }
  return all;
}

function kingSquare(chess: Chess, color: Color): Square | null {
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece && piece.type === 'k' && piece.color === color) return piece.square;
    }
  }
  return null;
}

function expandRank(rank: string): string[] {
  const cells: string[] = [];
  for (const char of rank) {
    if (char >= '1' && char <= '8') {
      for (let i = 0; i < Number(char); i += 1) cells.push('.');
    } else {
      cells.push(char);
    }
  }
  if (cells.length !== 8) throw new Error('bad rank');
  return cells;
}

function compressRank(cells: string[]): string {
  let out = '';
  let empty = 0;
  for (const cell of cells) {
    if (cell === '.') {
      empty += 1;
      continue;
    }
    if (empty) {
      out += String(empty);
      empty = 0;
    }
    out += cell;
  }
  if (empty) out += String(empty);
  return out;
}

function coords(square: Square): { rank: number; file: number } {
  return { file: square.charCodeAt(0) - 97, rank: 8 - Number(square[1]) };
}

function dropCastling(castling: string, color: Color): string {
  const next = color === 'w' ? castling.replace(/[KQ]/g, '') : castling.replace(/[kq]/g, '');
  return next === '' || next === '-' ? '-' : next;
}

/** FEN with the side-to-move king relocated. Same turn, castling dropped, en passant cleared. */
function movedKingFen(fen: string, from: Square, to: Square, color: Color): string | null {
  const parts = fen.split(' ');
  if (parts.length < 4) return null;
  const ranks = parts[0].split('/');
  if (ranks.length !== 8) return null;
  let grid: string[][];
  try {
    grid = ranks.map(expandRank);
  } catch {
    return null;
  }
  const src = coords(from);
  const dst = coords(to);
  const expected = color === 'w' ? 'K' : 'k';
  if (grid[src.rank]?.[src.file] !== expected) return null;
  if (grid[dst.rank]?.[dst.file] !== '.') return null;
  grid[src.rank][src.file] = '.';
  grid[dst.rank][dst.file] = expected;
  const placement = grid.map(compressRank).join('/');
  const castling = dropCastling(parts[2] ?? '-', color);
  const turn = parts[1] === 'b' ? 'b' : 'w';
  return `${placement} ${turn} ${castling} - ${parts[4] ?? '0'} ${parts[5] ?? '1'}`;
}

/**
 * Empty squares the mated king can teleport to. The side to move in `fen`
 * must be in checkmate. A square is safe when it is empty, not next to the
 * other king, and the rebuilt position (king moved, that side's castling
 * dropped, en passant cleared) is not check.
 */
export function escapeSquares(fen: string): Square[] {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }
  if (!chess.isCheckmate()) return [];
  const color = chess.turn();
  const king = kingSquare(chess, color);
  const enemy = kingSquare(chess, color === 'w' ? 'b' : 'w');
  if (!king || !enemy) return [];
  const safe: Square[] = [];
  for (const square of squares()) {
    if (square === king || chess.get(square)) continue;
    if (chebyshev(square, enemy) <= 1) continue;
    const placed = movedKingFen(fen, king, square, color);
    if (!placed) continue;
    try {
      const probe = new Chess(placed);
      if (probe.isCheck()) continue;
      if (kingSquare(probe, color) !== square) continue;
      safe.push(square);
    } catch {
      continue;
    }
  }
  return safe;
}

/**
 * Move the mated king to `to` and hand the turn to the opponent.
 * Returns null when `to` is not a safe empty square.
 */
export function teleportKing(fen: string, to: Square): string | null {
  if (!escapeSquares(fen).includes(to)) return null;
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const color = chess.turn();
  const king = kingSquare(chess, color);
  if (!king) return null;
  const placed = movedKingFen(fen, king, to, color);
  if (!placed) return null;
  const parts = placed.split(' ');
  parts[1] = color === 'w' ? 'b' : 'w';
  const half = Number(parts[4]);
  parts[4] = String((Number.isFinite(half) ? half : 0) + 1);
  if (color === 'b') {
    const full = Number(parts[5]);
    parts[5] = String((Number.isFinite(full) ? full : 1) + 1);
  }
  try {
    const loaded = new Chess(parts.join(' '));
    const enemyColor: Color = color === 'w' ? 'b' : 'w';
    const escaped = kingSquare(loaded, color);
    const enemy = kingSquare(loaded, enemyColor);
    if (escaped !== to || !enemy) return null;
    if (chebyshev(to, enemy) <= 1) return null;
    if (loaded.attackers(to, enemyColor).length > 0) return null;
    return loaded.fen();
  } catch {
    return null;
  }
}

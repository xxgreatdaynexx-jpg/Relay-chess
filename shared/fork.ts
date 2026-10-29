import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';

const VALUE: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

const FILES = 'abcdefgh';

/**
 * Enemy pieces the mover on `to` attacks that are worth a fork:
 * the king, anything more valuable than the attacker, or anything undefended.
 * A pawn attacked by a higher-valued piece counts only when undefended.
 */
export function forkTargets(fen: string, to: string): string[] {
  if (!/^[a-h][1-8]$/.test(to)) return [];
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }
  const mover = chess.get(to as Square);
  if (!mover) return [];
  const enemy: Color = mover.color === 'w' ? 'b' : 'w';
  const attackerValue = VALUE[mover.type];
  const targets: string[] = [];
  for (let rank = 1; rank <= 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const square = `${FILES[file]}${rank}` as Square;
      const piece = chess.get(square);
      if (!piece || piece.color !== enemy) continue;
      if (!chess.attackers(square, mover.color).includes(to as Square)) continue;
      if (!worthForking(piece.type, attackerValue, chess.attackers(square, enemy).length > 0)) continue;
      targets.push(square);
    }
  }
  return targets;
}

export function isFork(fen: string, to: string): boolean {
  return forkTargets(fen, to).length >= 2;
}

function worthForking(type: PieceSymbol, attackerValue: number, defended: boolean): boolean {
  if (type === 'k') return true;
  if (!defended) return true;
  if (type === 'p' && attackerValue > VALUE.p) return false;
  return VALUE[type] > attackerValue;
}

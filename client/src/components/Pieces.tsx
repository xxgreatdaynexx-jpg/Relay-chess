import type { PieceSymbol } from 'chess.js';
import bB from '../pieces/cburnett/bB.svg';
import bK from '../pieces/cburnett/bK.svg';
import bN from '../pieces/cburnett/bN.svg';
import bP from '../pieces/cburnett/bP.svg';
import bQ from '../pieces/cburnett/bQ.svg';
import bR from '../pieces/cburnett/bR.svg';
import wB from '../pieces/cburnett/wB.svg';
import wK from '../pieces/cburnett/wK.svg';
import wN from '../pieces/cburnett/wN.svg';
import wP from '../pieces/cburnett/wP.svg';
import wQ from '../pieces/cburnett/wQ.svg';
import wR from '../pieces/cburnett/wR.svg';

const pieces = {
  w: { k: wK, q: wQ, r: wR, b: wB, n: wN, p: wP },
  b: { k: bK, q: bQ, r: bR, b: bB, n: bN, p: bP },
} as const;

export function Piece({
  type,
  color,
  className,
}: {
  type: PieceSymbol;
  color: 'w' | 'b';
  className?: string;
}) {
  return <img src={pieces[color][type]} alt="" draggable={false} className={className} />;
}

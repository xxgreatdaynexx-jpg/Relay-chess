import type { PieceSymbol } from 'chess.js';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Piece } from '@/components/Pieces';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { BLUNDER_FLASH_MS, BOOM_FLASH_MS, CHAD_FLASH_MS, OPENING_FLASH_MS } from '../../../shared/flash';
import type { HintArrow, LegalMove, Promotion } from '../../../shared/types';

interface Drag {
  from: string;
  x: number;
  y: number;
  ox: number;
  oy: number;
  id: number;
  piece: boolean;
  lifted: boolean;
}

const PROMO_ORDER: Promotion[] = ['q', 'r', 'b', 'n'];
const PROMO_NAME: Record<Promotion, string> = {
  q: 'Queen',
  r: 'Rook',
  b: 'Bishop',
  n: 'Knight',
};

export function Board({
  fen,
  orientation,
  legalMoves,
  lastMove,
  inCheck,
  interactive,
  hints = [],
  opening = null,
  blunder = null,
  chad = null,
  boom = null,
  onMove,
}: {
  fen: string;
  orientation: 'white' | 'black';
  legalMoves: LegalMove[];
  lastMove?: { from: string; to: string };
  inCheck: boolean;
  interactive: boolean;
  hints?: HintArrow[];
  opening?: { token: string; label: string } | null;
  blunder?: { token: string; square: string } | null;
  chad?: { token: string; square: string } | null;
  boom?: { token: string; square: string } | null;
  onMove: (move: { from: string; to: string; promotion?: Promotion }) => void;
}) {
  const pieces = useMemo(() => piecesFromFen(fen), [fen]);
  const king = inCheck ? kingSquare(fen) : null;
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [squarePx, setSquarePx] = useState(48);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string; options: Promotion[] } | null>(null);

  function updateDrag(next: Drag | null | ((current: Drag | null) => Drag | null)) {
    const value = typeof next === 'function' ? next(dragRef.current) : next;
    dragRef.current = value;
    setDrag(value);
  }

  useEffect(() => {
    choose(null);
    updateDrag(null);
    setPromo(null);
  }, [fen]);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => setSquarePx(el.clientWidth / 8);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const origins = useMemo(() => {
    const set = new Set<string>();
    for (const move of legalMoves) set.add(move.from);
    return set;
  }, [legalMoves]);

  const targets = useMemo(() => {
    const map = new Map<string, LegalMove[]>();
    if (!selected) return map;
    for (const move of legalMoves) {
      if (move.from !== selected) continue;
      const list = map.get(move.to) ?? [];
      list.push(move);
      map.set(move.to, list);
    }
    return map;
  }, [legalMoves, selected]);

  function commit(from: string, to: string) {
    const options = legalMoves.filter((move) => move.from === from && move.to === to);
    if (options.length === 0) return;
    const promotions = PROMO_ORDER.filter((piece) => options.some((move) => move.promotion === piece));
    if (promotions.length > 0) {
      choose(null);
      setPromo({ from, to, options: promotions });
      return;
    }
    choose(null);
    onMove({ from, to });
  }

  function choose(square: string | null) {
    selectedRef.current = square;
    setSelected(square);
  }

  function onTap(square: string) {
    if (!interactive) return;
    const current = selectedRef.current;
    if (current && legalMoves.some((move) => move.from === current && move.to === square)) {
      choose(null);
      commit(current, square);
      return;
    }
    choose(origins.has(square) && current !== square ? square : null);
  }

  function squareFromPoint(x: number, y: number) {
    const board = boardRef.current;
    if (!board) return null;
    const rect = board.getBoundingClientRect();
    const col = Math.floor(((x - rect.left) / rect.width) * 8);
    const row = Math.floor(((y - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return visualSquare(row, col, orientation);
  }

  const sideToMove = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const dragPiece = drag?.piece && drag.lifted ? pieces.get(drag.from) : undefined;
  const shaking = useShown(boom?.token ?? null, BOOM_FLASH_MS);

  return (
    <div className={cn('board-frame', shaking && 'board-shake')}>
      <div
        ref={boardRef}
        data-testid="board"
        className="relative grid aspect-square w-full grid-cols-8 grid-rows-8 overflow-hidden rounded-md select-none"
        style={{ touchAction: 'none' }}
        role="group"
        aria-label="Chessboard"
      >
        {Array.from({ length: 64 }, (_, index) => {
          const row = Math.floor(index / 8);
          const col = index % 8;
          const square = visualSquare(row, col, orientation);
          const file = square.charCodeAt(0) - 97;
          const rank = Number(square[1]) - 1;
          const dark = (file + rank) % 2 === 0;
          const piece = pieces.get(square);
          const hide = dragPiece && drag?.from === square;
          const isLast = lastMove?.from === square || lastMove?.to === square;
          const isTarget = targets.has(square);
          const capture = isTarget && Boolean(piece);
          return (
            <button
              key={square}
              type="button"
              data-square={square}
              aria-label={labelFor(square, piece)}
              className={cn(
                'relative block h-full w-full p-0',
                dark ? 'bg-square-dark' : 'bg-square-light',
                interactive && (origins.has(square) || selected) ? 'cursor-pointer' : 'cursor-default',
              )}
              onPointerDown={(event) => {
                if (!interactive || event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                updateDrag({
                  from: square,
                  x: event.clientX,
                  y: event.clientY,
                  ox: event.clientX,
                  oy: event.clientY,
                  id: event.pointerId,
                  piece: origins.has(square),
                  lifted: false,
                });
              }}
              onPointerMove={(event) => {
                updateDrag((current) => {
                  if (!current || current.id !== event.pointerId) return current;
                  const lifted = current.lifted || Math.hypot(event.clientX - current.ox, event.clientY - current.oy) > 8;
                  return { ...current, x: event.clientX, y: event.clientY, lifted };
                });
              }}
              onPointerUp={(event) => {
                const current = dragRef.current;
                if (!current || current.id !== event.pointerId) return;
                const moved = Math.hypot(event.clientX - current.ox, event.clientY - current.oy);
                const from = current.from;
                const pieceDrag = current.piece && moved >= 8;
                updateDrag(null);
                if (pieceDrag) {
                  const target = squareFromPoint(event.clientX, event.clientY);
                  if (target) commit(from, target);
                  return;
                }
                onTap(from);
              }}
              onPointerCancel={() => updateDrag(null)}
            >
              {isLast && <span className="pointer-events-none absolute inset-0 bg-[#e0b56a]/45" />}
              {selected === square && <span className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-cream" />}
              {king === square && (
                <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,rgba(196,70,58,0.85)_0%,rgba(196,70,58,0.25)_62%,transparent_70%)]" />
              )}
              {isTarget && !capture && (
                <span
                  className={cn(
                    'pointer-events-none absolute top-1/2 left-1/2 h-[22%] w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-full',
                    dark ? 'bg-[#f0d9b5]/90' : 'bg-[#4a301c]/40',
                  )}
                />
              )}
              {capture && (
                <span
                  className={cn(
                    'pointer-events-none absolute inset-[8%] rounded-full border-[3px]',
                    dark ? 'border-[#f0d9b5]/85' : 'border-[#4a301c]/45',
                  )}
                />
              )}
              {piece && !hide && (
                <Piece
                  type={piece.type}
                  color={piece.color}
                  className="pointer-events-none absolute inset-[7%] h-[86%] w-[86%] drop-shadow-[0_1px_0_rgba(0,0,0,0.35)]"
                />
              )}
              {col === 0 && (
                <span className={cn('pointer-events-none absolute top-0.5 left-1 text-[10px] leading-none font-semibold', dark ? 'text-[#f0d9b5]/80' : 'text-[#6b452c]/80')}>
                  {square[1]}
                </span>
              )}
              {row === 7 && (
                <span className={cn('pointer-events-none absolute right-1 bottom-0.5 text-[10px] leading-none font-semibold', dark ? 'text-[#f0d9b5]/80' : 'text-[#6b452c]/80')}>
                  {square[0]}
                </span>
              )}
            </button>
          );
        })}
        {hints.map((hint) => (
          <HintArrowMark key={`${hint.from}${hint.to}`} hint={hint} orientation={orientation} />
        ))}
        <TimedOverlay
          token={opening?.token ?? null}
          ms={OPENING_FLASH_MS}
          className="opening-flash pointer-events-none absolute inset-x-3 top-[34%] z-30 text-center"
          testId="opening-banner"
        >
          <p
            role="status"
            className="inline-block max-w-full rounded-2xl bg-[#1a1612]/90 px-4 py-2 font-serif text-xl leading-snug text-cream shadow-[0_12px_40px_rgba(0,0,0,0.45)] sm:text-3xl"
          >
            {opening?.label}
          </p>
        </TimedOverlay>
        <TimedOverlay
          token={blunder?.token ?? null}
          ms={BLUNDER_FLASH_MS}
          className="blunder-flash pointer-events-none absolute inset-0 z-20"
          testId="blunder-mark"
        >
          {blunder && <BlunderMark square={blunder.square} orientation={orientation} />}
        </TimedOverlay>
        <TimedOverlay
          token={chad?.token ?? null}
          ms={CHAD_FLASH_MS}
          className="chad-flash pointer-events-none absolute inset-0 z-20"
          testId="chad-face"
        >
          {chad && (
            <div className="absolute" style={squareBox(chad.square, orientation)}>
              <div
                className="absolute top-1/2 left-1/2 w-[210%] -translate-x-1/2 -translate-y-1/2"
                style={{ aspectRatio: '240 / 300' }}
              >
                <ChadFace />
              </div>
            </div>
          )}
        </TimedOverlay>
        {shaking && boom && <BoomBurst square={boom.square} orientation={orientation} />}
      </div>
      {dragPiece && drag && (
        <div
          className="pointer-events-none fixed z-40"
          style={{
            width: squarePx,
            height: squarePx,
            left: drag.x - squarePx / 2,
            top: drag.y - squarePx * 0.72,
          }}
        >
          <Piece type={dragPiece.type} color={dragPiece.color} className="h-full w-full drop-shadow-lg" />
        </div>
      )}
      <Dialog open={Boolean(promo)} onOpenChange={(open) => !open && setPromo(null)}>
        <DialogContent>
          <DialogTitle>Promote pawn</DialogTitle>
          <DialogDescription>Choose the piece. Only legal promotions are shown.</DialogDescription>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {promo?.options.map((piece) => (
              <Button
                key={piece}
                variant="secondary"
                className="h-24 flex-col bg-square-light text-ink hover:bg-[#f7e7cb]"
                onClick={() => {
                  const choice = promo;
                  setPromo(null);
                  if (choice) onMove({ from: choice.from, to: choice.to, promotion: piece });
                }}
              >
                <Piece type={piece} color={sideToMove} className="h-12 w-12" />
                {PROMO_NAME[piece]}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function useShown(token: string | null, ms: number) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!token) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), ms);
    return () => window.clearTimeout(timer);
  }, [token, ms]);
  return Boolean(token) && visible;
}

function squareBox(square: string, orientation: 'white' | 'black'): CSSProperties {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { left: `${col * 12.5}%`, top: `${row * 12.5}%`, width: '12.5%', height: '12.5%' };
}

function BoomBurst({ square, orientation }: { square: string; orientation: 'white' | 'black' }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30" data-testid="queen-boom" aria-hidden="true">
      <div className="boom-spot absolute" style={squareBox(square, orientation)}>
        <span className="boom-anchor">
          <span className="boom-flash" />
        </span>
        <span className="boom-anchor">
          <span className="boom-fire" />
        </span>
        <span className="boom-anchor boom-anchor-core">
          <span className="boom-core" />
        </span>
        <span className="boom-anchor boom-anchor-smoke-a">
          <span className="boom-smoke" />
        </span>
        <span className="boom-anchor boom-anchor-smoke-b">
          <span className="boom-smoke boom-smoke-late" />
        </span>
        <span className="boom-label">BOOM!</span>
      </div>
    </div>
  );
}

function ChadFace() {
  return (
    <svg viewBox="0 0 240 300" className="h-full w-full overflow-visible" aria-hidden="true">
      <filter id="chad-sticker" x="-25%" y="-25%" width="150%" height="150%" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse">
        <feMorphology in="SourceAlpha" operator="dilate" radius="6" result="dilated" />
        <feFlood floodColor="#ffffff" result="flood" />
        <feComposite in="flood" in2="dilated" operator="in" result="halo" />
        <feMerge>
          <feMergeNode in="halo" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <g filter="url(#chad-sticker)" stroke="#111" strokeLinejoin="round" strokeLinecap="round">
        <path d="M46 228 C30 236 16 252 12 286 H228 C220 248 196 228 168 220 C140 232 90 236 46 228 Z" fill="#121212" strokeWidth="5" />
        <path d="M92 196 C84 214 78 230 70 244 C108 258 156 250 170 228 C164 210 150 196 136 190 Z" fill="#f6d2c4" strokeWidth="4" />
        <path d="M70 168 C48 176 34 196 30 220 C26 248 38 274 64 286 C98 302 150 292 168 264 C180 244 176 214 162 196 C146 184 118 176 96 178 C86 170 78 166 70 168 Z" fill="#f2d25c" strokeWidth="5" />
        <path d="M52 196 C70 208 74 230 58 252" fill="none" stroke="#c9962e" strokeWidth="3" />
        <path d="M74 188 C94 210 98 240 82 268" fill="none" stroke="#c9962e" strokeWidth="3" />
        <path d="M100 186 C120 212 122 244 106 274" fill="none" stroke="#c9962e" strokeWidth="3" />
        <path d="M126 190 C142 214 140 246 126 272" fill="none" stroke="#c9962e" strokeWidth="2.8" />
        <path d="M148 198 C158 220 154 246 142 266" fill="none" stroke="#c9962e" strokeWidth="2.6" />
        <path d="M44 230 C64 240 68 258 54 274" fill="none" stroke="#c9962e" strokeWidth="2.6" />
        <path d="M118 62 C96 68 82 88 78 112 C76 128 62 136 50 146 C38 156 36 170 48 176 C58 180 68 172 74 164 C76 176 90 188 108 192 C140 200 178 190 190 164 C200 144 194 114 176 98 C160 84 140 66 118 62 Z" fill="#f6d2c4" strokeWidth="5" />
        <path d="M158 92 C178 102 194 122 192 148 C190 166 178 178 164 174 C160 156 154 132 150 116 C148 104 150 94 158 92 Z" fill="#e7c89a" strokeWidth="4" />
        <path d="M166 114 L174 124 M168 132 L178 140 M160 146 L170 156 M178 122 L186 132 M174 150 L182 158" fill="none" stroke="#b88958" strokeWidth="2.4" />
        <path d="M176 128 C196 118 216 132 212 156 C208 182 186 196 170 182 C158 172 160 142 176 128 Z" fill="#f6d2c4" strokeWidth="4.5" />
        <path d="M186 142 C198 148 198 166 182 172 C176 162 178 148 186 142 Z" fill="#f0b7ac" strokeWidth="3" />
        <path d="M188 146 C194 154 192 164 182 168" fill="none" stroke="#111" strokeWidth="2" />
        <path d="M100 78 C118 36 160 22 196 40 C220 52 226 78 210 96 C196 82 168 74 146 84 C128 70 112 74 100 78 Z" fill="#f3d35e" strokeWidth="5" />
        <path d="M116 74 C142 46 176 40 206 58" fill="none" stroke="#c9962e" strokeWidth="3.2" />
        <path d="M108 82 C138 56 174 52 200 70" fill="none" stroke="#c9962e" strokeWidth="3" />
        <path d="M128 68 C154 44 186 42 214 56" fill="none" stroke="#c9962e" strokeWidth="2.8" />
        <path d="M146 64 C170 48 196 50 220 66" fill="none" stroke="#c9962e" strokeWidth="2.6" />
        <path d="M62 118 Q88 96 122 112" fill="none" stroke="#111" strokeWidth="9" />
        <path d="M64 118 Q88 98 120 112" fill="none" stroke="#e6c454" strokeWidth="4" />
        <path d="M68 132 Q90 124 114 134 Q90 140 68 132 Z" fill="#d5e2ea" strokeWidth="3.5" />
        <ellipse cx="92" cy="133" rx="8" ry="3.2" fill="#7d93a6" stroke="none" />
        <circle cx="94" cy="133" r="1.8" fill="#16191e" stroke="none" />
        <path d="M66 130 Q90 120 116 132" fill="none" stroke="#111" strokeWidth="3.6" />
        <path d="M58 166 Q66 162 74 168 Q66 172 58 166 Z" fill="#eea3aa" strokeWidth="2" />
        <path d="M70 168 C48 156 22 148 14 160 C6 174 22 188 38 178 C50 170 64 168 78 170 C102 164 124 168 138 158 C150 148 144 172 126 178 C106 186 86 184 70 174 Z" fill="#f2d25c" strokeWidth="4.5" />
        <path d="M28 164 C18 174 28 186 40 178" fill="none" stroke="#c9962e" strokeWidth="2.6" />
        <path d="M78 172 C100 166 122 168 136 160" fill="none" stroke="#c9962e" strokeWidth="2.6" />
      </g>
    </svg>
  );
}

function TimedOverlay({
  token,
  ms,
  className,
  testId,
  children,
}: {
  token: string | null;
  ms: number;
  className: string;
  testId: string;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!token) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), ms);
    return () => window.clearTimeout(timer);
  }, [token, ms]);
  if (!visible || !token) return null;
  return (
    <div className={className} data-testid={testId}>
      {children}
    </div>
  );
}

function BlunderMark({ square, orientation }: { square: string; orientation: 'white' | 'black' }) {
  const point = squarePoint(square, orientation);
  return (
    <svg className="h-full w-full" viewBox="0 0 8 8" aria-hidden="true">
      <circle cx={point.x} cy={point.y} r="0.46" fill="rgba(122, 28, 22, 0.92)" />
      <text
        x={point.x}
        y={point.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="0.72"
        fontWeight="700"
        fill="#fff8ee"
        fontFamily="Fraunces Variable, Palatino, serif"
      >
        ?
      </text>
    </svg>
  );
}

function HintArrowMark({
  hint,
  orientation,
}: {
  hint: HintArrow;
  orientation: 'white' | 'black';
}) {
  const from = squarePoint(hint.from, orientation);
  const to = squarePoint(hint.to, orientation);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const start = { x: from.x + ux * 0.2, y: from.y + uy * 0.2 };
  const tip = { x: to.x - ux * 0.12, y: to.y - uy * 0.12 };
  const base = { x: tip.x - ux * 0.42, y: tip.y - uy * 0.42 };
  const head = 0.22;
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      viewBox="0 0 8 8"
      data-testid="hint-arrow"
      aria-hidden="true"
    >
      <line
        x1={start.x}
        y1={start.y}
        x2={base.x}
        y2={base.y}
        stroke="#146b3a"
        strokeWidth="0.2"
        strokeLinecap="round"
      />
      <polygon
        fill="#1f8f4e"
        points={`${tip.x},${tip.y} ${base.x + px * head},${base.y + py * head} ${base.x - px * head},${base.y - py * head}`}
      />
    </svg>
  );
}

function squarePoint(square: string, orientation: 'white' | 'black') {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { x: col + 0.5, y: row + 0.5 };
}

function visualSquare(row: number, col: number, orientation: 'white' | 'black') {
  const file = orientation === 'white' ? col : 7 - col;
  const rank = orientation === 'white' ? 7 - row : row;
  return `${'abcdefgh'[file]}${rank + 1}`;
}

function piecesFromFen(fen: string) {
  const map = new Map<string, { type: PieceSymbol; color: 'w' | 'b' }>();
  const rows = fen.split(' ')[0]?.split('/') ?? [];
  for (let row = 0; row < 8; row += 1) {
    let file = 0;
    for (const char of rows[row] ?? '') {
      if (char >= '1' && char <= '8') {
        file += Number(char);
        continue;
      }
      const color = char === char.toUpperCase() ? 'w' : 'b';
      map.set(`${'abcdefgh'[file]}${8 - row}`, { type: char.toLowerCase() as PieceSymbol, color });
      file += 1;
    }
  }
  return map;
}

function kingSquare(fen: string) {
  const color = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const target = color === 'w' ? 'K' : 'k';
  const rows = fen.split(' ')[0]?.split('/') ?? [];
  for (let row = 0; row < rows.length; row += 1) {
    let file = 0;
    for (const char of rows[row]) {
      if (char >= '1' && char <= '8') {
        file += Number(char);
        continue;
      }
      if (char === target) return `${'abcdefgh'[file]}${8 - row}`;
      file += 1;
    }
  }
  return null;
}

function labelFor(square: string, piece?: { type: PieceSymbol; color: 'w' | 'b' }) {
  if (!piece) return square;
  const names: Record<PieceSymbol, string> = {
    p: 'pawn',
    n: 'knight',
    b: 'bishop',
    r: 'rook',
    q: 'queen',
    k: 'king',
  };
  return `${square}, ${piece.color === 'w' ? 'white' : 'black'} ${names[piece.type]}`;
}

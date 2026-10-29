import { Chess, type Square } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { RelayGame } from '../server/engine.js';
import { BAILOUT_MS, chebyshev, escapeSquares, teleportKing } from '../shared/bailout.js';
import type { Seat } from '../shared/types.js';

const FOOL = [
  { from: 'f2', to: 'f3' },
  { from: 'e7', to: 'e5' },
  { from: 'g2', to: 'g4' },
  { from: 'd8', to: 'h4' },
] as const;

/**
 * White king on a1, checked by the rook on a2. Every other square is occupied,
 * except three squares next to the black king, which a teleport may not use.
 * Paying therefore has nowhere safe to land.
 */
const NO_ESCAPE = 'nnnnnn1k/pppppp2/pppppppp/pppppppp/pppppppp/pqpppppp/rppppppp/Knnnnnnn w - - 0 1';

function fool(game: RelayGame, now = 0) {
  for (const move of FOOL) {
    const seat = game.seatToMove();
    if (!seat) throw new Error('no seat');
    game.move(seat, move, now);
  }
}

function firstSquare(squares: Square[]): Square {
  const square = squares.slice().sort()[0];
  if (!square) throw new Error('no square');
  return square;
}

function kingAt(fen: string, color: 'w' | 'b'): Square {
  const piece = new Chess(fen).board().flat().find((entry) => entry?.type === 'k' && entry.color === color);
  if (!piece) throw new Error('missing king');
  return piece.square;
}

function lineThatMates(fen: string, victim: 'w' | 'b') {
  const board = new Chess(fen);
  type Step = { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' };
  let nodes = 0;
  function dfs(depth: number): Step[] | null {
    if (nodes++ > 20_000) return null;
    if (board.isCheckmate() && board.turn() === victim) return [];
    if (depth === 0 || board.isGameOver()) return null;
    const moves = board.moves({ verbose: true }).sort((a, b) => {
      const score = (san: string) => (san.includes('#') ? 2 : san.includes('+') ? 1 : 0);
      return score(b.san) - score(a.san);
    });
    for (const move of moves) {
      board.move(move);
      const step: Step = {
        from: move.from,
        to: move.to,
        ...(move.promotion ? { promotion: move.promotion as Step['promotion'] } : {}),
      };
      if (board.isCheckmate() && board.turn() === victim) {
        board.undo();
        return [step];
      }
      const rest = dfs(depth - 1);
      board.undo();
      if (rest) return [step, ...rest];
    }
    return null;
  }
  const line = dfs(3);
  if (!line?.length) throw new Error('no cooperative mate');
  return line;
}

describe('checkmate bailout squares', () => {
  it('teleports only to an empty square that is not check and not next to the other king', () => {
    const game = new RelayGame(null);
    game.start(0);
    fool(game);
    const fen = game.fen();
    const squares = escapeSquares(fen);
    expect(squares.length).toBeGreaterThan(0);
    const before = new Chess(fen);
    for (const square of squares) {
      expect(before.get(square)).toBeUndefined();
      const next = teleportKing(fen, square);
      expect(next).toBeTruthy();
      const landed = new Chess(next!);
      const king = kingAt(next!, 'w');
      const enemy = kingAt(next!, 'b');
      expect(king).toBe(square);
      expect(chebyshev(king, enemy)).toBeGreaterThan(1);
      expect(landed.attackers(king, 'b')).toEqual([]);
      expect(landed.turn()).toBe('b');
      const parts = next!.split(' ');
      expect(parts[2]).toBe('kq');
      expect(parts[3]).toBe('-');
      expect(Number(parts[4])).toBe(Number(fen.split(' ')[4]) + 1);
    }
    expect(teleportKing(fen, 'e1')).toBeNull();
    expect(teleportKing(fen, 'h4')).toBeNull();
    expect(teleportKing(fen, 'e8')).toBeNull();
  });

  it('declines the payment when every square is occupied or unsafe', () => {
    expect(new Chess(NO_ESCAPE).isCheckmate()).toBe(true);
    expect(escapeSquares(NO_ESCAPE)).toEqual([]);
    const game = RelayGame.fromPosition(NO_ESCAPE, 0);
    expect(game.bailout?.side).toBe('white');
    expect(game.result).toBeNull();
    expect(game.payBailout('white1', 'Ada', 0)).toEqual({ declined: true });
    expect(game.result).toMatchObject({ type: 'checkmate', winner: 'black' });
    expect(game.escape).toBeNull();
    expect(game.status).toBe('ended');
  });
});

describe('one bailout per team', () => {
  it('lets either mated teammate pay once, then the next mate ends the game', () => {
    const game = new RelayGame(null);
    game.start(0);
    fool(game);
    expect(game.bailout).toMatchObject({ side: 'white', deadline: BAILOUT_MS });
    expect(() => game.payBailout('black1', 'Jules', 0)).toThrow(/mated team/i);
    expect(() => game.acceptMate('black2')).toThrow(/mated team/i);
    const paid = game.payBailout('white2', 'Sam', 5, firstSquare);
    expect(paid.declined).toBe(false);
    expect(game.result).toBeNull();
    expect(game.bailout).toBeNull();
    expect(game.escape).toMatchObject({ name: 'Sam', side: 'white', ply: 5 });
    expect(game.history()).toHaveLength(4);
    expect(game.ply()).toBe(5);
    expect(game.seatToMove()).toBe('black1');
    expect(game.fen().split(' ')[1]).toBe('b');
    expect(() => game.payBailout('white1', 'Ada', 6)).toThrow(/nobody is checkmated/i);

    const line = lineThatMates(game.fen(), 'w');
    for (const move of line) {
      const seat = game.seatToMove();
      if (!seat) throw new Error('no seat');
      game.move(seat, move, 7);
    }
    expect(game.bailout).toBeNull();
    expect(game.result).toMatchObject({ type: 'checkmate', winner: 'black' });
    expect(game.status).toBe('ended');
  });

  it('offers the other team their own bailout, and a rematch restores both', () => {
    const game = new RelayGame(null, { mode: '2v1', pairSide: 'black' });
    game.start(0);
    const played: Seat[] = [];
    for (const move of [
      { from: 'e2', to: 'e4' },
      { from: 'e7', to: 'e5' },
      { from: 'f1', to: 'c4' },
      { from: 'b8', to: 'c6' },
      { from: 'd1', to: 'h5' },
      { from: 'g8', to: 'f6' },
      { from: 'h5', to: 'f7' },
    ]) {
      const seat = game.seatToMove();
      if (!seat) throw new Error('no seat');
      played.push(seat);
      game.move(seat, move, 0);
    }
    expect(played).toEqual(['white1', 'black1', 'white1', 'black2', 'white1', 'black1', 'white1']);
    expect(game.bailout?.side).toBe('black');
    game.payBailout('black1', 'Bea', 1, firstSquare);
    expect(game.result).toBeNull();
    expect(game.seatToMove()).toBe('white1');
    expect(game.fen().split(' ')[1]).toBe('w');
    expect(game.fen().split(' ')[2]).toBe('KQ');
    expect(game.fen().split(' ')[3]).toBe('-');

    game.resign('white1');
    for (const seat of ['white1', 'black1', 'black2'] as const) game.voteRematch(seat, 2);
    expect(game.bailout).toBeNull();
    expect(game.escape).toBeNull();
    expect(game.ply()).toBe(0);
    fool(game, 3);
    expect(game.bailout?.side).toBe('white');
  });

  it('keeps 1v1 and the white pair rotating onto the opponent after the teleport', () => {
    const solo = new RelayGame(null, { mode: '1v1', pairSide: null });
    solo.start(0);
    fool(solo);
    solo.payBailout('white1', 'Ada', 0, firstSquare);
    expect(solo.seatToMove()).toBe('black1');
    expect(solo.fen().split(' ')[1]).toBe('b');

    const pair = new RelayGame(null, { mode: '2v1', pairSide: 'white' });
    pair.start(0);
    fool(pair);
    expect(pair.seatToMove()).toBe('white1');
    pair.payBailout('white2', 'Sam', 0, firstSquare);
    expect(pair.seatToMove()).toBe('black1');
    expect(pair.ply()).toBe(5);
    expect(pair.history()).toHaveLength(4);
  });

  it('pauses the clock until the offer is answered, and a timeout is a normal mate', () => {
    const game = RelayGame.fromPosition(new Chess().fen(), 0, { initialMs: 60_000, incrementMs: 1_000 }, 0);
    fool(game, 0);
    expect(game.isClockRunning()).toBe(false);
    const during = game.clockView(0);
    game.tick(30_000);
    game.setMoverConnected(true, 30_000);
    expect(game.result).toBeNull();
    expect(game.isClockRunning()).toBe(false);
    expect(game.clockView(30_000)?.whiteMs).toBe(during?.whiteMs);
    expect(game.expireBailout(BAILOUT_MS - 1)).toBe(false);
    expect(game.expireBailout(BAILOUT_MS)).toBe(true);
    expect(game.result).toMatchObject({ type: 'checkmate', winner: 'black' });
    expect(game.bailout).toBeNull();

    const paid = RelayGame.fromPosition(new Chess().fen(), 0, { initialMs: 60_000, incrementMs: 1_000 }, 0);
    fool(paid, 0);
    const blackMs = paid.clockView(0)?.blackMs ?? 0;
    paid.payBailout('white1', 'Ada', 4_000, firstSquare);
    expect(paid.isClockRunning()).toBe(true);
    expect(paid.clockView(4_000)?.active).toBe('black');
    paid.tick(7_000);
    expect(paid.clockView(7_000)?.blackMs).toBe(blackMs - 3_000);
    const whiteMs = paid.clockView(7_000)?.whiteMs;
    paid.setMoverConnected(false, 7_000);
    paid.tick(12_000);
    expect(paid.clockView(12_000)?.blackMs).toBe(blackMs - 3_000);
    expect(paid.clockView(12_000)?.whiteMs).toBe(whiteMs);
  });
});

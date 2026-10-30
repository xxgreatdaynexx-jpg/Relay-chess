import { describe, expect, it } from 'vitest';
import { applyMissedWin, applyMove, checkersLoser, findMove, INITIAL_CHECKERS_FEN, legalMoves, parseFen, toFen, winningMoves } from '../shared/checkers.js';
import { CheckersGame } from '../server/checkers-game.js';
import { Room } from '../server/rooms.js';

const pos = (fen: string) => parseFen(fen)!;

describe('checkers rules', () => {
  it('starts with 12 men each, White to move, 7 opening moves', () => {
    const p = pos(INITIAL_CHECKERS_FEN);
    expect(p.board.size).toBe(24);
    expect(p.turn).toBe('w');
    expect(legalMoves(p)).toHaveLength(7);
    expect(toFen(p)).toBe(INITIAL_CHECKERS_FEN);
  });

  it('forces a capture when one exists', () => {
    const p = pos('8/8/8/8/3p4/2P5/8/6P1 w 0 1');
    const moves = legalMoves(p);
    expect(moves.map((m) => m.san)).toEqual(['c3xe5']);
  });

  it('chains multi-jumps and keeps jumping to the end', () => {
    const p = pos('8/8/5p2/8/3p4/2P5/8/8 w 0 1');
    const moves = legalMoves(p);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.san).toBe('c3xe5xg7');
    expect(moves[0]!.captures.sort()).toEqual(['d4', 'f6']);
  });

  it('men move forward only, kings both ways', () => {
    expect(legalMoves(pos('8/8/8/8/3P4/8/8/8 w 0 1')).map((m) => m.to).sort()).toEqual(['c5', 'e5']);
    expect(legalMoves(pos('8/8/8/8/3K4/8/8/8 w 0 1')).map((m) => m.to).sort()).toEqual(['c3', 'c5', 'e3', 'e5']);
  });

  it('crowns on the back row and ends the jump there', () => {
    const p = pos('8/2p1p3/1P6/8/8/8/8/8 w 0 1');
    const m = legalMoves(p);
    expect(m.map((x) => x.san)).toEqual(['b6xd8']);
    expect(m[0]!.crowns).toBe(true);
    const after = applyMove(p, m[0]!);
    expect(after.board.get('d8')).toEqual({ c: 'w', king: true });
    expect(after.quiet).toBe(0);
  });

  it('a side with no moves or no pieces loses', () => {
    expect(checkersLoser(pos('8/8/8/8/8/8/8/P7 b 0 1'))).toBe('b');
    expect(checkersLoser(pos('8/8/8/8/8/8/1p6/8 w 0 1'))).toBe('w');
    // White man on a1 blocked by b2 with c3 covered: no legal moves.
    expect(checkersLoser(pos('8/8/8/8/8/2p5/1p6/P7 w 0 1'))).toBe('w');
  });

  it('missed winning move costs the piece that could have won', () => {
    const before = pos('8/8/8/8/3p4/2P5/8/6P1 w 0 1');
    const wins = winningMoves(before);
    expect(wins.map((w) => w.san)).toEqual(['c3xe5']);
    // Captures are forced, so an optional win is a blocking move: a5-b6 leaves a7 stuck.
    const p2 = pos('8/p7/8/P1P5/8/8/8/6P1 w 0 1');
    const w2 = winningMoves(p2);
    expect(w2.map((m) => m.san)).toEqual(['a5-b6']);
    const other = findMove(p2, 'g1', 'h2')!;
    const res = applyMissedWin(p2, other, applyMove(p2, other), w2)!;
    expect(res.removed).toEqual(['a5']);
    expect(applyMissedWin(p2, w2[0]!, applyMove(p2, w2[0]!), w2)).toBeNull();
  });
});

describe('CheckersGame', () => {
  it('plays a relay game through the shared table machinery', () => {
    const room = new Room('CHK1', { id: 'none', label: 'No clock', initialMs: 0, incrementMs: 0 } as never, { mode: '1v1', pairSide: null }, 'checkers');
    const a = room.addMember('Ann');
    const b = room.addMember('Bob');
    room.connect(a, 'sa');
    room.connect(b, 'sb');
    room.sit(a, 'white1');
    room.sit(b, 'black1');
    expect(room.game.status).toBe('playing');
    expect(room.view('sa', 0).gameType).toBe('checkers');
    expect(room.view('sa', 0).legalMoves).toHaveLength(7);
    room.move(a, { from: 'c3', to: 'd4' });
    expect(room.view('sb', 0).seatToMove).toBe('black1');
    expect(() => room.move(b, { from: 'd6', to: 'd5' })).toThrow();
    room.move(b, { from: 'f6', to: 'e5' });
    expect(room.view('sa', 0).legalMoves.map((m) => m.san)).toEqual(['d4xf6']);
    expect(room.summary().gameType).toBe('checkers');
  });

  it('ends on no moves, missed win and the forty-move rule', () => {
    const g = CheckersGame.fromCheckers('8/8/8/8/3p4/2P5/8/8 w 0 1', 0);
    g.move('white1', { from: 'c3', to: 'e5' }, 1);
    expect(g.result).toEqual({ type: 'no_moves', winner: 'white' });

    const m = CheckersGame.fromCheckers('8/p7/8/P1P5/8/8/8/6P1 w 0 1', 0);
    m.move('white1', { from: 'g1', to: 'h2' }, 1);
    expect(m.missedMate?.removed).toEqual([{ square: 'a5', piece: 'p' }]);
    expect(m.fen().startsWith('8/p7/8/2P5/')).toBe(true);

    const q = CheckersGame.fromCheckers('8/8/8/8/8/8/8/K5k1 w 79 40', 0);
    q.move('white1', { from: 'a1', to: 'b2' }, 1);
    expect(q.result?.type).toBe('forty_move');
  });
});

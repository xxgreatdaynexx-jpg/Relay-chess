import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { queenCaptureSquare, queenMoveSound } from '../shared/capture.js';

describe('queen capture square', () => {
  it('finds either queen on the square the move landed on', () => {
    const whiteTakes = new Chess('4k3/8/8/3q4/4Q3/8/8/4K3 w - - 0 1');
    const beforeWhite = whiteTakes.fen();
    whiteTakes.move({ from: 'e4', to: 'd5' });
    expect(whiteTakes.history({ verbose: true })[0]?.san).toBe('Qxd5');
    expect(queenCaptureSquare(beforeWhite, 'd5')).toBe('d5');

    const blackTakes = new Chess('4k3/8/8/3q4/4Q3/8/8/4K3 b - - 0 1');
    const beforeBlack = blackTakes.fen();
    blackTakes.move({ from: 'd5', to: 'e4' });
    expect(queenCaptureSquare(beforeBlack, 'e4')).toBe('e4');
  });

  it('plays a capture clip when a queen takes, and death when a queen is taken', () => {
    const queenTakesKnight = new Chess('4k3/8/8/3n4/4Q3/8/8/4K3 w - - 0 1');
    const beforeKnight = queenTakesKnight.fen();
    expect(queenTakesKnight.move({ from: 'e4', to: 'd5' }).san).toBe('Qxd5');
    expect(queenMoveSound(beforeKnight, 'e4', 'd5')).toBe('capture');

    const queenTakesQueen = new Chess('4k3/8/8/3q4/4Q3/8/8/4K3 w - - 0 1');
    const beforeQueens = queenTakesQueen.fen();
    expect(queenTakesQueen.move({ from: 'e4', to: 'd5' }).san).toBe('Qxd5');
    expect(queenMoveSound(beforeQueens, 'e4', 'd5')).toBe('death');
    expect(queenCaptureSquare(beforeQueens, 'd5')).toBe('d5');

    const rookTakesQueen = new Chess('3q3k/8/8/3R4/8/8/8/4K3 w - - 0 1');
    const beforeRook = rookTakesQueen.fen();
    expect(rookTakesQueen.move({ from: 'd5', to: 'd8' }).san).toBe('Rxd8+');
    expect(queenMoveSound(beforeRook, 'd5', 'd8')).toBe('death');

    const quiet = new Chess('4k3/8/8/8/4Q3/8/8/4K3 w - - 0 1');
    const beforeQuiet = quiet.fen();
    expect(quiet.move({ from: 'e4', to: 'e5' }).san).toBe('Qe5+');
    expect(queenMoveSound(beforeQuiet, 'e4', 'e5')).toBeNull();

    const pawnTakes = new Chess('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1');
    const beforePawn = pawnTakes.fen();
    expect(pawnTakes.move({ from: 'e4', to: 'd5' }).san).toBe('exd5');
    expect(queenMoveSound(beforePawn, 'e4', 'd5')).toBeNull();
  });

  it('ignores other captures and quiet moves', () => {
    const pawn = new Chess('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1');
    const before = pawn.fen();
    expect(queenCaptureSquare(before, 'd5')).toBeNull();
    expect(queenCaptureSquare(new Chess().fen(), 'e4')).toBeNull();
    expect(queenCaptureSquare(before, 'nope')).toBeNull();
  });
});

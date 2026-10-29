import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { queenCaptureSquare } from '../shared/capture.js';

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

  it('ignores other captures and quiet moves', () => {
    const pawn = new Chess('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1');
    const before = pawn.fen();
    expect(queenCaptureSquare(before, 'd5')).toBeNull();
    expect(queenCaptureSquare(new Chess().fen(), 'e4')).toBeNull();
    expect(queenCaptureSquare(before, 'nope')).toBeNull();
  });
});

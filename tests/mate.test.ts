import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { hasMateInOne } from '../shared/mate.js';

describe('mate in one', () => {
  it('is true on a back rank and false from the starting position', () => {
    expect(hasMateInOne(new Chess().fen())).toBe(false);

    const backRank = new Chess('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
    expect(backRank.moves({ verbose: true }).some((move) => move.san === 'Ra8#')).toBe(true);
    expect(hasMateInOne(backRank.fen())).toBe(true);

    const mated = new Chess('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(mated.isCheckmate()).toBe(true);
    expect(hasMateInOne(mated.fen())).toBe(false);
  });
});
import { describe, expect, it } from 'vitest';
import { RelayGame } from '../server/engine.js';
import { applyMissedMate, matingMoves } from '../shared/missedMate.js';
import type { TableSetup } from '../shared/types.js';

const RELAY_1V1: TableSetup = { mode: '1v1', pairSide: null };

function game(fen: string) {
  return RelayGame.fromPosition(fen, 0, null, 0, RELAY_1V1);
}
function play(g: RelayGame, from: string, to: string, promotion?: 'q') {
  g.move(g.seatToMove()!, { from, to, ...(promotion ? { promotion } : {}) }, 1, 'Dayne');
}
const board = (fen: string) => fen.split(' ')[0];

describe('missed mate rule', () => {
  it('removes the piece that could have mated', () => {
    const g = game('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
    play(g, 'h2', 'h3');
    expect(board(g.fen())).toBe('6k1/5ppp/8/8/8/7P/5PP1/6K1');
    expect(g.missedMate).toMatchObject({ name: 'Dayne', side: 'white', missed: ['Ra8#'], removed: [{ square: 'a1', piece: 'r' }] });
    expect(g.history().at(-1)?.missedMate?.removed).toEqual([{ square: 'a1', piece: 'r' }]);
    expect(g.history().at(-1)?.fenAfter).toBe(g.fen());
    expect(g.result).toBeNull();
    expect(g.seatToMove()).not.toBeNull();
  });

  it('removes every piece that could have mated', () => {
    const g = game('6k1/5ppp/8/8/8/8/5PPP/RR4K1 w - - 0 1');
    play(g, 'h2', 'h3');
    expect(board(g.fen())).toBe('6k1/5ppp/8/8/8/7P/5PP1/6K1');
    expect(g.missedMate?.removed.map((r) => r.square).sort()).toEqual(['a1', 'b1']);
  });

  it('removes the piece from its new square when it moved elsewhere', () => {
    const g = game('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
    play(g, 'a1', 'a2');
    expect(board(g.fen())).toBe('6k1/5ppp/8/8/8/8/5PPP/6K1');
    expect(g.missedMate?.removed).toEqual([{ square: 'a2', piece: 'r' }]);
  });

  it('never removes a king', () => {
    const fen = 'R2K3k/6pp/8/8/8/8/8/8 w - - 0 1';
    expect(matingMoves(fen).every((m) => m.piece === 'k')).toBe(true);
    const g = game(fen);
    play(g, 'd8', 'e8');
    expect(board(g.fen())).toBe('R3K2k/6pp/8/8/8/8/8/8');
    expect(g.missedMate).toBeNull();
  });

  it('removes the pawn for a promotion mate', () => {
    const g = game('7k/P5pp/8/8/8/8/8/6K1 w - - 0 1');
    play(g, 'g1', 'f2');
    expect(board(g.fen())).toBe('7k/6pp/8/8/8/8/5K2/8');
    expect(g.missedMate?.removed).toEqual([{ square: 'a7', piece: 'p' }]);
  });

  it('drops castling rights for a removed rook', () => {
    const g = game('6k1/5ppp/8/8/8/8/7P/R3K3 w Q - 0 1');
    play(g, 'h2', 'h3');
    expect(g.fen().split(' ')[2]).toBe('-');
    expect(board(g.fen())).toBe('6k1/5ppp/8/8/8/7P/8/4K3');
  });

  it('clears en passant when the double-pushed pawn is removed', () => {
    const out = applyMissedMate(
      '6k1/5ppp/8/8/8/8/P7/1R4K1 w - - 0 1',
      { from: 'a2', to: 'a4', san: 'a4' },
      '6k1/5ppp/8/8/P7/8/8/1R4K1 b - a3 0 1',
      [{ from: 'a2', to: 'a4', san: 'fake#', piece: 'p' }],
    );
    expect(out?.fen).toBe('6k1/5ppp/8/8/8/8/8/1R4K1 b - - 0 1');
  });

  it('playing the mate wins normally', () => {
    const g = game('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
    play(g, 'a1', 'a8');
    expect(g.missedMate).toBeNull();
    expect(board(g.fen())).toBe('R5k1/5ppp/8/8/8/8/5PPP/6K1');
    expect(g.bailout ?? g.result).toBeTruthy();
  });

  it('does nothing when no mate is available', () => {
    const g = RelayGame.fromPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 0, null, 0, RELAY_1V1);
    play(g, 'e2', 'e4');
    expect(g.missedMate).toBeNull();
    expect(g.history().at(-1)?.missedMate).toBeUndefined();
  });

  it('ends the game when losing a pinned mating piece exposes the king', () => {
    const g = game('4r2k/6pp/8/8/8/8/4R2P/4K3 w - - 0 1');
    play(g, 'h2', 'h3');
    expect(g.result).toMatchObject({ type: 'missed_mate', winner: 'black' });
  });
});

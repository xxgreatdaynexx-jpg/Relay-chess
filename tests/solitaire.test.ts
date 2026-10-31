import { describe, expect, it } from 'vitest';
import { autoTarget, bestTableauTarget, canMove, deal, draw, isStuck, isValidState, isWon, move, type Card, type GameState } from '../client/src/solitaire/logic';

const c = (id: string, faceUp = true): Card => ({ id, suit: id[0] as Card['suit'], rank: Number(id.slice(1)), faceUp });
function empty(): GameState {
  return { stock: [], waste: [], foundations: [[], [], [], []], tableau: [[], [], [], [], [], [], []], moves: 0, startedAt: 0 };
}

describe('solitaire deal', () => {
  it('deals 52 unique cards in Klondike layout', () => {
    const s = deal(42);
    const all = [...s.stock, ...s.waste, ...s.tableau.flat()];
    expect(all).toHaveLength(52);
    expect(new Set(all.map((x) => x.id)).size).toBe(52);
    s.tableau.forEach((p, i) => {
      expect(p).toHaveLength(i + 1);
      p.forEach((x, j) => expect(x.faceUp).toBe(j === i));
    });
    expect(s.stock).toHaveLength(24);
    expect(s.stock.every((x) => !x.faceUp)).toBe(true);
    expect(isValidState(s)).toBe(true);
  });
  it('is deterministic per seed', () => {
    expect(deal(7, 0)).toEqual(deal(7, 0));
  });
});

describe('solitaire moves', () => {
  it('enforces alternating colour, descending rank, kings on empty', () => {
    const s = empty();
    s.tableau[0] = [c('S8')];
    s.tableau[1] = [c('H7')];
    s.tableau[2] = [c('D7')];
    s.tableau[3] = [c('C7')];
    s.tableau[4] = [c('H13')];
    expect(canMove(s, { kind: 'tableau', index: 1, cardIndex: 0 }, { kind: 'tableau', index: 0 })).toBe(true);
    expect(canMove(s, { kind: 'tableau', index: 3, cardIndex: 0 }, { kind: 'tableau', index: 0 })).toBe(false);
    expect(canMove(s, { kind: 'tableau', index: 4, cardIndex: 0 }, { kind: 'tableau', index: 5 })).toBe(true);
    expect(canMove(s, { kind: 'tableau', index: 1, cardIndex: 0 }, { kind: 'tableau', index: 5 })).toBe(false);
  });
  it('moves multi-card runs and flips the exposed card', () => {
    const s = empty();
    s.tableau[0] = [c('C2', false), c('S9'), c('H8'), c('C7')];
    s.tableau[1] = [c('D10')];
    const n = move(s, { kind: 'tableau', index: 0, cardIndex: 1 }, { kind: 'tableau', index: 1 })!;
    expect(n.tableau[1].map((x) => x.id)).toEqual(['D10', 'S9', 'H8', 'C7']);
    expect(n.tableau[0]).toEqual([c('C2', true)]);
    expect(n.moves).toBe(1);
    // broken run is not pickable
    const b = empty();
    b.tableau[0] = [c('S9'), c('C8')];
    b.tableau[1] = [c('D10')];
    expect(move(b, { kind: 'tableau', index: 0, cardIndex: 0 }, { kind: 'tableau', index: 1 })).toBeNull();
  });
  it('builds foundations ace up by suit', () => {
    let s = empty();
    s.waste = [c('H2'), c('H1')];
    s.tableau[0] = [c('S1')];
    expect(canMove(s, { kind: 'waste' }, { kind: 'foundation', index: 0 })).toBe(true);
    s = move(s, { kind: 'waste' }, autoTarget(s, { kind: 'waste' })!)!;
    expect(canMove(s, { kind: 'tableau', index: 0, cardIndex: 0 }, { kind: 'foundation', index: 0 })).toBe(false);
    s = move(s, { kind: 'waste' }, { kind: 'foundation', index: 0 })!;
    expect(s.foundations[0].map((x) => x.id)).toEqual(['H1', 'H2']);
  });
  it('draws and recycles the stock', () => {
    let s = empty();
    s.stock = [c('S1', false), c('S2', false)];
    s = draw(s)!;
    expect(s.waste.map((x) => x.id)).toEqual(['S2']);
    s = draw(draw(s)!)!;
    expect(s.waste).toHaveLength(0);
    expect(s.stock.map((x) => x.id)).toEqual(['S1', 'S2']);
  });
  it('detects a win', () => {
    const s = empty();
    s.foundations = (['S', 'H', 'D', 'C'] as const).map((su) => Array.from({ length: 13 }, (_, i) => c(`${su}${i + 1}`)));
    expect(isWon(s)).toBe(true);
    s.tableau[0] = [s.foundations[0].pop()!];
    expect(isWon(s)).toBe(false);
  });
});

describe('no-moves-left detector (isStuck)', () => {
  // Spades/clubs on 2s up so aces are home; a red 9 face-up with nothing to go on.
  it('is not stuck while a card can still be drawn and played', () => {
    const s = empty();
    s.stock = [c('S1', false)];
    expect(isStuck(s, false)).toBe(false);
  });
  it('is stuck with no redeal when the waste top and the board have nothing to do', () => {
    const s = empty();
    s.waste = [c('H5'), c('D9')];
    s.tableau[0] = [c('S7', false), c('C3')];
    s.tableau[1] = [c('H12')];
    expect(isStuck(s, false)).toBe(true);
  });
  it('a recycle makes buried waste cards count', () => {
    const s = empty();
    s.waste = [c('S1'), c('D9')];
    s.tableau[0] = [c('C3')];
    expect(isStuck(s, false)).toBe(true);
    expect(isStuck(s, true)).toBe(false); // the ace can go up after a redeal
  });
  it('a tableau move that turns a card over is progress', () => {
    const s = empty();
    s.tableau[0] = [c('S7', false), c('H5')];
    s.tableau[1] = [c('C6')];
    expect(isStuck(s, false)).toBe(false);
  });
  it('moving a king between empty columns or a pointless shuffle is not progress', () => {
    const s = empty();
    s.tableau[0] = [c('S13')];
    s.tableau[1] = [c('C9', false), c('D8')];
    s.tableau[2] = [c('S9'), c('H8')]; // D8 ⇄ onto S9 is blocked (H8 there); H8 could only shuffle
    expect(isStuck(s, false)).toBe(true);
  });
  it('uncovering a card that can go to a foundation is progress', () => {
    const s = empty();
    s.foundations[0] = [c('H1')];
    s.tableau[0] = [c('H2'), c('C1')];
    expect(isStuck(s, false)).toBe(false);
  });
  it('a won game is never stuck', () => {
    const s = empty();
    s.foundations = ['S', 'H', 'D', 'C'].map((u) => Array.from({ length: 13 }, (_, k) => c(`${u}${k + 1}`)));
    expect(isStuck(s, false)).toBe(false);
  });
});

describe('click-to-move target', () => {
  it('prefers a foundation, then a non-empty column, and never parks a bottom king in another empty column', () => {
    const s = empty();
    s.tableau[0] = [c('S13')];
    s.tableau[1] = [];
    expect(autoTarget(s, { kind: 'tableau', index: 0, cardIndex: 0 })).toBeNull();
    s.tableau[2] = [c('C9', false), c('H13')];
    expect(autoTarget(s, { kind: 'tableau', index: 2, cardIndex: 1 })).toEqual({ kind: 'tableau', index: 1 });
    s.tableau[3] = [c('D13'), c('C12')];
    s.tableau[4] = [c('H12')];
    expect(bestTableauTarget(s, { kind: 'tableau', index: 4, cardIndex: 0 })).toEqual({ kind: 'tableau', index: 0 });
  });
});

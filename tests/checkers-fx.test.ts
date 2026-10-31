import { describe, expect, it } from 'vitest';
import { checkersMoveFx } from '../shared/checkersFx';
import { applyMove, findMove, parseFen, toFen } from '../shared/checkers';

function play(fen: string, from: string, to: string, via?: string[]) {
  const p = parseFen(fen)!;
  const m = findMove(p, from, to, via)!;
  expect(m).toBeTruthy();
  return { after: toFen(applyMove(p, m)), path: m.path };
}

describe('checkers explosion mapping', () => {
  it('quiet move fires nothing', () => {
    const fen = '8/8/8/8/8/8/8/P7 w 0 1'.replace('P7', '2P5');
    const { after, path } = play(fen, 'c1', 'd2');
    expect(checkersMoveFx(fen, after, 'c1', path)).toEqual({ captures: [], huh: false });
  });
  it('single jump explodes the captured square', () => {
    const fen = '8/8/8/8/8/8/3p4/2P5 w 0 1';
    const { after, path } = play(fen, 'c1', 'e3');
    expect(checkersMoveFx(fen, after, 'c1', path).captures).toEqual(['d2']);
  });
  it('double jump explodes each piece in jump order', () => {
    const fen = '8/8/8/8/5p2/8/3p4/2P5 w 0 1';
    const { after, path } = play(fen, 'c1', 'g5', ['e3']);
    expect(checkersMoveFx(fen, after, 'c1', path).captures).toEqual(['d2', 'f4']);
  });
  it('huh when the move hands over a multi-jump', () => {
    const base = '8/8/7p/8/5P2/4P3/8/8 w 0 1';
    const bad = play(base, 'f4', 'g5');
    expect(checkersMoveFx(base, bad.after, 'f4', bad.path)).toEqual({ captures: [], huh: true });
    const ok = play(base, 'f4', 'e5');
    expect(checkersMoveFx(base, ok.after, 'f4', ok.path).huh).toBe(false);
  });
});

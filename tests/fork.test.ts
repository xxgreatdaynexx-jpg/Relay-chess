import { describe, expect, it } from 'vitest';
import { forkTargets, isFork } from '../shared/fork.js';

describe('fork detection', () => {
  it('sees a knight fork of the king and queen', () => {
    const fen = '4k3/2N5/8/3q4/8/8/8/4K3 w - - 0 1';
    expect(forkTargets(fen, 'c7').sort()).toEqual(['d5', 'e8']);
    expect(isFork(fen, 'c7')).toBe(true);
  });

  it('does not call a single attack or two defended pawns a fork', () => {
    expect(isFork('4k3/2N5/8/8/8/8/8/4K3 w - - 0 1', 'c7')).toBe(false);
    const pawns = '4k3/3q4/2p1p3/8/3N4/8/8/4K3 w - - 0 1';
    expect(forkTargets(pawns, 'd4')).toEqual([]);
    expect(isFork(pawns, 'd4')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { initialPosition, parseFen } from '../shared/checkers';
import { CHECKERS_WIN, gradeCheckersMove, searchCheckers } from '../shared/checkers-engine';

describe('checkers engine', () => {
  it('finds a legal move from the start quickly', () => {
    const r = searchCheckers(initialPosition(), { maxNodes: 20000 });
    expect(r.best).not.toBeNull();
    expect(r.depth).toBeGreaterThan(2);
    expect(Math.abs(r.score)).toBeLessThan(200);
  });
  it('takes the free double jump', () => {
    const pos = parseFen('8/8/8/4p3/8/2p5/1P6/8 w 0 1')!;
    const r = searchCheckers(pos);
    expect(r.best?.captures.length).toBe(2);
    expect(r.score).toBeGreaterThan(CHECKERS_WIN - 1000);
  });
  it('grades moves by loss for the mover', () => {
    expect(gradeCheckersMove(50, 48, 'w')).toBe('best');
    expect(gradeCheckersMove(50, -300, 'w')).toBe('blunder');
    expect(gradeCheckersMove(-50, 100, 'b')).toBe('mistake');
  });
});

import { createTournament } from '../server/tournament';
describe('checkers tournament', () => {
  it('passes the game type to every match room', () => {
    const t = createTournament('QA-host', '5+0', 4, Date.now(), 'checkers');
    expect(t.view().gameType).toBe('checkers');
    const made: string[] = [];
    for (const n of ['QA-b', 'QA-c', 'QA-d']) t.join(n);
    t.start({ create: (_c: string, _w: string, _b: string, g?: string) => { made.push(g ?? 'chess'); return 'R' + made.length; }, status: () => null } as never);
    expect(made.length).toBe(2);
    expect(made.every((g) => g === 'checkers')).toBe(true);
  });
});

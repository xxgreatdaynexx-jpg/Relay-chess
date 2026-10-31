import { describe, expect, it } from 'vitest';
import { simulate } from './helpers/moveSim';
import { ArenaWorld } from '../server/arena-world';
import { ArenaAntiCheat, type ArenaFlag } from '../server/arena-anticheat';
import { KNIFE_SPEED_MULT, moveAllowance, MoveHistory, reconcileMove, RECONCILE_IGNORE, SPRINT_MULT, speedOf } from '../shared/fps';
import { SIM_MAP } from './helpers/moveSim';

const MAX_CORRECTION = 0.1;

describe('arena: no rubberbanding while sprinting (15 s simulated client)', () => {
  for (const latencyMs of [0, 100]) for (const knife of [false, true]) for (const corners of [false, true]) {
    it(`${latencyMs} ms, ${knife ? 'knife' : 'gun'}, ${corners ? 'laps around a pillar' : 'straight line'}`, () => {
      const r = simulate({ latencyMs, jitterMs: latencyMs ? 25 : 0, knife, corners, mode: 'seq', seconds: 15 });
      expect(r.acks).toBeGreaterThan(150);
      expect(r.maxCorrection).toBeLessThanOrEqual(MAX_CORRECTION);
      expect(r.snaps).toBe(0);
      expect(r.flags).toEqual([]);
    });
  }
  it('the old reconcile (now vs stale snapshot) rubberbands at 100 ms — regression baseline', () => {
    expect(simulate({ latencyMs: 100, jitterMs: 25, knife: true, mode: 'legacy' }).maxCorrection).toBeGreaterThan(0.6);
  });
});

describe('arena: server move cap uses the shared speed function', () => {
  it('max legit speed is sprint × knife (1.725×) and the cap covers it', () => {
    const top = speedOf({ sprint: true, weapon: 'knife' });
    expect(top / speedOf({ weapon: 'pistol' })).toBeCloseTo(SPRINT_MULT * KNIFE_SPEED_MULT, 5);
    expect(moveAllowance({ sprint: true, weapon: 'knife' }, 100)).toBeGreaterThan(top * 0.1 * 1.4);
  });
  it('a knife sprint the direction check rejects (wall slide) is not clipped, and not flagged', () => {
    const flags: ArenaFlag[] = [];
    const w = new ArenaWorld(SIM_MAP, () => 0.5);
    w.audit = new ArenaAntiCheat((f) => flags.push(f), (_i, n) => n);
    const f = w.join('me', 'me', 0, 'knife');
    Object.assign(f, { x: 5.5, y: 5.5, weapon: 'knife', lastMove: 0 });
    const step = speedOf({ sprint: true, weapon: 'knife' }) * 0.066;
    // facing +x but moving +y (sideways): server says no sprint, client claims sprint
    w.move('me', 5.5, 5.5 + step, 0, 66, 0, false, true, 1);
    expect(f.y).toBeCloseTo(5.5 + step, 5);
    expect(flags).toEqual([]);
  });
  it('a speed hack is still clipped and flagged', () => {
    const flags: ArenaFlag[] = [];
    const w = new ArenaWorld(SIM_MAP, () => 0.5);
    w.audit = new ArenaAntiCheat((f) => flags.push(f), (_i, n) => n);
    const f = w.join('me', 'me', 0, 'knife');
    Object.assign(f, { x: 5.5, y: 5.5, weapon: 'knife', lastMove: 0 });
    for (let i = 1; i <= 30; i++) w.move('me', f.x + 3, f.y, 0, i * 66, 0, false, true, i);
    const top = speedOf({ sprint: true, weapon: 'knife' });
    expect(f.x).toBeLessThan(5.5 + 1.98 * top * 1.5 + 30 * 0.1 + 0.8); // asked for +90
    expect(flags.length).toBeGreaterThan(0);
  });
});

describe('reconcileMove', () => {
  it('ignores tiny error, blends small, snaps large, and uses the acked history entry', () => {
    const h = new MoveHistory();
    h.push(1, 0, 0); h.push(2, 1, 0); h.push(3, 2, 0);
    expect(reconcileMove(h, { x: 1 + RECONCILE_IGNORE / 2, y: 0, q: 2 }, { x: 5, y: 0 }).kind).toBe('none');
    expect(reconcileMove(h, { x: 2.5, y: 0, q: 3 }, { x: 5, y: 0 })).toMatchObject({ kind: 'blend', dx: 0.5 });
    h.push(4, 3, 0);
    expect(reconcileMove(h, { x: 8, y: 0, q: 4 }, { x: 5, y: 0 }).kind).toBe('snap');
    expect(reconcileMove(h, { x: 8, y: 0 }, { x: 5, y: 0 }).kind).toBe('none');
  });
});

import { describe, expect, it } from 'vitest';
import { gridMap, moveHorizontal, stepVertical, speedOf, tryJump, MoveHistory, reconcileMove, type Body } from '../shared/fps';
import { LOCAL_STEP_S } from '../shared/netInterp';
import { ArenaWorld } from '../server/arena-world';

const OPEN = gridMap(['##############################', ...Array(10).fill('#............................#'), '##############################']);

type Mode = 'walk' | 'sprint' | 'crouch' | 'knife' | 'jump' | 'strafe-jump-crouch';
function run(mode: Mode, sendMs = 50) {
  const w = new ArenaWorld(OPEN, () => 0.5);
  const f = w.join('a', 'Ann', 0);
  Object.assign(f, { x: 3, y: 5, z: 0, a: 0, vz: 0, grounded: true, weapon: mode === 'knife' ? 'knife' : 'pistol', switchedAt: -1e9 });
  const m: Body & { a: number; sprint?: boolean; weapon?: string } = { x: 3, y: 5, z: 0, vz: 0, grounded: true, crouch: false, a: 0, weapon: f.weapon };
  const hist = new MoveHistory();
  let seq = 0, worst = 0, lastSend = -1e9, kinds = new Set<string>();
  const frame = 1000 / 60;
  for (let t = frame; t <= 3000; t += frame) {
    const crouch = mode === 'crouch' || (mode === 'strafe-jump-crouch' && t > 1500);
    const sprint = mode === 'sprint';
    if (crouch !== m.crouch) { m.crouch = crouch; w.crouch('a', crouch); }
    m.sprint = sprint;
    if ((mode === 'jump' || mode === 'strafe-jump-crouch') && m.grounded && Math.floor(t / 700) !== Math.floor((t - frame) / 700)) { if (tryJump(m)) w.jump('a', Math.round(t)); }
    const side = mode === 'strafe-jump-crouch' ? 0.5 : 0, len = Math.hypot(1, side);
    const sp = speedOf(m) * 0.95 * (LOCAL_STEP_S) / len;
    const steps = Math.round((frame / 1000) / LOCAL_STEP_S);
    for (let i = 0; i < steps; i++) { moveHorizontal(m, (Math.cos(m.a) - Math.sin(m.a) * side) * sp, (Math.sin(m.a) + Math.cos(m.a) * side) * sp, OPEN); stepVertical(m, LOCAL_STEP_S, OPEN); }
    if (t - lastSend >= sendMs) {
      lastSend = t; seq += 1; hist.push(seq, m.x, m.y);
      w.move('a', m.x, m.y, m.a, Math.round(t), 0, crouch, sprint, seq);
      const snap = w.snapshot(Math.round(t)).players[0];
      const r = reconcileMove(hist, snap, m);
      kinds.add(r.kind); worst = Math.max(worst, r.err);
      expect(Math.abs(snap.z - m.z), `z drift at ${t}`).toBeLessThan(0.8);
    }
  }
  return { worst, kinds, dist: m.x - 3 };
}

describe('arena movement prediction + seq reconciliation for every move type', () => {
  for (const mode of ['walk', 'sprint', 'crouch', 'knife', 'jump', 'strafe-jump-crouch'] as Mode[]) {
    it(`${mode}: server accepts the predicted path, no snap or blend corrections`, () => {
      const r = run(mode);
      expect(r.dist).toBeGreaterThan(1);
      expect([...r.kinds]).not.toContain('snap');
      expect([...r.kinds]).not.toContain('blend');
    });
  }
  it('sprint covers more ground than walk, crouch less, knife more', () => {
    const walk = run('walk').dist;
    expect(run('sprint').dist).toBeGreaterThan(walk);
    expect(run('crouch').dist).toBeLessThan(walk);
    expect(run('knife').dist).toBeGreaterThan(walk);
  });
});

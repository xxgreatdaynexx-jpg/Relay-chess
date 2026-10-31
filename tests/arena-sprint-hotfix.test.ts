import { describe, expect, it } from 'vitest';
import { stepFovKick, viewZoom } from '../client/src/lib/arenaInput';
import { ArenaWorld } from '../server/arena-world';
import { gridMap } from '../shared/fps';

/** Runs the client's per-frame sprint view update: kick eases with the sprint flag, gun visibility from viewZoom. */
function frames(kick: number, sprinting: boolean, n: number, dt = 1 / 60, scope = 1) {
  for (let i = 0; i < n; i++) kick = stepFovKick(kick, sprinting, dt);
  return { kick, ...viewZoom(scope, kick) };
}
const sprintUp = () => frames(0, true, 60).kick;

describe('sprint hotfix: the first-person gun always comes back', () => {
  it('regression: the gun is drawn even mid-kick (it used to need zoom === 1 exactly)', () => {
    const k = sprintUp();
    expect(k).toBeGreaterThan(0.9);
    expect(viewZoom(1, k).showGun).toBe(true);
    expect(viewZoom(1, k).zoom).toBeLessThan(1);
    expect(viewZoom(1, 1e-9).showGun).toBe(true);
  });
  // Every way a sprint ends turns the client sprint flag off; the kick must then settle to exactly 0 and the view to 1×.
  for (const exit of ['key release', 'firing', 'crouch', 'stopping', 'direction change', 'weapon switch', 'window blur', 'pointer-lock loss', 'server rejects sprint']) {
    it(`after ${exit}: kick returns to exactly 0, zoom 1, gun shown`, () => {
      const r = frames(sprintUp(), false, 120);
      expect(r.kick).toBe(0);
      expect(r.zoom).toBe(1);
      expect(r.showGun).toBe(true);
    });
  }
  it('after scope: gun hidden only while scoped, back after unscoping', () => {
    const k = sprintUp();
    expect(frames(k, false, 30, 1 / 60, 4).showGun).toBe(false);
    const r = frames(k, false, 120);
    expect(r.showGun).toBe(true);
    expect(r.zoom).toBe(1);
  });
  it('after death and respawn: settles even with huge or bad frame times', () => {
    expect(frames(sprintUp(), false, 1, 5).kick).toBe(0);
    expect(stepFovKick(Number.NaN, false, 1 / 60)).toBe(0);
    expect(viewZoom(1, Number.NaN)).toEqual({ zoom: 1, showGun: true });
    expect(frames(sprintUp(), false, 1, -1).kick).toBeGreaterThan(0); // no negative-dt explosion
    expect(Number.isFinite(frames(sprintUp(), false, 1, -1).zoom)).toBe(true);
  });
});

describe('sprint hotfix: server ends sprint on every exit', () => {
  const OPEN = gridMap(['##############', ...Array(4).fill('#............#'), '##############']);
  const world = () => { const w = new ArenaWorld(OPEN, () => 0.5); const f = w.join('a', 'Ann', 0); Object.assign(f, { x: 3, y: 3, z: 0, a: 0, lastMove: 0, physAt: 0, switchedAt: -1e9 }); return { w, f }; };
  const sprint = (w: ArenaWorld, f: { x: number; y: number }, t: number) => w.move('a', f.x + 0.2, f.y, 0, t, 0, false, true);
  it('key release', () => { const { w, f } = world(); sprint(w, f, 50); expect(f.sprint).toBe(true); w.move('a', f.x + 0.2, f.y, 0, 100, 0, false, false); expect(f.sprint).toBe(false); });
  it('direction change', () => { const { w, f } = world(); sprint(w, f, 50); w.move('a', f.x - 0.2, f.y, 0, 100, 0, false, true); expect(f.sprint).toBe(false); });
  it('firing', () => { const { w, f } = world(); sprint(w, f, 50); w.shoot('a', 0, 60, 0); expect(f.sprint).toBe(false); });
  it('crouch', () => { const { w, f } = world(); sprint(w, f, 50); w.crouch('a', true); expect(f.sprint).toBe(false); });
  it('death and respawn', () => {
    const { w, f } = world(); sprint(w, f, 50);
    Object.assign(f, { alive: false, respawnAt: 0 });
    w.tick(5000);
    expect(f.sprint).toBeFalsy();
  });
});

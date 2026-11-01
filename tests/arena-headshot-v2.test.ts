import { describe, expect, it } from 'vitest';
import { gridMap, WEAPONS, HEAD_Z, CROUCH_HEAD_Z, EYE_HEIGHT, CROUCH_EYE_HEIGHT, HEADSHOT_MULT, HEAD_R, type WeaponId } from '../shared/fps';
import { ArenaWorld, SHOT_Z_TOLERANCE } from '../server/arena-world';
import { headAfterLean, leanHeadCompensation } from '../client/src/lib/soldierPose';
import { headHitFeedback } from '../client/src/lib/arenaHeadFx';

const map = gridMap(['################', '#..............#', '#..............#', '################']);
const GUNS: WeaponId[] = ['pistol', 'smg', 'shotgun', 'sniper', 'ar15'];
type Stance = 'stand' | 'crouch' | 'jump';
const STANCES: Stance[] = ['stand', 'crouch', 'jump'];
const JUMP_Z = 0.45;

function setup(w: WeaponId, ts: Stance, ss: Stance, dist = 6) {
  const world = new ArenaWorld(map, () => 0.5);
  const t0 = 100000;
  const s = world.join('s', 'Shooter', t0, w);
  const t = world.join('t', 'Target', t0, 'pistol');
  // Server copy of a jumping shooter lags the client's arc: server still at z=0 while the client fired from JUMP_Z.
  Object.assign(s, { x: 1.5, y: 1.5, z: 0, a: 0, p: 0, weapon: w, crouch: ss === 'crouch', switchedAt: 0, alive: true });
  Object.assign(t, { x: 1.5 + dist, y: 1.5, z: ts === 'jump' ? JUMP_Z : 0, grounded: ts !== 'jump', crouch: ts === 'crouch', alive: true, hp: 1000 });
  const clientZ = ss === 'jump' ? JUMP_Z : 0;
  const eye = clientZ + (ss === 'crouch' ? CROUCH_EYE_HEIGHT : EYE_HEIGHT);
  const head = t.z + (ts === 'crouch' ? CROUCH_HEAD_Z : HEAD_Z);
  return { world, s, t, p: Math.atan2(head - eye, dist), clientZ, now: t0 + 5000 };
}
const headHit = (ev: Array<{ ev: string; data: unknown }>) => ev.find((e) => e.ev === 'fps_hit')?.data as { dmg: number; head?: boolean } | undefined;

describe('headshots: every gun x target stance x shooter stance', () => {
  for (const w of GUNS) for (const ts of STANCES) for (const ss of STANCES) {
    it(`${w}: target ${ts}, shooter ${ss}`, () => {
      const { world, s, p, clientZ, now } = setup(w, ts, ss);
      if (ss === 'jump') s.vz = 0; // keep the server copy where it is for this shot
      const ev = world.shoot('s', 0, now, p, undefined, undefined, undefined, clientZ);
      const h = headHit(ev);
      expect(h?.head, JSON.stringify(ev.map((e) => e.ev))).toBe(true);
      const spec = WEAPONS[w];
      expect(h!.dmg).toBeGreaterThanOrEqual(Math.round(spec.damage * (spec.headMult ?? HEADSHOT_MULT)) - 1);
    });
  }
  it('root cause: a jumping shooter without its client height shoots over the head', () => {
    const { world, s, p, now } = setup('pistol', 'stand', 'jump');
    s.vz = 0;
    expect(headHit(world.shoot('s', 0, now, p))?.head).not.toBe(true);
  });
  it('client height outside the tolerance is ignored (no free height cheat)', () => {
    const { world, s, now } = setup('pistol', 'stand', 'stand');
    const fakeZ = SHOT_Z_TOLERANCE + 0.5;
    const p = Math.atan2(HEAD_Z - (fakeZ + EYE_HEIGHT), 6);
    expect(s.z).toBe(0);
    expect(headHit(world.shoot('s', 0, now, p, undefined, undefined, undefined, fakeZ))?.head).not.toBe(true);
  });
  for (const w of GUNS) it(`${w}: lag-compensated head on a moving target`, () => {
    const { world, t, p, now } = setup(w, 'stand', 'stand');
    (world as unknown as { history: { record: (...a: unknown[]) => void } }).history.record('t', now - 100, t.x, t.y, 0);
    (world as unknown as { history: { record: (...a: unknown[]) => void } }).history.record('t', now, t.x, t.y + 1.2, 0);
    t.y += 1.2; // server has it 1.2 m to the side now; the shooter saw it 100 ms ago
    expect(headHit(world.shoot('s', 0, now, p, now - 100))?.head).toBe(true);
  });
});

describe('third-person model head stays on the hitbox in every pose', () => {
  const poses: Array<[string, number, number, number]> = [
    ['standing', 0, 0, HEAD_Z], ['running', -0.08, 0.05, HEAD_Z], ['sprinting', -0.22, 0.08, HEAD_Z], ['crouched', -0.12, -0.5, CROUCH_HEAD_Z], ['jumping', 0, 0, HEAD_Z],
  ];
  for (const [name, rot, py, hz] of poses) it(name, () => {
    const h = headAfterLean(rot, leanHeadCompensation(rot), py);
    expect(Math.abs(h.x)).toBeLessThan(1e-9);
    expect(Math.abs(h.y - hz)).toBeLessThan(HEAD_R * 0.6);
    // Before the fix the lean swung the head off the hitbox:
    if (rot) expect(Math.abs(headAfterLean(rot, 0, py).x)).toBeGreaterThan(0.1);
  });
});

describe('headshot indicator is server-authoritative', () => {
  it('server head -> ding + head number; body after predicted head -> body number', () => {
    expect(headHitFeedback({ dmg: 68, head: true }, 1000, -1e9)).toEqual({ v: 68, head: true });
    expect(headHitFeedback({ dmg: 34 }, 1000, 900)).toEqual({ v: 34, head: false });
    expect(headHitFeedback({ dmg: 34 }, 5000, 900)).toBeNull();
  });
});

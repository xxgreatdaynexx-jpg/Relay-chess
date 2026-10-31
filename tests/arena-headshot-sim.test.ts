import { describe, expect, it } from 'vitest';
import { gridMap, WEAPONS, HEAD_Z, CROUCH_HEAD_Z, EYE_HEIGHT, CROUCH_EYE_HEIGHT, HEADSHOT_MULT, type WeaponId } from '../shared/fps';
import { ArenaWorld } from '../server/arena-world';

const map = gridMap(['##############', '#............#', '#............#', '##############']);
const GUNS: WeaponId[] = ['pistol', 'smg', 'shotgun', 'sniper', 'ar15'];

function setup(w: WeaponId, crouch: boolean, shooterCrouch = false, dist = 4) {
  const world = new ArenaWorld(map, () => 0.5);
  const t0 = 100000;
  const s = world.join('s', 'Shooter', t0, w);
  const t = world.join('t', 'Target', t0, 'pistol');
  Object.assign(s, { x: 1.5, y: 1.5, z: 0, a: 0, p: 0, weapon: w, crouch: shooterCrouch, switchedAt: 0, alive: true });
  Object.assign(t, { x: 1.5 + dist, y: 1.5, z: 0, crouch, alive: true, hp: 1000 });
  const eye = shooterCrouch ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
  const head = crouch ? CROUCH_HEAD_Z : HEAD_Z;
  const p = Math.atan2(head - eye, dist);
  return { world, s, t, p, now: t0 + 5000 };
}

describe('server headshot sim: every hitscan gun, standing and crouched', () => {
  for (const w of GUNS) for (const crouch of [false, true]) for (const sc of [false, true]) {
    it(`${w} head (target ${crouch ? 'crouched' : 'standing'}, shooter ${sc ? 'crouched' : 'standing'})`, () => {
      const { world, p, now } = setup(w, crouch, sc);
      const ev = world.shoot('s', 0, now, p);
      const hits = ev.filter((e) => e.ev === 'fps_hit');
      expect(hits.length, JSON.stringify(ev.map((e) => e.ev))).toBeGreaterThan(0);
      const h = hits[0].data as { dmg: number; head?: boolean };
      expect(h.head).toBe(true);
      const spec = WEAPONS[w];
      expect(h.dmg).toBeGreaterThanOrEqual(Math.round(spec.damage * (spec.headMult ?? HEADSHOT_MULT)) - 1);
    });
  }
  it('with lag-comp viewT the head still registers', () => {
    const { world, p, now } = setup('ar15', false);
    const ev = world.shoot('s', 0, now, p, now - 80);
    expect(ev.some((e) => e.ev === 'fps_hit' && (e.data as { head?: boolean }).head)).toBe(true);
  });
});

import { readFileSync } from 'node:fs';
describe('client shot ordering', () => {
  it('applies recoil only after fps_shoot is emitted (shot goes where the crosshair was)', () => {
    const src = readFileSync(new URL('../client/src/components/ArenaPanel.tsx', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('function shoot('), src.indexOf('function shoot(') + 6000);
    const kickDef = body.indexOf('const kick');
    expect(kickDef).toBeGreaterThan(0);
    expect(body.slice(0, kickDef)).not.toMatch(/m\.p\s*=.*recoil/);
    const emit = body.indexOf("socket.emit('fps_shoot', { a: m.a, p: m.p, vt, sid })");
    expect(body.indexOf('kick();', emit)).toBeGreaterThan(emit);
  });
});

import { describe, expect, it } from 'vitest';
import { gridMap, HEAD_Z, CROUCH_HEAD_Z, EYE_HEIGHT, CROUCH_EYE_HEIGHT, MOVE_SPEED, WEAPONS, type WeaponId } from '../shared/fps';
import { SnapBuffer, samplePlayers } from '../shared/netInterp';
import { ArenaWorld } from '../server/arena-world';

const row = '#' + '.'.repeat(40) + '#';
const map = gridMap(['#'.repeat(42), ...Array.from({ length: 20 }, () => row), '#'.repeat(42)]);

/** End-to-end: real server ticks + snapshots, client interp at renderTime, one-way latency each way; shooter aims exactly at the head it sees. */
export function netsim(o: { w: WeaponId; rtt: number; shooterMoves: boolean; targetCrouch: boolean; shooterCrouch: boolean; shots?: number; jitter?: number }) {
  const world = new ArenaWorld(map, () => 0.5);
  const L = o.rtt / 2;
  const T0 = 1_000_000;
  const s = world.join('s', 'S', T0, o.w); const t = world.join('t', 'T', T0, 'pistol');
  Object.assign(s, { x: 5, y: 10, z: 0, a: 0, p: 0, weapon: o.w, switchedAt: 0, alive: true, hp: 1e9 });
  Object.assign(t, { x: 13, y: 10, z: 0, alive: true, hp: 1e9 });
  for (const f of [s, t]) { f.ammo[o.w] = 1e6; f.ammo.pistol = 1e6; }
  const q: Array<{ at: number; fn: () => void }> = [];
  const later = (at: number, fn: () => void) => q.push({ at, fn });
  const buf = new SnapBuffer();
  const sc = { x: 5, y: 10 }, tc = { x: 13, y: 10 };
  let heads = 0, hits = 0, fired = 0, seq = 0, rnd = 1;
  const jit = () => { rnd = (rnd * 16807) % 2147483647; return ((rnd / 2147483647) * (o.jitter ?? 0)); };
  const end = T0 + 600 + (o.shots ?? 20) * 260;
  const spec = WEAPONS[o.w];
  const sp = MOVE_SPEED * (o.targetCrouch ? 0.5 : 1) * 0.97, ssp = MOVE_SPEED * (o.shooterCrouch ? 0.5 : 1) * 0.97;
  for (let now = T0; now < end; now++) {
    const k = (now - T0) / 1000;
    // target strafes side to side (period 1.6 s); shooter strafes the other way
    tc.y = 10 + Math.sin(k * (sp / 1.2)) * 1.2;
    if (o.shooterMoves) sc.y = 10 - Math.sin(k * (ssp / 1.0)) * 1.0;
    if ((now - T0) % 32 === 0) {
      const ty = tc.y, sy = sc.y, sq = ++seq; const d = L + jit();
      later(now + d, () => world.move('t', tc.x, ty, Math.PI, now + d, 0, o.targetCrouch, false, sq));
      later(now + d, () => world.move('s', sc.x, sy, 0, now + d, 0, o.shooterCrouch, false, sq));
    }
    if ((now - T0) % 33 === 0) { world.tick(now); const snap = JSON.parse(JSON.stringify(world.snapshot(now))); later(now + L + jit(), () => buf.push(snap, now + L + 777)); }
    // client clock: recv timestamps are server time + L + 777 (arbitrary offset)
    q.sort((a, b) => a.at - b.at);
    while (q.length && q[0].at <= now) q.shift()!.fn();
    if (now > T0 + 600 && (now - T0) % 260 === 0 && buf.snaps.length > 3) {
      const cnow = now + 777;
      const vt = Math.round(buf.renderTime(cnow));
      const tp = samplePlayers(buf.snaps, vt).players.find((p) => p.id === 't');
      if (!tp) continue;
      const eye = { x: sc.x, y: sc.y, z: o.shooterCrouch ? CROUCH_EYE_HEIGHT : EYE_HEIGHT };
      const hz = tp.z + ((tp as { c?: boolean }).c ? CROUCH_HEAD_Z : HEAD_Z);
      const a = Math.atan2(tp.y - eye.y, tp.x - eye.x), p = Math.atan2(hz - eye.z, Math.hypot(tp.x - eye.x, tp.y - eye.y));
      const shotX = sc.x, shotY = sc.y; const d = L + jit();
      fired++;
      later(now + d, () => {
        const ff = world.fighters.get('s')!; ff.lastShotAt[o.w] = -1e9; ff.meleeReadyAt = -1e9; ff.reloadUntil = 0; ff.sprint = false; ff.sprintEndAt = undefined;
        const ev = world.shoot('s', a, now + d, p, vt, undefined, undefined, 0, shotX, shotY);
        const h = ev.find((e) => e.ev === 'fps_hit')?.data as { head?: boolean } | undefined;
        if (h) { hits++; if (h.head) heads++; }
      });
    }
  }
  q.sort((a, b) => a.at - b.at); for (const e of q) e.fn();
  return { fired, hits, heads, spec };
}

const GUNS: WeaponId[] = ['pistol', 'smg', 'shotgun', 'sniper', 'ar15'];
describe('headshots vs moving targets through the real netcode (latency, interpolation, lag comp)', () => {
  for (const w of GUNS) for (const rtt of [40, 120, 220]) for (const [tc, scr] of [[false, false], [true, false], [false, true], [true, true]] as const) for (const mv of [false, true]) {
    it(`${w} rtt ${rtt} target ${tc ? 'crouch' : 'stand'} shooter ${scr ? 'crouch' : 'stand'}${mv ? ' strafing' : ''}`, () => {
      const r = netsim({ w, rtt, shooterMoves: mv, targetCrouch: tc, shooterCrouch: scr, shots: 12, jitter: 15 });
      expect(r.fired).toBeGreaterThan(8);
      expect(r.heads, JSON.stringify(r)).toBeGreaterThanOrEqual(r.fired - 1);
    });
  }
});

import { SHOT_XY_TOLERANCE } from '../server/arena-world';
import { LAG_COMP_MAX_MS, rewindTime } from '../shared/netInterp';
describe('shot origin x/y + lag-comp window guards', () => {
  const setup = () => {
    const world = new ArenaWorld(map, () => 0.5);
    const s = world.join('s', 'S', 0, 'sniper'); const t = world.join('t', 'T', 0, 'pistol');
    Object.assign(s, { x: 5, y: 10, z: 0, weapon: 'sniper', switchedAt: -1e9, alive: true });
    Object.assign(t, { x: 13, y: 10, z: 0, alive: true, hp: 1e9 });
    s.ammo.sniper = 99; return { world, s };
  };
  const headFrom = (y: number) => Math.atan2(HEAD_Z - EYE_HEIGHT, 8);
  it('uses an in-tolerance client x/y as the ray origin and restores the server position', () => {
    const { world, s } = setup();
    // aimed from y=10.3 so it only hits the head if origin is the claimed one
    const a = Math.atan2(10 - 10.3, 8);
    const ev = world.shoot('s', a, 5000, headFrom(10.3), 5000, undefined, undefined, 0, 5, 10.3);
    expect((ev.find((e) => e.ev === 'fps_hit')?.data as { head?: boolean })?.head).toBe(true);
    expect([s.x, s.y]).toEqual([5, 10]);
  });
  it('ignores a client x/y beyond SHOT_XY_TOLERANCE', () => {
    const { world, s } = setup();
    const y = 10 + SHOT_XY_TOLERANCE + 0.5;
    const ev = world.shoot('s', Math.atan2(10 - y, 8), 5000, headFrom(y), 5000, undefined, undefined, 0, 5, y);
    expect((ev.find((e) => e.ev === 'fps_hit')?.data as { head?: boolean })?.head).not.toBe(true);
    expect([s.x, s.y]).toEqual([5, 10]);
  });
  it('rewinds up to LAG_COMP_MAX_MS (covers ~300 ms ping with 100 ms interp)', () => {
    expect(LAG_COMP_MAX_MS).toBeGreaterThanOrEqual(400);
    expect(rewindTime(10_000, 10_000 - 380)).toBe(10_000 - 380);
    expect(rewindTime(10_000, 10_000 - 5000)).toBe(10_000 - LAG_COMP_MAX_MS);
  });
});

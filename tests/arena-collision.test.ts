import { describe, expect, it } from 'vitest';
import { DUNES, MAPS } from '../shared/arenaMaps.js';
import { canStand, gridMap, moveHorizontal, MOVE_SPEED, stepVertical, tryJump, type ArenaMap, type Body } from '../shared/fps.js';

const body = (x: number, y: number, z = 0): Body => ({ x, y, z, vz: 0, grounded: true });
const walk = (b: Body, a: number, frames: number, map: ArenaMap, jumpAt = -1) => {
  for (let t = 0; t < frames; t++) {
    if (t === jumpAt) tryJump(b);
    moveHorizontal(b, (Math.cos(a) * MOVE_SPEED) / 60, (Math.sin(a) * MOVE_SPEED) / 60, map);
    stepVertical(b, 1 / 60, map);
  }
  return b;
};
// An open room with one 1.0 crate at (5..6, 5..6), a 0.4 step at (10..11, 5..6), and two crates side by side.
const ROOM: ArenaMap = { ...gridMap(Array.from({ length: 16 }, (_, i) => (i === 0 || i === 15 ? '#'.repeat(20) : '#' + '.'.repeat(18) + '#'))) };
ROOM.solids = [...ROOM.solids,
  { x0: 5, y0: 5, x1: 6, y1: 6, z0: 0, z1: 1, mat: 'crate' },
  { x0: 10, y0: 5, x1: 11, y1: 6, z0: 0, z1: 0.4, mat: 'crate' },
  { x0: 13, y0: 9, x1: 14, y1: 10, z0: 0, z1: 1, mat: 'crate' }, { x0: 14, y0: 9, x1: 15, y1: 10, z0: 0, z1: 1, mat: 'crate' },
];

describe('box collision', () => {
  it('slides along a crate face when walking into it at an angle (per-axis, not a dead stop)', () => {
    const b = walk(body(4.5, 4), Math.PI / 4 - 0.3, 90, ROOM); // hits the crate's west face going north-east
    expect(b.y).toBeGreaterThan(6.2);
    expect(canStand(b.x, b.y, b.z, ROOM)).toBe(true);
  });
  it('slides around a crate corner instead of catching on it', () => {
    const b = walk(body(4.78, 3.5), Math.PI / 2, 120, ROOM); // straight north, clipping the crate's corner by 8 cm
    expect(b.y).toBeGreaterThan(5);
  });
  it('walks straight up onto a low step and off the other side', () => {
    const b = walk(body(9, 5.5), 0, 20, ROOM);
    expect(b.z).toBeCloseTo(0.4, 5);
    walk(b, 0, 40, ROOM);
    expect(b.x).toBeGreaterThan(11.5);
    expect(b.z).toBe(0);
  });
  it('a 1.0 crate needs a jump; jumping onto it lands on top, and walking off drops back down', () => {
    expect(walk(body(4, 5.5), 0, 40, ROOM).z).toBe(0);
    const b = walk(body(4.2, 5.5), 0, 16, ROOM, 0);
    for (let t = 0; t < 40; t++) stepVertical(b, 1 / 60, ROOM);
    expect(b.z).toBeCloseTo(1, 5);
    expect(b.grounded).toBe(true);
    walk(b, 0, 60, ROOM);
    expect(b.z).toBe(0);
  });
  it('clipping the lip of a crate on the way down climbs onto it instead of sinking inside (the Dunes bug)', () => {
    const b: Body = { x: 4.69, y: 5.5, z: 0.97, vz: -1, grounded: false };
    moveHorizontal(b, 0.05, 0, ROOM);
    stepVertical(b, 1 / 60, ROOM);
    expect(canStand(b.x, b.y, b.z, ROOM)).toBe(true);
    expect(b.z).toBeCloseTo(1, 5);
  });
  it('never wedges between two touching crates or a crate and a wall', () => {
    const b = walk(body(13.9, 8.5), Math.PI / 2, 60, ROOM); // into the seam between the two crates
    expect(canStand(b.x, b.y, b.z, ROOM)).toBe(true);
    walk(b, 0, 60, ROOM); // slide along the pair's south face
    expect(b.x).toBeGreaterThan(16);
  });
  it('random walking and jumping around every low box on every map never ends up inside geometry', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const map of Object.values(MAPS)) {
      const boxes = map.solids.filter((s) => s.z1 < 3);
      for (let k = 0; k < 600; k++) {
        const s = boxes[k % boxes.length];
        const b = body(s.x0 - 0.8 + rand() * (s.x1 - s.x0 + 1.6), s.y0 - 0.8 + rand() * (s.y1 - s.y0 + 1.6));
        if (!canStand(b.x, b.y, 0, map)) continue;
        let a = rand() * 6.28;
        for (let t = 0; t < 240; t++) {
          if (rand() < 0.05) a = rand() * 6.28;
          if (rand() < 0.03) tryJump(b);
          walk(b, a, 1, map);
          if (!canStand(b.x, b.y, b.z, map)) throw new Error(`${map.id}: inside geometry at ${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)}`);
        }
      }
    }
  });
  it('Dunes A-plateau crates sit on the plateau, not buried in it', () => {
    for (const c of DUNES.solids.filter((s) => s.mat === 'crate' && s.x0 >= 30 && s.y1 <= 12)) expect(c.z0).toBeGreaterThanOrEqual(1.6);
  });
});

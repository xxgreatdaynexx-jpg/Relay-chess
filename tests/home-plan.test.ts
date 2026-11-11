import { describe, expect, it } from 'vitest';
import { FURNITURE, fits, validateLayout, HOME_TYPES, GRID_W, GRID_D } from '../shared/homes';
import {
  HOME_PLAN_TYPES, clampInPlan, fitsPlan, frontDoor, homePlan, hitsInteriorWall, itemRoom,
  migrateItems, roomAt, spawnPos, wallSegments,
} from '../shared/homePlan';

describe('home floor plans', () => {
  it('covers every residential type with a packed plan at least 12×10', () => {
    expect([...HOME_TYPES].sort().join()).toBe([...HOME_PLAN_TYPES].sort().join());
    for (const t of HOME_PLAN_TYPES) {
      const p = homePlan(t);
      expect(p.w).toBeGreaterThanOrEqual(GRID_W);
      expect(p.d).toBeGreaterThanOrEqual(GRID_D);
      expect(p.rooms.reduce((s, r) => s + r.w * r.d, 0)).toBe(p.w * p.d);
      expect(p.rooms.length).toBeGreaterThanOrEqual(t === 'house' ? 5 : 4);
      expect(p.doors.length).toBeGreaterThanOrEqual(p.rooms.length - 1);
      expect(p.windows.length).toBeGreaterThan(0);
      expect(wallSegments(p).length).toBeGreaterThan(p.rooms.length);
      const fd = frontDoor(p);
      expect(fd.z).toBe(p.d);
      const sp = spawnPos(p);
      expect(roomAt(p, Math.floor(sp.x), Math.floor(sp.z))).toBeTruthy();
      expect(hitsInteriorWall(p, sp.x, sp.z)).toBe(false);
    }
  });

  it('grows footprint and room count with the house type', () => {
    const house = homePlan('house');
    const villa = homePlan('villa');
    const penthouse = homePlan('penthouse');
    const mansion = homePlan('mansion');
    expect(house.w * house.d).toBe(12 * 10);
    expect(house.rooms.length).toBe(5);
    expect(villa.w * villa.d).toBeGreaterThan(house.w * house.d);
    expect(villa.rooms.length).toBeGreaterThan(house.rooms.length);
    expect(penthouse.rooms.some((r) => r.id === 'office')).toBe(true);
    expect(penthouse.rooms.length).toBeGreaterThan(villa.rooms.length);
    expect(mansion.w * mansion.d).toBeGreaterThan(penthouse.w * penthouse.d);
    expect(mansion.rooms.length).toBeGreaterThanOrEqual(11);
    expect(mansion.rooms.some((r) => /bed/i.test(r.id))).toBe(true);
    expect(mansion.rooms.some((r) => r.id === 'library')).toBe(true);
  });

  it('keeps furniture inside a single room and remaps straddling pieces without dropping them', () => {
    const packed = [
      { uid: 'a', f: 'sofa', x: 0, z: 0, r: 0 },
      { uid: 'b', f: 'stool', x: 6, z: 5, r: 0 },
      { uid: 'c', f: 'kingbed', x: 3, z: 6, r: 0 },
      { uid: 'd', f: 'tuliptable', x: 10, z: 8, r: 0 },
      { uid: 'e', f: 'fridge', x: 8, z: 1, r: 0 },
      { uid: 'f', f: 'rug', x: 1, z: 2, r: 0 },
    ];
    for (const t of HOME_PLAN_TYPES) {
      const plan = homePlan(t);
      const moved = migrateItems(t, packed);
      expect(moved.map((i) => i.uid).sort().join()).toBe(packed.map((i) => i.uid).sort().join());
      for (const it of moved) {
        expect(fitsPlan(plan, moved, it, it.uid)).toBe(true);
        expect(itemRoom(plan, it)).toBeTruthy();
      }
    }
  });

  it('rejects placements that cross a wall when a plan is supplied, and leaves bare 12×10 fits alone', () => {
    const sofa = { uid: 's', f: 'sofa', x: 0, z: 0, r: 0 };
    expect(fits([], sofa)).toBe(true);
    expect(fits([], { uid: 't', f: 'tuliptable', x: 10, z: 8, r: 0 })).toBe(true);
    const house = homePlan('house');
    const size = { w: house.w, d: house.d, inRoom: (p: typeof sofa) => !!itemRoom(house, p) };
    expect(fits([], sofa, undefined, size)).toBe(true);
    // sofa is 3 wide; sitting on the living/kitchen seam at x=6 would cover x=6,7,8 — two rooms
    expect(fits([], { ...sofa, x: 6 }, undefined, size)).toBe(false);
    const v = validateLayout({ wall: 'plaster', floor: 'laminate', items: [sofa] }, new Map([['sofa', 1]]), () => false, size);
    expect(v.ok).toBe(true);
  });

  it('lets an avatar walk through a doorway but not a wall', () => {
    const plan = homePlan('house');
    // living (0,0 7x6) shares z=6 with the hall (0,6 3x4); door is mid-edge
    const door = plan.doors.find((d) => d.dir === 'z' && d.z === 6 && d.x < 3);
    expect(door).toBeTruthy();
    expect(hitsInteriorWall(plan, door!.x, door!.z)).toBe(false);
    expect(hitsInteriorWall(plan, 5, 6)).toBe(true); // solid wall between living and bedroom
    const blocked = clampInPlan(plan, 5, 6);
    expect(blocked.z === 6 && blocked.x === 5).toBe(false);
    const open = clampInPlan(plan, door!.x, door!.z);
    expect(Math.abs(open.x - door!.x)).toBeLessThan(0.01);
  });

  it('lists every shop item so migration can resolve a real catalogue id', () => {
    expect(FURNITURE.some((f) => f.id === 'sofa')).toBe(true);
    expect(FURNITURE.some((f) => f.id === 'kingbed')).toBe(true);
  });
});

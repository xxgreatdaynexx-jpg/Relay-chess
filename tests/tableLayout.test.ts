import { describe, expect, it } from 'vitest';
import { bjSeatPositions, blindSeats, chipStack, dealOffset, fitTable, ovalSeatPositions, tableAspect, towardCentre } from '../client/src/lib/tableLayout';

const inBox = (p: { x: number; y: number }) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;

describe('table layout', () => {
  it('blackjack seats sit on the lower arc, inside the table, right to left', () => {
    const ps = bjSeatPositions(5);
    expect(ps).toHaveLength(5);
    ps.forEach((p) => { expect(inBox(p)).toBe(true); expect(p.y).toBeGreaterThan(35); });
    for (let i = 1; i < 5; i++) expect(ps[i]!.x).toBeLessThan(ps[i - 1]!.x);
    expect(ps[2]!.x).toBeCloseTo(50, 5);
    expect(ps[2]!.y).toBeGreaterThan(ps[0]!.y); // middle seat is lowest
    expect(bjSeatPositions(1)[0]!.x).toBeCloseTo(50);
    expect(bjSeatPositions(0)).toEqual([]);
  });
  it('hold\'em seats spread round the oval without overlapping', () => {
    const ps = ovalSeatPositions(6);
    ps.forEach((p) => expect(inBox(p)).toBe(true));
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) expect(Math.hypot(ps[i]!.x - ps[j]!.x, ps[i]!.y - ps[j]!.y)).toBeGreaterThan(25);
    expect(ps[0]!.y).toBeGreaterThan(50); // seat 0 at the bottom
  });
  it('bet spots move toward the centre', () => {
    expect(towardCentre({ x: 10, y: 90 }, 0.5)).toEqual({ x: 30, y: 70 });
  });
  it('deal offset converts y by aspect', () => {
    expect(dealOffset({ x: 80, y: 10 }, { x: 50, y: 70 }, 1.5)).toEqual({ dx: 30, dy: -40 });
  });
  it('fitTable never exceeds the window and keeps aspect', () => {
    for (const [w, h] of [[400, 800], [400, 200], [1920, 1000], [1920, 400]] as const) {
      const a = tableAspect(w, 'he');
      const f = fitTable(w, h, a);
      expect(f.w).toBeLessThanOrEqual(w);
      if (h * a >= 280) expect(f.h).toBeLessThanOrEqual(h + 1);
      expect(f.w / f.h).toBeCloseTo(a, 1);
    }
  });
  it('aspect gets taller on narrow windows', () => {
    expect(tableAspect(400, 'bj')).toBeLessThan(tableAspect(1400, 'bj'));
    expect(tableAspect(400, 'he')).toBeLessThan(tableAspect(1400, 'he'));
  });
  it('blind seats match the server rule', () => {
    const s = (b: boolean) => ({ inHand: b });
    expect(blindSeats([s(true), null, s(true), s(true), null, null], 0)).toEqual({ sb: 2, bb: 3 });
    expect(blindSeats([s(true), null, s(true), s(true), null, null], 3)).toEqual({ sb: 0, bb: 2 });
    expect(blindSeats([s(true), null, s(true), null, null, null], 2)).toEqual({ sb: 2, bb: 0 }); // heads-up
    expect(blindSeats([s(true), null, null, null, null, null], 0)).toBeNull();
    expect(blindSeats([s(true), s(false), s(true), null, null, null], 0)).toEqual({ sb: 0, bb: 2 });
  });
  it('chip stack breaks amounts into denominations', () => {
    expect(chipStack(630)).toEqual([500, 100, 25, 5]);
    expect(chipStack(0)).toEqual([]);
    expect(chipStack(99999).length).toBe(8);
  });
});

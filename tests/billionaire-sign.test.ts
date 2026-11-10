import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BILLIONAIRE_SIGN, BILLIONAIRE_SIGN_POS, BILLIONAIRE_SIGN_RADIUS } from '../shared/billionaireUpdate';
import { outskirts, inLake, mapRoadSegments } from '../shared/outskirts';
import { farmPlots } from '../shared/farm';
import { bigFarms } from '../shared/bigFarms';
import { AIRPORT, AIRPORT_SLOT, AIRPORT_ROADS, RUNWAY } from '../shared/venues';
import { CHANGELOG } from '../shared/changelog';

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const [cx, cz] = BILLIONAIRE_SIGN_POS;
const rad = BILLIONAIRE_SIGN_RADIUS;

const segD = (x: number, z: number, a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L));
  return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
};
const distAABB = (x: number, z: number, x0: number, x1: number, z0: number, z1: number) => {
  const px = Math.max(x0, Math.min(x, x1)), pz = Math.max(z0, Math.min(z, z1));
  return Math.hypot(x - px, z - pz);
};

describe('Billionaire Update coming-soon sign', () => {
  it('is a gold billboard that says Coming soon, with no date or feature list', () => {
    const w = src('client/src/lib/world3d.ts');
    expect(w).toMatch(/fillText\('Billionaire Update'/);
    expect(w).toMatch(/C O M I N G {3}S O O N/);
    expect(w).not.toMatch(/O U T {3}N O W/);
    expect(w).not.toMatch(/open-launch-popup/);
    expect(w).toContain(`ms.name = ${'BILLIONAIRE_SIGN'}`);
    expect(w).not.toMatch(/fillText\('Billionaire Update'.*\d{1,2} [A-Z][a-z]{2}/s);
    expect(w).not.toMatch(/BILLIONAIRE_SIGN.*open-launch-popup|open-launch-popup.*BILLIONAIRE_SIGN/s);
    expect(CHANGELOG[0]!.title).toBe('Billionaire Update coming soon');
    expect(CHANGELOG[0]!.bullets.join(' ')).not.toMatch(/yacht|voyage|landmark|sink|boarding|combat/i);
    expect(src('client/src/components/WorldMap.tsx')).toMatch(/Coming soon/);
    expect(BILLIONAIRE_SIGN).toBe('billionaire-sign');
  });

  it('stands on clear ground off roads, farms, buildings, hills and water', () => {
    expect(cx).toBeGreaterThan(AIRPORT.x0); expect(cx).toBeLessThan(AIRPORT.x1);
    expect(cz).toBeGreaterThan(AIRPORT.z0); expect(cz).toBeLessThan(AIRPORT.z1);
    expect(inLake(cx, cz, rad)).toBe(false);
    const O = outskirts();
    for (const [x, z, r] of O.hills) expect(Math.hypot(cx - x, cz - z), `hill ${x},${z}`).toBeGreaterThanOrEqual(rad + r);
    for (const b of [...O.buildings, ...O.fields]) {
      expect(distAABB(cx, cz, b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2), 'decor').toBeGreaterThanOrEqual(rad);
    }
    for (const p of farmPlots()) {
      expect(distAABB(cx, cz, p.x - p.w / 2, p.x + p.w / 2, p.z - p.d / 2, p.z + p.d / 2), `farm ${p.n}`).toBeGreaterThanOrEqual(rad);
    }
    for (const p of bigFarms()) {
      expect(distAABB(cx, cz, p.lot.x0, p.lot.x1, p.lot.z0, p.lot.z1), `cf:${p.n}`).toBeGreaterThanOrEqual(rad);
    }
    for (const [a, b, w] of [...mapRoadSegments(), ...AIRPORT_ROADS]) {
      expect(segD(cx, cz, a, b), `road ${a} ${b}`).toBeGreaterThanOrEqual(w / 2 + rad);
    }
    expect(distAABB(cx, cz, RUNWAY.x - RUNWAY.w / 2, RUNWAY.x + RUNWAY.w / 2, RUNWAY.z0, RUNWAY.z1)).toBeGreaterThanOrEqual(rad);
    const apron = distAABB(cx, cz, AIRPORT_SLOT[0] - 6 - 17, AIRPORT_SLOT[0] - 6 + 17, AIRPORT_SLOT[1] - 15, AIRPORT_SLOT[1] + 15);
    expect(apron).toBeGreaterThanOrEqual(rad);
  });
});

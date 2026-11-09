import { describe, expect, it } from 'vitest';
import {
  HAUL_MAX_VISIBLE, HAUL_OFF_KEY, buildHaul, farmHaulSite, haulDurationMs, haulPose, haulSiteXZ, pathLength, roadPath,
} from '../shared/haulVisual';
import { emitHaul, haulLive } from '../server/haulVisual';

describe('haul visual (pt2101u queue #6)', () => {
  it('resolves job sites and destinations (workers start at mine/dock, not Employment Office)', () => {
    const mine = haulSiteXZ('mine:mine'); const frost = haulSiteXZ('mine:frost');
    const quarry = haulSiteXZ('mine:quarry'); const dock = haulSiteXZ('dock');
    const employ = haulSiteXZ('employ'); const wh = haulSiteXZ('warehouse');
    expect(mine && frost && quarry && dock && wh).toBeTruthy();
    expect(employ).toBeTruthy();
    // Worker ore path must not start at employ
    const h = buildHaul('Dayne', 'mine:magma', 'warehouse', 'worker-ore', 1_000);
    expect(h).toBeTruthy();
    expect(h!.from[0]).not.toBeCloseTo(employ![0], 0);
    expect(h!.from[1]).not.toBeCloseTo(employ![1], 0);
    // Pantry harvests go to warehouse (map pool), not factory
    expect(farmHaulSite('f:3')).toBe('farm:f:3');
    const pantry = buildHaul('Dayne', 'farm:f:1', 'warehouse', 'farm-pantry', 2_000);
    expect(pantry).toBeTruthy();
    expect(haulSiteXZ('factory')).not.toEqual(pantry!.to);
  });

  it('builds a road path with positive length and pose interpolation', () => {
    const from = haulSiteXZ('factory')!; const to = haulSiteXZ('market')!;
    const path = roadPath(from, to);
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(pathLength(path)).toBeGreaterThan(10);
    const dur = haulDurationMs(path);
    expect(dur).toBeGreaterThanOrEqual(4000);
    const e = buildHaul('Amber', 'factory', 'market', 'factory-sell', 10_000)!;
    const mid = haulPose(e, e.departAt + (e.arriveAt - e.departAt) / 2);
    expect(mid.done).toBe(false);
    expect(Number.isFinite(mid.x + mid.z + mid.a)).toBe(true);
    expect(haulPose(e, e.arriveAt + 1).done).toBe(true);
  });

  it('rate-limits and caps concurrent cosmetic hauls; skips unknown/cross-map', () => {
    expect(buildHaul('X', 'farm:rf:1', 'warehouse', 'farm-pantry')).toBeNull();
    const now0 = Date.now() + 50_000; // far from other tests' clocks
    // Same route within merge window → one live truck
    for (let i = 0; i < 8; i++) emitHaul({ name: 'BurstPlayer', from: 'factory', to: 'market', kind: 'factory-sell', now: now0 + i });
    expect(haulLive().filter((e) => e.name === 'BurstPlayer').length).toBeLessThanOrEqual(1);
    // Spread past merge window + per-player/min cap
    for (let i = 0; i < 40; i++) {
      emitHaul({ name: 'CapPlayer', from: 'factory', to: 'warehouse', kind: 'warehouse', now: now0 + 10_000 + i * 3_000 });
    }
    expect(haulLive().length).toBeLessThanOrEqual(HAUL_MAX_VISIBLE);
    expect(HAUL_OFF_KEY).toBe('chud-haul-trucks-off');
  });

  it('is wired into the city map and announced as cosmetic-only', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const panel = fs.readFileSync('client/src/components/WorldMap.tsx', 'utf8');
    const haul = fs.readFileSync('client/src/lib/worldHaul.ts', 'utf8');
    const clog = fs.readFileSync('shared/changelog.ts', 'utf8');
    expect(panel).toMatch(/createHaul|worldHaul/);
    expect(panel).toMatch(/world-haul-toggle|chud-haul-trucks-off/);
    expect(haul).toMatch(/haul_visual/);
    expect(clog).toMatch(/delivery trucks|haul trucks|cosmetic/i);
  });
});

import { describe, expect, it } from 'vitest';
import {
  HAUL_MAX_VISIBLE, HAUL_MIN_MS, HAUL_MAX_MS, HAUL_SPEED, HAUL_OFF_KEY, buildHaul, farmHaulSite, haulDurationMs, haulPose, haulSiteXZ, pathLength, roadPath,
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
    expect(h!.hub).toBe('city');
    // Pantry harvests go to warehouse (map pool), not factory — from the specific city plot
    expect(farmHaulSite('f:3')).toBe('farm:f:3');
    const pantry = buildHaul('Dayne', 'farm:f:1', 'warehouse', 'farm-pantry', 2_000);
    expect(pantry).toBeTruthy();
    expect(haulSiteXZ('factory')).not.toEqual(pantry!.to);
    expect(pantry!.from).toEqual(haulSiteXZ('farm:f:1'));
    // Countryside / Big Farm plots use their real field coords (not a shared east-district proxy)
    const cf5 = haulSiteXZ('farm:cf:5')!; const cf1000 = haulSiteXZ('farm:cf:1000')!;
    expect(cf5).not.toEqual(cf1000);
    const country = buildHaul('Dayne', 'farm:cf:5', 'warehouse', 'farm-pantry', 3_000)!;
    expect(country.from).toEqual(cf5); expect(country.hub).toBe('city');
    // Resort plantation → Resort Warehouse on the resort hub
    const rf = buildHaul('Dayne', 'farm:rf:1', 'resort', 'farm-pantry', 4_000)!;
    expect(rf.from).toEqual(haulSiteXZ('farm:rf:1'));
    expect(rf.to).toEqual(haulSiteXZ('resort'));
    expect(rf.hub).toBe('resort');
    const factory = buildHaul('Dayne', 'farm:f:7', 'factory', 'farm-factory', 5_000)!;
    expect(factory.from).toEqual(haulSiteXZ('farm:f:7'));
    const sell = buildHaul('Dayne', 'farm:cf:1000', 'market', 'farm-sell', 6_000)!;
    expect(sell.from).toEqual(haulSiteXZ('farm:cf:1000'));
    expect(buildHaul('X', 'farm:rf:1', 'warehouse', 'farm-pantry')).toBeNull();
  });

  it('builds a road path with positive length and pose interpolation', () => {
    const from = haulSiteXZ('factory')!; const to = haulSiteXZ('market')!;
    const path = roadPath(from, to);
    expect(path.length).toBeGreaterThan(3); // follows city roads, not a 2-point straight line
    expect(pathLength(path)).toBeGreaterThan(Math.hypot(from[0] - to[0], from[1] - to[1]) * 1.15);
    const dur = haulDurationMs(path);
    expect(HAUL_SPEED).toBe(14);
    expect(HAUL_MAX_MS).toBe(90_000);
    expect(dur).toBeGreaterThanOrEqual(HAUL_MIN_MS);
    expect(dur).toBeLessThanOrEqual(HAUL_MAX_MS);
    // Mine → warehouse uses roads (was previously a near-straight 3-pt fallback)
    const mine = haulSiteXZ('mine:mine')!; const wh = haulSiteXZ('warehouse')!;
    const minePath = roadPath(mine, wh);
    expect(minePath.length).toBeGreaterThan(5);
    expect(pathLength(minePath)).toBeGreaterThan(Math.hypot(mine[0] - wh[0], mine[1] - wh[1]) * 1.1);
    const e = buildHaul('Amber', 'factory', 'market', 'factory-sell', 10_000)!;
    const mid = haulPose(e, e.departAt + (e.arriveAt - e.departAt) / 2);
    expect(mid.done).toBe(false);
    expect(Number.isFinite(mid.x + mid.z + mid.a)).toBe(true);
    expect(haulPose(e, e.arriveAt + 1).done).toBe(true);
    // Facing follows the current segment
    const early = haulPose(e, e.departAt + 1);
    expect(Math.abs(early.a)).toBeGreaterThan(0);
  });

  it('rate-limits and caps concurrent cosmetic hauls; skips unknown/cross-map', () => {
    expect(buildHaul('X', 'farm:rf:99', 'resort', 'farm-pantry')).toBeNull();
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

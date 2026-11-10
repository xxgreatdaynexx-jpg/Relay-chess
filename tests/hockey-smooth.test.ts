import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HockeyGame, interpolateHockey, HK_INTERP_MS, HK_EXTRAP_MS, HK_TICK_HZ, type HkSnapshot } from '../shared/hockey';
import { HAUL_MAX_VISIBLE, haulPose, type HaulEvent } from '../shared/haulVisual';
import { expectChangelogEntry } from './helpers/changelog';

const snap = (over: Partial<HkSnapshot['pk']> & { px?: number; py?: number } = {}): HkSnapshot => {
  const g = new HockeyGame();
  const s = g.snapshot();
  const pk = { ...s.pk, ...over };
  if (over.px != null) pk.x = over.px;
  if (over.py != null) pk.y = over.py;
  return { ...s, pk };
};

describe('hockey interpolation', () => {
  it('lerps the puck halfway between two snapshots at the 100 ms buffer', () => {
    const a = snap({ px: 0, py: 0, vx: 10, vy: 0 });
    const b = snap({ px: 2, py: 0, vx: 10, vy: 0 });
    const now = 1000;
    const f = interpolateHockey([{ t: now - HK_INTERP_MS - 50, s: a }, { t: now - HK_INTERP_MS + 50, s: b }], null, now);
    expect(f).toBeTruthy();
    expect(f!.puck.x).toBeCloseTo(1, 5);
    expect(f!.puck.y).toBeCloseTo(0, 5);
  });

  it('does not smear a faceoff reset across the ice', () => {
    const a = snap({ px: 20, py: 5, vx: 8, vy: 0 });
    const b = snap({ px: 0, py: 0, vx: 0, vy: 0 }); // jump > 6
    const now = 1000;
    const f = interpolateHockey([{ t: now - HK_INTERP_MS - 20, s: a }, { t: now - HK_INTERP_MS + 20, s: b }], null, now);
    expect(f!.puck.x).toBe(0);
    expect(f!.puck.y).toBe(0);
  });

  it('extrapolates with velocity past the latest snapshot, capped', () => {
    const s = snap({ px: 0, py: 0, vx: 20, vy: 0 });
    const t = 500;
    // render time is `now - INTERP`, so to be `lateMs` past the snapshot, now = t + INTERP + lateMs
    const late = HK_EXTRAP_MS; // at the cap
    const f = interpolateHockey([{ t, s }], null, t + HK_INTERP_MS + late);
    expect(f!.puck.x).toBeCloseTo(20 * (HK_EXTRAP_MS / 1000), 5);
    const over = interpolateHockey([{ t, s }], null, t + HK_INTERP_MS + late + 200);
    expect(over!.puck.x).toBeCloseTo(f!.puck.x, 5); // capped, not a further 200 ms
  });
});

describe('hockey pause + changelog', () => {
  it('the hockey tab pauses the city, and the panel uses shared interpolation', () => {
    const src = readFileSync('client/src/components/HockeyPanel.tsx', 'utf8');
    expect(src).toMatch(/data-testid="hockey-tab"[^>]*data-pause-city/);
    expect(src).toContain('interpolateHockey');
    const wm = readFileSync('client/src/components/WorldMap.tsx', 'utf8');
    expect(wm).toContain('fullScreenGameOpen');
    expect(wm).toMatch(/haulRef\.current\?\.setRunning/);
  });
  it('records smoother play in the changelog', () => {
    expectChangelogEntry(/Hockey: smoother play/, { from: '2026-11-09T00:00:00-06:00', to: '2026-11-10T00:00:00-06:00' });
  });
});

describe('headless cost (tick, snapshot, trucks)', () => {
  it('10 seconds of a bot-filled match ticks and snapshots cheaply', () => {
    const g = new HockeyGame();
    g.join('h1', 'Skater');
    const ticks = HK_TICK_HZ * 10;
    const t0 = performance.now();
    let bytes = 0;
    for (let i = 0; i < ticks; i++) {
      g.tick();
      bytes += JSON.stringify(g.snapshot()).length;
    }
    const ms = performance.now() - t0;
    const avg = bytes / ticks;
    // eslint-disable-next-line no-console
    console.log(`[hockey-perf] ${ticks} ticks+snapshots in ${ms.toFixed(1)}ms (avg snap ${avg.toFixed(0)} bytes)`);
    expect(ms).toBeLessThan(500);
    expect(avg).toBeLessThan(8_000);
  });

  it('posing 50 haul trucks for a second of 20 Hz updates is cheap', () => {
    const trucks: HaulEvent[] = Array.from({ length: HAUL_MAX_VISIBLE }, (_, i) => {
      const path: Array<[number, number]> = [];
      for (let k = 0; k < 40; k++) path.push([k * 8, (i % 7) * 12]);
      return { id: `h${i}`, name: `P${i}`, from: path[0]!, to: path[path.length - 1]!, path, departAt: 0, arriveAt: 60_000, kind: 'warehouse', hub: 'city' };
    });
    const t0 = performance.now();
    let n = 0;
    for (let t = 0; t < 1000; t += 50) for (const e of trucks) { haulPose(e, t); n++; }
    const ms = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[haul-perf] ${n} poses (50 trucks × 20 Hz × 1s) in ${ms.toFixed(2)}ms`);
    expect(ms).toBeLessThan(50);
  });
});

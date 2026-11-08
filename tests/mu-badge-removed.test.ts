// Dayne 2026-11-07 07:23 UTC-6: the gold rounded 2D map badge "💰 Millionaire Update: soon" is gone entirely (not
// replaced), on desktop and mobile; the weekly event label stays. The 3D billboard was removed later (19:39).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
describe('map: outdated Millionaire badge removed', () => {
  it('WorldMap renders no countdown badge and css has no rule for it (desktop and the <=480px mobile rule)', () => {
    const map = src('client/src/components/WorldMap.tsx'); const css = src('client/src/index.css');
    expect(map).not.toMatch(/mu-countdown|world-mu-count|MuCountdown|mapCountdownLabel/);
    expect(css).not.toMatch(/world-mu-count/);
  });
  it('the 3D Millionaire Update billboard and its click target are gone (Dayne 2026-11-07 19:39); weekly event bar stays', () => {
    const w = src('client/src/lib/world3d.ts');
    expect(w).not.toMatch(/O U T   N O W|MILLIONAIRE_SIGN|millionaire-sign|signHit|fillText\('Millionaire Update'/);
    expect(src('client/src/components/WorldMap.tsx')).toMatch(/<WeeklyEventBar /);
  });
});

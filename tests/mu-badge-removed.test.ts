// Dayne 2026-11-07 07:23 UTC-6: the gold rounded 2D map badge "💰 Millionaire Update: soon" is gone entirely (not
// replaced), on desktop and mobile; the 3D OUT NOW billboard and the weekly event label stay.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
describe('map: outdated Millionaire badge removed', () => {
  it('WorldMap renders no countdown badge and css has no rule for it (desktop and the <=480px mobile rule)', () => {
    const map = src('client/src/components/WorldMap.tsx'); const css = src('client/src/index.css');
    expect(map).not.toMatch(/mu-countdown|world-mu-count|MuCountdown|mapCountdownLabel/);
    expect(css).not.toMatch(/world-mu-count/);
  });
  it('keeps the 3D OUT NOW billboard and the weekly event bar', () => {
    expect(src('client/src/lib/world3d.ts')).toContain("fillText('O U T   N O W'");
    expect(src('client/src/components/WorldMap.tsx')).toMatch(/<WeeklyEventBar /);
  });
});

import { describe, expect, it, beforeEach } from 'vitest';
import {
  classifyLaunch, makeLaunchShow, parseLaunchShow, showActive, showPose, hash01,
  SHOW_COUNTDOWN_MS, SHOW_END_MS, SHOW_FLIGHT_S, SHOW_MAX_ACTIVE,
} from '../shared/spaceLaunchShow';
import { courierI, scoutI, goliathHeavy } from '../shared/spaceParts';
import { admitShow, activeShows, _resetShows } from '../server/spaceProgram';
import { cleanSettings, DEFAULT_SETTINGS } from '../shared/settings';

describe('launch show (public city broadcast)', () => {
  beforeEach(() => _resetShows());

  it('classifies size and boosters from the design', () => {
    expect(classifyLaunch(goliathHeavy())).toEqual({ size: 'heavy', boosters: true });
    expect(classifyLaunch(scoutI()).size).toBe('small');
    expect(['small', 'medium']).toContain(classifyLaunch(courierI()).size);
    expect(classifyLaunch(courierI()).boosters).toBe(false);
  });

  it('builds a small payload with liftoff after the pad countdown', () => {
    const s = makeLaunchShow('L1', '  Vega  ', goliathHeavy(), 1_000_000);
    expect(s).toEqual({ id: 'L1', player: 'Vega', design: 'Goliath Heavy', size: 'heavy', boosters: true, at: 1_000_000 + SHOW_COUNTDOWN_MS });
    expect(JSON.stringify(s).length).toBeLessThan(160);
  });

  it('parses strictly and strips markup from names', () => {
    expect(parseLaunchShow(null)).toBeNull();
    expect(parseLaunchShow({ id: 'x', size: 'huge', at: 1 })).toBeNull();
    expect(parseLaunchShow({ id: 'x', size: 'small', at: Number.NaN })).toBeNull();
    const p = parseLaunchShow({ id: 'x', player: '<b>Eve</b>', design: 'A'.repeat(99), size: 'medium', boosters: 'yes', at: 5 });
    expect(p).toMatchObject({ player: 'bEve/b', size: 'medium', boosters: false, at: 5 });
    expect(p!.design.length).toBe(40);
  });

  it('flies a deterministic gravity turn: up first, pitching over, out of sight by the end', () => {
    for (const size of ['small', 'medium', 'heavy'] as const) {
      expect(showPose(size, -2)).toMatchObject({ down: 0, up: 0, burning: false });
      const a = showPose(size, 4), b = showPose(size, 20), c = showPose(size, 45), d = showPose(size, SHOW_FLIGHT_S);
      expect(a.pitch).toBe(0);
      expect(a.down).toBeCloseTo(0, 5);
      expect(b.up).toBeGreaterThan(a.up);
      expect(c.pitch).toBeGreaterThan(b.pitch);
      expect(c.pitch).toBeLessThan(Math.PI / 2);
      expect(d.down).toBeGreaterThan(1_500);
      expect(d.up).toBeGreaterThan(1_500);
      expect(showPose(size, 17.3)).toEqual(showPose(size, 17.3));
    }
    // Heavier rockets climb more slowly off the pad.
    expect(showPose('heavy', 10).up).toBeLessThan(showPose('small', 10).up);
  });

  it('is active from the countdown through the lingering trail', () => {
    const s = makeLaunchShow('L2', 'Vega', courierI(), 0);
    expect(showActive(s, -1)).toBe(false);
    expect(showActive(s, 0)).toBe(true);
    expect(showActive(s, s.at + 30_000)).toBe(true);
    expect(showActive(s, s.at + SHOW_END_MS)).toBe(false);
  });

  it('hash01 is stable and in [0, 1)', () => {
    const v = hash01('abc', 3);
    expect(v).toBe(hash01('abc', 3));
    expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1);
    expect(hash01('abc', 4)).not.toBe(v);
  });

  it('server admits real launches, skips QA accounts, and caps shows in the sky', () => {
    const t = 50_000_000;
    expect(admitShow('q', 'qa-bot', courierI(), t)).toBeNull();
    for (let i = 0; i < SHOW_MAX_ACTIVE; i++) expect(admitShow(`L${i}`, `Pilot${i}`, courierI(), t + i)).not.toBeNull();
    expect(admitShow('over', 'Late', courierI(), t + 10)).toBeNull();
    expect(activeShows(t + 10)).toHaveLength(SHOW_MAX_ACTIVE);
    // Once they have flown, the sky is free again and old shows are pruned.
    const later = t + SHOW_COUNTDOWN_MS + SHOW_END_MS + 100;
    expect(activeShows(later)).toHaveLength(0);
    expect(admitShow('next', 'Vega', goliathHeavy(), later)).toMatchObject({ player: 'Vega', size: 'heavy' });
  });

  it('launch visuals are on by default and the setting round-trips', () => {
    expect(DEFAULT_SETTINGS.launchFx).toBe(true);
    expect(cleanSettings({}).launchFx).toBe(true);
    expect(cleanSettings({ launchFx: false }).launchFx).toBe(false);
    expect(cleanSettings({ launchFx: 'no' }).launchFx).toBe(true);
  });
});

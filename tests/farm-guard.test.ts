import { describe, expect, it, beforeEach } from 'vitest';
import { checkFarmAction, resetFarmGuardForTest, FARM_RATE_MSG, FARM_CLOCKWORK_MSG } from '../server/farmGuard';

describe('farm anti-bot guard', () => {
  beforeEach(() => resetFarmGuardForTest());

  it('allows a normal plant then rate-limits a fast follow-up', () => {
    const t0 = Date.parse('2026-11-05T18:00:00Z'); // awake
    expect(checkFarmAction('plant', 'Jay', t0)).toBeNull();
    expect(checkFarmAction('plant', 'Jay', t0 + 200)).toBe(FARM_RATE_MSG);
    expect(checkFarmAction('plant', 'Jay', t0 + 900)).toBeNull();
    expect(checkFarmAction('plant', 'Other', t0 + 200)).toBeNull(); // per-account
  });

  it('flags Jay-style clockwork harvest cadence (~60s, flat)', () => {
    const t0 = Date.parse('2026-11-05T18:00:00Z');
    for (let i = 0; i < 8; i++) {
      expect(checkFarmAction('harvest', 'jay', t0 + i * 60_000)).toBeNull();
    }
    // 9th at the same cadence → clockwork
    expect(checkFarmAction('harvest', 'jay', t0 + 8 * 60_000)).toBe(FARM_CLOCKWORK_MSG);
  });

  it('does not flag irregular human-like harvest gaps', () => {
    const t0 = Date.parse('2026-11-05T18:00:00Z');
    const gaps = [45_000, 70_000, 38_000, 95_000, 52_000, 80_000, 41_000, 88_000];
    let t = t0;
    expect(checkFarmAction('harvest', 'dayne', t)).toBeNull();
    for (const g of gaps) {
      t += g;
      expect(checkFarmAction('harvest', 'dayne', t)).toBeNull();
    }
  });

  it('skips clockwork for official auto actions but still rate-limits', () => {
    const t0 = Date.parse('2026-11-05T18:00:00Z');
    for (let i = 0; i < 8; i++) {
      expect(checkFarmAction('harvest', 'auto-jay', t0 + i * 60_000, { auto: true })).toBeNull();
    }
    // 9th at same cadence would be clockwork for humans, but auto is allowed
    expect(checkFarmAction('harvest', 'auto-jay', t0 + 8 * 60_000, { auto: true })).toBeNull();
    // gap rate limit still applies
    expect(checkFarmAction('harvest', 'auto-jay', t0 + 8 * 60_000 + 200, { auto: true })).toBe(FARM_RATE_MSG);
  });
});

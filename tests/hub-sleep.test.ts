import { describe, expect, it } from 'vitest';
import { HUB_SLEEP_MSG, hubLocalMinutes, hubSleepView, isHubAwake, nextHubBoundary } from '../shared/hubSleep';

describe('hub overnight sleep', () => {
  it('sleeps 01:00–07:00 UTC-6 (half-open) with the friendly message', () => {
    expect(isHubAwake(Date.parse('2026-11-05T06:59:00Z'))).toBe(true);  // 00:59 local
    expect(isHubAwake(Date.parse('2026-11-05T07:00:00Z'))).toBe(false); // 01:00 local
    expect(isHubAwake(Date.parse('2026-11-05T12:00:00Z'))).toBe(false); // 06:00 local
    expect(isHubAwake(Date.parse('2026-11-05T12:59:00Z'))).toBe(false); // 06:59 local
    expect(isHubAwake(Date.parse('2026-11-05T13:00:00Z'))).toBe(true);  // 07:00 local
    expect(HUB_SLEEP_MSG).toMatch(/sleeps so should you/i);
    const v = hubSleepView(Date.parse('2026-11-05T10:00:00Z'));
    expect(v.sleeping).toBe(true);
    expect(v.message).toBe(HUB_SLEEP_MSG);
    expect(hubLocalMinutes(Date.parse('2026-11-05T07:30:00Z'))).toBeCloseTo(90, 5);
  });
  it('next boundary jumps sleep→wake→next sleep', () => {
    const before = Date.parse('2026-11-05T06:00:00Z'); // 00:00 local
    const sleepAt = nextHubBoundary(before);
    expect(new Date(sleepAt + (-6) * 3_600_000).getUTCHours()).toBe(1);
    const mid = Date.parse('2026-11-05T10:00:00Z'); // 04:00 local sleeping
    const wakeAt = nextHubBoundary(mid);
    expect(new Date(wakeAt + (-6) * 3_600_000).getUTCHours()).toBe(7);
  });
});

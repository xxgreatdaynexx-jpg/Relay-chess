import { describe, expect, it } from 'vitest';
import { awakeDeadline, isHubAwake } from '../shared/hubSleep';
import { advance, newState, MAX_CATCHUP_MS } from '../shared/factory';

const H = 3_600_000;
const L = (s: string) => Date.parse(`${s}-06:00`); // local UTC-6

describe('overnight lockout does not eat away caps (t1899u)', () => {
  it('awake windows never touched: same 8h cap', () => {
    expect(awakeDeadline(L('2026-11-06T08:00:00'), 8 * H)).toBe(L('2026-11-06T16:00:00'));
    expect(awakeDeadline(L('2026-11-06T16:59:00'), 8 * H)).toBe(L('2026-11-07T00:59:00'));
  });
  it('a cap spanning the closure is extended by exactly the real 6h closure, never 7h', () => {
    expect(awakeDeadline(L('2026-11-06T23:00:00'), 8 * H)).toBe(L('2026-11-07T13:00:00')); // 2h + 6h closed + 6h
    expect(awakeDeadline(L('2026-11-06T22:00:00'), 8 * H) - (L('2026-11-06T22:00:00') + 8 * H)).toBe(6 * H);
  });
  it('fixed boundaries: 00:59:59 still awake, 01:00 closed, 07:00 awake; check-in during closure counts from 07:00', () => {
    expect(isHubAwake(L('2026-11-07T00:59:59'))).toBe(true);
    expect(isHubAwake(L('2026-11-07T01:00:00'))).toBe(false);
    expect(isHubAwake(L('2026-11-07T07:00:00'))).toBe(true);
    expect(awakeDeadline(L('2026-11-07T01:00:00'), 8 * H)).toBe(L('2026-11-07T15:00:00'));
    expect(awakeDeadline(L('2026-11-07T06:59:00'), 8 * H)).toBe(L('2026-11-07T15:00:00'));
    expect(awakeDeadline(L('2026-11-07T00:59:00'), 1 * 60_000)).toBe(L('2026-11-07T01:00:00')); // cap ends exactly at closure start
    expect(awakeDeadline(L('2026-11-07T00:59:00'), 2 * 60_000)).toBe(L('2026-11-07T07:01:00'));
    expect(awakeDeadline(L('2026-11-07T00:00:00'), 0)).toBe(L('2026-11-07T00:00:00'));
  });
  it('long caps cross multiple nights and are monotonic / deterministic (restart-safe: pure in seenAt)', () => {
    const s = L('2026-11-06T12:00:00');
    expect(awakeDeadline(s, 24 * H)).toBe(L('2026-11-07T18:00:00')); // one closure inside
    expect(awakeDeadline(s, 48 * H)).toBe(awakeDeadline(s, 48 * H));
    let prev = 0; for (let m = 0; m < 48 * 60; m += 7) { const d = awakeDeadline(s + m * 60_000, 8 * H); expect(d).toBeGreaterThanOrEqual(prev); expect(d - (s + m * 60_000)).toBeLessThanOrEqual(14 * H); prev = d; }
  });
  it('factory catch-up: repeated settles over a closure never exceed one uninterrupted run (no double production)', () => {
    const seen = L('2026-11-06T23:00:00'); const end = awakeDeadline(seen, MAX_CATCHUP_MS);
    const run = (stops: number[]) => {
      const s = newState(1, seen); const st = new Map<string, number>([['ore:copper', 1e6]]);
      const io = { get: (k: string) => st.get(k) ?? 0, add: (k: string, d: number) => st.set(k, (st.get(k) ?? 0) + d) };
      for (const t of stops) advance(s, io, Math.min(t, end), Math.max(MAX_CATCHUP_MS, end - seen));
      return { at: s.at, tick: s.tick };
    };
    const one = run([end + 5 * H]); const many = run([L('2026-11-07T02:00:00'), L('2026-11-07T05:00:00'), L('2026-11-07T08:00:00'), end, end, end + H]);
    expect(many).toEqual(one); expect(one.at).toBeLessThanOrEqual(end);
    expect(one.tick).toBeGreaterThan(0);
  });
});

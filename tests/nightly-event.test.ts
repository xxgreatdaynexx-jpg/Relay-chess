import { describe, expect, it, beforeEach } from 'vitest';
import { nightlyBonus, nightlyEvent, nightlyGameFor, NIGHTLY_GAMES } from '../shared/nightlyEvent';
import { payNightlyBonus, resetNightly, setNightlyClock, NIGHTLY_SLOTS } from '../server/nightly-event';
import { NIGHTLY_BONUS_CAP_PER_NIGHT, NIGHTLY_BONUS_CAP_PER_WIN } from '../shared/nightlyEvent';

const fakeBank = () => { const keys = new Set<string>(); const got: Array<[string, number, string]> = [];
  return { got, keys, hasKey: (k: string) => keys.has(k), transfer(n: string, a: number, o: { key?: string; game: string }) { if (o.key && keys.has(o.key)) return false; if (o.key) keys.add(o.key); got.push([n, a, o.game]); return true; } } as any; };

describe('nightly 10x event', () => {
  beforeEach(() => resetNightly());
  it('window is 02:00–03:00 UTC and picks a game deterministically', () => {
    const t = Date.UTC(2026, 10, 7, 2, 30);
    const e = nightlyEvent(t); expect(e.active).toBe(true); expect(e.game).toBe(nightlyGameFor('2026-11-07'));
    expect(nightlyEvent(Date.UTC(2026, 10, 7, 4)).active).toBe(false);
    expect(nightlyEvent(Date.UTC(2026, 10, 7, 4)).day).toBe('2026-11-08');
    const seen = new Set(Array.from({ length: 60 }, (_, i) => nightlyGameFor(`2026-01-${i}`)));
    expect([...seen].sort()).toEqual([...NIGHTLY_GAMES].sort());
  });
  it('bonus is 9x net, capped per win and per night', () => {
    expect(nightlyBonus(100, 0, 1e6, 1e6)).toBe(900);
    expect(nightlyBonus(100, 0, 500, 1e6)).toBe(500);
    expect(nightlyBonus(100, 950, 1e6, 1000)).toBe(50);
    expect(nightlyBonus(-5, 0, 1e6, 1e6)).toBe(0);
  });
  it('pays only the live game, once per win, through the ledger', () => {
    const t = Date.UTC(2026, 10, 7, 2, 10); setNightlyClock(() => t);
    const g = nightlyGameFor('2026-11-07'); const other = NIGHTLY_GAMES.find((x) => x !== g)!;
    const b = fakeBank();
    expect(payNightlyBonus('alice', other, 100, 'r1', b)).toBe(0);
    expect(payNightlyBonus('alice', g, 100, 'r1', b)).toBe(900);
    expect(payNightlyBonus('alice', g, 100, 'r1', b)).toBe(0); // idempotent
    expect(payNightlyBonus('qa-bot', g, 100, 'r2', b)).toBe(0);
    expect(b.got).toEqual([['alice', 900, 'nightly_10x']]);
    setNightlyClock(() => Date.UTC(2026, 10, 7, 5)); expect(payNightlyBonus('alice', g, 100, 'r3', b)).toBe(0);
    setNightlyClock(() => Date.now());
  });
  it('nightly cap is persisted in ledger keys: a restart (memory wiped) or second instance cannot overpay', () => {
    const t = Date.UTC(2026, 10, 7, 2, 10); setNightlyClock(() => t); const g = nightlyGameFor('2026-11-07');
    try {
      const b = fakeBank(); let total = 0;
      for (let i = 0; i < 3; i++) total += payNightlyBonus('alice', g, 1_000_000, `w${i}`, b);
      expect(total).toBe(3 * NIGHTLY_BONUS_CAP_PER_WIN);
      resetNightly(); // restart: in-memory state gone, ledger keys (b.keys) remain
      for (let i = 3; i < 10; i++) total += payNightlyBonus('alice', g, 1_000_000, `w${i}`, b);
      expect(total).toBe(NIGHTLY_BONUS_CAP_PER_NIGHT);
      // a second instance sharing the ledger keys (fresh memory) pays nothing more
      resetNightly(); expect(payNightlyBonus('alice', g, 1_000, 'other-instance', b)).toBe(0);
      // small wins round up to whole slots: the total never exceeds the cap
      const b2 = fakeBank(); let t2 = 0; resetNightly();
      for (let i = 0; i < NIGHTLY_SLOTS + 50; i++) { t2 += payNightlyBonus('bob', g, 37, `s${i}`, b2); if (i % 17 === 0) resetNightly(); }
      expect(t2).toBeLessThanOrEqual(NIGHTLY_BONUS_CAP_PER_NIGHT); expect(t2).toBeGreaterThan(0);
      expect([...b2.keys].every((k: string) => k.startsWith('nightly10x:2026-11-07:bob:'))).toBe(true);
    } finally { setNightlyClock(() => Date.now()); }
  });
});

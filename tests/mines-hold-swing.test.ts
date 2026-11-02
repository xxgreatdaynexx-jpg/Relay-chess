import { describe, it, expect } from 'vitest';
import { SWING_MS, SWING_MIN_MS, MAX_HITS_PER_10S } from '../shared/mines';
import { miningSwingMul } from '../shared/skillPerks';

// Hold-to-swing repeats at the client cadence (SWING_MS × Mining perk); the server must accept it and never anything faster.
describe('hold-to-swing cadence', () => {
  for (const lvl of [1, 30, 60, 99]) {
    it(`level ${lvl} cadence passes the server limits`, () => {
      const mul = miningSwingMul(lvl), period = Math.round(SWING_MS * mul);
      expect(period).toBeGreaterThan(SWING_MIN_MS * mul);
      expect(Math.ceil(10_000 / period)).toBeLessThanOrEqual(Math.ceil(MAX_HITS_PER_10S / mul));
    });
  }
});

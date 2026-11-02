import { describe, it, expect } from 'vitest';
import { isXmas, XMAS_END_MS, SNOW_COUNT } from '../shared/holiday';
describe('christmas theme date gate', () => {
  it('is on now and through Jan 5 2027 Alberta', () => {
    expect(isXmas(Date.parse('2026-11-02T01:30:00-06:00'))).toBe(true);
    expect(isXmas(Date.parse('2027-01-05T23:59:59-06:00'))).toBe(true);
  });
  it('switches off at midnight Jan 6 Alberta (06:00 UTC)', () => {
    expect(XMAS_END_MS).toBe(Date.UTC(2027, 0, 6, 6));
    expect(isXmas(Date.parse('2027-01-06T00:00:00-06:00'))).toBe(false);
    expect(isXmas(Date.parse('2027-03-01T12:00:00Z'))).toBe(false);
  });
  it('override wins', () => {
    expect(isXmas(Date.parse('2027-03-01T12:00:00Z'), 'on')).toBe(true);
    expect(isXmas(0, 'off')).toBe(false);
  });
  it('low tier gets the lightest snow', () => { expect(SNOW_COUNT.low).toBeLessThan(SNOW_COUNT.mid); });
});

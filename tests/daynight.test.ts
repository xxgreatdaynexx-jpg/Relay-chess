import { describe, it, expect } from 'vitest';
import { skyAt, mountainClock, parseTod, fmtClock } from '../shared/daynight';

describe('day/night (Mountain Time)', () => {
  it('reads Denver wall clock with DST', () => {
    expect(mountainClock(new Date('2026-07-01T18:00:00Z'))).toMatchObject({ minutes: 720, offset: -360 });
    expect(mountainClock(new Date('2026-12-01T19:00:00Z'))).toMatchObject({ minutes: 720, offset: -420 });
  });
  it('sunrise/sunset near real Denver times', () => {
    const jun = skyAt(720, 172, -360); expect(jun.sunrise).toBeGreaterThan(5 * 60 + 20); expect(jun.sunrise).toBeLessThan(5 * 60 + 45); expect(jun.sunset).toBeGreaterThan(20 * 60 + 15); expect(jun.sunset).toBeLessThan(20 * 60 + 45);
    const dec = skyAt(720, 355, -420); expect(dec.sunrise).toBeGreaterThan(7 * 60 + 5); expect(dec.sunset).toBeLessThan(16 * 60 + 50);
  });
  it('phases and lights', () => {
    const noon = skyAt(720, 172, -360), mid = skyAt(0, 172, -360);
    expect(noon.phase).toBe('day'); expect(noon.lights).toBe(0); expect(noon.day).toBeGreaterThan(0.95);
    expect(mid.phase).toBe('night'); expect(mid.lights).toBe(1); expect(mid.stars).toBe(1);
    expect(skyAt(20 * 60 + 20, 172, -360).phase).toMatch(/golden-pm|dusk/);
  });
  it('QA override + clock format', () => {
    expect(parseTod('06:30')).toBe(390); expect(parseTod('25:00')).toBeNull(); expect(parseTod(null)).toBeNull();
    expect(fmtClock(0)).toBe('12:00 AM'); expect(fmtClock(1050)).toBe('5:30 PM');
  });
});

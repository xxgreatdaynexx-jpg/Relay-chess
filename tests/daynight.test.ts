import { describe, it, expect } from 'vitest';
import { skyAt, albertaClock, parseTod, fmtClock } from '../shared/daynight';

describe('day/night (Alberta time)', () => {
  it('uses fixed UTC−6 summer and winter', () => {
    expect(albertaClock(new Date('2026-07-01T18:00:00Z'))).toMatchObject({ minutes: 720, offset: -360 });
    expect(albertaClock(new Date('2026-12-01T18:00:00Z'))).toMatchObject({ minutes: 720, offset: -360, doy: 335 }); // winter UTC−6
    expect(albertaClock(new Date('2027-01-15T18:00:00Z'))).toMatchObject({ minutes: 720, offset: -360 }); // winter: still UTC−6, no DST
    expect(albertaClock(new Date('2027-03-20T18:00:00Z'))).toMatchObject({ minutes: 720, offset: -360 });
    expect(albertaClock(new Date('2026-11-02T05:30:00Z'))).toMatchObject({ minutes: 23 * 60 + 30, doy: 305 });
  });
  it('sunrise/sunset near real Edmonton times', () => {
    // real Edmonton: Jun 21 ≈ 5:03 AM / 10:06 PM MDT, Dec 21 ≈ 9:48 AM / 5:15 PM (UTC−6)
    const jun = skyAt(720, 172, -360); expect(jun.sunrise).toBeGreaterThan(4 * 60 + 50); expect(jun.sunrise).toBeLessThan(5 * 60 + 15); expect(jun.sunset).toBeGreaterThan(21 * 60 + 55); expect(jun.sunset).toBeLessThan(22 * 60 + 20);
    const dec = skyAt(720, 355, -360); expect(dec.sunrise).toBeGreaterThan(9 * 60 + 35); expect(dec.sunrise).toBeLessThan(10 * 60); expect(dec.sunset).toBeGreaterThan(17 * 60 + 5); expect(dec.sunset).toBeLessThan(17 * 60 + 25);
  });
  it('phases and lights', () => {
    const noon = skyAt(720, 172, -360), mid = skyAt(0, 172, -360);
    expect(noon.phase).toBe('day'); expect(noon.lights).toBe(0); expect(noon.day).toBeGreaterThan(0.95);
    expect(mid.phase).toBe('night'); expect(mid.lights).toBe(1); expect(skyAt(0, 355, -360).stars).toBe(1);
    expect(skyAt(21 * 60 + 40, 172, -360).phase).toMatch(/golden-pm|dusk/);
  });
  it('Edmonton extremes: June twilight night, short December day', () => {
    // late June: sun bottoms out ~−13° near 1:30 AM — still dark enough for night, lights + mostly stars
    const jn = skyAt(90, 172, -360); expect(jn.phase).toBe('night'); expect(jn.lights).toBe(1); expect(jn.stars).toBeGreaterThan(0.8);
    expect(skyAt(22 * 60 + 40, 172, -360).phase).toBe('dusk'); expect(skyAt(22 * 60 + 40, 172, -360).lights).toBe(1);
    // Dec 21: low noon sun still counts as day, lights off; dark by 7 PM and before 9 AM
    const dn = skyAt(13 * 60 + 30, 355, -360); expect(dn.elev).toBeGreaterThan(10); expect(dn.elev).toBeLessThan(15); expect(dn.phase).toBe('day'); expect(dn.lights).toBe(0);
    expect(skyAt(19 * 60, 355, -360).phase).toBe('night'); expect(skyAt(8 * 60 + 30, 355, -360).lights).toBe(1);
    // every minute of both solstices yields finite values and a valid phase
    for (const [doy, off] of [[172, -360], [355, -360]]) for (let m = 0; m < 1440; m += 5) { const k = skyAt(m, doy, off); expect(Number.isFinite(k.elev + k.day + k.lights + k.sunrise + k.sunset)).toBe(true); }
  });
  it('QA override + clock format', () => {
    expect(parseTod('06:30')).toBe(390); expect(parseTod('25:00')).toBeNull(); expect(parseTod(null)).toBeNull();
    expect(fmtClock(0)).toBe('12:00 AM'); expect(fmtClock(1050)).toBe('5:30 PM');
  });
});

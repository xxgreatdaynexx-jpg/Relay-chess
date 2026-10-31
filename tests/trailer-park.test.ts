import { describe, expect, it } from 'vitest';
import { parkLayout, cityFill, landmarkBoxes, obbOverlap, roadClearance, obbCorners, PARK_AREA, PLATE } from '../client/src/lib/worldLayout';
import { trailerExclusion, isSingleCharName } from '../shared/trailerPark';

describe('trailer park', () => {
  const f = cityFill(7); const solids = [...f.houses, ...landmarkBoxes()];
  const { lots, lanes } = parkLayout(50, solids);
  it('fits fifty players with stable lot order', () => { expect(lots.length).toBe(50); expect(parkLayout(5, solids).lots).toEqual(lots.slice(0, 5)); expect(lanes.length).toBeGreaterThan(0); });
  it('lots stay off roads, buildings, each other and the plate edge', () => {
    for (const l of lots) {
      expect(obbCorners(l).every(([x, z]) => Math.abs(x) < PLATE && Math.abs(z) < PLATE)).toBe(true);
      for (const [x, z] of obbCorners(l)) expect(roadClearance(x, z)).toBeGreaterThan(0);
      expect(solids.some((s) => obbOverlap(s, l, 0.3))).toBe(false);
      expect(lots.some((o) => o !== l && obbOverlap(o, l, 0.5))).toBe(false);
    }
  });
  it('no house is built inside the park', () => { expect(f.houses.some((hh) => obbOverlap(hh, PARK_AREA))).toBe(false); });
  it('excludes QA, single-character and cheat accounts', () => {
    expect(trailerExclusion('QA-bot', [])).toBeTruthy(); expect(trailerExclusion('7', [])).toBeTruthy(); expect(trailerExclusion('A', [])).toBeTruthy(); expect(isSingleCharName('Yo')).toBe(false);
    expect(trailerExclusion('chessgawd', [])).toBeTruthy(); expect(trailerExclusion('dayne', [])).toBeNull(); expect(trailerExclusion('arenagawd', [])).toBeTruthy();
    expect(trailerExclusion('poonhound', ['headshots'])).toBeNull(); expect(trailerExclusion('Special Characters', ['headshots', 'through_wall'])).toBeNull();
  });
});

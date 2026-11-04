import { describe, expect, it } from 'vitest';
import { HUB_IDS, HUB_MAPS } from '../shared/logistics';
// QA#6: ships berth alongside the pier face, between the pier's ends, and depart parallel to the quay (not off the tip, not in the crane legs).
describe('QA#6 ship berth alongside the pier', () => {
  it.each(HUB_IDS)('%s', (h) => {
    const m = HUB_MAPS[h]; const [[px, z0], [, z1]] = m.port.pier as [[number, number], [number, number]]; const face = px - 7 + 4.5;
    expect(m.port.x - face).toBeGreaterThan(3.5); expect(m.port.x - face).toBeLessThan(6);
    expect(m.port.z).toBeGreaterThan(Math.min(z0, z1)); expect(m.port.z).toBeLessThan(Math.max(z0, z1));
    expect(m.ship[1]![0]).toBe(m.ship[0]![0]);
  });
});

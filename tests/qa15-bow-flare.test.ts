import { describe, expect, it } from 'vitest';
import { flareHull, bowPinch, ship } from '../client/src/lib/worldFreight';
describe('QA#15 container ship bow flare', () => {
  it('upper hull is narrower at the keel than at the deck near the bow, unchanged aft', () => {
    const p = flareHull('upper').attributes.position!; let keelW = 0, deckW = 0, aftKeel = 0, aftDeck = 0;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = Math.abs(p.getZ(i));
      if (x > 7 && x < 8.5) { if (y < -0.95) keelW = Math.max(keelW, z); if (y > -0.05) deckW = Math.max(deckW, z); }
      if (x < 0) { if (y < -0.95) aftKeel = Math.max(aftKeel, z); if (y > -0.05) aftDeck = Math.max(aftDeck, z); } }
    expect(keelW).toBeLessThan(deckW * 0.85); expect(aftKeel).toBeCloseTo(aftDeck, 5); expect(bowPinch(0)).toBe(0); expect(bowPinch(9.6)).toBe(1);
  });
  it('builds and has no bar wider than the stem at the bow', () => {
    const g = ship(); let bad = 0; g.traverse((o) => { if (o.position.x > 8.5 && o.scale.z > 2) bad++; }); expect(bad).toBe(0);
  });
});

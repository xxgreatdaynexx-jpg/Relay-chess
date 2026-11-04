import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import { previewScene } from '../client/src/lib/fleetPreview';
import { BOATS, JETS } from '../shared/fleet';
describe('jet store hangar preview', () => {
  it.each(JETS.map((j) => j.id))('%s stands in a hangar, wheels on the floor', (id) => {
    const P = previewScene(JETS.find((j) => j.id === id)!, 1.6); const h = P.scene.children.find((o) => o.userData.part === 'hangar');
    expect(h).toBeTruthy(); P.scene.updateMatrixWorld(true); expect(Math.abs(new Box3().setFromObject(P.craft).min.y)).toBeLessThan(0.05);
    const parts = new Set<string>(); h!.traverse((o) => o.userData.part && parts.add(o.userData.part)); expect([...parts]).toEqual(expect.arrayContaining(['floor', 'vault']));
  });
  it('boats keep the water disc, no hangar', () => { const P = previewScene(BOATS[0]!, 1.6); expect(P.scene.children.some((o) => o.userData.part === 'hangar')).toBe(false); });
});

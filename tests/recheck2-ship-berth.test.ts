import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ship, shipBerth } from '../client/src/lib/worldFreight';
import { HUB_IDS, HUB_MAPS } from '../shared/logistics';
// recheck #2: the loading ship lies parallel to the pier, outboard of the fenders, with no hull inside the pier deck.
describe('recheck #2 container ship berths alongside, no clipping', () => {
  it.each(HUB_IDS)('%s', (h) => {
    const [[px, z0], [, z1]] = HUB_MAPS[h].port.pier as [[number, number], [number, number]]; const cx = px - 7; // buildHarbour x
    const pier = new THREE.Box3(new THREE.Vector3(cx - 4.5, -3, Math.min(z0, z1)), new THREE.Vector3(cx + 4.5 + 0.6, 1.4, Math.max(z0, z1))); // deck + fenders
    const g = ship(); const b = shipBerth(h); g.position.set(b.x, b.y, b.z); g.rotation.y = b.ry; g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g); const size = box.getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(size.x * 2); // long axis along the pier (z)
    expect(box.intersectsBox(pier)).toBe(false);
    expect(box.min.x - pier.max.x).toBeLessThan(2.5); // still alongside, not adrift
    expect(box.min.z).toBeGreaterThan(Math.min(z0, z1) - 2); expect(box.max.z).toBeLessThan(Math.max(z0, z1) + 6);
  });
});

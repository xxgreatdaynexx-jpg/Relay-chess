import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { truck, TRUCK_AXLES } from '../client/src/lib/worldFreight';
describe('QA#11 box truck', () => {
  it('has a steer axle plus a tandem (2 rear axles, 6 wheels) and a cab lower than the box', () => {
    expect(TRUCK_AXLES.filter((x) => x < 0)).toHaveLength(2);
    const g = truck(0x2563eb, false); const xs = new Set<number>(); let top = 0, box = 0;
    g.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; const p = (m.geometry as THREE.BufferGeometry).parameters as { radiusTop?: number } | undefined;
      if (p?.radiusTop === 0.45) xs.add(m.position.x); if (m.position.x > 1.4 && m.position.x < 2.6 && m.scale.x >= 1.2) top = Math.max(top, m.position.y + m.scale.y / 2); if (m.scale.x === 4.4) box = m.position.y + m.scale.y / 2; });
    expect([...xs].sort()).toEqual([...TRUCK_AXLES].sort()); expect(top).toBeLessThan(2.7); expect(top).toBeLessThan(box);
  });
});

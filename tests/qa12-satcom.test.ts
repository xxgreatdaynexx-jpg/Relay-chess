import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildJet } from '../client/src/lib/fleetModels';
import { JETS } from '../shared/fleet';
describe('QA#12 ChudOne roof fairing', () => {
  it('is a low SATCOM dome, not a box', () => {
    const g = buildJet(JETS.find((j) => j.id === 'chudone')!); const parts: THREE.Mesh[] = []; let boxes = 0;
    g.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; if (m.userData.part === 'satcom') parts.push(m); if (m.geometry.type === 'BoxGeometry' && m.position.y > 3.5) boxes++; });
    expect(parts).toHaveLength(1); const d = parts[0]!; expect(d.geometry.type).toBe('SphereGeometry'); expect(d.scale.y).toBeLessThan(d.scale.x); expect(d.scale.y / d.scale.x).toBeLessThan(0.6); // low dome (recheck #4: absolute size now scales with the 747-size body)
    expect(boxes).toBe(0);
  });
});

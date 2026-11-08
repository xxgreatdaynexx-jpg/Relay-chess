import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { attachCityProtestJoke } from '../client/src/lib/cityProtestJoke';
import { cityRiotGate } from '../client/src/lib/cityRiotGate';
import { cityFill, LANDMARK_IDS } from '../shared/worldLayout';
import { WORLD_SPOTS } from '../client/src/lib/worldSpots';
import { civicRetired } from '../shared/realEstate';

const ids = [...LANDMARK_IDS, ...WORLD_SPOTS.map((s) => s.id).filter((id) => !LANDMARK_IDS.includes(id))];
const fill = cityFill(7, ids);
const opts = { map: 'city', tier: 'high' as const, sites: fill.patches.filter((b) => !civicRetired(b)), buildings: fill.houses.filter((b) => !civicRetired(b)), label: () => new THREE.Texture(), reducedMotion: () => false, enabled: false };
const count = (s: THREE.Scene) => { let n = 0; s.traverse((o) => { if (o instanceof THREE.InstancedMesh || o instanceof THREE.Mesh) n++; }); return n; };

describe('mayor stop-riot: whole joke layer (crowds, fires, police) via the gate', () => {
  it('resolved at load never allocates anything (no flash)', () => {
    const scene = new THREE.Scene(); const j = attachCityProtestJoke(scene, opts); const g = cityRiotGate(j);
    g.apply({ riot: { active: false } }); j.step(5); expect(scene.children).toHaveLength(0); expect(count(scene)).toBe(0); j.dispose();
  });
  it('active shows crowds + fires + police; a resolved snapshot removes every node; stale active never brings it back', () => {
    const scene = new THREE.Scene(); const j = attachCityProtestJoke(scene, opts); const g = cityRiotGate(j);
    expect(scene.children).toHaveLength(0);
    g.apply({ riot: { active: true } }); j.step(1);
    const root = scene.getObjectByName('city-protest-joke')!; expect(root).toBeTruthy();
    let inst = 0; root.traverse((o) => { if (o instanceof THREE.InstancedMesh) inst++; }); expect(inst).toBeGreaterThanOrEqual(27); // crowds + fires + police batches
    g.apply({ riot: { active: false } }); expect(scene.children).toHaveLength(0); expect(count(scene)).toBe(0);
    g.apply({ riot: { active: true } }); j.step(2); expect(scene.children).toHaveLength(0);
    j.dispose();
  });
});

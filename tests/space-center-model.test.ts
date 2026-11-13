import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildSpaceCenter, SPACE_CENTER_SIZE } from '../client/src/lib/spaceCenterModel';

function collect(root: THREE.Object3D) {
  const names = new Set<string>();
  let meshes = 0, instanced = 0, tris = 0;
  root.traverse((o) => {
    if (o.name) names.add(o.name);
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const inst = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1;
    if (inst > 1) instanced += inst;
    const geo = m.geometry;
    const idx = geo.index;
    const nvert = geo.getAttribute('position')?.count ?? 0;
    tris += ((idx ? idx.count / 3 : nvert / 3) * inst);
  });
  return { names, meshes, instanced, tris };
}

describe('space center model', () => {
  it('exports a campus with the Kennedy pieces and a mobile-friendly budget', () => {
    const g = buildSpaceCenter();
    expect(g.name).toBe('space-center');
    const { names, meshes, tris } = collect(g);
    for (const n of ['vab', 'lcc', 'rocket', 'tower', 'crawler', 'crawlerway', 'pad', 'fuel-farm', 'water-tower', 'fence', 'grounds', 'lightning-mast']) {
      expect(names.has(n), n).toBe(true);
    }
    expect(SPACE_CENTER_SIZE.w).toBeGreaterThan(80);
    expect(SPACE_CENTER_SIZE.d).toBeGreaterThan(40);
    // Shared boxes / instancing: a few hundred mesh objects is fine; keep tris in mobile range.
    expect(meshes).toBeLessThan(700);
    expect(tris).toBeLessThan(120_000);
    expect(tris).toBeGreaterThan(2_000);
  });

  it('sits on the ground and spans a campus, not a single pad', () => {
    const g = buildSpaceCenter();
    const box = new THREE.Box3().setFromObject(g);
    expect(box.min.y).toBeGreaterThan(-2.5);
    expect(box.max.y).toBeGreaterThan(24); // VAB is ~28, lightning masts taller
    expect(box.max.x - box.min.x).toBeGreaterThan(80);
    expect(box.max.z - box.min.z).toBeGreaterThan(50);
  });
});

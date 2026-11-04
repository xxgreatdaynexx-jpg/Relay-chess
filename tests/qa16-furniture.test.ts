import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildFurniture } from '../client/src/lib/homeModels';
import { FURN_BY_ID } from '../shared/homes';
const bb = (id: string) => new THREE.Box3().setFromObject(buildFurniture(FURN_BY_ID.get(id)!));
describe('QA#16 furniture proportions', () => {
  it.each(['bed', 'kingbed'])('%s is a framed bed with a duvet, not a solid accent tub', (id) => {
    const f = FURN_BY_ID.get(id)!; const g = buildFurniture(f); let tub = 0, duvet = 0;
    g.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; const p = (m.geometry as unknown as { parameters: { width: number; height: number; depth: number } }).parameters;
      if ((m.material as THREE.MeshStandardMaterial).color.getHex() === f.accent && p.depth > f.d * 0.9 && p.height > 0.2) tub++; if (m.userData.part === 'duvet') duvet++; });
    expect(tub).toBe(0); expect(duvet).toBe(1);
  });
  it('fridge stands well over twice the mattress height', () => {
    expect(bb('fridge').max.y).toBeGreaterThan(1.8); const mattress = 0.28 + FURN_BY_ID.get('bed')!.h * 0.32; expect(bb('fridge').max.y / mattress).toBeGreaterThan(3);
  });
});

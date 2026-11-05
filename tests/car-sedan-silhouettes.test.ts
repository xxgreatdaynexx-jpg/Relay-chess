import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildCar } from '../client/src/lib/carModels';
import { CAR_BY_ID } from '../shared/cars';

const meshCount = (g: THREE.Group) => { let n = 0; g.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; }); return n; };
const sizeOf = (g: THREE.Group) => new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());

describe('sedan silhouette splits', () => {
  it('gives Commuter, Exec and Cab distinct mesh counts and proportions', () => {
    const a = buildCar(CAR_BY_ID.get('commuter')!, 0xd0d4da);
    const b = buildCar(CAR_BY_ID.get('exec')!, 0x111418);
    const c = buildCar(CAR_BY_ID.get('taxi')!, 0xffcc00);
    const na = meshCount(a), nb = meshCount(b), nc = meshCount(c);
    expect(new Set([na, nb, nc]).size).toBe(3);
    const sa = sizeOf(a), sb = sizeOf(b), sc = sizeOf(c);
    // Exec should be the longest (dims + long-hood cabin aft); Cab the tallest (Crown Vic body).
    expect(sb.x).toBeGreaterThan(sa.x);
    expect(sc.y).toBeGreaterThan(sa.y);
    expect(sc.y).toBeGreaterThan(sb.y - 1e-6);
  });

  it('does not change hatch/wagon builders via the sedan split', () => {
    const pizza = buildCar(CAR_BY_ID.get('pizza')!, 0xe63946);
    const wagon = buildCar(CAR_BY_ID.get('wagon')!, 0x6b8e9e);
    let pizzaSign = false;
    pizza.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material && ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive?.getHex() === 0xff3b3b) pizzaSign = true; });
    expect(pizzaSign).toBe(true);
    expect(meshCount(wagon)).toBeGreaterThan(20);
  });
});

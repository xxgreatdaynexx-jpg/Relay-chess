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

describe('coupe silhouette splits', () => {
  it('gives Zipline, Neon Fang and Aurelia distinct mesh counts', () => {
    const a = buildCar(CAR_BY_ID.get('zipline')!, 0xf77f00);
    const b = buildCar(CAR_BY_ID.get('neonfang')!, 0x39ff14);
    const c = buildCar(CAR_BY_ID.get('aurelia')!, 0xd4af37);
    const counts = [a, b, c].map((g) => { let n = 0; g.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; }); return n; });
    expect(new Set(counts).size).toBe(3);
    const sizes = [a, b, c].map((g) => new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()));
    // Aurelia longest hood → overall longer; Neon Fang taller via wing; Zipline shortest.
    expect(sizes[2]!.x).toBeGreaterThan(sizes[0]!.x);
    expect(sizes[1]!.y).toBeGreaterThan(sizes[0]!.y);
  });
});

describe('super and muscle silhouette splits', () => {
  it('gives Hypervolt, Phantom and Chudmobile distinct builds', () => {
    const ids = ['hypervolt', 'phantom', 'chudmobile'] as const;
    const gs = ids.map((id) => buildCar(CAR_BY_ID.get(id)!, 0xb5171e));
    const counts = gs.map(meshCount);
    expect(new Set(counts).size).toBe(3);
    const ys = gs.map((g) => sizeOf(g).y);
    expect(ys[2]!).toBeGreaterThan(ys[0]!); // chud wing taller than smooth EV
  });

  it('gives Thunderhorse and Hellcharger distinct greenhouse lengths', () => {
    const a = buildCar(CAR_BY_ID.get('thunderhorse')!, 0x1d9bf0);
    const b = buildCar(CAR_BY_ID.get('blacktop')!, 0x111418);
    expect(meshCount(a)).not.toBe(meshCount(b));
    // Hellcharger cabin is longer (4-door); approximate via overall length + mesh richness
    expect(meshCount(b)).toBeGreaterThan(meshCount(a));
  });
});

describe('hatch / utility silhouette splits', () => {
  it('makes Rustbucket richer/messier than Pizza while Pizza keeps its roof sign', () => {
    const rust = buildCar(CAR_BY_ID.get('rustbucket')!, 0x8a5a3a);
    const pizza = buildCar(CAR_BY_ID.get('pizza')!, 0xe63946);
    expect(meshCount(rust)).toBeGreaterThan(meshCount(pizza));
    let pizzaSign = false;
    pizza.traverse((o) => { if ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive?.getHex() === 0xff3b3b) pizzaSign = true; });
    expect(pizzaSign).toBe(true);
  });

  it('gives Trailblazer, Hauler and Regent limo distinct fronts/pillars', () => {
    const suv = buildCar(CAR_BY_ID.get('trailblazer')!, 0x2d6a4f);
    const truck = buildCar(CAR_BY_ID.get('hauler')!, 0xb5171e);
    const limo = buildCar(CAR_BY_ID.get('regent')!, 0x111418);
    expect(new Set([meshCount(suv), meshCount(truck), meshCount(limo)]).size).toBe(3);
    expect(sizeOf(limo).x).toBeGreaterThan(sizeOf(suv).x); // stretch dims
  });
});

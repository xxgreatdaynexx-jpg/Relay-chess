/**
 * Instanced scenery for the Billionaire expanded land: snowy pines and deciduous
 * trees, bushes, rocks, lamps, ponds, Goldwood hedges and fence runs.
 */
import * as THREE from 'three';
import { xmasOn } from '../../../shared/holiday';
import { expansionScenery, type ScenerySpot } from '../../../shared/expansionScenery';

type MatFn = (o: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial;
type GeoFn = (g: THREE.BufferGeometry) => THREE.BufferGeometry;

export function addExpansionScenery(scene: THREE.Scene, mat: MatFn, geo: GeoFn, low: boolean) {
  const XM = xmasOn();
  const all = expansionScenery();
  // Phones / low-tier: keep trees, lamps, hedges and ponds; thin bushes, rocks and fence posts.
  const spots = low ? all.filter((s, i) => s.kind !== 'rock' && s.kind !== 'fence' && (s.kind !== 'bush' || i % 2 === 0)) : all;
  const of = (k: ScenerySpot['kind']) => spots.filter((s) => s.kind === k);
  const d = new THREE.Object3D();
  const inst = (g: THREE.BufferGeometry, m: THREE.Material, list: ScenerySpot[], place: (s: ScenerySpot, o: THREE.Object3D) => void) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(g, m, list.length);
    list.forEach((s, i) => { d.position.set(0, 0, 0); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); place(s, d); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.userData.noShadow = low;
    scene.add(im);
  };

  const pine = of('pine');
  inst(geo(new THREE.CylinderGeometry(0.12, 0.2, 1, 5)), mat({ color: 0x4a321c, roughness: 1 }), pine, (s, o) => {
    o.position.set(s.x, 0.7 * s.s, s.z); o.scale.set(s.s, 1.4 * s.s, s.s);
  });
  inst(geo(new THREE.ConeGeometry(0.85, 1.8, 7)), mat({ color: 0x1f5a32, flatShading: true, roughness: 0.95, emissive: 0x0a2412, emissiveIntensity: 0.35 }), pine, (s, o) => {
    o.position.set(s.x, 1.85 * s.s, s.z); o.scale.set(s.s, s.s, s.s); o.rotation.y = s.rot;
  });
  inst(geo(new THREE.ConeGeometry(0.6, 1.3, 7)), mat({ color: 0x2a6e3c, flatShading: true, roughness: 0.95, emissive: 0x0a2412, emissiveIntensity: 0.3 }), pine, (s, o) => {
    o.position.set(s.x, 2.55 * s.s, s.z); o.scale.set(s.s, s.s, s.s); o.rotation.y = s.rot + 0.4;
  });
  if (XM) inst(geo(new THREE.ConeGeometry(0.42, 0.45, 7)), mat({ color: 0xf4f8ff, roughness: 0.9, flatShading: true, emissive: 0x1a2238, emissiveIntensity: 0.45 }), pine, (s, o) => {
    o.position.set(s.x, 3.15 * s.s, s.z); o.scale.set(s.s, s.s, s.s);
  });

  const dec = of('deciduous');
  inst(geo(new THREE.CylinderGeometry(0.14, 0.2, 1, 5)), mat({ color: 0x5a3a22, roughness: 1 }), dec, (s, o) => {
    o.position.set(s.x, 0.7 * s.s, s.z); o.scale.set(s.s, 1.4 * s.s, s.s);
  });
  inst(geo(new THREE.IcosahedronGeometry(1, 0)), mat({
    color: XM ? 0x8a9a88 : 0x2f8a3a, flatShading: true, roughness: 0.95,
    emissive: XM ? 0x1a2218 : 0x0a2a10, emissiveIntensity: 0.35,
  }), dec, (s, o) => {
    o.position.set(s.x, 2.05 * s.s, s.z); o.scale.set(s.s * 1.15, s.s * 1.2, s.s * 1.15); o.rotation.y = s.rot;
  });
  if (XM) inst(geo(new THREE.SphereGeometry(0.45, 6, 4)), mat({ color: 0xf3f7ff, roughness: 0.95, emissive: 0x1a2238, emissiveIntensity: 0.4 }), dec, (s, o) => {
    o.position.set(s.x, 2.7 * s.s, s.z); o.scale.set(s.s, s.s * 0.55, s.s);
  });

  const bushes = of('bush');
  inst(geo(new THREE.SphereGeometry(0.55, 6, 5)), mat({ color: XM ? 0x6a7a62 : 0x3a8a3a, roughness: 1, flatShading: true }), bushes, (s, o) => {
    o.position.set(s.x, 0.4 * s.s, s.z); o.scale.set(s.s, s.s * 0.8, s.s); o.rotation.y = s.rot;
  });
  if (XM) inst(geo(new THREE.SphereGeometry(0.35, 5, 4)), mat({ color: 0xf4f8ff, roughness: 0.95 }), bushes, (s, o) => {
    o.position.set(s.x, 0.65 * s.s, s.z); o.scale.set(s.s * 0.9, s.s * 0.4, s.s * 0.9);
  });

  const rocks = of('rock');
  inst(geo(new THREE.DodecahedronGeometry(0.55, 0)), mat({ color: 0x7a7d84, roughness: 0.95, flatShading: true }), rocks, (s, o) => {
    o.position.set(s.x, 0.22 * s.s, s.z); o.scale.set(s.s, s.s * 0.7, s.s); o.rotation.set(s.rot, s.rot * 0.5, 0);
  });
  if (XM) inst(geo(new THREE.SphereGeometry(0.28, 5, 4)), mat({ color: 0xf2f6ff, roughness: 0.95 }), rocks, (s, o) => {
    o.position.set(s.x, 0.4 * s.s, s.z); o.scale.set(s.s * 0.8, s.s * 0.35, s.s * 0.8);
  });

  const lamps = of('lamp');
  inst(geo(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 4)), mat({ color: 0x40444f, roughness: 0.6, metalness: 0.25 }), lamps, (s, o) => {
    o.position.set(s.x, 1.2, s.z);
  });
  inst(geo(new THREE.SphereGeometry(0.22, 8, 6)), mat({ color: 0xfff0c0, emissive: 0xffd080, emissiveIntensity: XM ? 0.7 : 1 }), lamps, (s, o) => {
    o.position.set(s.x, 2.45, s.z);
  });

  const hedges = of('hedge');
  inst(geo(new THREE.BoxGeometry(1.5, 1.1, 0.45)), mat({ color: XM ? 0x5c6e52 : 0x2f6b32, roughness: 1 }), hedges, (s, o) => {
    o.position.set(s.x, 0.55, s.z); o.rotation.y = s.rot;
  });
  if (XM) inst(geo(new THREE.BoxGeometry(1.5, 0.18, 0.48)), mat({ color: 0xf4f8ff, roughness: 0.95 }), hedges, (s, o) => {
    o.position.set(s.x, 1.12, s.z); o.rotation.y = s.rot;
  });

  const fence = of('fence');
  inst(geo(new THREE.BoxGeometry(0.12, 1.15, 0.12)), mat({ color: 0x6a5a3a, roughness: 0.9 }), fence, (s, o) => {
    o.position.set(s.x, 0.55, s.z);
  });
  inst(geo(new THREE.BoxGeometry(2.1, 0.1, 0.08)), mat({ color: 0x7a6a48, roughness: 0.9 }), fence, (s, o) => {
    o.position.set(s.x, 0.7, s.z); o.rotation.y = s.rot;
  });

  const pondMat = mat({ color: 0x2a6a78, roughness: 0.15, metalness: 0.2, emissive: 0x0a2030, emissiveIntensity: 0.35 });
  const bankMat = mat({ color: XM ? 0xe8eef6 : 0xc9b48a, roughness: 1 });
  for (const s of of('pond')) {
    const water = new THREE.Mesh(geo(new THREE.CircleGeometry(s.s, 14)), pondMat);
    water.rotation.x = -Math.PI / 2; water.position.set(s.x, 0.04, s.z); water.userData.noShadow = true; scene.add(water);
    const bank = new THREE.Mesh(geo(new THREE.RingGeometry(s.s * 0.92, s.s + 1.4, 14)), bankMat);
    bank.rotation.x = -Math.PI / 2; bank.position.set(s.x, 0.05, s.z); bank.userData.noShadow = true; scene.add(bank);
  }
}

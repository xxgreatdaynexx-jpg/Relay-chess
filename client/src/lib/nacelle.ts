import * as THREE from 'three';

// mu-visuals: shared turbofan nacelle for every jet/plane (fleet jets, freight plane, Fort McChud airport).
// Unit geometry (length 1 along +Z = forward, max radius 0.5) is built once and shared; each nacelle is a scaled Group.
const cache = new Map<string, THREE.BufferGeometry>();
const G = (k: string, f: () => THREE.BufferGeometry) => { let g = cache.get(k); if (!g) { g = f(); cache.set(k, g); } return g; };
const mats = new Map<string, THREE.Material>();
const MAT = (k: string, f: () => THREE.Material) => { let m = mats.get(k); if (!m) { m = f(); mats.set(k, m); } return m; };

/** Rounded barrel: lathe profile from exhaust (z=-0.5) to intake lip (z=+0.5), fattest just behind the intake. */
const bodyG = () => G('body', () => { const p: THREE.Vector2[] = [];
  const prof: [number, number][] = [[0.3, -0.5], [0.4, -0.38], [0.47, -0.15], [0.5, 0.1], [0.49, 0.3], [0.455, 0.44], [0.42, 0.5]];
  for (const [r, z] of prof) p.push(new THREE.Vector2(r, z)); const g = new THREE.LatheGeometry(p, 24); g.rotateX(Math.PI / 2); g.computeVertexNormals(); return g; });
const lipG = () => G('lip', () => { const g = new THREE.TorusGeometry(0.41, 0.045, 10, 28); g.translate(0, 0, 0.5); return g; });
const fanG = () => G('fan', () => { const g = new THREE.CircleGeometry(0.4, 24); g.translate(0, 0, 0.42); return g; });
const spinG = () => G('spin', () => { const g = new THREE.ConeGeometry(0.13, 0.22, 16); g.rotateX(Math.PI / 2); g.translate(0, 0, 0.5); return g; });
const plugG = () => G('plug', () => { const g = new THREE.ConeGeometry(0.2, 0.3, 16); g.rotateX(-Math.PI / 2); g.translate(0, 0, -0.6); return g; });
const nozG = () => G('noz', () => { const g = new THREE.CylinderGeometry(0.3, 0.27, 0.1, 20, 1, true); g.rotateX(Math.PI / 2); g.translate(0, 0, -0.53); return g; });
const pylonG = () => G('pylon', () => { const s = new THREE.Shape(); s.moveTo(-0.42, 0); s.lineTo(0.3, 0); s.lineTo(0.05, 1); s.lineTo(-0.55, 1); const g = new THREE.ExtrudeGeometry(s, { depth: 0.09, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 }); g.translate(0, 0, -0.045); g.rotateY(-Math.PI / 2); return g; });

export interface NacelleOpts { len: number; r: number; pylon: number; body: THREE.Material; lipColor?: number }
/** Nacelle pointing +Z with its pylon rising to y=+pylon above the barrel top (attach the group so that point meets the wing underside). */
export function nacelle(o: NacelleOpts): THREE.Group {
  const g = new THREE.Group(); const dark = MAT('dark', () => new THREE.MeshStandardMaterial({ color: 0x1b1f26, metalness: 0.6, roughness: 0.5 }));
  const lip = MAT('lip' + (o.lipColor ?? 0xd9dee4), () => new THREE.MeshStandardMaterial({ color: o.lipColor ?? 0xd9dee4, metalness: 0.9, roughness: 0.22 }));
  const hot = MAT('hot', () => new THREE.MeshStandardMaterial({ color: 0x5a5f66, metalness: 0.85, roughness: 0.35 }));
  const barrel = new THREE.Group(); barrel.scale.set(o.r * 2, o.r * 2, o.len); g.add(barrel);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, to: THREE.Object3D) => { const x = new THREE.Mesh(geo, m); x.castShadow = true; to.add(x); return x; };
  add(bodyG(), o.body, barrel); add(lipG(), lip, barrel); add(fanG(), dark, barrel); add(spinG(), lip, barrel); add(nozG(), hot, barrel); add(plugG(), hot, barrel);
  const py = add(pylonG(), o.body, g); py.scale.set(1, o.pylon + o.r * 0.4, o.len * 0.9); py.position.y = o.r * 0.6; py.rotation.y = 0;
  return g;
}
/** Same, but nose along +X (for models built with the fuselage on the X axis). */
export function nacelleX(o: NacelleOpts): THREE.Group { const w = new THREE.Group(); const n = nacelle(o); n.rotation.y = Math.PI / 2; w.add(n); return w; }

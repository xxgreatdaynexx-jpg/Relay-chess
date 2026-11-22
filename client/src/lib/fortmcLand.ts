// Fort McChud land (map expansion): one heightfield for the whole map instead of a flat plane with decals on top.
//  - the play area stays exactly flat (y = 0) so pads, roads and plants never clip; the Deep Ore Mine pit, the tailings
//    ponds and the lakes are carved INTO it (no more coplanar snow/pond planes z-fighting with the ground);
//  - snow is painted into the vertex colours (plus a few real drift mounds), not stacked flat circles;
//  - past the map edge the muskeg rolls up into forested hills that run out to the fog, so the world no longer ends in a
//    hard edge against a grey band.
import * as THREE from 'three';
import { FORT_X0, FORT_X1, FORT_Z0, FORT_Z1 } from '../../../shared/fortmc';
import { FORT_WATERS, MINE_PIT, fortHeight, waterE } from '../../../shared/fortmcLand';
export { FORT_WATERS, MINE_PIT, fortHeight, outside } from '../../../shared/fortmcLand';

/** Inner (detailed) + outer (coarse, to the horizon) terrain meshes. */
export function buildFortLand(tier: string, mat: (p: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial, geo: <G extends THREE.BufferGeometry>(g: G) => G) {
  const cx = (FORT_X0 + FORT_X1) / 2, cz = (FORT_Z0 + FORT_Z1) / 2; const M = 170;
  const W = FORT_X1 - FORT_X0 + 2 * M, D = FORT_Z1 - FORT_Z0 + 2 * M; const cell = tier === 'low' ? 6 : 3.5;
  const c = new THREE.Color(), c2 = new THREE.Color();
  const colour = (x: number, z: number, h: number, out: number[]) => {
    const n = Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05) + 0.5 * Math.sin(x * 0.13 - z * 0.11) + 0.25 * Math.sin(x * 0.31 + z * 0.27);
    c.setHex(0x5a5a3e); c2.setHex(n > 0.4 ? 0x3e4630 : n < -0.5 ? 0x77684c : 0x5f5c40); c.lerp(c2, 0.7);
    const sn = Math.sin(x * 0.021 + 0.4) * Math.cos(z * 0.027 - 1.1) + 0.45 * Math.sin(x * 0.067 + z * 0.052 + 2) + 0.2 * Math.sin(x * 0.17 - z * 0.15);
    if (h > 0.5) { c.lerp(c2.setHex(0x34402c), Math.min(1, h / 6)); if (h > 13) c.lerp(c2.setHex(0x6b6458), Math.min(1, (h - 13) / 4)); if (h > 17) c.lerp(c2.setHex(0xe4eaee), Math.min(1, (h - 17) / 3)); }
    else if (h < -0.4) c.lerp(c2.setHex(0x3a3428), 0.8);
    for (const w of FORT_WATERS) if (w.kind === 'tailings') { const e = waterE(w, x, z); if (e > 0.9 && e < 1.8) c.lerp(c2.setHex(0x8a7e6a), 0.85); } // gravel dyke
    if (sn > 0.9 && h > -0.4) c.lerp(c2.setHex(0xdfe6ea), Math.min(0.85, (sn - 0.9) * 2.2)); // snow lies in the hollows
    out.push(c.r, c.g, c.b);
  };
  const sheet = (w: number, d: number, sx: number, sz: number, sink: (x: number, z: number) => number) => {
    const g = new THREE.PlaneGeometry(w, d, sx, sz); g.rotateX(-Math.PI / 2); g.translate(cx, 0, cz);
    const pa = g.attributes.position as THREE.BufferAttribute; const col: number[] = [];
    for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), z = pa.getZ(i); const h = fortHeight(x, z); pa.setY(i, h + sink(x, z)); colour(x, z, h, col); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return geo(g);
  };
  const groundM = mat({ color: 0xffffff, vertexColors: true, roughness: 1 });
  const inner = new THREE.Mesh(sheet(W, D, Math.round(W / cell), Math.round(D / cell), () => 0), groundM); inner.receiveShadow = true; inner.name = 'fortGround';
  // Outer skirt: same height function out to 1.6 km; sunk under the detailed sheet so the two never fight.
  const ix0 = cx - W / 2 + 6, ix1 = cx + W / 2 - 6, iz0 = cz - D / 2 + 6, iz1 = cz + D / 2 - 6;
  const outer = new THREE.Mesh(sheet(3400, 3000, tier === 'low' ? 60 : 110, tier === 'low' ? 52 : 96, (x, z) => (x > ix0 && x < ix1 && z > iz0 && z < iz1 ? -6 : 0)), groundM); outer.name = 'fortSkirt';
  // Water surfaces in the carved basins (lakes reflect the sky; tailings are oily brown-grey), with a gravel berm ring.
  const lakeM = mat({ color: 0x47708a, roughness: 0.15, metalness: 0.1, emissive: 0x0c1a24, emissiveIntensity: 0.6 });
  const tailM = mat({ color: 0x5b5246, roughness: 0.22, metalness: 0.05, emissive: 0x120e0a, emissiveIntensity: 0.5 });
  const waters = new THREE.Group(); waters.name = 'fortWaters';
  for (const w of FORT_WATERS) {
    const s = new THREE.Mesh(geo(new THREE.CircleGeometry(1, 40)), w.kind === 'lake' ? lakeM : tailM); s.rotation.x = -Math.PI / 2; s.scale.set(w.rx * 1.2, w.rz * 1.2, 1); s.position.set(w.x, w.kind === 'lake' ? -0.45 : -0.3, w.z); s.receiveShadow = true; s.userData.part = w.kind; waters.add(s);
  }
  return { inner, outer, waters };
}

/** Deep Ore Mine pit: annular benches stepping down into the carved hole (the old stacked full discs hid each other and
 *  fought the ground at y = 0), plus a raised spoil berm around the rim. */
export function buildMinePit(g: THREE.Object3D, mat: (p: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial, geo: <G extends THREE.BufferGeometry>(g: G) => G) {
  const benchM = mat({ color: 0x7a5a3a, roughness: 1, flatShading: true, side: THREE.DoubleSide }); const wallM = mat({ color: 0x5e4630, roughness: 1, flatShading: true, side: THREE.DoubleSide });
  const R = [16, 12.6, 9.2, 5.8], step = MINE_PIT.depth / R.length;
  for (let i = 0; i < R.length; i++) {
    const top = -i * step, y = -(i + 1) * step; const r0 = R[i]!, r1 = R[i + 1] ?? 0;
    const wall = new THREE.Mesh(geo(new THREE.CylinderGeometry(r0, r0 - 0.6, step, 28, 1, true)), wallM); wall.position.set(0, (top + y) / 2, 0); wall.userData.part = 'pitWall'; g.add(wall);
    const floor = new THREE.Mesh(geo(r1 > 0 ? new THREE.RingGeometry(r1, r0 - 0.6, 28) : new THREE.CircleGeometry(r0 - 0.6, 28)), benchM); floor.rotation.x = -Math.PI / 2; floor.position.y = y; floor.receiveShadow = true; floor.userData.part = 'pitBench'; g.add(floor);
  }
  const berm = new THREE.Mesh(geo(new THREE.LatheGeometry([new THREE.Vector2(MINE_PIT.r - 0.1, -0.6), new THREE.Vector2(MINE_PIT.r + 0.3, 0.7), new THREE.Vector2(MINE_PIT.r + 1.8, 0.9), new THREE.Vector2(MINE_PIT.r + 4.5, -0.25)], 32)), mat({ color: 0x8a6a48, roughness: 1, flatShading: true }));
  berm.userData.part = 'pitBerm'; berm.receiveShadow = true; g.add(berm);
}

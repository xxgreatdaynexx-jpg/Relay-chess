/**
 * Billionaire 2x land, drawn with the original city's systems and materials: the curved expansion road network
 * (ribbons + junction caps + cul-de-sac circles in the city asphalt, centre dashes on collectors, edge lines on the
 * highway/parkway, sidewalks in Goldwood), bridges over the Goldwood River, the river itself (the lake's water shader
 * and sloped bank), driveways to every plot, and Goldwood's gates and central green. Geometry comes from shared/.
 */
import * as THREE from 'three';
import { EXP_BRIDGES, EXP_CUL_ENDS, EXP_CUL_R, EXP_JUNCTIONS, EXP_PAVED, EXP_ROADS, expRoadClearance, type ExpRoad } from '../../../shared/expansionRoads';
import { RIVER_BANKS, RIVER_PTS, riverClearance, riverHalfW } from '../../../shared/expansionRiver';
import { GOLDWOOD_GATES, GOLDWOOD_GREEN, GOLDWOOD_POND } from '../../../shared/expansionScenery';
import { estateLots, expansionFarms, goldwoodHomes, wineryPlots, WINERY_VISUAL, GOLDWOOD_SETBACK } from '../../../shared/mapExpansion';
import { orchardPlots } from '../../../shared/orchard';

type P = [number, number];
type MatFn = (o: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial;
type GeoFn = <T extends THREE.BufferGeometry>(g: T) => T;
export interface ExpansionLandCtx {
  scene: THREE.Scene; mat: MatFn; geo: GeoFn; low: boolean; xm: boolean; roadY: number;
  roadMat: THREE.Material; dashMat: THREE.Material;
  /** The lake's animated water material for an outline; optional custom distance-to-shore and texture box. */
  makeWater: (outline: P[], holes?: P[][], dist?: (x: number, z: number) => number) => THREE.Material;
  addSlush?: (g: THREE.BufferGeometry[]) => void;
  pickables?: THREE.Object3D[];
}

const centre = (r: ExpRoad): P[] => (r.closed ? [...r.pts, r.pts[0], r.pts[1]] : r.pts);
/** Ribbon along a polyline at lateral offset `off` (left of travel), `w` wide, at height y. */
function ribbon(pos: number[], idx: number[], pts: P[], off: number, w: number, y: number, keep?: (x: number, z: number) => boolean) {
  let base = pos.length / 3; let prevOk = false;
  for (let i = 0; i < pts.length; i++) {
    const a0 = pts[Math.max(0, i - 1)], a1 = pts[Math.min(pts.length - 1, i + 1)]; const ang = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]);
    const nx = -Math.sin(ang), nz = Math.cos(ang); const cx = pts[i][0] + nx * off, cz = pts[i][1] + nz * off;
    const ok = !keep || keep(cx, cz);
    pos.push(cx + nx * w / 2, y, cz + nz * w / 2, cx - nx * w / 2, y, cz - nz * w / 2);
    const k = base + i * 2; if (i && ok && prevOk) idx.push(k - 2, k, k - 1, k - 1, k, k + 1); // wound to face up
    prevOk = ok;
  }
}
const meshOf = (pos: number[], idx: number[]) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };

export function addExpansionLand(c: ExpansionLandCtx) {
  const { scene, mat, geo, low, xm, roadY } = c;
  const d = new THREE.Object3D();
  const inst = (g: THREE.BufferGeometry, m: THREE.Material, n: number, f: (i: number) => void, noShadow = false) => { if (!n) return null;
    const im = new THREE.InstancedMesh(g, m, n); for (let i = 0; i < n; i++) { d.position.set(0, 0, 0); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); f(i); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }
    im.userData.noShadow = noShadow || low; scene.add(im); return im; };

  // ---- roads: one merged asphalt mesh (paved), one dirt mesh (farm tracks), one gravel mesh (footpaths) ----
  const paved = EXP_ROADS.filter((r) => EXP_PAVED[r.kind]);
  { const pos: number[] = []; const idx: number[] = [];
    for (const r of paved) ribbon(pos, idx, centre(r), 0, r.width, roadY, undefined);
    const disc = (cx: number, cz: number, rad: number) => { const c0 = pos.length / 3; pos.push(cx, roadY, cz); for (let j = 0; j <= 24; j++) { const a = (j / 24) * Math.PI * 2; pos.push(cx + Math.cos(a) * rad, roadY, cz + Math.sin(a) * rad); if (j) idx.push(c0, c0 + j, c0 + j + 1); } };
    for (const j of EXP_JUNCTIONS) disc(j.x, j.z, j.r);
    for (const [x, z] of EXP_CUL_ENDS) disc(x, z, EXP_CUL_R);
    const g = geo(meshOf(pos, idx)); const m = new THREE.Mesh(g, c.roadMat); m.renderOrder = 1; scene.add(m); c.addSlush?.([g]); }
  const tracks = EXP_ROADS.filter((r) => !EXP_PAVED[r.kind]);
  if (tracks.length) { const pos: number[] = []; const idx: number[] = []; for (const r of tracks) ribbon(pos, idx, centre(r), 0, r.width, roadY - 0.01);
    scene.add(new THREE.Mesh(geo(meshOf(pos, idx)), mat({ color: 0x8a7a62, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }))); }

  // ---- markings: yellow centre dashes (collectors and up), double yellow + white edge lines on highway/parkway ----
  const nearJ = (x: number, z: number, pad: number) => EXP_JUNCTIONS.some((j) => Math.hypot(j.x - x, j.z - z) < j.r + pad);
  const dashes: Array<[number, number, number]> = [];
  for (const r of paved) { if (r.kind !== 'collector' && r.kind !== 'parkway' && r.kind !== 'highway') continue; const p = centre(r);
    const offs = r.kind === 'highway' ? [-0.2, 0.2] : [0];
    for (let i = 1; i < p.length - 1; i += r.kind === 'highway' ? 1 : 3) { if (nearJ(p[i][0], p[i][1], 1.2)) continue; const ang = Math.atan2(p[i + 1][1] - p[i - 1][1], p[i + 1][0] - p[i - 1][0]);
      for (const o of offs) dashes.push([p[i][0] - Math.sin(ang) * o, p[i][1] + Math.cos(ang) * o, ang]); } }
  inst(new THREE.BoxGeometry(1.2, 0.02, 0.16), c.dashMat, dashes.length, (i) => { const [x, z, a] = dashes[i]; d.position.set(x, roadY + 0.03, z); d.rotation.set(0, -a, 0); }, true)!.renderOrder = 2;
  { const pos: number[] = []; const idx: number[] = [];
    for (const r of paved) { if (r.kind !== 'highway' && r.kind !== 'parkway') continue; const hw = r.width / 2 - 0.35;
      for (const s of [1, -1]) ribbon(pos, idx, centre(r), hw * s, 0.16, roadY + 0.025, (x, z) => !nearJ(x, z, 0.6)); }
    const m = new THREE.Mesh(geo(meshOf(pos, idx)), mat({ color: 0xe8ecf2, emissive: 0x8a8f98, emissiveIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })); m.renderOrder = 2; m.userData.noShadow = true; scene.add(m); }
  // ---- Goldwood sidewalks + curbs (pale concrete, a hair above the asphalt) ----
  { const pos: number[] = []; const idx: number[] = []; const curbP: number[] = []; const curbI: number[] = [];
    const keep = (x: number, z: number) => expRoadClearance(x, z, 10) > -0.05 && riverClearance(x, z) > 0.5;
    for (const r of paved) { if (!(r.id === 'gw-circle' || r.id === 'gw-drive')) continue; const hw = r.width / 2;
      for (const s of [1, -1]) { ribbon(pos, idx, centre(r), (hw + 1.05) * s, 1.5, roadY + 0.03, keep); ribbon(curbP, curbI, centre(r), (hw + 0.18) * s, 0.36, roadY + 0.07, keep); } }
    scene.add(new THREE.Mesh(geo(meshOf(pos, idx)), mat({ color: xm ? 0xc9ccd2 : 0xbdb8ae, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })));
    scene.add(new THREE.Mesh(geo(meshOf(curbP, curbI)), mat({ color: 0xd8d6d0, roughness: 0.9 }))); }

  // ---- driveways: every plot gets a drive from its front to the nearest street ----
  { const pos: number[] = []; const idx: number[] = []; const dirtP: number[] = []; const dirtI: number[] = [];
    const drive = (fx: number, fz: number, ux: number, uz: number, w: number, P: number[], I: number[]) => { let L = 0; for (; L < 14; L += 0.5) if (expRoadClearance(fx + ux * L, fz + uz * L, 10) <= -0.6) break; if (L >= 14 || L < 0.3) return;
      ribbon(P, I, [[fx - ux * 0.5, fz - uz * 0.5], [fx + ux * L, fz + uz * L]], 0, w, roadY - 0.005); };
    const nearestDir = (x: number, z: number): [number, number] => { let best = Infinity, bx = 0, bz = 1; for (let a = 0; a < 32; a++) { const t = (a / 32) * Math.PI * 2; const ux = Math.sin(t), uz = Math.cos(t);
      for (let L = 2; L < 50; L += 1.5) if (expRoadClearance(x + ux * L, z + uz * L, 8) <= 0) { if (L < best) { best = L; bx = ux; bz = uz; } break; } } return [bx, bz]; };
    for (const l of estateLots()) { const ux = Math.sin(l.rot), uz = Math.cos(l.rot); drive(l.x + ux * l.d / 2, l.z + uz * l.d / 2, ux, uz, 4, pos, idx); }
    for (const h of goldwoodHomes()) { const ux = Math.sin(h.rot), uz = Math.cos(h.rot); for (const lat of [-4, 8]) drive(h.x + ux * (GOLDWOOD_SETBACK - 2.6) + uz * lat, h.z + uz * (GOLDWOOD_SETBACK - 2.6) - ux * lat, ux, uz, 3.4, pos, idx); }
    for (const v of wineryPlots()) { const ux = Math.sin(v.rot), uz = Math.cos(v.rot); drive(v.x + ux * (WINERY_VISUAL.dz + WINERY_VISUAL.d / 2 - 0.5), v.z + uz * (WINERY_VISUAL.dz + WINERY_VISUAL.d / 2 - 0.5), ux, uz, 4, pos, idx); }
    for (const f of [...expansionFarms(), ...orchardPlots()]) { const [ux, uz] = nearestDir(f.x, f.z); const ex = Math.abs(ux) > Math.abs(uz) ? f.w / 2 : f.d / 2; const k = ex / Math.max(Math.abs(ux), Math.abs(uz));
      // square the drive to the field edge (fields are compass-aligned)
      const sx = Math.abs(ux) > Math.abs(uz) ? Math.sign(ux) : 0, sz = sx ? 0 : Math.sign(uz); drive(f.x + sx * f.w / 2 + (sx ? 0 : ux * k * 0.4), f.z + sz * f.d / 2 + (sz ? 0 : uz * k * 0.4), sx, sz, 3, dirtP, dirtI); }
    scene.add(new THREE.Mesh(geo(meshOf(pos, idx)), mat({ color: xm ? 0xb8bcc4 : 0xb5b0a6, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
    scene.add(new THREE.Mesh(geo(meshOf(dirtP, dirtI)), mat({ color: 0x7a6a52, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }))); }

  // ---- the Goldwood River: lake water shader in chunks (so the shore texture stays sharp), sloped sand/grass banks ----
  { const N = RIVER_PTS.length; const CH = 48; const L = RIVER_BANKS.left, R = RIVER_BANKS.right;
    for (let i0 = 0; i0 < N - 1; i0 += CH) { const i1 = Math.min(N - 1, i0 + CH); const outline: P[] = [...L.slice(i0, i1 + 1), ...R.slice(i0, i1 + 1).reverse()];
      const sh = new THREE.Shape(); outline.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z))); sh.closePath();
      const wg = new THREE.ShapeGeometry(sh, 2); wg.rotateX(Math.PI / 2); const w = new THREE.Mesh(geo(wg), c.makeWater(outline, [], (x, z) => Math.max(0, -riverClearance(x, z)))); w.position.y = 0.06; w.renderOrder = 1; w.userData.noShadow = true; scene.add(w); }
    const BANK: Array<[number, number, number]> = [[-1.6, 0.02, 0x6f6048], [0, 0.04, 0x8e7a58], [1.3, 0.04, 0xc9b48a], [2.8, 0.03, xm ? 0xd9dccf : 0xa89a6c], [4.6, 0.012, xm ? 0xeef2f8 : 0x3f9a45]];
    const pos: number[] = []; const col: number[] = []; const bi: number[] = []; const cc = new THREE.Color();
    for (const [bank, sgn] of [[L, -1], [R, 1]] as const) { const base = pos.length / 3; const RR = BANK.length;
      bank.forEach(([x, z], i) => { const a = RIVER_PTS[Math.max(0, i - 1)], b = RIVER_PTS[Math.min(N - 1, i + 1)]; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const nx = -Math.sin(ang) * sgn, nz = Math.cos(ang) * sgn;
        for (const [o, y, hx] of BANK) { pos.push(x + nx * o, y, z + nz * o); cc.setHex(hx); col.push(cc.r, cc.g, cc.b); } });
      for (let i = 0; i < bank.length - 1; i++) for (let r = 0; r < RR - 1; r++) { const a = base + i * RR + r, b = base + (i + 1) * RR + r; bi.push(a, b, a + 1, a + 1, b, b + 1); } }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); bg.setIndex(bi); bg.computeVertexNormals();
    const bm = new THREE.Mesh(geo(bg), mat({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })); bm.userData.noShadow = true; scene.add(bm); }

  // ---- bridges: concrete deck under the road ribbon, parapets with posts, piers in the water, abutments; one steel arch ----
  { const deck = mat({ color: 0x8c8e94, roughness: 0.85 }), rail = mat({ color: 0xc9ccd2, roughness: 0.6, metalness: 0.2 }), pier = mat({ color: 0x74767c, roughness: 0.9 }), steel = mat({ color: 0x3f6f8f, roughness: 0.45, metalness: 0.6 });
    const wood = mat({ color: 0x7a5a3a, roughness: 0.9 });
    const box = new THREE.BoxGeometry(1, 1, 1); geo(box);
    const parts: Array<{ m: THREE.Material; x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number }> = [];
    for (const b of EXP_BRIDGES) { const ca = Math.cos(b.ang), sa = Math.sin(b.ang); const ry = -b.ang; const W = b.width;
      const at = (along: number, lat: number): [number, number] => [b.x + ca * along - sa * lat, b.z + sa * along + ca * lat];
      if (b.foot) { parts.push({ m: wood, x: b.x, y: 0.25, z: b.z, sx: b.len, sy: 0.18, sz: W, ry }); for (const s of [1, -1]) { const [x, z] = at(0, (W / 2) * s); parts.push({ m: wood, x, y: 0.95, z, sx: b.len, sy: 0.1, sz: 0.12, ry }); } continue; }
      parts.push({ m: deck, x: b.x, y: roadY - 0.32, z: b.z, sx: b.len, sy: 0.62, sz: W, ry });
      for (const s of [1, -1]) { const [x, z] = at(0, (W / 2 - 0.15) * s); parts.push({ m: rail, x, y: roadY + 0.5, z, sx: b.len, sy: 0.12, sz: 0.18, ry }); parts.push({ m: deck, x, y: roadY + 0.18, z, sx: b.len, sy: 0.36, sz: 0.3, ry });
        for (let t = -b.len / 2 + 0.6; t <= b.len / 2 - 0.5; t += 2) { const [px, pz] = at(t, (W / 2 - 0.15) * s); parts.push({ m: rail, x: px, y: roadY + 0.3, z: pz, sx: 0.12, sy: 0.5, sz: 0.12, ry }); } }
      for (const t of [-b.len / 2 + 0.8, b.len / 2 - 0.8]) { const [x, z] = at(t, 0); parts.push({ m: pier, x, y: -0.2, z, sx: 1.6, sy: 0.9, sz: W + 0.6, ry }); }
      const hw = riverHalfW(0) * 0 + Math.max(3, b.len / 2 - 6); for (const t of [-hw / 2, hw / 2]) { const [x, z] = at(t, 0); parts.push({ m: pier, x, y: -0.5, z, sx: 0.9, sy: 1.0, sz: W - 0.6, ry }); }
      if (b.road === 'ee-coast') { // a pair of low steel arches over the highway bridge
        for (const s of [1, -1]) for (let k = 0; k <= 12; k++) { const t = -b.len / 2 + 1.5 + (k / 12) * (b.len - 3); const h = Math.sin((k / 12) * Math.PI) * 4.2; const [x, z] = at(t, (W / 2 - 0.15) * s);
          parts.push({ m: steel, x, y: roadY + 0.6 + h, z, sx: (b.len - 3) / 12 + 0.25, sy: 0.32, sz: 0.32, ry });
          if (k % 2 === 0 && k > 0 && k < 12) parts.push({ m: steel, x, y: roadY + 0.6 + h / 2, z, sx: 0.08, sy: h, sz: 0.08, ry }); } } }
    const byMat = new Map<THREE.Material, typeof parts>(); for (const p of parts) (byMat.get(p.m) ?? byMat.set(p.m, []).get(p.m)!).push(p);
    for (const [m, list] of byMat) inst(box, m, list.length, (i) => { const p = list[i]; d.position.set(p.x, p.y, p.z); d.rotation.set(0, p.ry, 0); d.scale.set(p.sx, p.sy, p.sz); }); }

  // ---- Goldwood: central green with a pond, a gravel ring path, a gazebo and benches; gates with stone piers ----
  { const G = GOLDWOOD_GREEN; const pts: P[] = []; for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push([G.x + Math.cos(a) * G.rx, G.z + Math.sin(a) * G.rz]); }
    // lawn (snowy in winter): a slightly raised pad so the green reads as a landscaped park
    { const sh = new THREE.Shape(); pts.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z))); const g = new THREE.ShapeGeometry(sh, 2); g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(geo(g), mat({ color: xm ? 0xe6f0ea : 0x4a9a4a, roughness: 1, emissive: xm ? 0x14261c : 0x0f3a14, emissiveIntensity: 0.5, side: THREE.DoubleSide })); m.position.y = 0.025; m.userData.noShadow = true; scene.add(m); }
    // ring path + two cross paths (gravel)
    { const pos: number[] = []; const idx: number[] = []; const ring: P[] = []; for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; ring.push([G.x + Math.cos(a) * (G.rx - 7), G.z + Math.sin(a) * (G.rz - 6)]); }
      ribbon(pos, idx, ring, 0, 2.2, 0.07); ribbon(pos, idx, [[G.x - G.rx + 1, G.z], [G.x - 30, G.z - 6], [G.x - 6, G.z - 12]], 0, 1.8, 0.07); ribbon(pos, idx, [[G.x + 40, G.z - G.rz + 1], [G.x + 30, G.z - 14]], 0, 1.8, 0.07);
      scene.add(new THREE.Mesh(geo(meshOf(pos, idx)), mat({ color: xm ? 0xcfc6b4 : 0xc8b48a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))); }
    // pond: the lake water and a sandy bank ring
    { const P0 = GOLDWOOD_POND; const o: P[] = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; const k = 1 + 0.08 * Math.sin(a * 3 + 1.1); o.push([P0.x + Math.cos(a) * P0.rx * k, P0.z + Math.sin(a) * P0.rz * k]); }
      const sh = new THREE.Shape(); o.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z))); const g = new THREE.ShapeGeometry(sh, 2); g.rotateX(Math.PI / 2);
      const w = new THREE.Mesh(geo(g), c.makeWater(o)); w.position.y = 0.11; w.renderOrder = 1; w.userData.noShadow = true; scene.add(w);
      const ring = new THREE.Mesh(geo(new THREE.RingGeometry(1, 1.16, 48)), mat({ color: 0xc9b48a, roughness: 1, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.scale.set(P0.rx * 1.04, P0.rz * 1.1, 1); ring.position.set(P0.x, 0.09, P0.z); scene.add(ring);
      // a little stone footbridge-jetty and a fountain jet
      const jet = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.15, 0.5, 2.6, 8)), mat({ color: 0xdff4ff, emissive: 0x88c8ff, emissiveIntensity: 0.4, transparent: true, opacity: 0.75 })); jet.position.set(P0.x, 1.35, P0.z); scene.add(jet); }
    // gazebo on the west lawn, benches around the ring
    { const gx = G.x - 40, gz = G.z + 6; const white = mat({ color: 0xf2efe8, roughness: 0.8 }), roofM = mat({ color: 0x2f5a3a, roughness: 0.7 });
      const base = new THREE.Mesh(geo(new THREE.CylinderGeometry(4.2, 4.4, 0.4, 8)), white); base.position.set(gx, 0.2, gz); scene.add(base);
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; const p = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.14, 0.14, 2.8, 6)), white); p.position.set(gx + Math.cos(a) * 3.7, 1.8, gz + Math.sin(a) * 3.7); scene.add(p); }
      const roof = new THREE.Mesh(geo(new THREE.ConeGeometry(5, 2.2, 8)), roofM); roof.position.set(gx, 4.3, gz); scene.add(roof);
      if (xm) { const cap = new THREE.Mesh(geo(new THREE.ConeGeometry(4.2, 1.2, 8)), mat({ color: 0xf6f9ff, roughness: 0.9 })); cap.position.set(gx, 4.75, gz); scene.add(cap); }
      const bench = mat({ color: 0x6a4a2a, roughness: 0.9 }); const bl: Array<[number, number, number]> = [];
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 + 0.3; bl.push([G.x + Math.cos(a) * (G.rx - 9.6), G.z + Math.sin(a) * (G.rz - 8.4), a]); }
      inst(new THREE.BoxGeometry(2.2, 0.5, 0.7), bench, bl.length, (i) => { const [x, z, a] = bl[i]; d.position.set(x, 0.45, z); d.rotation.set(0, -a + Math.PI / 2, 0); }); }
    // park trees just inside the ring path and lamps along it (the city's tree + streetlight)
    { const trunkM = mat({ color: 0x5a3a22, roughness: 1 }), crownM = mat({ color: 0x2f8a3a, flatShading: true, roughness: 0.95, emissive: 0x0a2a10, emissiveIntensity: 0.4 });
      const P0 = GOLDWOOD_POND; const trees: Array<[number, number, number]> = []; const lamps: P[] = [];
      for (let i = 0; i < 44; i++) { const a = (i / 44) * Math.PI * 2 + 0.05; const x = G.x + Math.cos(a) * (G.rx - 14), z = G.z + Math.sin(a) * (G.rz - 12.5);
        if (Math.hypot(x - (G.x - 40), z - (G.z + 6)) < 9 || ((x - P0.x) / (P0.rx + 5)) ** 2 + ((z - P0.z) / (P0.rz + 5)) ** 2 < 1) continue; if (i % 11 === 3) continue; trees.push([x, z, 0.9 + ((i * 37) % 7) / 14]); }
      for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; lamps.push([G.x + Math.cos(a) * (G.rx - 5.4), G.z + Math.sin(a) * (G.rz - 4.6)]); }
      inst(geo(new THREE.CylinderGeometry(0.15, 0.22, 1, 6)), trunkM, trees.length, (i) => { const [x, z, s] = trees[i]; d.position.set(x, 0.7 * s, z); d.scale.set(s, 1.4 * s, s); });
      inst(geo(new THREE.IcosahedronGeometry(1, 0)), crownM, trees.length, (i) => { const [x, z, s] = trees[i]; d.position.set(x, 2.1 * s, z); d.scale.set(s * 1.3, s * 1.4, s * 1.3); d.rotation.y = i; });
      if (xm) inst(geo(new THREE.SphereGeometry(0.5, 6, 4)), mat({ color: 0xf3f7ff, roughness: 0.95 }), trees.length, (i) => { const [x, z, s] = trees[i]; d.position.set(x, 2.95 * s, z); d.scale.set(s, s * 0.5, s); });
      inst(geo(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 4)), mat({ color: 0x40444f, roughness: 0.6, metalness: 0.25 }), lamps.length, (i) => d.position.set(lamps[i][0], 1.2, lamps[i][1]));
      inst(geo(new THREE.SphereGeometry(0.22, 8, 6)), mat({ color: 0xfff0c0, emissive: 0xffd080, emissiveIntensity: 1 }), lamps.length, (i) => d.position.set(lamps[i][0], 2.45, lamps[i][1]), true);
      // flower beds / clipped box hedges around the gazebo
      const bedM = mat({ color: xm ? 0x2f6b32 : 0xc04a6a, roughness: 1 }); const beds: P[] = []; for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.39; beds.push([G.x - 40 + Math.cos(a) * 6.5, G.z + 6 + Math.sin(a) * 6.5]); }
      inst(geo(new THREE.CylinderGeometry(0.9, 1, 0.5, 8)), bedM, beds.length, (i) => d.position.set(beds[i][0], 0.25, beds[i][1])); }
    // gates: two stone piers each side, a gatehouse, a boom arm and a lit name board
    for (const g of GOLDWOOD_GATES) { const r = EXP_ROADS.find((o) => o.id === g.road)!; const W = r.width / 2 + 1.2; const ca = Math.cos(g.ang), sa = Math.sin(g.ang);
      const at = (along: number, lat: number): [number, number] => [g.x + ca * along - sa * lat, g.z + sa * along + ca * lat];
      const stone = mat({ color: 0xcfc6b4, roughness: 0.95 }), cap = mat({ color: 0x8a8070, roughness: 0.9 }), goldM = mat({ color: 0xd4af37, metalness: 0.7, roughness: 0.3, emissive: 0x6a5010, emissiveIntensity: 0.4 });
      for (const s of [1, -1]) { for (const o of [0, 2.4]) { const [x, z] = at(0, s * (W + o)); const p = new THREE.Mesh(geo(new THREE.BoxGeometry(1.4, 3.2, 1.4)), stone); p.position.set(x, 1.6, z); p.rotation.y = -g.ang; scene.add(p);
        const k = new THREE.Mesh(geo(new THREE.BoxGeometry(1.7, 0.35, 1.7)), cap); k.position.set(x, 3.35, z); k.rotation.y = -g.ang; scene.add(k);
        const lampG = new THREE.Mesh(geo(new THREE.SphereGeometry(0.32, 8, 6)), mat({ color: 0xfff0c0, emissive: 0xffd080, emissiveIntensity: 1 })); lampG.position.set(x, 3.8, z); scene.add(lampG); }
        // low stone wall running off each side
        const [wx, wz] = at(0, s * (W + 9)); const wall = new THREE.Mesh(geo(new THREE.BoxGeometry(0.8, 1.2, 12)), stone); wall.position.set(wx, 0.6, wz); wall.rotation.y = -g.ang; scene.add(wall); }
      // gatehouse on the right of the inbound lane
      { const [x, z] = at(-6, W + 6); const hse = new THREE.Mesh(geo(new THREE.BoxGeometry(5, 3.2, 4)), stone); hse.position.set(x, 1.6, z); hse.rotation.y = -g.ang; scene.add(hse);
        const rf = new THREE.Mesh(geo(new THREE.ConeGeometry(4, 1.8, 4)), mat({ color: 0x3a3a40, roughness: 0.8 })); rf.position.set(x, 4.1, z); rf.rotation.y = -g.ang + Math.PI / 4; scene.add(rf);
        const win = new THREE.Mesh(geo(new THREE.BoxGeometry(5.05, 1, 2.6)), mat({ color: 0xffe0a0, emissive: 0xffc060, emissiveIntensity: 0.6 })); win.position.set(x, 1.9, z); win.rotation.y = -g.ang; scene.add(win); }
      // boom arm (raised) and a gold-lettered name board over the entrance
      { const [x, z] = at(0, -(W - 0.4)); const arm = new THREE.Mesh(geo(new THREE.BoxGeometry(0.2, 0.2, W * 1.6)), mat({ color: 0xf2f2f2, emissive: 0x440000, emissiveIntensity: 0.2 })); arm.position.set(x, 2.6, z); arm.rotation.set(0.9, -g.ang, 0); scene.add(arm); }
      { const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null; if (cv) { cv.width = 512; cv.height = 96; const k = cv.getContext('2d')!; k.fillStyle = '#1f2a22'; k.fillRect(0, 0, 512, 96); k.strokeStyle = '#d4af37'; k.lineWidth = 6; k.strokeRect(6, 6, 500, 84);
        k.fillStyle = '#e8c860'; k.font = 'bold 54px Georgia, serif'; k.textAlign = 'center'; k.textBaseline = 'middle'; k.fillText(g.label, 256, 52);
        const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; const bm = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35 });
        const [x, z] = at(0, 0); const board = new THREE.Mesh(geo(new THREE.BoxGeometry(0.25, 1.4, W * 2 + 2.4)), [bm, bm, goldM, goldM, goldM, goldM]); board.position.set(x, 4.4, z); board.rotation.y = -g.ang; scene.add(board);
        const beam = new THREE.Mesh(geo(new THREE.BoxGeometry(0.3, 0.3, W * 2 + 3.4)), cap); beam.position.set(x, 3.6, z); beam.rotation.y = -g.ang; scene.add(beam); } } } }
}

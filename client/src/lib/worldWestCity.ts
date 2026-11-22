/**
 * West Chud renderer (shared/westCity.ts): ground, the curved road network (city asphalt, junction caps, cul-de-sacs,
 * centre dashes, Westgate sidewalks), street trees and woods, streetlights, parked cars and traffic, and the district
 * landmarks: the Westgate Spire and Square, Westgate Park, West Chud Stadium, Ironworks, the container port, the marina,
 * the lighthouse and the wind farm. Housing and patches are drawn (and picked) by world3d with the rest of the city.
 *
 * Mobile: almost everything is instanced (one draw per geometry + material); low tier thins trees, lights and props
 * and skips parked cars.
 */
import * as THREE from 'three';
import { routePoint, LANE, PLATE, type OBB } from './worldLayout';
import {
  WEST_GROUND, WEST_ROADS, WEST_JUNCTIONS, WEST_CUL_ENDS, WEST_CUL_R, WEST_CAR_ROUTES, WEST_CAR_COUNT, WEST_LABELS, WEST_WAREHOUSES,
  WESTGATE_PARK, WESTGATE_SQUARE, WEST_STADIUM, WEST_PORT, WEST_MARINA, WEST_LIGHTHOUSE, WIND_TURBINES, WIND_X, WEST_TOWN, WEST_POCKET, WEST_LAKES, WEST_CREEK, WEST_CREEK_W, WEST_HILLS, WEST_FARMS, WEST_FIELDS, WEST_YARDS, WEST_HAMLETS, WEST_LAKESIDE, WEST_MEADOWS, WEST_OUTCROPS, WEST_DECOR_SOLIDS, lakeOutline, creekClearance, lakeClearance, nearWater, WEST, westTown, westFill, westRoadClearance, westDistrict, toLocal, onWest,
} from '../../../shared/westCity';
import { OCEAN, coastZ } from '../../../shared/ocean';
import { inBridgeSite } from '../../../shared/coop';

type P = [number, number];
type MatFn = (o: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial;
type GeoFn = <T extends THREE.BufferGeometry>(g: T) => T;
export interface WestCityCtx {
  scene: THREE.Scene; mat: MatFn; geo: GeoFn; low: boolean; xm: boolean; roadY: number;
  roadMat: THREE.Material; dashMat: THREE.Material;
  /** Top face of the ground slab (city grass, or the snow ground in the Christmas theme). */
  groundTop: (w: number, d: number, x0: number, z1: number) => THREE.Material;
  makeWater: (outline: P[]) => THREE.Material;
  tree: { trunkGeo: THREE.BufferGeometry; trunkMat: THREE.Material; crownGeo: THREE.BufferGeometry; crownMat: THREE.Material };
  pole: { geo: THREE.BufferGeometry; mat: THREE.Material };
  glowTex: THREE.Texture;
  label: (text: string, color: string) => THREE.Texture;
  addSlush?: (g: THREE.BufferGeometry[]) => void;
}

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
const hash2 = (i: number, j: number) => { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function addWestCity(c: WestCityCtx) {
  const { scene, mat, geo, low, xm, roadY } = c;
  const disposables: Array<{ dispose(): void }> = [];
  const rand = rng(911);
  const { houses, patches } = westFill();

  /* ---- batched pieces: one InstancedMesh per (shape, material), tinted per instance ---- */
  const shapes = {
    box: geo(new THREE.BoxGeometry(1, 1, 1)),
    cyl: geo(new THREE.CylinderGeometry(0.5, 0.5, 1, 14)),
    cyl6: geo(new THREE.CylinderGeometry(0.5, 0.5, 1, 6)),
    cone: geo(new THREE.ConeGeometry(0.5, 1, 10)),
    taper: geo(new THREE.CylinderGeometry(0.36, 0.5, 1, 12)),
    sphere: geo(new THREE.SphereGeometry(0.5, 10, 8)),
    ball: geo(new THREE.SphereGeometry(0.5, 6, 4)),
    flower: geo(new THREE.OctahedronGeometry(0.5, 0)),
    rock: geo(new THREE.DodecahedronGeometry(0.5, 0)),
    prism: geo(new THREE.CylinderGeometry(0.5, 0.5, 1, 3).rotateZ(Math.PI / 2).rotateX(Math.PI / 6)),
  };
  type Shape = keyof typeof shapes;
  const batches = new Map<string, { shape: Shape; m: THREE.Material; items: Array<{ mx: THREE.Matrix4; col: number }> }>();
  const dummy = new THREE.Object3D();
  /** Add a piece: centre (x, y, z), size (sx, sy, sz), rotation (rx, ry, rz), tint. */
  const piece = (shape: Shape, m: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, col = 0xffffff, rx = 0, rz = 0) => {
    const key = `${shape}|${m.uuid}`; let b = batches.get(key); if (!b) { b = { shape, m, items: [] }; batches.set(key, b); }
    dummy.position.set(x, y, z); dummy.rotation.set(rx, ry, rz, 'YXZ'); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); b.items.push({ mx: dummy.matrix.clone(), col });
  };
  /** Box standing on y0 (bottom face), turned by ry. */
  const block = (m: THREE.Material, x: number, y0: number, z: number, w: number, h: number, d: number, ry = 0, col = 0xffffff) => piece('box', m, x, y0 + h / 2, z, w, h, d, ry, col);
  const flush = () => { for (const b of batches.values()) { const im = new THREE.InstancedMesh(shapes[b.shape], b.m, b.items.length); const cc = new THREE.Color();
      b.items.forEach((it, i) => { im.setMatrixAt(i, it.mx); im.setColorAt(i, cc.setHex(it.col)); }); im.userData.noShadow = low; scene.add(im); } batches.clear(); };
  /** Local offset (lx along the box's width axis, lz along its depth axis) to world, for a footprint turned by rot. */
  const at = (b: { x: number; z: number; rot: number }, lx: number, lz: number): P => { const cs = Math.cos(b.rot), sn = Math.sin(b.rot); return [b.x + lx * cs + lz * sn, b.z - lx * sn + lz * cs]; };

  // materials (white base: instance colour tints)
  const M = {
    paint: mat({ color: 0xffffff, roughness: 0.75 }),
    metal: mat({ color: 0xffffff, roughness: 0.4, metalness: 0.55 }),
    concrete: mat({ color: 0xffffff, roughness: 0.95 }),
    glass: mat({ color: 0x9fd8ff, roughness: 0.15, metalness: 0.4, emissive: 0x2a6a9a, emissiveIntensity: 0.55 }),
    neon: mat({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9 }),
    leaf: mat({ color: 0xffffff, roughness: 1, flatShading: true }),
    sail: mat({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }),
  };

  /* ---- ground ---- */
  { const G = WEST_GROUND; const w = G.x1 - G.x0, d = G.z1 - G.z0; const dirt = mat({ color: 0x4a3322 });
    const g = new THREE.Mesh(geo(new THREE.BoxGeometry(w, 3, d)), [dirt, dirt, c.groundTop(w, d, G.x0, G.z1), dirt, dirt, dirt]); g.position.set((G.x0 + G.x1) / 2, -1.53, (G.z0 + G.z1) / 2); scene.add(g); }

  /* ---- roads: asphalt ribbons + caps and centre dashes, painted exactly like the old city's (no sidewalks or crossings there) ---- */
  const ribbon = (pos: number[], idx: number[], pts: P[], w: number, y: number, keep?: (x: number, z: number) => boolean) => {
    const base = pos.length / 3; let prev = false;
    for (let i = 0; i < pts.length; i++) { const a0 = pts[Math.max(0, i - 1)], a1 = pts[Math.min(pts.length - 1, i + 1)]; const ang = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]); const nx = -Math.sin(ang) * w / 2, nz = Math.cos(ang) * w / 2;
      pos.push(pts[i][0] + nx, y, pts[i][1] + nz, pts[i][0] - nx, y, pts[i][1] - nz); const ok = !keep || keep(pts[i][0], pts[i][1]);
      if (i && ok && prev) { const o = base + (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); } prev = ok; }
  };
  const disc = (pos: number[], idx: number[], cx: number, cz: number, r: number, y: number) => { const c0 = pos.length / 3; pos.push(cx, y, cz); for (let j = 0; j <= 24; j++) { const a = (j / 24) * Math.PI * 2; pos.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r); if (j) idx.push(c0, c0 + j, c0 + j + 1); } };
  const meshOf = (pos: number[], idx: number[]) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return geo(g); };
  const pts = (r: { closed: boolean; pts: P[] }): P[] => (r.closed ? [...r.pts, r.pts[0], r.pts[1]] : r.pts);
  { const pos: number[] = []; const idx: number[] = [];
    for (const r of WEST_ROADS) ribbon(pos, idx, pts(r), r.width, roadY);
    for (const j of WEST_JUNCTIONS) disc(pos, idx, j.x, j.z, j.r, roadY);
    for (const [x, z] of WEST_CUL_ENDS) disc(pos, idx, x, z, WEST_CUL_R, roadY);
    const g = meshOf(pos, idx); const m = new THREE.Mesh(g, c.roadMat); m.renderOrder = 1; scene.add(m); c.addSlush?.([g]); }
  { const spots: Array<[number, number, number]> = []; const inJ = (x: number, z: number) => WEST_JUNCTIONS.some((j) => Math.abs(j.x - x) < 9 && Math.abs(j.z - z) < 9 && Math.hypot(j.x - x, j.z - z) < j.r + 0.8);
    for (const r of WEST_ROADS) { if (r.kind === 'street' || r.kind === 'lane') continue; const p = r.pts; for (let i = 1; i < p.length - 1; i += 3) if (!inJ(p[i][0], p[i][1])) spots.push([p[i][0], p[i][1], Math.atan2(p[i + 1][1] - p[i - 1][1], p[i + 1][0] - p[i - 1][0])]); }
    const dg = geo(new THREE.BoxGeometry(1.2, 0.02, 0.18)); const dm = new THREE.InstancedMesh(dg, c.dashMat, spots.length);
    spots.forEach(([x, z, a], i) => { dummy.position.set(x, roadY + 0.03, z); dummy.rotation.set(0, -a, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); dm.setMatrixAt(i, dummy.matrix); }); dm.renderOrder = 2; scene.add(dm);
  }

  /* ---- occupancy grid (houses, patches, warehouses, landmarks) for props ---- */
  const solids: OBB[] = [...houses, ...patches, ...WEST_WAREHOUSES, WESTGATE_SQUARE, WEST_STADIUM, WESTGATE_PARK, ...WEST_FARMS, ...WEST_DECOR_SOLIDS];
  const SG = 16; const sgrid = new Map<string, OBB[]>();
  for (const o of solids) { const r = Math.hypot(o.w, o.d) / 2; for (let i = Math.floor((o.x - r) / SG); i <= Math.floor((o.x + r) / SG); i++) for (let j = Math.floor((o.z - r) / SG); j <= Math.floor((o.z + r) / SG); j++) { const k = `${i},${j}`; (sgrid.get(k) ?? sgrid.set(k, []).get(k)!).push(o); } }
  const hitObb = (o: OBB, x: number, z: number, m: number) => { const cs = Math.cos(o.rot), sn = Math.sin(o.rot); const dx = x - o.x, dz = z - o.z; return Math.abs(dx * cs - dz * sn) < o.w / 2 + m && Math.abs(dx * sn + dz * cs) < o.d / 2 + m; };
  const blocked = (x: number, z: number, m: number) => { for (const o of sgrid.get(`${Math.floor(x / SG)},${Math.floor(z / SG)}`) ?? []) if (hitObb(o, x, z, m)) return true; return false; };
  const placeable = (x: number, z: number, m: number, road = 1.2) => onWest(x, z, 2) && westRoadClearance(x, z) > m + road && !blocked(x, z, m);

  /* ---- trees: the old city's planting, same tree and crown colour (world3d.ts): 9 per park, a loose scatter over the
     town at the old plate's density with its clearances, palms along the beach, and the countryside is shared/westScenery.ts ---- */
  const trees: Array<[number, number, number]> = []; // x, z, scale (< 0 = palm)
  const tree = (x: number, z: number, s: number) => trees.push([x, z, s]);
  for (const b of patches) if (b.kind === 'park') for (let i = 0; i < 9; i++) { const [x, z] = at(b, (rand() - 0.5) * (b.w - 2), (rand() - 0.5) * (b.d - 2)); tree(x, z, 0.8 + rand() * 0.7); }
  const inTown = westTown;
  const nearWorks = (x: number, z: number, m: number) => [WEST_PORT, WEST_MARINA].some((o) => hitObb(o, x, z, m)) || Math.abs(x - WIND_X) < 8;
  for (const town of [WEST_TOWN, WEST_POCKET]) { const OLD = (PLATE * 2 * 0.96) ** 2; const tries = Math.round(700 * ((town.x1 - town.x0) * (town.z1 - town.z0)) / OLD); // 700 tries over the old plate
    for (let i = 0; i < tries; i++) { const x = town.x0 + rand() * (town.x1 - town.x0), z = town.z0 + rand() * (town.z1 - town.z0);
      if (!inTown(x, z) || !onWest(x, z, 1) || westRoadClearance(x, z) < 1.4 || blocked(x, z, 1) || nearWorks(x, z, 2)) continue; tree(x, z, 0.7 + rand() * 0.6); } }
  for (let x = WEST.x0 + 3; x < WEST.x1 - 2; x += 4.4) { const z = WEST.z1 - 1.4; if (westRoadClearance(x, z) > 1.4 && !blocked(x, z, 0.8) && !nearWorks(x, z, 3) && !nearWater(x, z, 2)) tree(x, z, -1); }
  // (the countryside strips and wooded blocks are planted by shared/westScenery.ts, drawn with the old open land's trees)
  { const tr = new THREE.InstancedMesh(c.tree.trunkGeo, c.tree.trunkMat, trees.length); const cr = new THREE.InstancedMesh(c.tree.crownGeo, c.tree.crownMat, trees.length);
    trees.forEach(([x, z, s], i) => { const palm = s < 0; const sc = palm ? 1 : s; const th = palm ? 3.6 : 1.4 * sc; // world3d.ts city trees
      dummy.position.set(x, th / 2, z); dummy.scale.set(sc, th, sc); dummy.rotation.set(0, 0, palm ? 0.08 : 0); dummy.updateMatrix(); tr.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, th + (palm ? 0.2 : 0.7 * sc), z); dummy.scale.set(palm ? 1.6 : sc * 1.1, palm ? 0.45 : sc * 1.3, palm ? 1.6 : sc * 1.1); dummy.rotation.set(0, i, 0); dummy.updateMatrix(); cr.setMatrixAt(i, dummy.matrix); });
    tr.userData.noShadow = cr.userData.noShadow = low; scene.add(tr, cr); }

  /* ---- streetlights (pole + glow) ---- */
  { const lp: number[] = []; const step = 11; // the old city's spacing and offset
    for (const r of WEST_ROADS) { if (r.kind === 'lane') continue; const p = r.pts; const off = r.width / 2 + 0.8;
      for (let i = 4, k = 0; i < p.length - 1; i += step, k++) { const a = Math.atan2(p[i + 1][1] - p[i - 1][1], p[i + 1][0] - p[i - 1][0]); const sd = k % 2 ? 1 : -1; const x = p[i][0] - Math.sin(a) * off * sd, z = p[i][1] + Math.cos(a) * off * sd;
        if (westRoadClearance(x, z) > 0.3 && !blocked(x, z, 0.3) && !inBridgeSite(x, z, 1)) lp.push(x, 0, z); } } // the Fort McChud Bridge approach stays clear
    const n = lp.length / 3; const pole = new THREE.InstancedMesh(c.pole.geo, c.pole.mat, n);
    for (let i = 0; i < n; i++) { dummy.position.set(lp[i * 3], 1.2, lp[i * 3 + 2]); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); pole.setMatrixAt(i, dummy.matrix); }
    scene.add(pole);
    const lg = geo(new THREE.BufferGeometry()); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp.map((v, i) => (i % 3 === 1 ? 2.5 : v)), 3));
    const lm = new THREE.PointsMaterial({ map: c.glowTex, color: 0xffd27a, size: 2.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }); disposables.push(lm); scene.add(new THREE.Points(lg, lm)); }

  /* ---- Westgate Square + the Westgate Spire ---- */
  { const S = WESTGATE_SQUARE; block(M.concrete, S.x, 0, S.z, S.w, 0.14, S.d, S.rot, 0xb8b2a6);
    for (const [lx, lz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]] as const) { const [x, z] = at(S, lx, lz); piece('cyl', M.concrete, x, 0.35, z, 3.2, 0.5, 3.2, 0, 0x9a948a); piece('sphere', M.leaf, x, 1.6, z, 2.6, 2.2, 2.6, 0, xm ? 0xe6edf8 : 0x3c9a3e); }
    const x = S.x, z = S.z; piece('cyl', M.concrete, x, 0.5, z, 9, 1, 9, 0, 0xa8a29a); piece('cyl', M.glass, x, 0.75, z, 7.6, 0.4, 7.6, 0, 0x4aa8ff);
    // about the old Sky Tower's height (28), so the spire reads as part of the same skyline
    piece('taper', M.concrete, x, 1 + 3, z, 5, 6, 5, 0, 0xd8d4cc);
    piece('taper', M.concrete, x, 7 + 7, z, 3.2, 14, 3.2, 0, 0xe4e0d8);
    piece('cyl', M.neon, x, 21.2, z, 4, 0.3, 4, 0, 0x7fd0ff);
    piece('cyl', M.glass, x, 23, z, 7, 3, 7, 0, 0x9fd8ff); piece('cyl', M.paint, x, 24.8, z, 7.6, 0.6, 7.6, 0, 0x30343c); piece('cyl', M.neon, x, 21.7, z, 7.2, 0.35, 7.2, 0, 0xffd27a);
    piece('taper', M.metal, x, 25.1 + 1.2, z, 2, 2.4, 2, 0, 0xb8bcc4); piece('cone', M.metal, x, 27.5 + 2.75, z, 0.9, 5.5, 0.9, 0, 0xc8ccd4); piece('sphere', M.neon, x, 33.4, z, 0.7, 0.7, 0.7, 0, 0xff3030); }

  /* ---- Westgate Park: lawn, pond, paths, gazebo, benches, trees ---- */
  { const Pk = WESTGATE_PARK; block(M.concrete, Pk.x, 0, Pk.z, Pk.w, 0.06, Pk.d, Pk.rot, xm ? 0xe6edf8 : 0x2e7a36);
    for (const [w, d] of [[Pk.w - 4, 2.2], [2.2, Pk.d - 4]] as const) block(M.concrete, Pk.x, 0.03, Pk.z, w, 0.06, d, Pk.rot, 0xc9b48a);
    const outline: P[] = []; const pc = at(Pk, -12, 5); for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; const r = 1 + 0.12 * Math.sin(a * 3 + 1); const [x, z] = at({ x: pc[0], z: pc[1], rot: Pk.rot }, Math.cos(a) * 8 * r, Math.sin(a) * 5 * r); outline.push([x, z]); }
    const sh = new THREE.Shape(); outline.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z))); sh.closePath(); const wg = new THREE.ShapeGeometry(sh, 2); wg.rotateX(Math.PI / 2);
    const water = new THREE.Mesh(geo(wg), c.makeWater(outline)); water.position.y = 0.1; water.renderOrder = 1; scene.add(water);
    { const [x, z] = at(Pk, 14, -6); piece('cyl6', M.paint, x, 0.25, z, 8, 0.5, 8, 0, 0xe8e0d0); for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; piece('cyl', M.paint, x + Math.cos(a) * 3.4, 1.9, z + Math.sin(a) * 3.4, 0.3, 2.8, 0.3, 0, 0xf2f2f2); } piece('cone', M.paint, x, 4.1, z, 9, 1.8, 9, 0, 0x6a2e2a); }
    for (let k = 0; k < 7; k++) { const lx = -20 + k * 6.2, lz = k % 2 ? 2.2 : -2.2; const [x, z] = at(Pk, lx, lz); if (Math.abs(lx) < 3) continue; block(M.paint, x, 0.3, z, 1.6, 0.12, 0.5, Pk.rot, 0x6b4a2b); block(M.paint, x, 0.1, z, 0.2, 0.25, 0.5, Pk.rot, 0x30343c); }
    for (let k = 0; k < (low ? 20 : 40); k++) { const lx = (rand() - 0.5) * (Pk.w - 6), lz = (rand() - 0.5) * (Pk.d - 6); if (Math.abs(lx) < 3 || Math.abs(lz) < 3) continue; if (Math.hypot((lx + 12) / 10, (lz - 5) / 7) < 1) continue; if (Math.hypot(lx - 14, lz + 6) < 6) continue; const [x, z] = at(Pk, lx, lz); tree(x, z, 0.7 + rand() * 0.8); } }

  /* ---- countryside: Cedar Lake and Mill Pond, Willow Creek with road bridges, hills, farm silos ---- */
  const shapeMesh = (outline: P[], m: THREE.Material, y: number) => { const sh = new THREE.Shape(); outline.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z))); sh.closePath();
    const g = new THREE.ShapeGeometry(sh, 2); g.rotateX(Math.PI / 2); const me = new THREE.Mesh(geo(g), m); me.position.y = y; me.renderOrder = 1; me.userData.noShadow = true; scene.add(me); return me; };
  const bankMat = mat({ color: xm ? 0xe8eef6 : 0xb9a57c, roughness: 1, side: THREE.DoubleSide }); disposables.push(bankMat);
  for (const l of WEST_LAKES) { const o = lakeOutline(l); const bank = o.map(([x, z]) => { const dx = x - l.x, dz = z - l.z, m = Math.hypot(dx, dz) || 1; return [x + (dx / m) * 2.2, z + (dz / m) * 2.2] as P; });
    shapeMesh(bank, bankMat, 0.06); shapeMesh(o, c.makeWater(o), 0.1); }
  { // the creek as one closed ribbon outline (left bank down, right bank back up), drawn under the road bridges
    // split where it runs through Cedar Lake so the creek never paints over the lake
    const runs: P[][] = []; let cur: P[] = []; for (const p of WEST_CREEK) { if (lakeClearance(p[0], p[1]) > -3) cur.push(p); else if (cur.length) { runs.push(cur); cur = []; } } if (cur.length) runs.push(cur);
    for (const run of runs) { if (run.length < 2) continue;
      const side = (sd: number, w: number): P[] => run.map((p, i) => { const a0 = run[Math.max(0, i - 1)], a1 = run[Math.min(run.length - 1, i + 1)]; const a = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]); return [p[0] - Math.sin(a) * w / 2 * sd, p[1] + Math.cos(a) * w / 2 * sd] as P; });
      const ring = (w: number): P[] => [...side(1, w), ...side(-1, w).reverse()];
      const o = ring(WEST_CREEK_W); shapeMesh(ring(WEST_CREEK_W + 3), bankMat, 0.06); shapeMesh(o, c.makeWater(o), 0.1); }
    // bridges: where a road crosses, a deck over the water and low parapets along both road edges
    for (const r of WEST_ROADS) { const p = r.pts; let inside = false; let i0 = 0;
      for (let i = 0; i < p.length; i++) { const wet = creekClearance(p[i][0], p[i][1]) < 2.5; if (wet && !inside) { inside = true; i0 = i; } if ((!wet || i === p.length - 1) && inside) { inside = false;
        const a = p[Math.max(0, i0 - 1)], b = p[Math.min(p.length - 1, i)]; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const len = Math.hypot(b[0] - a[0], b[1] - a[1]) + 1; const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        block(M.concrete, mx, roadY - 0.02, mz, len, 0.2, r.width + 1.2, -ang, 0x8f8b84);
        for (const sd of [1, -1]) block(M.concrete, mx - Math.sin(ang) * (r.width / 2 + 0.5) * sd, roadY, mz + Math.cos(ang) * (r.width / 2 + 0.5) * sd, len, 0.9, 0.4, -ang, 0xcfc9bd); } } } }
  // hills: the old outskirts' grassy mounds (same shape and colours)
  { const hm = mat({ color: xm ? 0xeef3fa : 0x3f9a45, roughness: 1, flatShading: true, emissive: xm ? 0x2a3550 : 0x0f3a14, emissiveIntensity: 0.25 }); const hg = geo(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2));
    const im = new THREE.InstancedMesh(hg, hm, WEST_HILLS.length); WEST_HILLS.forEach(([x, z, r, h], i) => { dummy.position.set(x, 0, z); dummy.rotation.set(0, i, 0); dummy.scale.set(r, h, r); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); }); im.userData.noShadow = low; scene.add(im); }
  // a silo and a hay barn beside each farm's farmhouse (decor; the field and the farmhouse are the deeds)
  for (const f of WEST_FARMS) { const [hx, hz] = [f.home.x, f.home.z]; const dx = Math.sign(f.x - hx) || 1, dz = Math.sign(f.z - hz) || 1;
    const sx = hx + (Math.abs(f.x - hx) > Math.abs(f.z - hz) ? 0 : dx * 9), sz = hz + (Math.abs(f.x - hx) > Math.abs(f.z - hz) ? dz * 9 : 0);
    if (!placeable(sx, sz, 2.2, 1) || nearWater(sx, sz, 2) || WEST_FARMS.some((o) => hitObb(o, sx, sz, 1.5))) continue;
    piece('cyl', M.paint, sx, 4.5, sz, 3.2, 9, 3.2, 0, 0xd8d4c8); piece('sphere', M.metal, sx, 9, sz, 3.2, 2.4, 3.2, 0, 0x9aa2aa); }

  /* ---- West Chud Stadium ---- */
  { const S = WEST_STADIUM; const rx = S.w / 2, rz = S.d / 2;
    block(M.concrete, S.x, 0, S.z, S.w + 6, 0.12, S.d + 6, 0, 0x8d8c92);
    piece('cyl', M.concrete, S.x, 0.16, S.z, (rx - 8) * 2, 0.12, (rz - 8) * 2, 0, 0xb5653a);
    block(M.concrete, S.x, 0.2, S.z, (rx - 13) * 2, 0.06, (rz - 14) * 2, 0, xm ? 0xe6edf8 : 0x2f8f3a);
    block(M.paint, S.x, 0.26, S.z, 0.25, 0.02, (rz - 14) * 2, 0, 0xffffff);
    const N = 44; for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; const a2 = ((i + 1) / N) * Math.PI * 2; const x0 = S.x + Math.cos(a) * (rx - 3), z0 = S.z + Math.sin(a) * (rz - 3), x1 = S.x + Math.cos(a2) * (rx - 3), z1 = S.z + Math.sin(a2) * (rz - 3);
      const len = Math.hypot(x1 - x0, z1 - z0) + 0.4; const ang = Math.atan2(z1 - z0, x1 - x0); const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2; const nx = Math.cos((a + a2) / 2), nz = Math.sin((a + a2) / 2);
      for (let t = 0; t < 4; t++) block(M.concrete, mx - nx * (3 - t * 1.6) * 0.9, 0, mz - nz * (3 - t * 1.6) * 0.9, len, 1.4 + t * 1.5, 1.6, -ang, i % 2 ? 0x2a4a8a : 0x3a5aa0);
      block(M.paint, mx + nx * 2.2, 0, mz + nz * 2.2, len, 7.4, 0.6, -ang, 0xd8d4cc); block(M.paint, mx + nx * 0.5, 7.4, mz + nz * 0.5, len, 0.4, 4.2, -ang, 0xe8e4dc); }
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) { const x = S.x + sx * (rx + 1), z = S.z + sz * (rz + 1); piece('cyl', M.metal, x, 9, z, 0.6, 18, 0.6, 0, 0x6a6e78); block(M.neon, x, 17.6, z, 3.2, 1.6, 0.4, Math.atan2(sx, sz), 0xfff4d0); } }

  /* ---- Ironworks: sheds, tanks, stacks ---- */
  for (const o of WEST_WAREHOUSES) {
    if (o.kind === 'shed') { const col = [0x8a6a50, 0x6f7a84, 0x9a8a70, 0x5f6f7e][Math.floor(hash2(Math.round(o.x), Math.round(o.z)) * 4)]; block(M.paint, o.x, 0, o.z, o.w, o.h, o.d, o.rot, col); block(M.metal, o.x, o.h, o.z, o.w + 0.4, 0.5, o.d + 0.4, o.rot, 0x3a3f48);
      const [dx, dz] = at(o, 0, o.d / 2 + 0.05); block(M.metal, dx, 0, dz, Math.min(6, o.w * 0.4), 3.4, 0.2, o.rot, 0xb0b6be); for (const lx of [-o.w / 3, o.w / 3]) { const [vx, vz] = at(o, lx, 0); piece('cyl', M.metal, vx, o.h + 1, vz, 1, 1.4, 1, 0, 0x9aa2aa); } }
    else if (o.kind === 'tank') { piece('cyl', M.metal, o.x, o.h / 2, o.z, o.w, o.h, o.w, 0, 0xd8d8dc); piece('cyl', M.paint, o.x, o.h + 0.2, o.z, o.w + 0.3, 0.4, o.w + 0.3, 0, 0xc04030); }
    else { block(M.concrete, o.x, 0, o.z, o.w, 3, o.d, o.rot, 0x7a7a80); piece('taper', M.paint, o.x, 3 + o.h / 2, o.z, 2.4, o.h, 2.4, 0, 0x7a3b2e); piece('cyl', M.paint, o.x, 3 + o.h - 1, o.z, 2.2, 0.6, 2.2, 0, 0xf2f2f2); piece('sphere', M.neon, o.x, 3 + o.h + 0.6, o.z, 0.5, 0.5, 0.5, 0, 0xff3030); }
  }

  /* ---- West Chud Port: quay, containers, gantry cranes, a cargo ship ---- */
  { const Q = WEST_PORT; const zq0 = Q.z - Q.d / 2;
    block(M.concrete, Q.x, -2, Q.z, Q.w, 2.45, Q.d, 0, 0x8d8a84); block(M.paint, Q.x, 0.44, Q.z + Q.d / 2 - 1, Q.w, 0.06, 0.4, 0, 0xffd400);
    const cc = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf39c12, 0x8e44ad, 0x16a085, 0xd35400, 0x7f8c8d];
    for (let row = 0; row < 4; row++) for (let k = 0; k < 22; k++) { const x = Q.x - Q.w / 2 + 12 + k * 8, z = zq0 + 6 + row * 3; const hgt = 1 + Math.floor(hash2(k * 5, row * 11) * (low ? 2 : 4)); for (let y = 0; y < hgt; y++) block(M.paint, x, 0.45 + y * 2.5, z, 6, 2.45, 2.4, 0, cc[Math.floor(hash2(k + y * 13, row + 3) * cc.length)]); }
    for (let k = 0; k < 3; k++) { const x = Q.x - 60 + k * 60, z = zq0 + Q.d - 12; const col = k % 2 ? 0x2a5aa8 : 0xd04030;
      for (const sx of [-5, 5]) for (const sz of [-4, 4]) block(M.metal, x + sx, 0.45, z + sz, 0.8, 22, 0.8, 0, col);
      block(M.metal, x, 22.4, z, 12, 1.6, 9.6, 0, col); block(M.metal, x, 22.8, z + 13, 2, 1.2, 36, 0, col); block(M.paint, x, 24, z - 2, 3, 2.4, 3, 0, 0xe8e8e8); }
    const sx = Q.x + 10, sz = Q.z + Q.d / 2 + 14; block(M.paint, sx, -1.6, sz, 84, 4.6, 13, 0, 0x2a2f45); block(M.paint, sx, 2.9, sz, 84, 0.4, 13, 0, 0x8a2a2a);
    block(M.paint, sx + 34, 3.3, sz, 9, 7, 11, 0, 0xf2f2f2); block(M.glass, sx + 34, 8.6, sz, 9.4, 1.2, 11.4, 0); piece('cyl', M.paint, sx + 30, 12, sz, 1.8, 4, 1.8, 0, 0xd04030);
    for (let k = 0; k < 9; k++) for (let j = 0; j < 3; j++) block(M.paint, sx - 34 + k * 7, 3.3, sz - 3.8 + j * 3.8, 6, 2.4 + (k + j) % 2 * 2.4, 2.4, 0, cc[(k * 3 + j) % cc.length]); }

  /* ---- Marina: piers, boats, clubhouse ---- */
  { const Mr = WEST_MARINA; const z0 = OCEAN.beachZ + 2;
    block(M.paint, Mr.x - Mr.w / 2 + 14, 0, z0 - 6, 18, 5, 10, 0, 0xf2ece0); block(M.paint, Mr.x - Mr.w / 2 + 14, 5, z0 - 6, 19, 0.5, 11, 0, 0x2a5aa8);
    for (let k = 0; k < 5; k++) { const x = Mr.x - Mr.w / 2 + 30 + k * 18; block(M.paint, x, 0.1, z0 + 20, 2.2, 0.3, 40, 0, 0x8a6a46);
      for (let j = 0; j < 3; j++) for (const sd of [-1, 1]) { if (hash2(k * 7 + j, sd + 5) < 0.3) continue; const bx = x + sd * 4.4, bz = z0 + 10 + j * 11; const hull = hash2(k, j) < 0.5 ? 0xf8f8f8 : 0x1d3a6a;
        block(M.paint, bx, -0.2, bz, 2.4, 1.2, 7, 0, hull); block(M.paint, bx, 1, bz + 0.6, 1.8, 0.8, 2.6, 0, 0xe8e8e8); if (hash2(k + 3, j * 5) < 0.6) { piece('cyl', M.metal, bx, 5, bz - 0.5, 0.15, 8, 0.15, 0, 0xd0d0d0); piece('cone', M.sail, bx, 5, bz - 1.9, 0.1, 7, 3, 0, 0xffffff); } } } }

  /* ---- lighthouse ---- */
  { const [x, z] = WEST_LIGHTHOUSE; piece('cyl', M.concrete, x, 0.8, z, 9, 1.6, 9, 0, 0x8a8478);
    for (let k = 0; k < 6; k++) piece('taper', M.paint, x, 1.6 + k * 3 + 1.5, z, 4.2 - k * 0.35, 3, 4.2 - k * 0.35, 0, k % 2 ? 0xd02b2b : 0xf5f5f5);
    piece('cyl', M.glass, x, 21.4, z, 2.6, 2.4, 2.6, 0, 0xfff4c0); piece('sphere', M.neon, x, 21.4, z, 1.6, 1.6, 1.6, 0, 0xffe08a); piece('cone', M.paint, x, 23.8, z, 3.2, 2.4, 3.2, 0, 0x30343c); }

  /* ---- water towers (one per suburb) and bus shelters ---- */
  const findSpot = (x: number, z: number, m: number): P | null => { for (let rad = 0; rad < 60; rad += 4) for (let k = 0; k < Math.max(1, rad); k++) { const a = (k / Math.max(1, rad)) * Math.PI * 2; const px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad; if (placeable(px, pz, m, 2)) return [px, pz]; } return null; };
  for (const [tx, tz, label] of [[-760, -330, 'MAPLE'], [-1130, -60, 'CEDAR'], [-700, 100, 'BAY']] as const) { const s = findSpot(tx, tz, 5); if (!s) continue; const [x, z] = s; void label;
    for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) piece('cyl', M.metal, x + lx, 6, z + lz, 0.35, 12, 0.35, 0, 0x8a8e96);
    piece('cyl', M.paint, x, 14, z, 7.4, 4.4, 7.4, 0, 0xe2e6ea); piece('cone', M.paint, x, 17.2, z, 7.8, 2, 7.8, 0, 0x5a7aa0); }
  for (const r of WEST_ROADS) { if (r.kind !== 'boulevard' && r.kind !== 'ring' && r.kind !== 'avenue') continue; if (r.id === 'w-expy') continue; const p = r.pts;
    for (let i = 40; i < p.length - 20; i += low ? 220 : 110) { const a = Math.atan2(p[i + 1][1] - p[i - 1][1], p[i + 1][0] - p[i - 1][0]); const off = r.width / 2 + 1.6; const x = p[i][0] - Math.sin(a) * off, z = p[i][1] + Math.cos(a) * off; if (blocked(x, z, 1.4)) continue;
      block(M.glass, x, 0, z, 3, 2.2, 0.12, -a); block(M.paint, x, 2.2, z, 3.4, 0.15, 1.4, -a, 0x2a5aa8); block(M.paint, x, 0.45, z, 2.4, 0.1, 0.5, -a, 0x6b4a2b); } }

  /* ---- gateway arches where the link roads enter West Chud ---- */
  const labels: THREE.Texture[] = [];
  const sprite = (text: string, color: string, x: number, y: number, z: number, w: number) => { const t = c.label(text, color); labels.push(t); const img = t.image as { width: number; height: number } | undefined; const k = img ? img.height / img.width : 0.25;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false })); disposables.push(s.material); s.scale.set(w, w * k, 1); s.position.set(x, y, z); s.renderOrder = 5; scene.add(s); };
  for (const id of ['w-expy', 'w-coast']) { const r = WEST_ROADS.find((o) => o.id === id); if (!r) continue; const i = r.pts.findIndex(([x]) => x < WEST.x1 - 8); if (i < 2) continue;
    const [x, z] = r.pts[i]; const a = Math.atan2(r.pts[i + 1][1] - r.pts[i - 1][1], r.pts[i + 1][0] - r.pts[i - 1][0]); const hw = r.width / 2 + 1.6; const nx = -Math.sin(a), nz = Math.cos(a);
    for (const sd of [1, -1]) piece('box', M.concrete, x + nx * hw * sd, 3.5, z + nz * hw * sd, 1.2, 7, 1.2, -a, 0xd8d0c0);
    block(M.paint, x, 7, z, 1, 1.4, hw * 2 + 2.4, -a, 0x1f2a3a); block(M.neon, x, 8.4, z, 1.1, 0.25, hw * 2 + 2.4, -a, 0xffd27a);
    sprite('Welcome to West Chud', '#ffd27a', x, 12, z, 22); }
  for (const L of WEST_LABELS) sprite(L.text, L.color, L.x, 34, L.z, 44);
  sprite('Westgate Spire', '#7fd0ff', WESTGATE_SQUARE.x, 38, WESTGATE_SQUARE.z, 22);
  sprite('West Chud Stadium', '#9be37a', WEST_STADIUM.x, 26, WEST_STADIUM.z, 26);
  sprite('Westgate Park', '#9be37a', WESTGATE_PARK.x, 16, WESTGATE_PARK.z, 22);
  sprite('Sunset Marina', '#7fe0ff', WEST_MARINA.x, 18, WEST_MARINA.z, 22);

  /* ---- lived-in countryside: planted fields, orchards, vineyards, pastures with animals, farmyards, hamlets, lakeside, meadows ---- */
  { const R = rng(2718);
    const boardMat = (text: string, color: string) => { const t = c.label(text, color); labels.push(t); const m = mat({ color: 0xffffff, map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.35 }); disposables.push(m); return m; };
    const signBoard = (text: string, color: string, x: number, z: number, ry: number, w = 5, y = 2.6) => { const t = c.label(text, color); labels.push(t); const img = t.image as { width: number; height: number } | undefined; const k = img ? img.height / img.width : 0.25;
      const m = mat({ color: 0xffffff, map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.35 }); disposables.push(m); const b = new THREE.Mesh(geo(new THREE.BoxGeometry(w, w * k, 0.15)), m); b.position.set(x, y, z); b.rotation.y = ry; scene.add(b);
      for (const sd of [-1, 1]) piece('box', M.paint, x + Math.cos(ry) * (w / 2 - 0.3) * sd, (y - w * k / 2) / 2, z - Math.sin(ry) * (w / 2 - 0.3) * sd, 0.18, y - w * k / 2, 0.18, ry, 0x5a4a3a); };
    const fenceRun = (x0: number, z0: number, x1: number, z1: number, col = 0x8a6a48) => { const len = Math.hypot(x1 - x0, z1 - z0); const ang = Math.atan2(z1 - z0, x1 - x0); const n = Math.max(1, Math.round(len / 3));
      for (let k = 0; k <= n; k++) piece('box', M.paint, x0 + (x1 - x0) * k / n, 0.55, z0 + (z1 - z0) * k / n, 0.16, 1.1, 0.16, 0, 0x6a4e34);
      for (const y of [0.45, 0.9]) piece('box', M.paint, (x0 + x1) / 2, y, (z0 + z1) / 2, len, 0.08, 0.08, -ang, col); };
    const hedge = (x0: number, z0: number, x1: number, z1: number) => { const len = Math.hypot(x1 - x0, z1 - z0); piece('box', M.leaf, (x0 + x1) / 2, 0.7, (z0 + z1) / 2, len, 1.4, 1.1, -Math.atan2(z1 - z0, x1 - x0), xm ? 0xe6edf8 : 0x2f6b32); };
    for (const f of WEST_FIELDS) { const hw = f.w / 2, hd = f.d / 2; const r = rng(f.seed + 1);
      const base = { crop: 0x4f8a34, wheat: 0xc8a845, corn: 0x5a8a2e, orchard: 0x4c8c3c, vineyard: 0x6a7a3a, pasture: 0x6fae4a, hay: 0xb8a458 }[f.kind];
      block(M.concrete, f.x, 0, f.z, f.w - 0.6, 0.1, f.d - 0.6, 0, xm ? 0xe6edf8 : base);
      if (f.kind === 'crop' || f.kind === 'wheat' || f.kind === 'corn') { const step = f.kind === 'corn' ? 1.8 : 1.5; const hgt = f.kind === 'corn' ? 1.3 : f.kind === 'wheat' ? 0.5 : 0.35;
        const col = f.kind === 'wheat' ? 0xe0c25a : f.kind === 'corn' ? 0x6fa83a : [0x3f8f3a, 0x6aaa3a, 0x8fb848][f.seed % 3];
        for (let z = -hd + 1.5; z < hd - 1; z += step) piece('box', M.leaf, f.x, 0.1 + hgt / 2, f.z + z, f.w - 2.4, hgt, step * 0.55, 0, xm ? 0xf0f4fa : col); }
      else if (f.kind === 'orchard') { const fruit = [0xd8402a, 0xf0b030, 0x9ac040][f.seed % 3];
        for (let x = -hw + 2.5; x < hw - 2; x += 4) for (let z = -hd + 2.5; z < hd - 2; z += 4) { piece('cyl6', M.paint, f.x + x, 0.7, f.z + z, 0.3, 1.4, 0.3, 0, 0x6b4526); piece('ball', M.leaf, f.x + x, 2, f.z + z, 2.4, 2, 2.4, 0, xm ? 0xe6edf8 : 0x2e8b45);
          if (!low && !xm) piece('ball', M.paint, f.x + x + 0.6, 2.1, f.z + z + 0.7, 0.3, 0.3, 0.3, 0, fruit); } }
      else if (f.kind === 'vineyard') { for (let z = -hd + 1.6; z < hd - 1; z += 2.4) { piece('box', M.leaf, f.x, 0.75, f.z + z, f.w - 3, 1.2, 0.55, 0, xm ? 0xe6edf8 : 0x3f7a2e);
          for (let x = -hw + 1.5; x < hw - 1; x += 6) piece('box', M.paint, f.x + x, 0.8, f.z + z, 0.12, 1.6, 0.12, 0, 0x5a4a3a); } }
      else if (f.kind === 'pasture') { const sheep = f.seed % 2 === 0; const n = low ? 4 : 5 + (f.seed % 5);
        for (let k = 0; k < n; k++) { const x = f.x + (r() - 0.5) * (f.w - 5), z = f.z + (r() - 0.5) * (f.d - 5), a = r() * Math.PI * 2;
          if (sheep) { piece('ball', M.paint, x, 0.7, z, 1.3, 0.9, 0.9, a, 0xf2efe6); piece('box', M.paint, x + Math.cos(a) * 0.75, 0.85, z - Math.sin(a) * 0.75, 0.4, 0.4, 0.35, a, 0x2a2a2a); }
          else { const col = [0x4a3424, 0xf0ece4, 0x2a2420, 0x8a5a34][Math.floor(r() * 4)]; piece('box', M.paint, x, 0.95, z, 1.9, 0.9, 0.85, a, col); piece('box', M.paint, x + Math.cos(a) * 1.15, 1.2, z - Math.sin(a) * 1.15, 0.6, 0.55, 0.5, a, col);
            for (const [lx, lz] of [[-0.7, -0.3], [0.7, -0.3], [-0.7, 0.3], [0.7, 0.3]]) piece('box', M.paint, x + Math.cos(a) * lx + Math.sin(a) * lz, 0.25, z - Math.sin(a) * lx + Math.cos(a) * lz, 0.18, 0.5, 0.18, a, 0x2a2420); } }
        piece('box', M.metal, f.x + hw - 3, 0.35, f.z, 2.4, 0.6, 0.9, 0, 0x8a9098); // water trough
        fenceRun(f.x - hw + 0.4, f.z - hd + 0.4, f.x + hw - 0.4, f.z - hd + 0.4); fenceRun(f.x - hw + 0.4, f.z + hd - 0.4, f.x + hw - 0.4, f.z + hd - 0.4);
        fenceRun(f.x - hw + 0.4, f.z - hd + 0.4, f.x - hw + 0.4, f.z + hd - 0.4); fenceRun(f.x + hw - 0.4, f.z - hd + 0.4, f.x + hw - 0.4, f.z + hd - 0.4); }
      else { for (let k = 0; k < 6 + (f.seed % 6); k++) { const x = f.x + (r() - 0.5) * (f.w - 4), z = f.z + (r() - 0.5) * (f.d - 4); piece('cyl', M.paint, x, 0.75, z, 1.5, 1.5, 1.5, r() * 3, 0xd8bc6a, Math.PI / 2); } }
      // hedgerow on the far side of every planted field, fence on the road side (pastures are fenced all round)
      if (f.kind !== 'pasture') { const c0 = westRoadClearance(f.x, f.z - hd - 3), c1 = westRoadClearance(f.x, f.z + hd + 3); const far = c0 > c1 ? -1 : 1; if (!low) hedge(f.x - hw, f.z + far * (hd + 0.2), f.x + hw, f.z + far * (hd + 0.2));
        fenceRun(f.x - hw + 0.4, f.z - far * (hd - 0.4), f.x + hw - 0.4, f.z - far * (hd - 0.4)); } }
    // farmyards: a red barn, hay bales and a mailbox at each farm
    for (const y of WEST_YARDS) { block(M.paint, y.x, 0, y.z, y.w, 4.4, y.d, y.rot, 0x8a2a22); piece('prism', M.paint, y.x, 4.4 + 1.1, y.z, y.d + 0.4, 2.2, y.w + 0.4, y.rot + Math.PI / 2, 0x3a3a40);
      const [dx, dz] = at(y, 0, y.d / 2 + 0.06); block(M.paint, dx, 0, dz, 3, 2.8, 0.12, y.rot, 0xe8e0d0);
      for (let k = 0; k < 4; k++) { const [bx, bz] = at(y, -y.w / 2 - 2.2, -3 + k * 2); piece('cyl', M.paint, bx, 0.75, bz, 1.5, 1.4, 1.5, y.rot, 0xd8bc6a, Math.PI / 2); } }
    // mailboxes at every country home
    for (const h of houses) { if (westTown(h.x, h.z)) continue; const [fx, fz] = at(h, 0, h.d / 2 + 2), [bx, bz] = at(h, 0, -h.d / 2 - 2); const [mx, mz] = westRoadClearance(fx, fz) < westRoadClearance(bx, bz) ? [fx, fz] : [bx, bz];
      if (westRoadClearance(mx, mz) < 0.6) continue; piece('box', M.paint, mx, 0.55, mz, 0.12, 1.1, 0.12, h.rot, 0x5a4a3a); piece('box', M.paint, mx, 1.2, mz, 0.5, 0.35, 0.3, h.rot, [0x2a4a8a, 0xb02a22, 0x30343c][Math.floor(hash2(Math.round(h.x), Math.round(h.z)) * 3)]); }
    // hamlets: general store, gas station, diner and church at each crossroads, with name signs
    const storeM = boardMat('GENERAL STORE', '#ffd27a'), dinerM = boardMat('DINER', '#ff6a8a'), gasM = boardMat('GAS', '#7fe0ff');
    for (const hm of WEST_HAMLETS) { for (const o of hm.shops) { const front = (k: number) => at(o, 0, westRoadClearance(...at(o, 0, o.d / 2 + 2)) < westRoadClearance(...at(o, 0, -o.d / 2 - 2)) ? k : -k);
        if (o.kind === 'store') { block(M.paint, o.x, 0, o.z, o.w, o.h, o.d, o.rot, 0xc9a27a); block(M.paint, o.x, o.h, o.z, o.w + 0.4, 0.4, o.d + 0.4, o.rot, 0x4a3a2c); const [ax, az] = front(o.d / 2 + 1); block(M.paint, ax, 2.6, az, o.w - 1, 0.2, 2, o.rot, 0x2e7a46);
          const [sx, sz] = front(o.d / 2 + 0.1); const b = new THREE.Mesh(geo(new THREE.BoxGeometry(6, 1.2, 0.1)), storeM); b.position.set(sx, o.h - 0.8, sz); b.rotation.y = o.rot; scene.add(b); }
        else if (o.kind === 'gas') { for (const [lx, lz] of [[-4, -2.5], [4, -2.5], [-4, 2.5], [4, 2.5]]) { const [px, pz] = at(o, lx, lz); piece('box', M.metal, px, 2.3, pz, 0.35, 4.6, 0.35, o.rot, 0xe8e8e8); }
          block(M.paint, o.x, 4.6, o.z, o.w - 2, 0.6, 7, o.rot, 0xf2f2f2); block(M.neon, o.x, 4.6, o.z, o.w - 1.9, 0.18, 7.05, o.rot, 0xd83a2a);
          for (const lx of [-2, 2]) { const [px, pz] = at(o, lx, 0); block(M.paint, px, 0, pz, 0.8, 1.6, 0.6, o.rot, 0xd83a2a); }
          const [kx, kz] = at(o, 0, -o.d / 2 + 1.4); block(M.paint, kx, 0, kz, 5, 3, 2.4, o.rot, 0xe8e0d0);
          const [gx, gz] = at(o, o.w / 2 - 0.5, o.d / 2 - 0.5); piece('box', M.metal, gx, 3, gz, 0.3, 6, 0.3, 0, 0x8a8e96); const b = new THREE.Mesh(geo(new THREE.BoxGeometry(2.6, 1.3, 0.2)), gasM); b.position.set(gx, 6.2, gz); b.rotation.y = o.rot; scene.add(b); }
        else if (o.kind === 'diner') { block(M.paint, o.x, 0, o.z, o.w, o.h, o.d, o.rot, 0xd8dce2); block(M.neon, o.x, o.h * 0.55, o.z, o.w + 0.05, 0.3, o.d + 0.05, o.rot, 0xff5a7a); block(M.glass, o.x, 1.1, o.z, o.w + 0.04, 1.1, o.d + 0.04, o.rot, 0x9fd8ff);
          block(M.paint, o.x, o.h, o.z, o.w + 0.3, 0.3, o.d + 0.3, o.rot, 0x30343c); const [sx, sz] = front(o.d / 2 + 0.6); const b = new THREE.Mesh(geo(new THREE.BoxGeometry(4, 1.3, 0.15)), dinerM); b.position.set(sx, o.h + 1, sz); b.rotation.y = o.rot; scene.add(b); }
        else { block(M.paint, o.x, 0, o.z, o.w, o.h * 0.6, o.d, o.rot, 0xf2efe6); piece('prism', M.paint, o.x, o.h * 0.6 + 1.3, o.z, o.d + 0.3, 2.6, o.w + 0.4, o.rot + Math.PI / 2, 0x5a3a2a);
          const [tx, tz] = at(o, 0, o.d / 2 - 2); block(M.paint, tx, 0, tz, 2.6, o.h + 2.5, 2.6, o.rot, 0xf2efe6); piece('cone', M.paint, tx, o.h + 2.5 + 2, tz, 2.4, 4, 2.4, o.rot, 0x5a3a2a); piece('box', M.neon, tx, o.h + 5, tz, 0.15, 1.2, 0.15, o.rot, 0xffe08a); } }
      const q = WEST_ROADS.find((r) => r.id === hm.road)!.pts; const ci = q.findIndex((p) => p[0] === hm.x && p[1] === hm.z);
      for (const j of [-66, 66]) { const i = ci + j; if (i < 3 || i > q.length - 4) continue; const a = Math.atan2(q[i + 2][1] - q[i - 2][1], q[i + 2][0] - q[i - 2][0]); const w = WEST_ROADS.find((r) => r.id === hm.road)!.width;
        const x = q[i][0] - Math.sin(a) * (w / 2 + 2), z = q[i][1] + Math.cos(a) * (w / 2 + 2); if (!blocked(x, z, 1) && !nearWater(x, z, 1)) signBoard(hm.name, '#ffffff', x, z, -a + (j < 0 ? 0 : Math.PI)); }
      sprite(hm.name, '#ffd27a', hm.x, 20, hm.z, 26); }
    // lakeside: docks, campground tents and fire rings, picnic tables
    for (const d of WEST_LAKESIDE.docks) { const cx = d.x + Math.cos(d.rot) * d.len / 2, cz = d.z + Math.sin(d.rot) * d.len / 2; block(M.paint, cx, 0.25, cz, d.len, 0.2, 1.8, -d.rot, 0x8a6a46);
      for (const t of [0.3, 0.95]) for (const sd of [-0.8, 0.8]) piece('cyl6', M.paint, d.x + Math.cos(d.rot) * d.len * t - Math.sin(d.rot) * sd, 0.1, d.z + Math.sin(d.rot) * d.len * t + Math.cos(d.rot) * sd, 0.22, 0.8, 0.22, 0, 0x5a4a3a); }
    for (const [k, t] of WEST_LAKESIDE.tents.entries()) piece('cone', M.sail, t.x, 1.1, t.z, 3, 2.2, 3, t.rot, [0xe86a2a, 0x2a8a5a, 0x3a6ad0, 0xd8b030][k % 4]);
    for (const [x, z] of WEST_LAKESIDE.fires) { piece('cyl6', M.concrete, x, 0.15, z, 1.6, 0.3, 1.6, 0, 0x6a6a6a); piece('cone', M.neon, x, 0.55, z, 0.6, 0.7, 0.6, 0, 0xff8a2a); }
    for (const t of WEST_LAKESIDE.picnic) { block(M.paint, t.x, 0.75, t.z, 2, 0.12, 0.9, t.rot, 0x8a6a46); for (const lz of [-0.8, 0.8]) { const [bx, bz] = at(t, 0, lz); block(M.paint, bx, 0.42, bz, 2, 0.1, 0.35, t.rot, 0x7a5a3a); } block(M.paint, t.x, 0, t.z, 0.2, 0.75, 0.2, t.rot, 0x5a4a3a); }
    if (WEST_LAKESIDE.tents.length) { const t = WEST_LAKESIDE.tents[0]; signBoard('Cedar Lake Campground', '#9be37a', t.x + 4, t.z + 4, 0, 6); }
    // wildflower meadows and rock outcrops
    for (const [x, z, r] of WEST_MEADOWS) { piece('cyl', M.concrete, x, 0.03, z, r * 2, 0.04, r * 2, 0, xm ? 0xe6edf8 : 0x79b450); if (xm) continue; const n = Math.round(r * r * (low ? 0.25 : 0.55));
      for (let k = 0; k < n; k++) { const a = R() * Math.PI * 2, d = Math.sqrt(R()) * (r - 0.6); piece('flower', M.neon, x + Math.cos(a) * d, 0.35, z + Math.sin(a) * d, 0.35, 0.45, 0.35, a, [0xf6e04a, 0xf2f2f2, 0xd86ad8, 0xff7a4a, 0x8ab8ff][k % 5]); } }
    for (const [x, z, r] of WEST_OUTCROPS) for (let k = 0; k < 3 + Math.floor(r); k++) { const a = R() * Math.PI * 2, d = R() * r * 0.6, s = 1.2 + R() * (r * 0.7); piece('rock', M.concrete, x + Math.cos(a) * d, s * 0.3, z + Math.sin(a) * d, s, s * 0.75, s * 0.9, a, 0x8a8c90, R(), R()); }
    // for-sale signs on the empty lots
    const saleM = boardMat('FOR SALE', '#ff7a3a');
    for (const p of patches) { if (p.kind !== 'lot' || westTown(p.x, p.z)) continue; const [fx, fz] = at(p, 0, p.d / 2 - 1), [bx, bz] = at(p, 0, -p.d / 2 + 1); const [x, z] = westRoadClearance(fx, fz) < westRoadClearance(bx, bz) ? [fx, fz] : [bx, bz];
      piece('box', M.paint, x, 0.8, z, 0.15, 1.6, 0.15, p.rot, 0x5a4a3a); const b = new THREE.Mesh(geo(new THREE.BoxGeometry(2.4, 1, 0.1)), saleM); b.position.set(x, 1.7, z); b.rotation.y = p.rot; scene.add(b); }
    // power lines along the country roads: poles every ~30 units, three wires between neighbours
    for (const id of ['w-cedar', 'w-ridgew', 'w-ridge', 'w-maple']) { const r = WEST_ROADS.find((o) => o.id === id); if (!r) continue; const p = r.pts; let prev: [number, number, number] | null = null;
      for (let i = 10; i < p.length - 2; i += 30) { const a = Math.atan2(p[i + 1][1] - p[i - 1][1], p[i + 1][0] - p[i - 1][0]); const off = r.width / 2 + 3.2; const x = p[i][0] - Math.sin(a) * off, z = p[i][1] + Math.cos(a) * off;
        if (westTown(x, z) || blocked(x, z, 0.8) || nearWater(x, z, 1) || westRoadClearance(x, z) < 2 || inBridgeSite(x, z, 4)) { prev = null; continue; }
        piece('cyl6', M.paint, x, 4, z, 0.32, 8, 0.32, 0, 0x6a5038); piece('box', M.paint, x, 7.6, z, 2.6, 0.18, 0.18, -a + Math.PI / 2, 0x5a4a3a);
        if (prev && !low) { const [px, pz, pa] = prev; for (const sd of [-1.1, 0, 1.1]) { const x0 = px + Math.cos(pa) * sd, z0 = pz - Math.sin(pa) * sd, x1 = x + Math.cos(-a + Math.PI / 2) * sd, z1 = z - Math.sin(-a + Math.PI / 2) * sd; const len = Math.hypot(x1 - x0, z1 - z0);
          piece('box', M.metal, (x0 + x1) / 2, 7.45, (z0 + z1) / 2, len, 0.05, 0.05, -Math.atan2(z1 - z0, x1 - x0), 0x2a2a2a); } }
        prev = [x, z, -a + Math.PI / 2]; } }
    // road signs: a speed sign every ~150 units on the country roads
    for (const id of ['w-cedar', 'w-ridgew', 'w-ridge', 'w-maple']) { const r = WEST_ROADS.find((o) => o.id === id); if (!r) continue; const p = r.pts;
      for (let i = 40; i < p.length - 2; i += 150) { const a = Math.atan2(p[i + 1][1] - p[i - 1][1], p[i + 1][0] - p[i - 1][0]); const off = r.width / 2 + 1.4; const x = p[i][0] + Math.sin(a) * off, z = p[i][1] - Math.cos(a) * off;
        if (blocked(x, z, 0.5) || nearWater(x, z, 1) || westTown(x, z)) continue; piece('box', M.metal, x, 1.1, z, 0.1, 2.2, 0.1, -a, 0x9aa2aa); piece('cyl', M.paint, x, 2.4, z, 0.9, 0.06, 0.9, -a, 0xf2f2f2, Math.PI / 2); piece('cyl', M.paint, x, 2.4, z, 1.05, 0.05, 1.05, -a, 0xc0302a, Math.PI / 2); } }
  }

  flush();

  /* ---- wind farm (rotors spin) ---- */
  const rotors: THREE.Object3D[] = [];
  { const tower = mat({ color: 0xeef0f2, roughness: 0.6 }); const tg = geo(new THREE.CylinderGeometry(0.45, 0.9, 34, 10)); const ng = geo(new THREE.BoxGeometry(1.4, 1.4, 3.4)); const bg = geo(new THREE.BoxGeometry(0.5, 14, 0.18)); bg.translate(0, 7, 0);
    for (const [x, z] of WIND_TURBINES) { const t = new THREE.Mesh(tg, tower); t.position.set(x, 17, z); const n = new THREE.Mesh(ng, tower); n.position.set(x, 34.4, z + 0.6); const rot = new THREE.Group(); rot.position.set(x, 34.4, z + 2.4);
      for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(bg, tower); b.rotation.z = (k / 3) * Math.PI * 2; rot.add(b); } rot.rotation.z = hash2(Math.round(x), Math.round(z)) * 6; scene.add(t, n, rot); rotors.push(rot); } }

  /* ---- traffic ---- */
  const NC = low ? Math.round(WEST_CAR_COUNT / 2) : WEST_CAR_COUNT;
  const body = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1.6, 0.6, 0.9)), mat({ color: 0xffffff, roughness: 0.4, metalness: 0.4 }), NC);
  const carCols = [0xe63946, 0xf1faee, 0x1d9bf0, 0xffb703, 0x8338ec, 0x2a9d8f, 0x30343c, 0xb0b4bc];
  for (let i = 0; i < NC; i++) body.setColorAt(i, new THREE.Color(carCols[i % carCols.length]));
  const headG = geo(new THREE.BufferGeometry()); headG.setAttribute('position', new THREE.Float32BufferAttribute(new Array(NC * 6).fill(0), 3));
  const headM = new THREE.PointsMaterial({ map: c.glowTex, color: 0xfff2c0, size: 1.3, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }); disposables.push(headM);
  scene.add(body, new THREE.Points(headG, headM));
  const routes = WEST_CAR_ROUTES.filter((r) => r.len > 60); const total = routes.reduce((s, r) => s + r.len, 0);
  const cars = Array.from({ length: NC }, (_, i) => { let k = (i + 0.5) / NC * total; let route = routes[0]; for (const r of routes) { if (k < r.len) { route = r; break; } k -= r.len; } return { route, t: rand(), sp: (6 + rand() * 4) / (route.len * (route.road.closed ? 1 : 2)) }; });
  const hp = headG.getAttribute('position') as THREE.BufferAttribute;

  return {
    update(dt: number, timeS: number) {
      cars.forEach((cr, i) => { cr.t += cr.sp * dt; const [x, z, a] = routePoint(cr.route, cr.t, LANE); dummy.position.set(x, 0.45, z); dummy.rotation.set(0, -a, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); body.setMatrixAt(i, dummy.matrix);
        hp.setXYZ(i * 2, x + Math.cos(a) * 0.9 - Math.sin(a) * 0.3, 0.5, z + Math.sin(a) * 0.9 + Math.cos(a) * 0.3); hp.setXYZ(i * 2 + 1, x + Math.cos(a) * 0.9 + Math.sin(a) * 0.3, 0.5, z + Math.sin(a) * 0.9 - Math.cos(a) * 0.3); });
      body.instanceMatrix.needsUpdate = true; hp.needsUpdate = true;
      for (const r of rotors) r.rotation.z += dt * 0.9; void timeS;
    },
    dispose() { for (const d of disposables) d.dispose(); for (const t of labels) t.dispose(); },
    /** For the overview / tests: what was drawn. */
    counts: { houses: houses.length, patches: patches.length, trees: trees.length, roads: WEST_ROADS.length, cars: NC },
  };
}
void toLocal; void coastZ;

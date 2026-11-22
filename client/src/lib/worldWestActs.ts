/**
 * West Chud activity sites (shared/westActivities.ts): the Ironworks Steel Mill, the Cedar Lake fishing pier and
 * campfire, the Cedar Crossing farmers' market stalls, the Millbrook U-Pick farm stand and the stadium rodeo ring.
 * Plain meshes (a few dozen per site); world3d.ts adds the floating sign + glow and makes them clickable landmarks.
 */
import * as THREE from 'three';
import { westRanches } from '../../../shared/westRanch';
import { WEST_SPOTS, WEST_MILL, WEST_PIER, WEST_CAMP, WEST_MARKET, WEST_UPICK, WEST_RODEO, type WestSpotId } from '../../../shared/westActivities';

type Ctx = { mat: (o: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial; geo: <T extends THREE.BufferGeometry>(g: T) => T; low: boolean };
export interface WestActModel { id: WestSpotId; root: THREE.Group; height: number; emissive: THREE.MeshStandardMaterial[] }

export function buildWestActs(c: Ctx): WestActModel[] {
  const BOX = c.geo(new THREE.BoxGeometry(1, 1, 1)); const CYL = c.geo(new THREE.CylinderGeometry(1, 1, 1, c.low ? 8 : 14)); const CONE = c.geo(new THREE.ConeGeometry(1, 1, c.low ? 8 : 14));
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const M = (color: number, rough = 0.8, metal = 0, emissive = 0, ei = 0) => { const k = `${color}|${rough}|${metal}|${emissive}|${ei}`; let m = mats.get(k); if (!m) { m = c.mat({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei }); mats.set(k, m); } return m; };
  const box = (g: THREE.Object3D, m: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0) => { const o = new THREE.Mesh(BOX, m); o.position.set(x, y + h / 2, z); o.scale.set(w, h, d); o.rotation.y = ry; o.castShadow = !c.low; g.add(o); return o; };
  const cyl = (g: THREE.Object3D, m: THREE.Material, x: number, y: number, z: number, r: number, h: number) => { const o = new THREE.Mesh(CYL, m); o.position.set(x, y + h / 2, z); o.scale.set(r, h, r); o.castShadow = !c.low; g.add(o); return o; };
  const cone = (g: THREE.Object3D, m: THREE.Material, x: number, y: number, z: number, r: number, h: number) => { const o = new THREE.Mesh(CONE, m); o.position.set(x, y + h / 2, z); o.scale.set(r, h, r); g.add(o); return o; };
  const out: WestActModel[] = [];
  const site = (id: WestSpotId, x: number, z: number, height: number, rot = 0) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; g.name = `west-act-${id}`; const m: WestActModel = { id, root: g, height, emissive: [] }; out.push(m); return m; };
  const color = (id: WestSpotId) => WEST_SPOTS.find((s) => s.id === id)!.color;

  /* ---- Ironworks Steel Mill: blast furnace, hot-blast stoves, cast house, stacks, skip incline, ladle car, ingot stacks ---- */
  { const s = site('w-mill', WEST_MILL.x, WEST_MILL.z, 24); const g = s.root;
    const concrete = M(0x8a8a86, 0.95), rust = M(0x6a3a28, 0.7, 0.4), steel = M(0x5a6068, 0.5, 0.7), dark = M(0x2e3034, 0.7, 0.5), brick = M(0x8a4a34, 0.9), roof = M(0x4a2a22, 0.8);
    const hot = M(0xff7a2a, 0.4, 0, 0xff6010, 2.2); const neon = M(color('w-mill'), 0.5, 0, color('w-mill'), 1.4); s.emissive.push(hot, neon);
    box(g, concrete, 0, 0, 0, WEST_MILL.w, 0.18, WEST_MILL.d);
    // blast furnace: shaft, bosh, top, glowing tap hole and the bustle pipe ring
    cyl(g, rust, -8, 0, -4, 3.4, 4); cyl(g, dark, -8, 4, -4, 2.8, 12); cone(g, dark, -8, 16, -4, 2.8, 2.4); cyl(g, steel, -8, 18.2, -4, 0.7, 4);
    const ring = new THREE.Mesh(c.geo(new THREE.TorusGeometry(3.6, 0.35, 6, c.low ? 12 : 20)), steel); ring.rotation.x = Math.PI / 2; ring.position.set(-8, 10, -4); g.add(ring);
    box(g, hot, -8, 0.4, -0.4, 1.6, 1.2, 0.6); box(g, hot, -8, 0.19, 2.6, 1.2, 0.08, 6); // tap hole + the iron runner
    // three hot-blast stoves
    for (let i = 0; i < 3; i++) { cyl(g, brick, -14 + i * 4.2, 0, 7, 1.7, 13); cone(g, brick, -14 + i * 4.2, 13, 7, 1.7, 1.6); }
    // cast house (open front) and the ladle car on its rails
    box(g, brick, 4, 0, -4, 12, 7, 10); box(g, roof, 4, 7, -4, 13, 0.6, 11); box(g, M(0x1a1a1a), -2.05, 0.2, -4, 0.15, 5, 6);
    box(g, steel, 4, 0.2, 7, 18, 0.12, 0.25); box(g, steel, 4, 0.2, 8.6, 18, 0.12, 0.25);
    box(g, dark, 6, 0.4, 7.8, 3, 0.8, 2.2); cyl(g, rust, 6, 1.2, 7.8, 1.1, 1.6); cyl(g, hot, 6, 2.82, 7.8, 0.95, 0.05);
    // skip incline from the stock house to the furnace top
    const sk = box(g, steel, 0, 0, 0, Math.hypot(12, 15), 0.5, 1.4); sk.position.set(0, 8.5, -9.5); sk.rotation.set(0, 0, Math.atan2(15, -12));
    box(g, M(0x6a6a70, 0.9), 7, 0, -13, 8, 3, 4); // stock house (ore + coal bins)
    for (let i = 0; i < 3; i++) { box(g, M(i === 0 ? 0x2b2b2e : 0x9a6a4a, 1), 4.5 + i * 2.6, 3, -13, 2.2, 0.6, 3.2); }
    // stacks (red/white bands)
    for (const [x, z] of [[12, 9], [15, 9]] as const) { cyl(g, M(0xd8d4cc, 0.8), x, 0, z, 0.9, 22); for (const y of [16, 19.5]) cyl(g, M(0xc03028, 0.8), x, y, z, 0.95, 1.2); }
    // finished steel: ingot stacks and a beam pile by the yard gate
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) box(g, steel, 12 + (i % 2) * 2.2, j * 0.5, -6 + Math.floor(i / 2) * 1.4, 1.8, 0.45, 0.9);
    for (let j = 0; j < 4; j++) box(g, M(0x4a5058, 0.5, 0.7), 12.5, j * 0.6, 0, 8, 0.5, 0.6 + (j % 2) * 0.3);
    box(g, neon, -16.8, 0, -14.8, 0.25, 4, 0.25); box(g, neon, -12.2, 0, -14.8, 0.25, 4, 0.25); box(g, M(0x2a2a2e), -14.5, 3.2, -14.8, 5, 1.4, 0.2); // gate sign
  }
  /* ---- Cedar Lake fishing pier: deck on posts reaching into the lake, a bait shack, a bench and rods ---- */
  { const s = site('w-pier', WEST_PIER.x, WEST_PIER.z, 5); const g = s.root; const wood = M(0x8a6a44, 0.9), dk = M(0x5a4028, 0.9);
    const L = WEST_PIER.len; box(g, wood, L / 2, 0.55, 0, L, 0.22, 2.6); box(g, wood, L + 1.6, 0.55, 0, 3.2, 0.22, 5); // deck + T-head
    for (let x = 1; x <= L + 2.5; x += 2.4) for (const zz of [-1.2, 1.2]) cyl(g, dk, x, -0.6, zz, 0.14, 1.4);
    for (const zz of [-1.25, 1.25]) box(g, dk, L / 2, 0.77, zz, L, 0.6, 0.08);
    const shack = M(0x3a6a8a, 0.8), lamp = M(0xfff0c0, 0.5, 0, 0xffd080, 1.4); s.emissive.push(lamp);
    box(g, shack, -3.5, 0, 0, 3.2, 2.6, 3.2); box(g, M(0xc04a2a, 0.8), -3.5, 2.6, 0, 3.8, 0.35, 3.8); box(g, M(0xf2e6c8), -1.85, 1.2, 0, 0.08, 0.7, 2); // BAIT board
    cyl(g, dk, L + 3, 0.6, 2.2, 0.08, 3.2); box(g, lamp, L + 3, 3.8, 2.2, 0.5, 0.5, 0.5);
    box(g, dk, L - 2, 0.77, -0.8, 1.8, 0.4, 0.5); // bench
    for (const [x, zz] of [[L + 2.4, -2], [L - 4, 1.1]] as const) { const rod = box(g, M(0x2a2a2a), x, 0.8, zz, 0.06, 3, 0.06); rod.rotation.z = -0.7; rod.position.x += 0.9; }
  }
  /* ---- Cedar Lake campground: campfire ring, log seats, ranger board, canoe rack ---- */
  { const s = site('w-camp', WEST_CAMP.x, WEST_CAMP.z, 4); const g = s.root; const log = M(0x6a4a2a, 0.95), stone = M(0x7a7a78, 1);
    const flame = M(0xffa040, 0.5, 0, 0xff7020, 2.4), flame2 = M(0xffe070, 0.5, 0, 0xffc040, 2.4); s.emissive.push(flame, flame2);
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; box(g, stone, Math.cos(a) * 1.4, 0, Math.sin(a) * 1.4, 0.5, 0.35, 0.5, a); }
    for (let i = 0; i < 3; i++) { const l = box(g, log, 0, 0.15, 0, 1.6, 0.25, 0.25, (i / 3) * Math.PI); l.rotation.z = 0.25; }
    cone(g, flame, 0, 0.2, 0, 0.6, 1.4); cone(g, flame2, 0.15, 0.25, 0.1, 0.32, 0.9);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; const o = cyl(g, log, Math.cos(a) * 3.4, 0.35, Math.sin(a) * 3.4, 0.32, 2.2); o.rotation.set(Math.PI / 2, 0, a + Math.PI / 2); }
    box(g, log, 5.2, 0, -2.5, 0.2, 2.4, 0.2); box(g, log, 7.2, 0, -2.5, 0.2, 2.4, 0.2); box(g, M(0x3a5a3a), 6.2, 1.4, -2.5, 2.4, 1.2, 0.15); // ranger board
    box(g, log, 5, 0, 3, 0.2, 1.2, 0.2); box(g, log, 8, 0, 3, 0.2, 1.2, 0.2); const canoe = box(g, M(0xc85a2a, 0.6), 6.5, 1.2, 3, 4.2, 0.4, 0.8); canoe.rotation.z = 0.05;
  }
  /* ---- Cedar Crossing farmers' market: three striped stalls with produce crates and a chalkboard ---- */
  { const s = site('w-market', WEST_MARKET.x, WEST_MARKET.z, 4.5, WEST_MARKET.rot); const g = s.root; const post = M(0xe8e0d0, 0.8), table = M(0x8a6a44, 0.9);
    const awn = [0xd83a3a, 0x3a8ad8, 0x4aa84a]; const produce = [0xd84a5a, 0xe08a3a, 0xe8d050, 0x8a4ac0, 0xc83030, 0x8aaa3a];
    awn.forEach((col, i) => { const x = (i - 1) * 5.2;
      for (const [dx, dz] of [[-2, -1.4], [2, -1.4], [-2, 1.4], [2, 1.4]] as const) box(g, post, x + dx, 0, dz, 0.15, 2.6, 0.15);
      const a = box(g, M(col, 0.7), x, 2.6, 0, 4.6, 0.25, 3.4); a.rotation.x = 0.12; box(g, M(0xf4f0e8, 0.7), x, 2.62, -0.9, 4.62, 0.26, 0.8);
      box(g, table, x, 0.85, 0.6, 3.8, 0.12, 1.4);
      for (let k = 0; k < 4; k++) { box(g, table, x - 1.5 + k, 0.97, 0.6, 0.8, 0.35, 0.8); box(g, M(produce[(i * 2 + k) % produce.length], 0.8), x - 1.5 + k, 1.25, 0.6, 0.66, 0.16, 0.66); } });
    box(g, table, 8.4, 0, 1.6, 0.12, 1.8, 0.12); box(g, M(0x2a2e2a), 8.4, 0.9, 1.6, 0.08, 1, 1.2); // chalkboard
    const bunt = M(color('w-market'), 0.6, 0, color('w-market'), 0.8); s.emissive.push(bunt); box(g, bunt, 0, 3.1, -1.8, 15, 0.08, 0.08);
  }
  /* ---- Millbrook U-Pick farm stand: open shed, fruit crates, baskets, sign on posts ---- */
  { const s = site('w-upick', WEST_UPICK.x, WEST_UPICK.z, 4.5, Math.atan2(WEST_UPICK.x - WEST_UPICK.field.x, WEST_UPICK.z - WEST_UPICK.field.z)); const g = s.root; // open front faces the hamlet
    const red = M(0xa8302a, 0.8), white = M(0xf0ece0, 0.8), crate = M(0x9a7a4a, 0.9);
    box(g, red, 0, 0, -1.4, 4.6, 2.8, 0.2); box(g, red, -2.2, 0, 0, 0.2, 2.8, 3); box(g, red, 2.2, 0, 0, 0.2, 2.8, 3); const r = box(g, white, 0, 2.8, 0, 5.2, 0.25, 3.6); r.rotation.x = -0.15;
    box(g, crate, 0, 0, 0.6, 3.6, 0.9, 1);
    const fruit = [0xc83030, 0x8aaa3a, 0x6a3a8a, 0x8a4ac0]; fruit.forEach((col, i) => box(g, M(col, 0.8), -1.35 + i * 0.9, 0.9, 0.6, 0.75, 0.2, 0.8));
    for (let i = 0; i < 5; i++) { box(g, crate, 3.4 + (i % 2) * 0.9, Math.floor(i / 2) * 0.6, 1.8, 0.8, 0.55, 0.8); }
    for (const x of [-3.6, -1.4]) box(g, white, x, 0, 3.6, 0.15, 2.6, 0.15);
    const sign = M(color('w-upick'), 0.6, 0, color('w-upick'), 0.9); s.emissive.push(sign); box(g, sign, -2.5, 1.7, 3.6, 2.6, 0.9, 0.12);
  }
  /* ---- Stadium rodeo: a dirt ring on the field, fence rails, bucking chutes and a bull ---- */
  { const s = site('w-rodeo', WEST_RODEO.x, WEST_RODEO.z, 10); const g = s.root; const dirt = M(0x8a6a44, 1), rail = M(0xe8dcc0, 0.8), chute = M(0x6a4a2a, 0.9);
    const disc = new THREE.Mesh(c.geo(new THREE.CylinderGeometry(11, 11, 0.12, c.low ? 20 : 36)), dirt); disc.position.y = 0.3; g.add(disc);
    const n = c.low ? 18 : 30; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; cyl(g, rail, Math.cos(a) * 11, 0.3, Math.sin(a) * 11, 0.1, 1.6); }
    for (const y of [0.9, 1.5]) { const t = new THREE.Mesh(c.geo(new THREE.TorusGeometry(11, 0.07, 4, c.low ? 24 : 48)), rail); t.rotation.x = Math.PI / 2; t.position.y = 0.3 + y; g.add(t); }
    for (let i = 0; i < 3; i++) { const x = -3 + i * 3; box(g, chute, x, 0.3, -12.6, 0.2, 2.2, 3); box(g, chute, x + 1.5, 0.3 + 1.9, -12.6, 3, 0.15, 3); }
    box(g, chute, 4.5, 0.3, -12.6, 0.2, 2.2, 3);
    const bull = M(0x2a1a14, 0.8), horn = M(0xe8e0c8, 0.6); const b = new THREE.Group(); b.position.set(2, 0.3, 1); b.rotation.y = 0.6; g.add(b);
    box(b, bull, 0, 0.9, 0, 2.6, 1.3, 1.1); box(b, bull, 1.6, 1.3, 0, 0.9, 0.8, 0.8); for (const zz of [-0.5, 0.5]) { const h = box(b, horn, 2, 2, zz, 0.12, 0.5, 0.12); h.rotation.x = zz * 1.4; }
    for (const [x, zz] of [[-1, -0.4], [-1, 0.4], [0.9, -0.4], [0.9, 0.4]] as const) box(b, bull, x, 0, zz, 0.3, 0.9, 0.3);
    const cowboy = M(0x3a5a9a, 0.8); box(b, cowboy, -0.1, 1.6, 0, 0.5, 0.9, 0.5); box(b, M(0xd8c090, 0.8), -0.1, 2.5, 0, 0.35, 0.35, 0.35); cyl(b, M(0x8a5a2a, 0.8), -0.1, 2.85, 0, 0.42, 0.08);
    const lamp = M(color('w-rodeo'), 0.6, 0, color('w-rodeo'), 0.9); s.emissive.push(lamp); box(g, lamp, 0, 0.3 + 2.1, -14.2, 9, 0.6, 0.15);
  }
  return out;
}

/** Ranch deeds (shared/westRanch.ts): a ranch barn, trough, hay and gate sign in a corner of each pasture, plus an
 *  invisible pick box over the pasture so clicking anywhere on it opens the deed (or your ranch). */
export function buildWestRanches(c: Ctx): Array<{ id: string; label: string; root: THREE.Group; pick: THREE.Object3D[]; signY: number }> {
  const BOX = c.geo(new THREE.BoxGeometry(1, 1, 1)); const CYL = c.geo(new THREE.CylinderGeometry(1, 1, 1, c.low ? 8 : 12));
  const red = c.mat({ color: 0x9a2a22, roughness: 0.85 }), roof = c.mat({ color: 0x4a4a4e, roughness: 0.7, metalness: 0.3 }), trim = c.mat({ color: 0xf0ece0, roughness: 0.8 });
  const wood = c.mat({ color: 0x7a5a3a, roughness: 0.9 }), hay = c.mat({ color: 0xd8b860, roughness: 1 }), water = c.mat({ color: 0x3a7ab0, roughness: 0.2, metalness: 0.1 });
  const hit = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  return westRanches().map((r) => {
    const g = new THREE.Group(); g.position.set(r.x, 0, r.z); g.rotation.y = r.rot; g.name = `ranch-${r.n}`;
    const add = (m: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, geo: THREE.BufferGeometry = BOX) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y + h / 2, z); o.scale.set(w, h, d); o.castShadow = !c.low; g.add(o); return o; };
    const cx = -r.w / 2 + 4.2, cz = -r.d / 2 + 3.6; // barn in the north-west corner, inside the fence
    add(red, cx, 0, cz, 6, 3.6, 4.6); const rf = add(roof, cx, 3.6, cz - 1.15, 6.4, 0.2, 2.8); rf.rotation.x = 0.55; const rb = add(roof, cx, 3.6, cz + 1.15, 6.4, 0.2, 2.8); rb.rotation.x = -0.55;
    add(trim, cx, 0.1, cz + 2.32, 2.2, 2.6, 0.06); add(red, cx, 0.12, cz + 2.34, 1.9, 2.3, 0.06);
    add(wood, cx + 5, 0, cz + 0.5, 2.6, 0.6, 0.9); add(water, cx + 5, 0.55, cz + 0.5, 2.4, 0.06, 0.7); // trough
    for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(CYL, hay); b.scale.set(0.7, 1.1, 0.7); b.rotation.z = Math.PI / 2; b.position.set(cx - 1.6 + i * 1.6, 0.7, cz + 4.2); g.add(b); }
    add(wood, cx - 2.6, 0, r.d / 2 - 0.6, 0.18, 2.4, 0.18); add(wood, cx + 0.6, 0, r.d / 2 - 0.6, 0.18, 2.4, 0.18); add(trim, cx - 1, 1.7, r.d / 2 - 0.6, 3.4, 0.8, 0.1); // gate sign
    const pick = new THREE.Mesh(BOX, hit); pick.scale.set(r.w, 1.6, r.d); pick.position.y = 0.8; g.add(pick);
    const all: THREE.Object3D[] = []; g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.userData.spot = r.id; all.push(o); } });
    return { id: r.id, label: r.label, root: g, pick: all, signY: 7 };
  });
}

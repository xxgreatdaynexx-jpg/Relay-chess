/**
 * Outskirts venues (shared/venues.ts): the Airport grounds (apron, runway with edge lights, taxi/access roads, no ambient
 * aircraft: only live player flights/freight are drawn, by worldFreight.ts) and the Speedway grounds (oval asphalt with kerbs, start/finish
 * chequers, timing-gate posts, access road). The terminal and grandstand buildings are landmark cases in world3d.ts.
 */
import { xmasOn } from '../../../shared/holiday';
import { xmasGround } from './worldXmas';
import * as THREE from 'three';
import { addFuselage, addTail } from './planeNose';
import { trackOffset, wallOpen, WALL_OUT, WALL_IN } from '../../../shared/racePhysics';
import { AIRPORT, AIRPORT_SLOT, RUNWAY, AIRPORT_ROADS, RACETRACK, RACETRACK_ROADS, TRACK, trackPoint, GATES, type Rect } from '../../../shared/venues';
const NEON = 0.65; // matches world3d's toned-down neon

type Mk = { mat: (o: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial; geo: <T extends THREE.BufferGeometry>(g: T) => T };

export function plane(): THREE.Group {
  const g = new THREE.Group(); const white = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.5 }); const tail = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o; };
  // mu-visuals nose fix: was a 0.9→0.7 tapered tube with a 0.9 cone stuck on the 0.7 end (step + seam, rocket nose).
  addFuselage(g, { r: 0.85, len: 11, nose: 2, tail: 1.6, axis: 'x', body: white, glass: new THREE.MeshStandardMaterial({ color: 0x1a2430, metalness: 0.7, roughness: 0.15 }) });
  for (let i = 0; i < 12; i++) for (const s of [-1, 1]) add(new THREE.CircleGeometry(0.12, 8), new THREE.MeshStandardMaterial({ color: 0x1a2430 }), 3.6 - i * 0.62, 0.3, s * 0.862, 0, s < 0 ? Math.PI : 0, 0);
  add(new THREE.BoxGeometry(3, 0.2, 14), white, 0.5, -0.2, 0); // wings
  const fin = addTail(g, { r: 0.85, len: 11, axis: 'x', fin: tail, stab: white, h: 3, c: 2.8 }); // mu-visuals tail fins
  for (const z of [-3, 3]) add(new THREE.CylinderGeometry(0.45, 0.45, 1.6, 8), tail, 1, -0.8, z, 0, 0, Math.PI / 2);
  const nav = new THREE.MeshBasicMaterial({ color: 0xff3040 }); add(new THREE.SphereGeometry(0.25, 6, 4), nav, 0.5, -0.1, -7); g.userData.blink = add(new THREE.SphereGeometry(0.3, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), fin.userData.rootLE - 0.85 * 3 * 0.85 - 0.6, fin.userData.base + 0.85 * 3 + 0.05, 0);
  return g;
}
const disposeTree = (o: THREE.Object3D) => o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { if (!m.geometry.userData.shared) m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose()); } });

/** Builds the venue grounds into `scene`; returns the per-frame animation step and a disposer for the planes. */
export function buildVenues(scene: THREE.Scene, { mat, geo }: Mk): { step: (dt: number, time: number, cam?: THREE.Vector3) => void; dispose: () => void } {
  const grass = [mat({ color: 0x3a2a1c }), mat({ color: 0x3a2a1c }), mat({ color: 0x3f9040, roughness: 1, emissive: 0x0d3412, emissiveIntensity: 0.6 }), mat({ color: 0x2a1c12 }), mat({ color: 0x3a2a1c }), mat({ color: 0x3a2a1c })];
  const snowy: THREE.Material[] = []; // Christmas: the venue grounds are snow too (world3d swaps the rest of the map)
  const slab = (r: Rect) => { let top = grass; if (xmasOn()) { const sm = xmasGround(r.x1 - r.x0, r.z1 - r.z0, false); snowy.push(sm); top = [grass[0], grass[1], sm, grass[3], grass[4], grass[5]]; }
    const m = new THREE.Mesh(geo(new THREE.BoxGeometry(r.x1 - r.x0, 3, r.z1 - r.z0)), top); m.position.set((r.x0 + r.x1) / 2, -1.51, (r.z0 + r.z1) / 2); scene.add(m); };
  slab(AIRPORT); slab(RACETRACK);
  // Tarmac layers (pt1243u fix: the grass used to carry a polygon offset that pulled it over every surface here, so the
  // runway, apron and track never showed). Surfaces now sit at road height with their own offsets, markings above them.
  const tar = (o: THREE.MeshStandardMaterialParameters, k: number) => mat({ ...o, polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -2 * k });
  const asphalt = tar({ color: 0x3a3d47, roughness: 0.95 }, 2); const paint = tar({ color: 0xf2f2f2, roughness: 0.8 }, 4); const yellow = tar({ color: 0xffd23a, roughness: 0.8 }, 4);
  const flat = (w: number, d: number, m: THREE.Material, x: number, z: number, y = 0.04, rot = 0) => { const o = new THREE.Mesh(geo(new THREE.PlaneGeometry(w, d)), m); o.rotation.set(-Math.PI / 2, 0, rot); o.position.set(x, y, z); scene.add(o); return o; };
  // access roads + taxiway are drawn with the rural roads in world3d (one asphalt, junction-aware dashes)

  // ---- Airport: apron, runway + centreline dashes, threshold bars, edge lights ----
  const apronMat = tar({ color: 0x6e7178, roughness: 0.9 }, 1); const shoulder = tar({ color: 0x2a2c33, roughness: 0.95 }, 1);
  flat(34, 30, apronMat, AIRPORT_SLOT[0] - 6, AIRPORT_SLOT[1], 0.07);
  const rl = RUNWAY.z1 - RUNWAY.z0, rz = (RUNWAY.z0 + RUNWAY.z1) / 2;
  flat(RUNWAY.w + 2, rl + 4, shoulder, RUNWAY.x, rz, 0.07); flat(RUNWAY.w, rl, asphalt, RUNWAY.x, rz, 0.085);
  for (let z = RUNWAY.z0 + 12; z < RUNWAY.z1 - 12; z += 7) flat(0.4, 3.5, paint, RUNWAY.x, z, 0.1); // centreline
  for (const sx of [-1, 1]) flat(0.3, rl - 2, paint, RUNWAY.x + sx * (RUNWAY.w / 2 - 0.4), rz, 0.1); // edge lines
  for (const z of [RUNWAY.z0 + 3, RUNWAY.z1 - 3]) for (let k = -3; k <= 3; k++) if (k) flat(0.7, 4, paint, RUNWAY.x + k * 1.2, z, 0.1); // thresholds
  for (const z of [RUNWAY.z0 + 24, RUNWAY.z1 - 24]) for (const sx of [-1, 1]) flat(1.4, 6, paint, RUNWAY.x + sx * 2.2, z, 0.1); // aiming points
  // parallel taxiway west of the terminal road, with links on to the runway at both ends and the middle
  const TX = RUNWAY.x + RUNWAY.w / 2 + 9, tz0 = RUNWAY.z0 + 8, tz1 = RUNWAY.z1 - 8;
  flat(4.5, tz1 - tz0 + 4.5, asphalt, TX, (tz0 + tz1) / 2, 0.08); flat(0.25, tz1 - tz0, yellow, TX, (tz0 + tz1) / 2, 0.1);
  for (const z of [tz0, tz1]) { flat(TX - RUNWAY.x, 4.5, asphalt, (TX + RUNWAY.x) / 2, z, 0.08); flat(TX - RUNWAY.x - RUNWAY.w / 2, 0.25, yellow, (TX + RUNWAY.x + RUNWAY.w / 2) / 2, z, 0.1); }
  const lightPos: number[] = []; for (let z = RUNWAY.z0; z <= RUNWAY.z1; z += 6) lightPos.push(RUNWAY.x - RUNWAY.w / 2 - 0.4, z, RUNWAY.x + RUNWAY.w / 2 + 0.4, z);
  const lm = new THREE.InstancedMesh(geo(new THREE.SphereGeometry(0.22, 6, 4)), new THREE.MeshBasicMaterial({ color: 0x9fd0ff }), lightPos.length / 2);
  { const d = new THREE.Object3D(); for (let i = 0; i < lightPos.length / 2; i++) { d.position.set(lightPos[i * 2], 0.3, lightPos[i * 2 + 1]); d.updateMatrix(); lm.setMatrixAt(i, d.matrix); } } scene.add(lm);
  flat(0.4, AIRPORT_SLOT[0] - 8 - RUNWAY.x - RUNWAY.w / 2, yellow, (AIRPORT_SLOT[0] - 8 + RUNWAY.x + RUNWAY.w / 2) / 2, AIRPORT_SLOT[1], 0.1, Math.PI / 2); // taxiway centreline

  // ---- Speedway: oval ribbon (asphalt), red/white kerbs, chequered start line, gate posts ----
  const N = 160; const pos: number[] = []; const kerb: number[] = []; const kcol: number[] = []; const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const [x, z, a] = trackPoint(i / N); const nx = Math.sin(a), nz = -Math.cos(a); // left normal (heading a in x/z)
    const h = TRACK.W / 2; pos.push(x + nx * h, 0.085, z + nz * h, x - nx * h, 0.085, z - nz * h);
    const c = (i % 2) ? [0.85, 0.1, 0.12] : [0.95, 0.95, 0.95];
    for (const s of [1, -1]) { kerb.push(x + nx * s * (h - 0.2), 0.095, z + nz * s * (h - 0.2), x + nx * s * (h + 0.9), 0.095, z + nz * s * (h + 0.9)); kcol.push(...c, ...c); }
    if (i) { const o = (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  const uv: number[] = []; { let run = 0; for (let i = 0; i <= N; i++) { if (i) run += Math.hypot(pos[i * 6] - pos[i * 6 - 6], pos[i * 6 + 2] - pos[i * 6 - 4]); uv.push(0, run / 8, 1, run / 8); } }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); tg.setIndex(idx); tg.computeVertexNormals();
  const tm = new THREE.Mesh(geo(tg), tar({ color: 0xffffff, map: trackTexture(), roughness: 0.92, side: THREE.DoubleSide }, 2)); scene.add(tm);
  // Barriers: blue/white armco on the outside, tyre-wall stacks on the infield, both with the access-road and pit-lane gaps
  // the physics leaves open (shared/racePhysics wallOpen).
  { const segs: { x: number; z: number; a: number; out: boolean; i: number }[] = []; const M = 360;
    for (const out of [true, false]) for (let i = 0; i < M; i++) {
      const [cx0, cz0, a] = trackPoint(i / M); const n = trackOffset(cx0, cz0); const d = out ? WALL_OUT + 0.25 : WALL_IN - 0.25;
      const x = cx0 + n.nx * d, z = cz0 + n.nz * d; if (wallOpen(out ? 'out' : 'in', x, z)) continue; segs.push({ x, z, a, out, i });
    }
    const len = (2 * Math.PI * TRACK.R + 4 * TRACK.L) / M + 0.15; const outs = segs.filter((g) => g.out), ins = segs.filter((g) => !g.out);
    const rail = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(len * 1.3, 0.75, 0.25)), mat({ color: 0xffffff, metalness: 0.55, roughness: 0.4 }), outs.length);
    const tyres = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 10)), mat({ color: 0xffffff, roughness: 0.9 }), ins.length * 2);
    const d = new THREE.Object3D(); const c = new THREE.Color();
    outs.forEach((g, k) => { d.position.set(g.x, 0.45, g.z); d.rotation.set(0, -g.a, 0); d.updateMatrix(); rail.setMatrixAt(k, d.matrix); rail.setColorAt(k, c.set(Math.floor(g.i / 6) % 2 ? 0x2a5bd7 : 0xf1f3f6)); });
    ins.forEach((g, k) => { for (const j of [0, 1]) { const off = (j - 0.5) * len * 0.5; d.position.set(g.x + Math.cos(g.a) * off, 0.45, g.z + Math.sin(g.a) * off); d.rotation.set(0, 0, 0); d.updateMatrix(); tyres.setMatrixAt(k * 2 + j, d.matrix); tyres.setColorAt(k * 2 + j, c.set(Math.floor(g.i / 3) % 2 ? 0xd8202a : 0x1a1a1c)); } });
    scene.add(rail, tyres);
  }
  const kidx: number[] = []; for (let i = 1; i <= N; i++) for (const s of [0, 1]) { const o = ((i - 1) * 2 + s) * 2; kidx.push(o, o + 1, o + 4, o + 1, o + 5, o + 4); }
  const kg = new THREE.BufferGeometry(); kg.setAttribute('position', new THREE.Float32BufferAttribute(kerb, 3)); kg.setAttribute('color', new THREE.Float32BufferAttribute(kcol, 3)); kg.setIndex(kidx);
  scene.add(new THREE.Mesh(geo(kg), tar({ color: 0xffffff, vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }, 3)));
  { const [x, z, a] = trackPoint(0); const black = tar({ color: 0x111111 }, 4); for (let i = 0; i < 10; i++) for (let j = 0; j < 2; j++) flat(1, 1, (i + j) % 2 ? black : paint, 0, 0, 0.1).position.set(x + Math.sin(a) * (i - 4.5) + Math.cos(a) * (j - 0.5), 0.1, z - Math.cos(a) * (i - 4.5) + Math.sin(a) * (j - 0.5)); }
  // pit lane inside the start straight (with entry/exit links) and grandstands outside both straights
  { const { cx, cz, L, R, W } = TRACK; const pz = cz + R - W / 2 - 3.2;
    flat(2 * L - 6, 3.6, asphalt, cx, pz, 0.08); flat(2 * L - 6, 0.2, paint, cx, pz - 1.9, 0.1);
    for (const sx of [-1, 1]) flat(4, 3.6, asphalt, cx + sx * (L - 3), pz + 1.6, 0.08, sx * 0.6);
    for (let i = -4; i <= 4; i++) { const b = new THREE.Mesh(geo(new THREE.BoxGeometry(5.6, 1.6, 2.4)), mat({ color: 0x7d8494, roughness: 0.8 })); b.position.set(cx + i * 7, 0.8, pz - 4.2); scene.add(b); }
    const standMat = mat({ color: 0x8d96a6, roughness: 0.8 }); const seatMat = mat({ color: 0x6a7282, roughness: 0.8 });
    for (const [z0, dir] of [[cz + R + W / 2 + 2.5, 1], [cz - R - W / 2 - 2.5, -1]] as Array<[number, number]>) for (let r = 0; r < 4; r++) {
      const st = new THREE.Mesh(geo(new THREE.BoxGeometry(2 * L - 14, 0.8 + r * 0.9, 1.6)), r % 2 ? seatMat : standMat); st.position.set(cx + (dir > 0 ? -16 : 0), (0.8 + r * 0.9) / 2, z0 + dir * r * 1.6); scene.add(st); } }
  const gateMat = mat({ color: 0xff7a1a, emissive: 0xff7a1a, emissiveIntensity: 0.6 * NEON }); const post = geo(new THREE.CylinderGeometry(0.2, 0.2, 3.2, 6));
  for (const [[ax, az], [bx, bz]] of GATES) for (const [x, z] of [[ax, az], [bx, bz]]) { const p = new THREE.Mesh(post, gateMat); p.position.set(x, 1.6, z); scene.add(p); }
  let ban: THREE.Mesh;
  { const [[ax, az], [bx, bz]] = GATES[0]; ban = new THREE.Mesh(geo(new THREE.BoxGeometry(Math.hypot(bx - ax, bz - az), 0.8, 0.2)), mat({ color: 0x15171d, emissive: 0xffffff, emissiveIntensity: 0.08 })); ban.position.set((ax + bx) / 2, 5.5, (az + bz) / 2); ban.rotation.y = -Math.atan2(bz - az, bx - ax); scene.add(ban); }

  // Only planes players are actually using are drawn (live freight/jet traffic in worldFreight.ts); no ambient airliners.
  // Start banner: fades/shrinks away when the camera comes close, so it never blocks the chase view on the grid.
  let banK = 1;
  const step = (dt: number, time: number, cam?: THREE.Vector3) => {
    if (cam) { const d = Math.hypot(cam.x - ban.position.x, cam.z - ban.position.z); const want = d < 30 ? 0 : 1; banK += (want - banK) * Math.min(1, dt * 3);
      ban.visible = banK > 0.03; ban.scale.set(1, Math.max(0.03, banK), 1); }
  };
  return { step, dispose: () => { snowy.forEach((m) => { (m as THREE.MeshStandardMaterial).map?.dispose(); m.dispose(); }); } };
}

/** Speedway asphalt: grainy tarmac, a darker racing line down the middle, white edge lines (U across, V along). */
function trackTexture(): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256; const g = cv.getContext('2d')!;
  g.fillStyle = '#3a3c43'; g.fillRect(0, 0, 128, 256);
  const grad = g.createLinearGradient(0, 0, 128, 0); grad.addColorStop(0.25, 'rgba(0,0,0,0)'); grad.addColorStop(0.5, 'rgba(10,10,14,.35)'); grad.addColorStop(0.75, 'rgba(0,0,0,0)'); g.fillStyle = grad; g.fillRect(0, 0, 128, 256);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 2600; k++) { const v = 40 + rnd() * 50; g.fillStyle = `rgba(${v},${v},${v + 6},${0.35 + rnd() * 0.4})`; g.fillRect(rnd() * 128, rnd() * 256, 1 + rnd() * 1.5, 1 + rnd() * 1.5); }
  g.fillStyle = '#e8e8e8'; g.fillRect(3, 0, 3, 256); g.fillRect(122, 0, 3, 256);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

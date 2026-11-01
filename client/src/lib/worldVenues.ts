/**
 * Outskirts venues (shared/venues.ts): the Airport grounds (apron, runway with edge lights, taxi/access roads, two
 * airliners flying a take-off / circuit / landing loop) and the Speedway grounds (oval asphalt with kerbs, start/finish
 * chequers, timing-gate posts, access road). The terminal and grandstand buildings are landmark cases in world3d.ts.
 */
import * as THREE from 'three';
import { AIRPORT, AIRPORT_SLOT, RUNWAY, AIRPORT_ROADS, RACETRACK, RACETRACK_ROADS, TRACK, trackPoint, GATES, type Rect } from '../../../shared/venues';
const NEON = 0.65; // matches world3d's toned-down neon

type Mk = { mat: (o: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial; geo: <T extends THREE.BufferGeometry>(g: T) => T };

function plane(): THREE.Group {
  const g = new THREE.Group(); const white = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.5 }); const tail = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o; };
  add(new THREE.CylinderGeometry(0.9, 0.7, 12, 10), white, 0, 0, 0, 0, 0, Math.PI / 2); // fuselage along +x
  add(new THREE.ConeGeometry(0.9, 2, 10), white, 7, 0, 0, 0, 0, -Math.PI / 2);
  add(new THREE.BoxGeometry(3, 0.2, 14), white, 0.5, -0.2, 0); // wings
  add(new THREE.BoxGeometry(1.6, 0.15, 5), white, -5.2, 0.3, 0); // tailplane
  add(new THREE.BoxGeometry(1.8, 2.6, 0.2), tail, -5.4, 1.4, 0); // fin
  for (const z of [-3, 3]) add(new THREE.CylinderGeometry(0.45, 0.45, 1.6, 8), tail, 1, -0.8, z, 0, 0, Math.PI / 2);
  const nav = new THREE.MeshBasicMaterial({ color: 0xff3040 }); add(new THREE.SphereGeometry(0.25, 6, 4), nav, 0.5, -0.1, -7); g.userData.blink = add(new THREE.SphereGeometry(0.3, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), -5.4, 2.8, 0);
  return g;
}
const disposeTree = (o: THREE.Object3D) => o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose()); } });

/** Builds the venue grounds into `scene`; returns the per-frame animation step and a disposer for the planes. */
export function buildVenues(scene: THREE.Scene, { mat, geo }: Mk): { step: (dt: number, time: number, cam?: THREE.Vector3) => void; dispose: () => void } {
  const grass = [mat({ color: 0x3a2a1c }), mat({ color: 0x3a2a1c }), mat({ color: 0x3f9040, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, emissive: 0x0d3412, emissiveIntensity: 0.6 }), mat({ color: 0x2a1c12 }), mat({ color: 0x3a2a1c }), mat({ color: 0x3a2a1c })];
  const slab = (r: Rect) => { const m = new THREE.Mesh(geo(new THREE.BoxGeometry(r.x1 - r.x0, 3, r.z1 - r.z0)), grass); m.position.set((r.x0 + r.x1) / 2, -1.5, (r.z0 + r.z1) / 2); scene.add(m); };
  slab(AIRPORT); slab(RACETRACK);
  const asphalt = mat({ color: 0x2c2f38, roughness: 0.95 }); const paint = mat({ color: 0xf2f2f2, roughness: 0.8 }); const yellow = mat({ color: 0xffd23a, roughness: 0.8 });
  const flat = (w: number, d: number, m: THREE.Material, x: number, z: number, y = 0.04, rot = 0) => { const o = new THREE.Mesh(geo(new THREE.PlaneGeometry(w, d)), m); o.rotation.set(-Math.PI / 2, 0, rot); o.position.set(x, y, z); scene.add(o); return o; };
  // access roads + taxiway are drawn with the rural roads in world3d (one asphalt, junction-aware dashes)

  // ---- Airport: apron, runway + centreline dashes, threshold bars, edge lights ----
  flat(30, 26, mat({ color: 0x4a4e5a, roughness: 0.9 }), AIRPORT_SLOT[0] - 4, AIRPORT_SLOT[1], 0.03);
  const rl = RUNWAY.z1 - RUNWAY.z0; flat(RUNWAY.w, rl, asphalt, RUNWAY.x, (RUNWAY.z0 + RUNWAY.z1) / 2, 0.045);
  for (let z = RUNWAY.z0 + 10; z < RUNWAY.z1 - 10; z += 7) flat(0.4, 3.5, paint, RUNWAY.x, z, 0.05);
  for (const z of [RUNWAY.z0 + 3, RUNWAY.z1 - 3]) for (let k = -3; k <= 3; k++) if (k) flat(0.7, 4, paint, RUNWAY.x + k * 1.2, z, 0.05);
  const lightPos: number[] = []; for (let z = RUNWAY.z0; z <= RUNWAY.z1; z += 6) lightPos.push(RUNWAY.x - RUNWAY.w / 2 - 0.4, z, RUNWAY.x + RUNWAY.w / 2 + 0.4, z);
  const lm = new THREE.InstancedMesh(geo(new THREE.SphereGeometry(0.22, 6, 4)), new THREE.MeshBasicMaterial({ color: 0x9fd0ff }), lightPos.length / 2);
  { const d = new THREE.Object3D(); for (let i = 0; i < lightPos.length / 2; i++) { d.position.set(lightPos[i * 2], 0.25, lightPos[i * 2 + 1]); d.updateMatrix(); lm.setMatrixAt(i, d.matrix); } } scene.add(lm);
  flat(0.4, AIRPORT_SLOT[0] - 8 - RUNWAY.x - RUNWAY.w / 2, yellow, (AIRPORT_SLOT[0] - 8 + RUNWAY.x + RUNWAY.w / 2) / 2, AIRPORT_SLOT[1], 0.05, Math.PI / 2); // taxiway centreline

  // ---- Speedway: oval ribbon (asphalt), red/white kerbs, chequered start line, gate posts ----
  const N = 160; const pos: number[] = []; const kerb: number[] = []; const kcol: number[] = []; const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const [x, z, a] = trackPoint(i / N); const nx = Math.sin(a), nz = -Math.cos(a); // left normal (heading a in x/z)
    const h = TRACK.W / 2; pos.push(x + nx * h, 0.05, z + nz * h, x - nx * h, 0.05, z - nz * h);
    const c = (i % 2) ? [0.85, 0.1, 0.12] : [0.95, 0.95, 0.95];
    for (const s of [1, -1]) { kerb.push(x + nx * s * h, 0.07, z + nz * s * h, x + nx * s * (h + 0.9), 0.07, z + nz * s * (h + 0.9)); kcol.push(...c, ...c); }
    if (i) { const o = (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.setIndex(idx); tg.computeVertexNormals();
  const tm = new THREE.Mesh(geo(tg), mat({ color: 0x2a2c33, roughness: 0.95, side: THREE.DoubleSide })); scene.add(tm);
  const kidx: number[] = []; for (let i = 1; i <= N; i++) for (const s of [0, 1]) { const o = ((i - 1) * 2 + s) * 2; kidx.push(o, o + 1, o + 4, o + 1, o + 5, o + 4); }
  const kg = new THREE.BufferGeometry(); kg.setAttribute('position', new THREE.Float32BufferAttribute(kerb, 3)); kg.setAttribute('color', new THREE.Float32BufferAttribute(kcol, 3)); kg.setIndex(kidx);
  scene.add(new THREE.Mesh(geo(kg), mat({ color: 0xffffff, vertexColors: true, roughness: 0.8, side: THREE.DoubleSide })));
  { const [x, z, a] = trackPoint(0); const black = mat({ color: 0x111111 }); for (let i = 0; i < 10; i++) for (let j = 0; j < 2; j++) flat(1, 1, (i + j) % 2 ? black : paint, 0, 0, 0.06).position.set(x + Math.sin(a) * (i - 4.5) + Math.cos(a) * (j - 0.5), 0.06, z - Math.cos(a) * (i - 4.5) + Math.sin(a) * (j - 0.5)); }
  const gateMat = mat({ color: 0xff7a1a, emissive: 0xff7a1a, emissiveIntensity: 0.6 * NEON }); const post = geo(new THREE.CylinderGeometry(0.2, 0.2, 3.2, 6));
  for (const [[ax, az], [bx, bz]] of GATES) for (const [x, z] of [[ax, az], [bx, bz]]) { const p = new THREE.Mesh(post, gateMat); p.position.set(x, 1.6, z); scene.add(p); }
  let ban: THREE.Mesh;
  { const [[ax, az], [bx, bz]] = GATES[0]; ban = new THREE.Mesh(geo(new THREE.BoxGeometry(Math.hypot(bx - ax, bz - az), 0.8, 0.2)), mat({ color: 0x15171d, emissive: 0xffffff, emissiveIntensity: 0.08 })); ban.position.set((ax + bx) / 2, 5.5, (az + bz) / 2); ban.rotation.y = -Math.atan2(bz - az, bx - ax); scene.add(ban); }

  // ---- Planes: a closed circuit around the runway; they roll along it, rotate, climb out, loop, descend and land ----
  const gz0 = RUNWAY.z1 - 6, gz1 = RUNWAY.z0 + 6; // take off heading north (-z)
  const circuit = new THREE.CatmullRomCurve3([
    new THREE.Vector3(RUNWAY.x, 1.4, gz0), new THREE.Vector3(RUNWAY.x, 1.4, (gz0 + gz1) / 2 + 10), new THREE.Vector3(RUNWAY.x, 8, gz1),
    new THREE.Vector3(RUNWAY.x - 10, 30, gz1 - 40), new THREE.Vector3(RUNWAY.x - 70, 45, (RUNWAY.z0 + RUNWAY.z1) / 2), new THREE.Vector3(RUNWAY.x - 10, 30, RUNWAY.z1 + 45),
    new THREE.Vector3(RUNWAY.x, 6, RUNWAY.z1 + 4),
  ], true, 'centripetal');
  const planes = [plane(), plane()]; planes.forEach((p) => scene.add(p));
  const ts = [0, 0.5]; const tmp = new THREE.Vector3(); const ahead = new THREE.Vector3();
  // Start banner: fades/shrinks away when the camera comes close, so it never blocks the chase view on the grid.
  let banK = 1;
  const step = (dt: number, time: number, cam?: THREE.Vector3) => {
    if (cam) { const d = Math.hypot(cam.x - ban.position.x, cam.z - ban.position.z); const want = d < 30 ? 0 : 1; banK += (want - banK) * Math.min(1, dt * 3);
      ban.visible = banK > 0.03; ban.scale.set(1, Math.max(0.03, banK), 1); }
    planes.forEach((p, i) => {
      ts[i] = (ts[i] + dt / 46) % 1; const u = ts[i]; circuit.getPointAt(u, tmp); circuit.getPointAt((u + 0.004) % 1, ahead);
      p.position.copy(tmp); p.lookAt(ahead); p.rotateY(-Math.PI / 2); // model's nose is +x
      (p.userData.blink as THREE.Object3D).visible = Math.sin(time * 5 + i) > 0.3;
    });
  };
  return { step, dispose: () => planes.forEach(disposeTree) };
}

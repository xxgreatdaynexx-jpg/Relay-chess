/**
 * Shared home shell: type-scaled rooms, walls, doorways, trim, windows, and warm lighting.
 * Used by the enterable interior and the local preview page.
 */
import * as THREE from 'three';
import { frontDoor, homePlan, wallSegments, type HomePlan, type HomeRoom } from '../../../shared/homePlan';

const THICK = 0.14;
const TRIM_H = 0.12;
const TRIM_T = 0.04;
const WIN_GLASS = 0x9fd4ff;

const roomTint: Record<string, [number, number, number]> = {
  kitchen: [22, 10, -18],
  dining: [16, 4, -14],
  bath: [18, 22, 32],
  bath1: [18, 22, 32],
  bath2: [18, 22, 32],
  foyer: [-16, -18, -22],
  hall: [-12, -14, -16],
  office: [-18, -10, 4],
  library: [-20, -16, -4],
  lounge: [14, -4, -14],
};

const shift = (hex: number, d: [number, number, number] | undefined) => {
  if (!d) return hex;
  const r = Math.max(0, Math.min(255, ((hex >> 16) & 255) + d[0]));
  const g = Math.max(0, Math.min(255, ((hex >> 8) & 255) + d[1]));
  const b = Math.max(0, Math.min(255, (hex & 255) + d[2]));
  return (r << 16) | (g << 8) | b;
};

const mid = (a: number, b: number) => (a + b) / 2;
const len = (a: number, b: number) => Math.abs(b - a);

export function homeCamera(plan: HomePlan) {
  const y = Math.max(15, plan.d * 1.05 + 7, plan.w * 0.48 + 11);
  const z = plan.d + Math.max(6.5, plan.w * 0.3 + 3);
  return { x: plan.w / 2, y, z, lx: plan.w / 2, ly: 0.2, lz: plan.d * 0.46 };
}

export interface HomeShell {
  group: THREE.Group;
  setColors: (wall: number, wallAccent: number, floor: number, floorAccent: number) => void;
  dispose: () => void;
}

export function buildHomeShell(plan: HomePlan, opts: { wall: number; wallAccent: number; floor: number; floorAccent: number; low?: boolean }): HomeShell {
  const group = new THREE.Group();
  group.name = 'home-shell';
  const H = plan.wallH;
  const wallMat = new THREE.MeshStandardMaterial({ color: opts.wall, roughness: 0.88, metalness: 0.02 });
  const trimMat = new THREE.MeshStandardMaterial({ color: opts.wallAccent, roughness: 0.55, metalness: 0.08 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xf3eee6, roughness: 0.92 });
  const glassMat = new THREE.MeshStandardMaterial({ color: WIN_GLASS, roughness: 0.12, metalness: 0.15, emissive: 0x6a90b8, emissiveIntensity: 0.45, transparent: true, opacity: 0.72 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.5, metalness: 0.05 });
  const floorMats = new Map<string, THREE.MeshStandardMaterial>();

  const add = (mesh: THREE.Mesh, mat: THREE.Material, shadows = true) => {
    mesh.material = mat;
    mesh.castShadow = shadows && !opts.low;
    mesh.receiveShadow = !opts.low;
    group.add(mesh);
    return mesh;
  };

  // Per-room floors (slightly inset so the wall thickness reads)
  for (const r of plan.rooms) {
    const mat = new THREE.MeshStandardMaterial({ color: shift(opts.floor, roomTint[r.id]), roughness: r.id.startsWith('bath') ? 0.35 : 0.75, metalness: r.id.startsWith('bath') ? 0.08 : 0 });
    floorMats.set(r.id, mat);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(r.w - 0.04, r.d - 0.04), mat);
    fl.rotation.x = -Math.PI / 2;
    fl.position.set(r.x + r.w / 2, 0.005, r.z + r.d / 2);
    fl.receiveShadow = true;
    group.add(fl);
  }

  const segs = wallSegments(plan);
  for (const s of segs) {
    const vertical = s.x0 === s.x1;
    const L = vertical ? len(s.z0, s.z1) : len(s.x0, s.x1);
    if (L < 0.05) continue;
    // Cut the south exterior wall down to a half-wall so the camera can see into the front rooms (dollhouse view).
    const south = !vertical && Math.abs(s.z0 - plan.d) < 1e-6;
    const h = south ? 1.08 : H;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(vertical ? THICK : L, h, vertical ? L : THICK), wallMat);
    wall.position.set(vertical ? s.x0 : mid(s.x0, s.x1), h / 2, vertical ? mid(s.z0, s.z1) : s.z0);
    add(wall, wallMat);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(vertical ? THICK + TRIM_T * 2 : L, TRIM_H, vertical ? L : THICK + TRIM_T * 2), trimMat);
    trim.position.set(wall.position.x, TRIM_H / 2, wall.position.z);
    add(trim, trimMat, false);
    if (!south) {
      const crown = new THREE.Mesh(new THREE.BoxGeometry(vertical ? THICK + TRIM_T * 2 : L, TRIM_H * 0.7, vertical ? L : THICK + TRIM_T * 2), trimMat);
      crown.position.set(wall.position.x, H - TRIM_H * 0.4, wall.position.z);
      add(crown, trimMat, false);
    }
  }

  const doors = [...plan.doors, frontDoor(plan)];
  for (const d of doors) {
    const jamW = 0.1, jamD = THICK + 0.06, opening = d.width, headH = 2.15;
    if (d.dir === 'x') {
      for (const side of [-1, 1]) {
        const jam = new THREE.Mesh(new THREE.BoxGeometry(jamD, headH, jamW), frameMat);
        jam.position.set(d.x, headH / 2, d.z + side * (opening / 2));
        add(jam, frameMat, false);
      }
      const head = new THREE.Mesh(new THREE.BoxGeometry(jamD, jamW, opening + jamW * 2), frameMat);
      head.position.set(d.x, headH, d.z);
      add(head, frameMat, false);
    } else {
      for (const side of [-1, 1]) {
        const jam = new THREE.Mesh(new THREE.BoxGeometry(jamW, headH, jamD), frameMat);
        jam.position.set(d.x + side * (opening / 2), headH / 2, d.z);
        add(jam, frameMat, false);
      }
      const head = new THREE.Mesh(new THREE.BoxGeometry(opening + jamW * 2, jamW, jamD), frameMat);
      head.position.set(d.x, headH, d.z);
      add(head, frameMat, false);
    }
  }

  // Windows sit on exterior walls, slightly proud of the surface. Skip the cutaway south wall.
  for (const w of plan.windows) {
    if (w.dir === 's') continue;
    const W = w.width, Hh = 1.25, sill = 1.15;
    let x = w.x, z = w.z, rx = 0;
    if (w.dir === 'n') z = 0.02;
    else if (w.dir === 'w') { x = 0.02; rx = Math.PI / 2; }
    else { x = plan.w - 0.02; rx = Math.PI / 2; }
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(W, Hh), glassMat);
    glass.position.set(x, sill + Hh / 2, z);
    if (rx) glass.rotation.y = rx;
    group.add(glass);
    const fw = 0.07;
    const mk = (gw: number, gh: number, px: number, py: number, pz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(rx ? fw : gw, gh, rx ? gw : fw), frameMat);
      m.position.set(px, py, pz);
      add(m, frameMat, false);
    };
    const cx = x, cy = sill + Hh / 2, cz = z;
    if (!rx) {
      mk(W + fw, fw, cx, cy + Hh / 2, cz);
      mk(W + fw, fw, cx, cy - Hh / 2, cz);
      mk(fw, Hh, cx - W / 2, cy, cz);
      mk(fw, Hh, cx + W / 2, cy, cz);
      mk(W, fw * 0.7, cx, cy, cz); // muntin
    } else {
      mk(W + fw, fw, cx, cy + Hh / 2, cz);
      mk(W + fw, fw, cx, cy - Hh / 2, cz);
      mk(fw, Hh, cx, cy, cz - W / 2);
      mk(fw, Hh, cx, cy, cz + W / 2);
      mk(W, fw * 0.7, cx, cy, cz);
    }
  }

  // A shallow ceiling ring so the top of the walls doesn't look hollow (open middle so the camera can see in)
  const inset = 0.8;
  const ring = [
    { x: plan.w / 2, z: inset / 2, w: plan.w, d: inset },
    { x: inset / 2, z: plan.d / 2 - inset / 2, w: inset, d: plan.d - inset },
    { x: plan.w - inset / 2, z: plan.d / 2 - inset / 2, w: inset, d: plan.d - inset },
  ];
  for (const p of ring) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.06, p.d), ceilMat);
    c.position.set(p.x, H + 0.03, p.z);
    add(c, ceilMat, false);
  }

  // Lighting
  const hemi = new THREE.HemisphereLight(0xffe8c8, 0x2a2438, opts.low ? 1.0 : 0.9);
  group.add(hemi);
  const amb = new THREE.AmbientLight(0xfff0e0, 0.28);
  group.add(amb);
  const sun = new THREE.DirectionalLight(0xffe2b8, opts.low ? 0.85 : 1.05);
  sun.position.set(plan.w * 0.2, H + 8, plan.d + 6);
  sun.target.position.set(plan.w / 2, 0, plan.d / 2);
  sun.castShadow = !opts.low;
  if (!opts.low) {
    const s = Math.max(plan.w, plan.d) * 0.7 + 2;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 40;
    sun.shadow.mapSize.set(opts.low ? 512 : 1024, opts.low ? 512 : 1024);
    sun.shadow.bias = -0.0008;
  }
  group.add(sun, sun.target);

  const prefer = ['foyer', 'living', 'dining', 'kitchen', 'hall'];
  const litRooms: HomeRoom[] = opts.low
    ? [...plan.rooms].sort((a, b) => (prefer.indexOf(a.id) < 0 ? 99 : prefer.indexOf(a.id)) - (prefer.indexOf(b.id) < 0 ? 99 : prefer.indexOf(b.id))).slice(0, 4)
    : plan.rooms;
  for (const r of litRooms) {
    const pl = new THREE.PointLight(0xffc888, opts.low ? 0.5 : 0.7, Math.max(8, Math.hypot(r.w, r.d) * 1.25), 2);
    pl.position.set(r.x + r.w / 2, H - 0.45, r.z + r.d / 2);
    pl.castShadow = false;
    group.add(pl);
  }

  const setColors = (wall: number, wallAccent: number, floor: number, floorAccent: number) => {
    wallMat.color.setHex(wall);
    trimMat.color.setHex(wallAccent || shift(wall, [-18, -18, -20]));
    for (const [id, mat] of floorMats) mat.color.setHex(shift(floor, roomTint[id]));
    void floorAccent;
  };

  const dispose = () => {
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });
  };

  return { group, setColors, dispose };
}

/** Original one-room 12×10 box, used for before/after interior screenshots. */
export function buildLegacyShell(wall = 0xe8e2d6, floor = 0xb08a5a): HomeShell {
  const plan = homePlan('house');
  // keep the function's signature compatible; this is the pre-rework look, not the house plan
  void plan;
  const group = new THREE.Group();
  const floorMat = new THREE.MeshStandardMaterial({ color: floor, roughness: 0.8 });
  const wallMat = new THREE.MeshStandardMaterial({ color: wall, roughness: 0.9, side: THREE.DoubleSide });
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(12, 10), floorMat);
  fl.rotation.x = -Math.PI / 2; fl.position.set(6, 0, 5); fl.receiveShadow = true; group.add(fl);
  const wb = new THREE.Mesh(new THREE.PlaneGeometry(12, 3.2), wallMat); wb.position.set(6, 1.6, 0); group.add(wb);
  const wl = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.2), wallMat); wl.rotation.y = Math.PI / 2; wl.position.set(0, 1.6, 5); group.add(wl);
  const wr = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.2), wallMat); wr.rotation.y = -Math.PI / 2; wr.position.set(12, 1.6, 5); group.add(wr);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({ color: 0x9fd4ff, emissive: 0x4a7aa0, emissiveIntensity: 0.6 }));
  win.position.set(6, 1.8, 0.02); group.add(win);
  group.add(new THREE.HemisphereLight(0xfff4e0, 0x404050, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(4, 12, 9); sun.castShadow = true; group.add(sun);
  return {
    group,
    setColors: (w, _wa, f) => { wallMat.color.setHex(w); floorMat.color.setHex(f); },
    dispose: () => { group.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); }); },
  };
}

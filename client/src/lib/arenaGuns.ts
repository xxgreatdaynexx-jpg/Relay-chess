/**
 * Low-poly weapon models for the 3D Arena (first-person viewmodel and third-person held guns).
 * Original geometry built from three.js primitives; every part is merged into one mesh per material
 * so a whole gun costs a handful of draw calls. Model space: metres, +Y up, barrel points down -Z,
 * origin at the top of the pistol grip (where the firing hand sits).
 */
import * as THREE from 'three';
import { WEAPON_ORDER, type WeaponId } from '../../../shared/fps';

export type GunMat = 'metal' | 'steel' | 'polymer' | 'wood' | 'furniture' | 'olive' | 'glass' | 'blade' | 'handle';
const MAT_COLORS: Record<GunMat, { color: number; shininess: number; specular: number }> = {
  metal: { color: 0x3c3f44, shininess: 60, specular: 0x5a5e66 }, // blued/parkerised steel
  steel: { color: 0x7d8086, shininess: 90, specular: 0x9aa0a8 }, // bare bolt / slide wear
  polymer: { color: 0x232427, shininess: 12, specular: 0x222428 }, // black plastic furniture
  wood: { color: 0x7a4a24, shininess: 25, specular: 0x3a2a1a }, // oiled walnut
  furniture: { color: 0x3e4a32, shininess: 15, specular: 0x262a22 }, // olive-drab sniper stock
  olive: { color: 0x55603a, shininess: 20, specular: 0x2a2e22 }, // RPG warhead paint
  glass: { color: 0x1d3a4a, shininess: 120, specular: 0xbfe4ff }, // optic lenses
  blade: { color: 0xa9adb3, shininess: 110, specular: 0xd8dde4 }, // knife blade (own slot for skins)
  handle: { color: 0x2b2a26, shininess: 10, specular: 0x1e1e1c }, // knife grip (own slot for skins)
};

let shared: Record<GunMat, THREE.MeshPhongMaterial> | null = null;
/** One shared material per finish, reused by every gun in the scene. */
export function gunMaterials(): Record<GunMat, THREE.MeshPhongMaterial> {
  if (!shared) {
    shared = {} as Record<GunMat, THREE.MeshPhongMaterial>;
    for (const k of Object.keys(MAT_COLORS) as GunMat[]) {
      const c = MAT_COLORS[k];
      shared[k] = new THREE.MeshPhongMaterial({ color: c.color, shininess: c.shininess, specular: c.specular, flatShading: true });
    }
  }
  return shared;
}

interface Part { geo: THREE.BufferGeometry; mat: GunMat; mag?: boolean }

class Builder {
  parts: Part[] = [];
  private push(geo: THREE.BufferGeometry, mat: GunMat, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], mag = false) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m);
    this.parts.push({ geo, mat, mag });
  }
  /** Box: w (x) × h (y) × l (z). */
  box(w: number, h: number, l: number, mat: GunMat, pos: [number, number, number], rot?: [number, number, number], mag = false) {
    this.push(new THREE.BoxGeometry(w, h, l), mat, pos, rot, mag);
  }
  /** Cylinder lying along Z. */
  tube(r: number, l: number, mat: GunMat, pos: [number, number, number], seg = 8, r2 = r, mag = false) {
    const g = new THREE.CylinderGeometry(r2, r, l, seg, 1);
    g.rotateX(-Math.PI / 2); // +Y axis → -Z; radiusTop (r2) ends up at the front
    this.push(g, mat, pos, undefined, mag);
  }
  /** Side-profile extrusion: shape drawn in (z, y) with z forward-negative, extruded along x (centred). */
  profile(pts: Array<[number, number]>, depth: number, mat: GunMat, pos: [number, number, number] = [0, 0, 0], mag = false) {
    const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 2 });
    // shape x → model z, shape y → model y, extrusion z → model x
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, depth / 2, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
    this.push(g, mat, pos, undefined, mag);
  }
}

export interface GunSpec {
  id: WeaponId;
  /** Muzzle tip in model space (for the flash). */
  muzzle: [number, number, number];
  /** Where the support hand grips (model space). */
  support: [number, number, number];
  /** Viewmodel offset from the camera (camera space, metres). */
  view: [number, number, number];
  /** Muzzle flash size (metres). */
  flash: number;
}

const BUILD: Record<WeaponId, (b: Builder) => Omit<GunSpec, 'id'>> = {
  // Fixed-blade combat knife: clip-point blade, crossguard, ribbed grip, pommel. Slots: blade / metal (guard, pommel) / handle.
  knife: (b) => {
    b.profile([[-0.012, 0.012], [-0.15, 0.012], [-0.19, 0.0], [-0.165, -0.008], [-0.012, -0.014]], 0.004, 'blade', [0, 0.005, 0]); // blade
    b.box(0.0045, 0.004, 0.13, 'metal', [0, 0.017, -0.075]); // spine
    b.box(0.022, 0.034, 0.008, 'metal', [0, 0.0, -0.008]); // crossguard
    b.box(0.022, 0.026, 0.1, 'handle', [0, -0.002, 0.045]); // grip
    for (let i = 0; i < 4; i++) b.box(0.024, 0.028, 0.006, 'handle', [0, -0.002, 0.012 + i * 0.022]); // grip ribs
    b.box(0.024, 0.03, 0.012, 'metal', [0, -0.002, 0.1]); // pommel
    return { muzzle: [0, 0.005, -0.19], support: [0, -0.002, 0.045], view: [0.13, -0.14, -0.3], flash: 0 };
  },
  // Full-size 9mm service pistol: two-tone slide, exposed barrel, wrap grip.
  pistol: (b) => {
    b.box(0.03, 0.034, 0.205, 'metal', [0, 0.05, -0.07]); // slide
    b.box(0.031, 0.012, 0.07, 'steel', [0, 0.05, -0.148]); // slide nose cut-out wear
    b.box(0.034, 0.006, 0.03, 'steel', [0, 0.06, 0.01], [0, 0, 0]); // serrations block
    b.tube(0.007, 0.02, 'steel', [0, 0.05, -0.18], 8); // barrel crown
    b.box(0.028, 0.026, 0.15, 'metal', [0, 0.022, -0.05]); // frame / dust cover
    b.box(0.006, 0.01, 0.008, 'metal', [0, 0.072, -0.165]); // front sight
    b.box(0.022, 0.01, 0.008, 'metal', [0, 0.072, 0.01]); // rear sight
    b.box(0.02, 0.012, 0.01, 'steel', [0, 0.06, 0.035]); // hammer
    b.profile([[-0.005, 0.012], [-0.055, 0.012], [-0.05, -0.022], [-0.008, -0.022]], 0.006, 'metal', [0, 0, 0]); // trigger guard (solid web)
    b.box(0.004, 0.022, 0.006, 'steel', [0, -0.002, -0.028], [-0.3, 0, 0]); // trigger
    b.profile([[0.002, 0.012], [-0.03, 0.012], [-0.012, -0.11], [0.03, -0.11], [0.03, 0.0]], 0.032, 'polymer'); // grip
    b.box(0.03, 0.012, 0.044, 'metal', [0, -0.114, 0.012], [-0.17, 0, 0], true); // magazine base
    return { muzzle: [0, 0.05, -0.19], support: [0, -0.05, 0.0], view: [0.12, -0.13, -0.36], flash: 0.09 };
  },
  // Roller-delayed 9mm SMG: tubular receiver, slim handguard, curved mag, collapsible stock.
  smg: (b) => {
    b.tube(0.026, 0.3, 'metal', [0, 0.05, -0.06], 10); // receiver tube
    b.box(0.03, 0.03, 0.22, 'metal', [0, 0.03, -0.04]); // lower receiver
    b.profile([[-0.13, 0.04], [-0.3, 0.04], [-0.3, 0.005], [-0.14, 0.0]], 0.05, 'polymer'); // handguard
    b.tube(0.009, 0.08, 'metal', [0, 0.055, -0.33], 8); // barrel
    b.tube(0.014, 0.025, 'metal', [0, 0.055, -0.375], 8); // muzzle nut
    b.tube(0.018, 0.02, 'metal', [0, 0.095, -0.3], 8, 0.018); // front sight hood
    b.box(0.006, 0.03, 0.01, 'metal', [0, 0.08, -0.3]);
    b.box(0.03, 0.03, 0.02, 'metal', [0, 0.09, 0.06]); // rear drum sight
    b.box(0.012, 0.008, 0.05, 'steel', [-0.025, 0.08, -0.17]); // cocking handle tube
    // curved 30-round mag, angled forward
    for (let i = 0; i < 4; i++) b.box(0.022, 0.05, 0.032, 'metal', [0, -0.002 - i * 0.045, -0.105 - i * 0.012], [0.12 + i * 0.07, 0, 0], true);
    b.profile([[0.0, 0.016], [-0.03, 0.016], [-0.015, -0.1], [0.03, -0.1], [0.03, 0.0]], 0.032, 'polymer'); // pistol grip
    b.profile([[-0.005, 0.016], [-0.06, 0.016], [-0.055, -0.02], [-0.01, -0.02]], 0.006, 'polymer'); // trigger group
    // retractable stock: twin rods + butt plate
    b.box(0.006, 0.006, 0.18, 'steel', [0.018, 0.05, 0.17]);
    b.box(0.006, 0.006, 0.18, 'steel', [-0.018, 0.05, 0.17]);
    b.box(0.045, 0.1, 0.02, 'polymer', [0, 0.025, 0.26]);
    return { muzzle: [0, 0.055, -0.39], support: [0, 0.0, -0.22], view: [0.15, -0.16, -0.42], flash: 0.13 };
  },
  // Semi-auto combat shotgun: long barrel over a tube magazine, wooden forend & stock.
  shotgun: (b) => {
    b.box(0.04, 0.06, 0.24, 'metal', [0, 0.04, -0.05]); // receiver
    b.box(0.01, 0.02, 0.05, 'steel', [0.02, 0.045, -0.06]); // ejection port / bolt
    b.tube(0.013, 0.5, 'metal', [0, 0.06, -0.42], 10); // barrel
    b.tube(0.015, 0.42, 'metal', [0, 0.025, -0.36], 10); // magazine tube
    b.box(0.02, 0.045, 0.02, 'metal', [0, 0.045, -0.6]); // barrel clamp
    b.tube(0.016, 0.018, 'metal', [0, 0.025, -0.575], 8); // mag cap
    b.box(0.006, 0.015, 0.012, 'steel', [0, 0.08, -0.66]); // bead sight
    b.box(0.03, 0.016, 0.03, 'metal', [0, 0.078, 0.03]); // ghost-ring rear
    b.profile([[-0.2, 0.05], [-0.42, 0.05], [-0.42, 0.0], [-0.21, -0.005]], 0.05, 'wood'); // forend
    b.profile([[-0.005, 0.012], [-0.06, 0.012], [-0.055, -0.02], [-0.01, -0.02]], 0.007, 'metal'); // trigger guard
    // pistol-grip wooden stock in one piece
    b.profile([[0.07, 0.07], [0.04, 0.0], [0.0, 0.012], [0.03, -0.09], [0.075, -0.09], [0.08, -0.02], [0.36, -0.06], [0.37, 0.07], [0.12, 0.075]], 0.044, 'wood');
    b.box(0.046, 0.14, 0.02, 'polymer', [0, 0.005, 0.375]); // recoil pad
    b.box(0.03, 0.03, 0.03, 'metal', [0, 0.0, -0.13], undefined, true); // loading gate (animates)
    return { muzzle: [0, 0.06, -0.68], support: [0, 0.0, -0.31], view: [0.15, -0.17, -0.44], flash: 0.18 };
  },
  // Bolt-action .50: long fluted barrel with brake, big scope, olive thumbhole stock, box mag.
  sniper: (b) => {
    b.tube(0.022, 0.26, 'metal', [0, 0.05, -0.04], 10); // receiver
    b.tube(0.014, 0.6, 'metal', [0, 0.05, -0.47], 10, 0.011); // tapered barrel
    b.box(0.04, 0.03, 0.06, 'metal', [0, 0.05, -0.8]); // muzzle brake
    b.box(0.046, 0.012, 0.02, 'metal', [0, 0.05, -0.8]);
    b.tube(0.008, 0.045, 'steel', [0.035, 0.045, 0.06], 6); // bolt handle
    b.box(0.022, 0.022, 0.022, 'steel', [0.06, 0.045, 0.06]); // bolt knob
    // scope: tube, bells, turrets, mounts, lenses
    b.tube(0.017, 0.3, 'metal', [0, 0.115, -0.04], 12);
    b.tube(0.017, 0.07, 'metal', [0, 0.115, -0.2], 12, 0.028); // objective bell
    b.tube(0.022, 0.06, 'metal', [0, 0.115, 0.12], 12, 0.017); // eyepiece
    b.tube(0.026, 0.004, 'glass', [0, 0.115, -0.236], 12);
    b.box(0.02, 0.03, 0.02, 'metal', [0, 0.14, -0.04]); // elevation turret
    b.box(0.03, 0.02, 0.02, 'metal', [0.022, 0.115, -0.04]); // windage turret
    b.box(0.022, 0.05, 0.02, 'metal', [0, 0.082, -0.12]); b.box(0.022, 0.05, 0.02, 'metal', [0, 0.082, 0.04]); // rings
    // olive stock: forend, grip, thumbhole butt
    b.profile([[-0.12, 0.04], [-0.44, 0.035], [-0.44, 0.005], [-0.12, -0.03]], 0.06, 'furniture'); // forend
    b.profile([[-0.12, 0.04], [0.08, 0.04], [0.06, -0.01], [0.04, -0.1], [0.0, -0.1], [-0.02, -0.01], [-0.12, -0.03]], 0.055, 'furniture'); // action/grip
    b.profile([[0.08, 0.04], [0.42, 0.06], [0.43, -0.09], [0.32, -0.09], [0.12, -0.03], [0.06, -0.01]], 0.05, 'furniture'); // butt
    b.box(0.052, 0.17, 0.02, 'polymer', [0, -0.012, 0.435]); // pad
    b.box(0.03, 0.03, 0.1, 'polymer', [0, 0.075, 0.3]); // cheek riser
    b.box(0.032, 0.07, 0.07, 'metal', [0, -0.04, -0.06], undefined, true); // box mag
    b.box(0.03, 0.02, 0.12, 'metal', [0, -0.005, -0.44], [0.25, 0, 0]); // folded bipod
    return { muzzle: [0, 0.05, -0.84], support: [0, -0.01, -0.3], view: [0.16, -0.18, -0.48], flash: 0.22 };
  },
  // RPG-style launcher: steel tube, wooden heat shields, two grips, optic, olive warhead.
  rocket: (b) => {
    b.tube(0.04, 0.95, 'metal', [0, 0.06, -0.12], 10); // tube
    b.tube(0.055, 0.12, 'metal', [0, 0.06, 0.42], 10, 0.04); // flared exhaust venturi (rear)
    b.tube(0.05, 0.26, 'wood', [0, 0.06, -0.05], 10); // heat shield
    b.profile([[0.0, 0.03], [-0.03, 0.03], [-0.015, -0.1], [0.03, -0.1], [0.03, 0.0]], 0.032, 'wood'); // rear grip
    b.profile([[-0.22, 0.03], [-0.25, 0.03], [-0.24, -0.08], [-0.2, -0.08]], 0.03, 'wood'); // front grip
    b.box(0.03, 0.06, 0.06, 'metal', [-0.055, 0.12, -0.13]); // optic body
    b.tube(0.014, 0.12, 'metal', [-0.055, 0.15, -0.13], 8);
    b.tube(0.015, 0.004, 'glass', [-0.055, 0.15, -0.19], 8);
    b.box(0.006, 0.03, 0.006, 'metal', [0, 0.115, -0.55]); // iron sights
    b.box(0.02, 0.03, 0.006, 'metal', [0, 0.115, -0.1]);
    // warhead (animated on reload)
    b.tube(0.045, 0.16, 'olive', [0, 0.06, -0.67], 10, 0.045, true);
    b.tube(0.045, 0.14, 'olive', [0, 0.06, -0.82], 10, 0.012, true); // nose cone
    b.tube(0.008, 0.03, 'steel', [0, 0.06, -0.905], 6, 0.008, true); // fuze
    return { muzzle: [0, 0.06, -0.6], support: [0, -0.05, -0.23], view: [0.2, -0.16, -0.5], flash: 0.3 };
  },
};

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

export interface GunGeometry extends GunSpec {
  /** Body geometry per material. */
  body: Array<{ mat: GunMat; geo: THREE.BufferGeometry }>;
  /** Detachable part (magazine / warhead) per material, animated during reloads. */
  mag: Array<{ mat: GunMat; geo: THREE.BufferGeometry }>;
  triangles: number;
}

const cache = new Map<WeaponId, GunGeometry>();
/** Builds (once) the merged geometry for a weapon. */
export function gunGeometry(id: WeaponId): GunGeometry {
  const hit = cache.get(id);
  if (hit) return hit;
  const b = new Builder();
  const spec = BUILD[id](b);
  const group = (mag: boolean) => {
    const by = new Map<GunMat, THREE.BufferGeometry[]>();
    for (const p of b.parts) if (!!p.mag === mag) by.set(p.mat, [...(by.get(p.mat) ?? []), p.geo]);
    return [...by].map(([mat, gs]) => ({ mat, geo: merge(gs) }));
  };
  const body = group(false), mag = group(true);
  const triangles = [...body, ...mag].reduce((n, x) => n + x.geo.attributes.position.count / 3, 0);
  const out: GunGeometry = { id, ...spec, body, mag, triangles };
  cache.set(id, out);
  return out;
}

export interface GunModel { root: THREE.Group; mag: THREE.Group; spec: GunGeometry }
/** A ready-to-add gun: shares geometry and materials with every other instance of the same weapon. */
export function buildGun(id: WeaponId): GunModel {
  const spec = gunGeometry(id);
  const mats = gunMaterials();
  const root = new THREE.Group();
  root.name = `gun-${id}`;
  for (const p of spec.body) root.add(new THREE.Mesh(p.geo, mats[p.mat]));
  const mag = new THREE.Group();
  for (const p of spec.mag) mag.add(new THREE.Mesh(p.geo, mats[p.mat]));
  root.add(mag);
  return { root, mag, spec };
}

export const GUN_IDS: WeaponId[] = WEAPON_ORDER;
/** Triangle budget per gun so viewmodels never cost real frame time. */
export const GUN_TRI_BUDGET = 2000;

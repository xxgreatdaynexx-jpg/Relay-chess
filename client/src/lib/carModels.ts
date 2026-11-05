/**
 * Low-poly procedural car meshes, one builder per body style (shared/cars.ts). Forward is +x (like the city's
 * ambient cars). Geometry is shared (unit box / wheel cylinder); materials are cached per colour, so 30 cars cost
 * a handful of GPU resources. `lod: 'far'` drops wheels and details.
 */
import * as THREE from 'three';
import type { CarModel } from '../../../shared/cars';
import { PAINTS, RIMS, GLOWS, type CarMods } from '../../../shared/mechanic';
export type CarLook = Partial<Pick<CarMods, 'paint' | 'rims' | 'kit' | 'glow'>>;

const unit = new THREE.BoxGeometry(1, 1, 1);
const wheelG = new THREE.CylinderGeometry(1, 1, 1, 10); wheelG.rotateX(Math.PI / 2);
const mats = new Map<string, THREE.Material>();
const m = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}, tag = '') => {
  const k = `${color}:${tag}`; let x = mats.get(k);
  if (!x) { x = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35, ...o }); mats.set(k, x); }
  return x;
};
const GLASS = 0x1a2433, TYRE = 0x15161a, CHROME = 0xc9ced6;

export function buildCar(c: CarModel, color: number, lod: 'near' | 'far' = 'near', look: CarLook = {}): THREE.Group {
  const pnt = look.paint ? PAINTS.find((x) => x.id === look.paint) : undefined; if (pnt) color = pnt.color;
  const g = new THREE.Group(); const [L, W, H] = c.dims;
  const add = (mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z = 0, geo: THREE.BufferGeometry = unit) => {
    const o = new THREE.Mesh(geo, mat); o.scale.set(sx, sy, sz); o.position.set(x, y, z); g.add(o); return o; };
  const paint = pnt?.metallic ? m(color, { metalness: 0.95, roughness: 0.18 }, 'met') : m(color), glass = m(GLASS, { metalness: 0.6, roughness: 0.15 }, 'g'), tyre = m(TYRE, { roughness: 0.9, metalness: 0 }, 't');
  const head = m(0xfff2c0, { emissive: 0xfff2c0, emissiveIntensity: 1.2 }, 'h'), tail = m(0xff2020, { emissive: 0xff2020, emissiveIntensity: 0.9 }, 'tl');
  let wheelR = H * 0.32, clear = wheelR; const st = c.style;
  if (st === 'monster') { wheelR = H * 0.55; clear = wheelR * 1.5; }
  if (st === 'cart') { wheelR = 0.12; clear = 0.15; }
  const body = (len: number, hgt: number, x = 0) => add(paint, len, hgt, W, x, clear + hgt / 2);
  const cabin = (len: number, hgt: number, x: number, w = W * 0.86) => { add(glass, len, hgt, w, x, clear + H * 0.5 + hgt / 2); add(paint, len * 0.92, 0.06, w + 0.02, x, clear + H * 0.5 + hgt); };
  switch (st) {
    case 'cart': { // QA#5: reads as a real shopping cart: wire basket (rim + bars), lower rack, chassis rails, handle on struts.
      const wire = m(color, { metalness: 0.9, roughness: 0.3 }), red = m(0xff3b3b, {}, 'r'), t = 0.025;
      const bL = L * 0.78, b0 = clear + 0.34, bH = H * 0.5, bx = L * 0.05, yT = b0 + bH, yM = b0 + bH / 2;
      add(wire, bL, t, W, bx, b0); // basket floor
      for (const z of [-W / 2, W / 2]) { add(wire, bL, t * 1.6, t * 1.6, bx, yT, z); add(wire, bL, t, t, bx, yM, z); for (let k = 0; k <= 10; k++) add(wire, t, bH, t, bx - bL / 2 + (bL * k) / 10, yM, z); }
      for (const x of [bx - bL / 2, bx + bL / 2]) { add(wire, t * 1.6, t * 1.6, W, x, yT); add(wire, t, t, W, x, yM); for (let k = 1; k < 6; k++) add(wire, t, bH, t, x, yM, -W / 2 + (W * k) / 6); }
      for (const z of [-W * 0.38, W * 0.38]) { add(wire, L * 0.86, 0.035, 0.035, 0, clear + 0.03, z); add(wire, 0.035, b0 - clear, 0.035, bx + bL / 2 - 0.02, (clear + b0) / 2, z); add(wire, 0.035, b0 - clear, 0.035, bx - bL / 2 + 0.02, (clear + b0) / 2, z); }
      add(wire, L * 0.7, t, W * 0.76, 0, clear + 0.1); // lower rack
      const hx = bx - bL / 2 - 0.14, hy = yT + 0.12; for (const z of [-W / 2, W / 2]) add(wire, 0.17, 0.03, 0.03, (hx + bx - bL / 2) / 2, (hy + yT) / 2, z).rotation.z = -0.6; // handle struts
      add(red, 0.06, 0.06, W * 1.04, hx, hy).userData.part = 'cartHandle'; add(red, 0.12, bH * 0.6, W * 0.7, bx - bL / 2 + 0.07, yT - bH * 0.3); // grip + child-seat flap
      break; }
    case 'van': { body(L, H * 0.85); add(glass, L * 0.2, H * 0.3, W * 0.9, L * 0.38, clear + H * 0.6);
      const bun = m(0xd9a35a, {}, 'bun'), dog = m(0xb5532a, {}, 'dog');
      add(bun, L * 0.6, 0.18, W * 0.5, -L * 0.05, clear + H * 0.95); add(dog, L * 0.7, 0.16, W * 0.22, -L * 0.05, clear + H * 1.05); add(m(0xffe066, { emissive: 0xffd000, emissiveIntensity: 0.4 }, 'mus'), L * 0.6, 0.03, 0.05, -L * 0.05, clear + H * 1.14); break; }
    case 'hatch': case 'wagon': case 'sedan': case 'taxi': {
      // Beaters keep the shared hatch/wagon builders. Sedans split by carId so Commuter / Exec / Cab read as distinct silhouettes.
      if (st === 'hatch') {
        if (c.id === 'rustbucket') {
          // Sagging beater: lower rear, rust patches, mismatched door, dented bumper.
          body(L, H * 0.48, -L * 0.02);
          cabin(L * 0.55, H * 0.4, -L * 0.12, W * 0.84);
          add(m(0x6b3a22, { roughness: 0.95, metalness: 0.05 }, 'rust'), L * 0.28, H * 0.35, 0.04, L * 0.05, clear + H * 0.28, W / 2 + 0.01); // mismatched door
          add(m(0x8a5a3a, { roughness: 0.95 }, 'rust'), L * 0.2, H * 0.2, 0.03, -L * 0.2, clear + H * 0.35, -W / 2 - 0.01);
          add(m(0x5a4030, { roughness: 0.9 }, 'rust'), 0.14, H * 0.12, W * 0.5, L / 2 + 0.03, clear + H * 0.08); // dented bumper patch
          // Sag: rear deck lower than front
          add(paint, L * 0.18, 0.04, W * 0.86, -L * 0.32, clear + H * 0.42);
        } else {
          // Pizza Hatch (and any other hatch): tidy short hatch + roof sign for pizza.
          body(L, H * 0.5);
          cabin(L * 0.55, H * 0.42, -L * 0.1);
          if (c.id === 'pizza') add(m(0xff3b3b, { emissive: 0xff3b3b, emissiveIntensity: 0.5 }, 'pz'), 0.5, 0.25, 0.08, -L * 0.1, clear + H * 1.05);
        }
      } else if (st === 'wagon') {
        body(L, H * 0.5);
        cabin(L * 0.68, H * 0.42, -L * 0.12);
        add(m(0x7a4b2a, {}, 'wood'), L * 0.75, H * 0.12, W + 0.02, -L * 0.05, clear + H * 0.25);
      } else if (c.id === 'commuter') {
        // Camry-like midsize: lower stance, balanced cabin slightly mid-car, soft belt, modest deck.
        body(L * 0.98, H * 0.46, L * 0.01);
        cabin(L * 0.52, H * 0.36, -L * 0.01, W * 0.82);
        add(m(CHROME, { metalness: 1, roughness: 0.25 }, 'belt'), L * 0.96, 0.022, W * 1.01, 0, clear + H * 0.46);
        add(paint, L * 0.22, 0.045, W * 0.88, -L * 0.35, clear + H * 0.46);
        add(m(0x0c0d10, { roughness: 0.45 }, 'grille'), 0.04, H * 0.09, W * 0.36, L / 2 + 0.04, clear + H * 0.2);
      } else if (c.id === 'exec') {
        // E-class-ish executive: long hood, cabin aft, upright greenhouse, chrome belt + twin grille bars.
        body(L, H * 0.5);
        cabin(L * 0.38, H * 0.48, -L * 0.18, W * 0.78);
        add(m(CHROME, { metalness: 1, roughness: 0.2 }, 'belt'), L * 0.98, 0.035, W * 1.02, -L * 0.02, clear + H * 0.5);
        add(paint, L * 0.28, 0.06, W * 0.9, -L * 0.3, clear + H * 0.5);
        // Long hood plane in front of cabin
        add(paint, L * 0.34, 0.04, W * 0.92, L * 0.22, clear + H * 0.5);
        add(m(CHROME, { metalness: 1, roughness: 0.2 }, 'grl'), 0.045, H * 0.05, W * 0.5, L / 2 + 0.05, clear + H * 0.3);
        add(m(CHROME, { metalness: 1, roughness: 0.2 }, 'grl'), 0.045, H * 0.05, W * 0.5, L / 2 + 0.05, clear + H * 0.22);
        add(m(CHROME, { metalness: 1, roughness: 0.2 }, 'trim'), L * 0.36, 0.03, 0.045, -L * 0.18, clear + H * 0.76, W * 0.4);
        add(m(CHROME, { metalness: 1, roughness: 0.2 }, 'trim'), L * 0.36, 0.03, 0.045, -L * 0.18, clear + H * 0.76, -W * 0.4);
      } else if (c.id === 'taxi' || st === 'taxi') {
        // Crown Vic-style cab: boxy upright greenhouse, taller body, roof light, dark chrome push bar.
        body(L * 1.02, H * 0.56, -L * 0.01);
        cabin(L * 0.58, H * 0.5, -L * 0.04, W * 0.92);
        add(m(0xffffff, { emissive: 0xffee88, emissiveIntensity: 0.6 }, 'tx'), 0.34, 0.18, 0.55, -L * 0.04, clear + H * 1.08);
        const bar = m(0xb0b6c0, { metalness: 0.95, roughness: 0.3 }, 'push');
        add(bar, 0.1, H * 0.16, W * 1.05, L / 2 + 0.1, clear + H * 0.14);
        for (const z of [W * 0.32, -W * 0.32, W * 0.1, -W * 0.1]) add(bar, 0.14, H * 0.22, 0.06, L / 2 + 0.16, clear + H * 0.2, z);
        add(m(0x111418, { roughness: 0.45 }, 'grille'), 0.05, H * 0.18, W * 0.55, L / 2 + 0.055, clear + H * 0.3);
        add(paint, L * 0.2, 0.06, W * 0.96, -L * 0.42, clear + H * 0.56);
      } else {
        body(L, H * 0.5);
        cabin(L * 0.48, H * 0.42, -L * 0.04);
      }
      break; }
    case 'coupe': case 'muscle': case 'super': {
      if (c.id === 'zipline') {
        // Miata/BRZ-like light coupe: short overhangs, low cabin, compact roundish stance.
        body(L * 0.94, H * 0.42, L * 0.02);
        cabin(L * 0.42, H * 0.34, -L * 0.02, W * 0.76);
        add(paint, L * 0.16, 0.04, W * 0.86, -L * 0.34, clear + H * 0.42); // short deck
        add(m(0x0c0d10, { roughness: 0.45 }, 'grille'), 0.035, H * 0.08, W * 0.32, L / 2 + 0.04, clear + H * 0.18);
        // thin roll-hoop behind cabin (Miata cue)
        for (const z of [W * 0.22, -W * 0.22]) add(m(0x2a2d33, { metalness: 0.7 }, 'hoop'), 0.05, H * 0.28, 0.05, -L * 0.22, clear + H * 0.55, z);
        add(m(0x2a2d33, { metalness: 0.7 }, 'hoop'), 0.05, 0.05, W * 0.48, -L * 0.22, clear + H * 0.7);
      } else if (c.id === 'neonfang') {
        // Supra/GT-R aggressive: long hood, pinched cabin, big wing, underglow.
        const low = 0.44; body(L, H * low);
        cabin(L * 0.34, H * 0.34, -L * 0.08, W * 0.74);
        add(paint, L * 0.3, 0.05, W * 0.9, L * 0.18, clear + H * low); // long hood plane
        add(m(0x111418, {}, 'wing'), 0.28, 0.06, W * 1.08, -L * 0.48, clear + H * low + 0.32);
        for (const z of [W * 0.38, -W * 0.38]) add(m(0x111418, {}, 'wing'), 0.07, 0.3, 0.07, -L * 0.46, clear + H * low + 0.14, z);
        add(m(color, { emissive: color, emissiveIntensity: 0.9 }, 'glow'), L * 0.85, 0.03, W * 0.95, 0, 0.05);
        add(m(0x0c0d10, { roughness: 0.4 }, 'grille'), 0.04, H * 0.1, W * 0.5, L / 2 + 0.04, clear + H * 0.2);
      } else if (c.id === 'aurelia') {
        // Long-hood luxury GT: cabin well aft, chrome/gold belt, formal proportions.
        body(L, H * 0.46);
        cabin(L * 0.36, H * 0.4, -L * 0.16, W * 0.78);
        add(paint, L * 0.36, 0.05, W * 0.92, L * 0.2, clear + H * 0.46); // long hood
        add(paint, L * 0.22, 0.05, W * 0.9, -L * 0.32, clear + H * 0.46);
        add(m(0xd4af37, { metalness: 1, roughness: 0.2 }, 'gold'), L * 1.002, 0.04, W * 1.002, 0, clear + H * 0.22);
        add(m(0xd4af37, { metalness: 1, roughness: 0.2 }, 'gold'), L * 0.34, 0.03, 0.04, -L * 0.16, clear + H * 0.68, W * 0.4);
        add(m(0xd4af37, { metalness: 1, roughness: 0.2 }, 'gold'), L * 0.34, 0.03, 0.04, -L * 0.16, clear + H * 0.68, -W * 0.4);
        add(m(CHROME, { metalness: 1, roughness: 0.2 }, 'grl'), 0.04, H * 0.05, W * 0.44, L / 2 + 0.045, clear + H * 0.26);
        for (const z of [W * 0.22, -W * 0.22]) add(m(CHROME, { metalness: 1, roughness: 0.25 }, 'exh'), 0.12, 0.05, 0.05, -L / 2 - 0.05, clear + 0.08, z);
      } else if (c.id === 'hypervolt') {
        // Smooth EV: low seamless cabin, closed front light-bar, no aggressive grille.
        body(L * 0.98, H * 0.38, 0);
        cabin(L * 0.4, H * 0.32, -L * 0.02, W * 0.82);
        add(m(0xe8f4ff, { emissive: 0x88ccee, emissiveIntensity: 0.8 }, 'bar'), 0.04, 0.06, W * 0.7, L / 2 + 0.04, clear + H * 0.22);
        add(paint, L * 0.2, 0.04, W * 0.88, -L * 0.36, clear + H * 0.38);
      } else if (c.id === 'phantom') {
        // Lambo-ish wedge: very low pointed nose, cabin aft, sharp rear.
        const low = 0.34; body(L, H * low);
        cabin(L * 0.32, H * 0.3, -L * 0.12, W * 0.72);
        add(paint, L * 0.38, 0.04, W * 0.7, L * 0.18, clear + H * low * 0.7); // pointed nose plane
        add(m(0x111418, {}, 'side'), L * 0.5, H * 0.12, 0.04, -L * 0.05, clear + H * 0.2, W / 2 + 0.02);
        add(m(0x111418, {}, 'side'), L * 0.5, H * 0.12, 0.04, -L * 0.05, clear + H * 0.2, -W / 2 - 0.02);
        add(m(0x111418, {}, 'wing'), 0.22, 0.04, W * 0.95, -L * 0.46, clear + H * low + 0.2);
        for (const z of [W * 0.3, -W * 0.3]) add(m(0x111418, {}, 'wing'), 0.05, 0.18, 0.05, -L * 0.44, clear + H * low + 0.1, z);
      } else if (c.id === 'chudmobile') {
        // Bugatti/Koenigsegg hyper: ultra-low, long tail, huge wing, diffuser, underglow.
        const low = 0.32; body(L * 1.02, H * low, -L * 0.02);
        cabin(L * 0.3, H * 0.28, -L * 0.06, W * 0.7);
        add(paint, L * 0.42, 0.035, W * 0.68, L * 0.2, clear + H * low * 0.65);
        add(m(0x111418, {}, 'wing'), 0.32, 0.06, W * 1.12, -L * 0.5, clear + H * low + 0.38);
        for (const z of [W * 0.4, -W * 0.4]) add(m(0x111418, {}, 'wing'), 0.08, 0.36, 0.08, -L * 0.48, clear + H * low + 0.18, z);
        add(m(0x1b1d22, {}, 'diff'), 0.2, 0.08, W * 0.9, -L / 2 - 0.02, clear + 0.06);
        for (const z of [-W * 0.25, -W * 0.1, W * 0.1, W * 0.25]) add(m(0x1b1d22, {}, 'diff'), 0.16, 0.1, 0.04, -L / 2 - 0.04, clear + 0.1, z);
        add(m(color, { emissive: color, emissiveIntensity: 0.9 }, 'glow'), L * 0.9, 0.03, W * 0.95, 0, 0.04);
      } else if (c.id === 'thunderhorse') {
        // Mustang-like fastback: long hood, sloping rear cabin into deck, stripes + scoop.
        const low = 0.48; body(L, H * low);
        cabin(L * 0.38, H * 0.36, -L * 0.08, W * 0.78);
        add(paint, L * 0.28, 0.045, W * 0.9, L * 0.2, clear + H * low); // long hood
        // Fastback slope: stepped rear roof into deck
        add(paint, L * 0.22, 0.08, W * 0.76, -L * 0.28, clear + H * low + H * 0.18);
        add(paint, L * 0.2, 0.04, W * 0.88, -L * 0.36, clear + H * low);
        add(m(0xffffff, {}, 'stripe'), L * 1.001, 0.02, W * 0.16, 0, clear + H * low + 0.01);
        add(m(0x2f2f33, {}, 'scoop'), L * 0.18, 0.12, W * 0.28, L * 0.28, clear + H * low + 0.06);
      } else if (c.id === 'blacktop') {
        // Charger-like 4-door widebody: longer greenhouse, wide flares, tall scoop.
        const low = 0.5; body(L, H * low);
        cabin(L * 0.5, H * 0.4, -L * 0.06, W * 0.84); // longer 4-door cabin
        add(paint, L * 0.24, 0.05, W * 0.92, L * 0.22, clear + H * low);
        add(paint, L * 0.18, 0.05, W * 0.9, -L * 0.38, clear + H * low);
        add(m(0x2f2f33, {}, 'scoop'), L * 0.2, 0.16, W * 0.32, L * 0.22, clear + H * low + 0.08);
        // Widebody flares over wheels
        for (const sx of [L * 0.3, -L * 0.3]) for (const z of [W / 2 + 0.05, -W / 2 - 0.05]) add(paint, wheelR * 2.2, 0.12, 0.1, sx, clear + wheelR * 0.9, z);
        add(m(0xb5171e, {}, 'stripe'), L * 1.001, 0.015, W * 0.12, 0, clear + H * low + 0.01);
      } else {
        const low = st === 'super' ? 0.4 : 0.48; body(L, H * low);
        cabin(L * (st === 'super' ? 0.36 : 0.4), H * (st === 'super' ? 0.36 : 0.38), -L * (st === 'muscle' ? 0.1 : 0.04), W * 0.8);
        if (st === 'muscle') { add(m(0xffffff, {}, 'stripe'), L * 1.001, 0.02, W * 0.18, 0, clear + H * low + 0.01); add(m(0x2f2f33, {}, 'scoop'), L * 0.18, 0.12, W * 0.3, L * 0.25, clear + H * low + 0.06); }
        if (st === 'super') { add(m(0x111418, {}, 'wing'), 0.25, 0.05, W * 1.02, -L * 0.47, clear + H * low + 0.28); add(m(0x111418, {}, 'wing'), 0.06, 0.25, 0.06, -L * 0.45, clear + H * low + 0.12, W * 0.35); add(m(0x111418, {}, 'wing'), 0.06, 0.25, 0.06, -L * 0.45, clear + H * low + 0.12, -W * 0.35); }
      }
      break; }
    case 'suv': {
      body(L, H * 0.55); cabin(L * 0.72, H * 0.4, -L * 0.08);
      add(m(0x2f2f33, {}, 'rack'), L * 0.5, 0.05, W * 0.8, -L * 0.1, clear + H * 0.98);
      // Trailblazer: taller crosshatch grille + light bar brow
      add(m(0x0c0d10, { roughness: 0.4 }, 'grille'), 0.05, H * 0.22, W * 0.55, L / 2 + 0.045, clear + H * 0.28);
      for (const zy of [0.08, 0, -0.08]) add(m(0x2a2d33, {}, 'grille'), 0.02, 0.02, W * 0.5, L / 2 + 0.06, clear + H * 0.28 + zy);
      add(m(CHROME, { metalness: 1, roughness: 0.25 }, 'brow'), 0.04, 0.04, W * 0.7, L / 2 + 0.04, clear + H * 0.42);
      break; }
    case 'pickup': {
      body(L, H * 0.5); cabin(L * 0.32, H * 0.44, L * 0.1, W * 0.88);
      add(m(0x2f2f33, {}, 'bed'), L * 0.42, 0.05, W * 0.86, -L * 0.28, clear + H * 0.5 + 0.03);
      add(m(0x1b1d22, {}, 'rail'), L * 0.4, 0.12, 0.04, -L * 0.28, clear + H * 0.56, W * 0.42);
      add(m(0x1b1d22, {}, 'rail'), L * 0.4, 0.12, 0.04, -L * 0.28, clear + H * 0.56, -W * 0.42);
      // Hauler: big truck grille + chrome bumper bar
      add(m(0x0c0d10, { roughness: 0.35 }, 'grille'), 0.06, H * 0.24, W * 0.62, L / 2 + 0.05, clear + H * 0.28);
      for (const z of [-0.2, -0.1, 0, 0.1, 0.2]) add(m(0x2a2d33, {}, 'grille'), 0.03, H * 0.22, 0.03, L / 2 + 0.07, clear + H * 0.28, W * z);
      add(m(CHROME, { metalness: 1, roughness: 0.25 }, 'bumper'), 0.1, H * 0.12, W * 1.05, L / 2 + 0.1, clear + H * 0.1);
      break; }
    case 'monster': body(L * 0.9, H * 0.4); cabin(L * 0.35, H * 0.3, 0, W * 0.6); add(m(0x2f2f33, {}, 'ch'), L * 0.6, 0.15, W * 0.4, 0, clear - 0.15); break;
    case 'limo': {
      body(L, H * 0.48); cabin(L * 0.78, H * 0.36, -L * 0.04);
      add(m(CHROME, { metalness: 1, roughness: 0.2 }, 'ch'), L * 1.002, 0.03, W * 1.002, 0, clear + H * 0.3);
      // Distinct B-pillars along the stretch greenhouse
      for (const x of [-L * 0.28, -L * 0.08, L * 0.12]) {
        for (const z of [W * 0.42, -W * 0.42]) add(m(0x111418, {}, 'pillar'), 0.06, H * 0.34, 0.05, x, clear + H * 0.5 + H * 0.18, z);
      }
      break; }
  }
  if (st !== 'cart') {
    const bl = st === 'monster' ? clear + H * 0.2 : clear + H * 0.3;
    add(head, 0.04, 0.1, 0.18, L / 2 + 0.01, bl, W * 0.32); add(head, 0.04, 0.1, 0.18, L / 2 + 0.01, bl, -W * 0.32);
    add(tail, 0.04, 0.08, 0.2, -L / 2 - 0.01, bl, W * 0.32); add(tail, 0.04, 0.08, 0.2, -L / 2 - 0.01, bl, -W * 0.32);
  }
  if (lod === 'near' || st === 'monster') {
    // Per-style wheel cues: limo thin chrome, muscle deep dish, super low-profile multi-spoke, truck thicker.
    let ww = st === 'monster' ? 0.45 : st === 'cart' ? 0.04 : st === 'pickup' || st === 'suv' ? 0.26 : st === 'limo' ? 0.14 : st === 'super' ? 0.18 : 0.2;
    const wx = L * (st === 'limo' ? 0.4 : st === 'pickup' ? 0.34 : 0.32);
    const rim = RIMS.find((x) => x.id === look.rims && 'color' in x) as { color: number } | undefined;
    const rimM = rim ? m(rim.color, { metalness: 0.9, roughness: 0.2, ...(look.rims === 'neon' ? { emissive: rim.color, emissiveIntensity: 0.8 } : {}) }, 'rim') : null;
    const hub = rimM ?? m(st === 'limo' ? CHROME : 0x9aa1ab, { metalness: 0.8, roughness: 0.35 }, 'hub'); const spoke = m(0x2a2d33, { roughness: 0.6 }, 'spk');
    const hubScale = st === 'muscle' ? 0.72 : st === 'super' ? 0.55 : st === 'limo' ? 0.7 : 0.62;
    const spokeN = st === 'super' ? 3 : st === 'limo' ? 1 : 2;
    for (const sx of [wx, -wx]) for (const sz of [W / 2, -W / 2]) {
      // Each wheel is its own pivot (userData.wheel 'f'/'r') so the driving loop can steer the fronts and spin all four.
      const piv = new THREE.Group(); piv.position.set(sx, wheelR, sz); piv.userData.wheel = sx > 0 ? 'f' : 'r'; g.add(piv);
      const wr = st === 'super' ? wheelR * 0.92 : st === 'pickup' || st === 'suv' ? wheelR * 1.08 : wheelR;
      const t = new THREE.Mesh(wheelG, tyre); t.scale.set(wr, wr, ww); piv.add(t);
      if (st !== 'cart') { const h = new THREE.Mesh(wheelG, hub); h.scale.set(wr * hubScale, wr * hubScale, ww + 0.03); piv.add(h);
        if (lod === 'near') for (let k = 0; k < spokeN; k++) { const sp = new THREE.Mesh(unit, spoke); sp.scale.set(wr * 1.15, wr * (st === 'limo' ? 0.08 : 0.12), ww + 0.05); sp.rotation.z = (k * Math.PI) / spokeN; piv.add(sp); } }
    }
  }
  // Racing overhaul detailing (near LOD): bumpers, grille, side skirts, mirrors, exhaust tips, number-plate.
  if (lod === 'near' && st !== 'cart' && st !== 'monster') {
    const dark = m(0x1b1d22, { roughness: 0.7, metalness: 0.2 }, 'bmp'), chrome = m(CHROME, { metalness: 1, roughness: 0.2 }, 'chr');
    add(dark, 0.1, H * 0.16, W * 0.98, L / 2 + 0.02, clear + H * 0.1); add(dark, 0.1, H * 0.16, W * 0.98, -L / 2 - 0.02, clear + H * 0.1);
    add(m(0x0c0d10, { roughness: 0.4 }, 'grl'), 0.03, H * 0.12, W * 0.42, L / 2 + 0.035, clear + H * 0.24);
    for (const z of [W / 2 + 0.015, -W / 2 - 0.015]) { add(dark, L * 0.55, H * 0.07, 0.03, 0, clear + H * 0.06, z); add(paint, 0.08, 0.06, 0.1, L * 0.12, clear + H * 0.55, z + Math.sign(z) * 0.05); }
    add(chrome, 0.14, 0.06, 0.06, -L / 2 - 0.04, clear + 0.06, -W * 0.28); if (st === 'muscle' || st === 'super') add(chrome, 0.14, 0.06, 0.06, -L / 2 - 0.04, clear + 0.06, W * 0.28);
    add(m(0xf4f1e6, { roughness: 0.6 }, 'plate'), 0.02, 0.07, 0.24, -L / 2 - 0.075, clear + H * 0.12);
  }
  // Mechanic Shop body kits (rear of the car is -x) and underglow.
  if (st !== 'cart' && look.kit && look.kit !== 'none') {
    const trim = m(0x15171c, { roughness: 0.5 }, 'kit'); const deck = clear + H * 0.5;
    if (look.kit === 'lip' || look.kit === 'widebody') { add(trim, 0.12, 0.06, W * 1.02, L / 2 + 0.03, clear + 0.02); add(trim, L * 0.6, 0.07, 0.06, 0, clear + 0.03, W / 2 + 0.02); add(trim, L * 0.6, 0.07, 0.06, 0, clear + 0.03, -W / 2 - 0.02); }
    if (look.kit === 'ducktail') add(paint, 0.22, 0.08, W * 0.95, -L / 2 + 0.1, deck + 0.05);
    if (look.kit === 'wing' || look.kit === 'widebody') { add(trim, 0.3, 0.05, W * 1.05, -L * 0.46, deck + 0.34); for (const z of [W * 0.33, -W * 0.33]) add(trim, 0.06, 0.32, 0.05, -L * 0.44, deck + 0.17, z); }
    if (look.kit === 'widebody') for (const sx of [L * 0.32, -L * 0.32]) for (const z of [W / 2 + 0.06, -W / 2 - 0.06]) add(paint, wheelR * 2.3, 0.1, 0.12, sx, clear + wheelR * 0.95, z);
  }
  const glow = GLOWS.find((x) => x.id === look.glow && 'color' in x) as { color: number } | undefined;
  if (glow) add(m(glow.color, { emissive: glow.color, emissiveIntensity: 1.6, transparent: true, opacity: 0.85 }, 'uglow'), L * 0.9, 0.02, W * 1.0, 0, 0.04);
  return g;
}

/** Dispose shared resources (never needed in-app; kept for tests/HMR). */
export function disposeCarResources() { mats.forEach((x) => x.dispose()); mats.clear(); }

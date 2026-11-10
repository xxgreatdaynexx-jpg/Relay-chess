/** Low-poly furniture models for home interiors and the Furniture Store preview (Millionaire Update, pt1459u).
 *  Units are tiles (1 tile = 1 unit). Each model sits on y = 0, centred on its rotation-0 footprint (w × d). */
import * as THREE from 'three';
import type { Furniture } from '../../../shared/homes';

const mats = new Map<string, THREE.Material>();
const M = (color: number, extra: { emissive?: number; metal?: number; opacity?: number } = {}) => {
  const k = `${color}:${extra.emissive ?? ''}:${extra.metal ?? ''}:${extra.opacity ?? ''}`; let m = mats.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: extra.metal ?? 0.05, emissive: extra.emissive ?? 0, emissiveIntensity: extra.emissive ? 0.8 : 0, transparent: extra.opacity != null, opacity: extra.opacity ?? 1 }); mats.set(k, m); }
  return m;
};
const B = (g: THREE.Group, w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y + h / 2, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
const C = (g: THREE.Group, rt: number, rb: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 12) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.position.set(x, y + h / 2, z); o.castShadow = true; g.add(o); return o; };
const S = (g: THREE.Group, r: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };

export function buildFurniture(f: Furniture): THREE.Group {
  const g = new THREE.Group(); const w = f.w * 0.92, d = f.d * 0.92, h = Math.max(0.02, f.h); const c = M(f.color), a = M(f.accent), dark = M(0x2a2420);
  const legs = (top: number, inset = 0.08) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(g, 0.07, top, 0.07, dark, sx * (w / 2 - inset), 0, sz * (d / 2 - inset)); };
  switch (f.shape) {
    case 'chair': case 'stool': { for (const sx of [-1, 1]) for (const sz of [-1, 1]) C(g, 0.03, 0.045, h * 0.45, dark, sx * (w * 0.36), 0, sz * (d * 0.36), 6); // tapered legs
      B(g, w * 0.82, 0.05, d * 0.82, a, 0, h * 0.45); B(g, w * 0.76, 0.07, d * 0.74, c, 0, h * 0.5); // seat frame + cushion
      if (f.shape === 'chair') { B(g, w * 0.8, h * 0.48, 0.06, a, 0, h * 0.52, -d * 0.38); B(g, w * 0.66, h * 0.34, 0.06, c, 0, h * 0.6, -d * 0.33); } break; }
    case 'sofa': case 'sectional': { B(g, w, h * 0.12, d, dark, 0, 0); B(g, w * 0.96, h * 0.25, d * 0.9, a, 0, h * 0.12); // plinth + base frame
      const n = Math.max(2, Math.round(w / 0.9)); const cw = (w - 0.4) / n; for (let i = 0; i < n; i++) { const x = -w / 2 + 0.2 + cw * (i + 0.5); B(g, cw * 0.95, h * 0.14, d * 0.66, c, x, h * 0.37, d * 0.08); B(g, cw * 0.92, h * 0.42, d * 0.16, c, x, h * 0.4, -d * 0.32); } // seat + back cushions
      B(g, w, h * 0.5, d * 0.14, a, 0, h * 0.37, -d * 0.43); for (const sx of [-1, 1]) { B(g, 0.2, h * 0.36, d * 0.92, a, sx * (w / 2 - 0.1), h * 0.37); C(g, 0.1, 0.1, d * 0.92, a, sx * (w / 2 - 0.1), h * 0.73 - d * 0.46, 0, 10).rotation.x = Math.PI / 2; }
      B(g, 0.32, 0.28, 0.1, M(f.accent), -w * 0.3, h * 0.5, -d * 0.2).rotation.z = 0.2; if (f.shape === 'sectional') B(g, w * 0.35, h * 0.14, d * 0.8, c, w * 0.32, h * 0.37, d * 0.5); break; }
    case 'table': case 'desk': case 'lowtable': legs(h - 0.06); B(g, w, 0.06, d, c, 0, h - 0.06); if (f.shape === 'desk') B(g, w * 0.3, h - 0.1, d * 0.9, a, w * 0.33, 0); break;
    case 'bed': { // QA#16: the solid accent-coloured base read as a bathtub/boat. Now a wooden frame on legs, a white mattress, an
      // accent duvet folded back from the pillows and draped over the sides, and a padded wooden headboard.
      const wood = M(0x6b4526); legs(0.14, 0.06); B(g, w, 0.16, d, wood, 0, 0.12); B(g, w * 0.95, h * 0.32, d * 0.95, M(0xf4f1ea), 0, 0.28);
      const top = 0.28 + h * 0.32; B(g, w * 0.99, 0.06, d * 0.66, a, 0, top - 0.02, d * 0.16).userData.part = 'duvet'; for (const sx of [-1, 1]) B(g, 0.03, h * 0.3, d * 0.66, a, sx * w * 0.495, top - h * 0.3, d * 0.16);
      B(g, w * 0.99, 0.07, 0.18, M(0xf4f1ea), 0, top - 0.01, -d * 0.19); B(g, w, h * 1.5, 0.1, wood, 0, 0, -d / 2 + 0.05); B(g, w * 0.9, h * 0.6, 0.06, c, 0, top + 0.05, -d / 2 + 0.12);
      for (const sx of w > 1.2 ? [-1, 1] : [0]) B(g, w > 1.2 ? w * 0.36 : w * 0.7, 0.12, 0.3, M(0xffffff), sx * w * 0.22, top, -d * 0.36); break; }
    case 'shelf': case 'cabinet': { B(g, w, h, d * 0.12, c, 0, 0, -d * 0.44); for (const sx of [-1, 1]) B(g, 0.05, h, d, c, sx * (w / 2 - 0.025)); B(g, w, 0.05, d, c, 0, h - 0.05); B(g, w, 0.08, d, dark);
      for (let i = 1; i < 4; i++) B(g, w * 0.95, 0.04, d, a, 0, (h * i) / 4);
      if (f.shape === 'cabinet') { for (const sx of [-1, 1]) { B(g, w * 0.47, h * 0.94, 0.03, a, sx * w * 0.245, h * 0.03, d / 2); B(g, 0.03, 0.16, 0.04, M(0xd8c080, { metal: 0.8 }), sx * 0.06, h * 0.45, d / 2 + 0.03); } }
      else { const bc = [0xa83232, 0x2a5aa0, 0x3a8a4a, 0xd8b25a, 0x6a3a8a]; for (let r = 0; r < 4; r++) { let x = -w / 2 + 0.08; let j = r * 3; while (x < w / 2 - 0.15) { const bw = 0.05 + ((j * 7) % 5) * 0.012, bh = h / 4 * (0.55 + ((j * 3) % 4) * 0.08); B(g, bw, bh, d * 0.6, M(bc[j % 5]!), x + bw / 2, (h * r) / 4 + 0.04, 0); x += bw + 0.01; j++; } } }
      break; }
    case 'lamp': C(g, 0.18, 0.22, 0.05, dark); C(g, 0.03, 0.03, h * 0.8, dark); C(g, 0.16, 0.26, h * 0.25, M(f.accent, { emissive: f.accent }), 0, h * 0.75); break;
    case 'chandelier': C(g, 0.02, 0.02, 0.4, dark, 0, h - 0.4); for (let i = 0; i < 6; i++) S(g, 0.08, M(f.accent, { emissive: f.accent }), Math.cos(i) * 0.4, h - 0.45, Math.sin(i) * 0.4); C(g, 0.45, 0.2, 0.1, M(f.color, { metal: 0.8 }), 0, h - 0.5); break;
    case 'rug': B(g, w, 0.02, d, c); B(g, w * 0.8, 0.021, d * 0.8, a); break;
    case 'painting': B(g, w, h * 0.7, 0.06, a, 0, h * 0.3, -d / 2 + 0.05); B(g, w * 0.85, h * 0.55, 0.07, c, 0, h * 0.37, -d / 2 + 0.06); break;
    case 'plant': case 'palm': C(g, 0.2, 0.15, 0.35, a); if (f.shape === 'palm') { C(g, 0.05, 0.07, h * 0.7, M(0x8a6440), 0, 0.35); for (let i = 0; i < 5; i++) { const l = B(g, 0.12, 0.04, 0.7, c, Math.cos(i * 1.26) * 0.3, h * 0.95, Math.sin(i * 1.26) * 0.3); l.rotation.y = -i * 1.26 + Math.PI / 2; l.rotation.x = 0.35; } } else S(g, 0.32, c, 0, 0.35 + h * 0.4); break;
    case 'monstera': { C(g, 0.18, 0.14, 0.32, a); C(g, 0.16, 0.16, 0.04, M(0x3a2a18), 0, 0.32); C(g, 0.03, 0.04, 0.28, M(0x4a6a30), 0, 0.32);
      for (let i = 0; i < 6; i++) { const ang = i * 1.05, y = 0.62 + (i % 3) * 0.16; const l = B(g, 0.36, 0.02, 0.26, c, Math.cos(ang) * 0.16, y, Math.sin(ang) * 0.16); l.rotation.y = -ang + Math.PI / 2; l.rotation.x = 0.45; } break; }
    case 'fiddlefig': { C(g, 0.16, 0.13, 0.3, a); C(g, 0.14, 0.14, 0.04, M(0x3a2a18), 0, 0.3); C(g, 0.035, 0.045, h * 0.62, M(0x6b4a28), 0, 0.3);
      for (let i = 0; i < 5; i++) { const ang = i * 1.2, y = 0.58 + i * 0.2; const l = B(g, 0.2, 0.02, 0.3, c, Math.cos(ang) * 0.12, y, Math.sin(ang) * 0.12); l.rotation.y = -ang; l.rotation.x = 0.5; } break; }
    case 'snakeplant': { C(g, 0.2, 0.16, 0.22, a); C(g, 0.18, 0.18, 0.04, M(0x3a2a18), 0, 0.22);
      for (let i = 0; i < 7; i++) { const ang = i * 0.9, hh = 0.55 + (i % 3) * 0.18; const l = B(g, 0.07, hh, 0.02, c, Math.cos(ang) * 0.08, 0.26, Math.sin(ang) * 0.08); l.rotation.y = ang; l.rotation.z = i % 2 ? 0.08 : -0.08; } break; }
    case 'pothos': { C(g, 0.14, 0.16, 0.05, dark); C(g, 0.02, 0.02, h * 0.72, dark); C(g, 0.16, 0.16, 0.02, dark, 0, h * 0.72);
      C(g, 0.01, 0.01, 0.16, M(0xc9a87c), 0, h * 0.58); C(g, 0.12, 0.1, 0.14, a, 0, h * 0.44);
      for (let i = 0; i < 8; i++) { const y = h * 0.44 - i * 0.1; const l = B(g, 0.12, 0.02, 0.08, c, Math.sin(i) * 0.1, y, Math.cos(i) * 0.08); l.rotation.z = 0.35; l.rotation.y = i * 0.7; } break; }
    case 'cacti': { B(g, w * 0.9, 0.04, d * 0.7, a);
      const pots: [number, number][] = [[-0.24, 0.28], [0.02, 0.42], [0.24, 0.2]];
      for (const [x, hh] of pots) { C(g, 0.08, 0.07, 0.12, a, x, 0.04); C(g, 0.055, 0.065, hh, c, x, 0.16, 0, 8); }
      B(g, 0.04, 0.12, 0.04, c, 0.02, 0.5, 0.08); B(g, 0.04, 0.1, 0.04, c, 0.02, 0.5, -0.08); break; }
    case 'parlorpalm': { C(g, 0.16, 0.13, 0.28, a); C(g, 0.14, 0.14, 0.04, M(0x3a2a18), 0, 0.28);
      for (let s = 0; s < 3; s++) { const ox = (s - 1) * 0.08; C(g, 0.02, 0.03, h * 0.5, M(0x8a6440), ox, 0.28);
        for (let i = 0; i < 4; i++) { const l = B(g, 0.06, 0.02, 0.38, c, ox + Math.cos(i * 1.5) * 0.14, h * 0.72, Math.sin(i * 1.5) * 0.14); l.rotation.y = -i * 1.5 + Math.PI / 2; l.rotation.x = 0.5; } }
      break; }
    case 'eames': { const wood = a, leather = c, cz = d > 1.2 ? -d * 0.2 : 0;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = C(g, 0.025, 0.03, 0.28, wood, sx * 0.22, 0, cz + sz * 0.18, 6); leg.rotation.z = sx * 0.18; leg.rotation.x = -sz * 0.12; }
      B(g, 0.7, 0.08, 0.62, leather, 0, 0.28, cz); const back = B(g, 0.68, 0.55, 0.08, leather, 0, 0.38, cz - 0.28); back.rotation.x = -0.35;
      B(g, 0.62, 0.05, 0.5, M(0x2a2a2a), 0, 0.36, cz + 0.02);
      if (d > 1.2) { for (const sx of [-1, 1]) for (const sz of [-1, 1]) C(g, 0.02, 0.025, 0.18, wood, sx * 0.16, 0, d * 0.28 + sz * 0.12, 6);
        B(g, 0.48, 0.08, 0.4, leather, 0, 0.18, d * 0.28); }
      break; }
    case 'sideboard': { for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = C(g, 0.02, 0.03, 0.22, a, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), 6); leg.rotation.z = sx * 0.12; }
      B(g, w, h - 0.22, d, c, 0, 0.22); B(g, w * 0.98, 0.03, d * 0.98, a, 0, h - 0.03);
      const n = Math.max(2, Math.round(w)); const dw = w / n;
      for (let i = 0; i < n; i++) { const x = -w / 2 + dw * (i + 0.5); B(g, 0.01, h - 0.32, d * 0.02, a, x - dw / 2, 0.28, d / 2); B(g, 0.08, 0.02, 0.03, M(0xd8c080, { metal: 0.8 }), x, h * 0.55, d / 2); }
      break; }
    case 'tulip': { C(g, 0.18, 0.26, 0.05, a); C(g, 0.05, 0.16, h * 0.28, a, 0, 0.05); C(g, 0.04, 0.04, h * 0.5, a, 0, h * 0.28); C(g, 0.1, 0.04, 0.06, a, 0, h - 0.11);
      C(g, Math.min(w, d) * 0.46, Math.min(w, d) * 0.46, 0.05, c, 0, h - 0.05, 0, 24); break; }
    case 'sunburst': { const z = -d / 2 + 0.04, cy = h * 0.72;
      for (let i = 0; i < 12; i++) { const ang = (i * Math.PI) / 6; const ray = B(g, 0.04, 0.55, 0.03, c, 0, cy, z); ray.rotation.z = ang; ray.position.set(Math.cos(ang) * 0.18, cy + Math.sin(ang) * 0.18, z); }
      const face = C(g, 0.16, 0.16, 0.05, a, 0, cy - 0.025, z, 16); face.rotation.x = Math.PI / 2;
      C(g, 0.02, 0.02, 0.04, c, 0, cy - 0.02, z + 0.03); B(g, 0.02, 0.1, 0.01, c, 0, cy + 0.04, z + 0.03); B(g, 0.07, 0.015, 0.01, c, 0.03, cy, z + 0.03); break; }
    case 'arclamp': { C(g, 0.2, 0.24, 0.05, c); C(g, 0.025, 0.025, h * 0.5, c);
      const span = Math.max(w, d) * 0.7, mid = h * 0.72; const arm = C(g, 0.02, 0.02, span, c, 0, mid, span * 0.15, 8); arm.rotation.x = Math.PI / 2.6;
      C(g, 0.01, 0.01, 0.18, c, 0, mid - 0.05, span * 0.55); C(g, 0.14, 0.18, 0.16, M(f.accent, { emissive: f.accent }), 0, mid - 0.28, span * 0.55); break; }
    case 'lowsofa': { for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = C(g, 0.02, 0.03, 0.16, a, sx * (w / 2 - 0.1), 0, sz * (d / 2 - 0.08), 6); leg.rotation.z = sx * 0.14; }
      B(g, w, h * 0.28, d * 0.92, a, 0, 0.16); const n = Math.max(2, Math.round(w / 0.9)); const cw = (w - 0.16) / n;
      for (let i = 0; i < n; i++) { const x = -w / 2 + 0.08 + cw * (i + 0.5); B(g, cw * 0.94, h * 0.16, d * 0.7, c, x, 0.16 + h * 0.28, d * 0.04); }
      B(g, w * 0.98, h * 0.42, d * 0.1, a, 0, 0.16 + h * 0.28, -d * 0.4); B(g, w * 0.94, h * 0.32, 0.08, c, 0, 0.2 + h * 0.3, -d * 0.36);
      for (const sx of [-1, 1]) B(g, 0.1, h * 0.28, d * 0.7, a, sx * (w / 2 - 0.05), 0.16 + h * 0.28); break; }
    case 'tv': B(g, w, 0.35, d * 0.6, a); B(g, w * 0.9, 0.02, d * 0.5, dark, 0, 0.35); C(g, 0.03, 0.03, 0.12, dark, 0, 0.36); B(g, w * 0.97, h * 0.56, 0.05, M(0x111111, { metal: 0.6 }), 0, 0.46); B(g, w * 0.93, h * 0.52, 0.02, M(0x0a0c12, { emissive: 0x2a3a6a }), 0, 0.48, 0.03); break;
    case 'pc': B(g, w, h * 0.55, d, a); B(g, w * 0.6, h * 0.35, 0.05, M(0x0a0c12, { emissive: 0x3aa0ff }), 0, h * 0.6, -d * 0.2); B(g, 0.2, h * 0.4, 0.4, M(f.color, { emissive: f.color }), w * 0.38, h * 0.55); break;
    case 'arcade': B(g, w, h, d, c); B(g, w * 0.8, h * 0.3, 0.05, M(0x0a0c12, { emissive: f.accent }), 0, h * 0.55, d / 2 + 0.01); B(g, w, 0.15, d * 0.4, a, 0, h * 0.45, d * 0.35); break;
    case 'fridge': B(g, w, h, d * 0.96, M(f.color, { metal: 0.5 })); B(g, w * 0.98, 0.02, 0.02, dark, 0, h * 0.62, d * 0.48); for (const [y0, hh] of [[h * 0.66, h * 0.26], [h * 0.12, h * 0.4]] as const) B(g, 0.04, hh, 0.05, a, w * 0.38, y0, d * 0.5); B(g, w * 0.3, h * 0.08, 0.02, M(0x0a1a2a, { emissive: 0x3aa0ff }), -w * 0.18, h * 0.75, d * 0.49); break;
    case 'stove': case 'counter': B(g, w, h, d, c); B(g, w, 0.05, d, a, 0, h); if (f.shape === 'stove') for (const sx of [-1, 1]) C(g, 0.12, 0.12, 0.02, dark, sx * w * 0.22, h + 0.05, 0); break;
    case 'piano': B(g, w, h * 0.55, d * 0.4, c, 0, h * 0.25, -d * 0.3); B(g, w, h * 0.06, d * 0.3, M(0xf5f5f5), 0, h * 0.42, d * 0.05); legs(h * 0.42); break;
    case 'aquarium': B(g, w, h * 0.4, d, a); B(g, w, h * 0.55, d, M(0x5ac8ff, { opacity: 0.45, emissive: 0x1a5aa0 }), 0, h * 0.4); S(g, 0.07, M(0xff8a2a), 0.1, h * 0.65, 0); break;
    case 'hottub': C(g, Math.min(w, d) / 2, Math.min(w, d) / 2, h, c, 0, 0, 0, 20); C(g, Math.min(w, d) / 2 - 0.1, Math.min(w, d) / 2 - 0.1, 0.02, M(f.accent, { emissive: f.accent }), 0, h, 0, 20); break;
    case 'statue': B(g, w * 0.6, 0.4, d * 0.6, a); C(g, 0.18, 0.25, h - 0.8, c, 0, 0.4); S(g, 0.22, c, 0, h - 0.2); break;
    case 'vault': B(g, w, h, d, M(f.color, { metal: 0.7 })); C(g, 0.3, 0.3, 0.06, M(f.accent, { metal: 0.9, emissive: 0x403000 }), 0, h * 0.4, d / 2).rotation.x = Math.PI / 2; break;
    default: B(g, w, h, d, c);
  }
  return g;
}

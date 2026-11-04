import * as THREE from 'three';
/**
 * mu-visuals: rounded, blunt aircraft noses (and tail cones) that blend into a cylindrical fuselage with no seam.
 * Profile: radius(t) = r·(1 − t^2.2)^0.5 for t∈[0,1] along the axis. Its slope is 0 at the joint (tangent to the
 * fuselage, same radius, same normals) and vertical at the tip (a rounded radome, not a rocket point). Built as a
 * Lathe with the same radial segment count + phase as the fuselage cylinder so the joint ring vertices coincide.
 * Geometry is cached per (r, len, seg); all axes point +Z from z = 0 (use axis 'x' for +X planes).
 */
export const FUSE_SEG = 24;
const cache = new Map<string, THREE.BufferGeometry>();
const prof = (r: number, len: number, t0 = 0, t1 = 1, n = 14, s = 1) => { const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) { const t = t0 + (t1 - t0) * (i / n); pts.push(new THREE.Vector2(Math.max(1e-4, r * s * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.2)))), t * len)); }
  return pts; };
const orient = (g: THREE.BufferGeometry, axis: 'z' | 'x') => { g.rotateX(Math.PI / 2); if (axis === 'x') g.rotateY(Math.PI / 2); return g; };
const memo = (k: string, f: () => THREE.BufferGeometry) => { let g = cache.get(k); if (!g) { g = f(); g.userData.shared = true; cache.set(k, g); } return g; };
/** Nose (or, with a shorter len, a tail cone) starting at the joint z=0 with radius r, ending at z=len. */
export const noseGeo = (r: number, len: number, axis: 'z' | 'x' = 'z') => memo(`n${r}|${len}|${axis}`, () => orient(new THREE.LatheGeometry(prof(r, len), FUSE_SEG), axis));
/** Fuselage tube matching the nose ring exactly (same radius, segments and phase), centred, along the axis. */
export const fuselageGeo = (r: number, len: number, axis: 'z' | 'x' = 'z') => memo(`f${r}|${len}|${axis}`, () => orient(new THREE.CylinderGeometry(r, r, len, FUSE_SEG, 1, true), axis));
/** Cockpit windscreen: a skin over the upper front of the nose that wraps round its sides. */
export const windscreenGeo = (r: number, len: number, axis: 'z' | 'x' = 'z') => memo(`w${r}|${len}|${axis}`, () => orient(new THREE.LatheGeometry(prof(r, len, 0.12, 0.62, 8, 1.012), 16, Math.PI - 1.15, 2.3), axis));
/** Add a fuselage + nose + optional tail cone + windscreen to g. Fuselage centred at (0, y, 0) along the axis. */
export function addFuselage(g: THREE.Group, o: { r: number; len: number; nose: number; tail?: number; y?: number; axis?: 'z' | 'x'; body: THREE.Material; glass: THREE.Material; nosePart?: THREE.Material }) {
  const ax = o.axis ?? 'z', y = o.y ?? 0, h = o.len / 2; const at = (m: THREE.Mesh, d: number) => { if (ax === 'z') m.position.set(0, y, d); else m.position.set(d, y, 0); g.add(m); return m; };
  const f = at(new THREE.Mesh(fuselageGeo(o.r, o.len, ax), o.body), 0); f.userData.part = 'fuselage'; f.userData.r = o.r;
  const n = at(new THREE.Mesh(noseGeo(o.r, o.nose, ax), o.nosePart ?? o.body), h); n.userData.part = 'nose'; n.userData.r = o.r;
  at(new THREE.Mesh(windscreenGeo(o.r, o.nose, ax), o.glass), h).userData.part = 'windscreen';
  if (o.tail) { const t = at(new THREE.Mesh(noseGeo(o.r, o.tail, ax), o.body), -h); if (ax === 'z') t.rotation.y = Math.PI; else t.rotation.y = Math.PI; t.userData.part = 'tail'; }
  return f;
}

/**
 * mu-visuals tail fins: a swept, tapered vertical stabiliser standing on the fuselage centreline at the rear (base sunk
 * a hair into the tube top so it's flush on every facet, never floating), plus a matching pair of swept horizontal
 * stabilisers: conventional (through the tail at the fuselage centre height) or a T-tail (on top of the fin tip).
 * Geometry is built in the +Z-forward frame and cached; axis 'x' rotates it to +X-forward like the fuselage.
 */
export interface TailOpts { r: number; len: number; y?: number; axis?: 'z' | 'x'; fin: THREE.Material; stab?: THREE.Material; tTail?: boolean;
  /** fin height / root chord as multiples of r (defaults 2.6 / 2.4). */ h?: number; c?: number; span?: number }
export const TAIL_TAPER = 0.5, TAIL_SWEEP = 0.85; // tip chord / root chord; LE aft offset / height (≈40° sweep)
const finGeo = (r: number, hgt: number, c: number, t: number, axis: 'z' | 'x') => memo(`tf${r}|${hgt}|${c}|${axis}`, () => {
  // Shape in (forward, up): root LE (0,0) → tip LE → tip TE → root TE.
  const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(-hgt * TAIL_SWEEP, hgt); s.lineTo(-hgt * TAIL_SWEEP - c * TAIL_TAPER, hgt); s.lineTo(-c, 0); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false }); g.translate(0, 0, -t / 2); g.rotateY(-Math.PI / 2); // shape x → +Z, extrude → X (centred)
  if (axis === 'x') g.rotateY(Math.PI / 2); return g; });
const stabGeo = (span: number, c: number, t: number, side: number, axis: 'z' | 'x') => memo(`ts${span}|${c}|${side}|${axis}`, () => {
  const sw = span * 0.6; const s = new THREE.Shape(); // (span, forward)
  s.moveTo(0, 0); s.lineTo(side * span, -sw); s.lineTo(side * span, -sw - c * TAIL_TAPER); s.lineTo(0, -c); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false }); g.translate(0, 0, -t / 2); g.rotateX(Math.PI / 2); // shape y (forward) → +Z, extrude → Y (centred)
  if (axis === 'x') g.rotateY(Math.PI / 2); return g; });
export function addTail(g: THREE.Group, o: TailOpts) {
  const ax = o.axis ?? 'z', y = o.y ?? 0, r = o.r, hgt = r * (o.h ?? 2.6), c = r * (o.c ?? 2.4), t = r * 0.16;
  const at = (m: THREE.Mesh, d: number, yy: number) => { if (ax === 'z') m.position.set(0, yy, d); else m.position.set(d, yy, 0); g.add(m); return m; };
  const rootLE = -o.len / 2 + c, base = y + r * 0.97;
  const fin = at(new THREE.Mesh(finGeo(r, hgt, c, t, ax), o.fin), rootLE, base); Object.assign(fin.userData, { part: 'fin', base, rootLE, c, hgt, r });
  const sc = o.tTail ? c * TAIL_TAPER * 1.05 : c * 0.8, span = r * (o.span ?? (o.tTail ? 2.6 : 3.0)), ts = t * 0.8;
  const sLE = o.tTail ? rootLE - hgt * TAIL_SWEEP : rootLE - c * 0.1, sy = o.tTail ? base + hgt - ts / 2 : y;
  for (const side of [1, -1]) { const m = at(new THREE.Mesh(stabGeo(span, sc, ts, side, ax), o.stab ?? o.fin), sLE, sy); Object.assign(m.userData, { part: 'stab', side, tTail: !!o.tTail }); }
  return fin;
}

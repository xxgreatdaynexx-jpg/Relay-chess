/** Mine weapon viewmodels: one procedural three.js model per Weapon Store weapon, matching its name.
 *  Low gfx (?lowgfx) uses cheap Lambert materials and no extra lights; the crystal/diamond glow is emissive only. */
import * as THREE from 'three';
import { WEAPONS, type WeaponId } from '../../../shared/mineCombat';

export type BladeShape = 'chipped' | 'straight' | 'broad' | 'great' | 'faceted' | 'curved';
export interface WeaponModelSpec {
  blade: string; bladeShape: BladeShape; bladeLen: number; bladeW: number;
  guard: string; guardW: number; grip: string; gripLen: number;
  metalness: number; roughness: number; emissive?: string; translucent?: boolean; sparkle?: boolean; pits?: boolean; ornate?: boolean;
}
export const WEAPON_MODELS: Record<WeaponId, WeaponModelSpec> = {
  rusty_sword:    { blade: '#9a5a2c', bladeShape: 'chipped', bladeLen: 0.7, bladeW: 0.05, guard: '#5e4a36', guardW: 0.18, grip: '#5a4a3a', gripLen: 0.2, metalness: 0.35, roughness: 0.85, pits: true },
  copper_sword:   { blade: '#d9824a', bladeShape: 'straight', bladeLen: 0.72, bladeW: 0.05, guard: '#b86b36', guardW: 0.16, grip: '#4a2c18', gripLen: 0.2, metalness: 0.9, roughness: 0.22 },
  iron_sword:     { blade: '#5d636b', bladeShape: 'broad', bladeLen: 0.78, bladeW: 0.065, guard: '#3a3d42', guardW: 0.3, grip: '#2a1c12', gripLen: 0.22, metalness: 0.75, roughness: 0.45 },
  steel_claymore: { blade: '#eef2f7', bladeShape: 'great', bladeLen: 1.25, bladeW: 0.1, guard: '#aab2bd', guardW: 0.46, grip: '#2b2b34', gripLen: 0.42, metalness: 0.95, roughness: 0.12 },
  crystal_blade:  { blade: '#9a6bff', bladeShape: 'faceted', bladeLen: 0.82, bladeW: 0.075, guard: '#3b2a5c', guardW: 0.22, grip: '#22163a', gripLen: 0.2, metalness: 0.1, roughness: 0.1, emissive: '#7a3cff', translucent: true },
  diamond_saber:  { blade: '#dffaff', bladeShape: 'curved', bladeLen: 0.85, bladeW: 0.055, guard: '#e8c26a', guardW: 0.24, grip: '#1c2a44', gripLen: 0.2, metalness: 0.6, roughness: 0.05, emissive: '#5fe8ff', sparkle: true, ornate: true },
};
export const weaponModelSpec = (id: string | null | undefined): WeaponModelSpec =>
  WEAPON_MODELS[(id && id in WEAPON_MODELS ? id : 'rusty_sword') as WeaponId];

function mat(color: string, s: WeaponModelSpec, low: boolean, part: 'blade' | 'hilt') {
  const glow = part === 'blade' && s.emissive;
  if (low) return new THREE.MeshLambertMaterial({ color, emissive: glow ? s.emissive : '#000000', emissiveIntensity: glow ? 0.8 : 0, transparent: part === 'blade' && !!s.translucent, opacity: part === 'blade' && s.translucent ? 0.8 : 1 });
  return new THREE.MeshStandardMaterial({ color, metalness: part === 'blade' ? s.metalness : 0.5, roughness: part === 'blade' ? s.roughness : 0.7,
    emissive: glow ? s.emissive! : '#000000', emissiveIntensity: glow ? 0.9 : 0, transparent: part === 'blade' && !!s.translucent, opacity: part === 'blade' && s.translucent ? 0.72 : 1, flatShading: s.bladeShape === 'faceted' });
}

function bladeGeo(s: WeaponModelSpec): THREE.BufferGeometry {
  const L = s.bladeLen, W = s.bladeW / 2, sh = new THREE.Shape();
  switch (s.bladeShape) {
    case 'chipped': sh.moveTo(-W, 0); sh.lineTo(W, 0); sh.lineTo(W, L * 0.3); sh.lineTo(W * 0.4, L * 0.36); sh.lineTo(W, L * 0.42); sh.lineTo(W, L * 0.75); sh.lineTo(W * 0.2, L * 0.82); sh.lineTo(W * 0.6, L * 0.9); sh.lineTo(-W * 0.2, L); sh.lineTo(-W, L * 0.88); sh.lineTo(-W, L * 0.55); sh.lineTo(-W * 0.45, L * 0.5); sh.lineTo(-W, L * 0.45); break;
    case 'curved': sh.moveTo(-W, 0); sh.lineTo(W, 0); sh.quadraticCurveTo(W + L * 0.08, L * 0.55, W + L * 0.2, L); sh.quadraticCurveTo(-W + L * 0.04, L * 0.6, -W, 0); break;
    case 'faceted': { const g = new THREE.ConeGeometry(W * 1.2, L, 4, 1); g.translate(0, L / 2, 0); g.scale(1, 1, 0.45); return g; }
    case 'great': sh.moveTo(-W, 0); sh.lineTo(W, 0); sh.lineTo(W * 0.85, L * 0.88); sh.lineTo(0, L); sh.lineTo(-W * 0.85, L * 0.88); break;
    default: sh.moveTo(-W, 0); sh.lineTo(W, 0); sh.lineTo(W, L * 0.9); sh.lineTo(0, L); sh.lineTo(-W, L * 0.9);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: s.bladeShape === 'great' ? 0.022 : 0.014, bevelEnabled: false }); g.translate(0, 0, -0.008); return g;
}

/** Build the weapon model (grip at origin, blade along +y). */
export function buildWeaponModel(id: string | null | undefined, low = false): THREE.Group {
  const s = weaponModelSpec(id), g = new THREE.Group(); g.name = `weapon:${id ?? 'rusty_sword'}`;
  const gy = 0.1;
  const blade = new THREE.Mesh(bladeGeo(s), mat(s.blade, s, low, 'blade')); blade.position.y = gy + 0.02; blade.name = 'blade'; g.add(blade);
  if (s.bladeShape === 'great' || s.bladeShape === 'broad') { // fuller groove
    const f = new THREE.Mesh(new THREE.BoxGeometry(s.bladeW * 0.18, s.bladeLen * 0.7, 0.03), mat('#8c939c', s, low, 'hilt')); f.position.y = gy + s.bladeLen * 0.4; g.add(f);
  }
  if (s.pits) for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.02), mat(i % 2 ? '#5a2e14' : '#c06a2a', s, low, 'hilt')); p.position.set((i % 3 - 1) * 0.014, gy + 0.1 + i * 0.09, 0); g.add(p); }
  const guard = new THREE.Mesh(new THREE.BoxGeometry(s.guardW, s.bladeShape === 'great' ? 0.06 : 0.04, s.bladeShape === 'broad' ? 0.07 : 0.05), mat(s.guard, s, low, 'hilt')); guard.position.y = gy; guard.name = 'guard'; g.add(guard);
  if (s.ornate || s.bladeShape === 'broad' || s.bladeShape === 'great') for (const sx of [-1, 1]) {
    const k = new THREE.Mesh(new THREE.SphereGeometry(s.ornate ? 0.025 : 0.02, 8, 6), mat(s.ornate ? '#5fe8ff' : s.guard, s, low, 'hilt')); k.position.set(sx * s.guardW / 2, gy, 0); g.add(k);
  }
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, s.gripLen, 8), mat(s.grip, s, low, 'hilt')); grip.position.y = gy - s.gripLen / 2; grip.name = 'grip'; g.add(grip);
  if (s.pits) { const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 4, 8), mat('#8a7a5a', s, low, 'hilt')); wrap.rotation.x = Math.PI / 2; wrap.position.y = gy - s.gripLen * 0.6; g.add(wrap); }
  const pom = new THREE.Mesh(new THREE.SphereGeometry(s.bladeShape === 'great' ? 0.04 : 0.03, 8, 6), mat(s.guard, s, low, 'hilt')); pom.position.y = gy - s.gripLen - 0.015; g.add(pom);
  if (s.sparkle) {
    const sm = new THREE.SpriteMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    for (let i = 0; i < (low ? 2 : 5); i++) { const sp = new THREE.Sprite(sm); sp.scale.setScalar(0.035); sp.position.set(0.02 + i * 0.012, gy + 0.15 + i * 0.14, 0.012); sp.name = 'sparkle'; g.add(sp); }
  }
  if (s.bladeShape === 'great') g.scale.setScalar(0.85); // keeps the greatsword in frame while still far bigger
  return g;
}

/** Shimmer the sparkles / glow; cheap per-frame tweak. */
export function animateWeaponModel(g: THREE.Group, t: number) {
  let i = 0; g.traverse((o) => { if (o.name === 'sparkle') { const k = 0.5 + 0.5 * Math.sin(t * 6 + i++ * 1.7); (o as THREE.Sprite).scale.setScalar(0.015 + 0.03 * k); } });
}

const thumbs = new Map<string, string>();
/** Small rendered thumbnail (data URL) for the store; null if WebGL is unavailable. */
export function weaponThumb(id: WeaponId, size = 56): string | null {
  const k = `${id}:${size}`; const hit = thumbs.get(k); if (hit) return hit;
  try {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); r.setSize(size, size, false);
    const s = new THREE.Scene(); s.add(new THREE.HemisphereLight('#ffffff', '#555555', 1.8)); const d = new THREE.DirectionalLight('#ffffff', 2.4); d.position.set(2, 3, 3); s.add(d);
    const g = buildWeaponModel(id); g.rotation.set(0, 0.3, -0.78); const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()); g.position.sub(c); s.add(g);
    const sz = box.getSize(new THREE.Vector3()).length(); const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 20); cam.position.set(0, 0, sz * 1.85); cam.lookAt(0, 0, 0);
    r.render(s, cam); const url = r.domElement.toDataURL('image/png'); r.dispose(); r.forceContextLoss?.(); thumbs.set(k, url); return url;
  } catch { return null; }
}
export const WEAPON_IDS = WEAPONS.map((w) => w.id);

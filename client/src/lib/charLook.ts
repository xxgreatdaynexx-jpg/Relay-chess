/** Shared character-look helpers (pt1340u): soft rim light, rounded parts, and a low-detail path for weak devices. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { detectWorldTier } from './worldTier';

let low: boolean | null = null;
/** True on low-tier devices (phones / ≤4 cores): skip bevels and extra detail meshes. */
export function lowDetail(): boolean {
  if (low === null) { try { low = typeof window !== 'undefined' && detectWorldTier() === 'low'; } catch { low = false; } }
  return low;
}
export function setLowDetailForTest(v: boolean | null): void { low = v; }

/** Adds a cheap view-space fresnel rim to a Lambert/Phong/Standard material (one shader line, no extra lights). */
export function addRim<T extends THREE.Material>(mat: T, color: THREE.ColorRepresentation = 0xffffff, strength = 0.35, power = 3): T {
  if (mat.userData.rim) return mat;
  mat.userData.rim = true;
  const c = new THREE.Color(color);
  const uRim = { value: new THREE.Vector3(c.r * strength, c.g * strength, c.b * strength) };
  mat.userData.uRim = uRim;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = uRim;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n{ float rimF = 1.0 - abs(dot(normalize(vViewPosition), normal)); totalEmissiveRadiance += uRim * pow(rimF, ${power.toFixed(1)}); }`);
  };
  mat.customProgramCacheKey = () => `rim${power}`;
  return mat;
}

const boxes = new Map<string, THREE.BufferGeometry>();
/** Bevelled box (shared per size); plain box on low-detail devices. Same outer dimensions either way. */
export function rbox(w: number, h: number, d: number, r = 0.035): THREE.BufferGeometry {
  const k = `${w}|${h}|${d}|${r}|${lowDetail()}`; let g = boxes.get(k);
  if (!g) { g = lowDetail() ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)); boxes.set(k, g); }
  return g;
}

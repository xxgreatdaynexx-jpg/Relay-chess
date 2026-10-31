/** Procedural weapon skin textures (canvas) + material swap on Cole's gun models. Steel/glass parts keep their stock look. */
import * as THREE from 'three';
import { gunMaterials } from './arenaGuns';
import { parseToken, type SkinDef } from '../../../shared/skins';

function mulberry(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Draw a skin's pattern into a 2D canvas context (also used for inventory thumbnails). */
export function paintSkin(ctx: CanvasRenderingContext2D, size: number, skin: SkinDef, seed: number, float: number): void {
  const [a, b, c] = skin.colors; const r = mulberry(seed * 7919 + skin.id.length);
  const S = size;
  ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
  switch (skin.pattern) {
    case 'camo': for (let i = 0; i < 26; i++) { ctx.fillStyle = [b, c][i % 2]!; ctx.beginPath(); ctx.ellipse(r() * S, r() * S, S * (0.06 + r() * 0.12), S * (0.04 + r() * 0.08), r() * 3, 0, 7); ctx.fill(); } break;
    case 'stripes': { const w = S / (6 + Math.floor(r() * 6)); ctx.save(); ctx.translate(S / 2, S / 2); ctx.rotate(r() * 0.8 - 0.4 + Math.PI / 4); for (let x = -S; x < S; x += w * 2) { ctx.fillStyle = b; ctx.fillRect(x, -S, w, S * 2); ctx.fillStyle = c; ctx.fillRect(x + w * 0.85, -S, w * 0.15, S * 2); } ctx.restore(); break; }
    case 'carbon': { const t = S / 16; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { ctx.fillStyle = (x + y) % 2 ? b : c; ctx.fillRect(x * t, y * t, t, t / 2); } break; }
    case 'hex': { const h = S / 10; for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) { const cx = x * h * 1.5, cy = y * h * 1.73 + (x % 2) * h * 0.87; ctx.beginPath(); for (let k = 0; k < 6; k++) ctx.lineTo(cx + Math.cos(k * 1.047) * h * 0.9, cy + Math.sin(k * 1.047) * h * 0.9); ctx.closePath(); ctx.fillStyle = r() < 0.3 ? c : b; ctx.fill(); } break; }
    case 'gradient': { const g = ctx.createLinearGradient(0, 0, S, S * r()); g.addColorStop(0, a); g.addColorStop(0.55, b); g.addColorStop(1, c); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S); break; }
    case 'marble': for (let i = 0; i < 18; i++) { ctx.strokeStyle = [b, c][i % 2]!; ctx.lineWidth = 1 + r() * S * 0.03; ctx.beginPath(); let x = r() * S, y = 0; ctx.moveTo(x, y); while (y < S) { y += S * 0.08; x += (r() - 0.5) * S * 0.2; ctx.lineTo(x, y); } ctx.stroke(); } break;
    case 'digital': { const t = S / 24; for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) { const v = r(); if (v < 0.35) { ctx.fillStyle = v < 0.15 ? c : b; ctx.fillRect(x * t, y * t, t, t); } } break; }
    case 'tiger': for (let i = 0; i < 14; i++) { ctx.fillStyle = i % 3 ? b : c; ctx.beginPath(); const y = r() * S; ctx.moveTo(0, y); ctx.quadraticCurveTo(S / 2, y + (r() - 0.5) * S * 0.4, S, y + (r() - 0.5) * S * 0.2); ctx.lineTo(S, y + S * 0.04); ctx.quadraticCurveTo(S / 2, y + S * 0.08, 0, y + S * 0.05); ctx.fill(); } break;
    case 'splatter': for (let i = 0; i < 60; i++) { ctx.fillStyle = [b, c][i % 2]!; ctx.beginPath(); ctx.arc(r() * S, r() * S, S * 0.01 + r() * r() * S * 0.08, 0, 7); ctx.fill(); } break;
    case 'circuit': { ctx.strokeStyle = b; ctx.lineWidth = Math.max(1, S / 64); for (let i = 0; i < 30; i++) { let x = Math.round(r() * 16) * S / 16, y = Math.round(r() * 16) * S / 16; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 4; k++) { if (r() < 0.5) x += (r() - 0.5) * S * 0.4; else y += (r() - 0.5) * S * 0.4; ctx.lineTo(x, y); } ctx.stroke(); ctx.fillStyle = c; ctx.fillRect(x - 2, y - 2, 4, 4); } break; }
    case 'checker': { const t = S / 8; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) { ctx.fillStyle = b; ctx.fillRect(x * t, y * t, t, t); } ctx.fillStyle = c; ctx.fillRect(0, S * 0.48, S, S * 0.04); break; }
    default: break;
  }
  // wear: scratches + grime scale with float (Factory New ≈ clean)
  const n = Math.floor(float * 220);
  ctx.globalAlpha = 0.25 + float * 0.4;
  for (let i = 0; i < n; i++) { ctx.strokeStyle = r() < 0.5 ? '#bfbfbf' : '#1a1a1a'; ctx.lineWidth = 1; ctx.beginPath(); const x = r() * S, y = r() * S; ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * S * 0.15, y + (r() - 0.5) * S * 0.05); ctx.stroke(); }
  ctx.globalAlpha = 1;
}

interface SkinMat { mat: THREE.MeshPhongMaterial; skin: SkinDef }
const mats = new Map<string, SkinMat>();
function skinMaterial(token: string): SkinMat | null {
  const hit = mats.get(token); if (hit) return hit;
  const p = parseToken(token); if (!p || typeof document === 'undefined') return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  paintSkin(cv.getContext('2d')!, 128, p.skin, p.seed, p.float);
  const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  const mat = new THREE.MeshPhongMaterial({ map: tex, shininess: p.skin.finish === 'gloss' ? 90 : p.skin.finish === 'metal' ? 60 : p.skin.finish === 'matte' ? 8 : p.skin.rarity === 'common' ? 30 : 70, specular: p.skin.finish === 'metal' ? 0x999999 : 0x444444, flatShading: true });
  if (p.skin.fx) { mat.emissive = new THREE.Color(p.skin.colors[1]); mat.emissiveMap = tex; mat.emissiveIntensity = 0.5; }
  const m = { mat, skin: p.skin }; mats.set(token, m); return m;
}

/** Animate Ultra effects. Call once per frame. */
export function tickSkins(t: number): void {
  for (const { mat, skin } of mats.values()) {
    if (!skin.fx) continue;
    const s = t / 1000;
    if (skin.fx === 'pulse') mat.emissiveIntensity = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(s * 4));
    else if (skin.fx === 'glow') mat.emissiveIntensity = 0.6 + 0.2 * Math.sin(s * 2);
    else if (skin.fx === 'shift') mat.emissive.setHSL((s * 0.15) % 1, 0.9, 0.45);
    else if (skin.fx === 'holo') { mat.emissive.setHSL((s * 0.3) % 1, 1, 0.5); mat.map!.offset.set(s * 0.05, 0); }
    else if (skin.fx === 'ember') mat.emissiveIntensity = 0.3 + 0.5 * Math.abs(Math.sin(s * 7) * Math.sin(s * 2.3));
    else if (skin.fx === 'scan') { mat.map!.offset.set(0, (s * 0.25) % 1); mat.emissiveIntensity = 0.45 + 0.25 * Math.sin(s * 5); }
    else if (skin.fx === 'galaxy') { mat.map!.offset.set(s * 0.03, s * 0.02); mat.emissiveIntensity = 0.5 + 0.3 * Math.sin(s * 3); }
  }
}

/** Swap a gun group's painted materials for a skin (or back to stock when token is null). Cheap when unchanged. */
export function applySkin(root: THREE.Object3D, token: string | null | undefined): void {
  const tk = token ?? null;
  if ((root.userData.sk ?? null) === tk) return;
  root.userData.sk = tk;
  const stock = gunMaterials(); const keep = new Set<THREE.Material>([stock.steel, stock.glass]);
  const sm = tk ? skinMaterial(tk) : null;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!m.userData.base) { const base = m.material as THREE.Material; if (!Object.values(stock).includes(base as THREE.MeshPhongMaterial)) return; m.userData.base = base; }
    const base = m.userData.base as THREE.Material;
    m.material = sm && !keep.has(base) ? sm.mat : base;
  });
}

/**
 * Co-op Hockey Stadium on the city map (mu-coop-econ). The outskirts site (STADIUM_SITE) builds up with the server
 * project: 0% fenced dirt site + crane with the ellipse staked out, 25% elliptical foundation, 50% concrete frame up to the
 * saddle rim, 75% the round seating bowl, 100% the Saddledome-style arena (hypar saddle roof, concrete ring with glass
 * entrance bays, lit marquee, light masts; glows follow day/night). The stage in progress is drawn partially by its own %. A floating label + progress bar
 * shows the overall %, polled from GET /api/coop.
 */
import * as THREE from 'three';
import type { World } from './world3d';
import { cityLabel } from './labelSprite';
import { STADIUM_SITE } from '../../../shared/coop';
import { skyNow, parseTod } from '../../../shared/daynight';
import { detectWorldTier } from './worldTier';

type Summary = { id: string; name: string; icon: string; state: string; stage: number; pct: number };
const mats = new Map<string, THREE.MeshStandardMaterial>();
const M = (color: number, rough = 0.8, metal = 0, emissive = 0, ei = 0, opacity = 1) => {
  const k = `${color}|${rough}|${metal}|${emissive}|${ei}|${opacity}`; let m = mats.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei, transparent: opacity < 1, opacity, side: THREE.DoubleSide }); if (ei > 0) m.userData.ei = ei; mats.set(k, m); } return m;
};
const BOXG = new THREE.BoxGeometry(1, 1, 1); const CYLG = new THREE.CylinderGeometry(1, 1, 1, 12);

/** Saddledome shape (Calgary): elliptical plan, rim height follows a hyperbolic paraboloid -> high at the two ends (±x),
 *  dipping at the sides (±z). Roof surface y = H + K·r²·cos2θ over the ellipse (exactly a hypar clipped to the plan). */
export const DOME = { a: 16.5, b: 12.5, H: 11, K: 3.5 } as const;
export const rimY = (th: number, r = 1) => DOME.H + DOME.K * r * r * Math.cos(2 * th);
const P = (th: number, r: number): [number, number] => [DOME.a * r * Math.cos(th), DOME.b * r * Math.sin(th)];

/** Hypar roof over the ellipse, swept from θ=0 through `frac` of a turn (partial = roof going up). */
function roofGeo(frac: number, seg: number): THREE.BufferGeometry {
  const rs = Math.max(4, Math.round(seg / 6)), ts = Math.max(3, Math.round(seg * frac)); const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= ts; i++) { const th = (i / ts) * frac * Math.PI * 2; for (let j = 0; j <= rs; j++) { const r = j / rs; const [x, z] = P(th, r); pos.push(x, rimY(th, r) + 0.4, z); } }
  for (let i = 0; i < ts; i++) for (let j = 0; j < rs; j++) { const q = i * (rs + 1) + j, n = q + rs + 1; idx.push(q, n, q + 1, q + 1, n, n + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
/** Wall band around the ellipse between y0 and the saddle rim (minus `drop`), for θ in [t0, t1]. */
function bandGeo(t0: number, t1: number, seg: number, r: number, y0: number, drop: number, top?: number): THREE.BufferGeometry {
  const n = Math.max(2, Math.round(seg * (t1 - t0) / (Math.PI * 2))); const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) { const th = t0 + ((t1 - t0) * i) / n; const [x, z] = P(th, r); pos.push(x, y0, z, x, top ?? rimY(th) - drop, z); }
  for (let i = 0; i < n; i++) { const q = i * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
let marqueeTex: THREE.Texture | null = null;
const marquee = () => { if (marqueeTex || typeof document === 'undefined') return marqueeTex;
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const x = c.getContext('2d'); if (!x) return null;
  x.fillStyle = '#1a0606'; x.fillRect(0, 0, 512, 96); x.strokeStyle = '#ffcc33'; x.lineWidth = 6; x.strokeRect(4, 4, 504, 88);
  for (let i = 0; i < 24; i++) { x.fillStyle = '#ffe9a8'; x.beginPath(); x.arc(16 + i * 20.8, 12, 3, 0, 7); x.arc(16 + i * 20.8, 84, 3, 0, 7); x.fill(); }
  x.fillStyle = '#ff3b30'; x.font = '900 50px Outfit Variable, system-ui, sans-serif'; x.textAlign = 'center'; x.fillText('CHUD HUB ARENA', 256, 66);
  marqueeTex = new THREE.CanvasTexture(c); (marqueeTex as THREE.CanvasTexture).colorSpace = THREE.SRGBColorSpace; return marqueeTex; };

/** Build the stadium model for `done` finished stages (0..4) and `frac` of the next one (0..1). `low` = ?lowgfx path
 *  (fewer segments, no transparency, no roof cables). Exported for tests. */
export function buildStadium(done: number, frac: number, low = false): THREE.Group {
  const g = new THREE.Group(); g.name = `stadium-${done}`; const seg = low ? 32 : 64;
  const add = (geo: THREE.BufferGeometry, m: THREE.Material) => { const o = new THREE.Mesh(geo, m); o.castShadow = !low; g.add(o); return o; };
  const B = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) => { const o = new THREE.Mesh(BOXG, m); o.scale.set(w, h, d); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = !low; g.add(o); return o; };
  const C = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(CYLG, m); o.scale.set(r, h, r); o.position.set(x, y, z); g.add(o); return o; };
  const W = STADIUM_SITE.w, D = STADIUM_SITE.d; const stage = (i: number) => (done > i ? 1 : done === i ? frac : 0);
  const concrete = M(0xb9b3a8, 0.95), darkCon = M(0x8d877d, 0.95), steel = M(0x5f6f7f, 0.4, 0.7), dirt = M(0x7a5a3a, 1), seatR = M(0xc8102e, 0.6), seatW = M(0xe8e4dc, 0.7),
    ice = M(0xeaf6ff, 0.15, 0, 0xbfe6ff, 0.25), roofM = M(0xd9d4c7, 0.7, 0.1), glass = low ? M(0x4a7f95, 0.2, 0.4, 0x3a6a80, 0.5) : M(0x9fd6e8, 0.1, 0.3, 0x6fb6d8, 0.6, 0.55),
    lamp = M(0xfff7d6, 0.3, 0, 0xffe9a8, 2);
  const complete = done >= 4;
  if (!complete) {
    B(W + 4, 0.2, D + 4, dirt, 0, 0.1, 0); // site pad
    for (const [w, d, x, z] of [[W + 4, 0.1, 0, -(D + 4) / 2], [W + 4, 0.1, 0, (D + 4) / 2], [0.1, D + 4, -(W + 4) / 2, 0], [0.1, D + 4, (W + 4) / 2, 0]] as const) B(w, 1.4, d, M(0xf59e0b, 0.6), x, 0.8, z); // hoarding
    const cx = W / 2 - 1, cz = -D / 2 + 1; B(0.8, 22, 0.8, M(0xf5c518, 0.5, 0.3), cx, 11, cz); B(26, 0.6, 0.6, M(0xf5c518, 0.5, 0.3), cx - 9, 22, cz); B(2, 1.4, 1.4, concrete, cx + 3.5, 21.6, cz);
    C(0.05, 6, steel, cx - 16, 19, cz); B(1.4, 0.6, 1.4, steel, cx - 16, 15.8, cz);
    if (done === 0 && frac === 0) { // surveyed ellipse staked out on the dirt
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, seg), M(0xffffff, 0.8, 0, 0xffffff, 0.3)); ring.rotation.x = -Math.PI / 2; ring.scale.set(DOME.a, DOME.b, 1); ring.position.y = 0.22; g.add(ring); }
  }
  // 1) foundation: elliptical slab + ring footing poured around the turn by progress
  const f = complete ? 1 : stage(0); if (f > 0) {
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.8, seg, 1, false, Math.PI / 2, f * Math.PI * 2), concrete); slab.scale.set(DOME.a, 1, DOME.b); slab.position.y = 0.6; g.add(slab);
    if (f >= 0.5 || complete) add(bandGeo(0, Math.PI * 2 * Math.min(1, (f - 0.5) * 2 || 1), seg, 1.02, 0, 0, 1.6), darkCon); }
  // 2) frame: raked concrete columns around the ellipse rising to the saddle rim, then the rim ring beam
  const fr = complete ? 1 : stage(1); const nCol = low ? 16 : 24;
  if (fr > 0) { const n = Math.round(fr * nCol);
    for (let i = 0; i < n; i++) { const th = (i / nCol) * Math.PI * 2; const [x, z] = P(th, 1); const h = rimY(th); B(0.8, h, 0.8, darkCon, x, h / 2, z, -th); }
    if (fr >= 0.6) { const beam = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: seg }, (_, i) => { const th = (i / seg) * Math.PI * 2; const [x, z] = P(th, 1); return new THREE.Vector3(x, rimY(th), z); }), true), seg, 0.4, 5, true), steel); g.add(beam); } }
  // 3) stands: round bowl of tiered seating rings (sloped bands) around the rink
  const st = complete ? 1 : stage(2);
  if (st > 0) { const tiers = complete ? 6 : Math.max(1, Math.round(st * 6));
    for (let t = 0; t < tiers; t++) { const r0 = 0.64 + t * 0.058, r1 = r0 + 0.058, y = 1 + t * 1.05;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1.05, seg, 1, true), t === 2 ? seatW : seatR); band.scale.set(DOME.a, 1, DOME.b); band.position.y = y + 0.5; g.add(band); }
    B(16, 0.15, 8, ice, 0, 1.08, 0); const boardM = M(0xffffff, 0.3, 0, 0, 0, low ? 1 : 0.6); for (const z of [-4, 4]) B(16.2, 0.45, 0.15, boardM, 0, 1.38, z); for (const x of [-8, 8]) B(0.15, 0.45, 8.15, boardM, x, 1.38, 0);
    for (const x of [-6.8, 6.8]) B(0.15, 1, 1.4, M(0xff3030, 0.5), x, 1.6, 0); }
  // 4) roof: the hypar saddle, laid around the turn by progress (+ cable net lines on full gfx)
  const rf = complete ? 1 : stage(3);
  if (rf > 0) { add(roofGeo(Math.min(1, rf), seg), roofM).name = "saddle-roof";
    if (!low && rf >= 1) { // the hypar's two straight-line cable families
      const pts: number[] = []; const at = (xn: number, zn: number) => { const rr = Math.hypot(xn, zn); return rr > 0.98 ? null : [DOME.a * xn, rimY(Math.atan2(zn, xn), rr) + 0.5, DOME.b * zn]; };
      for (let k = -4; k <= 4; k++) for (const dir of [0, 1]) for (let i = 0; i < 12; i++) { const u0 = -1 + i / 6, u1 = u0 + 1 / 6, v = k / 5;
        const p0 = dir ? at(u0, v) : at(v, u0), p1 = dir ? at(u1, v) : at(v, u1); if (p0 && p1) pts.push(...p0, ...p1); }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x8f8a80 }))); } }
  if (complete) { // concrete ring with glass entrance bays at the 4 compass points, marquee, light masts
    const gap = 0.32; const bays = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    for (let i = 0; i < 4; i++) { const c0 = bays[i]! + gap / 2, c1 = bays[(i + 1) % 4]! + (i === 3 ? Math.PI * 2 : 0) - gap / 2; add(bandGeo(c0, c1, seg, 1, 0, 0.2), concrete); }
    for (const c of bays) { add(bandGeo(c - gap / 2, c + gap / 2, seg, 1, 0, 0.2), glass); add(bandGeo(c - gap / 2, c + gap / 2, seg, 1.06, 4.2, 0, 4.6), steel); }
    add(bandGeo(0, Math.PI * 2, seg, 1.005, rimY(Math.PI / 2) - 3.4, 0, rimY(Math.PI / 2) - 2.8), glass); // clerestory glass band
    const t = marquee(); const mq = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), t ? new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.5 }) : lamp);
    if ((mq.material as THREE.MeshStandardMaterial).emissiveIntensity) (mq.material as THREE.MeshStandardMaterial).userData.ei = 1.4;
    mq.position.set(0, 5.6, DOME.b + 0.9); g.add(mq); B(9.4, 2.1, 0.3, steel, 0, 5.6, DOME.b + 0.7); B(0.3, 5, 0.3, steel, -4.4, 2.5, DOME.b + 0.8); B(0.3, 5, 0.3, steel, 4.4, 2.5, DOME.b + 0.8);
    B(4, 2.4, 2.4, M(0x111111, 0.4, 0, 0x3a7bff, 1.2), 0, 9, 0); // centre-hung scoreboard
    for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]] as const) { C(0.3, 14, steel, x, 7, z); B(1.6, 0.6, 1.6, lamp, x, 14.2, z); }
    const halo = M(0xffd27a, 1, 0, 0xffc860, 0.9); for (const c of bays) { const [x, z] = P(c, 1.08); B(0.5, 0.25, 0.5, halo, x, 4.9, z); } // entrance downlights
  }
  return g;
}

/** Night factor 0..1 for the stadium's own glows (the city scales its glows once at boot, before this model loads). */
const nightK = () => { try { return skyNow(new Date(), parseTod(new URLSearchParams(location.search).get('tod'))).lights; } catch { return 0; } };
const applyNight = (g: THREE.Object3D, k: number) => g.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
  if (m?.isMeshStandardMaterial && m.userData.ei != null) m.emissiveIntensity = (m.userData.ei as number) * (0.1 + 0.9 * k); });

export function createStadium(w: World) {
  const root = new THREE.Group(); root.name = 'coop-stadium'; root.position.set(STADIUM_SITE.x, 0, STADIUM_SITE.z); w.scene.add(root);
  const low = detectWorldTier() === 'low'; let model: THREE.Group | null = null; let key = ''; let dead = false; let label: THREE.Sprite | null = null;
  const bar = document.createElement('canvas'); bar.width = 512; bar.height = 64; const barTex = new THREE.CanvasTexture(bar); barTex.colorSpace = THREE.SRGBColorSpace;
  const barSp = new THREE.Sprite(new THREE.SpriteMaterial({ map: barTex, depthTest: false, transparent: true, sizeAttenuation: false })); barSp.scale.set(0.16, 0.02, 1); barSp.center.set(0.5, 1); barSp.renderOrder = 11; barSp.position.y = 26; root.add(barSp);
  const drawBar = (p: number) => { const c = bar.getContext('2d')!; c.clearRect(0, 0, 512, 64); c.fillStyle = 'rgba(10,8,22,0.85)'; c.beginPath(); c.roundRect(2, 2, 508, 60, 30); c.fill();
    c.fillStyle = '#f59e0b'; c.beginPath(); c.roundRect(8, 8, Math.max(0, 496 * Math.min(1, p)), 48, 24); c.fill();
    c.fillStyle = '#fff'; c.font = '800 34px Outfit Variable, system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(`${(p * 100).toFixed(p > 0 && p < 0.1 ? 1 : 0)}%`, 256, 45); barTex.needsUpdate = true; };
  const setLabel = (text: string, sub: string) => { if (label) { root.remove(label); (label.material as THREE.SpriteMaterial).map?.dispose(); label.material.dispose(); }
    const t = cityLabel(text, '#ffd27a', sub); const d = t.userData as { w: number; h: number };
    label = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, premultipliedAlpha: true, toneMapped: false, sizeAttenuation: false })); label.scale.set(0.09 * d.w, 0.0225 * d.h, 1); label.center.set(0.5, 0); label.renderOrder = 11; label.position.y = 26; root.add(label); };
  const apply = (s: Summary) => {
    const done = s.state === 'complete' ? 4 : s.state === 'active' ? s.stage : 0; const frac = s.state === 'active' ? Math.max(0, Math.min(1, s.pct * 4 - done)) : 0;
    const k = `${done}|${Math.round(frac * 20)}`; if (k !== key) { key = k; if (model) root.remove(model); model = buildStadium(done, frac, low); root.add(model); }
    if (model) applyNight(model, nightK());
    const stageName = ['Foundation', 'Steel frame', 'Stands', 'Roof'][Math.min(3, done)];
    setLabel(`${s.icon} ${s.state === 'complete' ? 'Chud Hub Arena' : 'Hockey Stadium'}`, s.state === 'complete' ? 'Live hockey · open to spectators' : `🚧 ${stageName} · co-op build`);
    barSp.visible = s.state !== 'complete'; drawBar(s.pct);
  };
  const load = () => { void fetch('/api/coop').then((r) => r.json()).then((j: { projects?: Summary[] }) => { const s = j?.projects?.find((p) => p.id === 'stadium'); if (!dead && s) apply(s); }).catch(() => {}); };
  apply({ id: 'stadium', name: 'Hockey Stadium', icon: '🏟️', state: 'active', stage: 0, pct: 0 }); load();
  const poll = window.setInterval(load, 30_000);
  return { refresh: load, dispose() { dead = true; window.clearInterval(poll); w.scene.remove(root); barTex.dispose(); } };
}

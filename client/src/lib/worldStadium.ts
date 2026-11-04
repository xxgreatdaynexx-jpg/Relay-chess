/**
 * Co-op Hockey Stadium on the city map (mu-coop-econ). The outskirts site (STADIUM_SITE) builds up with the server
 * project: 0% fenced dirt site + crane, 25% foundation, 50% steel frame, 75% stands, 100% the finished arena (seating,
 * rink, glass roof, scoreboard). The stage in progress is drawn partially by its own %. A floating label + progress bar
 * shows the overall %, polled from GET /api/coop.
 */
import * as THREE from 'three';
import type { World } from './world3d';
import { cityLabel } from './labelSprite';
import { STADIUM_SITE } from '../../../shared/coop';

type Summary = { id: string; name: string; icon: string; state: string; stage: number; pct: number };
const mats = new Map<string, THREE.MeshStandardMaterial>();
const M = (color: number, rough = 0.8, metal = 0, emissive = 0, ei = 0, opacity = 1) => {
  const k = `${color}|${rough}|${metal}|${emissive}|${ei}|${opacity}`; let m = mats.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei, transparent: opacity < 1, opacity }); mats.set(k, m); } return m;
};
const BOXG = new THREE.BoxGeometry(1, 1, 1); const CYLG = new THREE.CylinderGeometry(1, 1, 1, 16);

/** Build the stadium model for `done` finished stages (0..4) and `frac` of the next one (0..1). Exported for tests. */
export function buildStadium(done: number, frac: number): THREE.Group {
  const g = new THREE.Group(); g.name = `stadium-${done}`;
  const B = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) => { const o = new THREE.Mesh(BOXG, m); o.scale.set(w, h, d); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = true; g.add(o); return o; };
  const C = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(CYLG, m); o.scale.set(r, h, r); o.position.set(x, y, z); g.add(o); return o; };
  const W = STADIUM_SITE.w, D = STADIUM_SITE.d; const stage = (i: number) => (done > i ? 1 : done === i ? frac : 0);
  const concrete = M(0xa8a49c, 0.95), steel = M(0x5f6f7f, 0.4, 0.7), dirt = M(0x7a5a3a, 1), seatA = M(0xd03030, 0.6), seatB = M(0x2a5bd0, 0.6), ice = M(0xeaf6ff, 0.15, 0, 0xbfe6ff, 0.25), glass = M(0x9fd6e8, 0.1, 0.3, 0x2a4a5a, 0.2, 0.45);
  const complete = done >= 4;
  if (!complete) {
    B(W + 4, 0.2, D + 4, dirt, 0, 0.1, 0); // site pad
    for (const [w, d, x, z] of [[W + 4, 0.1, 0, -(D + 4) / 2], [W + 4, 0.1, 0, (D + 4) / 2], [0.1, D + 4, -(W + 4) / 2, 0], [0.1, D + 4, (W + 4) / 2, 0]] as const) B(w, 1.4, d, M(0xf59e0b, 0.6), x, 0.8, z); // hoarding
    // tower crane
    const cx = W / 2 - 2, cz = -D / 2 + 2; B(0.8, 22, 0.8, M(0xf5c518, 0.5, 0.3), cx, 11, cz); B(26, 0.6, 0.6, M(0xf5c518, 0.5, 0.3), cx - 9, 22, cz); B(2, 1.4, 1.4, concrete, cx + 3.5, 21.6, cz);
    C(0.05, 6, steel, cx - 16, 19, cz); B(1.4, 0.6, 1.4, steel, cx - 16, 15.8, cz);
  }
  // 1) foundation: slab poured in strips by progress
  const f = stage(0); if (f > 0) { const n = Math.max(1, Math.round(f * 8)); for (let i = 0; i < n; i++) B(W / 8, 0.8, D, concrete, -W / 2 + W / 16 + (i * W) / 8, 0.6, 0); }
  // 2) steel frame: perimeter columns + ring beam
  const fr = stage(1); const cols: Array<[number, number]> = [];
  for (let i = 0; i <= 8; i++) { const x = -W / 2 + (i * W) / 8; cols.push([x, -D / 2], [x, D / 2]); } for (let j = 1; j < 6; j++) { const z = -D / 2 + (j * D) / 6; cols.push([-W / 2, z], [W / 2, z]); }
  if (fr > 0) { const n = Math.round(fr * cols.length); cols.slice(0, n).forEach(([x, z]) => B(0.7, 12, 0.7, steel, x, 7, z));
    if (fr >= 0.6) { B(W, 0.6, 0.6, steel, 0, 12.8, -D / 2); B(W, 0.6, 0.6, steel, 0, 12.8, D / 2); B(0.6, 0.6, D, steel, -W / 2, 12.8, 0); B(0.6, 0.6, D, steel, W / 2, 12.8, 0); } }
  // 3) stands: stepped seating tiers on all four sides around the rink
  const st = stage(2); const rw = 16, rd = 8;
  if (st > 0 || complete) {
    const tiers = complete ? 6 : Math.max(1, Math.round(st * 6));
    for (let t = 0; t < tiers; t++) { const y = 1.2 + t * 1.1, inset = t * 1.3, s = t % 2 ? seatA : seatB;
      B(rw + 4 + inset * 2, 1, 1.2, s, 0, y, -(rd / 2 + 2 + inset)); B(rw + 4 + inset * 2, 1, 1.2, s, 0, y, rd / 2 + 2 + inset);
      B(1.2, 1, rd + 4 + inset * 2, s, -(rw / 2 + 2 + inset), y, 0); B(1.2, 1, rd + 4 + inset * 2, s, rw / 2 + 2 + inset, y, 0); }
    B(rw, 0.15, rd, ice, 0, 1.08, 0); B(rw + 0.6, 0.9, 0.2, M(0xffffff, 0.3, 0, 0, 0, 0.6), 0, 1.5, -rd / 2); B(rw + 0.6, 0.9, 0.2, M(0xffffff, 0.3, 0, 0, 0, 0.6), 0, 1.5, rd / 2);
    for (const x of [-rw / 2 + 1.2, rw / 2 - 1.2]) B(0.15, 1, 1.4, M(0xff3030, 0.5), x, 1.6, 0); // goals
  }
  // 4) roof: arched glass + steel trusses
  const rf = complete ? 1 : stage(3);
  if (rf > 0) { const n = Math.max(1, Math.round(rf * 9));
    for (let i = 0; i < n; i++) { const x = -W / 2 + (i * W) / 8; const arch = new THREE.Mesh(new THREE.TorusGeometry(D / 2, 0.35, 6, 20, Math.PI), steel); arch.rotation.y = Math.PI / 2; arch.position.set(x, 13, 0); arch.scale.y = 0.45; g.add(arch); }
    if (rf >= 0.5) { const cover = new THREE.Mesh(new THREE.CylinderGeometry(D / 2, D / 2, W * Math.min(1, rf), 24, 1, true, 0, Math.PI), glass); cover.rotation.z = Math.PI / 2; cover.rotation.x = -Math.PI / 2; cover.scale.set(1, 1, 0.45); cover.position.set(-W / 2 + (W * Math.min(1, rf)) / 2, 13, 0); g.add(cover); } }
  if (complete) { // finished arena: outer walls with a glass band, entrance canopy, scoreboard, lights
    const wall = M(0xdfe3e8, 0.6, 0.2); B(W, 9, 0.6, wall, 0, 5, -D / 2); B(0.6, 9, D, wall, -W / 2, 5, 0); B(0.6, 9, D, wall, W / 2, 5, 0);
    B(W * 0.36, 9, 0.6, wall, -W * 0.32, 5, D / 2); B(W * 0.36, 9, 0.6, wall, W * 0.32, 5, D / 2); B(W, 2.4, 0.7, glass, 0, 10.6, D / 2); B(W * 0.28, 4, 0.5, glass, 0, 2.5, D / 2);
    B(W * 0.34, 0.4, 4, steel, 0, 5.2, D / 2 + 2); B(4, 2.4, 2.4, M(0x111111, 0.4, 0, 0x3a7bff, 1.2), 0, 11.5, 0); // canopy + centre-hung scoreboard
    for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]] as const) { C(0.3, 16, steel, x, 8, z); B(1.6, 0.6, 1.6, M(0xfff7d6, 0.3, 0, 0xffe9a8, 2), x, 16.2, z); }
  }
  return g;
}

export function createStadium(w: World) {
  const root = new THREE.Group(); root.name = 'coop-stadium'; root.position.set(STADIUM_SITE.x, 0, STADIUM_SITE.z); w.scene.add(root);
  let model: THREE.Group | null = null; let key = ''; let dead = false; let label: THREE.Sprite | null = null;
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
    const k = `${done}|${Math.round(frac * 20)}`; if (k !== key) { key = k; if (model) root.remove(model); model = buildStadium(done, frac); root.add(model); }
    const stageName = ['Foundation', 'Steel frame', 'Stands', 'Roof'][Math.min(3, done)];
    setLabel(`${s.icon} ${s.state === 'complete' ? 'Chud Hub Arena' : 'Hockey Stadium'}`, s.state === 'complete' ? 'Live hockey · open to spectators' : `🚧 ${stageName} · co-op build`);
    barSp.visible = s.state !== 'complete'; drawBar(s.pct);
  };
  const load = () => { void fetch('/api/coop').then((r) => r.json()).then((j: { projects?: Summary[] }) => { const s = j?.projects?.find((p) => p.id === 'stadium'); if (!dead && s) apply(s); }).catch(() => {}); };
  apply({ id: 'stadium', name: 'Hockey Stadium', icon: '🏟️', state: 'active', stage: 0, pct: 0 }); load();
  const poll = window.setInterval(load, 30_000);
  return { refresh: load, dispose() { dead = true; window.clearInterval(poll); w.scene.remove(root); barTex.dispose(); } };
}

/** Mines: three.js cave scene (lazy-loaded). Map coords are (x, y) on the floor and z up; three.js is y-up, so (x, z, y). */
import { detectWorldTier } from './worldTier';
import * as THREE from 'three';
import { addDepthProps, depthLook } from './mineDepthLook';
import { cityLabel, fitLabel } from './labelSprite';
import { applyPickSkin, skinnedPickaxe } from './pickaxeModel';
import { buildMineTool, animateMineTool, skinMineTool } from './mineToolModels';
import type { MineToolId } from '../../../shared/mineTools';
import { animateMiner, buildMiner, setMinerSkin, setMinerTool, type MinerRig } from './minerAvatar';
import { MINE_EXIT, ORES, type CaveId, type MineNode } from '../../../shared/mines';
import { levelOf, hasFloors, LADDER, MAX_FLOOR } from '../../../shared/mineFloors';
import { MOBS, mobSkin, type MobKind, type MobModel } from '../../../shared/mineCombat';
import { animateWeaponModel, buildWeaponModel } from './mineWeaponModels';

/** st = AI state code (shared/mineAI ST_CODE), tw = attack telegraph, ph = boss phase. */
export interface MobTel { k: string; x: number; y: number; r: number; dx: number; dy: number; ms: number; n?: string }
export interface MobView { id: number; k: MobKind; x: number; y: number; a: number; hp: number; max: number; st?: number; mini?: number; ph?: number; tw?: MobTel; /** co-op raid: party size this creature was scaled for */ pt?: number }
export interface ShotView { id: number; x: number; y: number; by: number }
export interface MobFxView { k: 'aoe' | 'phase' | 'split' | 'summon'; x: number; y: number; r?: number; phase?: number; name?: string; by: number }
interface MobRig { root: THREE.Group; body: THREE.Object3D; wings?: THREE.Object3D[]; anim?: THREE.Object3D[]; model: MobModel; scale: number; bar: THREE.Sprite; barBg: THREE.Sprite; barEdge: THREE.Sprite; hurt: number; kind: MobKind; hp: number; max: number; t: number;
  /** server target pose (we glide to it), movement speed for walk cycles, AI state, wind-up/attack timers, death dissolve */
  tx: number; ty: number; ta: number; mv: number; st: number; wind: number; atk: number; dying: number; mini: boolean; ph: number; glow: number; marker: THREE.Mesh; mats: THREE.MeshStandardMaterial[]; base: number }
/** Glow creatures (fire / crystal / ghost): stronger emissive + additive halo. */
const GLOW_MODELS = new Set<MobModel>(['imp', 'elemental', 'wraith', 'gaswraith', 'jelly']);
const glowy = (model: MobModel, cave: CaveId) => GLOW_MODELS.has(model) || (cave === 'magma' && (model === 'golem' || model === 'slug'));
const MG = new Map<string, THREE.BufferGeometry>();
const mg = <T extends THREE.BufferGeometry>(k: string, f: () => T): T => { let g = MG.get(k); if (!g) { g = f(); MG.set(k, g); } return g as T; };
/** Bat wing: scalloped membrane spanning from the body outwards (+z), finger bones along the leading edge. */
const batWingG = () => mg('batwing', () => { const s = new THREE.Shape(); s.moveTo(0, 0.08); s.lineTo(0.55, 0.12); s.quadraticCurveTo(0.42, -0.02, 0.5, -0.16); s.quadraticCurveTo(0.33, -0.08, 0.3, -0.2); s.quadraticCurveTo(0.18, -0.1, 0.1, -0.18); s.lineTo(0, -0.08); s.closePath(); const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); g.rotateY(Math.PI / 2); return g; });
const GLINT = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const HALO = new Map<string, THREE.SpriteMaterial>();
let haloTex: THREE.Texture | null = null;
/** Soft radial glow sprite (one shared canvas texture, one material per colour). */
function haloMat(color: string): THREE.SpriteMaterial {
  let m = HALO.get(color); if (m) return m;
  if (!haloTex) { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!; const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.4, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); haloTex = new THREE.CanvasTexture(c); }
  m = new THREE.SpriteMaterial({ map: haloTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }); HALO.set(color, m); return m;
}
/** Nov 4: rig + colours come from the mine's skin for this stat tier (shared/mineCombat.ts MOB_SKINS). */
function buildMob(kind: MobKind, cave: CaveId = 'mine', low = false): MobRig {
  const sk = mobSkin(cave, kind); const model = sk.model; const root = new THREE.Group(); const col = new THREE.Color(sk.color); const accC = new THREE.Color(sk.accent);
  const glassy = model === 'blob' || model === 'wraith' || model === 'gaswraith' || model === 'jelly' || model === 'elemental';
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: model === 'blob' || model === 'slug' || model === 'eel' ? 0.15 : 0.6, metalness: model === 'crab' || model === 'drillbot' ? 0.35 : 0, emissive: model === 'golem' || model === 'wraith' || model === 'gaswraith' || model === 'elemental' || model === 'jelly' ? col : '#000', emissiveIntensity: model === 'wraith' || model === 'gaswraith' ? 0.6 : 0.35, transparent: glassy, opacity: model === 'wraith' || model === 'gaswraith' ? 0.75 : model === 'jelly' ? 0.55 : model === 'elemental' ? 0.85 : model === 'blob' ? 0.82 : 1, flatShading: model === 'golem' || model === 'crab' || model === 'elemental' || model === 'yeti' || model === 'drillbot' });
  const acc = new THREE.MeshStandardMaterial({ color: accC, emissive: accC, emissiveIntensity: 0.55, roughness: 0.4 }); let anim: THREE.Object3D[] | undefined;
  const dark = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.45), roughness: 0.8, emissive: '#000' });
  const eyeMat = new THREE.MeshBasicMaterial({ color: model === 'wraith' || model === 'elemental' ? '#ffffff' : model === 'golem' ? sk.accent : model === 'gaswraith' ? '#f0ff60' : '#ff3030' });
  const body = new THREE.Group(); let wings: THREE.Object3D[] | undefined;
  const M = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, p?: THREE.Object3D) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); (p ?? body).add(o); return o; };
  const pupil = new THREE.MeshBasicMaterial({ color: model === 'wraith' || model === 'gaswraith' || model === 'elemental' ? sk.accent : '#100808' });
  const eyes = (z: number, y: number, sp: number, r = 0.06) => { for (const s of [-1, 1]) { const e = M(mg('eye' + r, () => new THREE.SphereGeometry(r, 10, 8)), eyeMat, z, y, s * sp);
    const pu = new THREE.Mesh(mg('pupil' + r, () => new THREE.SphereGeometry(r * 0.5, 8, 6)), pupil); pu.position.set(r * 0.62, 0, 0); e.add(pu);
    const gl = new THREE.Mesh(mg('glint' + r, () => new THREE.SphereGeometry(r * 0.2, 6, 4)), GLINT); gl.position.set(r * 0.8, r * 0.35, -s * r * 0.25); e.add(gl);
    const lid = new THREE.Mesh(mg('lid' + r, () => new THREE.BoxGeometry(r * 1.6, r * 0.45, r * 2.4)), dark); lid.position.set(r * 0.3, r * 0.85, 0); lid.rotation.x = s * 0.35; e.add(lid); } };
  if (model === 'blob') {
    const b = M(mg('slime', () => { const g = new THREE.SphereGeometry(0.45, 20, 14); const p = g.attributes.position as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < -0.1) p.setY(i, -0.1 - (y + 0.1) * 0.25); p.setX(i, p.getX(i) * (1 + Math.max(0, -y) * 0.5)); p.setZ(i, p.getZ(i) * (1 + Math.max(0, -y) * 0.5)); } g.computeVertexNormals(); return g; }), mat, 0, 0.36, 0); b.scale.set(1, 0.78, 1);
    const core = M(mg('core', () => new THREE.IcosahedronGeometry(0.15, 0)), new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.5), emissive: col, emissiveIntensity: 0.5, flatShading: true }), -0.05, 0.3, 0); core.rotation.set(0.5, 0.3, 0);
    for (let i = 0; i < 4; i++) M(mg('drip', () => new THREE.SphereGeometry(0.07, 8, 6)), mat, Math.cos(i * 1.7) * 0.42, 0.04, Math.sin(i * 1.7) * 0.42).scale.set(1.4, 0.45, 1.4);
    M(mg('shine', () => new THREE.SphereGeometry(0.08, 8, 6)), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }), 0.15, 0.58, -0.16).scale.set(1, 0.5, 1.6);
    eyes(0.36, 0.45, 0.14); const mouth = M(mg('mouth', () => new THREE.TorusGeometry(0.08, 0.018, 6, 12, Math.PI)), new THREE.MeshBasicMaterial({ color: '#103010' }), 0.4, 0.34, 0); mouth.rotation.set(0, Math.PI / 2, Math.PI);
  } else if (model === 'bat') {
    const b = M(mg('batb', () => new THREE.SphereGeometry(0.2, 12, 10)), mat, 0, 0, 0); b.scale.set(1.15, 1, 0.9);
    const head = M(mg('bath', () => new THREE.SphereGeometry(0.13, 12, 10)), mat, 0.2, 0.08, 0);
    for (const s of [-1, 1]) { const e = M(mg('ear', () => new THREE.ConeGeometry(0.05, 0.16, 6)), mat, 0.18, 0.24, s * 0.07); e.rotation.x = s * 0.3;
      const f = M(mg('fang', () => new THREE.ConeGeometry(0.012, 0.05, 4)), new THREE.MeshBasicMaterial({ color: '#f4f0e0' }), 0.31, 0.0, s * 0.03); f.rotation.z = Math.PI; }
    void head; eyes(0.31, 0.11, 0.05, 0.03);
    const memb = new THREE.MeshStandardMaterial({ color: '#2a2030', side: THREE.DoubleSide, roughness: 0.9, emissive: '#000' }); const bone = new THREE.MeshStandardMaterial({ color: '#1a1420', emissive: '#000' });
    wings = [-1, 1].map((s) => { const w = new THREE.Group(); w.position.set(0, 0.04, s * 0.12); const m = new THREE.Mesh(batWingG(), memb); m.scale.z = s; w.add(m);
      const bn = new THREE.Mesh(mg('bone', () => new THREE.CylinderGeometry(0.012, 0.012, 0.55, 5)), bone); bn.rotation.x = Math.PI / 2; bn.position.set(0.1, 0.01, s * 0.27); w.add(bn); body.add(w); return w; });
    for (const s of [-1, 1]) M(mg('batleg', () => new THREE.CylinderGeometry(0.01, 0.01, 0.14, 4)), bone, -0.12, -0.2, s * 0.05);
    body.position.y = MOBS.bat.z;
  } else if (model === 'crab') {
    const shell = M(mg('crabshell', () => { const g = new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(0.9, 0.55, 1.05); return g; }), mat, 0, 0.3, 0);
    for (let i = 0; i < 5; i++) { const k = M(mg('knob', () => new THREE.DodecahedronGeometry(0.09, 0)), dark, -0.25 + (i % 3) * 0.2, 0.52 + (i % 2) * 0.03, (i - 2) * 0.16); k.rotation.y = i; void shell; }
    M(mg('belly', () => new THREE.CylinderGeometry(0.42, 0.36, 0.14, 12)), dark, 0, 0.26, 0).scale.set(1, 1, 1.15);
    for (const s of [-1, 1]) { const st = M(mg('stalk', () => new THREE.CylinderGeometry(0.025, 0.025, 0.22, 5)), dark, 0.36, 0.5, s * 0.12); st.rotation.z = -0.3; }
    eyes(0.42, 0.62, 0.12, 0.05);
    for (const s of [-1, 1]) {
      const arm = M(mg('carm', () => new THREE.CylinderGeometry(0.06, 0.07, 0.36, 6)), mat, 0.46, 0.32, s * 0.4); arm.rotation.set(s * 0.6, 0, -1.2);
      const claw = M(mg('claw', () => { const g = new THREE.SphereGeometry(0.17, 10, 8); g.scale(1.4, 0.75, 0.8); return g; }), mat, 0.72, 0.36, s * 0.5);
      const pin = M(mg('pin', () => new THREE.ConeGeometry(0.06, 0.26, 6)), dark, 0.92, 0.42, s * 0.5); pin.rotation.z = -Math.PI / 2 - 0.3; void claw;
      for (let i = 0; i < 3; i++) { const up = M(mg('legu', () => new THREE.CylinderGeometry(0.035, 0.03, 0.3, 5)), mat, -0.25 + i * 0.22, 0.3, s * 0.5); up.rotation.x = s * 1.0;
        const lo = M(mg('legl', () => new THREE.ConeGeometry(0.03, 0.34, 5)), dark, -0.25 + i * 0.22, 0.12, s * 0.68); lo.rotation.x = Math.PI - s * 0.35; }
    }
  } else if (model === 'golem') {
    const lava = new THREE.MeshBasicMaterial({ color: sk.accent });
    const rock = (k: string, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => { const o = M(mg('gr' + k, () => new THREE.DodecahedronGeometry(r, 0)), mat, x, y, z); o.scale.set(sx, sy, sz); o.rotation.set(x * 3, y * 2, z * 5); return o; };
    rock('t', 0.55, 0, 1.15, 0, 1, 1.05, 1.15); M(mg('gcore', () => new THREE.SphereGeometry(0.24, 10, 8)), lava, 0.36, 1.2, 0).scale.set(0.5, 1, 1);
    for (let i = 0; i < 4; i++) M(mg('crack', () => new THREE.BoxGeometry(0.02, 0.32, 0.05)), lava, 0.5, 0.95 + i * 0.14, -0.3 + i * 0.2).rotation.x = 0.5 * (i - 1.5);
    rock('h', 0.3, 0.05, 1.85, 0, 1, 0.9, 1); rock('s1', 0.26, 0, 1.55, 0.55); rock('s2', 0.26, 0, 1.55, -0.55);
    for (const s of [-1, 1]) { rock('a' + s, 0.2, 0.05, 1.15, s * 0.74, 1, 1.6, 1); rock('f' + s, 0.24, 0.12, 0.7, s * 0.78); rock('l' + s, 0.22, 0, 0.4, s * 0.27, 1, 1.6, 1); rock('k' + s, 0.2, 0.06, 0.12, s * 0.27, 1.3, 0.6, 1); }
    for (const s of [-1, 1]) M(mg('eyeg', () => new THREE.SphereGeometry(0.06, 8, 6)), eyeMat, 0.3, 1.88, s * 0.12);
  } else if (model === 'wolf') {
    M(mg('wolfb', () => { const g = new THREE.SphereGeometry(0.32, 10, 8); g.scale(1.6, 0.9, 0.85); return g; }), mat, 0, 0.62, 0);
    M(mg('wolfh', () => new THREE.SphereGeometry(0.2, 10, 8)), mat, 0.55, 0.82, 0); const sn = M(mg('wolfsn', () => new THREE.ConeGeometry(0.1, 0.28, 8)), dark, 0.78, 0.76, 0); sn.rotation.z = -Math.PI / 2;
    for (const s of [-1, 1]) { const e = M(mg('wolfear', () => new THREE.ConeGeometry(0.06, 0.16, 5)), mat, 0.5, 1.02, s * 0.1); e.rotation.x = s * 0.2; }
    eyes(0.7, 0.88, 0.08, 0.035); const ruff = M(mg('ruff', () => new THREE.IcosahedronGeometry(0.26, 0)), acc, 0.32, 0.7, 0); ruff.scale.set(0.8, 1, 1.1);
    anim = []; for (const [x, z] of [[0.32, 0.16], [0.32, -0.16], [-0.32, 0.16], [-0.32, -0.16]] as const) { const l = M(mg('wolfleg', () => new THREE.CylinderGeometry(0.05, 0.04, 0.42, 5)), dark, x, 0.24, z); anim.push(l); }
    const tail = M(mg('wolftail', () => new THREE.ConeGeometry(0.07, 0.4, 6)), mat, -0.6, 0.7, 0); tail.rotation.z = 1.1;
  } else if (model === 'elemental') {
    M(mg('elcore', () => new THREE.IcosahedronGeometry(0.22, 0)), new THREE.MeshBasicMaterial({ color: sk.accent }), 0, 1.2, 0);
    anim = []; for (let i = 0; i < 7; i++) { const sh = M(mg('elshard', () => { const g = new THREE.OctahedronGeometry(0.18, 0); g.scale(0.6, 1.8, 0.6); return g; }), mat, Math.cos(i * 0.9) * 0.42, 1.2 + Math.sin(i * 1.7) * 0.35, Math.sin(i * 0.9) * 0.42); sh.rotation.set(i, i * 0.7, Math.cos(i) * 0.6); anim.push(sh); }
    eyes(0.24, 1.3, 0.08, 0.04);
  } else if (model === 'yeti') {
    M(mg('yetib', () => { const g = new THREE.IcosahedronGeometry(0.55, 1); g.scale(0.9, 1.15, 1); return g; }), mat, 0, 1.0, 0);
    M(mg('yetih', () => new THREE.IcosahedronGeometry(0.3, 1)), mat, 0.12, 1.75, 0); M(mg('yetif', () => { const g = new THREE.SphereGeometry(0.2, 10, 8); g.scale(0.5, 0.9, 1); return g; }), acc, 0.32, 1.72, 0);
    eyes(0.4, 1.8, 0.08, 0.045); for (const s of [-1, 1]) { const h = M(mg('yetihorn', () => new THREE.ConeGeometry(0.05, 0.25, 6)), dark, 0.05, 2.02, s * 0.18); h.rotation.x = s * 0.6; }
    anim = []; for (const s of [-1, 1]) { const a = M(mg('yetiarm', () => new THREE.CylinderGeometry(0.13, 0.16, 0.95, 7)), mat, 0.05, 1.0, s * 0.62); a.rotation.x = s * 0.15; anim.push(a); M(mg('yetileg', () => new THREE.CylinderGeometry(0.16, 0.18, 0.5, 7)), mat, 0, 0.25, s * 0.26); }
  } else if (model === 'slug') {
    const b = M(mg('slugb', () => { const g = new THREE.SphereGeometry(0.3, 14, 8); g.scale(2.1, 0.75, 1); return g; }), mat, 0, 0.24, 0); anim = [b];
    for (let i = 0; i < 6; i++) M(mg('slugspot', () => new THREE.SphereGeometry(0.06, 6, 4)), acc, -0.4 + i * 0.15, 0.44, (i % 2 ? 1 : -1) * 0.1);
    for (const s of [-1, 1]) { const st = M(mg('slugstalk', () => new THREE.CylinderGeometry(0.02, 0.025, 0.3, 5)), mat, 0.55, 0.5, s * 0.08); st.rotation.x = s * 0.25; M(mg('eye0.04', () => new THREE.SphereGeometry(0.04, 8, 6)), eyeMat, 0.57, 0.66, s * 0.12); }
  } else if (model === 'imp') {
    M(mg('impb', () => { const g = new THREE.SphereGeometry(0.2, 10, 8); g.scale(0.9, 1.2, 0.9); return g; }), mat, 0, 0, 0); M(mg('imph', () => new THREE.SphereGeometry(0.15, 10, 8)), mat, 0.05, 0.3, 0);
    for (const s of [-1, 1]) { const h = M(mg('imphorn', () => new THREE.ConeGeometry(0.035, 0.16, 5)), acc, 0.02, 0.48, s * 0.08); h.rotation.x = s * 0.4; }
    eyes(0.17, 0.33, 0.06, 0.03); const t = M(mg('imptail', () => new THREE.ConeGeometry(0.03, 0.4, 5)), mat, -0.2, -0.15, 0); t.rotation.z = 2.2;
    const memb = new THREE.MeshStandardMaterial({ color: sk.accent, side: THREE.DoubleSide, roughness: 0.8, emissive: sk.accent, emissiveIntensity: 0.3 });
    wings = [-1, 1].map((s) => { const w = new THREE.Group(); w.position.set(-0.05, 0.12, s * 0.12); const m = new THREE.Mesh(batWingG(), memb); m.scale.set(0.8, 0.8, s * 0.8); w.add(m); body.add(w); return w; });
    M(mg('impfire', () => new THREE.SphereGeometry(0.08, 6, 4)), new THREE.MeshBasicMaterial({ color: '#ffd040' }), 0.22, -0.02, 0.18);
    body.position.y = MOBS.bat.z;
  } else if (model === 'jelly') {
    M(mg('jbell', () => new THREE.SphereGeometry(0.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), mat, 0, 1.4, 0);
    M(mg('jcore', () => new THREE.SphereGeometry(0.16, 8, 6)), acc, 0, 1.5, 0); eyes(0.34, 1.58, 0.13, 0.045);
    M(mg('jrim', () => new THREE.TorusGeometry(0.4, 0.035, 6, 24)), acc, 0, 1.4, 0).rotation.x = Math.PI / 2;
    anim = []; for (let i = 0; i < 8; i++) { const t = M(mg('jtent', () => new THREE.CylinderGeometry(0.015, 0.006, 0.9, 4)), mat, Math.cos(i * 0.785) * 0.28, 0.95, Math.sin(i * 0.785) * 0.28); anim.push(t); }
  } else if (model === 'eel') {
    anim = []; for (let i = 0; i < 7; i++) { const r = 0.16 - i * 0.017; const seg = M(mg('eel' + i, () => new THREE.SphereGeometry(r, 10, 6)), i % 2 ? acc : mat, 0.4 - i * 0.2, 1.0, 0); seg.scale.set(1.4, 1, 1); anim.push(seg); }
    eyes(0.55, 1.05, 0.08, 0.035); const fin = M(mg('eelfin', () => new THREE.ConeGeometry(0.06, 0.5, 4)), acc, -0.2, 1.17, 0); fin.rotation.z = Math.PI / 2;
  } else if (model === 'kraken') {
    M(mg('krhead', () => { const g = new THREE.SphereGeometry(0.55, 14, 10); g.scale(1, 1.35, 1); return g; }), mat, -0.1, 1.35, 0);
    eyes(0.45, 1.25, 0.24, 0.09); M(mg('krbeak', () => new THREE.ConeGeometry(0.08, 0.2, 6)), dark, 0.5, 0.95, 0).rotation.z = -Math.PI / 2;
    anim = []; for (let i = 0; i < 8; i++) { const a = i * 0.785; const g = new THREE.Group(); g.position.set(Math.cos(a) * 0.35, 0.8, Math.sin(a) * 0.35); g.rotation.y = -a; body.add(g);
      for (let j = 0; j < 4; j++) { const c = new THREE.Mesh(mg('krseg' + j, () => new THREE.SphereGeometry(0.12 - j * 0.022, 8, 6)), j % 2 ? acc : mat); c.position.set(0.18 * (j + 1), -0.16 * j, 0); g.add(c); } anim.push(g); }
  } else if (model === 'drillbot') {
    M(mg('dbbody', () => new THREE.BoxGeometry(0.7, 0.45, 0.55)), mat, 0, 0.5, 0); M(mg('dbcab', () => new THREE.BoxGeometry(0.3, 0.25, 0.4)), dark, -0.15, 0.85, 0);
    for (const s of [-1, 1]) M(mg('dbtrack', () => new THREE.BoxGeometry(0.8, 0.22, 0.14)), dark, 0, 0.16, s * 0.33);
    M(mg('dblamp', () => new THREE.SphereGeometry(0.06, 6, 4)), new THREE.MeshBasicMaterial({ color: '#ff3020' }), 0.2, 0.82, 0);
    M(mg('dbvisor', () => new THREE.BoxGeometry(0.04, 0.12, 0.34)), new THREE.MeshBasicMaterial({ color: '#101418' }), 0.01, 0.88, 0); eyes(0.04, 0.88, 0.09, 0.035);
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) M(mg('dbwheel', () => { const g = new THREE.CylinderGeometry(0.08, 0.08, 0.16, 10); g.rotateX(Math.PI / 2); return g; }), acc, -0.26 + i * 0.26, 0.16, s * 0.33);
    const drill = M(mg('dbdrill', () => new THREE.ConeGeometry(0.17, 0.55, 8)), acc, 0.62, 0.5, 0); drill.rotation.z = -Math.PI / 2; anim = [drill];
    for (let i = 0; i < 3; i++) M(mg('dbstripe', () => new THREE.BoxGeometry(0.02, 0.4, 0.56)), acc, -0.25 + i * 0.12, 0.5, 0);
  } else {
    const robe = M(mg('robe', () => { const g = new THREE.ConeGeometry(0.48, 1.55, 16, 4, true); const p = g.attributes.position as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.7) p.setY(i, p.getY(i) + Math.abs(Math.sin(i * 2.3)) * 0.22); g.computeVertexNormals(); return g; }), mat, 0, 1.15, 0); robe.rotation.x = Math.PI;
    (mat as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    const hood = M(mg('hood', () => new THREE.SphereGeometry(0.33, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62)), mat, 0, 1.96, 0); hood.rotation.z = -0.25;
    M(mg('void', () => new THREE.SphereGeometry(0.24, 10, 8)), new THREE.MeshBasicMaterial({ color: '#05020c' }), 0.1, 1.92, 0);
    eyes(0.3, 1.96, 0.08, 0.045);
    for (const s of [-1, 1]) { const arm = M(mg('warm', () => new THREE.ConeGeometry(0.1, 0.7, 8, 1, true)), mat, 0.18, 1.45, s * 0.4); arm.rotation.set(s * 0.5, 0, 1.2);
      for (let f = 0; f < 3; f++) { const c = M(mg('wclaw', () => new THREE.ConeGeometry(0.015, 0.16, 4)), eyeMat, 0.5, 1.32 - f * 0.03, s * (0.52 + f * 0.03)); c.rotation.z = -1.9; } }
    if (model === 'gaswraith') { anim = []; for (let i = 0; i < 5; i++) { const p = M(mg('gaspuff', () => new THREE.SphereGeometry(0.16, 8, 6)), new THREE.MeshBasicMaterial({ color: sk.accent, transparent: true, opacity: 0.35, depthWrite: false }), Math.cos(i * 1.3) * 0.35, 0.3 + i * 0.12, Math.sin(i * 1.3) * 0.35); anim.push(p); } }
    const glow = new THREE.Mesh(mg('wglow', () => new THREE.SphereGeometry(0.6, 12, 8)), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending })); glow.position.y = 1.3; glow.scale.set(1, 1.6, 1); body.add(glow);
  }
  root.add(body);
  // Readability (dark close-ups): every creature carries a faint self-light from its own colour so its silhouette and
  // face read in a dark tunnel without adding lights; glow types (fire / crystal / ghost) get much more plus a halo.
  const glow = glowy(model, cave); const mats: THREE.MeshStandardMaterial[] = [];
  body.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (!m || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial || mats.includes(m)) return; mats.push(m);
    if (m.emissive.getHex() === 0) { m.emissive.copy(m.color).multiplyScalar(0.5); m.emissiveIntensity = 0.32; } else m.emissiveIntensity = Math.max(m.emissiveIntensity, glow ? 0.9 : 0.4); m.userData.ei = m.emissiveIntensity; });
  if (glow && !low) { const h = new THREE.Sprite(haloMat(sk.accent)); const hy = MOBS[kind].z + (model === 'imp' || model === 'elemental' ? 0.4 : 0.5); h.position.y = model === 'imp' ? MOBS.bat.z : hy; h.scale.setScalar(1.8); h.renderOrder = 2; body.add(h); }
  const boss = kind === 'boss';
  const edge = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#000000', depthWrite: false, depthTest: false, fog: false, transparent: true, opacity: 0.85 }));
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#3a1010', depthWrite: false, depthTest: false, fog: false })); const bar = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#ff4040', depthWrite: false, depthTest: false, fog: false }));
  edge.renderOrder = 4;
  root.scale.setScalar(sk.scale);
  const top = (model === 'golem' || model === 'yeti' || model === 'kraken' ? 2.35 : model === 'wraith' || model === 'gaswraith' ? 2.5 : model === 'bat' || model === 'imp' || model === 'jelly' || model === 'elemental' ? 2.0 : model === 'eel' ? 1.6 : 1.15);
  const bw = (boss ? 1.9 : 1.05) / sk.scale * Math.max(1, sk.scale * 0.8); // bars keep a readable size whatever the creature's scale
  edge.position.y = top; bg.position.y = top; bar.position.y = top; edge.scale.set(bw + 0.06, (boss ? 0.2 : 0.14) / sk.scale, 1); bg.scale.set(bw, (boss ? 0.14 : 0.09) / sk.scale, 1); bar.scale.set(bw, (boss ? 0.14 : 0.09) / sk.scale, 1); bar.renderOrder = 6; bg.renderOrder = 5;
  bar.center.set(0, 0.5); bar.position.x = 0; bar.userData.w = bw; bar.position.z = 0; bar.userData.y = top;
  root.add(edge); root.add(bg); root.add(bar);
  if (boss) for (const f of [0.33, 0.66]) { const pip = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#ffffff', depthWrite: false, depthTest: false, fog: false })); pip.scale.set(0.025 / sk.scale, 0.16 / sk.scale, 1); pip.renderOrder = 7; pip.userData.f = f; pip.position.y = top; bar.userData.pips = [...(bar.userData.pips ?? []), pip]; root.add(pip); }
  const marker = new THREE.Mesh(mg('telring', () => { const g = new THREE.RingGeometry(0.82, 1, 40); g.rotateX(-Math.PI / 2); return g; }), new THREE.MeshBasicMaterial({ color: '#ff3020', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  const fill = new THREE.Mesh(mg('teldisc', () => { const g = new THREE.CircleGeometry(1, 40); g.rotateX(-Math.PI / 2); return g; }), marker.material); fill.name = 'fill'; marker.add(fill);
  marker.visible = false; marker.renderOrder = 3;
  return { root, body, wings, anim, model, scale: sk.scale, bar, barBg: bg, barEdge: edge, hurt: 0, kind, hp: -1, max: 1, t: Math.random() * 6, tx: 0, ty: 0, ta: 0, mv: 0, st: 0, wind: 0, atk: 0, dying: 0, mini: false, ph: 1, glow: glow ? 1 : 0, marker, mats, base: body.position.y };
}
function nameTag(name: string): THREE.Sprite { // Chud City label look; the pill grows to fit the whole name
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cityLabel(name, '#e8c26a'), transparent: true, premultipliedAlpha: true, toneMapped: false, depthWrite: false, fog: false }));
  s.position.y = 2.15; fitLabel(s, 1.6); s.renderOrder = 5; return s;
}
function disposeTag(s: THREE.Sprite) { const m = s.material as THREE.SpriteMaterial; m.map?.dispose(); m.dispose(); }

export interface MinerView { id: string; name: string; x: number; y: number; z: number; a: number; c: boolean; sw: number; pk?: string | null; tl?: MineToolId }

const rockTex = (() => {
  let t: THREE.CanvasTexture | null = null;
  return () => {
    if (t) return t;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#4a4440'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) { const v = 50 + Math.random() * 50; g.fillStyle = `rgb(${v + 8},${v + 2},${v - 4})`; g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 5, 2 + Math.random() * 4); }
    t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
})();

interface Particle { m: THREE.Mesh; v: THREE.Vector3; life: number; dust?: boolean; spark?: boolean; shared?: boolean }
const SHOTM = new Map<string, THREE.MeshBasicMaterial>();
const shotMat = (c: string) => { let m = SHOTM.get(c); if (!m) { m = new THREE.MeshBasicMaterial({ color: c }); SHOTM.set(c, m); } return m; };

export class Mines3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 80);
  private nodes: Array<{ g: THREE.Group; ore: THREE.Mesh; crack: THREE.Mesh; max: number }> = [];
  private others = new Map<string, MinerRig & { sw?: number; tag?: THREE.Sprite; tagName?: string }>();
  private walls: Array<[number, number, number, number]> = [];
  private parts: Particle[] = [];
  private pick: THREE.Group;
  private swingT = 1;
  private pickModel: THREE.Group;
  private pickSkin: string | null = null;
  private toolModel: THREE.Group | null = null;
  private toolId: MineToolId = 'pickaxe';
  /** Hold-to-mine: true while the mouse is held so drills keep spinning between swings. */
  working = false;
  private kick = 0;
  private hitDue = -1;
  private lamp: THREE.PointLight;

  private caveNodes: MineNode[];
  private mobs = new Map<number, MobRig>();
  private sword: THREE.Group;
  private swordT = 1;
  private weaponId = 'rusty_sword';
  readonly floor: number;
  constructor(canvas: HTMLCanvasElement, private readonly caveId: CaveId = 'mine', floor = 1) {
    const cave = levelOf(caveId, floor); const MINE_MAP = cave.map; const MINE_NODES = cave.nodes;
    this.floor = cave.floor; const classic = caveId === 'mine' && cave.floor < 10;
    const look = classic ? depthLook(cave.floor) : null; const T = look ? { ...cave.theme, wall: look.wall, floor: look.floor, lamp: look.lamp } : cave.theme; // QA#4 per-floor look
    this.caveNodes = MINE_NODES;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(detectWorldTier() === 'low' ? 1 : 2, window.devicePixelRatio || 1));
    this.scene.background = new THREE.Color(classic ? '#0b0907' : T.sky);
    const lava = T.hazard === 'lava'; // Magma Depths brightened (request #21): lighter, further fog + stronger ambient/hemi + warmer lava spill
    this.scene.fog = new THREE.Fog(classic ? '#0b0907' : lava ? '#3a1507' : T.fog, lava ? 8 : 6, T.hazard === 'ice' ? 32 : lava ? 34 : 26);
    this.scene.add(new THREE.AmbientLight(T.ambient, T.hazard === 'ice' ? 0.7 : lava ? 1.35 : 0.55));
    if (lava) this.scene.add(new THREE.HemisphereLight('#ffb27a', '#5a1a08', 0.9));
    this.lamp = new THREE.PointLight('#ffd9a0', 2.2, 14, 1.4); this.scene.add(this.lamp);
    const tex = rockTex();
    const wallMat = new THREE.MeshLambertMaterial({ map: tex, color: T.hazard === 'lava' ? '#7a4c3e' : T.wall });
    // Hazard cells ('~', solid 'metal'): ice pillars (translucent) or lava pools (glowing pit, heat light).
    const iceMat = new THREE.MeshStandardMaterial({ color: '#bfe8ff', emissive: '#3a8ac0', emissiveIntensity: 0.35, transparent: true, opacity: 0.72, roughness: 0.1, metalness: 0.2 });
    const lavaMat = new THREE.MeshBasicMaterial({ color: T.hazard === 'lava' ? '#ff7a1e' : '#ff5a10' });
    const lipMat = new THREE.MeshLambertMaterial({ color: '#2a1410', emissive: '#5a1a04' });
    const LAVA_LIP = 0.45;
    let heat = 0;
    for (const s of MINE_MAP.solids) if (s.mat === 'concrete' && s.z0 < 1) this.walls.push([s.x0, s.y0, s.x1, s.y1]);
    for (const s of MINE_MAP.solids) {
      const w = s.x1 - s.x0, d = s.y1 - s.y0, h = s.z1 - s.z0;
      if (s.mat === 'metal' && T.hazard === 'lava') {
        // The pool is solid (impassable) over its whole cell, so draw a raised rock lip around it: the edge you
        // stop at is visible instead of an invisible wall around a flat decal.
        const lip = new THREE.Mesh(new THREE.BoxGeometry(w, LAVA_LIP, d), lipMat); lip.position.set(s.x0 + w / 2, LAVA_LIP / 2, s.y0 + d / 2); this.scene.add(lip);
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.3, d - 0.3), lavaMat); pool.rotation.x = -Math.PI / 2; pool.position.set(s.x0 + w / 2, LAVA_LIP + 0.01, s.y0 + d / 2); this.scene.add(pool);
        if (heat++ % 2 === 0) { const l = new THREE.PointLight('#ff6a14', 2.8, 11, 1.4); l.position.set(s.x0 + w / 2, 0.8, s.y0 + d / 2); this.scene.add(l); }
        continue;
      }
      const m = new THREE.Mesh(s.mat === 'metal' && T.hazard === 'ice' ? new THREE.CylinderGeometry(w * 0.62, w * 0.68, h, 8) : new THREE.BoxGeometry(w, h, d), s.mat === 'metal' && T.hazard === 'ice' ? iceMat : wallMat);
      m.position.set(s.x0 + w / 2, s.z0 + h / 2, s.y0 + d / 2);
      this.scene.add(m);
    }
    const floorTex = tex.clone(); floorTex.repeat.set(MINE_MAP.w / 3, MINE_MAP.d / 3); floorTex.needsUpdate = true;
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(MINE_MAP.w, MINE_MAP.d), new THREE.MeshLambertMaterial({ map: floorTex, color: T.floor }));
    floorMesh.rotation.x = -Math.PI / 2; floorMesh.position.set(MINE_MAP.w / 2, 0, MINE_MAP.d / 2); this.scene.add(floorMesh);
    if (look) addDepthProps(this.scene, look, this.walls, MINE_NODES);
    // Lanterns along the tunnels (cheap: emissive dots + a few lights).
    let lights = 0;
    for (const s of MINE_MAP.spawns.concat(MINE_NODES.filter((_, i) => i % 9 === 0).map((n) => [n.x, n.y, 0] as [number, number, number]))) {
      if (lights++ > 10) break;
      const l = new THREE.PointLight(T.lamp, T.hazard === 'lava' ? 1.6 : 1.2, T.hazard === 'lava' ? 11 : 9, 1.6); l.position.set(s[0], 3.2, s[1]); this.scene.add(l);
      const lan = mineLantern(T.lamp); lan.position.set(s[0], 3.2, s[1]); this.scene.add(lan); // mu-visuals: every lamp light has a visible hanging lantern
    }
    { // EXIT lift: glowing sign + floor pad at the entrance pocket
      const c = document.createElement('canvas'); c.width = 512; c.height = 160; const x = c.getContext('2d');
      if (x) { x.fillStyle = '#062312'; x.fillRect(0, 0, 512, 160); x.strokeStyle = '#3dff8a'; x.lineWidth = 8; x.strokeRect(6, 6, 500, 148);
        x.fillStyle = '#6dffaa'; x.font = 'bold 72px sans-serif'; x.textAlign = 'center'; x.fillText('EXIT', 256, 80); x.font = 'bold 34px sans-serif'; x.fillText('bank your haul', 256, 130); }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) }));
      sign.position.set(MINE_EXIT.sign.x, MINE_EXIT.sign.z, MINE_EXIT.sign.y); sign.rotation.y = Math.PI / 2; this.scene.add(sign);
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(MINE_EXIT.x1 - MINE_EXIT.x0, MINE_EXIT.y1 - MINE_EXIT.y0), new THREE.MeshBasicMaterial({ color: '#2cff7a', transparent: true, opacity: 0.16, depthWrite: false }));
      pad.rotation.x = -Math.PI / 2; pad.position.set((MINE_EXIT.x0 + MINE_EXIT.x1) / 2, 0.02, (MINE_EXIT.y0 + MINE_EXIT.y1) / 2); this.scene.add(pad);
      const gl = new THREE.PointLight('#3dff8a', 1.4, 7, 1.6); gl.position.set(MINE_EXIT.sign.x + 0.6, MINE_EXIT.sign.z, MINE_EXIT.sign.y); this.scene.add(gl);
      const props = mineExitProps(); props.position.set(MINE_EXIT.x1 - 0.6, 0, MINE_EXIT.y0 + 0.6); props.rotation.y = Math.PI / 2; this.scene.add(props); // crates, barrel and an ore cart in the exit pocket corner
    }
    if (hasFloors(caveId) && cave.floor < MAX_FLOOR) { // ladder down at the far end: dark shaft + glowing frame + sign
      const hole = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24), new THREE.MeshBasicMaterial({ color: '#000000' })); hole.rotation.x = -Math.PI / 2; hole.position.set(LADDER.cx, 0.02, LADDER.cy); this.scene.add(hole);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.35, 24), new THREE.MeshBasicMaterial({ color: '#ffcc40', transparent: true, opacity: 0.8 })); ring.rotation.x = -Math.PI / 2; ring.position.set(LADDER.cx, 0.03, LADDER.cy); this.scene.add(ring);
      const railMat = new THREE.MeshLambertMaterial({ color: '#8a5a2a' });
      for (const s of [-0.35, 0.35]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), railMat); r.position.set(LADDER.cx + s, 0.5, LADDER.cy); this.scene.add(r); }
      for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.06), railMat); r.position.set(LADDER.cx, 0.0 + i * 0.4, LADDER.cy); this.scene.add(r); }
      const c = document.createElement('canvas'); c.width = 512; c.height = 160; const x = c.getContext('2d');
      if (x) { x.fillStyle = '#231a06'; x.fillRect(0, 0, 512, 160); x.strokeStyle = '#ffcc40'; x.lineWidth = 8; x.strokeRect(6, 6, 500, 148); x.fillStyle = '#ffd860'; x.font = 'bold 64px sans-serif'; x.textAlign = 'center'; x.fillText('LADDER ↓', 256, 78); x.font = 'bold 34px sans-serif'; x.fillText(`to floor ${cave.floor + 1}`, 256, 130); }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.62), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) })); sign.position.set(LADDER.x1 - 0.05, 2.5, LADDER.cy); sign.rotation.y = -Math.PI / 2; this.scene.add(sign);
      const gl = new THREE.PointLight('#ffcc40', 1.6, 8, 1.6); gl.position.set(LADDER.cx, 1.5, LADDER.cy); this.scene.add(gl);
    }
    for (const n of MINE_NODES) {
      const def = ORES[n.ore];
      const g = new THREE.Group();
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), new THREE.MeshLambertMaterial({ color: '#5a524c', flatShading: true }));
      g.add(rock);
      const shiny = n.ore === 'gem' || n.ore === 'diamond' || n.ore === 'gold' || n.ore === 'silver' || n.ore === 'opal' || n.ore === 'pearl' || n.ore === 'condensate'; // #10d: Grotto-exclusive ores glow too
      const oily = n.ore === 'oilsand' || n.ore === 'tarrock'; // Fort McChud: wet, glossy bitumen
      const mat = new THREE.MeshStandardMaterial({ color: def.color, emissive: shiny ? def.color : '#000', emissiveIntensity: shiny ? 0.45 : 0, roughness: shiny ? 0.25 : oily ? 0.18 : 0.9, metalness: shiny ? 0.6 : 0, flatShading: true });
      const ore = new THREE.Group() as unknown as THREE.Mesh;
      for (let i = 0; i < 6; i++) {
        const c = new THREE.Mesh(n.ore === 'shale' ? new THREE.BoxGeometry(0.34, 0.06, 0.24) : n.ore === 'tarrock' ? new THREE.SphereGeometry(0.11 + (i % 3) * 0.04, 8, 6) : n.ore === 'condensate' ? new THREE.OctahedronGeometry(0.16 + (i % 3) * 0.04) : n.ore === 'pearl' ? new THREE.SphereGeometry(0.12 + (i % 3) * 0.03, 12, 8) : n.ore === 'gem' || n.ore === 'diamond' || n.ore === 'opal' ? new THREE.OctahedronGeometry(0.14 + (i % 3) * 0.04) : new THREE.IcosahedronGeometry(0.13 + (i % 2) * 0.05, 0), mat);
        const th = i * 1.9, ph = 0.4 + (i % 3) * 0.5;
        c.position.set(Math.cos(th) * Math.sin(ph) * 0.5, Math.cos(ph) * 0.45, Math.sin(th) * Math.sin(ph) * 0.5);
        (ore as unknown as THREE.Group).add(c);
      }
      g.add(ore);
      const crack = new THREE.Mesh(new THREE.DodecahedronGeometry(0.57, 0), new THREE.MeshBasicMaterial({ color: '#000', wireframe: true, transparent: true, opacity: 0 }));
      g.add(crack);
      g.position.set(n.x, n.z, n.y);
      g.rotation.y = n.id * 1.3;
      this.scene.add(g);
      this.nodes.push({ g, ore, crack, max: def.hits });
    }
    // Pickaxe viewmodel, parented to the camera.
    this.pick = new THREE.Group();
    this.pickModel = skinnedPickaxe(null);
    // Hold point ~1/3 up the handle; head up-forward, pick point away from the player.
    this.pickModel.position.set(0, -0.22, 0); this.pickModel.rotation.y = Math.PI / 2;
    this.pick.add(this.pickModel); this.pick.scale.setScalar(0.72);
    this.camera.add(this.pick);
    this.sword = buildWeaponModel(this.weaponId, detectWorldTier() === 'low'); this.sword.visible = false; this.camera.add(this.sword);
    this.scene.add(this.camera);
    this.camera.add(new THREE.PointLight('#fff1d6', 0.9, 6, 1.5));
  }

  resize(w: number, h: number) { this.renderer.setSize(w, h, false); this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix(); }

  /** hp per node (-1 = mined out). */
  setNodes(hp: number[]) {
    hp.forEach((v, i) => {
      const n = this.nodes[i]; if (!n) return;
      n.g.visible = v !== -1;
      const dmg = v < 0 ? 0 : 1 - v / n.max;
      (n.crack.material as THREE.MeshBasicMaterial).opacity = dmg * 0.85;
      n.crack.scale.setScalar(1 + dmg * 0.04);
    });
  }

  swing() { this.swingT = 0; }
  /** Equipped pickaxe skin (inv_loadout.pickaxe) for the viewmodel and third-person miners. */
  setPickSkin(token: string | null | undefined) {
    this.pickSkin = token ?? null; applyPickSkin(this.pickModel, this.pickSkin); if (this.toolModel) skinMineTool(this.toolModel, this.pickSkin);
  }

  /** Equipped mining tool (request #16): swap the viewmodel; the starter pickaxe keeps its skin. */
  setTool(id: MineToolId) {
    if (id === this.toolId) return; this.toolId = id;
    if (this.toolModel) { this.pick.remove(this.toolModel); this.toolModel = null; }
    const m = buildMineTool(id); this.pickModel.visible = !m;
    if (m) { skinMineTool(m, this.pickSkin); m.position.copy(this.pickModel.position); m.rotation.copy(this.pickModel.rotation); this.pick.add(m); this.toolModel = m; }
  }

  /** Weapon swing: the sword replaces the pickaxe for one strike. */
  swingSword() { this.swordT = 0; }
  /** Equipped Weapon Store weapon: the held model follows it (each weapon has its own model). */
  setWeapon(id: string | null | undefined) {
    const next = id || 'rusty_sword'; if (next === this.weaponId) return; this.weaponId = next;
    const vis = this.sword.visible, pos = this.sword.position.clone(), rot = this.sword.rotation.clone();
    this.camera.remove(this.sword); this.sword.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); const mm = m.material as THREE.Material | undefined; mm?.dispose?.(); });
    this.sword = buildWeaponModel(next, detectWorldTier() === 'low'); this.sword.visible = vis; this.sword.position.copy(pos); this.sword.rotation.copy(rot); this.camera.add(this.sword);
  }
  get weapon() { return this.weaponId; }
  private low = detectWorldTier() === 'low';
  private shots = new Map<number, THREE.Mesh>();
  private fxRings: Array<{ m: THREE.Mesh; life: number; max: number; r: number }> = [];
  /** Boss move being called out (HUD reads this). */
  bossCall: { name: string; until: number } | null = null;
  /** Creatures on this floor (server ticks). hp 0 = dead: plays its death dissolve, then hides until it respawns. */
  setMobs(list: MobView[]) {
    const seen = new Set<number>();
    for (const b of list) {
      let r = this.mobs.get(b.id);
      if (r && (r.kind !== b.k || r.mini !== !!b.mini)) { this.dropMob(r); this.mobs.delete(b.id); r = undefined; }
      const fresh = !r;
      if (!r) { r = buildMob(b.k, this.caveId, this.low); r.mini = !!b.mini; if (r.mini) r.root.scale.multiplyScalar(0.55); this.scene.add(r.root); this.scene.add(r.marker); this.mobs.set(b.id, r); r.root.position.set(b.x, 0, b.y); r.root.rotation.y = -b.a; }
      seen.add(b.id);
      if (r.hp > 0 && b.hp < r.hp) r.hurt = 0.18;
      if (r.hp > 0 && b.hp <= 0) this.mobDeath(r);
      if (b.hp > 0) { r.dying = 0; r.root.visible = true; if (r.hp <= 0 && !fresh) { r.root.position.set(b.x, 0, b.y); r.body.scale.setScalar(1); } }
      else if (r.dying <= 0) r.root.visible = false;
      r.hp = b.hp; r.max = b.max; r.tx = b.x; r.ty = b.y; r.ta = -b.a;
      const st = b.st ?? 2; if (st === 5 && r.st === 3) r.atk = 0.35; // wind-up resolved -> lunge
      if (st === 3 && r.st !== 3) r.wind = 0;
      r.st = st;
      if (b.ph && b.ph !== r.ph) { r.ph = b.ph; }
      { const em = r.barEdge.material as THREE.SpriteMaterial; const want = b.pt ? '#38d8ff' : '#000000'; if (em.userData.c !== want) { em.userData.c = want; em.color.set(want); em.opacity = b.pt ? 1 : 0.85; r.barEdge.scale.y = (b.pt ? 1.5 : 1) * (r.barEdge.userData.y0 ??= r.barEdge.scale.y); } } // raid creatures: cyan-framed bar
      const f = Math.max(0, Math.min(1, b.hp / b.max)); const w = r.bar.userData.w as number;
      r.bar.scale.x = w * f;
      // keep the fill left-aligned: shift by half the missing width (sprites are camera-facing, so use center)
      r.bar.center.set(f > 0 ? 0.5 + (1 - f) / (2 * f) : 0.5, 0.5);
      (r.bar.material as THREE.SpriteMaterial).color.set(f > 0.6 ? '#46e050' : f > 0.3 ? '#ffc630' : '#ff3a30');
      const show = b.hp > 0 && (b.hp < b.max || st >= 2 && st !== 6 || r.kind === 'boss');
      r.bar.visible = r.barBg.visible = r.barEdge.visible = show; for (const p of (r.bar.userData.pips ?? []) as THREE.Sprite[]) { p.visible = show; p.center.set(0.5 + (0.5 - p.userData.f) * (w / p.scale.x), 0.5); }
      const tw = b.hp > 0 ? b.tw : undefined; const mk = r.marker; const mm = mk.material as THREE.MeshBasicMaterial;
      if (tw) {
        mk.visible = true; mm.color.set(r.kind === 'boss' ? '#ff6a10' : '#ff2a1a');
        const fill = mk.getObjectByName('fill')!;
        if (tw.k === 'charge') { const len = 6; mk.position.set(r.tx + tw.dx * len / 2, 0.04, r.ty + tw.dy * len / 2); mk.scale.set(len / 2, 1, tw.r); mk.rotation.y = -Math.atan2(tw.dy, tw.dx); }
        else { mk.position.set(tw.x, 0.04, tw.y); mk.scale.set(tw.r, 1, tw.r); mk.rotation.y = 0; }
        fill.visible = tw.k !== 'shot' && tw.k !== 'barrage' && tw.k !== 'summon';
        mk.userData.ms = tw.ms; mk.userData.at = performance.now(); mk.userData.k = tw.k;
        if (tw.n && (!this.bossCall || this.bossCall.name !== tw.n || this.bossCall.until < performance.now())) this.bossCall = { name: tw.n, until: performance.now() + 1800 };
      } else mk.visible = false;
    }
    for (const [id, r] of this.mobs) if (!seen.has(id)) { if (r.hp > 0 && r.mini) { this.mobDeath(r); r.hp = 0; } if (r.dying > 0) continue; this.dropMob(r); this.mobs.delete(id); }
  }
  private dropMob(r: MobRig) { this.scene.remove(r.root); this.scene.remove(r.marker); (r.marker.material as THREE.Material).dispose(); }
  /** Enemy projectiles: glowing orbs the server flies (sidestep them). Shared geometry; colour from this mine's ranged creature. */
  setShots(list: ShotView[]) {
    const seen = new Set<number>(); const col = mobSkin(this.caveId, 'wraith').accent;
    for (const sv of list) {
      let m = this.shots.get(sv.id);
      if (!m) { m = new THREE.Mesh(mg('shot', () => new THREE.SphereGeometry(0.16, 10, 8)), shotMat(col)); if (!this.low) { const h = new THREE.Sprite(haloMat(col)); h.scale.setScalar(1.1); m.add(h); } this.scene.add(m); this.shots.set(sv.id, m); m.position.set(sv.x, 1.1, sv.y); }
      m.userData.tx = sv.x; m.userData.ty = sv.y; seen.add(sv.id);
    }
    for (const [id, m] of this.shots) if (!seen.has(id)) { this.scene.remove(m); this.shots.delete(id); if (!this.low) this.burst(m.position.clone(), col, 5); }
  }
  /** Server combat effects: slam shockwaves, boss phase changes, slime splits, summons. */
  mobFx(list: MobFxView[]) {
    for (const f of list) {
      const at = new THREE.Vector3(f.x, 0.3, f.y);
      if (f.k === 'aoe') { this.ring(f.x, f.y, f.r ?? 2, '#ffb060'); this.burst(at, '#a08060', this.low ? 4 : 14, true); this.kick = Math.max(this.kick, 0.02); }
      else if (f.k === 'phase') { this.ring(f.x, f.y, 5, '#ff4020'); this.burst(at.setY(1.5), '#ff6030', this.low ? 6 : 24); this.bossCall = { name: `Phase ${f.phase}!`, until: performance.now() + 2200 }; }
      else if (f.k === 'split') this.burst(at, mobSkin(this.caveId, 'slime').color, this.low ? 4 : 12);
      else if (f.k === 'summon') { this.ring(f.x, f.y, 2.5, '#c080ff'); if (f.name) this.bossCall = { name: f.name, until: performance.now() + 1800 }; }
    }
  }
  private ring(x: number, y: number, r: number, color: string) {
    const m = new THREE.Mesh(mg('fxring', () => { const g = new THREE.RingGeometry(0.85, 1, 40); g.rotateX(-Math.PI / 2); return g; }), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    m.position.set(x, 0.06, y); m.scale.setScalar(0.2); this.scene.add(m); this.fxRings.push({ m, life: 0.5, max: 0.5, r });
  }
  /** Particle burst with one shared cube geometry (fewer in ?lowgfx). */
  private burst(at: THREE.Vector3, color: string, n: number, dust = false) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(mg('part', () => new THREE.BoxGeometry(0.07, 0.07, 0.07)), new THREE.MeshBasicMaterial({ color, transparent: dust, opacity: dust ? 0.6 : 1 }));
      m.position.copy(at); this.scene.add(m);
      this.parts.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3 + (dust ? 0.3 : 1), (Math.random() - 0.5) * 4), life: 0.45 + Math.random() * 0.4, shared: true });
    }
  }
  /** Death: burst of the creature's colours + a 0.6 s dissolve (sink, shrink, fade). */
  private mobDeath(r: MobRig) {
    r.dying = 0.6; r.marker.visible = false; r.bar.visible = r.barBg.visible = r.barEdge.visible = false;
    const sk = mobSkin(this.caveId, r.kind); const at = new THREE.Vector3(r.root.position.x, MOBS[r.kind].z * r.scale * 0.6 + 0.2, r.root.position.z);
    const n = this.low ? 6 : r.kind === 'boss' ? 40 : 18; this.burst(at, sk.color, Math.ceil(n / 2)); this.burst(at, sk.accent, Math.floor(n / 2));
    for (const m of r.mats) { m.transparent = true; m.userData.op = m.opacity; }
  }
  /** A hit landed on a creature (yours or another miner's): white-red flash, sparks, a little shove. */
  mobHit(id: number, killed: boolean) {
    const r = this.mobs.get(id); if (!r) return; r.hurt = 0.18;
    const at = new THREE.Vector3(r.root.position.x, MOBS[r.kind].z + 0.2, r.root.position.z);
    this.burst(at, '#ff3a2a', this.low ? 3 : killed ? 8 : 6); this.burst(at, MOBS[r.kind].color, this.low ? 2 : 4);
    const dx = r.root.position.x - this.camera.position.x, dz = r.root.position.z - this.camera.position.z, L = Math.hypot(dx, dz) || 1;
    if (r.kind !== 'boss') { r.root.position.x += (dx / L) * 0.25; r.root.position.z += (dz / L) * 0.25; }
    this.kick = Math.max(this.kick, 0.03);
  }

  burstAt(node: number, big: boolean) {
    const n = this.caveNodes[node]; if (!n) return;
    const col = new THREE.Color(ORES[n.ore].color);
    const at = new THREE.Vector3(n.x, n.z, n.y);
    for (let i = 0; i < (big ? 22 : 7); i++) { // chips
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: i % 3 ? col : new THREE.Color('#6b625a') }));
      m.position.copy(at); this.scene.add(m);
      this.parts.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3), life: 0.6 + Math.random() * 0.4 });
    }
    if (n.ore === 'stone') { // dust puffs
      for (let i = 0; i < 10; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), new THREE.MeshBasicMaterial({ color: '#9a8f80', transparent: true, opacity: 0.35, depthWrite: false }));
        m.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.3, (Math.random() - 0.5) * 0.4)); this.scene.add(m);
        this.parts.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.6 + 0.2, (Math.random() - 0.5) * 0.8), life: 0.9 + Math.random() * 0.5, dust: true });
      }
    } else { // sparks
      for (let i = 0; i < 16; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.09), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ffd27a' : '#fff3c8', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        m.position.copy(at); this.scene.add(m);
        const v = new THREE.Vector3((Math.random() - 0.5) * 7, Math.random() * 4 + 1.5, (Math.random() - 0.5) * 7);
        m.lookAt(at.clone().add(v)); this.parts.push({ m, v, life: 0.25 + Math.random() * 0.25, spark: true });
      }
    }
    this.kick = big ? 0.05 : 0.03;
  }


  setOthers(list: MinerView[], meId: string) {
    const seen = new Set<string>();
    for (const p of list) {
      if (p.id === meId) continue;
      seen.add(p.id);
      let g = this.others.get(p.id);
      if (!g) { g = buildMiner(p.pk ?? null); this.scene.add(g.root); this.others.set(p.id, g); }
      setMinerSkin(g, p.pk ?? null); setMinerTool(g, p.tl);
      if (g.tagName !== p.name) { if (g.tag) { g.root.remove(g.tag); disposeTag(g.tag); } g.tag = nameTag(p.name); g.tagName = p.name; g.root.add(g.tag); }
      g.root.position.set(p.x, p.z - (p.c ? 0.3 : 0), p.y);
      g.root.rotation.y = -p.a;
      g.sw = p.sw;
    }
    for (const [id, g] of this.others) if (!seen.has(id)) { this.scene.remove(g.root); if (g.tag) disposeTag(g.tag); this.others.delete(id); }
  }

  render(cam: { x: number; y: number; z: number; a: number; p: number }, dt: number, walk: number) {
    this.camera.position.set(cam.x, cam.z, cam.y);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(cam.p, -cam.a - Math.PI / 2, 0);
    this.lamp.position.set(cam.x, cam.z + 0.4, cam.y);
    this.swingT = Math.min(1, this.swingT + dt / 0.5);
    const t = (globalThis as { __pickPoseT?: number }).__pickPoseT ?? this.swingT, bob = 0, sway = 0; void walk; // no walk bob in the mines (pt1356u): steady camera + tool, swing unchanged
    // anticipation (slow raise, cock back + roll) → strike (accelerating arc) → impact hold + recoil → follow-through settle
    const ease = (x: number) => x * x * (3 - 2 * x);
    let rx = 0, rz = 0, dy = 0, dz = 0, dx = 0;
    if (t < 0.36) { const k = ease(t / 0.36); rx = 0.25 * k; rz = 0.12 * k; dy = 0.08 * k; dz = -0.02 * k; }
    else if (t < 0.5) { const k = (t - 0.36) / 0.14, e = k * k * k; rx = 0.25 - 1.25 * e; rz = 0.12 - 0.22 * e; dy = 0.08 - 0.13 * e; dz = -0.02 - 0.1 * e; dx = -0.1 * e; }
    else if (t < 0.58) { const k = Math.sin(((t - 0.5) / 0.08) * Math.PI); rx = -1.0 + 0.16 * k; rz = -0.1; dy = -0.05 + 0.02 * k; dz = -0.12 + 0.02 * k; dx = -0.1; }
    else { const k = ease((t - 0.58) / 0.42), o = Math.sin(k * Math.PI) * 0.12; rx = -1.0 * (1 - k) + o; rz = -0.1 * (1 - k); dy = -0.05 * (1 - k); dz = -0.12 * (1 - k); dx = -0.1 * (1 - k); }
    this.pick.position.set(0.36 + dx + sway, -0.33 + bob + dy, -0.6 + dz);
    this.pick.rotation.set(-0.12 + rx, 0.22, 0.3 + rz);
    if (this.toolModel) { // powered tools: spin/hammer/flame + vibration while swinging or held
      const work = this.working || t < 1 ? 1 : 0, j = animateMineTool(this.toolModel, performance.now() / 1000, work);
      this.pick.position.x += j.jx; this.pick.position.y += j.jy;
    }
    if (this.hitDue < 0.5 && t >= 0.5) this.kick = Math.max(this.kick, 0.025);
    this.hitDue = t;
    this.kick = Math.max(0, this.kick - dt * 0.25);
    this.camera.rotation.x += this.kick;
    for (const g of this.others.values()) {
      animateMiner(g, dt, g.sw ?? 0);
      if (!g.tag) continue;
      // Name tag: fades out with distance, stays a readable size, hidden when a rock wall is in the way.
      const px = g.root.position.x, py = g.root.position.z, d = Math.hypot(px - cam.x, py - cam.y);
      const m = g.tag.material as THREE.SpriteMaterial;
      m.opacity = Math.max(0, Math.min(1, (22 - d) / 8));
      g.tag.visible = m.opacity > 0.02 && this.clear(cam.x, cam.y, px, py);
      const k = Math.max(1, Math.min(2.2, d / 7)); fitLabel(g.tag, 1.6 * k);
    }
    this.swordT = Math.min(1, this.swordT + dt / 0.35);
    this.sword.visible = this.swordT < 1; this.pick.visible = !this.sword.visible;
    if (this.sword.visible) { animateWeaponModel(this.sword, performance.now() / 1000); const k = this.swordT; const arc = Math.sin(k * Math.PI); this.sword.position.set(0.32 - k * 0.5, -0.32 + arc * 0.08, -0.55); this.sword.rotation.set(-0.4 - arc * 0.4, 0.2, -1.2 + k * 2.2); }
    const now = performance.now() / 1000;
    const pnow = performance.now();
    for (const [id, r] of this.mobs) {
      // glide to the server pose (10 Hz ticks) and measure speed for the walk cycle
      const k = Math.min(1, dt * 12), ox = r.root.position.x, oz = r.root.position.z;
      if (r.dying <= 0) { r.root.position.x += (r.tx - ox) * k; r.root.position.z += (r.ty - oz) * k; }
      const sp = Math.hypot(r.root.position.x - ox, r.root.position.z - oz) / Math.max(dt, 1e-3); r.mv += (Math.min(1, sp / 2) - r.mv) * Math.min(1, dt * 6);
      let da = r.ta - r.root.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da)); r.root.rotation.y += da * Math.min(1, dt * 10);
      const walk = r.mv, rate = 0.6 + walk * 1.8; r.t += dt * rate; // idle = slow breathing, walking = faster cycle
      const md = r.model; const winding = r.st === 3; if (winding) r.wind += dt; r.atk = Math.max(0, r.atk - dt);
      if (md === 'blob') { const hop = Math.abs(Math.sin(r.t * 4)) * walk; const s = 1 + Math.sin(r.t * 5) * (0.06 + walk * 0.1) - (winding ? Math.min(0.25, r.wind * 0.5) : 0); r.body.scale.set(1 / s, s, 1 / s); r.body.position.y = hop * 0.35; }
      else if (md === 'bat' || md === 'imp') { r.body.position.y = MOBS.bat.z + Math.sin(r.t * 3) * 0.2 + (winding ? 0.3 * Math.min(1, r.wind * 2) : 0) - r.atk * 1.2; r.wings?.forEach((w, i) => { w.rotation.x = (i ? 1 : -1) * Math.sin(now * (md === 'imp' ? 12 : 18) * (winding ? 1.5 : 1)) * 0.7; }); }
      else if (md === 'wraith' || md === 'gaswraith') { r.body.position.y = Math.sin(r.t * 2) * 0.15; r.anim?.forEach((p, i) => { p.position.y = 0.3 + ((r!.t * 0.4 + i * 0.2) % 1) * 1.4; }); }
      else if (md === 'golem' || md === 'yeti') { r.body.rotation.z = Math.sin(r.t * 3) * 0.04 * (0.5 + walk) + (winding ? Math.min(0.35, r.wind * 0.4) : 0) - r.atk * 1.3; r.body.position.y = Math.abs(Math.sin(r.t * 3)) * 0.05 * walk; r.anim?.forEach((a, i) => { a.rotation.z = winding ? -1.6 * Math.min(1, r!.wind * 1.5) : Math.sin(r!.t * 3 + i * Math.PI) * 0.35 * (0.3 + walk); }); }
      else if (md === 'wolf') { r.anim?.forEach((l, i) => { l.rotation.z = Math.sin(r!.t * 9 + (i % 3 ? Math.PI : 0)) * 0.5 * walk; }); r.body.rotation.z = winding ? 0.18 : -r.atk * 0.6; }
      else if (md === 'elemental') { r.body.rotation.y = r.t * (winding ? 3 : 0.8); r.body.position.y = Math.sin(r.t * 2) * 0.12; }
      else if (md === 'slug') { const s = 1 + Math.sin(r.t * 3) * (0.05 + walk * 0.1); r.anim?.[0]?.scale.set(s, 1 / s, 1); }
      else if (md === 'jelly') { const s = 1 + Math.sin(r.t * 3) * 0.12 + (winding ? 0.15 : 0); r.body.scale.set(s, 1 / s, s); r.body.position.y = Math.sin(r.t * 1.5) * 0.2; }
      else if (md === 'eel') { r.anim?.forEach((g, i) => { g.position.z = Math.sin(r!.t * 5 - i * 0.8) * 0.12 * i * (winding ? 1.8 : 1); }); }
      else if (md === 'kraken') { r.anim?.forEach((g, i) => { g.rotation.z = Math.sin(r!.t * 2 + i) * 0.35 + (winding ? 0.5 : 0) - r.atk; }); }
      else if (md === 'drillbot') { r.anim?.forEach((d) => { d.rotation.x += dt * (winding || r.st === 4 ? 45 : 8 + walk * 14); }); r.body.position.y = winding ? Math.sin(now * 60) * 0.02 : 0; }
      if (md !== 'golem' && md !== 'yeti' && md !== 'wolf') r.body.position.x = r.atk * 0.9 - (winding ? Math.min(0.15, r.wind * 0.2) : 0); // lunge forward on strike, lean back while winding up
      // stagger wobble
      if (r.st === 7) r.root.rotation.z = Math.sin(now * 40) * 0.08; else r.root.rotation.z = 0;
      // emissive: hit flash (white-hot then red), wind-up pulse
      r.hurt = Math.max(0, r.hurt - dt);
      const pulse = winding ? 0.6 + 0.6 * Math.abs(Math.sin(r.wind * 12)) : 0;
      for (const m of r.mats) { if (m.userData.e0 === undefined) m.userData.e0 = m.emissive.getHex(); m.emissive.setHex(r.hurt > 0.12 ? 0xffffff : r.hurt > 0 ? 0xff2020 : winding ? 0xff5020 : m.userData.e0); m.emissiveIntensity = r.hurt > 0 ? 1.2 : (m.userData.ei ?? 0.35) + pulse; }
      // telegraph marker: fills in as the strike approaches
      if (r.marker.visible) { const mm = r.marker.material as THREE.MeshBasicMaterial; const left = Math.max(0, (r.marker.userData.ms ?? 0) - (pnow - (r.marker.userData.at ?? pnow))); mm.opacity = 0.35 + 0.45 * Math.abs(Math.sin(pnow / 90)); const f = r.marker.getObjectByName('fill'); if (f) f.scale.setScalar(Math.max(0.05, 1 - left / 900)); }
      // death dissolve
      if (r.dying > 0) { r.dying -= dt; const q = Math.max(0, r.dying / 0.6); r.body.scale.setScalar(0.3 + 0.7 * q); r.root.position.y = -(1 - q) * 0.3; for (const m of r.mats) m.opacity = (m.userData.op ?? 1) * q; if (r.dying <= 0) { r.root.visible = false; for (const m of r.mats) { m.opacity = m.userData.op ?? 1; m.transparent = m.userData.op !== undefined && m.userData.op < 1; } r.body.scale.setScalar(1); r.root.position.y = 0; if (!r.hp && r.mini) { this.dropMob(r); this.mobs.delete(id); } } }
    }
    for (const m of this.shots.values()) { const kk = Math.min(1, dt * 14); m.position.x += ((m.userData.tx as number) - m.position.x) * kk; m.position.z += ((m.userData.ty as number) - m.position.z) * kk; m.rotation.y += dt * 6; }
    for (let i = this.fxRings.length - 1; i >= 0; i--) { const f = this.fxRings[i]; f.life -= dt; const q = 1 - f.life / f.max; f.m.scale.setScalar(0.2 + q * f.r); (f.m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - q); if (f.life <= 0) { this.scene.remove(f.m); (f.m.material as THREE.Material).dispose(); this.fxRings.splice(i, 1); } }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt; p.v.y -= 9 * dt; p.m.position.addScaledVector(p.v, dt);
      if (p.m.position.y < 0.03) { p.m.position.y = 0.03; p.v.multiplyScalar(0.4); }
      if (p.dust) { p.v.y += 8.6 * dt; p.m.scale.multiplyScalar(1 + dt * 1.6); (p.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.35 * p.life); }
      if (p.spark) { p.m.lookAt(p.m.position.clone().add(p.v)); (p.m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, p.life * 4); }
      if (p.life <= 0) { this.scene.remove(p.m); (p.m.material as THREE.Material).dispose(); if (!p.shared) p.m.geometry.dispose(); this.parts.splice(i, 1); }
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Floor-plan line of sight between two points (rock wall cells only). */
  private clear(x0: number, y0: number, x1: number, y1: number): boolean {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.5);
    for (let i = 1; i < n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; for (const w of this.walls) if (x > w[0] && x < w[2] && y > w[1] && y < w[3]) return false; }
    return true;
  }

  dispose() { this.renderer.dispose(); }
}

/** mu-visuals mine props: a hanging miner's lantern (chain, cap, glowing glass, cage bars). Visual only, no collision. */
export function mineLantern(color: THREE.ColorRepresentation): THREE.Group {
  const g = new THREE.Group(); g.userData.prop = 'lantern'; const iron = new THREE.MeshLambertMaterial({ color: '#2b2620' });
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 4), iron); chain.position.y = 0.45; g.add(chain);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.12, 8), iron); cap.position.y = 0.16; g.add(cap);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 8), new THREE.MeshBasicMaterial({ color })); g.add(glass);
  for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.24, 0.02), iron); const a = (i / 4) * Math.PI * 2; b.position.set(Math.cos(a) * 0.11, 0, Math.sin(a) * 0.11); g.add(b); }
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 8), iron); base.position.y = -0.13; g.add(base); return g;
}
/** mu-visuals mine props: stacked timber crates, a barrel and an ore cart on a stub of rail. */
export function mineExitProps(): THREE.Group {
  const g = new THREE.Group(); g.userData.prop = 'exit'; const wood = new THREE.MeshLambertMaterial({ color: '#7a5230' }), dark = new THREE.MeshLambertMaterial({ color: '#4a3220' }), iron = new THREE.MeshLambertMaterial({ color: '#3d3a36' });
  const crate = (x: number, y: number, z: number, s: number) => { const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), wood); c.position.set(x, y + s / 2, z); c.userData.prop = 'crate'; g.add(c); for (const sy of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(s * 1.02, s * 0.12, s * 1.02), dark); b.position.set(x, y + s / 2 + sy * s * 0.38, z); g.add(b); } };
  crate(0, 0, 0, 0.6); crate(0.65, 0, 0.05, 0.55); crate(0.3, 0.6, 0.02, 0.5);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.75, 12), wood); bar.position.set(-0.05, 0.375, 0.75); bar.userData.prop = 'barrel'; g.add(bar);
  for (const y of [0.12, 0.63]) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 12), iron); h.position.set(-0.05, y, 0.75); g.add(h); }
  const cart = new THREE.Group(); cart.userData.prop = 'cart'; cart.position.set(-0.05, 0, 2.5);
  for (const sx of [-0.28, 0.28]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 2.4), iron); r.position.set(sx, 0.03, 0); cart.add(r); }
  for (let i = 0; i < 6; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.04, 0.14), dark); t.position.set(0, 0.01, -1.05 + i * 0.42); cart.add(t); }
  const tub = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.9), iron); tub.position.y = 0.42; cart.add(tub);
  const ore = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), new THREE.MeshLambertMaterial({ color: '#6a625a', flatShading: true })); ore.scale.set(0.9, 0.45, 1.3); ore.position.y = 0.66; cart.add(ore);
  for (const sx of [-0.3, 0.3]) for (const sz of [-0.3, 0.3]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10), iron); w.rotation.z = Math.PI / 2; w.position.set(sx, 0.12, sz); cart.add(w); }
  g.add(cart); return g;
}

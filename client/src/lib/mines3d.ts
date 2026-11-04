/** Mines: three.js cave scene (lazy-loaded). Map coords are (x, y) on the floor and z up; three.js is y-up, so (x, z, y). */
import * as THREE from 'three';
import { cityLabel, fitLabel } from './labelSprite';
import { applyPickSkin, skinnedPickaxe } from './pickaxeModel';
import { buildMineTool, animateMineTool, skinMineTool } from './mineToolModels';
import type { MineToolId } from '../../../shared/mineTools';
import { animateMiner, buildMiner, setMinerSkin, setMinerTool, type MinerRig } from './minerAvatar';
import { MINE_EXIT, ORES, type CaveId, type MineNode } from '../../../shared/mines';
import { levelOf, hasFloors, LADDER, MAX_FLOOR } from '../../../shared/mineFloors';
import { MOBS, type MobKind } from '../../../shared/mineCombat';

export interface MobView { id: number; k: MobKind; x: number; y: number; a: number; hp: number; max: number }
interface MobRig { root: THREE.Group; body: THREE.Object3D; wings?: THREE.Object3D[]; bar: THREE.Sprite; barBg: THREE.Sprite; hurt: number; kind: MobKind; hp: number; t: number }
const MG = new Map<string, THREE.BufferGeometry>();
const mg = <T extends THREE.BufferGeometry>(k: string, f: () => T): T => { let g = MG.get(k); if (!g) { g = f(); MG.set(k, g); } return g as T; };
/** Bat wing: scalloped membrane spanning from the body outwards (+z), finger bones along the leading edge. */
const batWingG = () => mg('batwing', () => { const s = new THREE.Shape(); s.moveTo(0, 0.08); s.lineTo(0.55, 0.12); s.quadraticCurveTo(0.42, -0.02, 0.5, -0.16); s.quadraticCurveTo(0.33, -0.08, 0.3, -0.2); s.quadraticCurveTo(0.18, -0.1, 0.1, -0.18); s.lineTo(0, -0.08); s.closePath(); const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); g.rotateY(Math.PI / 2); return g; });
function buildMob(kind: MobKind): MobRig {
  const d = MOBS[kind]; const root = new THREE.Group(); const col = new THREE.Color(d.color);
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: kind === 'slime' ? 0.15 : 0.6, metalness: kind === 'crab' ? 0.25 : 0, emissive: kind === 'golem' || kind === 'wraith' ? col : '#000', emissiveIntensity: kind === 'wraith' ? 0.6 : 0.35, transparent: kind === 'slime' || kind === 'wraith', opacity: kind === 'wraith' ? 0.75 : kind === 'slime' ? 0.78 : 1, flatShading: kind === 'golem' || kind === 'crab' });
  const dark = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.45), roughness: 0.8, emissive: '#000' });
  const eyeMat = new THREE.MeshBasicMaterial({ color: kind === 'wraith' ? '#ffffff' : kind === 'golem' ? '#ffe070' : '#ff3030' });
  const body = new THREE.Group(); let wings: THREE.Object3D[] | undefined;
  const M = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, p?: THREE.Object3D) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); (p ?? body).add(o); return o; };
  const eyes = (z: number, y: number, sp: number, r = 0.06) => { for (const s of [-1, 1]) M(mg('eye' + r, () => new THREE.SphereGeometry(r, 8, 6)), eyeMat, z, y, s * sp); };
  if (kind === 'slime') {
    const b = M(mg('slime', () => { const g = new THREE.SphereGeometry(0.45, 20, 14); const p = g.attributes.position as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < -0.1) p.setY(i, -0.1 - (y + 0.1) * 0.25); p.setX(i, p.getX(i) * (1 + Math.max(0, -y) * 0.5)); p.setZ(i, p.getZ(i) * (1 + Math.max(0, -y) * 0.5)); } g.computeVertexNormals(); return g; }), mat, 0, 0.36, 0); b.scale.set(1, 0.78, 1);
    const core = M(mg('core', () => new THREE.IcosahedronGeometry(0.15, 0)), new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.5), emissive: col, emissiveIntensity: 0.5, flatShading: true }), -0.05, 0.3, 0); core.rotation.set(0.5, 0.3, 0);
    for (let i = 0; i < 4; i++) M(mg('drip', () => new THREE.SphereGeometry(0.07, 8, 6)), mat, Math.cos(i * 1.7) * 0.42, 0.04, Math.sin(i * 1.7) * 0.42).scale.set(1.4, 0.45, 1.4);
    M(mg('shine', () => new THREE.SphereGeometry(0.08, 8, 6)), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }), 0.15, 0.58, -0.16).scale.set(1, 0.5, 1.6);
    eyes(0.36, 0.45, 0.14); const mouth = M(mg('mouth', () => new THREE.TorusGeometry(0.08, 0.018, 6, 12, Math.PI)), new THREE.MeshBasicMaterial({ color: '#103010' }), 0.4, 0.34, 0); mouth.rotation.set(0, Math.PI / 2, Math.PI);
  } else if (kind === 'bat') {
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
  } else if (kind === 'crab') {
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
  } else if (kind === 'golem') {
    const lava = new THREE.MeshBasicMaterial({ color: '#ffb040' });
    const rock = (k: string, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => { const o = M(mg('gr' + k, () => new THREE.DodecahedronGeometry(r, 0)), mat, x, y, z); o.scale.set(sx, sy, sz); o.rotation.set(x * 3, y * 2, z * 5); return o; };
    rock('t', 0.55, 0, 1.15, 0, 1, 1.05, 1.15); M(mg('gcore', () => new THREE.SphereGeometry(0.24, 10, 8)), lava, 0.36, 1.2, 0).scale.set(0.5, 1, 1);
    for (let i = 0; i < 4; i++) M(mg('crack', () => new THREE.BoxGeometry(0.02, 0.32, 0.05)), lava, 0.5, 0.95 + i * 0.14, -0.3 + i * 0.2).rotation.x = 0.5 * (i - 1.5);
    rock('h', 0.3, 0.05, 1.85, 0, 1, 0.9, 1); rock('s1', 0.26, 0, 1.55, 0.55); rock('s2', 0.26, 0, 1.55, -0.55);
    for (const s of [-1, 1]) { rock('a' + s, 0.2, 0.05, 1.15, s * 0.74, 1, 1.6, 1); rock('f' + s, 0.24, 0.12, 0.7, s * 0.78); rock('l' + s, 0.22, 0, 0.4, s * 0.27, 1, 1.6, 1); rock('k' + s, 0.2, 0.06, 0.12, s * 0.27, 1.3, 0.6, 1); }
    for (const s of [-1, 1]) M(mg('eyeg', () => new THREE.SphereGeometry(0.06, 8, 6)), eyeMat, 0.3, 1.88, s * 0.12);
  } else {
    const robe = M(mg('robe', () => { const g = new THREE.ConeGeometry(0.48, 1.55, 16, 4, true); const p = g.attributes.position as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.7) p.setY(i, p.getY(i) + Math.abs(Math.sin(i * 2.3)) * 0.22); g.computeVertexNormals(); return g; }), mat, 0, 1.15, 0); robe.rotation.x = Math.PI;
    (mat as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    const hood = M(mg('hood', () => new THREE.SphereGeometry(0.33, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62)), mat, 0, 1.96, 0); hood.rotation.z = -0.25;
    M(mg('void', () => new THREE.SphereGeometry(0.24, 10, 8)), new THREE.MeshBasicMaterial({ color: '#05020c' }), 0.1, 1.92, 0);
    eyes(0.3, 1.96, 0.08, 0.045);
    for (const s of [-1, 1]) { const arm = M(mg('warm', () => new THREE.ConeGeometry(0.1, 0.7, 8, 1, true)), mat, 0.18, 1.45, s * 0.4); arm.rotation.set(s * 0.5, 0, 1.2);
      for (let f = 0; f < 3; f++) { const c = M(mg('wclaw', () => new THREE.ConeGeometry(0.015, 0.16, 4)), eyeMat, 0.5, 1.32 - f * 0.03, s * (0.52 + f * 0.03)); c.rotation.z = -1.9; } }
    const glow = new THREE.Mesh(mg('wglow', () => new THREE.SphereGeometry(0.6, 12, 8)), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending })); glow.position.y = 1.3; glow.scale.set(1, 1.6, 1); body.add(glow);
  }
  root.add(body);
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#200a0a', depthWrite: false, fog: false })); const bar = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#ff4040', depthWrite: false, fog: false }));
  const top = kind === 'golem' ? 2.35 : kind === 'wraith' ? 2.5 : kind === 'bat' ? 2.0 : 1.05;
  bg.position.y = top; bar.position.y = top; bg.scale.set(0.9, 0.09, 1); bar.scale.set(0.86, 0.06, 1); bar.renderOrder = 6; bg.renderOrder = 5;
  root.add(bg); root.add(bar);
  return { root, body, wings, bar, barBg: bg, hurt: 0, kind, hp: -1, t: Math.random() * 6 };
}
function buildSword(): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.75, 0.015), new THREE.MeshStandardMaterial({ color: '#d8dde6', metalness: 0.8, roughness: 0.25, emissive: '#2a3040', emissiveIntensity: 0.3 })); blade.position.y = 0.48; g.add(blade);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.05), new THREE.MeshStandardMaterial({ color: '#8a6a30', metalness: 0.6 })); guard.position.y = 0.1; g.add(guard);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), new THREE.MeshStandardMaterial({ color: '#3a2414' })); g.add(grip);
  return g;
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

interface Particle { m: THREE.Mesh; v: THREE.Vector3; life: number; dust?: boolean; spark?: boolean }

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
  readonly floor: number;
  constructor(canvas: HTMLCanvasElement, caveId: CaveId = 'mine', floor = 1) {
    const cave = levelOf(caveId, floor); const MINE_MAP = cave.map; const MINE_NODES = cave.nodes; const T = cave.theme;
    this.floor = cave.floor; const classic = caveId === 'mine' && cave.floor < 10;
    this.caveNodes = MINE_NODES;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
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
    // Lanterns along the tunnels (cheap: emissive dots + a few lights).
    let lights = 0;
    for (const s of MINE_MAP.spawns.concat(MINE_NODES.filter((_, i) => i % 9 === 0).map((n) => [n.x, n.y, 0] as [number, number, number]))) {
      if (lights++ > 10) break;
      const l = new THREE.PointLight(T.lamp, T.hazard === 'lava' ? 1.6 : 1.2, T.hazard === 'lava' ? 11 : 9, 1.6); l.position.set(s[0], 3.2, s[1]); this.scene.add(l);
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
      const shiny = n.ore === 'gem' || n.ore === 'diamond' || n.ore === 'gold' || n.ore === 'silver' || n.ore === 'opal' || n.ore === 'pearl'; // #10d: Grotto-exclusive ores glow too
      const mat = new THREE.MeshStandardMaterial({ color: def.color, emissive: shiny ? def.color : '#000', emissiveIntensity: shiny ? 0.45 : 0, roughness: shiny ? 0.25 : 0.9, metalness: shiny ? 0.6 : 0, flatShading: true });
      const ore = new THREE.Group() as unknown as THREE.Mesh;
      for (let i = 0; i < 6; i++) {
        const c = new THREE.Mesh(n.ore === 'pearl' ? new THREE.SphereGeometry(0.12 + (i % 3) * 0.03, 12, 8) : n.ore === 'gem' || n.ore === 'diamond' || n.ore === 'opal' ? new THREE.OctahedronGeometry(0.14 + (i % 3) * 0.04) : new THREE.IcosahedronGeometry(0.13 + (i % 2) * 0.05, 0), mat);
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
    this.sword = buildSword(); this.sword.visible = false; this.camera.add(this.sword);
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
  /** Creatures on this floor (server ticks). hp 0 = dead (hidden until it respawns). */
  setMobs(list: MobView[]) {
    const seen = new Set<number>();
    for (const b of list) {
      let r = this.mobs.get(b.id);
      if (r && r.kind !== b.k) { this.scene.remove(r.root); this.mobs.delete(b.id); r = undefined; }
      if (!r) { r = buildMob(b.k); this.scene.add(r.root); this.mobs.set(b.id, r); }
      seen.add(b.id);
      if (r.hp >= 0 && b.hp < r.hp) r.hurt = 0.25;
      r.hp = b.hp; r.root.visible = b.hp > 0;
      r.root.position.set(b.x, 0, b.y); r.root.rotation.y = -b.a;
      const f = Math.max(0, Math.min(1, b.hp / b.max)); r.bar.scale.x = 0.86 * f;
      (r.bar.material as THREE.SpriteMaterial).color.set(f > 0.5 ? '#50e050' : f > 0.25 ? '#ffc030' : '#ff4040');
    }
    for (const [id, r] of this.mobs) if (!seen.has(id)) { this.scene.remove(r.root); this.mobs.delete(id); }
  }
  /** A hit landed on a creature (yours or another miner's): red flash + sparks. */
  mobHit(id: number, killed: boolean) {
    const r = this.mobs.get(id); if (!r) return; r.hurt = 0.3;
    const at = new THREE.Vector3(r.root.position.x, MOBS[r.kind].z + 0.2, r.root.position.z);
    for (let i = 0; i < (killed ? 26 : 10); i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: i % 2 ? MOBS[r.kind].color : '#ff3a2a' }));
      m.position.copy(at); this.scene.add(m);
      this.parts.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3 + 1, (Math.random() - 0.5) * 4), life: 0.5 + Math.random() * 0.4 });
    }
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
    if (this.sword.visible) { const k = this.swordT; const arc = Math.sin(k * Math.PI); this.sword.position.set(0.32 - k * 0.5, -0.32 + arc * 0.08, -0.55); this.sword.rotation.set(-0.4 - arc * 0.4, 0.2, -1.2 + k * 2.2); }
    const now = performance.now() / 1000;
    for (const r of this.mobs.values()) {
      r.t += dt;
      if (r.kind === 'slime') { const s = 1 + Math.sin(r.t * 5) * 0.12; r.body.scale.set(1 / s, s, 1 / s); }
      else if (r.kind === 'bat') { r.body.position.y = MOBS.bat.z + Math.sin(r.t * 3) * 0.2; r.wings?.forEach((w, i) => { w.rotation.x = (i ? 1 : -1) * Math.sin(now * 18) * 0.7; }); }
      else if (r.kind === 'wraith') r.body.position.y = Math.sin(r.t * 2) * 0.15;
      else if (r.kind === 'golem') r.body.rotation.z = Math.sin(r.t * 3) * 0.04;
      r.hurt = Math.max(0, r.hurt - dt);
      r.body.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m && 'emissive' in m && m.emissive) { if (m.userData.e0 === undefined) m.userData.e0 = m.emissive.getHex(); m.emissive.setHex(r.hurt > 0 ? 0xff2020 : m.userData.e0); } });
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt; p.v.y -= 9 * dt; p.m.position.addScaledVector(p.v, dt);
      if (p.m.position.y < 0.03) { p.m.position.y = 0.03; p.v.multiplyScalar(0.4); }
      if (p.dust) { p.v.y += 8.6 * dt; p.m.scale.multiplyScalar(1 + dt * 1.6); (p.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.35 * p.life); }
      if (p.spark) { p.m.lookAt(p.m.position.clone().add(p.v)); (p.m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, p.life * 4); }
      if (p.life <= 0) { this.scene.remove(p.m); (p.m.material as THREE.Material).dispose(); p.m.geometry.dispose(); this.parts.splice(i, 1); }
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

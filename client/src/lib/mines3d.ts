/** Mines: three.js cave scene (lazy-loaded). Map coords are (x, y) on the floor and z up; three.js is y-up, so (x, z, y). */
import * as THREE from 'three';
import { applyPickSkin, skinnedPickaxe } from './pickaxeModel';
import { animateMiner, buildMiner, setMinerSkin, type MinerRig } from './minerAvatar';
import { MINE_EXIT, MINE_MAP, MINE_NODES, ORES } from '../../../shared/mines';

export interface MinerView { id: string; name: string; x: number; y: number; z: number; a: number; c: boolean; sw: number; pk?: string | null }

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
  private others = new Map<string, MinerRig & { sw?: number }>();
  private parts: Particle[] = [];
  private pick: THREE.Group;
  private swingT = 1;
  private pickModel: THREE.Group;
  private pickSkin: string | null = null;
  private kick = 0;
  private hitDue = -1;
  private lamp: THREE.PointLight;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene.background = new THREE.Color('#0b0907');
    this.scene.fog = new THREE.Fog('#0b0907', 6, 26);
    this.scene.add(new THREE.AmbientLight('#8a7a6a', 0.55));
    this.lamp = new THREE.PointLight('#ffd9a0', 2.2, 14, 1.4); this.scene.add(this.lamp);
    const tex = rockTex();
    const wallMat = new THREE.MeshLambertMaterial({ map: tex, color: '#9a8f86' });
    for (const s of MINE_MAP.solids) {
      const w = s.x1 - s.x0, d = s.y1 - s.y0, h = s.z1 - s.z0;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(s.x0 + w / 2, s.z0 + h / 2, s.y0 + d / 2);
      this.scene.add(m);
    }
    const floorTex = tex.clone(); floorTex.repeat.set(MINE_MAP.w / 3, MINE_MAP.d / 3); floorTex.needsUpdate = true;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(MINE_MAP.w, MINE_MAP.d), new THREE.MeshLambertMaterial({ map: floorTex, color: '#6e6258' }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(MINE_MAP.w / 2, 0, MINE_MAP.d / 2); this.scene.add(floor);
    // Lanterns along the tunnels (cheap: emissive dots + a few lights).
    let lights = 0;
    for (const s of MINE_MAP.spawns.concat(MINE_NODES.filter((_, i) => i % 9 === 0).map((n) => [n.x, n.y, 0] as [number, number, number]))) {
      if (lights++ > 10) break;
      const l = new THREE.PointLight('#ff9a40', 1.2, 9, 1.6); l.position.set(s[0], 3.2, s[1]); this.scene.add(l);
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
    for (const n of MINE_NODES) {
      const def = ORES[n.ore];
      const g = new THREE.Group();
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), new THREE.MeshLambertMaterial({ color: '#5a524c', flatShading: true }));
      g.add(rock);
      const shiny = n.ore === 'gem' || n.ore === 'diamond' || n.ore === 'gold' || n.ore === 'silver';
      const mat = new THREE.MeshStandardMaterial({ color: def.color, emissive: shiny ? def.color : '#000', emissiveIntensity: shiny ? 0.45 : 0, roughness: shiny ? 0.25 : 0.9, metalness: shiny ? 0.6 : 0, flatShading: true });
      const ore = new THREE.Group() as unknown as THREE.Mesh;
      for (let i = 0; i < 6; i++) {
        const c = new THREE.Mesh(n.ore === 'gem' || n.ore === 'diamond' ? new THREE.OctahedronGeometry(0.14 + (i % 3) * 0.04) : new THREE.IcosahedronGeometry(0.13 + (i % 2) * 0.05, 0), mat);
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
    this.pickSkin = token ?? null; applyPickSkin(this.pickModel, this.pickSkin);
  }

  burstAt(node: number, big: boolean) {
    const n = MINE_NODES[node]; if (!n) return;
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
      setMinerSkin(g, p.pk ?? null);
      g.root.position.set(p.x, p.z - (p.c ? 0.3 : 0), p.y);
      g.root.rotation.y = -p.a;
      g.sw = p.sw;
    }
    for (const [id, g] of this.others) if (!seen.has(id)) { this.scene.remove(g.root); this.others.delete(id); }
  }

  render(cam: { x: number; y: number; z: number; a: number; p: number }, dt: number, walk: number) {
    this.camera.position.set(cam.x, cam.z, cam.y);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(cam.p, -cam.a - Math.PI / 2, 0);
    this.lamp.position.set(cam.x, cam.z + 0.4, cam.y);
    this.swingT = Math.min(1, this.swingT + dt / 0.5);
    const t = (globalThis as { __pickPoseT?: number }).__pickPoseT ?? this.swingT, bob = Math.sin(walk * 9) * 0.01, sway = Math.cos(walk * 4.5) * 0.008;
    // anticipation (slow raise, cock back + roll) → strike (accelerating arc) → impact hold + recoil → follow-through settle
    const ease = (x: number) => x * x * (3 - 2 * x);
    let rx = 0, rz = 0, dy = 0, dz = 0, dx = 0;
    if (t < 0.36) { const k = ease(t / 0.36); rx = 0.25 * k; rz = 0.12 * k; dy = 0.08 * k; dz = -0.02 * k; }
    else if (t < 0.5) { const k = (t - 0.36) / 0.14, e = k * k * k; rx = 0.25 - 1.25 * e; rz = 0.12 - 0.22 * e; dy = 0.08 - 0.13 * e; dz = -0.02 - 0.1 * e; dx = -0.1 * e; }
    else if (t < 0.58) { const k = Math.sin(((t - 0.5) / 0.08) * Math.PI); rx = -1.0 + 0.16 * k; rz = -0.1; dy = -0.05 + 0.02 * k; dz = -0.12 + 0.02 * k; dx = -0.1; }
    else { const k = ease((t - 0.58) / 0.42), o = Math.sin(k * Math.PI) * 0.12; rx = -1.0 * (1 - k) + o; rz = -0.1 * (1 - k); dy = -0.05 * (1 - k); dz = -0.12 * (1 - k); dx = -0.1 * (1 - k); }
    this.pick.position.set(0.36 + dx + sway, -0.33 + bob + dy, -0.6 + dz);
    this.pick.rotation.set(-0.12 + rx, 0.22, 0.3 + rz);
    if (this.hitDue < 0.5 && t >= 0.5) this.kick = Math.max(this.kick, 0.025);
    this.hitDue = t;
    this.kick = Math.max(0, this.kick - dt * 0.25);
    this.camera.rotation.x += this.kick;
    for (const g of this.others.values()) animateMiner(g, dt, g.sw ?? 0);
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

  dispose() { this.renderer.dispose(); }
}

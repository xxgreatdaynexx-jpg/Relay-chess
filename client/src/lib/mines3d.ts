/** Mines: three.js cave scene (lazy-loaded). Map coords are (x, y) on the floor and z up; three.js is y-up, so (x, z, y). */
import * as THREE from 'three';
import { MINE_MAP, MINE_NODES, ORES } from '../../../shared/mines';

export interface MinerView { id: string; name: string; x: number; y: number; z: number; a: number; c: boolean; sw: number }

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

interface Particle { m: THREE.Mesh; v: THREE.Vector3; life: number }

export class Mines3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 80);
  private nodes: Array<{ g: THREE.Group; ore: THREE.Mesh; crack: THREE.Mesh; max: number }> = [];
  private others = new Map<string, THREE.Group>();
  private parts: Particle[] = [];
  private pick: THREE.Group;
  private swingT = 1;
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
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.62, 8), new THREE.MeshLambertMaterial({ color: '#7a4f2a' }));
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.7, roughness: 0.4 }));
    head.position.y = 0.3;
    const tipL = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 6), head.material); tipL.rotation.z = Math.PI / 2; tipL.position.set(0.3, 0.3, 0);
    const tipR = tipL.clone(); tipR.rotation.z = -Math.PI / 2; tipR.position.x = -0.3;
    this.pick.add(handle, head, tipL, tipR);
    this.pick.scale.setScalar(0.62);
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

  burstAt(node: number, big: boolean) {
    const n = MINE_NODES[node]; if (!n) return;
    const col = new THREE.Color(ORES[n.ore].color);
    for (let i = 0; i < (big ? 26 : 8); i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: i % 3 ? col : new THREE.Color('#6b625a') }));
      m.position.set(n.x, n.z, n.y);
      this.scene.add(m);
      this.parts.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3), life: 0.6 + Math.random() * 0.4 });
    }
  }

  setOthers(list: MinerView[], meId: string) {
    const seen = new Set<string>();
    for (const p of list) {
      if (p.id === meId) continue;
      seen.add(p.id);
      let g = this.others.get(p.id);
      if (!g) {
        g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 4, 8), new THREE.MeshLambertMaterial({ color: '#c08a3e' }));
        body.position.y = 0.75;
        const hat = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#e8c020' }));
        hat.position.y = 1.55;
        g.add(body, hat);
        this.scene.add(g); this.others.set(p.id, g);
      }
      g.position.set(p.x, p.z - (p.c ? 0.3 : 0), p.y);
      g.rotation.y = -p.a;
    }
    for (const [id, g] of this.others) if (!seen.has(id)) { this.scene.remove(g); this.others.delete(id); }
  }

  render(cam: { x: number; y: number; z: number; a: number; p: number }, dt: number, walk: number) {
    this.camera.position.set(cam.x, cam.z, cam.y);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(cam.p, -cam.a - Math.PI / 2, 0);
    this.lamp.position.set(cam.x, cam.z + 0.4, cam.y);
    this.swingT = Math.min(1, this.swingT + dt / 0.35);
    const s = Math.sin(this.swingT * Math.PI);
    const bob = Math.sin(walk * 9) * 0.015;
    this.pick.position.set(0.3, -0.28 + bob - s * 0.06, -0.62 - s * 0.1);
    this.pick.rotation.set(-0.15 - s * 1.3, 0.5, 0.35);
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt; p.v.y -= 9 * dt; p.m.position.addScaledVector(p.v, dt);
      if (p.m.position.y < 0.03) { p.m.position.y = 0.03; p.v.multiplyScalar(0.4); }
      if (p.life <= 0) { this.scene.remove(p.m); p.m.geometry.dispose(); this.parts.splice(i, 1); }
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() { this.renderer.dispose(); }
}

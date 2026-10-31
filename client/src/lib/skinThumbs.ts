import * as THREE from 'three';
import { buildGun } from './arenaGuns';
import { applySkin, tickSkins } from './skinRender';
import { parseToken } from '../../../shared/skins';
import { WEAPON_ORDER, type WeaponId } from '../../../shared/fps';

/** Real Arena weapon meshes wearing a skin: cached 3/4-angle thumbnails (one shared offscreen renderer) + a live inspect view. */
const isWeapon = (w: string): w is WeaponId => (WEAPON_ORDER as readonly string[]).includes(w);

function stage(): { scene: THREE.Scene; cam: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f55, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 3, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xaac8ff, 1.0); rim.position.set(-3, 1, -2); scene.add(rim);
  return { scene, cam: new THREE.PerspectiveCamera(28, 1, 0.01, 50) };
}

/** Wrap a skinned gun in a pivot, centred, longest axis along X, scaled to unit length. */
export function skinnedModel(token: string): THREE.Group | null {
  const p = parseToken(token);
  if (!p || !isWeapon(p.skin.weapon)) return null;
  const g = buildGun(p.skin.weapon);
  applySkin(g.root, token);
  const box = new THREE.Box3().setFromObject(g.root); const size = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group(); inner.add(g.root); g.root.position.sub(c);
  if (size.z > size.x && size.z >= size.y) inner.rotation.y = Math.PI / 2; // barrel along z -> along x
  else if (size.y > size.x && size.y > size.z) inner.rotation.z = Math.PI / 2;
  const pivot = new THREE.Group(); pivot.add(inner); pivot.scale.setScalar(1 / Math.max(size.x, size.y, size.z, 1e-3));
  return pivot;
}
const frame = (cam: THREE.PerspectiveCamera, aspect: number) => { cam.aspect = aspect; cam.position.set(0, 0.18, 2.3); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix(); };
const pose = (m: THREE.Object3D, yaw: number, pitch: number) => { m.rotation.set(pitch, yaw, 0); };

let shared: { r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera } | null = null;
const cache = new Map<string, string>();
const queue: Array<{ key: string; token: string; size: number; done: (url: string | null) => void }> = [];
let pumping = false;

function pump() {
  if (pumping) return; pumping = true;
  const step = () => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 12) {
      const job = queue.shift()!;
      const hit = cache.get(job.key); if (hit) { job.done(hit); continue; }
      job.done(renderNow(job.token, job.size, job.key));
    }
    if (queue.length) requestAnimationFrame(step); else pumping = false;
  };
  requestAnimationFrame(step);
}
function renderNow(token: string, size: number, key: string): string | null {
  try {
    if (!shared) {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setClearColor(0x000000, 0); r.outputColorSpace = THREE.SRGBColorSpace;
      shared = { r, ...stage() };
    }
    const m = skinnedModel(token); if (!m) return null;
    shared.r.setSize(size, size, false); frame(shared.cam, 1);
    pose(m, -0.62, 0.32); shared.scene.add(m);
    shared.r.render(shared.scene, shared.cam);
    shared.scene.remove(m);
    const url = shared.r.domElement.toDataURL('image/png');
    cache.set(key, url); return url;
  } catch { return null; }
}
/** Thumbnail data URL for a skin token (cached; rendered a few per frame so a 385-item grid never stalls). */
export function skinThumb(token: string, size: number): Promise<string | null> {
  const key = `${token}@${size}`;
  const hit = cache.get(key); if (hit) return Promise.resolve(hit);
  return new Promise((done) => { queue.push({ key, token, size, done }); pump(); });
}

/** Live, drag-to-rotate inspect view. Returns a cleanup. */
export function mountInspect(canvas: HTMLCanvasElement, token: string): () => void {
  let r: THREE.WebGLRenderer;
  try { r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { return () => {}; }
  r.setClearColor(0x000000, 0); r.outputColorSpace = THREE.SRGBColorSpace; r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const { scene, cam } = stage();
  const m = skinnedModel(token); if (m) scene.add(m);
  let yaw = -0.62, pitch = 0.32, drag: { x: number; y: number } | null = null, idle = 0, raf = 0;
  const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); };
  const move = (e: PointerEvent) => { if (!drag) return; yaw += (e.clientX - drag.x) * 0.012; pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - drag.y) * 0.01)); drag = { x: e.clientX, y: e.clientY }; idle = performance.now(); };
  const up = () => { drag = null; idle = performance.now(); };
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  const loop = (t: number) => {
    const w = canvas.clientWidth || 240, h = canvas.clientHeight || 180;
    if (canvas.width !== Math.round(w * r.getPixelRatio()) || canvas.height !== Math.round(h * r.getPixelRatio())) r.setSize(w, h, false);
    if (!drag && t - idle > 2500) yaw += 0.006; // slow turntable when untouched
    frame(cam, w / h); if (m) pose(m, yaw, pitch); tickSkins(t);
    r.render(scene, cam); raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => { cancelAnimationFrame(raf); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); r.dispose(); };
}

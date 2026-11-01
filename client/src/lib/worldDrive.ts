/**
 * Driving on the city map + everyone else's cars. Hooks into world3d via setTick. Local car: arcade physics
 * (slower off-road, bounce off buildings, stay on the plate/above the shore), chase camera, pose sent at DRIVE_HZ.
 * Remote cars: 'drive_cars' snapshots, rendered ~150ms in the past and interpolated between snapshots; name tags;
 * capped at DRIVE_MAX_VISIBLE; far cars use the cheap (wheel-less) LOD.
 */
import * as THREE from 'three';
import type { World } from './world3d';
import { buildCar } from './carModels';
import { socket } from './net';
import { PLATE, shoreZ, roadClearance, obbHit, ROADS, type OBB } from './worldLayout';
import { CAR_BY_ID, carPhysics, DRIVE_HZ, DRIVE_MAX_VISIBLE, type CarModel } from '../../../shared/cars';

export type DriveInput = { up: boolean; down: boolean; left: boolean; right: boolean };
type Snap = [string, string, number, number, number, number, number];
type Remote = { name: string; key: string; obj: THREE.Group; tag: THREE.Sprite; lod: 'near' | 'far'; carId: string; color: number; buf: { t: number; x: number; z: number; a: number }[] };
const INTERP_MS = 160;

function nameTag(text: string): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d')!;
  x.font = 'bold 30px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const w = Math.min(250, x.measureText(text).width + 28); x.fillStyle = 'rgba(10,12,20,0.75)'; x.beginPath(); x.roundRect((256 - w) / 2, 8, w, 48, 14); x.fill();
  x.fillStyle = '#fff'; x.fillText(text.slice(0, 16), 128, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false })); s.scale.set(0.09, 0.0225, 1); s.center.set(0.5, 0); s.renderOrder = 10; return s;
}
const disposeSprite = (s: THREE.Sprite) => { s.material.map?.dispose(); s.material.dispose(); };
const lerpAngle = (a: number, b: number, t: number) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

/** Nearest road point + heading to (x, z): a safe spawn. */
export function spawnNear(x: number, z: number): { x: number; z: number; a: number } {
  let best = { x: 0, z: 0, a: 0, d: Infinity };
  for (const r of ROADS) for (let i = 0; i < r.pts.length - 1; i++) { const [px, pz] = r.pts[i], [qx, qz] = r.pts[i + 1]; const d = Math.hypot(px - x, pz - z); if (d < best.d && Math.abs(px) < PLATE - 4 && pz < shoreZ(px) - 4) best = { x: px, z: pz, a: Math.atan2(qz - pz, qx - px), d }; }
  return best;
}

export interface DriveHandlers { me: () => string | null; onNear: (id: string | null) => void; onSpeed?: (kmh: number) => void }
export function createDrive(world: World, h: DriveHandlers) {
  const { scene, camera, controls } = world; const solids: OBB[] = world.solids; const lm = world.lmBoxes;
  const remotes = new Map<string, Remote>();
  let mine: { obj: THREE.Group; model: CarModel; phys: ReturnType<typeof carPhysics>; x: number; z: number; a: number; v: number } | null = null;
  const input: DriveInput = { up: false, down: false, left: false, right: false }; const touch: DriveInput = { up: false, down: false, left: false, right: false };
  let sendAcc = 0; let near: string | null = null; const camPos = new THREE.Vector3(); const look = new THREE.Vector3();

  const hit = (x: number, z: number, r: number) => {
    if (Math.abs(x) > PLATE - 1 || Math.abs(z) > PLATE - 1 || z > shoreZ(x) - 1.5) return true;
    for (const o of solids) if (Math.abs(o.x - x) < 14 && Math.abs(o.z - z) < 14 && obbHit(o, x, z, r)) return true;
    return false;
  };
  const step = (dt: number) => {
    if (!mine) return; const m = mine, p = m.phys; const i = { up: input.up || touch.up, down: input.down || touch.down, left: input.left || touch.left, right: input.right || touch.right };
    const off = roadClearance(m.x, m.z) > 1; const vmax = off ? p.vmax * 0.4 : p.vmax;
    if (i.up) m.v += (m.v < 0 ? p.accel * 2.5 : p.accel) * dt; else if (i.down) m.v -= (m.v > 0 ? p.accel * 2.5 : p.accel * 0.6) * dt;
    else m.v -= Math.sign(m.v) * Math.min(Math.abs(m.v), (3 + Math.abs(m.v) * 0.25) * dt);
    if (off && Math.abs(m.v) > vmax) m.v -= Math.sign(m.v) * Math.min(Math.abs(m.v) - vmax, 20 * dt);
    m.v = Math.max(-p.reverse, Math.min(p.vmax, m.v));
    const steer = (i.left ? 1 : 0) - (i.right ? 1 : 0); const grip = Math.min(1, Math.abs(m.v) / 6) * Math.sign(m.v || 1) * (1 - Math.min(0.45, Math.abs(m.v) / p.vmax * 0.45));
    m.a += steer * p.steer * grip * dt;
    const nx = m.x + Math.cos(m.a) * m.v * dt, nz = m.z + Math.sin(m.a) * m.v * dt; const r = m.model.dims[1] * 0.5;
    if (!hit(nx, nz, r)) { m.x = nx; m.z = nz; } else if (!hit(nx, m.z, r)) { m.x = nx; m.v *= 0.7; } else if (!hit(m.x, nz, r)) { m.z = nz; m.v *= 0.7; } else m.v *= -0.3;
    m.obj.position.set(m.x, 0, m.z); m.obj.rotation.y = -m.a;
    // Nearby landmark → "Enter" prompt.
    let nb: string | null = null; for (const [id, o] of Object.entries(lm)) if (obbHit(o, m.x, m.z, 5)) { nb = id; break; }
    if (nb !== near) { near = nb; h.onNear(nb); }
    // Chase camera.
    const back = 9 + Math.abs(m.v) * 0.08; camPos.set(m.x - Math.cos(m.a) * back, 4.5 + Math.abs(m.v) * 0.03, m.z - Math.sin(m.a) * back);
    camera.position.lerp(camPos, 1 - Math.exp(-dt * 6)); look.set(m.x + Math.cos(m.a) * 4, 1.2, m.z + Math.sin(m.a) * 4); controls.target.lerp(look, 1 - Math.exp(-dt * 10)); camera.lookAt(controls.target);
    sendAcc += dt; if (sendAcc >= 1 / DRIVE_HZ) { sendAcc = 0; socket.emit('drive_state', { x: +m.x.toFixed(2), z: +m.z.toFixed(2), a: +m.a.toFixed(3), v: +m.v.toFixed(2) }); }
    h.onSpeed?.(Math.round(Math.abs(m.v) * 8.5));
  };
  const renderRemotes = () => {
    const now = performance.now() - INTERP_MS; const cam = camera.position;
    for (const r of remotes.values()) {
      const b = r.buf; while (b.length > 2 && b[1].t <= now) b.shift();
      let x = b[0].x, z = b[0].z, a = b[0].a;
      if (b.length > 1 && now > b[0].t) { const t = Math.min(1, (now - b[0].t) / Math.max(1, b[1].t - b[0].t)); x += (b[1].x - x) * t; z += (b[1].z - z) * t; a = lerpAngle(a, b[1].a, t); }
      r.obj.position.set(x, 0, z); r.obj.rotation.y = -a; r.tag.position.set(x, 3.2, z);
      const lod = Math.hypot(cam.x - x, cam.z - z) > 60 ? 'far' : 'near';
      if (lod !== r.lod) { scene.remove(r.obj); r.obj = buildCar(CAR_BY_ID.get(r.carId)!, r.color, lod); r.obj.position.set(x, 0, z); r.obj.rotation.y = -a; r.lod = lod; scene.add(r.obj); }
    }
  };
  const onCars = (list: Snap[]) => {
    const me = h.me()?.trim().toLowerCase(); const t = performance.now(); const seen = new Set<string>();
    for (const [name, carId, color, x, z, a] of list.slice(0, DRIVE_MAX_VISIBLE)) {
      const key = name.trim().toLowerCase(); if (key === me && mine) continue; const model = CAR_BY_ID.get(carId); if (!model) continue; seen.add(key);
      let r = remotes.get(key);
      if (r && (r.carId !== carId || r.color !== color)) { scene.remove(r.obj, r.tag); disposeSprite(r.tag); remotes.delete(key); r = undefined; }
      if (!r) { r = { name, key, obj: buildCar(model, color, 'far'), tag: nameTag(name), lod: 'far', carId, color, buf: [] }; scene.add(r.obj, r.tag); remotes.set(key, r); }
      r.buf.push({ t, x, z, a }); if (r.buf.length > 6) r.buf.shift();
    }
    for (const [k, r] of remotes) if (!seen.has(k)) { scene.remove(r.obj, r.tag); disposeSprite(r.tag); remotes.delete(k); }
  };
  const watch = () => socket.emit('drive_watch', true);
  socket.on('drive_cars', onCars); socket.on('connect', watch); if (socket.connected) watch();

  const keys: Record<string, keyof DriveInput> = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
  const kd = (e: KeyboardEvent) => { const k = keys[e.code]; if (!k || !mine || (e.target as HTMLElement)?.closest?.('input,textarea')) return; input[k] = true; e.preventDefault(); };
  const ku = (e: KeyboardEvent) => { const k = keys[e.code]; if (k) input[k] = false; };
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);

  world.setTick((dt) => { renderRemotes(); if (!mine) return false; step(dt); return true; });
  return {
    get driving() { return !!mine; },
    start(carId: string, color: number, from = 'dealer') {
      const model = CAR_BY_ID.get(carId); if (!model) return; this.stop(false);
      const o = lm[from] ?? { x: 0, z: 0 }; const sp = spawnNear(o.x, o.z);
      mine = { obj: buildCar(model, color, 'near'), model, phys: carPhysics(model), x: sp.x, z: sp.z, a: sp.a, v: 0 }; scene.add(mine.obj);
      mine.obj.position.set(sp.x, 0, sp.z); mine.obj.rotation.y = -sp.a; controls.enabled = false; controls.autoRotate = false;
      const r = remotes.get(h.me()?.trim().toLowerCase() ?? ''); if (r) { scene.remove(r.obj, r.tag); disposeSprite(r.tag); remotes.delete(r.key); }
    },
    stop(resetCam = true) {
      if (!mine) return; scene.remove(mine.obj); mine = null; socket.emit('drive_stop'); controls.enabled = true; near = null; h.onNear(null);
      Object.assign(input, { up: false, down: false, left: false, right: false });
      if (resetCam) { camera.position.set(camera.position.x, Math.max(camera.position.y, 40), camera.position.z + 30); }
    },
    touch(k: keyof DriveInput, on: boolean) { touch[k] = on; },
    remoteCount: () => remotes.size,
    dispose() {
      this.stop(false); world.setTick(null); socket.off('drive_cars', onCars); socket.off('connect', watch); socket.emit('drive_watch', false);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
      for (const r of remotes.values()) { scene.remove(r.obj, r.tag); disposeSprite(r.tag); } remotes.clear();
    },
  };
}
export type Drive = ReturnType<typeof createDrive>;

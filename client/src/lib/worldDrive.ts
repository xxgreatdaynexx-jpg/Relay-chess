/**
 * Driving on the city map + everyone else's cars. Hooks into world3d via setTick. Local car: arcade physics
 * (slower off-road, bounce off buildings, stay on the plate/above the shore), chase camera, pose sent at DRIVE_HZ.
 * Remote cars: 'drive_cars' snapshots, rendered ~150ms in the past and interpolated between snapshots; name tags;
 * capped at DRIVE_MAX_VISIBLE; far cars use the cheap (wheel-less) LOD.
 */
import * as THREE from 'three';
import { cityLabel } from './labelSprite';
import type { World } from './world3d';
import { buildCar } from './carModels';
import { socket } from './net';
import { PLATE, shoreZ, roadClearance, obbHit, ROADS, type OBB } from './worldLayout';
import { FLY_DEST, nearAirport, drivable, onVenueRoad, trackPoint, type LapEvent } from '../../../shared/venues';
import { CAR_BY_ID, DRIVE_HZ, DRIVE_MAX_VISIBLE, type CarModel } from '../../../shared/cars';
import { moddedPhysics, normMods, parseLook, NITRO_TOP, NITRO_ACCEL, NITRO_RECHARGE, STOCK_MODS, type CarMods } from '../../../shared/mechanic';
import { request } from './net';
import { stepCar } from '../../../shared/drivePhysics';
import { raceSpec, stepRace, collideWalls, collideCar, type RaceSpec, type RaceState } from '../../../shared/racePhysics';
import { RACETRACK } from '../../../shared/venues';
import { createRaceFx, rearWheels } from './raceFx';

export type DriveInput = { up: boolean; down: boolean; left: boolean; right: boolean; boost?: boolean; handbrake?: boolean };
/** Speedway race physics run inside the venue's grounds (a little margin so you're already in it at the gate). */
const onSpeedway = (x: number, z: number) => x > RACETRACK.x0 - 2 && x < RACETRACK.x1 + 2 && z > RACETRACK.z0 - 2 && z < RACETRACK.z1 + 2;
type Snap = [string, string, number, number, number, number, number, string?];
type Remote = { name: string; key: string; obj: THREE.Group; tag: THREE.Sprite; lod: 'near' | 'far'; carId: string; color: number; look: string; buf: { t: number; x: number; z: number; a: number }[]; rx: number; rz: number; rvx: number; rvz: number; ra: number };
const INTERP_MS = 160;

function nameTag(text: string): THREE.Sprite { // Chud City label look, sized to the full name
  const t = cityLabel(text, '#7fd0ff'); const d = t.userData as { w: number; h: number };
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, premultipliedAlpha: true, toneMapped: false, sizeAttenuation: false })); s.scale.set(0.09 * d.w, 0.0225 * d.h, 1); s.center.set(0.5, 0); s.renderOrder = 10; return s;
}
const disposeSprite = (s: THREE.Sprite) => { s.material.map?.dispose(); s.material.dispose(); };
const lerpAngle = (a: number, b: number, t: number) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

/** Nearest road point + heading to (x, z): a safe spawn. */
export function spawnNear(x: number, z: number): { x: number; z: number; a: number } {
  let best = { x: 0, z: 0, a: 0, d: Infinity };
  for (const r of ROADS) for (let i = 0; i < r.pts.length - 1; i++) { const [px, pz] = r.pts[i], [qx, qz] = r.pts[i + 1]; const d = Math.hypot(px - x, pz - z); if (d < best.d && Math.abs(px) < PLATE - 4 && pz < shoreZ(px) - 4) best = { x: px, z: pz, a: Math.atan2(qz - pz, qx - px), d }; }
  return best;
}

export interface DriveHandlers { me: () => string | null; onNear: (id: string | null) => void; onSpeed?: (kmh: number) => void; onRace?: (ev: Array<LapEvent & { text?: string; best?: boolean }>) => void; onNitro?: (n: { have: number; full: number; on: boolean } | null) => void; onDrift?: (on: boolean) => void }
export function createDrive(world: World, h: DriveHandlers) {
  const { scene, camera, controls } = world; const solids: OBB[] = world.solids; const lm = world.lmBoxes;
  const remotes = new Map<string, Remote>();
  let mine: { obj: THREE.Group; model: CarModel; mods: CarMods; phys: ReturnType<typeof moddedPhysics>; spec: RaceSpec; rs: RaceState; race: boolean; x: number; z: number; a: number; v: number; tank: number; spin: number; lean: number; pitch: number } | null = null; let nitroSent = '';
  const fx = createRaceFx(scene); let shake = 0; const baseFov = camera.fov; let fovSet = baseFov;
  const input: DriveInput = { up: false, down: false, left: false, right: false, handbrake: false }; const touch: DriveInput = { up: false, down: false, left: false, right: false, handbrake: false };
  let sendAcc = 0; let near: string | null = null; let camYaw = 0; const camPos = new THREE.Vector3(); const look = new THREE.Vector3();

  const hit = (x: number, z: number, r: number) => {
    if (!drivable(x, z, 1)) return true; // city plate (above the shore) or a venue's grounds
    for (const o of solids) if (Math.abs(o.x - x) < 14 && Math.abs(o.z - z) < 14 && obbHit(o, x, z, r)) return true;
    return false;
  };
  const step = (dt: number) => {
    if (!mine) return; const m = mine, p = m.phys; const i = { up: input.up || touch.up, down: input.down || touch.down, left: input.left || touch.left, right: input.right || touch.right };
    const off = roadClearance(m.x, m.z) > 1 && !onVenueRoad(m.x, m.z); const r = m.model.dims[1] * 0.5;
    let boost = false; let skid = 0, steerVis = 0, ax = 0, ay = 0;
    const raceNow = onSpeedway(m.x, m.z);
    if (raceNow) {
      // Speedway: real race physics (velocity ≠ heading, weight transfer, grip limit, handbrake drifts) at 120 Hz.
      const rs = m.rs; if (!m.race) { Object.assign(rs, { x: m.x, z: m.z, a: m.a, vx: Math.cos(m.a) * m.v, vz: Math.sin(m.a) * m.v, w: 0, steer: 0, tank: m.tank }); m.race = true; }
      const ri = { ...i, boost: !!(input.boost || touch.boost), handbrake: !!(input.handbrake || touch.handbrake) }; const cr = m.model.dims[0] * 0.42;
      const n = Math.max(1, Math.ceil(dt * 120)); const h2 = dt / n;
      for (let k = 0; k < n; k++) {
        const px0 = rs.x, pz0 = rs.z; const o = stepRace(rs, m.spec, ri, h2, off); boost = o.boost; skid = Math.max(skid * (k ? 1 : 0), o.skid); ax = o.ax; ay = o.ay;
        let impact = collideWalls(rs, px0, pz0, r + 0.15);
        for (const rm of remotes.values()) { const om = CAR_BY_ID.get(rm.carId); if (!om || Math.abs(rm.rx - rs.x) > 6 || Math.abs(rm.rz - rs.z) > 6) continue;
          impact = Math.max(impact, collideCar(rs, m.spec.mass, cr, { x: rm.rx, z: rm.rz, vx: rm.rvx, vz: rm.rvz, r: om.dims[0] * 0.42, mass: raceSpec(om, STOCK_MODS).mass })); }
        if (hit(rs.x, rs.z, r)) { rs.x = px0; rs.z = pz0; rs.vx *= -0.3; rs.vz *= -0.3; impact = Math.max(impact, 5); }
        if (impact > 3) shake = Math.min(1, shake + impact / 25);
      }
      m.x = rs.x; m.z = rs.z; m.a = rs.a; m.tank = rs.tank; m.v = Math.cos(rs.a) * rs.vx + Math.sin(rs.a) * rs.vz; steerVis = rs.steer;
    } else {
      m.race = false; boost = stepCar(m, p, { ...i, boost: !!(input.boost || touch.boost) }, dt, off);
      const nx = m.x + Math.cos(m.a) * m.v * dt, nz = m.z + Math.sin(m.a) * m.v * dt;
      if (!hit(nx, nz, r)) { m.x = nx; m.z = nz; } else if (!hit(nx, m.z, r)) { m.x = nx; m.v *= 0.7; } else if (!hit(m.x, nz, r)) { m.z = nz; m.v *= 0.7; } else m.v *= -0.3;
      steerVis = ((i.right ? 1 : 0) - (i.left ? 1 : 0)) * 0.4; ax = 0; ay = m.v * ((i.right ? 1 : 0) - (i.left ? 1 : 0)) * p.steer * 0.3;
    }
    // Body: lean into the corner (roll) and squat/dive (pitch), softer with better suspension; wheels spin and steer.
    const soft = m.spec.transfer; m.lean += (Math.max(-0.12, Math.min(0.12, -ay * 0.006 * soft)) - m.lean) * Math.min(1, dt * 8); m.pitch += (Math.max(-0.06, Math.min(0.06, ax * 0.008 * soft)) - m.pitch) * Math.min(1, dt * 8);
    m.spin += m.v * dt / 0.3;
    m.obj.position.set(m.x, 0, m.z); m.obj.rotation.set(m.lean, -m.a, m.pitch, 'YXZ');
    m.obj.traverse((c) => { const wl = c.userData.wheel as string | undefined; if (!wl) return; c.rotation.set(0, wl === 'f' ? -steerVis : 0, -m.spin); });
    if (raceNow || skid > 0) fx.tyres('me', rearWheels(m.x, m.z, m.a, m.model.dims[0] * 0.32, m.model.dims[1] * 0.45), skid, dt); 
    // Nearby landmark → "Enter" prompt.
    let nb: string | null = null; for (const [id, o] of Object.entries(lm)) if (obbHit(o, m.x, m.z, 5)) { nb = id; break; }
    if (!nb && nearAirport(m.x, m.z)) nb = 'airport'; // the whole airport (and FLY_FROM_R round the terminal) offers Fly
    if (nb !== near) { near = nb; h.onNear(nb); }
    // Chase camera.
    // On the Speedway the chase cam swings toward where the car is actually going (so a drift shows the car sideways), with
    // a speed FOV kick and a little shake on impacts. City: the classic chase cam.
    let ca = m.a; if (m.race) { const sp = Math.hypot(m.rs.vx, m.rs.vz); if (sp > 3) { const va = Math.atan2(m.rs.vz, m.rs.vx); let d = va - m.a; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) < 1.6) ca = m.a + d * 0.6; } }
    camYaw = m.race ? lerpAngle(camYaw, ca, 1 - Math.exp(-dt * 5)) : ca;
    const back = 9 + Math.abs(m.v) * 0.08; camPos.set(m.x - Math.cos(camYaw) * back, 4.5 + Math.abs(m.v) * 0.03, m.z - Math.sin(camYaw) * back);
    if (shake > 0) { camPos.x += (Math.random() - 0.5) * shake * 0.8; camPos.y += (Math.random() - 0.5) * shake * 0.5; shake = Math.max(0, shake - dt * 2.5); }
    camera.position.lerp(camPos, 1 - Math.exp(-dt * 6)); look.set(m.x + Math.cos(camYaw) * 4, 1.2, m.z + Math.sin(camYaw) * 4); controls.target.lerp(look, 1 - Math.exp(-dt * 10)); camera.lookAt(controls.target);
    const wantFov = m.race ? baseFov + Math.min(14, Math.abs(m.v) * 0.3) : baseFov; if (Math.abs(wantFov - fovSet) > 0.05) { fovSet += (wantFov - fovSet) * Math.min(1, dt * 3); camera.fov = fovSet; camera.updateProjectionMatrix(); }
    h.onDrift?.(m.race && skid > 0.3);
    sendAcc += dt; if (sendAcc >= 1 / DRIVE_HZ) { sendAcc = 0; socket.emit('drive_state', { x: +m.x.toFixed(2), z: +m.z.toFixed(2), a: +m.a.toFixed(3), v: +m.v.toFixed(2) }); }
    h.onSpeed?.(Math.round(Math.abs(m.v) * 8.5));
    if (p.nitro > 0) { const k = `${m.tank.toFixed(1)}|${boost}`; if (k !== nitroSent) { nitroSent = k; h.onNitro?.({ have: m.tank, full: p.nitro, on: boost }); } }
  };
  const renderRemotes = () => {
    const now = performance.now() - INTERP_MS; const cam = camera.position;
    for (const r of remotes.values()) {
      const b = r.buf; while (b.length > 2 && b[1].t <= now) b.shift();
      let x = b[0].x, z = b[0].z, a = b[0].a;
      if (b.length > 1 && now > b[0].t) { const t = Math.min(1, (now - b[0].t) / Math.max(1, b[1].t - b[0].t)); x += (b[1].x - x) * t; z += (b[1].z - z) * t; a = lerpAngle(a, b[1].a, t); }
      r.obj.position.set(x, 0, z); r.obj.rotation.y = -a; r.tag.position.set(x, 3.2, z);
      // Other drivers' slides: snapshot velocity vs heading → their skid marks + smoke (and a velocity for car-car hits).
      if (b.length > 1) { const dtb = Math.max(0.05, (b[b.length - 1].t - b[b.length - 2].t) / 1000); r.rvx = (b[b.length - 1].x - b[b.length - 2].x) / dtb; r.rvz = (b[b.length - 1].z - b[b.length - 2].z) / dtb; }
      r.rx = x; r.rz = z; r.ra = a;
      const sp = Math.hypot(r.rvx, r.rvz); let k = 0;
      if (sp > 5 && onSpeedway(x, z)) { let d = Math.atan2(r.rvz, r.rvx) - a; d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d))); if (d < 2) k = Math.max(0, Math.min(1, (d - 0.15) * 3)); }
      const md = CAR_BY_ID.get(r.carId); if (md && Math.hypot(cam.x - x, cam.z - z) <= 60) fx.tyres(r.key, rearWheels(x, z, a, md.dims[0] * 0.32, md.dims[1] * 0.45), k, 1 / 60); else fx.forget(r.key);
      const lod = Math.hypot(cam.x - x, cam.z - z) > 60 ? 'far' : 'near';
      if (lod !== r.lod) { scene.remove(r.obj); r.obj = buildCar(CAR_BY_ID.get(r.carId)!, r.color, lod, parseLook(r.look)); r.obj.position.set(x, 0, z); r.obj.rotation.y = -a; r.lod = lod; scene.add(r.obj); }
    }
  };
  const onCars = (list: Snap[]) => {
    const me = h.me()?.trim().toLowerCase(); const t = performance.now(); const seen = new Set<string>();
    for (const [name, carId, color, x, z, a, , lk] of list.slice(0, DRIVE_MAX_VISIBLE)) { const look = lk ?? '';
      const key = name.trim().toLowerCase(); if (key === me && mine) continue; const model = CAR_BY_ID.get(carId); if (!model) continue; seen.add(key);
      let r = remotes.get(key);
      if (r && (r.carId !== carId || r.color !== color || r.look !== look)) { scene.remove(r.obj, r.tag); disposeSprite(r.tag); remotes.delete(key); r = undefined; }
      if (!r) { r = { name, key, obj: buildCar(model, color, 'far', parseLook(look)), tag: nameTag(name), lod: 'far', carId, color, look, buf: [], rx: x, rz: z, rvx: 0, rvz: 0, ra: a }; scene.add(r.obj, r.tag); remotes.set(key, r); }
      r.buf.push({ t, x, z, a }); if (r.buf.length > 6) r.buf.shift();
    }
    for (const [k, r] of remotes) if (!seen.has(k)) { scene.remove(r.obj, r.tag); disposeSprite(r.tag); remotes.delete(k); }
  };
  const onRace = (ev: Array<LapEvent & { text?: string; best?: boolean }>) => { if (mine) h.onRace?.(ev); };
  const watch = () => socket.emit('drive_watch', true);
  socket.on('race_ev', onRace); socket.on('drive_cars', onCars); socket.on('connect', watch); if (socket.connected) watch();

  const keys: Record<string, keyof DriveInput> = { ShiftLeft: 'boost', ShiftRight: 'boost', KeyN: 'boost', KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'handbrake' };
  const kd = (e: KeyboardEvent) => { const k = keys[e.code]; if (!k || !mine || (e.target as HTMLElement)?.closest?.('input,textarea')) return; input[k] = true; e.preventDefault(); };
  const ku = (e: KeyboardEvent) => { const k = keys[e.code]; if (k) input[k] = false; };
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);

  world.setTick((dt) => { renderRemotes(); fx.step(dt); if (!mine) return false; step(dt); return true; });
  return {
    get driving() { return !!mine; },
    start(carId: string, color: number, from = 'dealer') {
      const model = CAR_BY_ID.get(carId); if (!model) return; this.stop(false);
      // 'grid' = the Speedway start line (just behind it, facing the first straight); otherwise the road nearest a landmark.
      let sp: { x: number; z: number; a: number };
      if (from === 'grid') { const [x, z, a] = trackPoint(0.985); sp = { x, z, a }; } else if (from === 'airport') { const d = FLY_DEST.airport; sp = { x: d.x, z: d.z, a: d.a }; } else { const o = lm[from] ?? { x: 0, z: 0 }; sp = spawnNear(o.x, o.z); }
      const mods = { ...STOCK_MODS }; mine = { obj: buildCar(model, color, 'near'), model, mods, phys: moddedPhysics(model, mods), spec: raceSpec(model, mods), rs: { x: sp.x, z: sp.z, a: sp.a, vx: 0, vz: 0, w: 0, steer: 0, tank: 0 }, race: false, x: sp.x, z: sp.z, a: sp.a, v: 0, tank: 0, spin: 0, lean: 0, pitch: 0 }; camYaw = sp.a; scene.add(mine.obj); h.onNitro?.(null); nitroSent = '';
      // Mechanic Shop mods for the active car (the server checks speed against the same numbers).
      const want = mine; void request('car_garage').then((a) => {
        const c = a.ok ? (a as unknown as { cars?: Array<{ carId: string; active: boolean; mods?: unknown }> }).cars?.find((x) => x.active && x.carId === carId) : undefined;
        if (!c || mine !== want) return; const md = normMods(c.mods); want.mods = md; want.phys = moddedPhysics(model, md); want.spec = raceSpec(model, md); want.tank = want.phys.nitro; want.rs.tank = want.tank;
        const o = buildCar(model, color, 'near', md); o.position.copy(want.obj.position); o.rotation.copy(want.obj.rotation); scene.remove(want.obj); want.obj = o; scene.add(o);
      }).catch(() => {});
      mine.obj.position.set(sp.x, 0, sp.z); mine.obj.rotation.y = -sp.a; controls.enabled = false; controls.autoRotate = false;
      const r = remotes.get(h.me()?.trim().toLowerCase() ?? ''); if (r) { scene.remove(r.obj, r.tag); disposeSprite(r.tag); remotes.delete(r.key); }
    },
    stop(resetCam = true) {
      if (!mine) return; scene.remove(mine.obj); mine = null; fx.forget('me'); if (camera.fov !== baseFov) { camera.fov = fovSet = baseFov; camera.updateProjectionMatrix(); } h.onDrift?.(false); socket.emit('drive_stop'); controls.enabled = true; near = null; h.onNear(null);
      Object.assign(input, { up: false, down: false, left: false, right: false, boost: false, handbrake: false }); h.onNitro?.(null);
      if (resetCam) { camera.position.set(camera.position.x, Math.max(camera.position.y, 40), camera.position.z + 30); }
    },
    touch(k: keyof DriveInput, on: boolean) { touch[k] = on; },
    /** Airport fast travel: the server moves our accepted pose, then we jump the car there. */
    fly(to: string): Promise<{ ok: boolean; error?: string }> {
      return new Promise((res) => {
        if (!mine) return res({ ok: false, error: 'Drive to the airport first.' });
        socket.timeout(5000).emit('drive_fly', { to }, (err: unknown, r?: { ok: boolean; error?: string; x?: number; z?: number; a?: number }) => {
          if (err || !r) return res({ ok: false, error: 'No response. Try again.' });
          if (r.ok && mine && r.x != null && r.z != null) { Object.assign(mine, { x: r.x, z: r.z, a: r.a ?? 0, v: 0, race: false }); mine.obj.position.set(r.x, 0, r.z); mine.obj.rotation.y = -(r.a ?? 0); camera.position.set(r.x, 60, r.z + 40); }
          res(r);
        });
      });
    },
    remoteCount: () => remotes.size,
    dispose() {
      this.stop(false); world.setTick(null); socket.off('drive_cars', onCars); socket.off('race_ev', onRace); socket.off('connect', watch); socket.emit('drive_watch', false);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
      for (const r of remotes.values()) { scene.remove(r.obj, r.tag); disposeSprite(r.tag); } remotes.clear(); fx.dispose();
    },
  };
}
export type Drive = ReturnType<typeof createDrive>;

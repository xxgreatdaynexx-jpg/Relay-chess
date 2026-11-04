/**
 * Speedway race physics (Millionaire Update). A planar "bicycle model": the car has a velocity vector separate from its
 * heading, a yaw rate, front/rear axle loads with weight transfer under throttle/brake, a tyre grip limit (friction
 * circle on the driven rear axle) and a handbrake that drops rear grip so the tail steps out (drifting). City streets keep
 * the arcade model in drivePhysics.ts; this one runs on the Speedway grounds. Pure, deterministic, shared client/tests.
 *
 * Units: map units (1 u ≈ 2.4 m), seconds. Heading `a`: forward is (cos a, sin a); a growing `a` turns right on screen.
 * Top speed / acceleration come from the same moddedPhysics numbers, so the server's speed checks are unchanged.
 */
import type { CarModel } from './cars.js';
import { moddedPhysics, NITRO_ACCEL, NITRO_RECHARGE, NITRO_TOP, type CarMods } from './mechanic.js';
import { TRACK } from './venues.js';

/** Game-scale gravity (u/s²): tuned so a stock sports car takes the hairpins (R 24) at ~130-150 km/h on the limit. */
export const RACE_G = 13;
/** Tyre grip per Mechanic Shop tyre tier (multiplies μ), and suspension tier → less weight transfer / body roll. */
export const TIRE_MU = [1, 1.07, 1.14, 1.22];
export const SUSP_TRANSFER = [1, 0.88, 0.76, 0.64];
export const HANDBRAKE_REAR_MU = 0.3; // rear grip while the handbrake is held

export interface RaceSpec {
  mass: number; lf: number; lr: number; cgH: number; inertia: number;
  mu: number; vmax: number; accel: number; reverse: number; maxSteer: number; transfer: number; nitro: number; offroad: number;
}
const MASS: Record<string, number> = { cart: 0.35, hatch: 1.0, wagon: 1.2, van: 1.6, sedan: 1.3, taxi: 1.3, suv: 1.8, pickup: 1.9, muscle: 1.5, coupe: 1.2, super: 1.25, monster: 2.8, limo: 2.2 };

export function raceSpec(c: CarModel, mods: CarMods): RaceSpec {
  const p = moddedPhysics(c, mods); const [L, , H] = c.dims; const wb = L * 0.64;
  const mass = MASS[c.style] ?? 1.3; const mu = (0.85 + c.handling * 0.045) * TIRE_MU[mods.tires]!; // handling 1..10 → μ 0.9..1.3
  return {
    mass, lf: wb * 0.48, lr: wb * 0.52, cgH: H * (c.style === 'monster' ? 0.9 : 0.45), inertia: mass * (L * L) / 10,
    mu, vmax: p.vmax, accel: p.accel, reverse: p.reverse, maxSteer: 0.5 + Math.min(0.15, p.steer * 0.03), transfer: SUSP_TRANSFER[mods.handling]!, nitro: p.nitro, offroad: p.offroad,
  };
}

export type RaceInput = { up: boolean; down: boolean; left: boolean; right: boolean; boost?: boolean; handbrake?: boolean };
export interface RaceState { x: number; z: number; a: number; vx: number; vz: number; w: number; steer: number; tank: number }
export interface RaceOut { v: number; slip: number; skid: number; boost: boolean; ax: number; ay: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** One fixed physics step (call at ~120 Hz). Mutates `s`. Returns forward speed, slip angle, skid intensity 0..1 and nitro. */
export function stepRace(s: RaceState, p: RaceSpec, i: RaceInput, dt: number, off = false): RaceOut {
  const ca = Math.cos(s.a), sa = Math.sin(s.a);
  let vf = s.vx * ca + s.vz * sa; let vl = -s.vx * sa + s.vz * ca; // forward / right components
  const speed = Math.hypot(vf, vl);
  const boost = !!i.boost && i.up && p.nitro > 0 && s.tank > 0.05 && vf >= 0;
  s.tank = boost ? Math.max(0, s.tank - dt) : Math.min(p.nitro, s.tank + NITRO_RECHARGE * dt);
  const vtop = (boost ? p.vmax * NITRO_TOP : p.vmax) * (off ? p.offroad : 1); const acc = boost ? p.accel * NITRO_ACCEL : p.accel;
  // Steering: speed-sensitive lock, smoothed (a wheel can't snap from lock to lock).
  const want = ((i.right ? 1 : 0) - (i.left ? 1 : 0)) * p.maxSteer / (1 + Math.max(0, vf) / 45);
  s.steer += clamp(want - s.steer, -3 * dt, 3 * dt);
  const m = p.mass, G = RACE_G, wb = p.lf + p.lr;
  // Longitudinal demand (per unit mass).
  let drive = 0, brake = 0;
  if (i.up) { if (vf < -0.5) brake = acc * 2.5; else drive = acc * Math.max(0, Math.min(1, 5 * (1 - vf / vtop))) + (vf > vtop ? -(vf - vtop) * 2 : 0); }
  else if (i.down) { if (vf > 0.5) brake = p.accel * 2.6; else drive = -p.accel * 0.6 * (vf > -p.reverse ? 1 : 0); }
  const roll = i.up ? 0.05 : 0.6 + speed * 0.06; // rolling + aero drag when coasting (on throttle it's folded into the taper)
  const lowSpeed = Math.abs(vf) < 3;
  let ax = 0, ay = 0, slip = 0, skid = 0;
  if (lowSpeed || vf < 0) {
    // Kinematic regime (parking / reversing): rolls where the wheels point, no slip.
    const k = Math.min(1, Math.abs(vf) / 3 + 0.2);
    vf += (drive - Math.sign(vf) * (brake + (i.up || i.down ? 0 : roll * 3))) * dt; if (!i.up && !i.down && Math.abs(vf) < 0.15) vf = 0;
    if (brake && Math.sign(vf) !== Math.sign(vf - Math.sign(vf) * brake * dt)) vf = 0;
    vl *= Math.exp(-12 * dt * k);
    s.w = vf * Math.tan(s.steer) / wb; ax = drive;
  } else {
    // Loads with longitudinal weight transfer (from last step's ax approximated by the demand).
    const axDemand = drive - brake; const dN = m * axDemand * p.cgH / wb * p.transfer;
    const Nf = Math.max(0.1, m * G * p.lr / wb - dN), Nr = Math.max(0.1, m * G * p.lf / wb + dN);
    const muF = p.mu * (off ? 0.7 : 1), muR = p.mu * (off ? 0.7 : 1) * (i.handbrake ? HANDBRAKE_REAR_MU : 1);
    // Slip angles and saturating lateral forces (linear then capped at μN).
    const af = Math.atan2(vl + s.w * p.lf, vf) - s.steer, ar = Math.atan2(vl - s.w * p.lr, vf);
    const Cf = Nf * 14, Cr = Nr * 14;
    // Tyre curve past the peak: a sliding tyre grips less than a gripping one, so a slide keeps going on throttle.
    const slideF = Math.abs(af) > 0.14 ? 0.9 : 1, slideR = Math.abs(ar) > 0.12 ? 0.8 : 1;
    let Fyf = clamp(-Cf * af, -muF * slideF * Nf, muF * slideF * Nf);
    // Rear: friction circle shared with drive/brake force; handbrake locks the rear (adds drag).
    let Fx = m * drive - m * brake * 0.4 - (i.handbrake ? m * Math.min(3, vf * 0.25) : 0);
    const Fxf = -m * brake * 0.6;
    let Fyr = -Cr * ar; const capR = muR * slideR * Nr; const tot = Math.hypot(Fx, Fyr);
    if (tot > capR) { Fx *= capR / tot; Fyr *= capR / tot; }
    const capF = muF * slideF * Nf; const totF = Math.hypot(Fxf, Fyf); if (totF > capF) Fyf *= capF / totF;
    const cs = Math.cos(s.steer), sn = Math.sin(s.steer);
    ax = (Fx + Fxf * cs - Fyf * sn) / m - Math.sign(vf) * roll;
    ay = (Fyr + Fyf * cs + Fxf * sn) / m;
    const torque = p.lf * (Fyf * cs + Fxf * sn) - p.lr * Fyr;
    s.w += torque / p.inertia * dt; s.w *= Math.exp(-0.6 * dt); // a little yaw damping (dampers / tyre scrub)
    vf += ax * dt; vl += ay * dt;
    if (!i.up && i.down && vf < 0.5) vf = Math.max(vf, 0);
    slip = Math.atan2(Math.abs(vl), Math.max(1, Math.abs(vf)));
    const sat = Math.max(Math.abs(Fyr) / Math.max(1e-6, capR), tot > capR ? 1 : 0);
    skid = clamp((slip - 0.12) * 4, 0, 1) * clamp(speed / 8, 0, 1); if (i.handbrake && speed > 4) skid = Math.max(skid, 0.6); if (sat >= 0.999 && Math.abs(drive) > 0 && speed < 12) skid = Math.max(skid, 0.4);
  }
  s.a += s.w * dt;
  // Dynamic regime: forces were applied in the old body frame and the world velocity does not turn with the car, so a
  // car that yaws faster than its tyres can bend the velocity ends up sideways (that's the drift). Kinematic regime: the
  // velocity follows the wheels.
  const kin = lowSpeed || vf < 0; const c2 = kin ? Math.cos(s.a) : ca, s2 = kin ? Math.sin(s.a) : sa;
  s.vx = vf * c2 - vl * s2; s.vz = vf * s2 + vl * c2;
  const sp = Math.hypot(s.vx, s.vz), cap = Math.max(p.reverse, vtop * 1.02); if (sp > cap && vf >= 0) { s.vx *= cap / sp; s.vz *= cap / sp; }
  if (vf < -p.reverse) { const k = p.reverse / -vf; s.vx *= k; s.vz *= k; }
  s.x += s.vx * dt; s.z += s.vz * dt;
  return { v: vf, slip, skid, boost, ax, ay };
}

// ---- Speedway barriers ----
/** Signed distance from the track centreline: + outside the oval, − toward the infield. */
export function trackOffset(x: number, z: number): { s: number; nx: number; nz: number } {
  const dx = Math.abs(x - TRACK.cx) - TRACK.L, dz = z - TRACK.cz;
  if (dx <= 0) return { s: Math.abs(dz) - TRACK.R, nx: 0, nz: Math.sign(dz) || 1 };
  const r = Math.hypot(dx, dz) || 1; return { s: r - TRACK.R, nx: Math.sign(x - TRACK.cx) * dx / r, nz: dz / r };
}
/** Barriers sit this far from the centreline (inside OFF_TRACK, so being shoved into a wall never voids a lap). */
export const WALL_OUT = TRACK.W / 2 + 1.6, WALL_IN = -(TRACK.W / 2 + 1.6);
/** Gaps: the access road joins the outer edge of the start straight at x=-80; the pit lane is inside the start straight. */
export const OUTER_GAP = { x: -80, half: 4.2 };
export function wallOpen(which: 'out' | 'in', x: number, z: number): boolean {
  const onStart = Math.abs(x - TRACK.cx) <= TRACK.L && z > TRACK.cz;
  if (which === 'out') return onStart && Math.abs(x - OUTER_GAP.x) < OUTER_GAP.half;
  return onStart; // inner wall is open along the start straight (pit lane)
}
/**
 * Keep a car of radius r on its side of the Speedway barriers. `prev` is where it was before this step. Returns the
 * impact speed (u/s, 0 = no hit). Mutates s (position + velocity: restitution 0.3, scrapes keep 85% of tangential speed).
 */
export function collideWalls(s: RaceState, prevX: number, prevZ: number, r: number): number {
  let hit = 0;
  for (const [which, S] of [['out', WALL_OUT], ['in', WALL_IN]] as const) {
    if (wallOpen(which, s.x, s.z)) continue;
    const before = trackOffset(prevX, prevZ).s - S; const o = trackOffset(s.x, s.z); const now = o.s - S;
    const side = Math.sign(before) || -Math.sign(S);
    if (Math.abs(before) > 6 && Math.abs(now) > 6) continue; // nowhere near this wall
    if (side * now >= r) continue;
    // push out along the wall normal
    const push = side * r - now; s.x += o.nx * push; s.z += o.nz * push;
    const vn = s.vx * o.nx + s.vz * o.nz; // + = moving outward
    if (vn * side < 0) {
      const tx = s.vx - vn * o.nx, tz = s.vz - vn * o.nz; hit = Math.max(hit, Math.abs(vn));
      s.vx = tx * 0.85 - vn * 0.3 * o.nx; s.vz = tz * 0.85 - vn * 0.3 * o.nz; s.w *= 0.5;
    }
  }
  return hit;
}
/** Car-vs-car: push our car out of another car's circle and trade momentum by mass. Returns impact speed. */
export function collideCar(s: RaceState, mass: number, r: number, o: { x: number; z: number; vx: number; vz: number; r: number; mass: number }): number {
  const dx = s.x - o.x, dz = s.z - o.z; const d = Math.hypot(dx, dz); const min = r + o.r; if (d >= min || d < 1e-4) return 0;
  const nx = dx / d, nz = dz / d; s.x += nx * (min - d); s.z += nz * (min - d);
  const rel = (s.vx - o.vx) * nx + (s.vz - o.vz) * nz; if (rel >= 0) return 0;
  const j = -(1 + 0.35) * rel * o.mass / (mass + o.mass); s.vx += j * nx; s.vz += j * nz; s.w += (Math.random() - 0.5) * Math.min(1.5, -rel * 0.1);
  return -rel;
}

// ---- Server-side lap sanity (anti-cheat) ----
/** Shortest legal line round the oval (hugging the inner kerb) in map units. */
export const MIN_LINE = 4 * TRACK.L + 2 * Math.PI * (TRACK.R - TRACK.W / 2);
/** Fastest believable lap for a car whose top speed (km/h, with every upgrade + nitro) is `kmh`: the whole minimum line at
 *  that top speed, minus 10% slack. Anything quicker is rejected server-side. */
export const minLapMs = (kmh: number) => Math.floor(MIN_LINE / (kmh / 8.5) * 1000 * 0.9);
export { LAP_MAX_GAP_MS } from './venues.js';

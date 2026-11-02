import { NITRO_ACCEL, NITRO_RECHARGE, NITRO_TOP, type moddedPhysics } from './mechanic.js';

/**
 * Pure arcade car step (city + Speedway share it). Heading `a`: forward is (cos a, sin a) in world x/z.
 * World axes are three.js (x right, z toward the viewer, y up), so a GROWING `a` turns the nose to the driver's RIGHT
 * on screen (chase cam behind the car). Left input must therefore DECREASE `a`.
 */
export type CarPhys = ReturnType<typeof moddedPhysics>;
export type CarInput = { up: boolean; down: boolean; left: boolean; right: boolean; boost?: boolean };
export type CarState = { a: number; v: number; tank: number };

/** -1 = turning the car's heading left, +1 = right (as a change in `a`), 0 = straight. */
export const steerSign = (i: Pick<CarInput, 'left' | 'right'>): number => (i.right ? 1 : 0) - (i.left ? 1 : 0);

/** Updates speed, nitro and heading; returns whether nitro is on. Position/collisions are the caller's. */
export function stepCar(m: CarState, p: CarPhys, i: CarInput, dt: number, off: boolean): boolean {
  const boost = !!i.boost && i.up && p.nitro > 0 && m.tank > 0.05 && m.v >= 0;
  m.tank = boost ? Math.max(0, m.tank - dt) : Math.min(p.nitro, m.tank + NITRO_RECHARGE * dt);
  const top = boost ? p.vmax * NITRO_TOP : p.vmax; const acc = boost ? p.accel * NITRO_ACCEL : p.accel;
  const vmax = off ? top * p.offroad : top;
  if (i.up) m.v += (m.v < 0 ? acc * 2.5 : acc) * dt; else if (i.down) m.v -= (m.v > 0 ? p.accel * 2.5 : p.accel * 0.6) * dt;
  else m.v -= Math.sign(m.v) * Math.min(Math.abs(m.v), (3 + Math.abs(m.v) * 0.25) * dt);
  if (off && Math.abs(m.v) > vmax) m.v -= Math.sign(m.v) * Math.min(Math.abs(m.v) - vmax, 20 * dt);
  if (m.v > top) m.v = Math.max(top, m.v - (6 + m.v * 0.5) * dt); m.v = Math.max(-p.reverse, m.v);
  // Reversing swings the nose the opposite way (sign(v)), like a real car.
  const grip = Math.min(1, Math.abs(m.v) / 6) * Math.sign(m.v || 1) * (1 - Math.min(p.gripLoss, Math.abs(m.v) / p.vmax * p.gripLoss));
  m.a += steerSign(i) * p.steer * grip * dt;
  return boost;
}

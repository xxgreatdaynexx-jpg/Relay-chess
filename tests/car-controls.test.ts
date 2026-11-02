import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CARS } from '../shared/cars';
import { moddedPhysics, STOCK_MODS, MAX_TIER, type CarMods } from '../shared/mechanic';
import { trackPoint } from '../shared/venues';
import { stepCar, steerSign, type CarInput } from '../shared/drivePhysics';

/** Same chase cam as worldDrive: 9 behind, 4.5 up, looking 4 ahead. Returns screen x (-1 left .. +1 right) of a world point. */
function screenX(x: number, z: number, a: number, px: number, pz: number): number {
  const cam = new THREE.PerspectiveCamera(60, 1.5, 0.1, 1000);
  cam.position.set(x - Math.cos(a) * 9, 4.5, z - Math.sin(a) * 9); cam.lookAt(x + Math.cos(a) * 4, 1.2, z + Math.sin(a) * 4); cam.updateMatrixWorld();
  return new THREE.Vector3(px, 0, pz).project(cam).x;
}
const none: CarInput = { up: false, down: false, left: false, right: false };
/** Drive for `secs` with `i`, starting at speed v0; report where the car ended up as seen from the starting chase cam. */
function drive(phys: ReturnType<typeof moddedPhysics>, start: { x: number; z: number; a: number }, i: CarInput, v0: number, secs = 1.5) {
  const m = { a: start.a, v: v0, tank: phys.nitro }; let x = start.x, z = start.z;
  for (let k = 0; k < Math.round(secs * 60); k++) { stepCar(m, phys, i, 1 / 60, false); x += Math.cos(m.a) * m.v / 60; z += Math.sin(m.a) * m.v / 60; }
  const fwd = (x - start.x) * Math.cos(start.a) + (z - start.z) * Math.sin(start.a);
  return { fwd, sx: screenX(start.x, start.z, start.a, x, z), da: m.a - start.a, v: m.v };
}
const variants: Array<[string, CarMods]> = [['stock', { ...STOCK_MODS }]];
for (const part of ['engine', 'turbo', 'tires', 'handling', 'nitro'] as const) for (let t = 1; t <= MAX_TIER; t++) variants.push([`${part} ${t}`, { ...STOCK_MODS, [part]: t } as CarMods]);
variants.push(['all max', { ...STOCK_MODS, engine: 3, turbo: 3, tires: 3, handling: 3, nitro: 3 } as CarMods]);
const [gx, gz, ga] = trackPoint(0.985);
const modes = { city: { x: 10, z: -20, a: 0.7 }, speedway: { x: gx, z: gz, a: ga } };

describe('car controls map to the right on-screen direction (every car, tier and upgrade; city + Speedway)', () => {
  it('steerSign: left decreases heading, right increases', () => {
    expect(steerSign({ left: true, right: false })).toBe(-1);
    expect(steerSign({ left: false, right: true })).toBe(1);
    expect(steerSign({ left: true, right: true })).toBe(0);
  });
  for (const [mode, start] of Object.entries(modes)) for (const car of CARS) for (const [label, mods] of variants) {
    it(`${mode} · ${car.id} · ${label}`, () => {
      const p = moddedPhysics(car, mods);
      expect(p.steer).toBeGreaterThan(0);
      const f = drive(p, start, { ...none, up: true }, 0);
      expect(f.fwd).toBeGreaterThan(0.2); expect(Math.abs(f.sx)).toBeLessThan(0.02);
      const b = drive(p, start, { ...none, down: true }, 0);
      expect(b.fwd).toBeLessThan(-0.1); expect(b.v).toBeLessThan(0);
      const l = drive(p, start, { ...none, up: true, left: true }, 10, 0.4);
      expect(l.sx).toBeLessThan(-0.02); expect(l.da).toBeLessThan(0);
      const r = drive(p, start, { ...none, up: true, right: true }, 10, 0.4);
      expect(r.sx).toBeGreaterThan(0.02); expect(r.da).toBeGreaterThan(0);
      const n = drive(p, start, { ...none, up: true, left: true, boost: true }, 10, 0.4);
      expect(n.sx).toBeLessThan(-0.02);
      // reversing with left: the nose swings right (heading grows), like a real car backing up with the wheel left
      const rl = drive(p, start, { ...none, down: true, left: true }, -4, 0.4);
      expect(rl.da).toBeGreaterThan(0); expect(rl.fwd).toBeLessThan(0);
    });
  }
  it('worldDrive uses the shared step and A/←, D/→, W/↑, S/↓ bindings', async () => {
    const src = (await import('node:fs')).readFileSync('client/src/lib/worldDrive.ts', 'utf8');
    expect(src).toMatch(/stepCar\(m, p,/);
    expect(src).not.toMatch(/m\.a \+= steer/);
    for (const [k, v] of [['KeyW', 'up'], ['ArrowUp', 'up'], ['KeyS', 'down'], ['ArrowDown', 'down'], ['KeyA', 'left'], ['ArrowLeft', 'left'], ['KeyD', 'right'], ['ArrowRight', 'right']]) expect(src).toContain(`${k}: '${v}'`);
  });
});

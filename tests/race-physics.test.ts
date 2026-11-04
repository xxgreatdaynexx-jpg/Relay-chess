import { describe, it, expect } from 'vitest';
import { CAR_BY_ID } from '../shared/cars';
import { STOCK_MODS } from '../shared/mechanic';
import { raceSpec, stepRace, collideWalls, collideCar, trackOffset, WALL_OUT, minLapMs, MIN_LINE, type RaceState } from '../shared/racePhysics';
import { LapTimer, TRACK, trackPoint, LAP_MAX_GAP_MS } from '../shared/venues';

const I = (o: Partial<{ up: boolean; down: boolean; left: boolean; right: boolean; handbrake: boolean }>) => ({ up: false, down: false, left: false, right: false, ...o });
const S = (o: Partial<RaceState> = {}): RaceState => ({ x: 0, z: 0, a: 0, vx: 0, vz: 0, w: 0, steer: 0, tank: 0, ...o });
const slipOf = (s: RaceState) => { const sp = Math.hypot(s.vx, s.vz); return sp < 1 ? 0 : Math.abs(Math.atan2(Math.sin(Math.atan2(s.vz, s.vx) - s.a), Math.cos(Math.atan2(s.vz, s.vx) - s.a))); };

describe('race physics', () => {
  const taxi = raceSpec(CAR_BY_ID.get('taxi')!, STOCK_MODS);
  it('accelerates toward but not past top speed', () => {
    const s = S(); for (let k = 0; k < 120 * 20; k++) stepRace(s, taxi, I({ up: true }), 1 / 120);
    const v = Math.hypot(s.vx, s.vz); expect(v).toBeGreaterThan(taxi.vmax * 0.85); expect(v).toBeLessThanOrEqual(taxi.vmax + 0.01);
  });
  it('handbrake breaks the rear loose into a drift; normal cornering stays gripped', () => {
    const grip = S({ vx: 16 }); let gMax = 0; for (let k = 0; k < 120; k++) { stepRace(grip, taxi, I({ up: true, left: true }), 1 / 120); gMax = Math.max(gMax, slipOf(grip)); }
    const hb = S({ vx: 16 }); let hMax = 0; for (let k = 0; k < 120; k++) { stepRace(hb, taxi, I({ up: true, left: true, handbrake: k < 50 }), 1 / 120); hMax = Math.max(hMax, slipOf(hb)); }
    expect(gMax).toBeLessThan(0.2); expect(hMax).toBeGreaterThan(0.3); expect(hMax).toBeGreaterThan(gMax * 2);
  });
  it('better tyres grip more', () => {
    const t3 = raceSpec(CAR_BY_ID.get('taxi')!, { ...STOCK_MODS, tires: 3 } as typeof STOCK_MODS);
    expect(t3.mu).toBeGreaterThan(taxi.mu);
  });
  it('walls stop you leaving the track and bleed speed', () => {
    const [x, z] = trackPoint(0.3); const n = trackOffset(x, z); const sx = x + n.nx * (WALL_OUT - 0.3), sz = z + n.nz * (WALL_OUT - 0.3);
    const s = S({ x: sx + n.nx * 2, z: sz + n.nz * 2, vx: n.nx * 20, vz: n.nz * 20 });
    const hit = collideWalls(s, sx, sz, 1); expect(hit).toBeGreaterThan(10); expect(trackOffset(s.x, s.z).s).toBeLessThan(WALL_OUT);
    expect(s.vx * n.nx + s.vz * n.nz).toBeLessThan(0);
  });
  it('car-car hits push cars apart and trade momentum', () => {
    const s = S({ vx: 10 }); const hit = collideCar(s, 1, 1, { x: 1.5, z: 0, vx: 0, vz: 0, r: 1, mass: 1 });
    expect(hit).toBeGreaterThan(0); expect(s.x).toBeLessThan(0); expect(s.vx).toBeLessThan(10);
  });
  it('minimum lap time comes from the shortest line', () => {
    expect(MIN_LINE).toBeLessThan(2 * Math.PI * TRACK.R + 4 * TRACK.L);
    expect(minLapMs(170)).toBeGreaterThan(1000); expect(minLapMs(85)).toBeGreaterThan(minLapMs(170));
  });
});

describe('LapTimer anti-cheat', () => {
  const drive = (lt: LapTimer, speed: number, stepMs: number, skip?: [number, number]) => {
    const len = 2 * Math.PI * TRACK.R + 4 * TRACK.L; const ev: string[] = []; let t = 0;
    for (let d = -5; d < len * 1.05; d += speed * stepMs / 1000, t += stepMs) {
      if (skip && t > skip[0] && t < skip[1]) continue;
      const [x, z] = trackPoint(((d / len) % 1 + 1) % 1); for (const e of lt.feed(x, z, t)) ev.push(e.kind);
    }
    return ev;
  };
  it('counts a normal lap', () => expect(drive(new LapTimer(), 30, 125)).toContain('lap'));
  it('voids a lap with a pose gap', () => { const ev = drive(new LapTimer(), 30, 125, [3000, 3000 + LAP_MAX_GAP_MS + 300]); expect(ev).toContain('void'); expect(ev).not.toContain('lap'); });
  it('voids a lap faster than the car can go', () => { const ev = drive(new LapTimer({ minMs: 60_000 }), 30, 125); expect(ev).toContain('void'); expect(ev).not.toContain('lap'); });
});

describe('Speedway race physics: controls map the right way for every car and upgrade', () => {
  const tiers = [0, 1, 2, 3];
  for (const c of CAR_BY_ID.values()) for (const t of tiers) for (const h of tiers) {
    const spec = raceSpec(c, { ...STOCK_MODS, tires: t, handling: h } as typeof STOCK_MODS);
    it(`${c.id} tires ${t} susp ${h}`, () => {
      const run = (inp: ReturnType<typeof I>, s: RaceState, n = 60) => { for (let k = 0; k < n; k++) stepRace(s, spec, inp, 1 / 120); return s; };
      expect(run(I({ up: true }), S(), 120).x).toBeGreaterThan(0.2); // W: forward (+x at a=0)
      expect(run(I({ down: true }), S(), 120).x).toBeLessThan(-0.05); // S: reverse
      expect(run(I({ up: true, right: true }), S({ vx: 10 })).a).toBeGreaterThan(0.01); // right: a grows = right on screen
      expect(run(I({ up: true, left: true }), S({ vx: 10 })).a).toBeLessThan(-0.01); // left
      expect(run(I({ up: true, left: true, handbrake: true }), S({ vx: 14 })).a).toBeLessThan(-0.01); // drift keeps direction
    });
  }
});

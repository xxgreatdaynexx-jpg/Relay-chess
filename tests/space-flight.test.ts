import { describe, it, expect } from 'vitest';
import {
  PLANET, LEO_DV_BUDGET, MIN_LIFTOFF_TWR, G0, TARGET_PE,
  tsiolkovsky, orbitalElements, circularVelocity, timeToApoapsis,
  analyzeDesign, scriptedAscent, launchState, stepFlight, activateStage,
  densityAt, pressureAt, ispOf, thrustOf, altitudeOf, fmtAlt, fmtDv,
} from '../shared/spaceFlight';
import { courierI, scoutI, PART_BY_ID, designCost, validateDesign, hasErrors, makeDesign, designHash } from '../shared/spaceParts';

describe('planet and atmosphere', () => {
  it('documents a Kerbin-like body with a 3,400 m/s LEO budget', () => {
    expect(PLANET.radius).toBe(600_000);
    expect(PLANET.g0).toBe(G0);
    expect(PLANET.g0).toBeCloseTo(9.81, 8);
    expect(PLANET.mu).toBeCloseTo(G0 * 600_000 * 600_000, 3);
    expect(PLANET.mu).toBeCloseTo(3.5316e12, 0);
    expect(PLANET.atmHeight).toBe(70_000);
    expect(PLANET.scaleHeight).toBe(5_000);
    expect(PLANET.parkAltitude).toBe(80_000);
    expect(LEO_DV_BUDGET).toBe(3400);
    expect(MIN_LIFTOFF_TWR).toBeCloseTo(1.15, 8);
    const vPark = circularVelocity(PLANET.parkAltitude);
    expect(vPark).toBeGreaterThan(2200);
    expect(vPark).toBeLessThan(2400);
    expect(vPark).toBeCloseTo(2278.9, 0);
  });
  it('has an exponential atmosphere that vanishes at the cutoff', () => {
    expect(densityAt(0)).toBeCloseTo(1.225, 8);
    expect(densityAt(PLANET.scaleHeight)).toBeCloseTo(1.225 / Math.E, 5);
    expect(densityAt(PLANET.atmHeight)).toBe(0);
    expect(densityAt(PLANET.atmHeight - 1)).toBeGreaterThan(0);
    expect(densityAt(-1)).toBe(0);
    expect(pressureAt(0)).toBeCloseTo(101_325, 4);
    expect(pressureAt(PLANET.atmHeight)).toBe(0);
  });
  it('varies engine ISP and thrust with pressure', () => {
    const t = PART_BY_ID.get('terrier')!;
    expect(ispOf(t, PLANET.p0)).toBeCloseTo(t.ispAsl!, 8);
    expect(ispOf(t, 0)).toBeCloseTo(t.ispVac!, 8);
    expect(thrustOf(t, 0)).toBeCloseTo(t.thrustVac!, 8);
    expect(thrustOf(t, PLANET.p0)).toBeCloseTo(t.thrustAsl!, 8);
    expect(ispOf(t, 0)).toBeGreaterThan(ispOf(t, PLANET.p0));
  });
});

describe('Tsiolkovsky and orbit elements', () => {
  it('matches a hand calculation', () => {
    // 310 s, 13,390 kg → 5,390 kg: Δv = 310 * 9.81 * ln(13390/5390)
    const dv = tsiolkovsky(310, 13_390, 5_390);
    expect(dv).toBeCloseTo(310 * 9.81 * Math.log(13_390 / 5_390), 6);
    expect(dv).toBeGreaterThan(2700);
    expect(dv).toBeLessThan(2900);
    expect(tsiolkovsky(310, 1000, 1000)).toBe(0);
    expect(tsiolkovsky(310, 1000, 2000)).toBe(0);
  });
  it('recovers a circular 80 km orbit from its state vector', () => {
    const r = PLANET.radius + 80_000;
    const v = circularVelocity(80_000);
    const el = orbitalElements(r, 0, 0, v);
    expect(el.bound).toBe(true);
    expect(el.hyperbolic).toBe(false);
    expect(el.eccentricity).toBeLessThan(1e-8);
    expect(el.apAltitude).toBeCloseTo(80_000, 4);
    expect(el.peAltitude).toBeCloseTo(80_000, 4);
    expect(el.semiMajor).toBeCloseTo(r, 4);
    expect(el.period).not.toBeNull();
    expect(el.period!).toBeGreaterThan(1800);
    expect(el.period!).toBeLessThan(2000);
  });
  it('recovers apoapsis and periapsis of an elliptical orbit', () => {
    // Pe 80 km, Ap 200 km. a = R + 140 km, e = 60/a_alt? 
    const peR = PLANET.radius + 80_000;
    const apR = PLANET.radius + 200_000;
    const a = (peR + apR) / 2;
    const e = (apR - peR) / (apR + peR);
    // At periapsis: r = pe, v = sqrt(μ (2/r - 1/a)), flight path 0 (horizontal)
    const v = Math.sqrt(PLANET.mu * (2 / peR - 1 / a));
    const el = orbitalElements(peR, 0, 0, v);
    expect(el.eccentricity).toBeCloseTo(e, 6);
    expect(el.peAltitude).toBeCloseTo(80_000, 3);
    expect(el.apAltitude).toBeCloseTo(200_000, 3);
    const tta = timeToApoapsis(el, peR, 0, 0, v);
    expect(tta).not.toBeNull();
    expect(tta!).toBeCloseTo(el.period! / 2, 2);
  });
  it('conserves energy on a circular coast', () => {
    const r = PLANET.radius + 80_000;
    const v = circularVelocity(80_000);
    // A dummy empty vessel so drag/thrust are zero (no parts ignited, above atmo).
    const s = launchState(courierI());
    s.x = r; s.y = 0; s.vx = 0; s.vy = v; s.throttle = 0;
    for (const p of s.parts) p.ignited = false;
    const e0 = orbitalElements(s.x, s.y, s.vx, s.vy).specificEnergy;
    for (let i = 0; i < 2000; i++) stepFlight(s, 0.1);
    const e1 = orbitalElements(s.x, s.y, s.vx, s.vy).specificEnergy;
    expect(Math.abs(e1 - e0) / Math.abs(e0)).toBeLessThan(1e-3);
    const el = orbitalElements(s.x, s.y, s.vx, s.vy);
    expect(el.peAltitude).toBeGreaterThan(79_000);
    expect(el.apAltitude).toBeLessThan(81_000);
  });
});

describe('Courier I design analysis', () => {
  it('has a command core, a satellite, and costs a modest number of chips', () => {
    const d = courierI();
    expect(hasErrors(validateDesign(d))).toBe(false);
    expect(designCost(d)).toBe(5 * (1200 + 350 + 300 + 500 + 1100 + 200 + 900 + 900 + 1400));
    expect(designCost(d)).toBe(34_250);
    expect(designHash(d)).toBe(designHash(courierI()));
    const st = analyzeDesign(d);
    expect(st.payloads).toContain('CommSat');
    expect(st.liftoffTwr).toBeGreaterThan(MIN_LIFTOFF_TWR);
    expect(st.liftoffTwr).toBeGreaterThan(1.5);
    expect(st.liftoffTwr).toBeLessThan(2.0);
    expect(st.totalDvVac).toBeGreaterThan(LEO_DV_BUDGET);
    expect(st.totalDvVac).toBeGreaterThan(5500);
    expect(st.stages.length).toBeGreaterThanOrEqual(2);
    expect(st.capable).toBe(true);
    // First stage (Reliant) then Terrier upper.
    expect(st.stages[0]!.engines).toContain('Reliant');
    expect(st.stages.at(-1)!.engines).toContain('Terrier');
  });
  it('rejects a suborbital sounding rocket as not orbit-capable', () => {
    const weak = makeDesign('Popgun', [
      { part: 'probe-okto', stage: 15 },
      { part: 'commsat', stage: 0 },
      { part: 'fl-t100', stage: 1 },
      { part: 'spark', stage: 1 },
    ]);
    const st = analyzeDesign(weak);
    expect(st.totalDvVac).toBeLessThan(LEO_DV_BUDGET);
    expect(st.capable).toBe(false);
  });
  it('Scout I is also capable', () => {
    const st = analyzeDesign(scoutI());
    expect(st.capable).toBe(true);
    expect(st.cost).toBeLessThan(designCost(courierI()));
  });
});

describe('scripted ascent (Courier I)', () => {
  it('reaches a stable orbit above the atmosphere and deploys its satellite', () => {
    const r = scriptedAscent(courierI(), { dt: 0.05, maxTime: 900 });
    if (!r.reachedOrbit) {
      const s = r.state;
      console.log('FAIL ascent', {
        t: r.t, crashed: r.crashed, ap: r.apAltitude, pe: r.peAltitude, e: r.eccentricity,
        h: altitudeOf(s), log: r.log.map((l) => `${l.t.toFixed(1)} ${l.text}`),
        fuel: s.parts.filter((p) => p.attached).map((p) => `${p.def.short}:${p.fuel.toFixed(0)}:${p.ignited}`),
        phase: s.phase,
      });
    }
    expect(r.crashed).toBe(false);
    expect(r.reachedOrbit).toBe(true);
    expect(r.peAltitude).toBeGreaterThan(PLANET.atmHeight);
    expect(r.peAltitude).toBeGreaterThan(TARGET_PE - 1000);
    expect(r.apAltitude).toBeGreaterThan(r.peAltitude - 1);
    expect(r.apAltitude).toBeLessThan(400_000); // not a wildly inefficient ellipse
    expect(r.deployed).toBe(true);
    expect(r.t).toBeGreaterThan(60);
    expect(r.t).toBeLessThan(900);
    expect(r.log.some((l) => /Liftoff/i.test(l.text))).toBe(true);
  });
});

describe('staging', () => {
  it('drops the first stage and ignites the Terrier', () => {
    const s = launchState(courierI());
    const n0 = s.parts.filter((p) => p.attached).length;
    activateStage(s); // reliant
    expect(s.parts.some((p) => p.def.id === 'reliant' && p.ignited && p.attached)).toBe(true);
    expect(s.parts.filter((p) => p.attached).length).toBe(n0);
    // Skip fairing stage, fire decoupler + terrier
    s.nextStage = 1;
    const r = activateStage(s);
    expect(r.fired).toBeGreaterThanOrEqual(1);
    expect(r.dropped).toBeGreaterThanOrEqual(1);
    expect(s.parts.some((p) => p.def.id === 'terrier' && p.ignited && p.attached)).toBe(true);
    expect(s.parts.some((p) => p.def.id === 'reliant' && !p.attached)).toBe(true);
    expect(s.parts.some((p) => p.def.id === 'fl-t800' && !p.attached)).toBe(true);
    expect(s.parts.some((p) => p.def.id === 'fl-t400' && p.attached)).toBe(true);
    expect(s.parts.some((p) => p.def.id === 'commsat' && p.attached)).toBe(true);
  });
});

describe('formatters', () => {
  it('renders altitudes and delta-v for the consoles', () => {
    expect(fmtAlt(80_000)).toMatch(/80/);
    expect(fmtAlt(Infinity)).toBe('∞');
    expect(fmtDv(3400)).toBe('3400 m/s');
  });
});

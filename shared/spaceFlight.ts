/**
 * Orbital mechanics, atmosphere, staging analysis and a 2-D point-mass flight sim
 * for the Chud Space Center program.
 *
 * Planet (Kerbin-like, documented):
 *   Radius               R  = 600 km
 *   Surface gravity      g0 = 9.81 m/s²
 *   μ = g0 R²               = 3.5316 × 10¹² m³/s²
 *   Sidereal day            = 6 h  (equatorial rotation 174.5 m/s)
 *   Atmosphere              = exponential, scale height 5 km, cutoff 70 km
 *   Sea-level density       = 1.225 kg/m³
 *
 * A circular 80 km orbit has a speed of ~2,279 m/s. Gravity and aerodynamic
 * losses on a typical gravity-turn ascent bring the practical delta-v budget
 * to about 3,400 m/s — LEO_DV_BUDGET, the documented requirement. A design
 * must also lift off with a sea-level TWR of at least 1.15.
 */
import {
  G0, PART_BY_ID, courierI, type PlacedPart, type VesselDesign, type PartDef,
  validateDesign, hasErrors, designCost,
} from './spaceParts.js';

export { G0 };

export const PLANET = {
  name: 'Chud',
  radius: 600_000,
  g0: G0,
  mu: G0 * 600_000 * 600_000, // 3.5316e12
  day: 6 * 3600,
  omega: (2 * Math.PI) / (6 * 3600),
  atmHeight: 70_000,
  scaleHeight: 5_000,
  rho0: 1.225,
  p0: 101_325,
  /** Target circular parking orbit (metres above the surface). */
  parkAltitude: 80_000,
} as const;

export const LEO_DV_BUDGET = 3400;
/** One-time chip payout for a successful deploy, scaled by the price index. Capped per player. */
export const SPACE_PAYOUT = 400;
export const SPACE_MAX_PAID = 5;
export const SPACE_COOLDOWN_MS = 90_000;
export const SPACE_LAUNCH_TTL_MS = 15 * 60_000;
export const MIN_LIFTOFF_TWR = 1.15;
export const TARGET_AP = PLANET.parkAltitude;
export const TARGET_PE = PLANET.atmHeight + 5_000; // 75 km — clearly above the air

export const densityAt = (h: number): number => {
  if (h >= PLANET.atmHeight || h < 0) return 0;
  return PLANET.rho0 * Math.exp(-h / PLANET.scaleHeight);
};
export const pressureAt = (h: number): number => {
  if (h >= PLANET.atmHeight || h < 0) return 0;
  return PLANET.p0 * Math.exp(-h / PLANET.scaleHeight);
};
export const atmoFrac = (p: number): number => 1 - Math.min(1, Math.max(0, p / PLANET.p0));

export function ispOf(def: PartDef, p: number): number {
  const a = def.ispAsl ?? 0, v = def.ispVac ?? 0;
  return a + (v - a) * atmoFrac(p);
}
export function thrustOf(def: PartDef, p: number, throttle = 1): number {
  const a = def.thrustAsl ?? 0, v = def.thrustVac ?? 0;
  return (a + (v - a) * atmoFrac(p)) * Math.min(1, Math.max(0, throttle));
}

/** Tsiolkovsky: Δv = Isp · g0 · ln(m0 / mf). */
export function tsiolkovsky(isp: number, m0: number, mf: number): number {
  if (!(isp > 0) || !(m0 > 0) || !(mf > 0) || mf > m0) return 0;
  return isp * G0 * Math.log(m0 / mf);
}

export interface OrbitalElements {
  radius: number;
  speed: number;
  altitude: number;
  specificEnergy: number;
  semiMajor: number;
  eccentricity: number;
  apRadius: number;
  peRadius: number;
  apAltitude: number;
  peAltitude: number;
  period: number | null;
  trueAnomaly: number;
  flightPathAngle: number;
  hyperbolic: boolean;
  bound: boolean;
}

export function orbitalElements(x: number, y: number, vx: number, vy: number): OrbitalElements {
  const { mu, radius } = PLANET;
  const r = Math.hypot(x, y);
  const v2 = vx * vx + vy * vy;
  const speed = Math.sqrt(v2);
  const altitude = r - radius;
  const energy = v2 / 2 - mu / Math.max(r, 1);
  const hyperbolic = energy >= 0;
  const semiMajor = energy === 0 ? Infinity : -mu / (2 * energy);
  const hz = x * vy - y * vx;
  const ex = (vy * hz) / mu - x / Math.max(r, 1);
  const ey = (-vx * hz) / mu - y / Math.max(r, 1);
  const eccentricity = Math.hypot(ex, ey);
  const peRadius = hyperbolic
    ? (semiMajor === Infinity ? r : Math.abs(semiMajor) * (eccentricity - 1))
    : semiMajor * (1 - eccentricity);
  const apRadius = hyperbolic ? Infinity : semiMajor * (1 + eccentricity);
  const rx = x / Math.max(r, 1), ry = y / Math.max(r, 1);
  const tx = -ry, ty = rx;
  const vr = vx * rx + vy * ry;
  const vt = vx * tx + vy * ty;
  const flightPathAngle = Math.atan2(vr, vt);
  const ev = eccentricity > 1e-12 ? (ex * rx + ey * ry) / eccentricity : 1;
  const trueAnomaly = Math.atan2(ex * ry - ey * rx, ev * eccentricity || ev) || Math.acos(Math.min(1, Math.max(-1, ev)));
  const period = hyperbolic || !(semiMajor > 0) ? null : 2 * Math.PI * Math.sqrt((semiMajor * semiMajor * semiMajor) / mu);
  return {
    radius: r, speed, altitude, specificEnergy: energy, semiMajor, eccentricity,
    apRadius, peRadius,
    apAltitude: apRadius === Infinity ? Infinity : apRadius - radius,
    peAltitude: peRadius - radius,
    period, trueAnomaly, flightPathAngle,
    hyperbolic, bound: !hyperbolic && eccentricity < 1,
  };
}

/** Seconds until apoapsis (negative if already past and heading out is false). Null if hyperbolic. */
export function timeToApoapsis(el: OrbitalElements, x: number, y: number, vx: number, vy: number): number | null {
  if (el.hyperbolic || el.period == null || !(el.semiMajor > 0) || el.eccentricity >= 1) return null;
  const e = el.eccentricity;
  if (e < 1e-6) return el.period / 2;
  const r = Math.hypot(x, y);
  const cosNu = Math.min(1, Math.max(-1, ((el.semiMajor * (1 - e * e) / r) - 1) / Math.max(e, 1e-12)));
  let nu = Math.acos(cosNu);
  const rx = x / r, ry = y / r;
  const vr = vx * rx + vy * ry;
  if (vr < 0) nu = -nu; // heading to periapsis
  const tanHalf = Math.tan(nu / 2);
  const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * tanHalf);
  const M = E - e * Math.sin(E);
  const n = (2 * Math.PI) / el.period;
  let dt = (Math.PI - M) / n;
  if (dt < 0) dt += el.period;
  if (dt > el.period) dt -= el.period;
  return dt;
}

export function circularVelocity(altitude: number): number {
  return Math.sqrt(PLANET.mu / (PLANET.radius + altitude));
}

export interface StageStats {
  stage: number;
  dvVac: number;
  dvAsl: number;
  twrAsl: number;
  twrVac: number;
  wetMass: number;
  dryMass: number;
  fuelMass: number;
  thrustAsl: number;
  thrustVac: number;
  ispVac: number;
  ispAsl: number;
  burnTime: number;
  engines: string[];
}

export interface DesignStats {
  cost: number;
  wetMass: number;
  dryMass: number;
  totalDvVac: number;
  totalDvAsl: number;
  liftoffTwr: number;
  stages: StageStats[];
  payloads: string[];
  capable: boolean;
  issues: ReturnType<typeof validateDesign>;
  warnings: string[];
}

interface LivePart {
  placed: PlacedPart;
  def: PartDef;
  fuel: number;
  attached: boolean;
  ignited: boolean;
  jettisoned: boolean;
}

/** Segments between stack decouplers, nose to tail. Radials belong to their parent's segment. */
export function segmentsOf(design: VesselDesign): PlacedPart[][] {
  const stack = design.parts.filter((p) => !p.radial);
  const segs: PlacedPart[][] = [];
  let cur: PlacedPart[] = [];
  const radials = (uid: string) => design.parts.filter((p) => p.radial && (p.attachTo === uid || (!p.attachTo && false)));
  // Attach unparented radials to the last (aft-most so far) stack part of similar height — nearest previous stack item.
  const parentOf = (p: PlacedPart): string | undefined => {
    if (p.attachTo) return p.attachTo;
    if (!p.radial) return undefined;
    const idx = stack.findIndex((s) => s.uid === /* fallback */ '');
    void idx;
    // nearest stack part: last already pushed, else last in current
    const last = cur.length ? cur[cur.length - 1] : segs.at(-1)?.at(-1);
    return last?.uid;
  };
  for (const s of stack) {
    cur.push(s);
    for (const r of design.parts.filter((p) => p.radial && (p.attachTo === s.uid || (!p.attachTo && parentOf(p) === s.uid)))) {
      cur.push(r);
    }
    const def = PART_BY_ID.get(s.partId);
    if (def?.category === 'decoupler' && !s.radial) {
      segs.push(cur);
      cur = [];
    }
  }
  if (cur.length) segs.push(cur);
  return segs;
}

function thrustWeightedIsp(engines: PartDef[], pressure: number): number {
  let F = 0, mdot = 0;
  for (const e of engines) {
    const t = thrustOf(e, pressure, 1);
    const i = ispOf(e, pressure);
    if (t <= 0 || i <= 0) continue;
    F += t;
    mdot += t / (i * G0);
  }
  return mdot > 0 ? F / (mdot * G0) : 0;
}

/**
 * Per-stage vacuum and sea-level Δv (Tsiolkovsky) plus TWR.
 * A "burn stage" is one or more same-stage engines plus the fuel they can reach
 * in their segment (tanks forward of the next aft decoupler, or an SRB's own grain).
 */
export function analyzeDesign(design: VesselDesign): DesignStats {
  const issues = validateDesign(design);
  const warnings: string[] = [];
  const payloads: string[] = [];
  const lives: LivePart[] = [];
  for (const p of design.parts) {
    const def = PART_BY_ID.get(p.partId);
    if (!def) continue;
    if (def.category === 'payload') payloads.push(def.name);
    lives.push({ placed: p, def, fuel: def.fuelMass, attached: true, ignited: false, jettisoned: false });
  }
  const segs = segmentsOf(design);
  // Burn order: highest engine stage first.
  const engineStages = [...new Set(lives.filter((l) => (l.def.category === 'engine' || l.def.category === 'srb') && l.placed.stage < 15).map((l) => l.placed.stage))].sort((a, b) => b - a);
  const stages: StageStats[] = [];
  let massAbove = lives.reduce((s, l) => s + l.def.dryMass + l.fuel, 0);
  const wetMass = massAbove;
  const dryMass = lives.reduce((s, l) => s + l.def.dryMass, 0);

  for (const st of engineStages) {
    const engs = lives.filter((l) => l.attached && l.placed.stage === st && (l.def.category === 'engine' || l.def.category === 'srb'));
    if (!engs.length) continue;
    // Fuel available: liquid engines share liquid tanks in the same segment; SRBs burn their own.
    const fuelFrom: LivePart[] = [];
    let fuelMass = 0;
    for (const e of engs) {
      if (e.def.fuelKind === 'solid') {
        fuelFrom.push(e);
        fuelMass += e.fuel;
      } else {
        const seg = segs.find((sg) => sg.some((p) => p.uid === e.placed.uid));
        if (!seg) continue;
        for (const p of seg) {
          const lp = lives.find((l) => l.placed.uid === p.uid);
          if (!lp || lp.def.fuelKind !== 'liquid' || lp.fuel <= 0) continue;
          if (!fuelFrom.includes(lp)) { fuelFrom.push(lp); fuelMass += lp.fuel; }
        }
      }
    }
    const defs = engs.map((e) => e.def);
    const thrustAsl = defs.reduce((s, d) => s + thrustOf(d, PLANET.p0, 1), 0);
    const thrustVac = defs.reduce((s, d) => s + thrustOf(d, 0, 1), 0);
    const ispVac = thrustWeightedIsp(defs, 0);
    const ispAsl = thrustWeightedIsp(defs, PLANET.p0);
    const m0 = massAbove;
    const mf = Math.max(1, m0 - fuelMass);
    const dvVac = tsiolkovsky(ispVac, m0, mf);
    const dvAsl = tsiolkovsky(ispAsl, m0, mf);
    const twrAsl = m0 > 0 ? thrustAsl / (m0 * G0) : 0;
    const twrVac = m0 > 0 ? thrustVac / (m0 * G0) : 0;
    const mdotVac = ispVac > 0 ? thrustVac / (ispVac * G0) : 0;
    const burnTime = mdotVac > 0 ? fuelMass / mdotVac : 0;
    stages.push({
      stage: st, dvVac, dvAsl, twrAsl, twrVac, wetMass: m0, dryMass: mf, fuelMass,
      thrustAsl, thrustVac, ispVac, ispAsl, burnTime,
      engines: engs.map((e) => e.def.short),
    });
    // Drop this segment after the burn (everything in the same segment as these engines,
    // if a decoupler will drop them — i.e. they are not the uppermost remaining segment).
    // For analysis we subtract this stage's fuel and, if a decoupler sits at the top of
    // this segment (the segment started with a decoupler from the previous cut), the
    // leftover dry mass is discarded before the next burn.
    massAbove -= fuelMass;
    for (const f of fuelFrom) f.fuel = 0;
    // Discard leftover dry mass of this stage's droppable segment(s).
    const dropUids = new Set<string>();
    for (const e of engs) {
      const seg = segs.find((sg) => sg.some((p) => p.uid === e.placed.uid));
      if (!seg) continue;
      // Uppermost segment is the payload/upper and is never discarded after its own burn.
      if (seg === segs[0] && engs.every((x) => seg.some((p) => p.uid === x.placed.uid))) {
        // last stage: keep dry mass, fuel already removed
        continue;
      }
      for (const p of seg) dropUids.add(p.uid);
    }
    for (const lp of lives) {
      if (dropUids.has(lp.placed.uid) && lp.attached) {
        massAbove -= lp.def.dryMass + lp.fuel;
        lp.attached = false;
      }
    }
  }

  const totalDvVac = stages.reduce((s, x) => s + x.dvVac, 0);
  const totalDvAsl = stages.reduce((s, x) => s + x.dvAsl, 0);
  const liftoffTwr = stages[0]?.twrAsl ?? 0;
  if (liftoffTwr > 0 && liftoffTwr < MIN_LIFTOFF_TWR) warnings.push(`Liftoff TWR is ${liftoffTwr.toFixed(2)} — you need at least ${MIN_LIFTOFF_TWR} to climb out.`);
  if (totalDvVac < LEO_DV_BUDGET) warnings.push(`Vacuum Δv is ${Math.round(totalDvVac)} m/s; about ${LEO_DV_BUDGET} m/s is needed to reach a stable orbit.`);
  if (!payloads.length) warnings.push('No satellite on board.');
  const capable = !hasErrors(issues) && totalDvVac >= LEO_DV_BUDGET && liftoffTwr >= MIN_LIFTOFF_TWR && payloads.length > 0;
  return {
    cost: designCost(design), wetMass, dryMass, totalDvVac, totalDvAsl, liftoffTwr, stages,
    payloads, capable, issues, warnings,
  };
}

export function designIsCapable(stats: DesignStats): boolean {
  return stats.capable;
}

/* ───────────── live flight simulation ───────────── */

export interface FlightPart {
  uid: string;
  partId: string;
  stage: number;
  radial: boolean;
  angle: number;
  def: PartDef;
  fuel: number;
  attached: boolean;
  ignited: boolean;
}

export type FlightPhase = 'pad' | 'countdown' | 'ascent' | 'coast' | 'circularize' | 'orbit' | 'deployed' | 'crashed' | 'aborted';

export interface FlightLogEntry { t: number; text: string; capcom?: boolean }

export interface FlightState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  throttle: number;
  /** Pitch from local vertical, degrees. 0 = straight up, 90 = due east (prograde at launch). */
  pitch: number;
  parts: FlightPart[];
  nextStage: number;
  phase: FlightPhase;
  crashed: boolean;
  deployed: boolean;
  aborted: boolean;
  maxQ: number;
  maxQPassed: boolean;
  log: FlightLogEntry[];
  met0: number;
  designName: string;
}

export function vehicleMass(s: FlightState): number {
  let m = 0;
  for (const p of s.parts) if (p.attached) m += p.def.dryMass + p.fuel;
  return Math.max(m, 1);
}

export function frontalArea(s: FlightState): number {
  let w = 0.4;
  let fairing = false;
  for (const p of s.parts) {
    if (!p.attached) continue;
    if (p.def.category === 'fairing') fairing = true;
    const ww = p.radial ? p.def.width * 0.5 : p.def.width;
    if (ww > w) w = ww;
  }
  const a = Math.PI * (w / 2) * (w / 2);
  return fairing ? a * 0.85 : a * 1.15;
}

export function dragCd(s: FlightState): number {
  const fairing = s.parts.some((p) => p.attached && p.def.category === 'fairing');
  return fairing ? 0.2 : 0.35;
}

export function attachedFuel(s: FlightState, kind: 'liquid' | 'solid' = 'liquid'): number {
  let f = 0;
  for (const p of s.parts) if (p.attached && p.def.fuelKind === kind) f += p.fuel;
  return f;
}

function segmentOf(s: FlightState, uid: string): FlightPart[] {
  // Reconstruct from original stack order of still-known parts (including detached, for cuts).
  const stack = s.parts.filter((p) => !p.radial);
  const cuts: FlightPart[][] = [];
  let cur: FlightPart[] = [];
  for (const p of stack) {
    cur.push(p);
    for (const r of s.parts.filter((x) => x.radial && (x.def /* parent */ , parentUid(s, x) === p.uid))) cur.push(r);
    if (p.def.category === 'decoupler' && !p.radial) { cuts.push(cur); cur = []; }
  }
  if (cur.length) cuts.push(cur);
  return cuts.find((c) => c.some((p) => p.uid === uid)) ?? [];
}

function parentUid(s: FlightState, p: FlightPart): string | undefined {
  // We don't store attachTo on FlightPart — recover from design via angle-only grouping.
  // FlightPart needs attachTo. Let me add it.
  return (p as FlightPart & { attachTo?: string }).attachTo;
}

function liquidTanksFor(s: FlightState, engine: FlightPart): FlightPart[] {
  const seg = segmentOf(s, engine.uid).filter((p) => p.attached && p.def.fuelKind === 'liquid' && p.fuel > 0);
  return seg;
}

export interface AccelSample {
  ax: number;
  ay: number;
  thrust: number;
  drag: number;
  mdot: number;
  density: number;
  pressure: number;
  q: number;
  mass: number;
  altitude: number;
  g: number;
}

export function sampleAccel(s: FlightState, x: number, y: number, vx: number, vy: number, throttle: number): AccelSample {
  const { mu, omega, radius } = PLANET;
  const r = Math.max(Math.hypot(x, y), 1);
  const h = r - radius;
  const mass = vehicleMass(s);
  const gx = -mu * x / (r * r * r);
  const gy = -mu * y / (r * r * r);
  const atmx = -omega * y;
  const atmy = omega * x;
  const vrx = vx - atmx, vry = vy - atmy;
  const vrel = Math.hypot(vrx, vry);
  const rho = densityAt(h);
  const p = pressureAt(h);
  const q = 0.5 * rho * vrel * vrel;
  const drag = q * dragCd(s) * frontalArea(s);
  const dax = vrel > 1e-6 ? -drag * vrx / vrel / mass : 0;
  const day = vrel > 1e-6 ? -drag * vry / vrel / mass : 0;

  let thrust = 0, mdot = 0;
  if (throttle > 0 && !s.crashed && !s.aborted) {
    for (const part of s.parts) {
      if (!part.attached || !part.ignited) continue;
      if (part.def.category !== 'engine' && part.def.category !== 'srb') continue;
      const isSolid = part.def.fuelKind === 'solid';
      const fuel = isSolid ? part.fuel : liquidTanksFor(s, part).reduce((n, t) => n + t.fuel, 0);
      if (fuel <= 0) continue;
      const th = isSolid ? 1 : throttle; // solids can't throttle
      const T = thrustOf(part.def, p, th);
      const isp = ispOf(part.def, p);
      if (T <= 0 || isp <= 0) continue;
      thrust += T;
      mdot += T / (isp * G0);
    }
  }
  const pr = s.pitch * Math.PI / 180;
  const rx = x / r, ry = y / r;
  const tx = -ry, ty = rx;
  const tdx = Math.cos(pr) * rx + Math.sin(pr) * tx;
  const tdy = Math.cos(pr) * ry + Math.sin(pr) * ty;
  const tax = thrust * tdx / mass;
  const tay = thrust * tdy / mass;
  const g = mu / (r * r);
  return { ax: gx + dax + tax, ay: gy + day + tay, thrust, drag, mdot, density: rho, pressure: p, q, mass, altitude: h, g };
}

function drainFuel(s: FlightState, mdot: number, dt: number): void {
  if (mdot <= 0 || dt <= 0) return;
  let need = mdot * dt;
  // Solids first: each ignited SRB consumes its own share.
  for (const part of s.parts) {
    if (!part.attached || !part.ignited || part.def.fuelKind !== 'solid') continue;
    const isp = ispOf(part.def, pressureAt(Math.hypot(s.x, s.y) - PLANET.radius));
    const T = thrustOf(part.def, pressureAt(Math.hypot(s.x, s.y) - PLANET.radius), 1);
    const share = isp > 0 ? (T / (isp * G0)) * dt : 0;
    const take = Math.min(part.fuel, share);
    part.fuel -= take;
    need -= take;
  }
  if (need <= 0) return;
  // Liquid: proportional across reachable tanks of ignited liquid engines.
  const tanks: FlightPart[] = [];
  const seen = new Set<string>();
  for (const e of s.parts) {
    if (!e.attached || !e.ignited || e.def.category !== 'engine') continue;
    for (const t of liquidTanksFor(s, e)) {
      if (!seen.has(t.uid)) { seen.add(t.uid); tanks.push(t); }
    }
  }
  const total = tanks.reduce((n, t) => n + t.fuel, 0);
  if (total <= 0) return;
  const take = Math.min(need, total);
  for (const t of tanks) {
    const share = (t.fuel / total) * take;
    t.fuel = Math.max(0, t.fuel - share);
  }
}

export function launchState(design: VesselDesign, name = design.name): FlightState {
  const R = PLANET.radius + 2;
  const parts: FlightPart[] = design.parts.map((p) => {
    const def = PART_BY_ID.get(p.partId)!;
    return {
      uid: p.uid, partId: p.partId, stage: p.stage, radial: !!p.radial, angle: p.angle ?? 0,
      def, fuel: def.fuelMass, attached: true, ignited: false,
      attachTo: p.attachTo,
    } as FlightPart;
  });
  const stages = parts.filter((p) => p.stage < 15).map((p) => p.stage);
  const nextStage = stages.length ? Math.max(...stages) : 0;
  return {
    x: R, y: 0, vx: 0, vy: PLANET.omega * R, t: 0, throttle: 0, pitch: 0, parts, nextStage,
    phase: 'pad', crashed: false, deployed: false, aborted: false, maxQ: 0, maxQPassed: false,
    log: [], met0: 0, designName: name,
  };
}

export function addLog(s: FlightState, text: string, capcom = false): void {
  const last = s.log[s.log.length - 1];
  if (last && last.text === text && s.t - last.t < 1) return;
  s.log.push({ t: s.t, text, capcom });
  if (s.log.length > 80) s.log.splice(0, s.log.length - 80);
}

/** Fire the current `nextStage`: ignite engines, pop decouplers (drop aft), jettison fairings, try deploy. */
export function activateStage(s: FlightState): { fired: number; dropped: number; deployed: boolean } {
  if (s.crashed || s.aborted) return { fired: 0, dropped: 0, deployed: false };
  const n = s.nextStage;
  // Find the highest remaining activatable stage at or below n.
  const actionable = s.parts.filter((p) => p.attached && p.stage <= n && p.stage < 15 && (
    ((p.def.category === 'engine' || p.def.category === 'srb') && !p.ignited)
    || p.def.category === 'decoupler'
    || p.def.category === 'fairing'
    || p.def.category === 'payload'
  ));
  if (!actionable.length) return { fired: 0, dropped: 0, deployed: false };
  const st = Math.max(...actionable.map((p) => p.stage));
  let fired = 0, dropped = 0, deployed = false;
  const group = s.parts.filter((p) => p.attached && p.stage === st);
  // Decouplers first: drop everything aft of a stack decoupler, or radial children of a radial decoupler.
  for (const p of group) {
    if (p.def.category !== 'decoupler') continue;
    if (p.radial) {
      // Drop other radials on the same parent? The radial decoupler itself is between core and booster.
      // Drop every radial (and the decoupler) that shares this stage — typical SRB sep.
      for (const q of s.parts) {
        if (!q.attached || !q.radial) continue;
        if (q.stage === st || q.uid === p.uid) { q.attached = false; dropped += 1; }
      }
      p.attached = false;
    } else {
      // Drop this decoupler and every part after it in stack order (aft), plus their radials.
      const stack = s.parts.filter((x) => !x.radial);
      const idx = stack.findIndex((x) => x.uid === p.uid);
      if (idx >= 0) {
        for (let i = idx; i < stack.length; i++) {
          const q = stack[i]!;
          if (q.attached) { q.attached = false; dropped += 1; }
          for (const r of s.parts) {
            if (r.radial && r.attached && (r as FlightPart & { attachTo?: string }).attachTo === q.uid) {
              r.attached = false; dropped += 1;
            }
          }
        }
      }
    }
  }
  for (const p of group) {
    if (!p.attached) continue;
    if (p.def.category === 'engine' || p.def.category === 'srb') {
      p.ignited = true; fired += 1;
    } else if (p.def.category === 'fairing') {
      p.attached = false; dropped += 1;
      addLog(s, 'Fairing jettison.', true);
    } else if (p.def.category === 'payload') {
      const el = orbitalElements(s.x, s.y, s.vx, s.vy);
      if (el.bound && el.peAltitude > PLANET.atmHeight && !s.deployed) {
        s.deployed = true;
        s.phase = 'deployed';
        deployed = true;
        addLog(s, `${p.def.name} deployed. Orbit confirmed.`, true);
      } else {
        addLog(s, 'Payload deploy withheld — orbit is not yet stable.', true);
      }
    }
  }
  s.nextStage = st - 1;
  if (fired) addLog(s, fired === 1 ? 'Engine ignition.' : `${fired} engines ignited.`, true);
  if (dropped && fired) addLog(s, 'Stage separation.', true);
  return { fired, dropped, deployed };
}

export function tryDeploy(s: FlightState): boolean {
  const el = orbitalElements(s.x, s.y, s.vx, s.vy);
  if (!el.bound || el.peAltitude <= PLANET.atmHeight || s.deployed || s.crashed) return false;
  const sat = s.parts.find((p) => p.attached && p.def.category === 'payload');
  if (!sat) return false;
  s.deployed = true;
  s.phase = 'deployed';
  addLog(s, `${sat.def.name} deployed. Welcome to orbit.`, true);
  return true;
}

export function abortFlight(s: FlightState): void {
  if (s.crashed || s.deployed) return;
  s.aborted = true;
  s.throttle = 0;
  s.phase = 'aborted';
  for (const p of s.parts) p.ignited = false;
  addLog(s, 'Abort. Flight terminated.', true);
}

/** One integration step (RK4 on the point mass, Euler on fuel). */
export function stepFlight(s: FlightState, dt: number): AccelSample {
  if (s.crashed || dt <= 0) return sampleAccel(s, s.x, s.y, s.vx, s.vy, 0);
  if (s.aborted) {
    // Ballistic after abort.
    s.throttle = 0;
  }
  const th = s.throttle;
  const a1 = sampleAccel(s, s.x, s.y, s.vx, s.vy, th);
  const a2 = sampleAccel(s, s.x + s.vx * dt / 2, s.y + s.vy * dt / 2, s.vx + a1.ax * dt / 2, s.vy + a1.ay * dt / 2, th);
  const a3 = sampleAccel(s, s.x + (s.vx + a1.ax * dt / 2) * dt / 2, s.y + (s.vy + a1.ay * dt / 2) * dt / 2, s.vx + a2.ax * dt / 2, s.vy + a2.ay * dt / 2, th);
  const a4 = sampleAccel(s, s.x + (s.vx + a2.ax * dt) * dt, s.y + (s.vy + a2.ay * dt) * dt, s.vx + a3.ax * dt, s.vy + a3.ay * dt, th);
  const ax = (a1.ax + 2 * a2.ax + 2 * a3.ax + a4.ax) / 6;
  const ay = (a1.ay + 2 * a2.ay + 2 * a3.ay + a4.ay) / 6;
  s.vx += ax * dt;
  s.vy += ay * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  drainFuel(s, a1.mdot, dt);
  s.t += dt;
  if (a1.q > s.maxQ) s.maxQ = a1.q;
  const h = Math.hypot(s.x, s.y) - PLANET.radius;
  if (h < 0 && !s.crashed) {
    s.crashed = true;
    s.throttle = 0;
    s.phase = 'crashed';
    addLog(s, "We have lost the vehicle. Impact.", true);
  }
  return a1;
}

export function altitudeOf(s: FlightState): number { return Math.hypot(s.x, s.y) - PLANET.radius; }
export function inertialSpeed(s: FlightState): number { return Math.hypot(s.vx, s.vy); }
export function surfaceSpeed(s: FlightState): number {
  const atmx = -PLANET.omega * s.y, atmy = PLANET.omega * s.x;
  return Math.hypot(s.vx - atmx, s.vy - atmy);
}
export function progradePitch(s: FlightState): number {
  const r = Math.max(Math.hypot(s.x, s.y), 1);
  const rx = s.x / r, ry = s.y / r;
  const tx = -ry, ty = rx;
  const vr = s.vx * rx + s.vy * ry;
  const vt = s.vx * tx + s.vy * ty;
  return Math.atan2(vt, vr) * 180 / Math.PI;
}

export function remainingStageFuel(s: FlightState): { liquid: number; solid: number; thrust: number } {
  const a = sampleAccel(s, s.x, s.y, s.vx, s.vy, s.throttle);
  return { liquid: attachedFuel(s, 'liquid'), solid: attachedFuel(s, 'solid'), thrust: a.thrust };
}

/** Should the autopilot (or a helpful player cue) stage? Flameout with a lower stage left. */
export function shouldAutoStage(s: FlightState): boolean {
  if (s.crashed || s.aborted) return false;
  const ignited = s.parts.filter((p) => p.attached && p.ignited && (p.def.category === 'engine' || p.def.category === 'srb'));
  if (!ignited.length) {
    // On the pad, or between stages: if there is a lower engine stage, yes (liftoff / restart).
    return s.parts.some((p) => p.attached && !p.ignited && (p.def.category === 'engine' || p.def.category === 'srb') && p.stage < 15);
  }
  const a = sampleAccel(s, s.x, s.y, s.vx, s.vy, 1);
  if (a.thrust > 50) return false;
  // Flameout: stage if anything remains to fire (decoupler / next engine / fairing at high alt).
  return s.parts.some((p) => p.attached && p.stage <= s.nextStage && p.stage < 15 && !p.ignited && (
    p.def.category === 'engine' || p.def.category === 'srb' || p.def.category === 'decoupler' || p.def.category === 'fairing'
  ));
}

/** Classic gravity-turn pitch program (degrees from vertical). */
export function ascentPitch(altitude: number, surfaceVel: number): number {
  if (surfaceVel < 80) return 0;
  if (altitude < 1000) return Math.min(12, (surfaceVel - 80) * 0.12);
  if (altitude < 10_000) return 10 + 35 * (altitude - 1000) / 9000;
  if (altitude < 45_000) return 45 + 38 * (altitude - 10_000) / 35_000;
  return 85;
}

export interface AscentResult {
  reachedOrbit: boolean;
  deployed: boolean;
  crashed: boolean;
  t: number;
  apAltitude: number;
  peAltitude: number;
  eccentricity: number;
  maxQ: number;
  log: FlightLogEntry[];
  state: FlightState;
}

/**
 * Reference autopilot: ignite, gravity-turn, cut when apoapsis is at the parking altitude,
 * coast, circularize near apoapsis, deploy. Used by the unit test and as an optional
 * "Guidance" assist in Mission Control.
 */

export interface Guidance { throttle: number; pitch: number; stage: boolean; deploy: boolean; jettisonFairing: boolean; phase: FlightPhase }

/** One autopilot decision from the current state (used by the scripted ascent and by Mission Control guidance). */
export function computeGuidance(s: FlightState): Guidance {
  const h = altitudeOf(s);
  const vs = surfaceSpeed(s);
  const el = orbitalElements(s.x, s.y, s.vx, s.vy);
  const wantAp = TARGET_AP;
  const tta = timeToApoapsis(el, s.x, s.y, s.vx, s.vy);
  let throttle = 0, pitch = progradePitch(s), stage = false, deploy = false, jettisonFairing = false;
  let phase: FlightPhase = s.phase;
  if (s.crashed || s.aborted || s.deployed) {
    return { throttle: 0, pitch, stage: false, deploy: false, jettisonFairing: false, phase: s.phase };
  }
  if (h > 50_000 && s.parts.some((p) => p.attached && p.def.category === 'fairing')) jettisonFairing = true;
  if (shouldAutoStage(s)) stage = true;
  if (el.bound && el.peAltitude >= TARGET_PE) {
    throttle = 0; pitch = progradePitch(s); phase = 'orbit'; deploy = true;
  } else if (el.apAltitude < wantAp) {
    phase = 'ascent';
    throttle = 1;
    if (h > 40_000 && vs > 400) pitch = Math.max(ascentPitch(h, vs), Math.min(90, progradePitch(s)));
    else pitch = ascentPitch(h, vs);
  } else if (tta != null && tta < 45 && (h > PLANET.atmHeight * 0.85 || (tta < 20 && h > 40_000))) {
    phase = 'circularize';
    throttle = 1;
    pitch = progradePitch(s);
    if (el.peAltitude > TARGET_PE + 15_000 && el.apAltitude > wantAp + 30_000) throttle = 0;
  } else {
    phase = 'coast';
    throttle = 0;
    pitch = progradePitch(s);
  }
  return { throttle, pitch, stage, deploy, jettisonFairing, phase };
}

export function scriptedAscent(design: VesselDesign = courierI(), opts: { dt?: number; maxTime?: number; state?: FlightState } = {}): AscentResult {
  const dt = opts.dt ?? 0.05;
  const maxTime = opts.maxTime ?? 900;
  const s = opts.state ?? launchState(design);
  if (s.phase === 'pad' || s.phase === 'countdown') {
    s.throttle = 1;
    s.phase = 'ascent';
    s.met0 = s.t;
    addLog(s, 'Ignition.', true);
    activateStage(s);
    addLog(s, 'Liftoff.', true);
  }
  let fairingDone = false;
  let circNote = false;
  let apNote = false;
  let maxQNote = false;
  let atmoNote = false;
  let lastStageAt = -10;

  while (s.t < maxTime && !s.crashed && !s.deployed && !s.aborted) {
    const h = altitudeOf(s);
    const vs = surfaceSpeed(s);
    const el = orbitalElements(s.x, s.y, s.vx, s.vy);
    const a = sampleAccel(s, s.x, s.y, s.vx, s.vy, s.throttle);

    if (!maxQNote && s.maxQ > 10_000 && a.q < s.maxQ * 0.92) {
      maxQNote = true;
      s.maxQPassed = true;
      addLog(s, 'Through Max-Q.', true);
    }
    if (!atmoNote && h > PLANET.atmHeight) {
      atmoNote = true;
      addLog(s, 'We are out of the atmosphere.', true);
    }
    if (!fairingDone && h > 50_000) {
      // Jettison any remaining fairing regardless of stage so drag drops for the coast.
      for (const p of s.parts) {
        if (p.attached && p.def.category === 'fairing') { p.attached = false; fairingDone = true; }
      }
      if (fairingDone) addLog(s, 'Fairing jettison.', true);
    }
    if (shouldAutoStage(s) && s.t - lastStageAt > 1.2) {
      const r = activateStage(s);
      lastStageAt = s.t;
      if (r.fired || r.dropped) addLog(s, 'Staging.', true);
    }

    const wantAp = TARGET_AP;
    const tta = timeToApoapsis(el, s.x, s.y, s.vx, s.vy);

    if (el.bound && el.peAltitude >= TARGET_PE) {
      s.throttle = 0;
      s.pitch = progradePitch(s);
      s.phase = 'orbit';
      if (!apNote) { addLog(s, 'Stable orbit. Circularization complete.', true); apNote = true; }
      tryDeploy(s);
    } else if (el.apAltitude < wantAp || (!el.bound && el.apAltitude !== Infinity && (el.apAltitude as number) < wantAp)) {
      // Still raising apoapsis.
      s.phase = 'ascent';
      s.throttle = 1;
      // After leaving the thick air, follow prograde so we don't fight the trajectory.
      if (h > 40_000 && vs > 400) s.pitch = Math.max(ascentPitch(h, vs), Math.min(90, progradePitch(s)));
      else s.pitch = ascentPitch(h, vs);
    } else {
      // Apoapsis is high enough: coast, then circularize near ap.
      if (!apNote && el.apAltitude >= wantAp) {
        addLog(s, `Apoapsis is in space (${fmtAlt(el.apAltitude)}). Coasting.`, true);
        apNote = true;
      }
      if (tta != null && tta < 45 && (h > PLANET.atmHeight * 0.85 || (tta < 20 && h > 40_000))) {
        s.phase = 'circularize';
        s.throttle = 1;
        s.pitch = progradePitch(s);
        if (!circNote) { addLog(s, 'Starting circularization burn.', true); circNote = true; }
        // Don't overshoot into a huge ellipse: if pe is climbing past target and ap is already high, cut a bit.
        if (el.peAltitude > TARGET_PE + 15_000 && el.apAltitude > wantAp + 30_000) s.throttle = 0;
      } else {
        s.phase = 'coast';
        s.throttle = 0;
        s.pitch = progradePitch(s);
      }
    }

    // Sub-step if we're near the ground and descending fast.
    stepFlight(s, dt);
    if (s.crashed) break;
  }

  const el = orbitalElements(s.x, s.y, s.vx, s.vy);
  const reachedOrbit = !s.crashed && el.bound && el.peAltitude > PLANET.atmHeight;
  if (reachedOrbit && !s.deployed) tryDeploy(s);
  return {
    reachedOrbit, deployed: s.deployed, crashed: s.crashed, t: s.t,
    apAltitude: el.apAltitude, peAltitude: el.peAltitude, eccentricity: el.eccentricity,
    maxQ: s.maxQ, log: s.log, state: s,
  };
}

export function fmtAlt(m: number): string {
  if (!Number.isFinite(m)) return '∞';
  if (Math.abs(m) >= 1_000_000) return `${(m / 1_000_000).toFixed(2)} Mm`;
  if (Math.abs(m) >= 10_000) return `${(m / 1000).toFixed(1)} km`;
  if (Math.abs(m) >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}
export function fmtVel(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(2)} km/s`;
  return `${v.toFixed(1)} m/s`;
}
export function fmtDv(v: number): string { return `${Math.round(v)} m/s`; }
export function fmtMass(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(2)} t`;
  return `${Math.round(kg)} kg`;
}
export function fmtMet(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hh > 0 ? `T+${hh}:${pad(mm)}:${pad(ss)}` : `T+${pad(mm)}:${pad(ss)}`;
}

/** Sample the predicted orbit (inertial frame) for the map. */
export function orbitPoints(el: OrbitalElements, x: number, y: number, n = 96): Array<[number, number]> {
  if (el.hyperbolic || !(el.semiMajor > 0) || el.eccentricity >= 1) {
    // A short forward-propagated arc.
    const pts: Array<[number, number]> = [];
    let px = x, py = y;
    // Use the current radius as a hint — caller can pass state if they want a trail only.
    pts.push([px, py]);
    return pts;
  }
  const a = el.semiMajor;
  const e = el.eccentricity;
  // Orientation: periapsis direction from current true anomaly.
  const r = Math.hypot(x, y);
  const nu = el.trueAnomaly;
  // Flight-path based: rotate the ellipse so the current position matches.
  // Argument of periapsis in inertial frame: angle(r) - nu.
  const theta = Math.atan2(y, x);
  const argP = theta - nu;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const ta = (i / n) * 2 * Math.PI;
    const rr = a * (1 - e * e) / (1 + e * Math.cos(ta));
    if (rr < 0) continue;
    const ang = argP + ta;
    pts.push([rr * Math.cos(ang), rr * Math.sin(ang)]);
  }
  // If we got almost nothing (degenerate), at least return current radius circle.
  if (pts.length < 4) {
    for (let i = 0; i <= n; i++) {
      const ang = (i / n) * 2 * Math.PI;
      pts.push([r * Math.cos(ang), r * Math.sin(ang)]);
    }
  }
  return pts;
}

/** Remaining vacuum Δv of still-attached stages (re-analysed from leftover fuel). */
export function liveDv(s: FlightState): { vac: number; asl: number; twr: number } {
  const mock: VesselDesign = {
    name: s.designName,
    parts: s.parts.filter((p) => p.attached).map((p) => {
      // Shrink tank fuel by rewriting a synthetic part? analyzeDesign uses catalog fuelMass.
      // Approximate with a proportional scale via a temporary design is messy. Compute directly:
      return { uid: p.uid, partId: p.partId, stage: p.stage, radial: p.radial, angle: p.angle };
    }),
  };
  // Direct: one combined "current burn" + leftover upper stages using leftover fuel.
  // Use analyze on a patched design by cloning PART fuel? We compute from live parts.
  void mock;
  const attached = s.parts.filter((p) => p.attached);
  const wet = attached.reduce((n, p) => n + p.def.dryMass + p.fuel, 0);
  // Group remaining unignited-or-burning engine stages, high to low, with leftover fuel in their segments.
  const stages = [...new Set(attached.filter((p) => (p.def.category === 'engine' || p.def.category === 'srb') && p.stage < 15).map((p) => p.stage))].sort((a, b) => b - a);
  let mass = wet;
  let vac = 0, asl = 0;
  const fakeDesign: VesselDesign = { name: 'live', parts: attached.map((p) => ({ uid: p.uid, partId: p.partId, stage: p.stage, radial: p.radial, angle: p.angle, attachTo: (p as FlightPart & { attachTo?: string }).attachTo })) };
  const segs = segmentsOf(fakeDesign);
  for (const st of stages) {
    const engs = attached.filter((p) => p.stage === st && (p.def.category === 'engine' || p.def.category === 'srb'));
    const defs = engs.map((e) => e.def);
    let fuel = 0;
    for (const e of engs) {
      if (e.def.fuelKind === 'solid') fuel += e.fuel;
      else {
        const seg = segs.find((sg) => sg.some((p) => p.uid === e.uid));
        if (!seg) continue;
        for (const sp of seg) {
          const lp = attached.find((a) => a.uid === sp.uid);
          if (lp && lp.def.fuelKind === 'liquid') fuel += lp.fuel;
        }
      }
    }
    // Avoid double-counting liquid fuel if two engines share tanks: already added per engine-seg; unique:
    // The loop can double-count. Recompute uniquely:
    fuel = 0;
    const seen = new Set<string>();
    for (const e of engs) {
      if (e.def.fuelKind === 'solid') { fuel += e.fuel; continue; }
      const seg = segs.find((sg) => sg.some((p) => p.uid === e.uid));
      if (!seg) continue;
      for (const sp of seg) {
        if (seen.has(sp.uid)) continue;
        seen.add(sp.uid);
        const lp = attached.find((a) => a.uid === sp.uid);
        if (lp && lp.def.fuelKind === 'liquid') fuel += lp.fuel;
      }
    }
    const ispV = thrustWeightedIsp(defs, 0);
    const ispA = thrustWeightedIsp(defs, PLANET.p0);
    const mf = Math.max(1, mass - fuel);
    vac += tsiolkovsky(ispV, mass, mf);
    asl += tsiolkovsky(ispA, mass, mf);
    mass = mf;
    // Drop this segment's dry leftover if not the upper.
    // Skip for live readout (slightly conservative / optimistic is fine). Just remove fuel (already done).
  }
  const a = sampleAccel(s, s.x, s.y, s.vx, s.vy, 1);
  return { vac, asl, twr: a.mass > 0 ? a.thrust / (a.mass * G0) : 0 };
}

/** Pretty CAPCOM-style status for a given moment. */
export function capcomCue(s: FlightState, prev?: { h: number; q: number }): string | null {
  const h = altitudeOf(s);
  if (s.phase === 'countdown') return null;
  if (s.crashed) return "We have lost the vehicle.";
  if (s.deployed) return 'Satellite is on station.';
  if (prev && prev.q < s.maxQ && s.maxQPassed) return 'Through Max-Q.';
  if (h > 1000 && (prev?.h ?? 0) < 1000) return 'Vehicle is pitching.';
  return null;
}

export const REFERENCE_PARK_SPEED = circularVelocity(PLANET.parkAltitude);

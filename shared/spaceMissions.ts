/**
 * Daily contract board for the Space Center.
 *
 * A rotating, deterministic set of missions is offered each UTC day. Players
 * accept a limited number, fly them on a paid launch ticket, and claim a chip
 * payout that is separate from the lifetime 5× SPACE_PAYOUT satellite bounty.
 * Polar / inclination contracts are omitted: the flight model is planar, so
 * those targets would not be meaningful.
 *
 * Payouts are before the price index (`px`); the server applies `px` at
 * accept-time display and at payout. They are sized to clear a reasonable
 * launch cost (Scout I = 5,025, Courier I = 6,850) with a conservative net
 * profit of about 5,000–75,000 chips. A per-player daily cap limits farming.
 */
import { analyzeDesign, circularVelocity, LEO_DV_BUDGET, PLANET, SPACE_LAUNCH_TTL_MS, type DesignStats } from './spaceFlight.js';
import { designCost, type VesselDesign } from './spaceParts.js';

export const MISSION_MAX_ACTIVE = 3;
export const MISSION_DAILY_CAP = 150_000;
export const MISSION_BOARD_SIZE = 8;
export const SPACE_KARMAN = PLANET.atmHeight; // 70 km — "reach space"

export type MissionKind =
  | 'reach-space'
  | 'reach-orbit'
  | 'circular'
  | 'deploy-orbit'
  | 'multi-sat'
  | 'budget-orbit'
  | 'survey-orbit'
  | 'science';

export interface MissionDef {
  /** `${day}:${templateId}` — unique for the UTC day. */
  id: string;
  templateId: string;
  day: string;
  kind: MissionKind;
  title: string;
  agency: string;
  code: string;
  briefing: string;
  success: string[];
  payout: number;
  minDv: number;
  minFlightSec: number;
  /** Success: apoapsis (or max altitude) at least this. */
  minAp?: number;
  /** Periapsis lower bound (orbit / circular / deploy). */
  minPe?: number;
  maxPe?: number;
  maxAp?: number;
  maxEcc?: number;
  satCount?: number;
  /** Catalog design cost must be < this (budget challenge). */
  maxCost?: number;
  requireDeploy?: boolean;
  /** survey-orbit: scanner map type that must be deployed in the band. */
  mapType?: string;
  /** survey-orbit: scanner part id that must be on the design. */
  scannerPart?: string;
  /** science: experiment id (and part) that must report in `situation`. */
  experimentId?: string;
  experimentPart?: string;
  situation?: string;
  /** science: total science points returned by this one flight. */
  minScience?: number;
  /** At least one of these part ids must be on the design (e.g. a relay dish). */
  requireAnyPart?: string[];
}

/** Server-side facts about a launch (never taken from the client report). */
export interface LaunchFacts {
  scannersDeployed?: string[];
  science?: Array<{ experimentId: string; situation: string; points: number }>;
}

export interface FlightReport {
  peM: number;
  apM: number;
  altitudeM?: number;
  eccentricity?: number;
  periodS?: number;
  deployed?: boolean;
  deployedCount?: number;
  flightTimeS?: number;
}

export interface TicketFacts {
  at: number;
  cost: number;
  design: VesselDesign;
  missionId?: string | null;
  ttlMs: number;
}

export function utcDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Mulberry32, same family as other seeded boards. */
export function missionRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashDay(day: string): number {
  let h = 2166136261;
  const s = `space-missions:${day}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length]!;
}
function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!; a[i] = a[j]!; a[j] = t;
  }
  return a;
}

/** Hohmann transfer Δv between two circular orbits at radii r1, r2. */
export function hohmannDv(r1: number, r2: number): number {
  const { mu } = PLANET;
  if (!(r1 > 0 && r2 > 0)) return Infinity;
  const a = (r1 + r2) / 2;
  const v1 = Math.sqrt(mu / r1);
  const v2 = Math.sqrt(mu / r2);
  const vt1 = Math.sqrt(mu * (2 / r1 - 1 / a));
  const vt2 = Math.sqrt(mu * (2 / r2 - 1 / a));
  return Math.abs(vt1 - v1) + Math.abs(v2 - vt2);
}

/**
 * Conservative vacuum-Δv budget to reach a (pe, ap) orbit, or a suborbital
 * apex. Used both to advertise a "recommended Δv" and to reject claims from
 * a design that could not have gotten there.
 */
export function minDvForTarget(opts: { peM?: number; apM: number; suborbital?: boolean }): number {
  const ap = opts.apM;
  if (opts.suborbital || (opts.peM != null && opts.peM < 0)) {
    // Straight-up ballistic energy (not a horizontal surface ellipse — a
    // sounding flight is mostly radial). Gravity and drag get a 1.7× margin.
    const r1 = PLANET.radius;
    const r2 = PLANET.radius + Math.max(0, ap);
    const v = Math.sqrt(2 * PLANET.mu * (1 / r1 - 1 / r2));
    return Math.max(1_600, Math.round(v * 1.7));
  }
  const pe = Math.max(opts.peM ?? PLANET.atmHeight + 5_000, PLANET.atmHeight);
  const apA = Math.max(ap, pe);
  const parkR = PLANET.radius + PLANET.parkAltitude;
  const apR = PLANET.radius + apA;
  const circular = Math.abs(apA - pe) < 25_000;
  const raise = hohmannDv(parkR, Math.max(apR, PLANET.radius + pe));
  return Math.round(LEO_DV_BUDGET + raise * (circular ? 1 : 0.65));
}

/**
 * Highest apoapsis a design could reasonably reach after a parking-orbit
 * insertion, burning leftover vacuum Δv prograde at periapsis (vis-viva).
 * Infinity means the leftover circularizes into an escape trajectory.
 */
export function maxApoapsisFromDv(designDv: number): number {
  const leftover = Math.max(0, designDv - LEO_DV_BUDGET * 0.9);
  const r = PLANET.radius + PLANET.parkAltitude;
  const v = circularVelocity(PLANET.parkAltitude) + leftover;
  const E = (v * v) / 2 - PLANET.mu / r;
  if (E >= -1e-6) return Infinity;
  const a = -PLANET.mu / (2 * E);
  return Math.max(0, 2 * a - r - PLANET.radius);
}

type Template = Omit<MissionDef, 'id' | 'day' | 'code'>;

const T: Template[] = [
  {
    templateId: 'sounding',
    kind: 'reach-space',
    title: 'Sounding Flight',
    agency: 'Chud Space Agency',
    briefing: 'Carry a vehicle above the 70 km atmospheric cutoff and bring back a pressure and temperature profile. A stable orbit is not required — a clean suborbital arc is enough.',
    success: ['Apoapsis or peak altitude at least 70 km'],
    payout: 25_000,
    minDv: 2_000,
    minFlightSec: 50,
    minAp: 70_000,
  },
  {
    templateId: 'first-orbit',
    kind: 'reach-orbit',
    title: 'First Orbit',
    agency: 'Chud Space Agency',
    briefing: 'Establish a stable orbit with periapsis clearly above the atmosphere. Circularization is welcome but not required; a modest ellipse is acceptable.',
    success: ['Bound orbit', 'Periapsis above 70 km'],
    payout: 50_000,
    minDv: 3_400,
    minFlightSec: 180,
    minPe: 70_000,
  },
  {
    templateId: 'circular-leo',
    kind: 'circular',
    title: 'Circular Parking Orbit',
    agency: 'Chud Space Agency',
    briefing: 'Deliver the vehicle into a tidy low orbit. Periapsis and apoapsis must both sit in the 75–120 km band, with eccentricity at most 0.025.',
    success: ['Periapsis 75–120 km', 'Apoapsis 75–120 km', 'Eccentricity ≤ 0.025'],
    payout: 60_000,
    minDv: 3_500,
    minFlightSec: 200,
    minPe: 75_000, maxPe: 120_000,
    minAp: 75_000, maxAp: 120_000,
    maxEcc: 0.025,
  },
  {
    templateId: 'circular-mid',
    kind: 'circular',
    title: 'Circular Mid-Altitude Orbit',
    agency: 'Surveyor Corps',
    briefing: 'Raise a nearly circular orbit into the 150–220 km band (eccentricity ≤ 0.03). This is a training run for higher relay slots.',
    success: ['Periapsis 150–220 km', 'Apoapsis 150–220 km', 'Eccentricity ≤ 0.03'],
    payout: 70_000,
    minDv: 3_700,
    minFlightSec: 220,
    minPe: 150_000, maxPe: 220_000,
    minAp: 150_000, maxAp: 220_000,
    maxEcc: 0.03,
  },
  {
    templateId: 'deploy-150',
    kind: 'deploy-orbit',
    title: 'CommSat 150',
    agency: 'CommNet',
    briefing: 'Deploy a communications satellite into an orbit whose periapsis is at least 150 km. Apoapsis may be higher, but both ends must clear 150 km.',
    success: ['Periapsis ≥ 150 km', 'Apoapsis ≥ 150 km', 'Satellite deployed'],
    payout: 65_000,
    minDv: 3_600,
    minFlightSec: 200,
    minPe: 150_000,
    minAp: 150_000,
    requireDeploy: true,
    satCount: 1,
  },
  {
    templateId: 'relay-uplink',
    kind: 'deploy-orbit',
    title: 'Relay Uplink 400',
    agency: 'CommNet',
    briefing: 'Extend the relay network: deploy a satellite carrying a long-range relay dish (RA-80 Relay Dish, or a Meridian heavy commsat) with both apsides above 400 km.',
    success: ['Relay dish or Meridian on the vehicle', 'Periapsis ≥ 400 km', 'Apoapsis ≥ 400 km', 'Satellite deployed'],
    payout: 105_000,
    minDv: 4_300,
    minFlightSec: 280,
    minPe: 400_000,
    minAp: 400_000,
    requireDeploy: true,
    satCount: 1,
    requireAnyPart: ['dish-ra80', 'sat-meridian'],
  },
  {
    templateId: 'deploy-250',
    kind: 'deploy-orbit',
    title: 'Weather Bird 250',
    agency: 'Weather Bureau',
    briefing: 'Place a weather satellite in the 200–300 km band. Periapsis and apoapsis must both fall inside that window.',
    success: ['Periapsis 200–300 km', 'Apoapsis 200–300 km', 'Satellite deployed'],
    payout: 80_000,
    minDv: 3_900,
    minFlightSec: 220,
    minPe: 200_000, maxPe: 300_000,
    minAp: 200_000, maxAp: 300_000,
    requireDeploy: true,
    satCount: 1,
  },
  {
    templateId: 'deploy-high',
    kind: 'deploy-orbit',
    title: 'High Relay 500',
    agency: 'CommNet',
    briefing: 'Open a high-altitude relay slot. The satellite must be deployed on an orbit with both periapsis and apoapsis between 500 and 800 km.',
    success: ['Periapsis 500–800 km', 'Apoapsis 500–800 km', 'Satellite deployed'],
    payout: 100_000,
    minDv: 4_200,
    minFlightSec: 250,
    minPe: 500_000, maxPe: 800_000,
    minAp: 500_000, maxAp: 800_000,
    requireDeploy: true,
    satCount: 1,
  },
  {
    templateId: 'deploy-loft',
    kind: 'deploy-orbit',
    title: 'Lofted Relay 800',
    agency: 'CommNet',
    briefing: 'A demanding high-orbit slot: deploy into 800–1,200 km. Plan the transfer; a low-orbit insertion plus a Hohmann raise is the usual path.',
    success: ['Periapsis 800–1,200 km', 'Apoapsis 800–1,200 km', 'Satellite deployed'],
    payout: 110_000,
    minDv: 4_500,
    minFlightSec: 260,
    minPe: 800_000, maxPe: 1_200_000,
    minAp: 800_000, maxAp: 1_200_000,
    requireDeploy: true,
    satCount: 1,
  },
  {
    templateId: 'twin-sat',
    kind: 'multi-sat',
    title: 'Twin Deployment',
    agency: 'University of Chud',
    briefing: 'Two research packages must reach a stable orbit on a single launch and both be deployed. Stack two satellites on one vehicle.',
    success: ['Bound orbit with periapsis above 70 km', 'At least two satellites on the vehicle', 'Two payloads deployed on this launch'],
    payout: 90_000,
    minDv: 3_600,
    minFlightSec: 200,
    minPe: 70_000,
    requireDeploy: true,
    satCount: 2,
  },
  {
    templateId: 'budget-scout',
    kind: 'budget-orbit',
    title: 'Economy Launch',
    agency: 'Chud Space Agency',
    briefing: 'Reach a stable orbit on a tight parts budget. The rolled-out design must cost less than 🪙 27,500 (Scout I, at 🪙 25,125, is the intended class).',
    success: ['Bound orbit with periapsis above 70 km', 'Design catalog cost under 🪙 27,500'],
    payout: 55_000,
    minDv: 3_400,
    minFlightSec: 180,
    minPe: 70_000,
    maxCost: 27_500,
  },
];

T.push(
  /* ── Mapping contracts (deploy a scanner in its optimal band) ── */
  {
    templateId: 'survey-visual', kind: 'survey-orbit', title: 'Orbital Imaging Pass', agency: 'Cartography Office',
    briefing: 'Place a visual imaging camera in its 80–200 km band so it can start photographing the surface. Coverage then builds up on the Survey tab.',
    success: ['Visual Imaging Camera on the vehicle', 'Periapsis and apoapsis 80–200 km', 'Scanner deployed'],
    payout: 40_000, minDv: 3_500, minFlightSec: 200,
    minPe: 80_000, maxPe: 200_000, minAp: 80_000, maxAp: 200_000,
    requireDeploy: true, satCount: 1, mapType: 'visual', scannerPart: 'scan-camera',
  },
  {
    templateId: 'survey-radar', kind: 'survey-orbit', title: 'Altimetry Survey Orbit', agency: 'Cartography Office',
    briefing: 'Put a radar altimeter into the 80–250 km band to map the planet’s terrain. Requires Basic Science.',
    success: ['RADAR Altimetry Sensor on the vehicle', 'Periapsis and apoapsis 80–250 km', 'Scanner deployed'],
    payout: 45_000, minDv: 3_500, minFlightSec: 200,
    minPe: 80_000, maxPe: 250_000, minAp: 80_000, maxAp: 250_000,
    requireDeploy: true, satCount: 1, mapType: 'altimetry', scannerPart: 'scan-radar',
  },
  {
    templateId: 'survey-biome', kind: 'survey-orbit', title: 'Land-Cover Survey', agency: 'Cartography Office',
    briefing: 'Deploy a multispectral imager into 150–400 km to classify biomes. Requires Electrics.',
    success: ['Multispectral Imager on the vehicle', 'Periapsis and apoapsis 150–400 km', 'Scanner deployed'],
    payout: 60_000, minDv: 3_800, minFlightSec: 220,
    minPe: 150_000, maxPe: 400_000, minAp: 150_000, maxAp: 400_000,
    requireDeploy: true, satCount: 1, mapType: 'biome', scannerPart: 'scan-multispectral',
  },
  {
    templateId: 'survey-ore', kind: 'survey-orbit', title: 'Prospecting Orbit', agency: 'Mining Consortium',
    briefing: 'A resource scanner in a low 75–150 km orbit to find ore. Requires Science Tech.',
    success: ['M700 Resource Scanner on the vehicle', 'Periapsis and apoapsis 75–150 km', 'Scanner deployed'],
    payout: 60_000, minDv: 3_500, minFlightSec: 200,
    minPe: 75_000, maxPe: 150_000, minAp: 75_000, maxAp: 150_000,
    requireDeploy: true, satCount: 1, mapType: 'resource', scannerPart: 'scan-ore',
  },
  {
    templateId: 'survey-weather', kind: 'survey-orbit', title: 'Weather Watch', agency: 'Weather Bureau',
    briefing: 'A weather mapper high above the planet, 250–700 km. Requires Advanced Exploration.',
    success: ['Weather Mapper on the vehicle', 'Periapsis and apoapsis 250–700 km', 'Scanner deployed'],
    payout: 80_000, minDv: 4_200, minFlightSec: 250,
    minPe: 250_000, maxPe: 700_000, minAp: 250_000, maxAp: 700_000,
    requireDeploy: true, satCount: 1, mapType: 'weather', scannerPart: 'scan-weather',
  },
  /* ── Science contracts (run an experiment in a situation, server-recorded) ── */
  {
    templateId: 'sci-baro-low', kind: 'science', title: 'Pressure Profile', agency: 'University of Chud',
    briefing: 'Fly a barometer through the lower atmosphere (below 18 km) and send back a reading. A small sounding rocket is plenty.',
    success: ['PresMat Barometer on the vehicle', 'Run it flying low (< 18 km)'],
    payout: 15_000, minDv: 0, minFlightSec: 10,
    experimentId: 'baro', experimentPart: 'sci-baro', situation: 'lowAtmo',
  },
  {
    templateId: 'sci-thermo-high', kind: 'science', title: 'Upper-Air Temperatures', agency: 'Weather Bureau',
    briefing: 'Take the temperature of the high atmosphere, 18–70 km.',
    success: ['2HOT Thermometer on the vehicle', 'Run it flying high (18–70 km)'],
    payout: 20_000, minDv: 900, minFlightSec: 35,
    experimentId: 'thermo', experimentPart: 'sci-thermo', situation: 'highAtmo',
  },
  {
    templateId: 'sci-geiger-orbit', kind: 'science', title: 'Radiation Survey', agency: 'University of Chud',
    briefing: 'Measure the radiation environment from low orbit. Requires Basic Science.',
    success: ['Geiger Counter on the vehicle', 'Run it in low orbit'],
    payout: 60_000, minDv: 3_400, minFlightSec: 200,
    experimentId: 'geiger', experimentPart: 'sci-geiger', situation: 'lowOrbit',
  },
  {
    templateId: 'sci-matbay-orbit', kind: 'science', title: 'Microgravity Materials', agency: 'Chud Space Agency',
    briefing: 'Expose the materials bay to long-duration microgravity in low orbit. Requires Basic Science.',
    success: ['SC-9001 Materials Bay on the vehicle', 'Run it in low orbit'],
    payout: 65_000, minDv: 3_400, minFlightSec: 200,
    experimentId: 'matbay', experimentPart: 'sci-matbay', situation: 'lowOrbit',
  },
  {
    templateId: 'sci-grav-high', kind: 'science', title: 'Gravity Field Mapping', agency: 'Surveyor Corps',
    briefing: 'Run a gravity scan from high orbit (250 km or more). Requires Science Tech.',
    success: ['GRAVMAX Gravity Scanner on the vehicle', 'Run it in high orbit'],
    payout: 90_000, minDv: 3_900, minFlightSec: 260,
    experimentId: 'grav', experimentPart: 'sci-grav', situation: 'highOrbit',
  },
  {
    templateId: 'sci-return', kind: 'science', title: 'Science Return', agency: 'Chud Space Agency',
    briefing: 'Bring home at least 25 new science points from a single flight. Any mix of experiments counts; repeats are worth less.',
    success: ['At least 25 science points recorded on one launch'],
    payout: 45_000, minDv: 0, minFlightSec: 60,
    minScience: 25,
  },
);

export const MISSION_TEMPLATES: readonly Template[] = T;

function hydrate(t: Template, day: string): MissionDef {
  const short = day.replace(/-/g, '').slice(2);
  const code = `${t.agency.split(' ').map((w) => w[0]).join('')}‑${short}‑${t.templateId.slice(0, 8).toUpperCase()}`;
  return { ...t, id: `${day}:${t.templateId}`, day, code };
}

/**
 * Six contracts for a UTC day. Always a mix of easy / medium / hard, unique
 * templates, deterministic from the date so every player sees the same board.
 */
export function dailyBoard(day: string): MissionDef[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid mission day.');
  const rng = missionRng(hashDay(day));
  const easy = T.filter((t) => t.templateId === 'sounding' || t.templateId === 'first-orbit' || t.templateId === 'budget-scout');
  const medium = T.filter((t) => ['circular-leo', 'circular-mid', 'deploy-150', 'deploy-250', 'twin-sat'].includes(t.templateId));
  const hard = T.filter((t) => t.templateId === 'deploy-high' || t.templateId === 'deploy-loft' || t.templateId === 'relay-uplink');
  const pickN = (pool: Template[], n: number) => {
    const s = shuffle(rng, pool);
    return s.slice(0, Math.min(n, s.length));
  };
  const survey = T.filter((t) => t.kind === 'survey-orbit');
  const science = T.filter((t) => t.kind === 'science');
  const chosen = [...pickN(easy, 2), ...pickN(medium, 3), ...pickN(hard, 1), ...pickN(survey, 1), ...pickN(science, 1)];
  const ordered = shuffle(rng, chosen);
  // Guarantee uniqueness and exact board size.
  const seen = new Set<string>();
  const out: MissionDef[] = [];
  for (const t of ordered) {
    if (seen.has(t.templateId)) continue;
    seen.add(t.templateId);
    out.push(hydrate(t, day));
  }
  // If a pool was short, fill from leftovers.
  if (out.length < MISSION_BOARD_SIZE) {
    for (const t of shuffle(rng, T)) {
      if (seen.has(t.templateId)) continue;
      seen.add(t.templateId);
      out.push(hydrate(t, day));
      if (out.length >= MISSION_BOARD_SIZE) break;
    }
  }
  return out.slice(0, MISSION_BOARD_SIZE);
}

export function missionById(id: string): MissionDef | null {
  const i = id.indexOf(':');
  if (i < 0) return null;
  const day = id.slice(0, i);
  const tid = id.slice(i + 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const t = T.find((x) => x.templateId === tid);
  return t ? hydrate(t, day) : null;
}

/** True if this design, on paper, can attempt the contract. */
export function designMeetsMission(design: VesselDesign, mission: MissionDef): string | null {
  const stats = analyzeDesign(design);
  if (stats.totalDvVac < mission.minDv * 0.95) {
    return `This design has ${Math.round(stats.totalDvVac)} m/s of vacuum Δv; the contract calls for about ${mission.minDv} m/s.`;
  }
  if (mission.maxCost != null && designCost(design) >= mission.maxCost) {
    return `This design costs 🪙 ${designCost(design).toLocaleString('en-US')}; the budget cap is under 🪙 ${mission.maxCost.toLocaleString('en-US')}.`;
  }
  if (mission.scannerPart && !design.parts.some((p) => p.partId === mission.scannerPart)) {
    return 'This contract needs the matching scanner on the vehicle.';
  }
  if (mission.experimentPart && !design.parts.some((p) => p.partId === mission.experimentPart)) {
    return 'This contract needs the matching experiment on the vehicle.';
  }
  if (mission.requireAnyPart?.length && !design.parts.some((p) => mission.requireAnyPart!.includes(p.partId))) {
    return 'This contract needs a long-range relay dish (RA-80) or a Meridian commsat on the vehicle.';
  }
  if (mission.minScience && !design.parts.some((p) => p.partId.startsWith('sci-'))) {
    return 'This contract needs at least one science experiment on the vehicle.';
  }
  const need = mission.satCount ?? (mission.requireDeploy ? 1 : 0);
  if (need > 0 && stats.payloads.length < need) {
    return need === 1
      ? 'This contract needs a satellite on the stack.'
      : `This contract needs ${need} satellites on a single vehicle.`;
  }
  return null;
}

export function payoutAfterCap(want: number, paidToday: number, cap: number = MISSION_DAILY_CAP): number {
  if (want <= 0) return 0;
  if (paidToday >= cap) return 0;
  return Math.min(want, cap - paidToday);
}

export type CompletionFail =
  | { ok: false; reason: string }
  | { ok: true; payout: number; capped: boolean; want: number };

/**
 * Pure completion check: ticket, timing, Δv plausibility, and reported
 * orbital elements against the contract. The server adds identity, QA, and
 * the daily cap (via payoutAfterCap) on top of this.
 */
export function evaluateCompletion(opts: {
  mission: MissionDef;
  acceptedAt: number;
  now: number;
  ticket: TicketFacts;
  report: FlightReport;
  designDv?: number;
  facts?: LaunchFacts;
}): CompletionFail {
  const { mission, acceptedAt, now, ticket, report } = opts;
  const facts = opts.facts ?? {};
  if (ticket.missionId && ticket.missionId !== mission.id) {
    return { ok: false, reason: 'That launch was not filed against this contract.' };
  }
  if (!ticket.missionId) {
    return { ok: false, reason: 'That launch was not filed against this contract.' };
  }
  if (ticket.at < acceptedAt) {
    return { ok: false, reason: 'The launch ticket is older than the accepted contract.' };
  }
  if (now - ticket.at > ticket.ttlMs) {
    return { ok: false, reason: 'That launch ticket has expired.' };
  }
  const ageSec = (now - ticket.at) / 1000;
  const flown = report.flightTimeS ?? ageSec;
  if (ageSec < mission.minFlightSec || flown < mission.minFlightSec * 0.85) {
    return { ok: false, reason: 'The flight was too short to have reached that objective.' };
  }
  const stats: DesignStats = analyzeDesign(ticket.design);
  const dv = opts.designDv ?? stats.totalDvVac;
  if (dv < mission.minDv * 0.95) {
    return { ok: false, reason: 'This design does not have enough vacuum Δv for the contracted orbit.' };
  }
  const paper = designMeetsMission(ticket.design, mission);
  if (paper) return { ok: false, reason: paper };

  if (mission.kind === 'science') {
    const recs = facts.science ?? [];
    if (mission.minScience) {
      const pts = recs.reduce((s, r) => s + (r.points || 0), 0);
      if (pts + 1e-9 < mission.minScience) {
        return { ok: false, reason: `This flight has returned ${Math.round(pts * 10) / 10} science; the contract needs ${mission.minScience}.` };
      }
    } else if (!recs.some((r) => r.experimentId === mission.experimentId && r.situation === mission.situation)) {
      return { ok: false, reason: 'No matching experiment result was recorded on this launch.' };
    }
    return { ok: true, payout: mission.payout, capped: false, want: mission.payout };
  }

  const ap = Number(report.apM);
  const pe = Number(report.peM);
  if (!Number.isFinite(ap) || !Number.isFinite(pe)) {
    return { ok: false, reason: 'Orbit figures were missing or invalid.' };
  }
  if (ap < pe - 1) {
    return { ok: false, reason: 'Apoapsis cannot be below periapsis.' };
  }
  // Reachable-range check: claimed apoapsis must be within vis-viva reach of the design.
  // Suborbital "reach space" is allowed a lower bar (minDv already covers it).
  if (mission.kind !== 'reach-space') {
    const maxAp = maxApoapsisFromDv(dv);
    if (Number.isFinite(maxAp) && ap > maxAp * 1.2 + 50_000) {
      return { ok: false, reason: 'The reported orbit is beyond what this design can reach.' };
    }
  }

  const alt = report.altitudeM ?? Math.max(ap, pe, 0);
  const ecc = report.eccentricity ?? eccentricityOf(pe, ap);

  if (mission.kind === 'reach-space') {
    const peak = Math.max(ap, alt);
    if (peak < (mission.minAp ?? SPACE_KARMAN)) {
      return { ok: false, reason: `Peak altitude was ${Math.round(peak / 1000)} km; the contract needs 70 km.` };
    }
    return { ok: true, payout: mission.payout, capped: false, want: mission.payout };
  }

  // All remaining kinds need a bound orbit above the atmosphere.
  const minPe = mission.minPe ?? SPACE_KARMAN;
  if (!(pe >= minPe && ap >= (mission.minAp ?? minPe))) {
    return { ok: false, reason: 'The orbit does not meet the contracted altitude.' };
  }
  // Bound: periapsis above the air implies the vis-viva ellipse is closed if e < 1,
  // which is true when ap is finite and pe > 0. Reject hyperbolic claims.
  if (ecc >= 1 || !Number.isFinite(ap) || ap > 50_000_000) {
    return { ok: false, reason: 'That trajectory is not a bound orbit.' };
  }
  if (mission.maxPe != null && pe > mission.maxPe) {
    return { ok: false, reason: 'Periapsis is above the contracted band.' };
  }
  if (mission.maxAp != null && ap > mission.maxAp) {
    return { ok: false, reason: 'Apoapsis is above the contracted band.' };
  }
  if (mission.maxEcc != null && ecc > mission.maxEcc) {
    return { ok: false, reason: `Eccentricity is ${ecc.toFixed(3)}; the contract allows at most ${mission.maxEcc}.` };
  }
  if (mission.requireDeploy && !report.deployed && (report.deployedCount ?? 0) < 1) {
    return { ok: false, reason: 'The payload was not deployed.' };
  }
  if (mission.kind === 'survey-orbit' && !(facts.scannersDeployed ?? []).includes(mission.mapType ?? '')) {
    return { ok: false, reason: 'The matching scanner was not deployed on this launch.' };
  }
  const needSats = mission.satCount ?? 0;
  if (needSats > 1 && (report.deployedCount ?? (report.deployed ? 1 : 0)) < needSats) {
    return { ok: false, reason: `This contract needs ${needSats} payloads deployed on one launch.` };
  }
  return { ok: true, payout: mission.payout, capped: false, want: mission.payout };
}

export function eccentricityOf(peM: number, apM: number): number {
  const rPe = PLANET.radius + peM;
  const rAp = PLANET.radius + apM;
  if (!(rPe > 0 && rAp > 0)) return 1;
  return Math.abs(rAp - rPe) / (rAp + rPe);
}

export function reportMeetsMission(mission: MissionDef, report: FlightReport): boolean {
  const r = evaluateCompletion({
    mission,
    acceptedAt: 0,
    now: mission.minFlightSec * 1000 + 1_000,
    ticket: {
      at: 0,
      cost: 0,
      design: { name: 'probe', parts: [] },
      missionId: mission.id,
      ttlMs: SPACE_LAUNCH_TTL_MS,
    },
    report,
    designDv: 8_000,
  });
  // The empty design will fail designMeetsMission for deploy / budget / dv.
  // Use a narrower criteria helper for UI live-checks:
  return criteriaOnly(mission, report);
}

/** Client-side "can we claim?" — orbital criteria only, no ticket. */
export function criteriaOnly(mission: MissionDef, report: FlightReport & { science?: LaunchFacts['science'] }): boolean {
  if (mission.kind === 'science') {
    const recs = report.science ?? [];
    if (mission.minScience) return recs.reduce((s, r) => s + r.points, 0) >= mission.minScience;
    return recs.some((r) => r.experimentId === mission.experimentId && r.situation === mission.situation);
  }
  const ap = report.apM, pe = report.peM;
  if (!Number.isFinite(ap) || !Number.isFinite(pe) || ap < pe - 1) return false;
  const alt = report.altitudeM ?? Math.max(ap, 0);
  const ecc = report.eccentricity ?? eccentricityOf(pe, ap);
  if (mission.kind === 'reach-space') return Math.max(ap, alt) >= (mission.minAp ?? SPACE_KARMAN);
  if (pe < (mission.minPe ?? SPACE_KARMAN)) return false;
  if (mission.minAp != null && ap < mission.minAp) return false;
  if (mission.maxPe != null && pe > mission.maxPe) return false;
  if (mission.maxAp != null && ap > mission.maxAp) return false;
  if (mission.maxEcc != null && ecc > mission.maxEcc) return false;
  if (ecc >= 1) return false;
  if (mission.requireDeploy && !report.deployed && (report.deployedCount ?? 0) < 1) return false;
  if ((mission.satCount ?? 0) > 1 && (report.deployedCount ?? 0) < (mission.satCount ?? 0)) return false;
  return true;
}

export function netVsLaunch(payout: number, launchCost: number): number {
  return payout - launchCost;
}

/** Display helper: one-line success condition. */
export function missionSummary(m: MissionDef): string {
  return m.success[0] ?? m.title;
}

void pick;

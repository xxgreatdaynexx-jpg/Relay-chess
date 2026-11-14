/**
 * KSP-style science: experiment parts, situations, biomes, diminishing returns,
 * and a small tech tree that spends science points on new parts.
 *
 * Every existing part is a starter part and stays unlocked. New parts (bigger
 * engines and tanks, higher-ISP engines, extra experiments and scanners) are
 * gated by tech nodes.
 */
import { PLANET, LEO_DV_BUDGET, orbitalElements, type OrbitalElements } from './spaceFlight.js';
import { biomeAt, equatorBiomes, wrapLon, BIOMES, type BiomeId } from './spaceTerrain.js';

export type Situation = 'pad' | 'lowAtmo' | 'highAtmo' | 'suborbital' | 'lowOrbit' | 'highOrbit';

export const SITUATIONS: Record<Situation, { name: string; mult: number; minMetS: number; minDv: number }> = {
  pad: { name: 'On the pad', mult: 0.3, minMetS: 0, minDv: 0 },
  lowAtmo: { name: 'Flying low (< 18 km)', mult: 0.7, minMetS: 4, minDv: 0 },
  highAtmo: { name: 'Flying high (18–70 km)', mult: 0.9, minMetS: 35, minDv: 900 },
  suborbital: { name: 'In space, suborbital', mult: 1.0, minMetS: 70, minDv: 1_800 },
  lowOrbit: { name: 'Low orbit (< 250 km)', mult: 1.25, minMetS: 200, minDv: 3_230 },
  highOrbit: { name: 'High orbit (≥ 250 km)', mult: 1.6, minMetS: 260, minDv: 0 /* set below */ },
};
{
  // LEO budget plus a Hohmann raise from the 80 km parking orbit to 250 km (same model as contracts).
  const r1 = PLANET.radius + PLANET.parkAltitude, r2 = PLANET.radius + 250_000;
  const a = (r1 + r2) / 2;
  const dv = Math.abs(Math.sqrt(PLANET.mu * (2 / r1 - 1 / a)) - Math.sqrt(PLANET.mu / r1))
    + Math.abs(Math.sqrt(PLANET.mu / r2) - Math.sqrt(PLANET.mu * (2 / r2 - 1 / a)));
  SITUATIONS.highOrbit.minDv = Math.round((LEO_DV_BUDGET + dv) * 0.95);
}

export const LOW_ATMO_CEILING = 18_000;
export const HIGH_ORBIT_FLOOR = 250_000;

export interface ExperimentDef {
  id: string;
  partId: string;
  name: string;
  base: number;
  situations: Situation[];
  /** Situations where the result depends on the biome below. */
  biomeIn: Situation[];
}

export const EXPERIMENTS: ExperimentDef[] = [
  { id: 'thermo', partId: 'sci-thermo', name: '2HOT Thermometer', base: 8,
    situations: ['pad', 'lowAtmo', 'highAtmo', 'suborbital', 'lowOrbit'], biomeIn: ['pad', 'lowAtmo'] },
  { id: 'baro', partId: 'sci-baro', name: 'PresMat Barometer', base: 12,
    situations: ['pad', 'lowAtmo', 'highAtmo'], biomeIn: ['pad', 'lowAtmo'] },
  { id: 'geiger', partId: 'sci-geiger', name: 'Geiger Counter', base: 15,
    situations: ['highAtmo', 'suborbital', 'lowOrbit', 'highOrbit'], biomeIn: ['lowOrbit'] },
  { id: 'magneto', partId: 'sci-mag', name: 'Magnetometer Boom', base: 20,
    situations: ['suborbital', 'lowOrbit', 'highOrbit'], biomeIn: [] },
  { id: 'atmo', partId: 'sci-atmo', name: 'Atmospheric Sampler', base: 18,
    situations: ['lowAtmo', 'highAtmo'], biomeIn: ['lowAtmo', 'highAtmo'] },
  { id: 'grav', partId: 'sci-grav', name: 'GRAVMAX Gravity Scanner', base: 30,
    situations: ['suborbital', 'lowOrbit', 'highOrbit'], biomeIn: ['lowOrbit', 'highOrbit'] },
  { id: 'matbay', partId: 'sci-matbay', name: 'Materials Bay', base: 25,
    situations: ['pad', 'lowAtmo', 'highAtmo', 'suborbital', 'lowOrbit', 'highOrbit'], biomeIn: ['pad'] },
  { id: 'seismic', partId: 'sci-seismic', name: 'Seismic Accelerometer', base: 25,
    situations: ['pad', 'lowAtmo'], biomeIn: ['pad', 'lowAtmo'] },
];

export const EXPERIMENT_BY_ID = new Map(EXPERIMENTS.map((e) => [e.id, e]));
export const EXPERIMENT_BY_PART = new Map(EXPERIMENTS.map((e) => [e.partId, e]));

/** Fraction of the remaining subject value each repeat earns. */
export const SCIENCE_REPEAT_FACTOR = 0.5;
/** Chips per science point (research grant), before px. */
export const SCIENCE_GRANT_PER_POINT = 100;
/** Separate small cap on research grants per UTC day, before px. */
export const SCIENCE_GRANT_DAILY_CAP = 10_000;

export function situationOf(opts: { alt: number; el?: OrbitalElements; onPad?: boolean }): Situation {
  if (opts.onPad) return 'pad';
  const { alt } = opts;
  if (alt < PLANET.atmHeight) return alt < LOW_ATMO_CEILING ? 'lowAtmo' : 'highAtmo';
  const el = opts.el;
  const orbit = !!el && el.bound && el.peAltitude > PLANET.atmHeight;
  if (!orbit) return 'suborbital';
  return alt >= HIGH_ORBIT_FLOOR ? 'highOrbit' : 'lowOrbit';
}

export function situationFromState(s: { x: number; y: number; vx: number; vy: number; phase: string }): Situation {
  const r = Math.hypot(s.x, s.y);
  const alt = r - PLANET.radius;
  const onPad = s.phase === 'pad' || s.phase === 'countdown';
  return situationOf({ alt, el: orbitalElements(s.x, s.y, s.vx, s.vy), onPad });
}

/** Biome under the vehicle (equatorial; λ = atan2(y, x) − ωt). */
export function biomeUnder(s: { x: number; y: number; t: number; phase?: string }): BiomeId {
  if (s.phase === 'pad' || s.phase === 'countdown') return 'launch-site';
  const lon = wrapLon(Math.atan2(s.y, s.x) - PLANET.omega * s.t);
  return biomeAt(0, lon);
}

export function subjectKey(expId: string, sit: Situation, biome: string): string {
  return `${expId}@${sit}${biome && biome !== 'global' ? ':' + biome : ''}`;
}

/** Biome actually used for the subject (global if the experiment ignores biome there). */
export function subjectBiome(exp: ExperimentDef, sit: Situation, biome: string): string {
  if (!exp.biomeIn.includes(sit)) return 'global';
  if (sit === 'pad') return 'launch-site';
  return biome;
}

/** Full value of a subject (cap). */
export function subjectCap(exp: ExperimentDef, sit: Situation): number {
  return exp.base * SITUATIONS[sit].mult;
}

/** Science for the (n+1)th run of a subject; n = prior runs. */
export function scienceValue(exp: ExperimentDef, sit: Situation, priorRuns: number): number {
  const cap = subjectCap(exp, sit);
  const v = cap * Math.pow(SCIENCE_REPEAT_FACTOR, Math.max(0, priorRuns));
  return v < 0.25 ? 0 : Math.round(v * 100) / 100;
}

/** Lifetime ceiling of a subject: cap × (1 / (1 − f)), minus the cut-off. */
export function subjectCeiling(exp: ExperimentDef, sit: Situation): number {
  return subjectCap(exp, sit) / (1 - SCIENCE_REPEAT_FACTOR);
}

/** Plausibility check for a science report against the paid ticket. */
export function validateScience(opts: {
  exp: ExperimentDef | undefined;
  situation: string;
  biome: string;
  metS: number;
  ticketAgeS: number;
  designDv: number;
  alt: number;
  peM?: number;
  apM?: number;
  partOnDesign: boolean;
  partUnlocked: boolean;
}): string | null {
  const { exp } = opts;
  if (!exp) return 'Unknown experiment.';
  if (!opts.partOnDesign) return 'That experiment is not on the launched vehicle.';
  if (!opts.partUnlocked) return 'That experiment has not been researched.';
  const sit = opts.situation as Situation;
  if (!(sit in SITUATIONS)) return 'Unknown situation.';
  if (!exp.situations.includes(sit)) return `${exp.name} cannot be run ${SITUATIONS[sit].name.toLowerCase()}.`;
  const S = SITUATIONS[sit];
  if (!Number.isFinite(opts.metS) || opts.metS < S.minMetS) return 'The flight was too short to reach that situation.';
  if (opts.metS > opts.ticketAgeS + 8) return 'Mission time does not match the launch ticket.';
  if (opts.designDv < S.minDv) return 'This vehicle could not have reached that situation.';
  // Reported state must match the situation.
  const alt = opts.alt;
  if (sit === 'pad' && !(Math.abs(alt) < 200)) return 'The vehicle is not on the pad.';
  if (sit === 'lowAtmo' && !(alt >= 0 && alt < LOW_ATMO_CEILING)) return 'Altitude does not match low flight.';
  if (sit === 'highAtmo' && !(alt >= LOW_ATMO_CEILING && alt < PLANET.atmHeight)) return 'Altitude does not match high flight.';
  if (sit === 'suborbital' && !(alt >= PLANET.atmHeight)) return 'The vehicle is not in space.';
  if (sit === 'lowOrbit' || sit === 'highOrbit') {
    const pe = Number(opts.peM), ap = Number(opts.apM);
    if (!(pe > PLANET.atmHeight) || !(ap >= pe - 1)) return 'The vehicle is not in a stable orbit.';
    if (sit === 'lowOrbit' && !(alt >= PLANET.atmHeight && alt < HIGH_ORBIT_FLOOR)) return 'Altitude does not match low orbit.';
    if (sit === 'highOrbit' && !(alt >= HIGH_ORBIT_FLOOR)) return 'Altitude does not match high orbit.';
  }
  const want = subjectBiome(exp, sit, opts.biome);
  if (want !== 'global' && want !== 'launch-site' && !equatorBiomes().includes(want as BiomeId)) {
    return 'That biome is not under the flight path.';
  }
  return null;
}

/* ── Flavor text ── */
const FLAVOR: Record<string, Partial<Record<Situation, string>> & { any: string }> = {
  thermo: {
    pad: 'The pad is warm from the morning sun and the last test firing. Nothing unusual — a fine baseline.',
    lowAtmo: 'Air temperature falls steadily with altitude. The lapse rate matches the textbooks within a degree.',
    highAtmo: 'The thermometer reads colder than a freezer, then oddly warmer near the top of the stratosphere.',
    suborbital: 'Readings swing wildly between sunlit and shaded sides of the probe.',
    lowOrbit: 'Hot in sunlight, bitterly cold in shadow. Thermal blankets earn their keep.',
    any: 'Temperature logged.',
  },
  baro: {
    pad: 'One standard atmosphere, near enough. The barometer is happy.',
    lowAtmo: 'Pressure drops by half every few kilometres. The scale height of Chud is confirmed.',
    highAtmo: 'Barely any air left. The needle has almost nothing to push against.',
    any: 'Pressure logged.',
  },
  geiger: {
    highAtmo: 'A few extra clicks — cosmic-ray showers are reaching the upper air.',
    suborbital: 'The counter chatters as the vehicle climbs above the protective air.',
    lowOrbit: 'A steady background of counts, with spikes over certain regions below.',
    highOrbit: 'The radiation belt is real. The counter is clicking like rain on a roof.',
    any: 'Radiation counts logged.',
  },
  magneto: {
    suborbital: 'The field lines bend as the probe arcs over the planet.',
    lowOrbit: 'A clean measurement of the dipole field, with a mysterious anomaly in the south.',
    highOrbit: 'The magnetosphere is thinner here; the solar wind pushes on it.',
    any: 'Magnetic field logged.',
  },
  atmo: {
    lowAtmo: 'Nitrogen, oxygen, a whiff of something floral, and a lot of pollen.',
    highAtmo: 'The thin air holds traces of ozone and fine volcanic dust.',
    any: 'Air sample logged.',
  },
  grav: {
    suborbital: 'A first rough gravity profile. The planet is a little lumpy.',
    lowOrbit: 'Mass concentrations under the mountains tug the probe very slightly.',
    highOrbit: 'From up here the gravity field is smooth and almost perfectly spherical.',
    any: 'Gravity field logged.',
  },
  matbay: {
    pad: 'The samples sit quietly on the pad. Control group established.',
    lowAtmo: 'Vibration shakes the samples. One of them is now a different shape.',
    highAtmo: 'Cold and low pressure have made the goo crystallise into fascinating patterns.',
    suborbital: 'A few minutes of weightlessness. The samples float, tumble, and settle again.',
    lowOrbit: 'Long-duration microgravity. The metal foam cures with perfectly round bubbles.',
    highOrbit: 'Radiation has discoloured several samples. The scientists are delighted.',
    any: 'Materials study logged.',
  },
  seismic: {
    pad: 'Booster ignition registers as a small earthquake. The pad crew are less amused.',
    lowAtmo: 'A falling spent stage hits the ground; the accelerometer records the thump.',
    any: 'Seismic data logged.',
  },
};

export function flavorText(expId: string, sit: Situation, biome: string): string {
  const f = FLAVOR[expId];
  const base = (f && (f[sit] ?? f.any)) ?? 'Data logged.';
  if (biome && biome !== 'global' && biome !== 'launch-site') {
    const b = BIOMES[biome as BiomeId]?.name;
    if (b) return `${base} (Over the ${b}.)`;
  }
  return base;
}

/* ── Tech tree ── */
export interface TechNode {
  id: string;
  name: string;
  cost: number;
  requires: string[];
  unlocks: string[];
  blurb: string;
  tier: number;
}

export const TECH_NODES: TechNode[] = [
  { id: 'start', name: 'Start', cost: 0, requires: [], tier: 0,
    unlocks: ['sci-thermo', 'sci-baro', 'scan-camera'],
    blurb: 'Basic thermometer, barometer, and a visual-imaging camera.' },
  { id: 'stability', name: 'Stability', cost: 15, requires: ['start'], tier: 1,
    unlocks: ['nose-125', 'fin-delta', 'truss-1'],
    blurb: 'Nose cones, tail fins and truss spacers.' },
  { id: 'basic-science', name: 'Basic Science', cost: 10, requires: ['start'], tier: 1,
    unlocks: ['sci-matbay', 'sci-geiger', 'scan-radar'],
    blurb: 'Materials bay, Geiger counter, and a radar altimeter.' },
  { id: 'general-rocketry', name: 'General Rocketry', cost: 20, requires: ['start'], tier: 1,
    unlocks: ['x200-16', 'x200-8', 'ad-2', 'coupler-2'],
    blurb: 'Rockomax 2.5 m tanks, the 1.25→2.5 m adapter and the bi-coupler.' },
  { id: 'aerodynamics', name: 'Aerodynamics', cost: 45, requires: ['stability'], tier: 2,
    unlocks: ['nose-25', 'hs-25', 'chute-mk16'],
    blurb: 'Big ogive nose cone, ablative heat shield and parachutes.' },
  { id: 'flight-control', name: 'Flight Control', cost: 40, requires: ['stability'], tier: 2,
    unlocks: ['probe-hexa', 'rw-1', 'rcs-4', 'mono-150', 'mono-600'],
    blurb: 'HEXA-2 core, reaction wheel, RCS blocks and monopropellant tanks.' },
  { id: 'electrics', name: 'Electrics', cost: 35, requires: ['basic-science'], tier: 2,
    unlocks: ['sci-mag', 'scan-multispectral', 'sci-seismic', 'battery-z', 'lamp-1'],
    blurb: 'Magnetometer, multispectral imager, seismic accelerometer, batteries and floodlights.' },
  { id: 'miniaturization', name: 'Miniaturization', cost: 30, requires: ['basic-science'], tier: 2,
    unlocks: ['probe-pip', 'oscar-25', 'oscar-60', 'oscar-120', 'gnat', 'tr-2v', 'ad-1', 'sparrow', 'ant-whip'],
    blurb: 'The 0.625 m line: Pip core, Oscar tanks, Gnat thruster, Sparrow motor and adapters.' },
  { id: 'advanced-rocketry', name: 'Advanced Rocketry', cost: 50, requires: ['general-rocketry'], tier: 2,
    unlocks: ['skipper', 'x200-32', 'fl-t1600', 'spur', 'coupler-3', 'pounder'],
    blurb: 'Skipper, long tanks, radial Spur engines, the tri-coupler and the Pounder SRB.' },
  { id: 'propulsion-systems', name: 'Propulsion Systems', cost: 75, requires: ['general-rocketry'], tier: 2,
    unlocks: ['poodle', 'wren'],
    blurb: 'Poodle and Wren — efficient vacuum engines for upper stages.' },
  { id: 'science-tech', name: 'Science Tech', cost: 90, requires: ['electrics', 'basic-science'], tier: 3,
    unlocks: ['sci-atmo', 'sci-grav', 'scan-ore'],
    blurb: 'Atmospheric sampler, gravity scanner, and the ore survey scanner.' },
  { id: 'electric-power', name: 'Electric Power', cost: 60, requires: ['electrics'], tier: 3,
    unlocks: ['solar-sp6'],
    blurb: 'Fold-out solar arrays.' },
  { id: 'communications', name: 'Communications', cost: 70, requires: ['electrics', 'miniaturization'], tier: 3,
    unlocks: ['dish-ra80', 'sat-meridian'],
    blurb: 'Relay dishes and the Meridian heavy commsat — for relay-network contracts.' },
  { id: 'command-modules', name: 'Command Modules', cost: 120, requires: ['flight-control', 'aerodynamics'], tier: 3,
    unlocks: ['pod-trident', 'leg-lt3'],
    blurb: 'Trident three-seat module and landing legs.' },
  { id: 'heavier-rocketry', name: 'Heavier Rocketry', cost: 140, requires: ['advanced-rocketry'], tier: 3,
    unlocks: ['kickback', 'bruiser', 'twinfang', 'hdm-2'],
    blurb: 'Kickback SRB, Bruiser and Twinfang lifters, heavy radial decoupler.' },
  { id: 'advanced-exploration', name: 'Advanced Exploration', cost: 180, requires: ['science-tech'], tier: 4,
    unlocks: ['scan-weather'],
    blurb: 'High-orbit weather mapper.' },
  { id: 'heavy-rocketry', name: 'Heavy Rocketry', cost: 220, requires: ['heavier-rocketry'], tier: 4,
    unlocks: ['kodiak-18', 'kodiak-36', 'kodiak-72', 'ad-3', 'tr-50', 'coupler-4', 'behemoth', 'colossus', 'probe-ring'],
    blurb: 'The 3.75 m Kodiak line: tanks, adapter, quad-coupler, Behemoth cluster, Colossus SRB.' },
  { id: 'optics', name: 'Optics', cost: 240, requires: ['science-tech', 'communications'], tier: 4,
    unlocks: ['telescope-aurora'],
    blurb: 'Aurora space telescope.' },
  { id: 'nuclear-propulsion', name: 'Nuclear Propulsion', cost: 300, requires: ['propulsion-systems', 'heavier-rocketry'], tier: 4,
    unlocks: ['nerv'],
    blurb: 'LV-N Nerv — 800 s vacuum ISP, very low thrust.' },
  { id: 'advanced-propulsion', name: 'Advanced Propulsion', cost: 260, requires: ['propulsion-systems', 'heavy-rocketry'], tier: 5,
    unlocks: ['wedge', 'rhinox'],
    blurb: 'Wedge linear aerospike and the Rhinox 3.75 m vacuum main.' },
  { id: 'nuclear-power', name: 'Nuclear Power', cost: 280, requires: ['electric-power', 'nuclear-propulsion'], tier: 5,
    unlocks: ['rtg-pb'],
    blurb: 'Radioisotope generator — power day and night.' },
  { id: 'ion-propulsion', name: 'Ion Propulsion', cost: 350, requires: ['electric-power', 'advanced-propulsion'], tier: 6,
    unlocks: ['halo-ion', 'xenon-60', 'xenon-300'],
    blurb: 'Halo-1 ion drive and xenon tanks.' },
  { id: 'space-stations', name: 'Space Stations', cost: 320, requires: ['command-modules', 'heavy-rocketry'], tier: 5,
    unlocks: ['station-haven', 'cargo-cx25'],
    blurb: 'Haven station module and the CX-25 cargo carrier.' },
];

export const TECH_BY_ID = new Map(TECH_NODES.map((n) => [n.id, n]));
/** Part id → tech node that unlocks it. Parts not listed are starter parts. */
export const PART_TECH = new Map<string, string>();
for (const n of TECH_NODES) for (const p of n.unlocks) PART_TECH.set(p, n.id);

export function unlockedParts(nodes: Iterable<string>): Set<string> {
  const set = new Set<string>();
  const have = new Set(nodes);
  have.add('start');
  for (const n of TECH_NODES) if (have.has(n.id)) for (const p of n.unlocks) set.add(p);
  return set;
}

export function isPartUnlocked(partId: string, nodes: Iterable<string>): boolean {
  if (!PART_TECH.has(partId)) return true; // starter part
  return unlockedParts(nodes).has(partId);
}

export function canUnlock(nodeId: string, have: Iterable<string>, available: number): string | null {
  const n = TECH_BY_ID.get(nodeId);
  if (!n) return 'Unknown tech node.';
  const set = new Set(have); set.add('start');
  if (set.has(nodeId)) return 'Already researched.';
  const missing = n.requires.filter((r) => !set.has(r));
  if (missing.length) return `Research ${missing.map((m) => TECH_BY_ID.get(m)?.name ?? m).join(' and ')} first.`;
  if (available + 1e-9 < n.cost) return `Needs ${n.cost} science; you have ${Math.floor(available)}.`;
  return null;
}

export const TECH_TOTAL_COST = TECH_NODES.reduce((s, n) => s + n.cost, 0);

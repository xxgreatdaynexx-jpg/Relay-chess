/**
 * Space program parts catalog and vessel designs (KSP-style stack + radial attach).
 *
 * Masses in kilograms, thrust in newtons, ISP in seconds. Costs are house-set base chips
 * (the server scales them with the price index). Fuel is liquid (LF+Ox) unless noted solid.
 */
export const G0 = 9.81;

export type PartCategory = 'pod' | 'probe' | 'tank' | 'engine' | 'srb' | 'decoupler' | 'fairing' | 'payload' | 'science';

export interface PartDef {
  id: string;
  name: string;
  short: string;
  category: PartCategory;
  description: string;
  dryMass: number;
  fuelMass: number;
  fuelKind?: 'liquid' | 'solid';
  thrustAsl?: number;
  thrustVac?: number;
  ispAsl?: number;
  ispVac?: number;
  width: number;
  height: number;
  cost: number;
  radial?: boolean;
  gimbal?: boolean;
  color: string;
  accent?: string;
}

export const SPACE_PARTS: PartDef[] = [
  { id: 'mk1-pod', name: 'Mk1 Command Pod', short: 'Mk1', category: 'pod',
    description: 'One-kerbal capsule with SAS. Heavy, sturdy, and a fine nose.',
    dryMass: 840, fuelMass: 0, width: 1.25, height: 1.15, cost: 800, color: '#c5c8ce', accent: '#6a7380' },
  { id: 'probe-okto', name: 'OKTO Probe Core', short: 'OKTO', category: 'probe',
    description: 'Lightweight unmanned guidance computer. Enough SAS to steer a small stack.',
    dryMass: 100, fuelMass: 0, width: 0.65, height: 0.35, cost: 350, color: '#2d3340', accent: '#7ad0ff' },

  { id: 'fl-t100', name: 'FL-T100 Fuel Tank', short: 'T100', category: 'tank',
    description: 'Tiny 1.25 m tank. 62.5 kg dry, 500 kg of liquid fuel.',
    dryMass: 62.5, fuelMass: 500, fuelKind: 'liquid', width: 1.25, height: 0.55, cost: 150, color: '#e8e4d8', accent: '#d06020' },
  { id: 'fl-t200', name: 'FL-T200 Fuel Tank', short: 'T200', category: 'tank',
    description: 'Short 1.25 m tank. 125 kg dry, 1,000 kg of liquid fuel.',
    dryMass: 125, fuelMass: 1000, fuelKind: 'liquid', width: 1.25, height: 1.0, cost: 275, color: '#e8e4d8', accent: '#d06020' },
  { id: 'fl-t400', name: 'FL-T400 Fuel Tank', short: 'T400', category: 'tank',
    description: 'Standard 1.25 m tank. 250 kg dry, 2,000 kg of liquid fuel.',
    dryMass: 250, fuelMass: 2000, fuelKind: 'liquid', width: 1.25, height: 1.875, cost: 500, color: '#e8e4d8', accent: '#d06020' },
  { id: 'fl-t800', name: 'FL-T800 Fuel Tank', short: 'T800', category: 'tank',
    description: 'Tall 1.25 m tank. 500 kg dry, 4,000 kg of liquid fuel.',
    dryMass: 500, fuelMass: 4000, fuelKind: 'liquid', width: 1.25, height: 3.75, cost: 900, color: '#e8e4d8', accent: '#d06020' },
  { id: 'jumbo-64', name: 'Jumbo-64 Fuel Tank', short: 'Jumbo', category: 'tank',
    description: 'Big 2.5 m tank. 4 t dry, 32 t of liquid fuel. For heavy lifters.',
    dryMass: 4000, fuelMass: 32000, fuelKind: 'liquid', width: 2.5, height: 3.75, cost: 4500, color: '#e8e4d8', accent: '#c05018' },

  { id: 'reliant', name: 'LV-T30 Reliant', short: 'Reliant', category: 'engine',
    description: 'Workhorse 1.25 m booster. 215 kN at sea level, 240 kN / 310 s in vacuum.',
    dryMass: 1250, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 215_000, thrustVac: 240_000, ispAsl: 265, ispVac: 310,
    width: 1.25, height: 1.55, cost: 1400, color: '#8a9098', accent: '#e07020' },
  { id: 'swivel', name: 'LV-T45 Swivel', short: 'Swivel', category: 'engine',
    description: 'Gimballed 1.25 m engine. 192 kN at sea level, 215 kN / 320 s in vacuum.',
    dryMass: 1500, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 192_000, thrustVac: 215_000, ispAsl: 250, ispVac: 320,
    width: 1.25, height: 1.7, cost: 1600, gimbal: true, color: '#8a9098', accent: '#40a0e0' },
  { id: 'terrier', name: 'LV-909 Terrier', short: 'Terrier', category: 'engine',
    description: 'Vacuum upper stage. Weak in air (14 kN / 85 s), 60 kN and 345 s in vacuum.',
    dryMass: 500, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 14_000, thrustVac: 60_000, ispAsl: 85, ispVac: 345,
    width: 1.25, height: 1.05, cost: 1100, gimbal: true, color: '#7a8088', accent: '#c0d0e0' },
  { id: 'spark', name: '48-7S Spark', short: 'Spark', category: 'engine',
    description: 'Tiny 0.625 m engine for probes. 16 kN at sea level, 20 kN / 270 s in vacuum.',
    dryMass: 100, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 16_000, thrustVac: 20_000, ispAsl: 170, ispVac: 270,
    width: 0.65, height: 0.45, cost: 400, gimbal: true, color: '#7a8088', accent: '#f0c040' },
  { id: 'mainsail', name: 'RE-M3 Mainsail', short: 'Mainsail', category: 'engine',
    description: 'Heavy 2.5 m engine. 1.25 MN at sea level, 1.38 MN / 310 s in vacuum.',
    dryMass: 6000, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 1_250_000, thrustVac: 1_379_000, ispAsl: 285, ispVac: 310,
    width: 2.5, height: 3.1, cost: 6500, gimbal: true, color: '#6a7078', accent: '#e04020' },

  { id: 'hammer', name: 'RT-10 Hammer', short: 'Hammer', category: 'srb',
    description: 'Small radial solid booster. 190 kN at sea level, 2.8 t of solid fuel, ~195 s.',
    dryMass: 750, fuelMass: 2800, fuelKind: 'solid', thrustAsl: 190_000, thrustVac: 227_000, ispAsl: 170, ispVac: 195,
    width: 1.0, height: 2.6, cost: 400, radial: true, color: '#f2efe6', accent: '#c02820' },
  { id: 'thumper', name: 'BACC Thumper', short: 'Thumper', category: 'srb',
    description: 'Medium radial solid booster. 250 kN at sea level, 6.15 t of solid fuel, 210 s vacuum.',
    dryMass: 1500, fuelMass: 6150, fuelKind: 'solid', thrustAsl: 250_000, thrustVac: 300_000, ispAsl: 175, ispVac: 210,
    width: 1.25, height: 3.6, cost: 850, radial: true, color: '#f2efe6', accent: '#c02820' },

  { id: 'tr-18a', name: 'TR-18A Stack Decoupler', short: 'Decoupler', category: 'decoupler',
    description: '1.25 m stacked separator. Fires with its stage and drops everything aft of it.',
    dryMass: 40, fuelMass: 0, width: 1.25, height: 0.22, cost: 200, color: '#d4c44a', accent: '#886010' },
  { id: 'tt-38k', name: 'TT-38K Radial Decoupler', short: 'Radial dec.', category: 'decoupler',
    description: 'Throws a radially attached booster clear of the core.',
    dryMass: 25, fuelMass: 0, width: 0.35, height: 0.4, cost: 250, radial: true, color: '#d4c44a', accent: '#886010' },
  { id: 'tr-25', name: 'TR-38-D Stack Decoupler', short: '2.5 m dec.', category: 'decoupler',
    description: '2.5 m stacked separator for Jumbo / Mainsail stacks.',
    dryMass: 100, fuelMass: 0, width: 2.5, height: 0.28, cost: 400, color: '#d4c44a', accent: '#886010' },

  { id: 'fairing-125', name: '1.25 m Fairing', short: 'Fairing', category: 'fairing',
    description: 'Protective shell that cuts payload drag. Jettison once you are above the thick air.',
    dryMass: 100, fuelMass: 0, width: 1.25, height: 1.6, cost: 300, color: '#f4f1ea', accent: '#b8b0a4' },
  { id: 'fairing-25', name: '2.5 m Fairing', short: '2.5 m fairing', category: 'fairing',
    description: 'Wide fairing for 2.5 m stacks.',
    dryMass: 400, fuelMass: 0, width: 2.5, height: 2.6, cost: 800, color: '#f4f1ea', accent: '#b8b0a4' },

  { id: 'commsat', name: 'CommSat', short: 'CommSat', category: 'payload',
    description: 'Communications satellite. Deploys once you have a stable orbit above the atmosphere.',
    dryMass: 150, fuelMass: 0, width: 0.8, height: 0.7, cost: 1200, color: '#c9a84c', accent: '#4a80c0' },
  { id: 'scisat', name: 'SciSat', short: 'SciSat', category: 'payload',
    description: 'Science satellite with a magnetometer boom and a small dish.',
    dryMass: 200, fuelMass: 0, width: 0.85, height: 0.8, cost: 1600, color: '#c9a84c', accent: '#60c080' },
  { id: 'weathersat', name: 'WeatherSat', short: 'WxSat', category: 'payload',
    description: 'Weather satellite. Same deployment rules as the other payloads.',
    dryMass: 180, fuelMass: 0, width: 0.85, height: 0.75, cost: 1400, color: '#c9a84c', accent: '#80c0e0' },
  /* ── Researched parts (unlocked in the tech tree) ── */
  { id: 'x200-16', name: 'Rockomax X200-16 Fuel Tank', short: 'X200-16', category: 'tank',
    description: '2.5 m tank. 1 t dry, 8 t of liquid fuel.',
    dryMass: 1000, fuelMass: 8000, fuelKind: 'liquid', width: 2.5, height: 1.9, cost: 1500, color: '#e8e4d8', accent: '#c05018' },
  { id: 'x200-32', name: 'Rockomax X200-32 Fuel Tank', short: 'X200-32', category: 'tank',
    description: 'Tall 2.5 m tank. 2 t dry, 16 t of liquid fuel.',
    dryMass: 2000, fuelMass: 16000, fuelKind: 'liquid', width: 2.5, height: 3.75, cost: 2800, color: '#e8e4d8', accent: '#c05018' },
  { id: 'skipper', name: 'RE-I5 Skipper', short: 'Skipper', category: 'engine',
    description: '2.5 m booster. 568 kN at sea level, 650 kN / 320 s in vacuum.',
    dryMass: 3000, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 568_000, thrustVac: 650_000, ispAsl: 280, ispVac: 320,
    width: 2.5, height: 2.4, cost: 3600, gimbal: true, color: '#6a7078', accent: '#d0a020' },
  { id: 'poodle', name: 'RE-L10 Poodle', short: 'Poodle', category: 'engine',
    description: '2.5 m vacuum engine. Weak in air (64 kN / 90 s), 250 kN and 350 s in vacuum.',
    dryMass: 1750, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 64_000, thrustVac: 250_000, ispAsl: 90, ispVac: 350,
    width: 2.5, height: 1.4, cost: 2400, gimbal: true, color: '#7a8088', accent: '#60b0e0' },
  { id: 'nerv', name: 'LV-N Nerv', short: 'Nerv', category: 'engine',
    description: 'Nuclear thermal engine. 800 s in vacuum but only 60 kN, and 185 s at sea level.',
    dryMass: 3000, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 13_900, thrustVac: 60_000, ispAsl: 185, ispVac: 800,
    width: 1.25, height: 2.6, cost: 9000, gimbal: false, color: '#5a6068', accent: '#80ff80' },
  { id: 'kickback', name: 'S1 SRB-KD25k Kickback', short: 'Kickback', category: 'srb',
    description: 'Huge radial solid booster. 593 kN at sea level, 22.5 t of solid fuel, 220 s vacuum.',
    dryMass: 4500, fuelMass: 22500, fuelKind: 'solid', thrustAsl: 593_000, thrustVac: 670_000, ispAsl: 195, ispVac: 220,
    width: 1.25, height: 5.0, cost: 2700, radial: true, color: '#f2efe6', accent: '#2050c0' },

  /* ── Science experiments (stay on the vehicle; run from Mission Control) ── */
  { id: 'sci-thermo', name: '2HOT Thermometer', short: 'Thermo', category: 'science',
    description: 'Measures temperature. Works on the pad, in the air, and in low space.',
    dryMass: 5, fuelMass: 0, width: 0.5, height: 0.22, cost: 300, color: '#b8bcc4', accent: '#e05040' },
  { id: 'sci-baro', name: 'PresMat Barometer', short: 'Baro', category: 'science',
    description: 'Measures air pressure. Only useful inside the atmosphere.',
    dryMass: 5, fuelMass: 0, width: 0.5, height: 0.22, cost: 400, color: '#b8bcc4', accent: '#40a0e0' },
  { id: 'sci-geiger', name: 'Geiger Counter', short: 'Geiger', category: 'science',
    description: 'Counts radiation. Best above the protective air.',
    dryMass: 10, fuelMass: 0, width: 0.55, height: 0.26, cost: 600, color: '#b8bcc4', accent: '#e0d040' },
  { id: 'sci-mag', name: 'Magnetometer Boom', short: 'Magneto', category: 'science',
    description: 'Maps the magnetic field from space.',
    dryMass: 50, fuelMass: 0, width: 0.65, height: 0.3, cost: 900, color: '#b8bcc4', accent: '#a060e0' },
  { id: 'sci-atmo', name: 'Atmospheric Sampler', short: 'AtmoSamp', category: 'science',
    description: 'Collects and analyses air in flight.',
    dryMass: 40, fuelMass: 0, width: 0.8, height: 0.35, cost: 800, color: '#b8bcc4', accent: '#60d0c0' },
  { id: 'sci-grav', name: 'GRAVMAX Gravity Scanner', short: 'Grav', category: 'science',
    description: 'Measures the gravity field. Space only.',
    dryMass: 100, fuelMass: 0, width: 0.7, height: 0.32, cost: 1500, color: '#b8bcc4', accent: '#f08030' },
  { id: 'sci-matbay', name: 'SC-9001 Materials Bay', short: 'MatBay', category: 'science',
    description: 'Exposes material samples to the environment. Works anywhere.',
    dryMass: 200, fuelMass: 0, width: 1.25, height: 0.5, cost: 900, color: '#d8dce2', accent: '#50a050' },
  { id: 'sci-seismic', name: 'Seismic Accelerometer', short: 'Seismic', category: 'science',
    description: 'Feels the ground shake. Records on the pad and in the first low climb.',
    dryMass: 5, fuelMass: 0, width: 0.5, height: 0.22, cost: 700, color: '#b8bcc4', accent: '#c08040' },

  /* ── Mapping scanners (deployed like satellites) ── */
  { id: 'scan-camera', name: 'Visual Imaging Camera', short: 'VisCam', category: 'payload',
    description: 'High-resolution optical camera. Best 80–200 km; narrow 6° swath.',
    dryMass: 120, fuelMass: 0, width: 0.8, height: 0.7, cost: 1500, color: '#c9a84c', accent: '#e0e0e0' },
  { id: 'scan-radar', name: 'RADAR Altimetry Sensor', short: 'Radar', category: 'payload',
    description: 'Radar altimeter for elevation maps. Best 80–250 km; 12° swath.',
    dryMass: 150, fuelMass: 0, width: 0.85, height: 0.75, cost: 1800, color: '#c9a84c', accent: '#40c0f0' },
  { id: 'scan-multispectral', name: 'Multispectral Imager', short: 'MultiSpec', category: 'payload',
    description: 'Land-cover and biome mapping. Best 150–400 km; 16° swath.',
    dryMass: 180, fuelMass: 0, width: 0.85, height: 0.8, cost: 2200, color: '#c9a84c', accent: '#60e080' },
  { id: 'scan-ore', name: 'M700 Resource Scanner', short: 'OreScan', category: 'payload',
    description: 'Ore and mineral survey. Best 70–150 km; narrow 5° beam.',
    dryMass: 200, fuelMass: 0, width: 0.85, height: 0.8, cost: 2600, color: '#c9a84c', accent: '#f0a030' },
  { id: 'scan-weather', name: 'Weather Mapper', short: 'WxMap', category: 'payload',
    description: 'Global cloud mapping from high orbit. Best 250–700 km; 22° swath.',
    dryMass: 250, fuelMass: 0, width: 0.9, height: 0.85, cost: 3000, color: '#c9a84c', accent: '#a0d0ff' },
];

export const PART_BY_ID = new Map(SPACE_PARTS.map((p) => [p.id, p]));

export const PART_CATEGORIES: Array<{ id: PartCategory; label: string }> = [
  { id: 'pod', label: 'Command pods' },
  { id: 'probe', label: 'Probe cores' },
  { id: 'tank', label: 'Fuel tanks' },
  { id: 'engine', label: 'Liquid engines' },
  { id: 'srb', label: 'Solid boosters' },
  { id: 'decoupler', label: 'Decouplers' },
  { id: 'fairing', label: 'Fairings' },
  { id: 'payload', label: 'Satellites & scanners' },
  { id: 'science', label: 'Science' },
];

export interface PlacedPart {
  uid: string;
  partId: string;
  /** KSP-style: the highest stage number fires first. */
  stage: number;
  /** Radial attachment around the parent stack part. */
  radial?: boolean;
  /** Azimuth in degrees (0, 90, 180, 270 for 4-way symmetry). */
  angle?: number;
  /** Parent stack uid for radials; omitted radials attach to the nearest lower stack part. */
  attachTo?: string;
}

export interface VesselDesign {
  name: string;
  parts: PlacedPart[];
}

export const MAX_DESIGN_PARTS = 48;
export const MAX_STAGE = 16;

export function newPartUid(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

export function partOf(id: string): PartDef | undefined {
  return PART_BY_ID.get(id);
}

export function designCost(d: VesselDesign): number {
  let n = 0;
  for (const p of d.parts) {
    const def = PART_BY_ID.get(p.partId);
    if (def) n += def.cost;
  }
  return n;
}

export function designHash(d: VesselDesign): string {
  return d.parts.map((p) => `${p.partId}:${p.stage}:${p.radial ? 1 : 0}:${Math.round(p.angle ?? 0)}`).join('|');
}

export interface DesignIssue { level: 'error' | 'warn'; text: string }

/** Structural and completeness checks. Does not compute delta-v (see analyzeDesign). */
export function validateDesign(d: VesselDesign): DesignIssue[] {
  const out: DesignIssue[] = [];
  if (!d || typeof d.name !== 'string' || !d.name.trim()) out.push({ level: 'error', text: 'The design needs a name.' });
  if (!d || !Array.isArray(d.parts)) return [{ level: 'error', text: 'The design is empty.' }];
  if (d.parts.length === 0) out.push({ level: 'error', text: 'Add some parts in the Vehicle Assembly Building.' });
  if (d.parts.length > MAX_DESIGN_PARTS) out.push({ level: 'error', text: `A vessel can have at most ${MAX_DESIGN_PARTS} parts.` });
  const uids = new Set<string>();
  let pods = 0, engines = 0, payloads = 0;
  for (const p of d.parts) {
    if (!p || typeof p.uid !== 'string' || !p.uid || uids.has(p.uid)) out.push({ level: 'error', text: 'A part is missing a unique id.' });
    else uids.add(p.uid);
    const def = PART_BY_ID.get(p.partId);
    if (!def) { out.push({ level: 'error', text: `Unknown part: ${p.partId}.` }); continue; }
    if (!Number.isInteger(p.stage) || p.stage < 0 || p.stage > MAX_STAGE) out.push({ level: 'error', text: `${def.short} has a bad stage number.` });
    if (def.category === 'pod' || def.category === 'probe') pods += 1;
    if (def.category === 'engine' || def.category === 'srb') engines += 1;
    if (def.category === 'payload') payloads += 1;
  }
  if (pods === 0) out.push({ level: 'error', text: 'You need a command pod or a probe core.' });
  if (engines === 0) out.push({ level: 'error', text: 'You need at least one engine or booster.' });
  if (payloads === 0) out.push({ level: 'warn', text: 'No satellite on board — you can fly, but there is nothing to deploy.' });
  return out;
}

export function hasErrors(issues: DesignIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

/** Build a design from a compact stack list. `count` places several radials at even angles. */
export function makeDesign(name: string, items: Array<{ part: string; stage: number; radial?: boolean; count?: number; uid?: string }>): VesselDesign {
  const parts: PlacedPart[] = [];
  let n = 0;
  let lastStack = '';
  for (const it of items) {
    const count = it.radial ? (it.count ?? 1) : 1;
    for (let i = 0; i < count; i++) {
      const uid = it.uid && count === 1 ? it.uid : `p${n++}`;
      const placed: PlacedPart = { uid, partId: it.part, stage: it.stage };
      if (it.radial) {
        placed.radial = true;
        placed.angle = (360 / count) * i;
        if (lastStack) placed.attachTo = lastStack;
      } else {
        lastStack = uid;
      }
      parts.push(placed);
    }
  }
  return { name, parts };
}

/**
 * Courier I — the documented reference launcher.
 * Upper: CommSat + OKTO + fairing + FL-T400 + Terrier.
 * First: two FL-T800s + Reliant, stacked under a decoupler.
 * Vacuum delta-v is well above the 3,400 m/s LEO budget; sea-level liftoff TWR is about 1.6.
 */
export function courierI(): VesselDesign {
  return makeDesign('Courier I', [
    { part: 'commsat', stage: 0 },
    { part: 'probe-okto', stage: 15 },
    { part: 'fairing-125', stage: 2 },
    { part: 'fl-t400', stage: 1 },
    { part: 'terrier', stage: 1 },
    { part: 'tr-18a', stage: 1 },
    { part: 'fl-t800', stage: 3 },
    { part: 'fl-t800', stage: 3 },
    { part: 'reliant', stage: 3 },
  ]);
}

/** A slightly cheaper two-stage probe launcher (T800 first stage). */
export function scoutI(): VesselDesign {
  return makeDesign('Scout I', [
    { part: 'commsat', stage: 0 },
    { part: 'probe-okto', stage: 15 },
    { part: 'fairing-125', stage: 2 },
    { part: 'fl-t200', stage: 1 },
    { part: 'spark', stage: 1 },
    { part: 'tr-18a', stage: 1 },
    { part: 'fl-t800', stage: 3 },
    { part: 'reliant', stage: 3 },
  ]);
}

/** Stock designs offered in the VAB (free to load; launching still costs the parts). */
export const STOCK_DESIGNS: VesselDesign[] = [courierI(), scoutI()];

export function cloneDesign(d: VesselDesign): VesselDesign {
  return { name: d.name, parts: d.parts.map((p) => ({ ...p })) };
}

/** Stack parts in nose-to-tail order (non-radial), used by the side-view preview. */
export function stackOrder(d: VesselDesign): PlacedPart[] {
  return d.parts.filter((p) => !p.radial);
}

export function radialsOn(d: VesselDesign, parentUid: string): PlacedPart[] {
  return d.parts.filter((p) => p.radial && (p.attachTo === parentUid));
}

/** Assign a sensible default stage when the player adds a part of this category. */
export function defaultStageFor(category: PartCategory, current: VesselDesign): number {
  const stages = current.parts.map((p) => p.stage);
  const max = stages.length ? Math.max(...stages.filter((s) => s < 15), 0) : 0;
  if (category === 'payload') return 0;
  if (category === 'pod' || category === 'probe' || category === 'science') return 15;
  if (category === 'decoupler') return Math.max(1, max);
  if (category === 'engine' || category === 'srb') return Math.max(max, 1);
  if (category === 'fairing') return Math.max(1, max - 1);
  return max;
}

export const SPACE_MAX_DESIGNS = 20;
export const SPACE_MAX_NAME = 40;

/** Sanitize a client-supplied design. Returns null if the shape is unusable. */
export function parseDesign(raw: unknown): VesselDesign | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { name?: unknown; parts?: unknown };
  if (typeof r.name !== 'string') return null;
  const name = r.name.trim().slice(0, SPACE_MAX_NAME);
  if (!name || !Array.isArray(r.parts) || r.parts.length > MAX_DESIGN_PARTS) return null;
  const parts: PlacedPart[] = [];
  const uids = new Set<string>();
  for (const p of r.parts) {
    if (!p || typeof p !== 'object') return null;
    const x = p as Record<string, unknown>;
    if (typeof x.uid !== 'string' || typeof x.partId !== 'string' || !Number.isInteger(x.stage)) return null;
    if (!PART_BY_ID.has(x.partId)) return null;
    if (x.stage as number < 0 || (x.stage as number) > MAX_STAGE) return null;
    const uid = x.uid.slice(0, 32);
    if (!uid || uids.has(uid)) return null;
    uids.add(uid);
    const placed: PlacedPart = { uid, partId: x.partId, stage: x.stage as number };
    if (x.radial === true) placed.radial = true;
    if (typeof x.angle === 'number' && Number.isFinite(x.angle)) placed.angle = x.angle;
    if (typeof x.attachTo === 'string' && x.attachTo) placed.attachTo = x.attachTo.slice(0, 32);
    parts.push(placed);
  }
  return { name, parts };
}

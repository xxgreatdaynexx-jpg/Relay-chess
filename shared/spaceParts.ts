/**
 * Space program parts catalog and vessel designs (KSP-style stack + radial attach).
 *
 * Masses in kilograms, thrust in newtons, ISP in seconds. Costs are house-set base chips
 * (the server scales them with the price index). Fuel is liquid (LF+Ox) unless noted solid.
 */
export const G0 = 9.81;

export type PartCategory = 'pod' | 'probe' | 'tank' | 'engine' | 'srb' | 'decoupler' | 'fairing' | 'payload' | 'science' | 'structural' | 'utility';

/** Propellant a tank holds or an engine burns. Solids burn their own grain; the rest feed from tanks in the same segment. */
export type FuelKind = 'liquid' | 'solid' | 'xenon' | 'mono';

export interface PartDef {
  id: string;
  name: string;
  short: string;
  category: PartCategory;
  description: string;
  dryMass: number;
  fuelMass: number;
  fuelKind?: FuelKind;
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
  /** Adapters and couplers: diameter of the aft end (width is the forward end). */
  widthBottom?: number;
  /** Couplers: engines mounted directly below fire as a cluster of this many. */
  mounts?: number;
  /** Art: bells drawn on a multi-nozzle engine. */
  nozzles?: number;
  /** Aerodynamics: a nose cone on the front trims drag; fins add a little. */
  aero?: 'nose' | 'fin';
  /** Generates or stores electric charge (batteries, solar, RTG). */
  power?: boolean;
  /** Needs a power part somewhere on the vessel (ion drive). */
  needsPower?: boolean;
  /** Antennas: comm range in km (relay dishes reach far beyond low orbit). */
  commRangeKm?: number;
  /** Engine art variant. */
  style?: 'aerospike' | 'ion';
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

  /* ── Expanded catalog: command ── */
  { id: 'probe-pip', name: 'Pip Micro Probe Core', short: 'Pip', category: 'probe',
    description: '0.625 m probe core for tiny upper stages. 30 kg, basic SAS.',
    dryMass: 30, fuelMass: 0, width: 0.625, height: 0.22, cost: 800, color: '#30363f', accent: '#ffb347' },
  { id: 'probe-hexa', name: 'HEXA-2 Guidance Core', short: 'HEXA-2', category: 'probe',
    description: '1.25 m hexagonal probe core with a built-in reaction wheel and better SAS.',
    dryMass: 160, fuelMass: 0, width: 1.25, height: 0.4, cost: 600, color: '#2a3038', accent: '#7af0c0' },
  { id: 'probe-ring', name: 'RINGCORE-25 Avionics Ring', short: 'Ringcore', category: 'probe',
    description: '2.5 m flight computer ring. Steers big stacks without a pod.',
    dryMass: 400, fuelMass: 0, width: 2.5, height: 0.45, cost: 1100, color: '#3a4048', accent: '#7ad0ff' },
  { id: 'pod-trident', name: 'Trident Three-Seat Module', short: 'Trident', category: 'pod',
    description: '2.5 m three-seat command module with docking port and heat shield.',
    dryMass: 2720, fuelMass: 0, width: 2.5, height: 2.2, cost: 4200, color: '#c8ccd2', accent: '#5a6676' },

  /* ── Expanded catalog: fuel tanks ── */
  { id: 'oscar-25', name: 'Oscar-25 Mini Tank', short: 'Oscar-25', category: 'tank',
    description: 'Tiny 0.625 m tank. 25 kg dry, 100 kg of liquid fuel.',
    dryMass: 25, fuelMass: 100, fuelKind: 'liquid', width: 0.625, height: 0.32, cost: 170, color: '#e8e4d8', accent: '#d08a20' },
  { id: 'oscar-60', name: 'Oscar-60 Mini Tank', short: 'Oscar-60', category: 'tank',
    description: '0.625 m tank. 50 kg dry, 250 kg of liquid fuel.',
    dryMass: 50, fuelMass: 250, fuelKind: 'liquid', width: 0.625, height: 0.62, cost: 360, color: '#e8e4d8', accent: '#d08a20' },
  { id: 'oscar-120', name: 'Oscar-120 Mini Tank', short: 'Oscar-120', category: 'tank',
    description: 'Long 0.625 m tank. 100 kg dry, 500 kg of liquid fuel.',
    dryMass: 100, fuelMass: 500, fuelKind: 'liquid', width: 0.625, height: 1.2, cost: 650, color: '#e8e4d8', accent: '#d08a20' },
  { id: 'fl-t1600', name: 'FL-T1600 Long Tank', short: 'T1600', category: 'tank',
    description: 'Extra-long 1.25 m tank. 1 t dry, 8 t of liquid fuel.',
    dryMass: 1000, fuelMass: 8000, fuelKind: 'liquid', width: 1.25, height: 7.4, cost: 1750, color: '#e8e4d8', accent: '#d06020' },
  { id: 'x200-8', name: 'Rockomax X200-8 Fuel Tank', short: 'X200-8', category: 'tank',
    description: 'Short 2.5 m tank. 500 kg dry, 4 t of liquid fuel.',
    dryMass: 500, fuelMass: 4000, fuelKind: 'liquid', width: 2.5, height: 1.0, cost: 820, color: '#e8e4d8', accent: '#c05018' },
  { id: 'kodiak-18', name: 'Kodiak S3-18 Tank', short: 'Kodiak-18', category: 'tank',
    description: 'Squat 3.75 m tank. 2.25 t dry, 18 t of liquid fuel.',
    dryMass: 2250, fuelMass: 18000, fuelKind: 'liquid', width: 3.75, height: 1.9, cost: 3100, color: '#ece8dc', accent: '#3a5a8a' },
  { id: 'kodiak-36', name: 'Kodiak S3-36 Tank', short: 'Kodiak-36', category: 'tank',
    description: '3.75 m tank. 4.5 t dry, 36 t of liquid fuel.',
    dryMass: 4500, fuelMass: 36000, fuelKind: 'liquid', width: 3.75, height: 3.75, cost: 5600, color: '#ece8dc', accent: '#3a5a8a' },
  { id: 'kodiak-72', name: 'Kodiak S3-72 Tank', short: 'Kodiak-72', category: 'tank',
    description: 'Tall 3.75 m tank. 9 t dry, 72 t of liquid fuel. The core of a super-heavy lifter.',
    dryMass: 9000, fuelMass: 72000, fuelKind: 'liquid', width: 3.75, height: 7.5, cost: 10400, color: '#ece8dc', accent: '#3a5a8a' },
  { id: 'xenon-60', name: 'PB-X60 Xenon Canister', short: 'Xenon-60', category: 'tank',
    description: '0.625 m pressurised xenon canister for ion drives. 60 kg dry, 70 kg of xenon.',
    dryMass: 60, fuelMass: 70, fuelKind: 'xenon', width: 0.625, height: 0.45, cost: 1400, color: '#d8dde4', accent: '#6080ff' },
  { id: 'xenon-300', name: 'PB-X300 Xenon Tank', short: 'Xenon-300', category: 'tank',
    description: '1.25 m xenon tank. 240 kg dry, 300 kg of xenon.',
    dryMass: 240, fuelMass: 300, fuelKind: 'xenon', width: 1.25, height: 0.75, cost: 4400, color: '#d8dde4', accent: '#6080ff' },
  { id: 'mono-150', name: 'Rondo Monoprop Sphere', short: 'Mono-150', category: 'tank',
    description: '0.625 m monopropellant sphere for RCS attitude jets. 40 kg dry, 150 kg of monoprop.',
    dryMass: 40, fuelMass: 150, fuelKind: 'mono', width: 0.625, height: 0.5, cost: 320, color: '#f2f2ee', accent: '#e0a020' },
  { id: 'mono-600', name: 'FL-R600 Monoprop Tank', short: 'Mono-600', category: 'tank',
    description: '1.25 m monopropellant tank. 150 kg dry, 600 kg of monoprop.',
    dryMass: 150, fuelMass: 600, fuelKind: 'mono', width: 1.25, height: 0.7, cost: 640, color: '#f2f2ee', accent: '#e0a020' },

  /* ── Expanded catalog: liquid engines ── */
  { id: 'gnat', name: 'Gnat-2 Microthruster', short: 'Gnat', category: 'engine',
    description: 'Tiny 0.625 m upper-stage engine. 2 kN / 315 s in vacuum; useless in thick air.',
    dryMass: 20, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 510, thrustVac: 2_000, ispAsl: 80, ispVac: 315,
    width: 0.5, height: 0.35, cost: 520, gimbal: false, color: '#7a8088', accent: '#f0c040' },
  { id: 'wren', name: 'LV-W4 Wren Vacuum Engine', short: 'Wren', category: 'engine',
    description: 'Efficient 1.25 m vacuum engine with a long extension. 125 kN / 355 s in vacuum, 150 s at sea level.',
    dryMass: 650, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 53_000, thrustVac: 125_000, ispAsl: 150, ispVac: 355,
    width: 1.25, height: 1.5, cost: 1900, gimbal: true, color: '#7a8088', accent: '#9ad0ff' },
  { id: 'bruiser', name: 'KR-1 Bruiser Lifter', short: 'Bruiser', category: 'engine',
    description: 'Very high-thrust 1.25 m lifter. 800 kN at sea level, 900 kN / 310 s in vacuum. Thirsty.',
    dryMass: 3600, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 800_000, thrustVac: 900_000, ispAsl: 268, ispVac: 310,
    width: 1.25, height: 1.6, cost: 5600, gimbal: true, color: '#62686f', accent: '#e05030' },
  { id: 'spur', name: 'RS-2 Spur Radial Engine', short: 'Spur', category: 'engine',
    description: 'Radially mounted liquid engine that feeds from the core tanks. 108 kN at sea level, 120 kN / 305 s.',
    dryMass: 900, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 108_000, thrustVac: 120_000, ispAsl: 275, ispVac: 305,
    width: 0.6, height: 1.3, cost: 1300, radial: true, gimbal: true, color: '#7a8088', accent: '#e07020' },
  { id: 'wedge', name: 'WX-1 Wedge Linear Aerospike', short: 'Wedge', category: 'engine',
    description: 'Altitude-compensating aerospike: 290 s at sea level and 340 s in vacuum, 180 kN throughout.',
    dryMass: 1000, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 175_000, thrustVac: 180_000, ispAsl: 290, ispVac: 340,
    width: 1.25, height: 1.1, cost: 4200, gimbal: false, style: 'aerospike', color: '#8a9098', accent: '#d0d8e0' },
  { id: 'twinfang', name: 'RE-T2 Twinfang', short: 'Twinfang', category: 'engine',
    description: 'Two-nozzle 2.5 m booster. 1.87 MN at sea level, 2.0 MN / 300 s in vacuum.',
    dryMass: 6500, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 1_870_000, thrustVac: 2_000_000, ispAsl: 280, ispVac: 300,
    width: 2.5, height: 2.6, cost: 9600, gimbal: true, nozzles: 2, color: '#5e646c', accent: '#e0a020' },
  { id: 'behemoth', name: 'KR-4 Behemoth Cluster', short: 'Behemoth', category: 'engine',
    description: 'Four-nozzle 3.75 m first-stage cluster. 3.75 MN at sea level, 4.0 MN / 315 s in vacuum.',
    dryMass: 15000, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 3_750_000, thrustVac: 4_000_000, ispAsl: 295, ispVac: 315,
    width: 3.75, height: 3.6, cost: 18500, gimbal: true, nozzles: 4, color: '#585e66', accent: '#d04020' },
  { id: 'rhinox', name: 'RV-3 Rhinox Vacuum Main', short: 'Rhinox', category: 'engine',
    description: '3.75 m heavy upper-stage engine. 2.0 MN / 340 s in vacuum, only 205 s at sea level.',
    dryMass: 9000, fuelMass: 0, fuelKind: 'liquid', thrustAsl: 1_200_000, thrustVac: 2_000_000, ispAsl: 205, ispVac: 340,
    width: 3.75, height: 3.2, cost: 12500, gimbal: true, color: '#6a7078', accent: '#60b0e0' },
  { id: 'halo-ion', name: 'Halo-1 Ion Drive', short: 'Halo ion', category: 'engine',
    description: 'Gridded xenon ion drive: 4,200 s in vacuum but only 2 kN. Burns xenon and needs a battery, solar array or RTG on board.',
    dryMass: 250, fuelMass: 0, fuelKind: 'xenon', thrustAsl: 50, thrustVac: 2_000, ispAsl: 100, ispVac: 4_200,
    width: 0.625, height: 0.4, cost: 8000, gimbal: false, needsPower: true, style: 'ion', color: '#4a5058', accent: '#60a0ff' },

  /* ── Expanded catalog: solid boosters ── */
  { id: 'sparrow', name: 'RT-2 Sparrow', short: 'Sparrow', category: 'srb',
    description: 'Tiny 0.625 m radial solid motor. 55 kN at sea level, 0.4 t of solid fuel.',
    dryMass: 120, fuelMass: 400, fuelKind: 'solid', thrustAsl: 55_000, thrustVac: 64_000, ispAsl: 160, ispVac: 182,
    width: 0.625, height: 1.4, cost: 260, radial: true, color: '#f2efe6', accent: '#e07020' },
  { id: 'pounder', name: 'BX-125 Pounder', short: 'Pounder', category: 'srb',
    description: '1.25 m radial solid booster. 400 kN at sea level, 10 t of solid fuel, 215 s vacuum.',
    dryMass: 2000, fuelMass: 10000, fuelKind: 'solid', thrustAsl: 400_000, thrustVac: 460_000, ispAsl: 185, ispVac: 215,
    width: 1.25, height: 4.6, cost: 1450, radial: true, color: '#f2efe6', accent: '#30a050' },
  { id: 'colossus', name: 'S2 Colossus', short: 'Colossus', category: 'srb',
    description: '2.5 m radial solid booster for super-heavy lifters. 1.3 MN at sea level, 40 t of solid fuel.',
    dryMass: 7000, fuelMass: 40000, fuelKind: 'solid', thrustAsl: 1_300_000, thrustVac: 1_450_000, ispAsl: 200, ispVac: 225,
    width: 2.5, height: 8.4, cost: 5300, radial: true, color: '#f2efe6', accent: '#202830' },

  /* ── Expanded catalog: decouplers and structure ── */
  { id: 'tr-2v', name: 'TR-2V Micro Decoupler', short: '0.625 dec.', category: 'decoupler',
    description: '0.625 m stacked separator for tiny upper stages.',
    dryMass: 10, fuelMass: 0, width: 0.625, height: 0.12, cost: 200, color: '#d4c44a', accent: '#886010' },
  { id: 'tr-50', name: 'TR-50 Heavy Decoupler', short: '3.75 m dec.', category: 'decoupler',
    description: '3.75 m stacked separator for Kodiak stacks.',
    dryMass: 250, fuelMass: 0, width: 3.75, height: 0.32, cost: 750, color: '#d4c44a', accent: '#886010' },
  { id: 'hdm-2', name: 'HDM-2 Heavy Radial Decoupler', short: 'Heavy radial', category: 'decoupler',
    description: 'Stronger radial separator for big boosters like the Pounder and Colossus.',
    dryMass: 60, fuelMass: 0, width: 0.45, height: 0.55, cost: 420, radial: true, color: '#d4c44a', accent: '#605010' },
  { id: 'ad-1', name: 'AD-1 Micro Adapter', short: '0.625→1.25', category: 'structural',
    description: 'Adapts a 0.625 m stack (top) to 1.25 m (bottom).',
    dryMass: 40, fuelMass: 0, width: 0.625, widthBottom: 1.25, height: 0.4, cost: 110, color: '#d6d8dc', accent: '#808890' },
  { id: 'ad-2', name: 'AD-2 Rockomax Adapter', short: '1.25→2.5', category: 'structural',
    description: 'Adapts a 1.25 m stack (top) to 2.5 m (bottom).',
    dryMass: 120, fuelMass: 0, width: 1.25, widthBottom: 2.5, height: 0.9, cost: 300, color: '#d6d8dc', accent: '#808890' },
  { id: 'ad-3', name: 'AD-3 Kodiak Adapter', short: '2.5→3.75', category: 'structural',
    description: 'Adapts a 2.5 m stack (top) to 3.75 m (bottom).',
    dryMass: 450, fuelMass: 0, width: 2.5, widthBottom: 3.75, height: 1.3, cost: 700, color: '#d6d8dc', accent: '#808890' },
  { id: 'coupler-2', name: 'BC-2 Bi-Coupler', short: 'Bi-coupler', category: 'structural',
    description: 'Splits a 2.5 m stack into two mounts: the engine placed directly below fires as a pair (mass, thrust and cost ×2).',
    dryMass: 100, fuelMass: 0, width: 2.5, widthBottom: 2.5, height: 0.5, cost: 400, mounts: 2, color: '#cfd2d6', accent: '#5a6270' },
  { id: 'coupler-3', name: 'TC-3 Tri-Coupler', short: 'Tri-coupler', category: 'structural',
    description: 'Three-way engine mount for 2.5 m stacks: the engine directly below fires as a cluster of three.',
    dryMass: 150, fuelMass: 0, width: 2.5, widthBottom: 2.5, height: 0.55, cost: 600, mounts: 3, color: '#cfd2d6', accent: '#5a6270' },
  { id: 'coupler-4', name: 'QC-4 Quad-Coupler', short: 'Quad-coupler', category: 'structural',
    description: 'Four-way engine mount for 3.75 m stacks: the engine directly below fires as a cluster of four.',
    dryMass: 300, fuelMass: 0, width: 3.75, widthBottom: 3.75, height: 0.6, cost: 900, mounts: 4, color: '#cfd2d6', accent: '#5a6270' },
  { id: 'nose-125', name: 'NC-1 Aero Nose Cone', short: 'Nose 1.25', category: 'structural',
    description: '1.25 m nose cone. On the front of the stack it trims drag (Cd 0.35 → 0.27).',
    dryMass: 30, fuelMass: 0, width: 1.25, height: 0.9, cost: 120, aero: 'nose', color: '#eceae4', accent: '#c03020' },
  { id: 'nose-25', name: 'NC-2 Ogive Nose Cone', short: 'Nose 2.5', category: 'structural',
    description: '2.5 m ogive nose cone. On the front of the stack it trims drag (Cd 0.35 → 0.27).',
    dryMass: 120, fuelMass: 0, width: 2.5, height: 1.7, cost: 280, aero: 'nose', color: '#eceae4', accent: '#c03020' },
  { id: 'fin-delta', name: 'AV-R4 Delta Fin', short: 'Fin', category: 'structural',
    description: 'Tail fin for stability. Each fin adds a little drag.',
    dryMass: 25, fuelMass: 0, width: 0.5, height: 0.9, cost: 160, radial: true, aero: 'fin', color: '#eceae4', accent: '#c03020' },
  { id: 'truss-1', name: 'GS-1 Truss Segment', short: 'Truss', category: 'structural',
    description: 'Open lattice spacer. Light and long, for separating stages or payloads.',
    dryMass: 80, fuelMass: 0, width: 1.0, height: 1.5, cost: 140, color: '#a8adb4', accent: '#606870' },
  { id: 'hs-25', name: 'HS-2 Ablative Heat Shield', short: 'Heat shield', category: 'structural',
    description: '2.5 m ablative heat shield for capsule re-entry. Heavy but reassuring.',
    dryMass: 600, fuelMass: 0, width: 2.5, height: 0.28, cost: 900, color: '#5a4030', accent: '#2a2018' },

  /* ── Expanded catalog: utility ── */
  { id: 'battery-z', name: 'Z-400 Battery Bank', short: 'Battery', category: 'utility',
    description: 'Radial battery pack (400 charge). Powers an ion drive for a short burn.',
    dryMass: 20, fuelMass: 0, width: 0.4, height: 0.3, cost: 450, radial: true, power: true, color: '#3a3f46', accent: '#f0d040' },
  { id: 'solar-sp6', name: 'SP-6 Fold-Out Solar Array', short: 'Solar', category: 'utility',
    description: 'Radial fold-out solar array. Steady power in sunlight.',
    dryMass: 25, fuelMass: 0, width: 0.35, height: 1.0, cost: 650, radial: true, power: true, color: '#1d2c55', accent: '#c9a84c' },
  { id: 'rtg-pb', name: 'PB-R1 Radioisotope Generator', short: 'RTG', category: 'utility',
    description: 'Radial radioisotope generator. Power day and night, for a price.',
    dryMass: 80, fuelMass: 0, width: 0.45, height: 0.7, cost: 4500, radial: true, power: true, color: '#4a4f57', accent: '#a0ff70' },
  { id: 'ant-whip', name: 'Comm-12 Whip Antenna', short: 'Whip ant.', category: 'utility',
    description: 'Short-range whip antenna. About 500 km of comm range.',
    dryMass: 5, fuelMass: 0, width: 0.2, height: 0.9, cost: 250, radial: true, commRangeKm: 500, color: '#b8bcc4', accent: '#e0e0e0' },
  { id: 'dish-ra80', name: 'RA-80 Relay Dish', short: 'Relay dish', category: 'utility',
    description: 'Deep-space relay dish (about 50,000 km). Needed for relay-network contracts.',
    dryMass: 150, fuelMass: 0, width: 0.8, height: 0.6, cost: 2400, radial: true, commRangeKm: 50_000, color: '#dfe2e6', accent: '#8a9098' },
  { id: 'rw-1', name: 'RW-1 Reaction Wheel', short: 'Reaction wheel', category: 'utility',
    description: '1.25 m inline reaction wheel for extra attitude authority.',
    dryMass: 100, fuelMass: 0, width: 1.25, height: 0.3, cost: 600, color: '#3a4048', accent: '#c0c8d0' },
  { id: 'rcs-4', name: 'RV-4 RCS Thruster Block', short: 'RCS', category: 'utility',
    description: 'Four-way monopropellant attitude jets (attitude only in this simulator).',
    dryMass: 20, fuelMass: 0, width: 0.3, height: 0.3, cost: 300, radial: true, color: '#d8dce2', accent: '#404850' },
  { id: 'leg-lt3', name: 'LT-3 Landing Leg', short: 'Leg', category: 'utility',
    description: 'Folding landing leg. For show on the way up; useful one day.',
    dryMass: 50, fuelMass: 0, width: 0.35, height: 1.2, cost: 440, radial: true, color: '#9aa0a8', accent: '#e0b030' },
  { id: 'chute-mk16', name: 'Mk16 Parachute', short: 'Parachute', category: 'utility',
    description: 'Nose parachute pack for recovering a capsule.',
    dryMass: 100, fuelMass: 0, width: 0.65, height: 0.32, cost: 420, color: '#e8e2d2', accent: '#e06020' },
  { id: 'lamp-1', name: 'Illuminator Floodlight', short: 'Floodlight', category: 'utility',
    description: 'Radial floodlight. Purely for looks.',
    dryMass: 15, fuelMass: 0, width: 0.25, height: 0.25, cost: 100, radial: true, color: '#3a3f46', accent: '#fff1b0' },

  /* ── Expanded catalog: payloads ── */
  { id: 'sat-meridian', name: 'Meridian Heavy CommSat', short: 'Meridian', category: 'payload',
    description: 'Large geostationary-class communications satellite with twin wings and a relay dish.',
    dryMass: 900, fuelMass: 0, width: 1.6, height: 1.4, cost: 4200, commRangeKm: 50_000, color: '#c9a84c', accent: '#4a80c0' },
  { id: 'telescope-aurora', name: 'Aurora Space Telescope', short: 'Telescope', category: 'payload',
    description: 'Orbital telescope with a 1 m mirror and a sun shade door.',
    dryMass: 1200, fuelMass: 0, width: 1.25, height: 3.0, cost: 6500, color: '#d8dce2', accent: '#c9a84c' },
  { id: 'station-haven', name: 'Haven Station Module', short: 'Station', category: 'payload',
    description: '2.5 m pressurised space-station module with ports and solar wings.',
    dryMass: 6000, fuelMass: 0, width: 2.5, height: 4.0, cost: 9500, color: '#e4e6ea', accent: '#3a6ab0' },
  { id: 'cargo-cx25', name: 'CX-25 Cargo Module', short: 'Cargo', category: 'payload',
    description: '2.5 m cargo carrier with bay doors. Deploys like a satellite.',
    dryMass: 2500, fuelMass: 0, width: 2.5, height: 2.2, cost: 3600, color: '#cfd3d8', accent: '#d0a030' },

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
  { id: 'structural', label: 'Structure & aero' },
  { id: 'fairing', label: 'Fairings' },
  { id: 'utility', label: 'Utility' },
  { id: 'payload', label: 'Satellites & payloads' },
  { id: 'science', label: 'Science' },
];

/** VAB catalog tabs: each groups one or more categories. */
export const PART_GROUPS: Array<{ id: string; label: string; categories: PartCategory[] }> = [
  { id: 'command', label: 'Command', categories: ['pod', 'probe'] },
  { id: 'tanks', label: 'Tanks', categories: ['tank'] },
  { id: 'engines', label: 'Engines', categories: ['engine', 'srb'] },
  { id: 'structure', label: 'Structure', categories: ['decoupler', 'structural', 'fairing'] },
  { id: 'utility', label: 'Utility', categories: ['utility'] },
  { id: 'payload', label: 'Payload', categories: ['payload'] },
  { id: 'science', label: 'Science', categories: ['science'] },
];

/** Diameter class used by the catalog size filter. */
export const PART_SIZES = [0.625, 1.25, 2.5, 3.75] as const;
export function sizeClassOf(def: PartDef): number | null {
  if (def.radial || def.category === 'payload' || def.category === 'science') return null;
  const w = Math.max(def.width, def.widthBottom ?? 0);
  let best: number | null = null, d = Infinity;
  for (const s of PART_SIZES) { const e = Math.abs(s - w); if (e < d) { d = e; best = s; } }
  return d <= 0.3 ? best : null;
}
/** Every diameter class a part fits (adapters match both ends). */
export function sizeClassesOf(def: PartDef): number[] {
  const one = sizeClassOf(def);
  if (one == null) return [];
  const out = new Set<number>([one]);
  if (def.widthBottom != null) for (const w of [def.width, def.widthBottom]) {
    for (const s of PART_SIZES) if (Math.abs(s - w) <= 0.3) out.add(s);
  }
  return [...out].sort((a, b) => a - b);
}

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
  /** Solid boosters: thrust limiter 0.3–1 (burns longer at lower thrust). */
  limit?: number;
}

export const LIMIT_MIN = 0.3;
export function clampLimit(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const r = Math.round(Math.min(1, Math.max(LIMIT_MIN, v)) * 20) / 20;
  return r >= 1 ? undefined : r;
}

/**
 * Engines mounted directly below a coupler fire as a cluster. Returns uid → copies
 * (only entries > 1). Pure function of stack order, shared by cost, analysis, flight and art.
 */
export function clusterCounts(d: VesselDesign): Map<string, number> {
  const out = new Map<string, number>();
  const stack = d.parts.filter((p) => !p.radial);
  for (let i = 0; i + 1 < stack.length; i++) {
    const c = PART_BY_ID.get(stack[i]!.partId);
    const e = PART_BY_ID.get(stack[i + 1]!.partId);
    if (c?.mounts && c.mounts > 1 && e?.category === 'engine') out.set(stack[i + 1]!.uid, c.mounts);
  }
  return out;
}

export interface VesselDesign {
  name: string;
  parts: PlacedPart[];
}

export const MAX_DESIGN_PARTS = 64;
export const MAX_STAGE = 16;

export function newPartUid(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

export function partOf(id: string): PartDef | undefined {
  return PART_BY_ID.get(id);
}

export function designCost(d: VesselDesign): number {
  let n = 0;
  const cl = clusterCounts(d);
  for (const p of d.parts) {
    const def = PART_BY_ID.get(p.partId);
    if (def) n += def.cost * (cl.get(p.uid) ?? 1);
  }
  return n;
}

export function designHash(d: VesselDesign): string {
  return d.parts.map((p) => `${p.partId}:${p.stage}:${p.radial ? 1 : 0}:${Math.round(p.angle ?? 0)}${p.limit != null ? `:L${p.limit}` : ''}`).join('|');
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
  let pods = 0, engines = 0, payloads = 0, power = 0;
  const needPower: string[] = [];
  for (const p of d.parts) {
    if (!p || typeof p.uid !== 'string' || !p.uid || uids.has(p.uid)) out.push({ level: 'error', text: 'A part is missing a unique id.' });
    else uids.add(p.uid);
    const def = PART_BY_ID.get(p.partId);
    if (!def) { out.push({ level: 'error', text: `Unknown part: ${p.partId}.` }); continue; }
    if (!Number.isInteger(p.stage) || p.stage < 0 || p.stage > MAX_STAGE) out.push({ level: 'error', text: `${def.short} has a bad stage number.` });
    if (def.category === 'pod' || def.category === 'probe') pods += 1;
    if (def.category === 'engine' || def.category === 'srb') engines += 1;
    if (def.category === 'payload') payloads += 1;
    if (def.power) power += 1;
    if (def.needsPower) needPower.push(def.short);
    if (def.radial && !p.radial && (def.category === 'srb' || def.category === 'utility' || def.aero === 'fin' || def.category === 'decoupler' || def.id === 'spur')) {
      out.push({ level: 'warn', text: `${def.short} is meant to mount radially, on the side of a stack part.` });
    }
  }
  if (needPower.length && !power) out.push({ level: 'error', text: `${needPower[0]} needs a battery, solar array or RTG on board.` });
  const stack = d.parts.filter((p) => !p.radial);
  const last = stack.at(-1) && PART_BY_ID.get(stack.at(-1)!.partId);
  if (last?.mounts) out.push({ level: 'warn', text: `${last.short} has nothing mounted below it.` });
  for (let i = 0; i + 1 < stack.length; i++) {
    const c = PART_BY_ID.get(stack[i]!.partId), e = PART_BY_ID.get(stack[i + 1]!.partId);
    if (c?.mounts && e && e.category !== 'engine') out.push({ level: 'warn', text: `${c.short}: only an engine directly below it is clustered.` });
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

/**
 * Goliath Heavy — the heavy-lift reference (needs Heavy Rocketry research).
 * Haven station module on a Poodle upper stage, a Kodiak-72 core with four
 * clustered Skippers on a quad-coupler, and two Colossus boosters.
 */
export function goliathHeavy(): VesselDesign {
  return makeDesign('Goliath Heavy', [
    { part: 'station-haven', stage: 0 },
    { part: 'probe-ring', stage: 15 },
    { part: 'fairing-25', stage: 1 },
    { part: 'x200-32', stage: 2 },
    { part: 'poodle', stage: 2 },
    { part: 'tr-25', stage: 2 },
    { part: 'ad-3', stage: 15 },
    { part: 'kodiak-72', stage: 4 },
    { part: 'hdm-2', stage: 3, radial: true, count: 2 },
    { part: 'colossus', stage: 4, radial: true, count: 2 },
    { part: 'fin-delta', stage: 15, radial: true, count: 4 },
    { part: 'coupler-4', stage: 15 },
    { part: 'skipper', stage: 4 },
  ]);
}

/** Stock designs offered in the VAB (free to load; launching still costs the parts). */
export const STOCK_DESIGNS: VesselDesign[] = [courierI(), scoutI(), goliathHeavy()];

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
  if (category === 'pod' || category === 'probe' || category === 'science' || category === 'structural' || category === 'utility') return 15;
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
    const lim = clampLimit(x.limit);
    if (lim != null && PART_BY_ID.get(x.partId)?.category === 'srb') placed.limit = lim;
    parts.push(placed);
  }
  return { name, parts };
}

/**
 * SCANsat-style planetary mapping.
 *
 * A deployed scanner paints a swath along its ground track. The flight model is
 * planar, so a survey satellite is assigned a modelled inclination at deploy
 * (documented on the part) and the planet's 6-hour rotation walks the track
 * around the globe. Coverage is a bit-packed lon×lat grid, advanced from the
 * stored orbit and elapsed time — including while the player is away, with a
 * cap so a long AFK does not finish every map at once.
 */
import { PLANET, circularVelocity } from './spaceFlight.js';

export const SURVEY_LON = 72; // 5° cells
export const SURVEY_LAT = 36;
export const SURVEY_CELLS = SURVEY_LON * SURVEY_LAT;
export const SURVEY_BYTES = Math.ceil(SURVEY_CELLS / 8);
/** Max simulated survey time applied on one advance (18 hours). */
export const SURVEY_ADVANCE_CAP_S = 18 * 3600;
export const SURVEY_MILESTONES = [25, 50, 75, 100] as const;
/** Conservative milestone payouts (before px), claimed once per threshold per map. */
export const SURVEY_MILESTONE_PAYOUT: Record<number, number> = {
  25: 1_000,
  50: 1_500,
  75: 2_000,
  100: 3_000,
};
/** 7,500 chips if every milestone on one map is collected. */

export type MapType = 'altimetry' | 'biome' | 'resource' | 'visual' | 'weather';

export interface ScannerDef {
  id: string;
  partId: string;
  mapType: MapType;
  name: string;
  /** Optimal altitude band, metres. */
  minAlt: number;
  maxAlt: number;
  /** Peak swath width in degrees (latitude and cross-track). */
  swathDeg: number;
  /** Modelled inclination assigned at deploy, degrees. */
  inclinationDeg: number;
}

export const SCANNERS: ScannerDef[] = [
  {
    id: 'altimetry', partId: 'scan-radar', mapType: 'altimetry',
    name: 'Radar altimeter',
    minAlt: 80_000, maxAlt: 250_000, swathDeg: 12, inclinationDeg: 80,
  },
  {
    id: 'biome', partId: 'scan-multispectral', mapType: 'biome',
    name: 'Multispectral imager',
    minAlt: 150_000, maxAlt: 400_000, swathDeg: 16, inclinationDeg: 80,
  },
  {
    id: 'resource', partId: 'scan-ore', mapType: 'resource',
    name: 'Resource scanner',
    minAlt: 70_000, maxAlt: 150_000, swathDeg: 5, inclinationDeg: 80,
  },
  {
    id: 'visual', partId: 'scan-camera', mapType: 'visual',
    name: 'High-resolution camera',
    minAlt: 80_000, maxAlt: 200_000, swathDeg: 6, inclinationDeg: 72,
  },
  {
    id: 'weather', partId: 'scan-weather', mapType: 'weather',
    name: 'Weather mapper',
    minAlt: 250_000, maxAlt: 700_000, swathDeg: 22, inclinationDeg: 85,
  },
];

export const SCANNER_BY_PART = new Map(SCANNERS.map((s) => [s.partId, s]));
export const SCANNER_BY_TYPE = new Map(SCANNERS.map((s) => [s.mapType, s]));

export const MAP_TYPE_INFO: Record<MapType, { title: string; blurb: string; unit: string }> = {
  altimetry: { title: 'Altimetry', blurb: 'Radar terrain and elevation. Best from 80–250 km with a wide swath.', unit: 'elevation' },
  biome: { title: 'Biome', blurb: 'Multispectral land-cover. Best from 150–400 km.', unit: 'biomes' },
  resource: { title: 'Resources', blurb: 'Ore and mineral survey. A narrow beam from 70–150 km; slower to finish.', unit: 'ore' },
  visual: { title: 'Visual', blurb: 'High-resolution optical imagery. 80–200 km, a narrow swath.', unit: 'imagery' },
  weather: { title: 'Weather', blurb: 'Cloud and weather systems. A high, wide scanner from 250–700 km.', unit: 'clouds' },
};

export interface MapperState {
  mapType: MapType;
  scannerId: string;
  peM: number;
  apM: number;
  periodS: number;
  inclinationDeg: number;
  deployedAt: number;
  /** Inertial longitude of the ascending node at deploy, radians. */
  raan: number;
  /** Argument of latitude at deploy, radians. */
  arg0: number;
}

export function emptyGrid(): Uint8Array {
  return new Uint8Array(SURVEY_BYTES);
}

export function gridFromBytes(raw: Uint8Array | Buffer | number[]): Uint8Array {
  const g = emptyGrid();
  const src = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
  g.set(src.subarray(0, SURVEY_BYTES));
  return g;
}

export function cellIndex(lonI: number, latI: number): number {
  const i = ((lonI % SURVEY_LON) + SURVEY_LON) % SURVEY_LON;
  const j = Math.max(0, Math.min(SURVEY_LAT - 1, latI));
  return j * SURVEY_LON + i;
}

export function isFilled(grid: Uint8Array, idx: number): boolean {
  return (grid[idx >> 3]! & (1 << (idx & 7))) !== 0;
}

export function fillCell(grid: Uint8Array, idx: number): boolean {
  const bit = 1 << (idx & 7);
  const i = idx >> 3;
  if (grid[i]! & bit) return false;
  grid[i]! |= bit;
  return true;
}

export function filledCount(grid: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < SURVEY_CELLS; i++) if (isFilled(grid, i)) n += 1;
  return n;
}

export function coveragePct(grid: Uint8Array): number {
  return (filledCount(grid) / SURVEY_CELLS) * 100;
}

/** Swath efficiency: 1 inside the band, tapering to 0 well outside. */
export function scanEfficiency(alt: number, sc: ScannerDef): number {
  if (!(alt > 0) || !Number.isFinite(alt)) return 0;
  if (alt < sc.minAlt * 0.5 || alt > sc.maxAlt * 1.6) return 0;
  if (alt < sc.minAlt) return 0.35 * (alt - sc.minAlt * 0.5) / (sc.minAlt * 0.5);
  if (alt > sc.maxAlt) return Math.max(0, 0.55 * (1 - (alt - sc.maxAlt) / (sc.maxAlt * 0.6)));
  const mid = (sc.minAlt + sc.maxAlt) / 2;
  const half = (sc.maxAlt - sc.minAlt) / 2;
  const t = Math.abs(alt - mid) / half;
  return t < 0.5 ? 1 : 1 - 0.15 * ((t - 0.5) / 0.5);
}

export function altitudeAtAnomaly(peM: number, apM: number, trueAnomaly: number): number {
  const rPe = PLANET.radius + Math.max(peM, 0);
  const rAp = PLANET.radius + Math.max(apM, peM);
  const a = (rPe + rAp) / 2;
  const e = (rAp - rPe) / (rAp + rPe);
  const r = a * (1 - e * e) / (1 + e * Math.cos(trueAnomaly));
  return r - PLANET.radius;
}

/**
 * Paint a swath centred on (lat, lon) in degrees. Returns newly filled cells.
 * A simple lat/lon window is enough at this grid resolution (5°).
 */
export function paintSwath(grid: Uint8Array, latDeg: number, lonDeg: number, swathDeg: number): number {
  if (swathDeg <= 0) return 0;
  const half = swathDeg / 2;
  const latCell = (latDeg + 90) / 180 * SURVEY_LAT;
  const lonCell = ((lonDeg + 180) / 360) * SURVEY_LON;
  const dLat = (half / 180) * SURVEY_LAT;
  const dLon = (half / 360) * SURVEY_LON / Math.max(0.2, Math.cos(latDeg * Math.PI / 180));
  const j0 = Math.max(0, Math.floor(latCell - dLat));
  const j1 = Math.min(SURVEY_LAT - 1, Math.ceil(latCell + dLat));
  let n = 0;
  for (let j = j0; j <= j1; j++) {
    const i0 = Math.floor(lonCell - dLon);
    const i1 = Math.ceil(lonCell + dLon);
    for (let i = i0; i <= i1; i++) {
      if (fillCell(grid, cellIndex(i, j))) n += 1;
    }
  }
  return n;
}

export function periodFromElements(peM: number, apM: number): number {
  const rPe = PLANET.radius + Math.max(peM, 0);
  const rAp = PLANET.radius + Math.max(apM, peM);
  const a = (rPe + rAp) / 2;
  if (!(a > 0)) return 0;
  return 2 * Math.PI * Math.sqrt((a * a * a) / PLANET.mu);
}

/**
 * Advance coverage from `fromAt` to `toAt` (ms), capped. Mutates `grid`.
 * Samples the ground track along the modelled inclined orbit.
 */
export function advanceCoverage(
  grid: Uint8Array,
  mapper: MapperState,
  fromAt: number,
  toAt: number,
  capS: number = SURVEY_ADVANCE_CAP_S,
): { added: number; simulatedS: number; pct: number } {
  const sc = SCANNER_BY_PART.get(mapper.scannerId) ?? SCANNER_BY_TYPE.get(mapper.mapType);
  if (!sc) return { added: 0, simulatedS: 0, pct: coveragePct(grid) };
  const period = mapper.periodS > 60 ? mapper.periodS : periodFromElements(mapper.peM, mapper.apM);
  if (!(period > 60)) return { added: 0, simulatedS: 0, pct: coveragePct(grid) };
  const rawS = Math.max(0, (toAt - fromAt) / 1000);
  const simS = Math.min(rawS, capS);
  if (simS < 1) return { added: 0, simulatedS: 0, pct: coveragePct(grid) };

  const inc = (mapper.inclinationDeg || sc.inclinationDeg) * Math.PI / 180;
  const n = 2 * Math.PI / period; // mean motion
  const samplesPerOrbit = 96;
  const dt = period / samplesPerOrbit;
  const steps = Math.min(Math.ceil(simS / dt), 80_000);
  const t0 = (fromAt - mapper.deployedAt) / 1000;
  let added = 0;
  for (let k = 0; k < steps; k++) {
    const t = t0 + k * dt + dt / 2;
    if (t < 0 || t > t0 + simS) continue;
    const u = mapper.arg0 + n * t; // argument of latitude
    const su = Math.sin(u), cu = Math.cos(u);
    const si = Math.sin(inc), ci = Math.cos(inc);
    const lat = Math.asin(Math.max(-1, Math.min(1, su * si)));
    const lonInertial = Math.atan2(su * ci, cu) + mapper.raan;
    const lon = lonInertial - PLANET.omega * (mapper.deployedAt / 1000 + t);
    const ta = u; // circular-ish approximation; fine for modest eccentricity
    const alt = altitudeAtAnomaly(mapper.peM, mapper.apM, ta);
    const eff = scanEfficiency(alt, sc);
    if (eff <= 0) continue;
    added += paintSwath(grid, lat * 180 / Math.PI, lon * 180 / Math.PI, sc.swathDeg * eff);
  }
  return { added, simulatedS: simS, pct: coveragePct(grid) };
}

/** Next unclaimed milestone at or below `pct`, given the last claimed threshold. */
export function dueMilestones(pct: number, lastClaimed: number): number[] {
  return SURVEY_MILESTONES.filter((m) => pct + 1e-9 >= m && m > lastClaimed);
}

export function milestonePayouts(pct: number, lastClaimed: number): { at: number; payout: number }[] {
  return dueMilestones(pct, lastClaimed).map((at) => ({ at, payout: SURVEY_MILESTONE_PAYOUT[at] ?? 0 }));
}

/** Deterministic preview grid that looks like orbital tracks, filled to `pct`. */
export function previewGrid(mapType: MapType, pct: number, seed = 1): Uint8Array {
  const g = emptyGrid();
  const sc = SCANNER_BY_TYPE.get(mapType)!;
  const mapper: MapperState = {
    mapType, scannerId: sc.partId,
    peM: (sc.minAlt + sc.maxAlt) / 2,
    apM: (sc.minAlt + sc.maxAlt) / 2 + 10_000,
    periodS: periodFromElements((sc.minAlt + sc.maxAlt) / 2, (sc.minAlt + sc.maxAlt) / 2 + 10_000),
    inclinationDeg: sc.inclinationDeg,
    deployedAt: 0, raan: seed * 0.4, arg0: seed * 0.2,
  };
  // Advance long enough to reach the target; stop when we pass it.
  let t = 0;
  const step = mapper.periodS * 1000 * 0.5;
  while (coveragePct(g) < pct && t < 60 * 3600 * 1000) {
    const before = coveragePct(g);
    advanceCoverage(g, mapper, t, t + step, step / 1000);
    t += step;
    if (coveragePct(g) <= before + 0.01 && t > mapper.periodS * 4000) break;
  }
  return g;
}

export function mapperFromOrbit(opts: {
  mapType: MapType; scannerId: string; peM: number; apM: number;
  periodS?: number; inclinationDeg?: number; deployedAt: number;
  raan?: number; arg0?: number;
}): MapperState {
  const sc = SCANNER_BY_PART.get(opts.scannerId) ?? SCANNER_BY_TYPE.get(opts.mapType);
  const pe = opts.peM, ap = Math.max(opts.apM, opts.peM);
  return {
    mapType: opts.mapType,
    scannerId: opts.scannerId,
    peM: pe, apM: ap,
    periodS: opts.periodS && opts.periodS > 60 ? opts.periodS : periodFromElements(pe, ap),
    inclinationDeg: opts.inclinationDeg ?? sc?.inclinationDeg ?? 80,
    deployedAt: opts.deployedAt,
    raan: opts.raan ?? 0,
    arg0: opts.arg0 ?? 0,
  };
}

/** Lifetime chips if every milestone on every map is collected (before px). */
export const SURVEY_LIFETIME_MILESTONES = SURVEY_MILESTONES.length * Object.keys(MAP_TYPE_INFO).length;
export const SURVEY_LIFETIME_PAYOUT = 5 * (1_000 + 1_500 + 2_000 + 3_000); // 37,500

void circularVelocity;

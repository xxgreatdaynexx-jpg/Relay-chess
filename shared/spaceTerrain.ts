/**
 * Shared procedural terrain for the home world (pure math, no canvas).
 *
 * The client paints its textures from these functions and the server uses the
 * same functions to classify a biome for science, so both always agree.
 */
export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Seeded permutation for Perlin-style 3D noise. */
const PERM = new Uint8Array(512);
(() => {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 20261113;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]!; p[i] = p[j]!; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]!;
})();

function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
export function perlin3(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  const xf = x - Math.floor(x), yf = y - Math.floor(y), zf = z - Math.floor(z);
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const A = PERM[X]! + Y, AA = PERM[A]! + Z, AB = PERM[A + 1]! + Z;
  const B = PERM[X + 1]! + Y, BA = PERM[B]! + Z, BB = PERM[B + 1]! + Z;
  const P = PERM;
  return lerp(
    lerp(
      lerp(grad(P[AA]!, xf, yf, zf), grad(P[BA]!, xf - 1, yf, zf), u),
      lerp(grad(P[AB]!, xf, yf - 1, zf), grad(P[BB]!, xf - 1, yf - 1, zf), u),
      v,
    ),
    lerp(
      lerp(grad(P[AA + 1]!, xf, yf, zf - 1), grad(P[BA + 1]!, xf - 1, yf, zf - 1), u),
      lerp(grad(P[AB + 1]!, xf, yf - 1, zf - 1), grad(P[BB + 1]!, xf - 1, yf - 1, zf - 1), u),
      v,
    ),
    w,
  );
}
export function fbm(x: number, y: number, z: number, oct = 5, lac = 2, gain = 0.5): number {
  let a = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { a += amp * perlin3(x * f, y * f, z * f); n += amp; amp *= gain; f *= lac; }
  return a / (n || 1);
}
export function ridged(x: number, y: number, z: number, oct = 4): number {
  let a = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    const v = 1 - Math.abs(perlin3(x * f, y * f, z * f));
    a += amp * v * v; n += amp; amp *= 0.5; f *= 2.05;
  }
  return a / (n || 1);
}

/** Hand-placed landmasses (lat, lon in degrees) so the world has a readable geography. */
export const LANDMASSES: Array<{ lat: number; lon: number; rx: number; ry: number; w: number; ang?: number }> = [
  { lat: 22, lon: -18, rx: 0.95, ry: 0.52, w: 1.25, ang: 0.2 },
  { lat: 48, lon: 28, rx: 0.55, ry: 0.38, w: 0.95, ang: -0.3 },
  { lat: 8, lon: 72, rx: 0.7, ry: 0.48, w: 1.05, ang: 0.15 },
  { lat: -12, lon: 28, rx: 0.5, ry: 0.72, w: 1.0, ang: 0.35 },
  { lat: -28, lon: 132, rx: 0.85, ry: 0.42, w: 1.1, ang: -0.15 },
  { lat: 14, lon: -92, rx: 0.38, ry: 0.55, w: 0.85, ang: 0.5 },
  { lat: -38, lon: -64, rx: 0.52, ry: 0.4, w: 0.8, ang: 0.1 },
  { lat: 62, lon: -40, rx: 0.45, ry: 0.3, w: 0.55 },
  { lat: -16, lon: -150, rx: 0.28, ry: 0.22, w: 0.45 },
  { lat: 2, lon: 115, rx: 0.32, ry: 0.22, w: 0.5, ang: 0.8 },
  { lat: 35, lon: 138, rx: 0.22, ry: 0.28, w: 0.4 },
  { lat: -46, lon: 168, rx: 0.22, ry: 0.18, w: 0.35 },
];

export function landBias(lat: number, lon: number): number {
  let b = -0.22;
  const cl = Math.cos(lat);
  for (const c of LANDMASSES) {
    const cLat = c.lat * Math.PI / 180, cLon = c.lon * Math.PI / 180;
    let dLon = lon - cLon;
    while (dLon > Math.PI) dLon -= 2 * Math.PI;
    while (dLon < -Math.PI) dLon += 2 * Math.PI;
    const dLat = lat - cLat;
    const ang = c.ang ?? 0;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const x = (dLon * cl * ca + dLat * sa) / c.rx;
    const y = (-dLon * cl * sa + dLat * ca) / c.ry;
    const d = x * x + y * y;
    b += c.w * Math.exp(-d * 1.15);
  }
  // A little mid-ocean archipelago noise, stronger near equator.
  return b;
}


export interface TerrainSample { elev: number; moist: number }

/** Raw terrain at a latitude / planet-fixed longitude (radians). */
export function terrainAt(lat: number, lon: number): TerrainSample {
  const cl = Math.cos(lat), sl = Math.sin(lat);
  const x = cl * Math.cos(lon), y = cl * Math.sin(lon), z = sl;
  const wx = fbm(x * 1.6 + 8, y * 1.6, z * 1.6, 4) * 0.28;
  const wy = fbm(x * 1.6, y * 1.6 + 8, z * 1.6, 4) * 0.28;
  const wz = fbm(x * 1.6, y * 1.6, z * 1.6 + 8, 4) * 0.28;
  const n = fbm(x * 2.2 + wx, y * 2.2 + wy, z * 2.2 + wz, 6, 2.05, 0.5);
  const ridge = ridged(x * 3.2, y * 3.2, z * 3.2, 5);
  const bias = landBias(lat, lon);
  const elev = bias + n * 0.42 + ridge * 0.12 - 0.04;
  const moist = 0.5 + 0.5 * fbm(x * 2.4 + 20, y * 2.4, z * 2.4 + 4, 5);
  return { elev, moist };
}

export type BiomeId =
  | 'launch-site' | 'deep-ocean' | 'ocean' | 'shores' | 'desert' | 'mountains'
  | 'jungle' | 'forest' | 'grassland' | 'tundra' | 'ice-caps';

export const BIOMES: Record<BiomeId, { name: string; color: string }> = {
  'launch-site': { name: 'Launch Site', color: '#d0d4dc' },
  'deep-ocean': { name: 'Deep Ocean', color: '#0b2a5c' },
  ocean: { name: 'Shallow Seas', color: '#1d6a9a' },
  shores: { name: 'Shores', color: '#d8c890' },
  desert: { name: 'Deserts', color: '#d39a4a' },
  mountains: { name: 'Mountains', color: '#7c746c' },
  jungle: { name: 'Jungles', color: '#1f8a3a' },
  forest: { name: 'Forests', color: '#2d5e2a' },
  grassland: { name: 'Grasslands', color: '#8cc05a' },
  tundra: { name: 'Tundra', color: '#a8b4a0' },
  'ice-caps': { name: 'Ice Caps', color: '#eef4fa' },
};

/** Same branching as the client's surface colouring. */
export function biomeFromTerrain(elev: number, lat: number, moist: number, slope: number): BiomeId {
  const absLat = Math.abs(lat) * 180 / Math.PI;
  const snowLine = 0.55 + 0.35 * (1 - absLat / 90);
  if (elev > 0 && (absLat > 62 + moist * 6 + elev * 8 || (elev > snowLine && absLat > 28))) return 'ice-caps';
  if (elev <= 0) return elev < -0.2 ? 'deep-ocean' : 'ocean';
  if (elev < 0.035) return 'shores';
  // Wet regions push the tropics poleward; dry ones pull them in, so the edge follows the weather.
  const trop = smooth(18, 8, absLat - (moist - 0.5) * 30 - elev * 10);
  const dry = moist < 0.32 + (absLat > 18 && absLat < 36 ? 0.12 : 0);
  if (dry && absLat < 48 && elev < 0.42) return 'desert';
  if (slope > 0.45 && elev > 0.28) return 'mountains';
  if (trop > 0.4 && moist > 0.4) return 'jungle';
  if (moist > 0.45) return 'forest';
  if (absLat > 56) return 'tundra';
  return 'grassland';
}

const TEX_W = 1536, TEX_H = 768;

/** Biome at a latitude / planet-fixed longitude (radians), slope at texture resolution. */
export function biomeAt(lat: number, lon: number): BiomeId {
  const t = terrainAt(lat, lon);
  const eR = terrainAt(lat, lon + (2 * Math.PI) / TEX_W).elev;
  const eD = terrainAt(lat - Math.PI / TEX_H, lon).elev;
  const slope = Math.hypot(eR - t.elev, eD - t.elev) * 9;
  return biomeFromTerrain(t.elev, lat, t.moist, slope);
}

/** Ore concentration 0..1 for the resource map. */
export function oreAt(lat: number, lon: number): number {
  const cl = Math.cos(lat);
  const x = cl * Math.cos(lon), y = cl * Math.sin(lon), z = Math.sin(lat);
  const v = fbm(x * 3.1 + 40, y * 3.1 - 7, z * 3.1 + 2, 5, 2.1, 0.55);
  const veins = ridged(x * 5 + 11, y * 5, z * 5 - 3, 3);
  return clamp(0.5 + v * 1.4 + (veins - 0.55) * 0.9);
}

/** Wrap a longitude to (-π, π]. */
export function wrapLon(lon: number): number {
  let l = lon % (2 * Math.PI);
  if (l <= -Math.PI) l += 2 * Math.PI;
  if (l > Math.PI) l -= 2 * Math.PI;
  return l;
}

let equatorCache: BiomeId[] | null = null;
/** Biomes that occur along the equator (where the planar flight model travels). */
export function equatorBiomes(): BiomeId[] {
  if (equatorCache) return equatorCache;
  const set = new Set<BiomeId>();
  for (let i = 0; i < 360; i++) set.add(biomeAt(0, wrapLon((i / 360) * 2 * Math.PI)));
  equatorCache = [...set];
  return equatorCache;
}

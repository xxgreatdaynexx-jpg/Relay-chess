/**
 * Farm-perimeter protest placement — cosmetic only.
 * Target owner verified from live /api/real-estate (2026-11-06): display name "carter2"
 * owns city farmland f:1,2,3,4,5,7,11,12,13. No resort (rf:) / field (cf:) farms for that account.
 * Placement is ownership-derived: if plots are sold, protesters leave those plots.
 */
import { farmPlots, plotId, FARM_LANES, FARM_LANE_W, type FarmPlot } from '../../../shared/farm';
import { roadClearance } from './worldLayout';
import { MIN_SEP, type ProtesterState, CHANT_SLOGANS, SHIRT_COLORS } from './townHallProtest';

/** Authoritative in-game handle for the City Hall joke crowd's farm extension (verified live). */
export const PROTEST_TARGET_OWNER = 'carter2';

export const PER_FARM_COUNT = 3;
export const PER_FARM_COUNT_LOW = 2;
/** Hard cap across all farm sites (city hall crowd is separate). */
export const MAX_FARM_PROTESTERS = 24;
/** Stand just outside the crop pad — never on tiles. */
export const FARM_OUTSET = 1.45;
/** Keep farm lane / walk-up clear. */
export const LANE_CLEAR = FARM_LANE_W / 2 + 0.85;

export interface OwnedProp { id: string; owner: string }

function mulberry(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}

/** Farm plot ids currently owned by the protest target (case-insensitive). Dynamic — empty if sold. */
export function targetFarmIds(owned: OwnedProp[], owner = PROTEST_TARGET_OWNER): string[] {
  const want = owner.toLowerCase();
  return owned
    .filter((o) => o.owner.toLowerCase() === want && /^f:\d+$/.test(o.id))
    .map((o) => o.id)
    .sort();
}

/** Resort plantation ids for target — city scene does not render these; reported for scope. */
export function targetResortFarmIds(owned: OwnedProp[], owner = PROTEST_TARGET_OWNER): string[] {
  const want = owner.toLowerCase();
  return owned.filter((o) => o.owner.toLowerCase() === want && /^rf:\d+$/.test(o.id)).map((o) => o.id).sort();
}

export function plotByFarmId(id: string): FarmPlot | undefined {
  const m = /^f:(\d+)$/.exec(id);
  if (!m) return undefined;
  return farmPlots().find((p) => p.n === Number(m[1]));
}

function nearLane(x: number, z: number): boolean {
  for (const lane of FARM_LANES) {
    const [[x0, z0], [x1, z1]] = lane;
    // vertical lanes (constant x)
    if (Math.abs(x0 - x1) < 0.01) {
      const xa = x0;
      const zLo = Math.min(z0, z1), zHi = Math.max(z0, z1);
      if (z >= zLo - 1 && z <= zHi + 1 && Math.abs(x - xa) < LANE_CLEAR) return true;
    }
  }
  return false;
}

function insidePlot(p: FarmPlot, x: number, z: number, pad = 0): boolean {
  return Math.abs(x - p.x) <= p.w / 2 + pad && Math.abs(z - p.z) <= p.d / 2 + pad;
}

/** True if (x,z) is on crops or too close to any farmland pad. */
export function onAnyFarmPad(x: number, z: number, pad = 0.35): boolean {
  return farmPlots().some((p) => insidePlot(p, x, z, pad));
}

/**
 * Irregular cluster points just outside a single farm pad.
 * Prefers long edges; skips lane-adjacent samples so access stays clear.
 */
export function farmPerimeterPoints(
  plot: FarmPlot,
  count: number,
  seed: number,
  extraBlocked?: (x: number, z: number) => boolean,
): Array<{ x: number; z: number }> {
  const rand = mulberry(seed ^ (plot.n * 9973));
  const out: Array<{ x: number; z: number }> = [];
  const hw = plot.w / 2 + FARM_OUTSET;
  const hd = plot.d / 2 + FARM_OUTSET;
  for (let attempt = 0; attempt < count * 40 && out.length < count; attempt++) {
    const edge = Math.floor(rand() * 4); // 0 N 1 E 2 S 3 W
    let x = plot.x, z = plot.z;
    if (edge === 0) { x = plot.x + (rand() * 2 - 1) * (plot.w / 2); z = plot.z - hd; }
    else if (edge === 1) { x = plot.x + hw; z = plot.z + (rand() * 2 - 1) * (plot.d / 2); }
    else if (edge === 2) { x = plot.x + (rand() * 2 - 1) * (plot.w / 2); z = plot.z + hd; }
    else { x = plot.x - hw; z = plot.z + (rand() * 2 - 1) * (plot.d / 2); }
    // jitter so clusters look organic, not a fence line
    x += (rand() - 0.5) * 0.7;
    z += (rand() - 0.5) * 0.7;
    if (onAnyFarmPad(x, z, 0.2)) continue;
    if (nearLane(x, z)) continue;
    if (roadClearance(x, z, 8) < 0.2) continue; // too close to a paved road centreline
    if (extraBlocked?.(x, z)) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.z - z) < MIN_SEP)) continue;
    out.push({ x, z });
  }
  return out;
}

/** Budget how many NPCs per farm given N farms and detail tier. */
export function farmProtestBudget(farmCount: number, lowDetail: boolean): { perFarm: number; total: number; farmsUsed: number } {
  if (farmCount <= 0) return { perFarm: 0, total: 0, farmsUsed: 0 };
  const per = lowDetail ? PER_FARM_COUNT_LOW : PER_FARM_COUNT;
  let farmsUsed = farmCount;
  let total = farmsUsed * per;
  if (total > MAX_FARM_PROTESTERS) {
    farmsUsed = Math.max(1, Math.floor(MAX_FARM_PROTESTERS / per));
    total = farmsUsed * per;
  }
  return { perFarm: per, total, farmsUsed };
}

/** Spawn milling states in local coords relative to site origin (siteX, siteZ). */
export function spawnFarmCluster(
  worldPts: Array<{ x: number; z: number }>,
  siteX: number,
  siteZ: number,
  seed: number,
  idBase: number,
): ProtesterState[] {
  const rand = mulberry(seed);
  return worldPts.map((w, i) => {
    const lx = w.x - siteX, lz = w.z - siteZ;
    const tgt = worldPts[(i + 1 + Math.floor(rand() * Math.max(1, worldPts.length - 1))) % worldPts.length]!;
    const tLx = tgt.x - siteX, tLz = tgt.z - siteZ;
    return {
      id: idBase + i,
      lx, lz,
      yaw: Math.atan2(tLx - lx, tLz - lz) + (rand() - 0.5) * 0.5,
      phase: rand() * Math.PI * 2,
      speed: 0.45 + rand() * 0.7,
      targetLx: tLx, targetLz: tLz,
      wave: 0.4 + rand() * 0.5,
      shirt: (idBase + i) % SHIRT_COLORS.length,
      hasSign: rand() > 0.22,
      slogan: CHANT_SLOGANS[(idBase + i) % CHANT_SLOGANS.length]!,
      bubbleUntil: -1,
      nextRetarget: 1.5 + rand() * 3.5 + i * 0.2,
      nextBubble: 3 + rand() * 7 + i * 0.35,
      side: lx >= 0 ? 1 : -1,
    };
  });
}

/** Local-space bounds for a farm cluster (for stepProtesters zone clamp). */
export function clusterZone(pts: Array<{ lx: number; lz: number }>, pad = 0.8): { lx0: number; lx1: number; lz0: number; lz1: number } {
  if (!pts.length) return { lx0: -1, lx1: 1, lz0: -1, lz1: 1 };
  const xs = pts.map((p) => p.lx), zs = pts.map((p) => p.lz);
  return {
    lx0: Math.min(...xs) - pad, lx1: Math.max(...xs) + pad,
    lz0: Math.min(...zs) - pad, lz1: Math.max(...zs) + pad,
  };
}

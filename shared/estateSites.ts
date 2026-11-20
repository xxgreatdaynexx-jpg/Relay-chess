/**
 * Private construction sites on demolished lots (farms, houses, businesses). The deed keeps its original property id,
 * so everything that draws or opens that property asks here whether a site now stands on it. Pure helpers, shared by
 * the server (farm guards) and the client (map, deed card).
 */
import { ESTATE_BUILDS, type EstateBuildId } from './estateProjects.js';
import { propertyById } from './realEstate.js';

export interface EstateSiteSummary { lotId: string; build: EstateBuildId | null; stage: number; complete: boolean; gear: number; kind: string }

/** Lots that were demolished into a construction site (East Estates lots and Goldwood homes are drawn by their own layer). */
export const isDemolishedSite = (s: Pick<EstateSiteSummary, 'kind' | 'lotId'> | null | undefined) =>
  !!s && s.kind === 'demolished' && !s.lotId.startsWith('lot:estate:') && !s.lotId.startsWith('b:mansion:');

/** Where and how large to draw a site's building on a demolished lot: centred on the old footprint, turned to fit it
 *  best, and shrunk (never grown) so it stays inside the lot. Null when the lot is not on the city map. */
export function demolishedPlacement(lotId: string, build: EstateBuildId): { x: number; z: number; rot: number; scale: number } | null {
  const p = propertyById(lotId); const plan = ESTATE_BUILDS[build];
  if (!p || !plan || p.hidden || p.map === 'resort' || p.map === 'island') return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z) || !(p.w > 0) || !(p.d > 0)) return null;
  const fit = (w: number, d: number) => Math.min(1, p.w / w, p.d / d);
  const straight = fit(plan.w, plan.d), turned = fit(plan.d, plan.w);
  const rot = (p.rot ?? 0) + (turned > straight ? Math.PI / 2 : 0);
  return { x: p.x, z: p.z, rot, scale: Math.max(0.35, Math.max(straight, turned)) };
}

/** Plain-language deed line for a demolished lot. */
export function demolishedLine(s: Pick<EstateSiteSummary, 'build' | 'complete' | 'stage'>): string {
  if (!s.build) return 'Demolished: a private construction site. Pick a project to build here.';
  const plan = ESTATE_BUILDS[s.build];
  if (s.complete) return `${plan.icon} ${plan.name}: finished. The old structure is gone and this lot is now your ${plan.name.toLowerCase()}.`;
  return `${plan.icon} ${plan.name} under construction (stage ${Math.min(s.stage + 1, plan.stages.length)} of ${plan.stages.length}).`;
}

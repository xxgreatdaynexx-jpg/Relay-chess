/** Client cache of the public construction-site summary (/api/estate), so the map click router and deed card know
 *  when a demolished lot now holds a private site. worldEstate fills it; anyone can ask for a refresh. */
import type { EstateSiteSummary } from '../../../shared/estateSites';
import { isDemolishedSite } from '../../../shared/estateSites';

export const ESTATE_CHANGED = 'estate-changed';
let sites = new Map<string, EstateSiteSummary>();
let pending: Promise<void> | null = null;

export function setEstateSites(list: EstateSiteSummary[] | undefined) {
  sites = new Map((list ?? []).map((s) => [s.lotId, s]));
}
/** The construction site on a demolished lot, or null. */
export function demolishedSiteOf(lotId: string | null | undefined): EstateSiteSummary | null {
  if (!lotId) return null; const s = sites.get(lotId);
  return s && isDemolishedSite(s) ? s : null;
}
export function loadEstateSites(): Promise<void> {
  pending ??= fetch('/api/estate').then((r) => r.json()).then((j: { sites?: EstateSiteSummary[] }) => setEstateSites(j.sites)).catch(() => {}).finally(() => { pending = null; });
  return pending;
}
/** Tell the map and deed card a site changed (demolish, project picked, stage finished). */
export function announceEstateChange() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(ESTATE_CHANGED)); }

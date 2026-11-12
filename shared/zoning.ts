/**
 * Property zoning caps (Bill Chud 1, enacted Nov 8 2026). Caps apply to ADDITIONAL acquisitions only: deeds already
 * owned are kept in full, even above a cap (no forced sale, no confiscation). Zones never borrow capacity from each other.
 *  - Residential: houses, row houses, apartments, towers, mansions and highrises (incl. the housing that carries employee capacity) — max 5 deeds.
 *  - Commercial: gas stations, industrial warehouses (depots), barns, additional factory plants, and every public landmark (incl. Jail, Harbour) — max 5 deeds.
 *  - Farmland: farm plots, countryside fields / Big Farms and plantations — max 1,500 owned tiles (full plot cols × rows).
 *  - Exempt: Chud Resort lots and land patches (parks, empty lots).
 */
import type { Property } from './realEstate.js';

export type Zone = 'residential' | 'commercial' | 'farmland' | 'exempt';
export const ZONE_DEED_CAP = 5;
export const FARMLAND_TILE_CAP = 1500;
const RESIDENTIAL = new Set(['house', 'rowhouse', 'apartment', 'tower', 'penthouse', 'mansion', 'highrise']);
const COMMERCIAL = new Set(['gas', 'depot', 'barn', 'factory_plant']);
export const ZONE_LABEL: Record<Zone, string> = { residential: 'Residential', commercial: 'Commercial', farmland: 'Farmland', exempt: 'Exempt' };

export function zoneOf(p: Pick<Property, 'kind' | 'type' | 'map'>): Zone {
  if (p.kind === 'farm') return 'farmland';                 // farm plots, fields, Big Farms, plantations (resort map too)
  if (p.kind === 'patch') return 'exempt';
  if (p.kind === 'landmark') return 'commercial';
  if (p.map === 'resort' || p.map === 'island') return 'exempt'; // resort lots and private-island estates
  if (RESIDENTIAL.has(p.type)) return 'residential';
  if (COMMERCIAL.has(p.type)) return 'commercial';
  return 'commercial';                                      // fail closed: an unclassified future building is capped, never free
}
/** Full plot dimensions. Unknown/invalid farmland fails closed, never contributes zero capacity. */
export const tilesOf = (p: Pick<Property, 'kind' | 'tiles'>) => p.kind !== 'farm' ? 0 : Number.isSafeInteger(p.tiles) && p.tiles! > 0 ? p.tiles! : Number.POSITIVE_INFINITY;

export interface ZoneUse { residential: number; commercial: number; farmlandTiles: number }
export function zoneUse(owned: ReadonlyArray<Pick<Property, 'kind' | 'type' | 'map' | 'tiles'>>): ZoneUse {
  const u: ZoneUse = { residential: 0, commercial: 0, farmlandTiles: 0 };
  for (const p of owned) { const z = zoneOf(p); if (z === 'residential') u.residential++; else if (z === 'commercial') u.commercial++; else if (z === 'farmland') u.farmlandTiles += tilesOf(p); }
  return u;
}
/** null when allowed; otherwise the refusal text. Grandfathered holdings count toward use, so an owner already at/over a cap can't add more. */
export function zoneRefusal(use: ZoneUse, p: Pick<Property, 'kind' | 'type' | 'map' | 'tiles' | 'label'>): string | null {
  const z = zoneOf(p);
  if (z === 'residential' || z === 'commercial') {
    const n = use[z]; if (n + 1 > ZONE_DEED_CAP) return `Zoning cap: you already own ${n} ${ZONE_LABEL[z].toLowerCase()} propert${n === 1 ? 'y' : 'ies'} (max ${ZONE_DEED_CAP}). You keep what you own; you can't buy more ${ZONE_LABEL[z].toLowerCase()} property. Nothing was charged.`;
  } else if (z === 'farmland') {
    const t = tilesOf(p); if (!Number.isFinite(t) || !Number.isFinite(use.farmlandTiles)) return 'Could not verify farmland tile counts. Nothing was charged.'; if (use.farmlandTiles + t > FARMLAND_TILE_CAP) return `Zoning cap: farmland is limited to ${FARMLAND_TILE_CAP.toLocaleString('en-US')} tiles. You own ${use.farmlandTiles.toLocaleString('en-US')}; ${p.label} adds ${t.toLocaleString('en-US')}. Nothing was charged.`;
  }
  return null;
}
export function zoneLine(use: ZoneUse, p: Pick<Property, 'kind' | 'type' | 'map' | 'tiles'>): string {
  const z = zoneOf(p);
  if (z === 'exempt') return 'Exempt from zoning caps.';
  if (z === 'farmland' && (!Number.isFinite(tilesOf(p)) || !Number.isFinite(use.farmlandTiles))) return 'Farmland tile count unavailable.';
  if (z === 'farmland') return `Farmland: ${tilesOf(p).toLocaleString('en-US')} tiles · you own ${use.farmlandTiles.toLocaleString('en-US')} of ${FARMLAND_TILE_CAP.toLocaleString('en-US')}.`;
  return `${ZONE_LABEL[z]}: you own ${use[z]} of ${ZONE_DEED_CAP}.`;
}

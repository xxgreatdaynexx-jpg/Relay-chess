import { isHomeProperty } from '../../../shared/homes';

type P = { id: string; kind: string; type: string; label: string } | undefined;
export type MyHomeRows = { kitchens: string[]; homes: string[]; farms: string[]; businesses: string[] };
/**
 * Rows of the "🏠 My home" panel (Tess QA #2). Each owned property appears in exactly one group:
 * homes (enter & decorate + kitchen), farms (open farm), businesses (landmarks like the Factory, open deed), other lots (kitchen).
 * Unowned places (e.g. the Furniture Store landmark) are never listed as yours.
 */
export function myHomeRows(owned: Iterable<{ id: string; owner: string }>, me: string, byId: (id: string) => P): MyHomeRows {
  const r: MyHomeRows = { kitchens: [], homes: [], farms: [], businesses: [] }; const seen = new Set<string>(); const lc = me.toLowerCase();
  for (const o of owned) { if (o.owner.toLowerCase() !== lc || seen.has(o.id)) continue; seen.add(o.id); const p = byId(o.id);
    if (!p) continue; if (p.kind === 'farm' || o.id.startsWith('f:') || o.id.startsWith('cf:')) r.farms.push(o.id); else if (p.kind === 'landmark') r.businesses.push(o.id); else if (isHomeProperty(p)) r.homes.push(o.id); else r.kitchens.push(o.id); }
  return r;
}
